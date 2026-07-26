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
  /**
   * Écriture SYNCHRONE directe (`writeSync`) au lieu du buffer async. Sur un fd
   * PAR worker (pas de fd partagé), le write sync local est µs et SANS contention
   * d'inode → capte le gain cluster sans l'overhead du threadpool async (qui, sur
   * un fichier local rapide, l'annule). Défaut `false` (async, pour sinks lents).
   */
  sync?: boolean;
  /**
   * Écriture asynchrone employée par le drain. Défaut `fs.write`.
   *
   * Injectable pour une seule raison : la remise du descripteur de fichier dépend
   * d'une COURSE avec le pool de threads, et une course ne se provoque pas à
   * volonté. En la pilotant depuis le banc, l'invariant « on ne rend jamais un
   * descripteur sous une écriture en vol » devient une assertion au lieu d'un pari.
   */
  write?: typeof fsWrite;
}

/**
 * Driver de sink fichier NON bloquant (LB.W). Écrit via `fs.write` async sur un
 * fd persistant ouvert en append (`"a"`) — **un fd PAR worker** (≠ stdout partagé
 * hérité du master), donc sans contention d'inode.
 *
 * ⚠️ **Le fd-par-worker n'est PAS le levier de performance** — c'est un garde-fou.
 * Le vrai levier est la **coalescence des writes** (nombre de syscalls) : ×19 à
 * ×25 selon les runs (2009 ms en 1 write/ligne → 81 ms en chunks). La contention
 * d'inode ne coûte ×3.2 à ×3.8 QUE dans le cas pathologique « 1 write par ligne » ;
 * **à coalescence égale elle disparaît** (84 vs 81 ms = dans la variance). Or le
 * ring/tick de `Syslog` coalesce DÉJÀ en amont : ce sink reçoit des chunks.
 * Rejouer : `node .claude/skills/nodefony-load-test/scripts/log-sink-contention.mjs`.
 *
 * Buffer applicatif borné + drop anti-OOM ; un seul write en vol → ordre FIFO
 * garanti ; flush SYNC de secours à l'`exit` (durabilité). Node-only.
 */
export class FileSink implements ILogSink {
  readonly name = "file";
  readonly #fd: number;
  readonly #maxPendingBytes: number;
  readonly #sync: boolean;
  #pending: string[] = [];
  #pendingBytes = 0;
  #writing = false;
  #inFlight: string | null = null; // chunk passé à fsWrite, pas encore confirmé écrit
  #closed = false;
  #fdClosed = false; // le descripteur a-t-il été RENDU au système ?
  #dropped = 0;
  readonly #write: typeof fsWrite;

  constructor(options: FileSinkOptions) {
    // Dossier parent créé si absent (openSync "a" échouerait sinon).
    mkdirSync(dirname(options.path), { recursive: true });
    // "a" = O_APPEND : chaque write atomique à EOF → pas de collision de position
    // entre un write async en vol et le flushSync de secours.
    this.#fd = openSync(options.path, "a");
    this.#maxPendingBytes = options.maxPendingBytes ?? 4 * 1024 * 1024;
    this.#sync = options.sync ?? false;
    this.#write = options.write ?? fsWrite;
  }

  /** Lignes droppées (buffer saturé) — lu par une sonde, JAMAIS reloggé (récursion). */
  get dropped(): number {
    return this.#dropped;
  }

  writeOut(s: string): void {
    if (this.#closed) return;
    if (this.#sync) {
      // Mode sync : write direct sur le fd (par worker → 0 contention d'inode).
      // Pas de buffer/threadpool — le write local est µs. Best-effort sur erreur.
      try {
        writeSync(this.#fd, s);
      } catch {
        // I/O — ne pas throw dans un logger.
      }
      return;
    }
    if (this.#pendingBytes >= this.#maxPendingBytes) {
      this.#dropped++; // drop borné — jamais OOM, jamais bloquer le hot path
      return;
    }
    this.#pending.push(s);
    this.#pendingBytes += s.length;
    if (!this.#writing) this.#drain();
  }

  /**
   * stderr (sévérité ≤ 3 — ERROR/CRITIC/ALERT/EMERGENCY) → DURABLE même crash.
   * Écrit en `writeSync` IMMÉDIAT hors buffer : un fatal n'est jamais perdu si le
   * process est tué (SIGKILL/OOM) avant le drain async. En mode `sync`, `writeOut`
   * fait déjà le `writeSync`. fd PAR worker + O_APPEND → write atomique ; best-effort
   * sur erreur I/O (un logger ne throw jamais).
   *
   * ⚠️ Ordre : on NE ré-écrit PAS un chunk stdout async en vol (`#inFlight`, déjà
   * soumis à `fs.write` → le ré-écrire = doublon kernel inévitable, non annulable).
   * Conséquence assumée : un fatal peut atterrir juste AVANT un stdout encore en
   * vol/bufferisé. Les timestamps par ligne (`HH:MM:SS.mmm`) font foi pour relire
   * l'ordre causal. La durabilité du fatal prime sur l'ordre strict avec des stdout
   * non-durables (perdus de toute façon au SIGKILL en mode async).
   */
  writeErr(s: string): void {
    if (this.#closed) return;
    if (this.#sync) {
      this.writeOut(s); // mode sync → writeOut écrit déjà en writeSync
      return;
    }
    try {
      writeSync(this.#fd, s); // durable immédiat, hors buffer async
    } catch {
      // I/O — ne jamais throw dans un logger.
    }
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
    this.#write(this.#fd, chunk, (err: NodeJS.ErrnoException | null): void => {
      this.#writing = false;
      this.#inFlight = null; // confirmé écrit (ou erreur I/O → best-effort, jamais throw)
      // Une fermeture est survenue pendant le vol : elle a laissé le descripteur
      // ouvert exprès et nous a délégué sa remise. C'est maintenant, et pas avant.
      if (this.#closed) {
        this.#closeFd();
        return;
      }
      if (!err) this.#drain(); // ré-écrit ce qui s'est accumulé pendant le write async
    });
  }

  /** Rend le descripteur au système, une seule fois. */
  #closeFd(): void {
    if (this.#fdClosed) return;
    this.#fdClosed = true;
    try {
      closeSync(this.#fd);
    } catch {
      /* déjà fermé — idempotent */
    }
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

  /**
   * Ferme le sink : plus rien n'est accepté, le pending part en SYNC, et le
   * descripteur est rendu — mais **jamais sous une écriture en vol**.
   *
   * Un descripteur est un entier que le système réattribue au premier `open` venu.
   * Le rendre pendant qu'une écriture asynchrone attend encore son tour dans le pool
   * de threads, c'est la laisser atterrir dans le fichier — ou la socket — de
   * quelqu'un d'autre, sans la moindre erreur visible. Le symptôme observé était une
   * ligne d'un banc apparue en tête du fichier d'un autre ; il avait été pris pour un
   * défaut d'isolation et « corrigé » par un dossier temporaire unique, d'où son
   * retour. Quand une écriture est en vol, la remise est donc déléguée à son
   * callback ({@link #closeFd}) — idempotente et sans attente pour l'appelant.
   */
  close(): void {
    if (this.#closed) return;
    this.flushSync();
    this.#closed = true;
    // Écriture en vol : le callback rendra le descripteur (il tourne toujours, même
    // en cas d'erreur d'entrée-sortie).
    if (this.#writing) return;
    this.#closeFd();
  }
}
