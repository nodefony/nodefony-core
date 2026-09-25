import fs from "node:fs";
import type { ITransport } from "../../types/ITransport";
import type Pdu from "../Pdu";

export interface FileTransportOptions {
  path: string;
  format?: "json" | "text";
  /**
   * Plafond d'octets en attente d'écriture (défaut 8 Mio). Au-delà, les lignes
   * sont perdues et comptées ({@link FileTransport.dropped}) : un journal qui
   * produit plus vite que le disque n'écrit ne doit pas remplir la mémoire.
   */
  maxPendingBytes?: number;
}

const DEFAULT_MAX_PENDING_BYTES = 8 * 1024 * 1024;

/**
 * Transport d'écriture vers un fichier : une ligne par `Pdu` (JSONL ou texte),
 * par UN flux d'ajout ouvert paresseusement au premier envoi.
 *
 * Un seul flux garantit l'ordre des lignes et évite un `open`/`close` système
 * par ligne. La file d'écriture est bornée (`maxPendingBytes`) : au-delà, les
 * lignes sont perdues, comptées, et la saturation est signalée une seule fois
 * par épisode — le `Syslog` la relaie en `onTransportError`.
 */
export class FileTransport implements ITransport {
  readonly name = "file";
  private readonly path: string;
  private readonly format: "json" | "text";
  private readonly maxPendingBytes: number;
  private stream: fs.WriteStream | null = null;
  private droppedCount = 0;
  private saturated = false;

  constructor(options: FileTransportOptions) {
    this.path = options.path;
    this.format = options.format ?? "json";
    this.maxPendingBytes = options.maxPendingBytes ?? DEFAULT_MAX_PENDING_BYTES;
  }

  /** Lignes perdues depuis la création, faute de place dans la file d'écriture. */
  get dropped(): number {
    return this.droppedCount;
  }

  /**
   * Écrit la ligne du `Pdu` à la suite du fichier.
   *
   * @param pdu - l'entrée de journal
   * @returns résolue une fois la ligne remise au système
   * @throws Quand l'écriture échoue (chemin invalide, disque plein), ou au
   * PREMIER envoi refusé d'un épisode de saturation
   */
  send(pdu: Pdu): Promise<void> {
    const stream = this.stream ?? this.open();
    if (stream.writableLength >= this.maxPendingBytes) {
      this.droppedCount++;
      if (this.saturated) return Promise.resolve();
      this.saturated = true;
      return Promise.reject(
        new Error(
          `FileTransport ${this.path} : file d'écriture saturée ` +
            `(${this.maxPendingBytes} octets en attente) — lignes perdues ` +
            `jusqu'à ce que le disque rattrape (total ${this.droppedCount}).`,
        ),
      );
    }
    this.saturated = false;
    const line =
      this.format === "json"
        ? JSON.stringify(pdu) + "\n"
        : `${new Date(pdu.timeStamp).toISOString()} ${pdu.severityName} ${pdu.msgid}: ${String(pdu.payload)}\n`;
    return new Promise((resolve, reject) => {
      stream.write(line, "utf8", (err) => (err ? reject(err) : resolve()));
    });
  }

  /**
   * Vide la file et ferme le fichier. Idempotent ; un envoi ultérieur rouvre
   * le flux.
   *
   * @returns résolue une fois le fichier fermé
   */
  close(): Promise<void> {
    const stream = this.stream;
    if (stream === null) return Promise.resolve();
    this.stream = null;
    this.saturated = false;
    if (stream.destroyed) return Promise.resolve();
    return new Promise((resolve) => {
      stream.once("error", () => resolve());
      stream.end(() => resolve());
    });
  }

  private open(): fs.WriteStream {
    const stream = fs.createWriteStream(this.path, { flags: "a" });
    // Les rappels d'écriture en attente reçoivent l'erreur ; l'écouteur évite
    // qu'elle ne remonte en exception non capturée, et libère le flux pour que
    // l'envoi suivant retente l'ouverture (dossier créé entre-temps…).
    stream.on("error", () => {
      if (this.stream === stream) this.stream = null;
    });
    this.stream = stream;
    return stream;
  }
}
