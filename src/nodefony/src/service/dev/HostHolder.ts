import { fork, type ChildProcess } from "node:child_process";
import { DEV_CHILD_ENV } from "./devChannelBase";
import {
  leadsOwnProcessGroup,
  signalExitedGroup,
  signalProcessGroup,
  waitAllDead,
} from "./devProcess";
import {
  HELD_CHANNEL,
  IGNORE_SEND_ERROR,
  isHeldHostMessage,
  type HeldHolderMessage,
  type HeldHostState,
  type HeldJsonObject,
  type IHeldHostStatus,
} from "./heldChannel";

export type { HeldHostState, IHeldHostStatus };

/** Le flux d'origine d'une sortie d'hôte. */
export type HeldOutputStream = "out" | "err";

/**
 * Le réglage du cycle d'un hôte — délais, relances, preuve de vie. Partagé
 * tel quel par le plan qu'un serveur déclare à son superviseur
 * (`devChannel.ts#IHeldServiceDeclaration`) : une seule liste de réglages.
 * Les durées sont en millisecondes.
 */
export interface IHostTuning {
  /** Délai pour que l'hôte rapporte `ready` (défaut 30 000). */
  readonly startupTimeoutMs?: number;
  /**
   * Relances après des plantages EN RAFALE, au-delà → `errored` (défaut 5). Le
   * compte revient à zéro dès qu'une preuve de vie arrive à l'heure sur un
   * hôte prêt — sans preuve de vie (`livenessIntervalMs: 0`), il ne revient pas.
   */
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
}

/** Options d'un {@link HostHolder}. */
export interface IHostHolderOptions extends IHostTuning {
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
 * Fin de la sortie d'erreur gardée jusqu'au `ready` : un hôte qui meurt au
 * chargement (module introuvable, erreur de syntaxe) n'a que là sa cause.
 */
const STDERR_TAIL_BYTES = 2 * 1024;

/** Les derniers `STDERR_TAIL_BYTES` octets de `tail` suivi de `chunk`, copiés. */
function appendTail(tail: Buffer | null, chunk: Buffer): Buffer {
  const merged = tail === null ? chunk : Buffer.concat([tail, chunk]);
  const from = Math.max(0, merged.length - STDERR_TAIL_BYTES);
  // Copie : garder une vue retiendrait le morceau entier du tube.
  return Buffer.from(merged.subarray(from));
}

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
export class HostHolder {
  readonly key: string;
  readonly #opts: IHostHolderOptions;
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
  /**
   * Époque du cycle : avancée par `start`, `stop` et `kill`. Une relance ou un
   * démarrage décidé sous une époque passée n'a plus lieu — c'est ce qui
   * interdit à une décision périmée de lancer un second hôte.
   */
  #epoch = 0;
  /** Pourquoi le teneur a tué l'hôte, lu à sa sortie (sinon la sortie l'écraserait). */
  #killReason: string | null = null;

  constructor(options: IHostHolderOptions) {
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
   * Un hôte précédent encore vivant (échec en cours de sortie, relance en vol)
   * est tué, et le nouveau ne naît qu'après sa mort : deux hôtes ne se
   * disputent jamais le même port.
   *
   * @returns l'instantané une fois l'hôte prêt.
   * @throws si l'hôte échoue, sort ou se tait au-delà du délai — l'état passe
   *   alors `errored`, sans relance (c'est le démarrage qui a échoué) ; ou si
   *   un arrêt survient avant `ready`.
   */
  start(): Promise<IHeldHostStatus> {
    if (this.#state === "ready") return Promise.resolve(this.#snapshot);
    if (this.#startPromise) return this.#startPromise;
    if (this.#state === "stopping") {
      return Promise.reject(new Error(`held host "${this.key}" is stopping`));
    }
    const epoch = ++this.#epoch;
    // Un recul de relance en cours n'a plus lieu d'être : ce démarrage le remplace.
    this.#clearTimers();
    this.#restartCount = 0;
    this.#lastError = null;
    this.#setState("starting");
    this.#startPromise = this.#previousGone()
      .then(() => {
        if (epoch !== this.#epoch) throw this.#stoppedBeforeReady();
        return this.#spawn("starting", epoch);
      })
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

  /**
   * Arrêt FORCÉ, synchrone : SIGKILL à l'arbre de l'hôte VIVANT, s'il y en a
   * un, et plus aucune relance. Pour la sortie d'urgence, qui n'attend rien.
   * Le signal ne vise jamais le PID d'un instantané : un hôte déjà sorti a
   * rendu le sien au système, qui a pu le donner à un étranger.
   */
  kill(): void {
    this.#epoch++;
    this.#clearTimers();
    const child = this.#child;
    if (child !== null && !hasExited(child) && typeof child.pid === "number") {
      signalProcessGroup(child.pid, "SIGKILL");
    }
    this.#setState("stopped");
  }

  async #doStop(): Promise<void> {
    this.#epoch++;
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
    // Sorti à temps : sa sortie a déjà vidé son groupe (`#onExit`). En retard :
    // l'arbre est tué vivant. Dans les deux cas, l'attente est BORNÉE — un
    // process qui survit à SIGKILL ne doit pas suspendre l'arrêt de la session.
    if (typeof child.pid === "number") {
      if (late) signalProcessGroup(child.pid, "SIGKILL");
      const alive = await waitAllDead([child.pid], TREE_DEATH_WAIT_MS);
      if (alive.length > 0) {
        this.#lastError = `held host "${this.key}" survived SIGKILL (pid ${child.pid})`;
      }
    }
    this.#setState("stopped");
  }

  /**
   * Tenue quand l'hôte précédent n'existe plus — tué s'il vivait encore. Un
   * hôte qui a échoué est déjà en train de mourir ; une relance en vol, non.
   */
  #previousGone(): Promise<void> {
    const child = this.#child;
    if (child === null || hasExited(child)) return Promise.resolve();
    const gone = new Promise<void>((resolve) =>
      child.once("exit", () => resolve()),
    );
    if (typeof child.pid === "number") signalProcessGroup(child.pid, "SIGKILL");
    return gone;
  }

  #stoppedBeforeReady(): Error {
    return new Error(`held host "${this.key}" stopped before ready`);
  }

  /**
   * Lance l'hôte et résout à son `ready`. Rejette sur `failed`, erreur,
   * sortie prématurée ou silence au-delà du délai — l'arbre est alors tué
   * aussitôt, pour qu'un hôte condamné ne garde pas son port pendant qu'on
   * en lance un autre.
   *
   * Un message n'est lu que s'il vient de l'hôte COURANT, et un `ready` que
   * s'il arrive dans la phase et l'époque qui l'ont demandé : arrivé pendant
   * un arrêt, il ne vaut rien.
   */
  #spawn(phase: "starting" | "restarting", epoch: number): Promise<void> {
    this.#data = null;
    // Un hôte neuf n'a rien manqué : le compte de l'hôte tué ne le suit pas.
    this.#missed = 0;
    this.#setState(phase);
    const env: NodeJS.ProcessEnv = { ...this.#opts.env };
    delete env[DEV_CHILD_ENV];
    const onOutput = this.#opts.onOutput;
    let child: ChildProcess;
    try {
      child = fork(this.#opts.module, [], {
        cwd: this.#opts.cwd,
        env,
        execArgv: [...(this.#opts.execArgv ?? [])],
        // La sortie d'erreur est TOUJOURS lue : sa fin donne la cause d'un
        // hôte mort avant `ready`. La sortie standard sans lecteur est
        // fermée — un tube jamais lu se remplit et bloque l'hôte.
        stdio: ["ignore", onOutput ? "pipe" : "ignore", "pipe", "ipc"],
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
    const out = onOutput ? new LineAssembler((b) => onOutput("out", b)) : null;
    const err = onOutput ? new LineAssembler((b) => onOutput("err", b)) : null;

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let tail: Buffer | null = null;
      const onOut = (chunk: Buffer): void => out?.push(chunk);
      // Sans lecteur, le tube est vidé quand même : il ne doit jamais se remplir.
      const onErr = (chunk: Buffer): void => {
        err?.push(chunk);
        if (!settled) tail = appendTail(tail, chunk);
      };
      if (out) child.stdout?.on("data", onOut);
      child.stderr?.on("data", onErr);
      const killTree = (): void => {
        if (typeof child.pid === "number" && !hasExited(child))
          signalProcessGroup(child.pid, "SIGKILL");
      };
      const settle = (): void => {
        settled = true;
        tail = null;
        clearTimeout(timer);
      };
      const fail = (error: Error): void => {
        if (settled) return;
        settle();
        reject(error);
      };
      const timer = setTimeout(() => {
        fail(
          new Error(
            `held host "${this.key}" not ready after ${this.#opts.startupTimeoutMs ?? 30_000} ms`,
          ),
        );
        killTree();
      }, this.#opts.startupTimeoutMs ?? 30_000);
      const onMessage = (raw: unknown): void => {
        if (!isHeldHostMessage(raw) || this.#child !== child) return;
        if (raw.type === "pong") {
          this.#onPong(raw.seq);
          return;
        }
        // Un rapport après coup (`ready` répété, `failed` tardif) ne change rien.
        if (settled) return;
        if (raw.state === "failed") {
          fail(new Error(raw.reason ?? `held host "${this.key}" failed`));
          killTree();
          return;
        }
        if (this.#state !== phase || this.#epoch !== epoch) {
          fail(this.#stoppedBeforeReady());
          return;
        }
        settle();
        this.#data = raw.data;
        this.#setState("ready");
        this.#startLiveness();
        resolve();
      };
      const onError = (error: Error): void => {
        fail(error);
        killTree();
      };
      const onExit = (
        code: number | null,
        signal: NodeJS.Signals | null,
      ): void => {
        child.removeListener("message", onMessage);
        child.removeListener("error", onError);
        if (out) child.stdout?.removeListener("data", onOut);
        child.stderr?.removeListener("data", onErr);
        out?.flush();
        err?.flush();
        const how = signal ?? `code ${code}`;
        if (!settled) fail(new Error(exitedBeforeReady(this.key, how, tail)));
        // Seule la sortie de l'hôte COURANT parle de l'état : celle d'un hôte
        // déjà remplacé ne doit ni le faire croire planté ni relancer un
        // troisième hôte par-dessus le vivant. Défense en profondeur :
        // `#previousGone` fait qu'aucune voie ne remplace aujourd'hui l'hôte
        // avant sa sortie — cette garde tient si l'on en ouvre une.
        if (this.#child !== child) return;
        this.#child = null;
        this.#onExit(how, child.pid);
      };
      child.on("message", onMessage);
      child.on("error", onError);
      child.once("exit", onExit);
      this.#send(child, {
        channel: HELD_CHANNEL,
        type: "start",
        key: this.key,
        spec: this.#opts.spec,
      });
    });
  }

  #onPong(seq: number): void {
    if (seq !== this.#awaitedSeq) return;
    this.#awaitedSeq = -1;
    const late =
      performance.now() - this.#pingSentAt >
      (this.#opts.livenessTimeoutMs ?? 5_000);
    this.#setMissed(late ? this.#missed + 1 : 0);
    // Une preuve de vie à l'heure, hôte prêt : un intervalle entier a été
    // VÉCU depuis la relance. Le budget de relances est rendu — il ne doit
    // compter que les plantages en RAFALE (une boucle), jamais la vie
    // entière : cinq plantages épars sur une longue session condamnaient
    // sinon le service en `errored`, sans relance possible.
    if (!late && this.#state === "ready" && this.#restartCount > 0) {
      this.#restartCount = 0;
      this.#publish();
    }
  }

  /**
   * L'hôte COURANT est sorti : son groupe est vidé (les descendants qu'il
   * laisse tiendraient son port), puis plantage à relancer, sauf arrêt voulu.
   * L'instantané est toujours republié : son PID n'est plus.
   */
  #onExit(how: string, pid: number | undefined): void {
    this.#stopLiveness();
    if (typeof pid === "number") signalExitedGroup(pid, "SIGKILL");
    const reason = this.#killReason;
    this.#killReason = null;
    const before = this.#snapshot;
    // Démarrage ou relance en vol : `start()`/la relance tranchent ; arrêt : rien à faire.
    if (this.#state === "ready") {
      this.#lastError = reason ?? `held host "${this.key}" exited (${how})`;
      this.#setState("crashed");
      this.#scheduleRestart();
    }
    if (this.#snapshot === before) this.#publish();
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
    const epoch = this.#epoch;
    this.#restartCount++;
    this.#setState("restarting");
    this.#restartTimer = setTimeout(() => {
      this.#restartTimer = null;
      if (this.#state !== "restarting" || epoch !== this.#epoch) return;
      this.#previousGone()
        .then(() => {
          if (epoch !== this.#epoch) throw this.#stoppedBeforeReady();
          return this.#spawn("restarting", epoch);
        })
        .catch((error: unknown) => {
          // Un `start`, un `stop` ou un `kill` est passé : la décision est périmée.
          if (epoch !== this.#epoch) return;
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
    if (this.#awaitedSeq !== -1) this.#setMissed(this.#missed + 1);
    if (this.#missed >= (this.#opts.livenessMissedLimit ?? 3)) {
      // La sortie qui suit passe par `#onExit` → relance avec recul, et c'est
      // cette cause qu'elle publie. La preuve de vie reste armée : si le
      // signal n'a pas abouti, le prochain tour le renvoie — jamais un hôte
      // gelé laissé `ready` à vie.
      this.#killReason = `held host "${this.key}" unresponsive`;
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
      child.send(msg, IGNORE_SEND_ERROR);
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
      missedPongs: this.#missed,
    });
  }

  /**
   * Fixe le compte de preuves de vie manquées, et le publie s'il change : il
   * ne bouge que quand l'hôte va mal, ou qu'il se rétablit.
   */
  #setMissed(count: number): void {
    if (count === this.#missed) return;
    this.#missed = count;
    this.#publish();
  }
}

/** Le process est-il déjà sorti ? */
function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

/** Le message d'un hôte sorti avant `ready`, avec la fin de sa sortie d'erreur. */
function exitedBeforeReady(
  key: string,
  how: string,
  tail: Buffer | null,
): string {
  const base = `held host "${key}" exited before ready (${how})`;
  const cause = tail === null ? "" : tail.toString("utf8").trim();
  return cause === "" ? base : `${base}: ${cause}`;
}

/** Le texte d'une erreur, quelle que soit sa forme. */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
