/**
 * L'historique du superviseur, PAR CANAL : un anneau `DevTranscript` par
 * canal, une numérotation commune, un plafond global (ADR-0013 §3, amendement
 * #903).
 *
 * Les canaux sont le modèle de données du SUPERVISEUR, pas de l'écran : le
 * terminal en est un lecteur (une vue lit un canal), l'assistant un autre.
 * Ne pas confondre avec `devChannel.ts`, le canal IPC superviseur ⇄ serveur.
 */
import type { ProcessOutputStream } from "./heldChannel";
import {
  DevTranscript,
  type IDevTranscriptOptions,
  type ITranscriptEntry,
} from "./devTranscript";

/** Réglages de l'historique par canal. */
export interface IDevHistoryOptions {
  /** Octets UTF-8 retenus au plus, TOUS canaux confondus (défaut 8 Mio). */
  maxBytes?: number;
  /**
   * Plafonds d'UN canal : entrées (défaut 10 000), octets (défaut : le
   * plafond global), octets par entrée (défaut 16 Kio).
   */
  channel?: Pick<
    IDevTranscriptOptions,
    "maxEntries" | "maxBytes" | "maxEntryBytes"
  >;
  /** Horloge, injectable en test. */
  now?: () => number;
  /** Appelé quand un canal efface l'écran (`ESC[2J`). */
  onClear?: (channel: string) => void;
}

/**
 * Un historique par canal, sous une numérotation commune et un plafond
 * global.
 *
 * - **Canal à identifiant OUVERT** (`server`, `supervisor`, `vite:<nom>`,
 *   `run:<n>`, `agent:<id>`), créé au premier paquet : aucun anneau alloué
 *   d'avance, et un producteur neuf ne rouvre pas le modèle.
 * - **`seq` global et monotone** : {@link DevHistory.since} rend le fil
 *   FUSIONNÉ de tous les canaux, et un lecteur reprend sans savoir combien il
 *   y en a.
 * - **Plafond global** : dépassé, il évince dans le canal le plus GROS — une
 *   rafale de Vite n'évince jamais la pile d'un crash du serveur tant que
 *   Vite pèse davantage.
 */
export class DevHistory {
  readonly #maxBytes: number;
  readonly #channelOptions: IDevTranscriptOptions;
  /** Les canaux, par identifiant — ouverts à la volée, lus à chaque image. */
  readonly #channels = new Map<string, DevTranscript>();
  #seq = 0;
  #bytes = 0;

  /**
   * @param options - plafonds global et par canal, horloge, effacement.
   */
  constructor(options: IDevHistoryOptions = {}) {
    this.#maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
    const nextSeq = (): number => ++this.#seq;
    this.#channelOptions = {
      maxBytes: this.#maxBytes,
      ...options.channel,
      nextSeq,
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.onClear === undefined ? {} : { onClear: options.onClear }),
    };
  }

  /** Octets UTF-8 retenus, tous canaux confondus. */
  get bytes(): number {
    return this.#bytes;
  }

  /** Numéro de la dernière entrée écrite, tous canaux confondus. */
  get lastSeq(): number {
    return this.#seq;
  }

  /** Les canaux ouverts, dans leur ordre d'ouverture. */
  channels(): string[] {
    return [...this.#channels.keys()];
  }

  /**
   * L'anneau d'un canal — ce qu'une vue lit.
   *
   * @param channel - l'identifiant du canal.
   * @returns son historique, ou `undefined` s'il n'a jamais rien reçu (ou a
   *   été fermé).
   */
  channel(channel: string): DevTranscript | undefined {
    return this.#channels.get(channel);
  }

  /**
   * Verse un paquet dans un canal, ouvert au premier paquet ; le plafond
   * global est tenu au retour.
   *
   * @param channel - le canal qui écrit.
   * @param stream - sur quel flux.
   * @param chunk - le paquet, octets bruts ou texte.
   */
  ingest(
    channel: string,
    stream: ProcessOutputStream,
    chunk: Buffer | Uint8Array | string,
  ): void {
    let transcript = this.#channels.get(channel);
    if (transcript === undefined) {
      transcript = new DevTranscript(this.#channelOptions);
      this.#channels.set(channel, transcript);
    }
    const before = transcript.bytes;
    transcript.ingest(channel, stream, chunk);
    this.#settle(transcript.bytes - before);
  }

  /**
   * Termine les lignes en cours d'un canal, ou de tous.
   *
   * @param channel - le canal ; tous si absent.
   */
  flush(channel?: string): void {
    for (const [id, transcript] of this.#channels) {
      if (channel !== undefined && id !== channel) continue;
      const before = transcript.bytes;
      transcript.flush();
      this.#settle(transcript.bytes - before);
    }
  }

  /**
   * Ferme un canal et libère son historique — un onglet de sous-agent
   * refermé ne laisse rien derrière lui.
   *
   * @param channel - le canal.
   * @returns `true` s'il existait.
   */
  drop(channel: string): boolean {
    const transcript = this.#channels.get(channel);
    if (transcript === undefined) return false;
    this.#bytes -= transcript.bytes;
    return this.#channels.delete(channel);
  }

  /**
   * Les entrées postérieures à `seq`, TOUS canaux fusionnés dans l'ordre des
   * numéros — de quoi reprendre une lecture sans connaître les canaux.
   *
   * @param seq - le dernier numéro déjà lu (`0` pour tout lire).
   * @param limit - nombre maximal d'entrées rendues.
   * @returns une copie bornée.
   */
  since(seq: number, limit = Number.POSITIVE_INFINITY): ITranscriptEntry[] {
    // Une tête de lecture par canal non épuisé ; à chaque tour, la plus
    // petite tête sort. Une dizaine de canaux au plus : un balayage linéaire
    // des têtes bat un tas.
    const rings: DevTranscript[] = [];
    const heads: number[] = [];
    for (const transcript of this.#channels.values()) {
      const at = transcript.length - transcript.countAfter(seq);
      if (at < transcript.length) {
        rings.push(transcript);
        heads.push(at);
      }
    }
    const out: ITranscriptEntry[] = [];
    while (out.length < limit) {
      let pick = -1;
      let best: ITranscriptEntry | undefined;
      for (let i = 0; i < rings.length; i++) {
        const entry = rings[i]?.at(heads[i] ?? 0);
        if (
          entry !== undefined &&
          (best === undefined || entry.seq < best.seq)
        ) {
          best = entry;
          pick = i;
        }
      }
      if (best === undefined) break;
      out.push(best);
      heads[pick] = (heads[pick] ?? 0) + 1;
    }
    return out;
  }

  /** Vide tous les canaux ; la numérotation continue. */
  clear(): void {
    for (const transcript of this.#channels.values()) transcript.clear();
    this.#bytes = 0;
  }

  /**
   * Reporte la variation d'un canal, puis tient le plafond global en
   * évinçant dans le canal le plus gros.
   */
  #settle(delta: number): void {
    this.#bytes += delta;
    while (this.#bytes > this.#maxBytes) {
      let largest: DevTranscript | undefined;
      for (const transcript of this.#channels.values()) {
        if (largest === undefined || transcript.bytes > largest.bytes) {
          largest = transcript;
        }
      }
      const freed = largest?.evictOldest() ?? 0;
      if (freed === 0 && (largest?.length ?? 0) === 0) break;
      this.#bytes -= freed;
    }
  }
}
