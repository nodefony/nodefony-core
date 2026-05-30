import {
  openSync,
  writeSync,
  closeSync,
  write as fsWrite,
  mkdirSync,
} from "node:fs";
import { dirname } from "node:path";
import type { ILogSink } from "../Syslog";

export interface FileSinkOptions {
  /** Chemin du fichier de log (ouvert en append, créé si absent — dossier parent créé). */
  path: string;
  /** Octets max en attente avant DROP borné (anti-OOM). Défaut 4 MiB. */
  maxPendingBytes?: number;
}

/**
 * Driver de sink fichier NON bloquant (LB.W). Écrit via `fs.write` async sur un
 * fd persistant ouvert en append (`"a"`) — **un fd PAR worker** (≠ stdout partagé
 * hérité du master) → 0 lock d'inode = le goulet cluster prouvé (+28 % RPS)
 * disparaît. Buffer applicatif borné + drop anti-OOM ; un seul write en vol →
 * ordre FIFO garanti ; flush SYNC de secours à l'`exit` (durabilité). Node-only.
 */
export class FileSink implements ILogSink {
  readonly name = "file";
  readonly #fd: number;
  readonly #maxPendingBytes: number;
  #pending: string[] = [];
  #pendingBytes = 0;
  #writing = false;
  #inFlight: string | null = null; // chunk passé à fsWrite, pas encore confirmé écrit
  #closed = false;
  #dropped = 0;

  constructor(options: FileSinkOptions) {
    // Dossier parent créé si absent (openSync "a" échouerait sinon).
    mkdirSync(dirname(options.path), { recursive: true });
    // "a" = O_APPEND : chaque write atomique à EOF → pas de collision de position
    // entre un write async en vol et le flushSync de secours.
    this.#fd = openSync(options.path, "a");
    this.#maxPendingBytes = options.maxPendingBytes ?? 4 * 1024 * 1024;
  }

  /** Lignes droppées (buffer saturé) — lu par une sonde, JAMAIS reloggé (récursion). */
  get dropped(): number {
    return this.#dropped;
  }

  writeOut(s: string): void {
    if (this.#closed) return;
    if (this.#pendingBytes >= this.#maxPendingBytes) {
      this.#dropped++; // drop borné — jamais OOM, jamais bloquer le hot path
      return;
    }
    this.#pending.push(s);
    this.#pendingBytes += s.length;
    if (!this.#writing) this.#drain();
  }

  // stderr (sévérité ≤ 3) → même fd, même file FIFO → ordre causal préservé.
  writeErr(s: string): void {
    this.writeOut(s);
  }

  #drain(): void {
    // 1 seul write en vol (#writing) → ordre FIFO garanti, pas d'écriture concurrente.
    if (this.#writing || this.#pending.length === 0) return;
    this.#writing = true;
    const chunk = this.#pending.join("");
    this.#pending.length = 0;
    this.#pendingBytes = 0;
    // Le chunk reste référencé dans #inFlight tant que le write n'est PAS confirmé :
    // si close()/flushSync() (exit) survient avant le callback async, il est ré-écrit
    // en SYNC — sinon perdu (le fd serait fermé avant que le callback ne tourne).
    this.#inFlight = chunk;
    fsWrite(this.#fd, chunk, (err: NodeJS.ErrnoException | null): void => {
      this.#writing = false;
      this.#inFlight = null; // confirmé écrit (ou erreur I/O → best-effort, jamais throw)
      if (!err) this.#drain(); // ré-écrit ce qui s'est accumulé pendant le write async
    });
  }

  flushSync(): void {
    if (this.#closed) return;
    // Secours SYNC (exit/close) : écrit le chunk en vol NON confirmé + le pending,
    // directement sur le fd. Append ("a") → pas de collision avec un write async en
    // cours ; au pire un doublon best-effort (bien moins grave qu'une perte de log).
    const rest = (this.#inFlight ?? "") + this.#pending.join("");
    this.#pending.length = 0;
    this.#pendingBytes = 0;
    this.#inFlight = null;
    if (rest.length === 0) return;
    try {
      writeSync(this.#fd, rest);
    } catch {
      // fd fermé / I/O — best-effort, ne pas aggraver un crash en cours.
    }
  }

  close(): void {
    if (this.#closed) return;
    this.flushSync();
    this.#closed = true;
    try {
      closeSync(this.#fd);
    } catch {
      // idempotent — fd déjà fermé.
      this.#closed = true;
    }
  }
}
