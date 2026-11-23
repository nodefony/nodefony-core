import { fork, type ChildProcess } from "node:child_process";
import { DEV_CHILD_ENV } from "./devChannelBase";
import {
  leadsOwnProcessGroup,
  signalProcessGroup,
  waitAllDead,
} from "./devProcess";
import {
  HELD_CHANNEL,
  isHeldHostMessage,
  type HeldHolderMessage,
  type HeldHostMessage,
  type HeldJsonObject,
} from "./heldChannel";

/** L'état d'un hôte, vu par son teneur. */
export type HeldHostState =
  | "idle"
  | "starting"
  | "ready"
  | "restarting"
  | "crashed"
  | "errored"
  | "stopping"
  | "stopped";

/**
 * Instantané de l'état d'un hôte — figé, remplacé en bloc à chaque changement :
 * le lire ne coûte ni allocation ni appel (ADR-0030 §D5).
 */
export interface IHeldHostStatus {
  readonly key: string;
  readonly state: HeldHostState;
  readonly pid: number | null;
  /** La donnée rapportée par l'hôte prêt (adresse, port…), sinon `null`. */
  readonly data: HeldJsonObject | null;
  readonly lastError: string | null;
  readonly restartCount: number;
}

/** Le flux d'origine d'une sortie d'hôte. */
export type HeldOutputStream = "out" | "err";

/** Options d'un {@link HeldHost}. Les durées sont en millisecondes. */
export interface IHeldHostOptions {
  /** Identifiant stable du service (`vite:default`, `llm:mistral`). */
  readonly key: string;
  /** Chemin ABSOLU du module hôte, lancé par `fork`. */
  readonly module: string;
  /** Ce que l'hôte reçoit à son démarrage (`IHeldStart.spec`). */
  readonly spec: HeldJsonObject;
  readonly cwd: string;
  /**
   * Environnement de l'hôte. `NF_DEV_CHILD` en est TOUJOURS retiré : l'hôte
   * se croirait sinon le serveur enfant du superviseur (ADR-0030 §D6).
   */
  readonly env: NodeJS.ProcessEnv;
  /** Drapeaux `node` de l'hôte ; aucun par défaut (jamais l'`--inspect` du teneur). */
  readonly execArgv?: readonly string[];
  /** Délai pour que l'hôte rapporte `ready` (défaut 30 000). */
  readonly startupTimeoutMs?: number;
  /** Relances après un plantage, au-delà → `errored` (défaut 5). */
  readonly maxRestarts?: number;
  /** Recul de relance exponentiel : base et plafond (défauts 500 / 8 000). */
  readonly restartBackoffBaseMs?: number;
  readonly restartBackoffMaxMs?: number;
  /** Période de la preuve de vie ; `0` la coupe (défaut 30 000). */
  readonly livenessIntervalMs?: number;
  /** Une réponse plus tardive compte comme manquée (défaut 5 000). */
  readonly livenessTimeoutMs?: number;
  /** Preuves manquées d'affilée avant de tuer l'hôte (défaut 3). */
  readonly livenessMissedLimit?: number;
  /** Délai laissé à l'hôte pour sortir après `stop`, puis l'arbre est tué (défaut 3 000). */
  readonly stopGraceMs?: number;
  /**
   * Reçoit la sortie de l'hôte par LIGNES COMPLÈTES (fin `\n` comprise) — une
   * ligne n'est jamais coupée entre deux appels, si bien que plusieurs hôtes
   * peuvent partager un même lecteur sans mêler leurs lignes.
   */
  readonly onOutput?: (stream: HeldOutputStream, lines: Buffer) => void;
  /** Appelé à chaque changement d'instantané. */
  readonly onStatus?: (status: IHeldHostStatus) => void;
}

/** Au-delà, une ligne sans fin est livrée telle quelle : la mémoire reste bornée. */
const MAX_PARTIAL_LINE_BYTES = 64 * 1024;

/** Délai laissé aux derniers process d'un arbre tué pour disparaître. */
const TREE_DEATH_WAIT_MS = 2_000;

/**
 * Rassemble les morceaux d'un flux en lignes complètes, sans copie quand le
 * morceau finit sur une fin de ligne (cas courant). Seul le reste d'une ligne
 * coupée est copié — jamais tout le morceau qui le porte.
 */
class LineAssembler {
  #partial: Buffer | null = null;

  constructor(private readonly emit: (lines: Buffer) => void) {}

  push(chunk: Buffer): void {
    const end = chunk.lastIndexOf(10);
    if (end === -1) {
      const partial =
        this.#partial === null
          ? Buffer.from(chunk)
          : Buffer.concat([this.#partial, chunk]);
      if (partial.length >= MAX_PARTIAL_LINE_BYTES) {
        this.#partial = null;
        this.emit(partial);
      } else {
        this.#partial = partial;
      }
      return;
    }
    const head = chunk.subarray(0, end + 1);
    if (this.#partial === null) {
      this.emit(head);
    } else {
      const lines = Buffer.concat([this.#partial, head]);
      this.#partial = null;
      this.emit(lines);
    }
    if (end + 1 < chunk.length)
      this.#partial = Buffer.from(chunk.subarray(end + 1));
  }

  /** Livre la dernière ligne restée sans fin (sortie de l'hôte). */
  flush(): void {
    if (this.#partial === null) return;
    const rest = this.#partial;
    this.#partial = null;
    this.emit(rest);
  }
}

/**
 * Le TENEUR d'un hôte de service (ADR-0030 §D2) : lance le module hôte par
 * `fork`, attend son `ready`, prouve sa vie, le relance avec recul après un
 * plantage, et l'arrête en tuant son arbre.
 *
 * SEULE implémentation de ce cycle : le superviseur de développement l'emploie
 * pour les services qu'il porte, le serveur lui-même ailleurs. Aucun import du
 * noyau — le superviseur peut la charger.
 */
export class HeldHost {
  readonly key: string;
  readonly #opts: IHeldHostOptions;
  #child: ChildProcess | null = null;
  #state: HeldHostState = "idle";
  #data: HeldJsonObject | null = null;
  #lastError: string | null = null;
  #restartCount = 0;
  #snapshot: IHeldHostStatus;
  #startPromise: Promise<IHeldHostStatus> | null = null;
  #stopPromise: Promise<void> | null = null;
  #restartTimer: NodeJS.Timeout | null = null;
  #livenessTimer: NodeJS.Timeout | null = null;
  #pingSeq = 0;
  /** Numéro du ping en attente de réponse, `-1` si aucun. */
  #awaitedSeq = -1;
  #pingSentAt = 0;
  #missed = 0;

  constructor(options: IHeldHostOptions) {
    this.key = options.key;
    this.#opts = options;
    this.#snapshot = this.#freeze();
  }

  /** L'instantané courant — lecture de champ, sans allocation. */
  status(): IHeldHostStatus {
    return this.#snapshot;
  }

  /**
   * Démarre l'hôte et attend son `ready`. Idempotent : prêt → l'instantané ;
   * démarrage en cours → la même promesse.
   *
   * @returns l'instantané une fois l'hôte prêt.
   * @throws si l'hôte échoue, sort ou se tait au-delà du délai — l'état passe
   *   alors `errored`, sans relance (c'est le démarrage qui a échoué).
   */
  start(): Promise<IHeldHostStatus> {
    if (this.#state === "ready") return Promise.resolve(this.#snapshot);
    if (this.#startPromise) return this.#startPromise;
    if (this.#state === "stopping") {
      return Promise.reject(new Error(`held host "${this.key}" is stopping`));
    }
    this.#restartCount = 0;
    this.#lastError = null;
    this.#startPromise = this.#spawn("starting")
      .then(
        () => this.#snapshot,
        (error: unknown) => {
          // Un arrêt demandé pendant le démarrage n'est pas un échec à publier.
          if (this.#state !== "stopping" && this.#state !== "stopped") {
            this.#lastError = errorText(error);
            this.#setState("errored");
          }
          throw error;
        },
      )
      .finally(() => {
        this.#startPromise = null;
      });
    return this.#startPromise;
  }

  /**
   * Arrête l'hôte : `stop` par le canal, puis l'arbre tué au-delà du délai, et
   * attente de sa mort EFFECTIVE (un dossier ne se libère pas avant, sous
   * Windows). Idempotent.
   */
  stop(): Promise<void> {
    if (this.#stopPromise) return this.#stopPromise;
    this.#stopPromise = this.#doStop().finally(() => {
      this.#stopPromise = null;
    });
    return this.#stopPromise;
  }

  async #doStop(): Promise<void> {
    this.#setState("stopping");
    this.#clearTimers();
    const child = this.#child;
    if (child === null || hasExited(child)) {
      this.#child = null;
      this.#setState("stopped");
      return;
    }
    const exited = new Promise<void>((resolve) =>
      child.once("exit", () => resolve()),
    );
    this.#send(child, { channel: HELD_CHANNEL, type: "stop" });
    const timedOut = Promise.withResolvers<boolean>();
    const grace = setTimeout(
      () => timedOut.resolve(true),
      this.#opts.stopGraceMs ?? 3_000,
    );
    const late = await Promise.race([
      exited.then(() => false),
      timedOut.promise,
    ]);
    clearTimeout(grace);
    // Même sorti proprement, l'hôte peut laisser des descendants dans son
    // groupe : on le vide toujours (`gone` si rien n'y reste).
    if (typeof child.pid === "number") {
      signalProcessGroup(child.pid, "SIGKILL");
      if (late) await exited;
      await waitAllDead([child.pid], TREE_DEATH_WAIT_MS);
    }
    this.#setState("stopped");
  }

  /**
   * Lance l'hôte et résout à son `ready`. Rejette sur `failed`, sortie
   * prématurée ou silence au-delà du délai (l'arbre est alors tué).
   */
  #spawn(phase: "starting" | "restarting"): Promise<void> {
    this.#data = null;
    this.#setState(phase);
    const env: NodeJS.ProcessEnv = { ...this.#opts.env };
    delete env[DEV_CHILD_ENV];
    let child: ChildProcess;
    try {
      child = fork(this.#opts.module, [], {
        cwd: this.#opts.cwd,
        env,
        execArgv: [...(this.#opts.execArgv ?? [])],
        // Sans lecteur, les sorties sont FERMÉES : un tube jamais lu se
        // remplit, et l'hôte se bloquerait sur sa prochaine écriture.
        stdio: this.#opts.onOutput
          ? ["ignore", "pipe", "pipe", "ipc"]
          : ["ignore", "ignore", "ignore", "ipc"],
        detached: leadsOwnProcessGroup(),
        serialization: "json",
        windowsHide: true,
      });
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
    this.#child = child;
    this.#publish();
    const onOutput = this.#opts.onOutput;
    const out = onOutput ? new LineAssembler((b) => onOutput("out", b)) : null;
    const err = onOutput ? new LineAssembler((b) => onOutput("err", b)) : null;
    const onOut = (chunk: Buffer): void => out?.push(chunk);
    const onErr = (chunk: Buffer): void => err?.push(chunk);
    if (out) child.stdout?.on("data", onOut);
    if (err) child.stderr?.on("data", onErr);

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        fail(
          new Error(
            `held host "${this.key}" not ready after ${this.#opts.startupTimeoutMs ?? 30_000} ms`,
          ),
        );
        if (typeof child.pid === "number")
          signalProcessGroup(child.pid, "SIGKILL");
      }, this.#opts.startupTimeoutMs ?? 30_000);
      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      };
      const onMessage = (raw: unknown): void => {
        if (!isHeldHostMessage(raw)) return;
        this.#onHostMessage(raw);
        if (raw.type !== "report" || settled) return;
        if (raw.state === "ready") {
          settled = true;
          clearTimeout(timer);
          resolve();
        } else {
          fail(new Error(raw.reason ?? `held host "${this.key}" failed`));
        }
      };
      const onError = (error: Error): void => fail(error);
      const onExit = (
        code: number | null,
        signal: NodeJS.Signals | null,
      ): void => {
        child.removeListener("message", onMessage);
        child.removeListener("error", onError);
        if (out) child.stdout?.removeListener("data", onOut);
        if (err) child.stderr?.removeListener("data", onErr);
        out?.flush();
        err?.flush();
        if (this.#child === child) this.#child = null;
        const how = signal ?? `code ${code}`;
        fail(new Error(`held host "${this.key}" exited before ready (${how})`));
        this.#onExit(how);
      };
      child.on("message", onMessage);
      child.on("error", onError);
      child.once("exit", onExit);
      this.#send(child, {
        channel: HELD_CHANNEL,
        type: "start",
        spec: this.#opts.spec,
      });
    });
  }

  #onHostMessage(message: HeldHostMessage): void {
    if (message.type === "pong") {
      if (message.seq !== this.#awaitedSeq) return;
      this.#awaitedSeq = -1;
      const late =
        performance.now() - this.#pingSentAt >
        (this.#opts.livenessTimeoutMs ?? 5_000);
      this.#missed = late ? this.#missed + 1 : 0;
      return;
    }
    if (message.state === "ready") {
      this.#data = message.data;
      this.#setState("ready");
      this.#startLiveness();
    }
  }

  /** L'hôte est sorti : plantage à relancer, sauf arrêt voulu. */
  #onExit(how: string): void {
    this.#stopLiveness();
    if (this.#state === "stopping" || this.#state === "stopped") return;
    if (this.#state !== "ready") return; // démarrage : `start()`/la relance tranchent
    this.#lastError = `held host "${this.key}" exited (${how})`;
    this.#setState("crashed");
    this.#scheduleRestart();
  }

  #scheduleRestart(): void {
    const max = this.#opts.maxRestarts ?? 5;
    if (this.#restartCount >= max) {
      this.#lastError = `held host "${this.key}": max restarts (${max}) reached`;
      this.#setState("errored");
      return;
    }
    const delay = Math.min(
      (this.#opts.restartBackoffBaseMs ?? 500) * 2 ** this.#restartCount,
      this.#opts.restartBackoffMaxMs ?? 8_000,
    );
    this.#restartCount++;
    this.#setState("restarting");
    this.#restartTimer = setTimeout(() => {
      this.#restartTimer = null;
      if (this.#state !== "restarting") return;
      this.#spawn("restarting").catch((error: unknown) => {
        if (this.#state === "stopping" || this.#state === "stopped") return;
        this.#lastError = errorText(error);
        this.#setState("crashed");
        this.#scheduleRestart();
      });
    }, delay);
    this.#restartTimer.unref();
  }

  #startLiveness(): void {
    this.#stopLiveness();
    const interval = this.#opts.livenessIntervalMs ?? 30_000;
    if (interval <= 0) return;
    this.#missed = 0;
    this.#awaitedSeq = -1;
    this.#livenessTimer = setInterval(() => this.#tickLiveness(), interval);
    this.#livenessTimer.unref();
  }

  #tickLiveness(): void {
    const child = this.#child;
    if (child === null) return;
    if (this.#awaitedSeq !== -1) this.#missed++;
    if (this.#missed >= (this.#opts.livenessMissedLimit ?? 3)) {
      this.#lastError = `held host "${this.key}" unresponsive`;
      this.#stopLiveness();
      // La sortie qui suit passe par `#onExit` → relance avec recul.
      if (typeof child.pid === "number")
        signalProcessGroup(child.pid, "SIGKILL");
      return;
    }
    this.#awaitedSeq = ++this.#pingSeq;
    this.#pingSentAt = performance.now();
    this.#send(child, {
      channel: HELD_CHANNEL,
      type: "ping",
      seq: this.#awaitedSeq,
    });
  }

  #stopLiveness(): void {
    if (this.#livenessTimer !== null) {
      clearInterval(this.#livenessTimer);
      this.#livenessTimer = null;
    }
  }

  #clearTimers(): void {
    this.#stopLiveness();
    if (this.#restartTimer !== null) {
      clearTimeout(this.#restartTimer);
      this.#restartTimer = null;
    }
  }

  #send(child: ChildProcess, msg: HeldHolderMessage): void {
    if (!child.connected) return;
    try {
      child.send(msg);
    } catch {
      // canal en cours de fermeture : la sortie suivra
    }
  }

  #setState(state: HeldHostState): void {
    if (this.#state === state && state !== "ready") return;
    this.#state = state;
    this.#publish();
  }

  #publish(): void {
    this.#snapshot = this.#freeze();
    this.#opts.onStatus?.(this.#snapshot);
  }

  #freeze(): IHeldHostStatus {
    return Object.freeze({
      key: this.key,
      state: this.#state,
      pid: this.#child?.pid ?? null,
      data: this.#data,
      lastError: this.#lastError,
      restartCount: this.#restartCount,
    });
  }
}

/** Le process est-il déjà sorti ? */
function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

/** Le texte d'une erreur, quelle que soit sa forme. */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
