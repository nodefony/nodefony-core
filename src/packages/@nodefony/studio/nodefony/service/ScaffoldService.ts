/// <reference types="node" />
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  Service,
  runScaffold,
  listTargets,
  findProjectRoot,
  suspendSupervisor,
  resumeSupervisor,
  type Container,
  type Event,
  type Module,
  type IScaffoldRequest,
  type IScaffoldResult,
  type IScaffoldTarget,
  type TScaffoldAnswers,
} from "nodefony";

/**
 * Étapes exécutables APRÈS l'écriture des fichiers. C'est une **allowlist fermée** :
 * le client coche une étape connue, il n'envoie JAMAIS une ligne de commande. Sans ça,
 * on offrirait une exécution de code arbitraire derrière une session web.
 */
export const SCAFFOLD_STEPS = ["install", "build", "typecheck"] as const;
export type ScaffoldStep = (typeof SCAFFOLD_STEPS)[number];

/** Commande réelle de chaque étape — figée côté serveur, jamais dérivée d'une entrée client. */
const STEP_COMMANDS: Record<ScaffoldStep, readonly string[]> = {
  install: ["install"],
  build: ["run", "build"],
  typecheck: ["run", "typecheck"],
};

/** Nature d'une ligne du terminal — pilote la couleur côté front. */
export type ScaffoldStream = "info" | "out" | "err" | "ok" | "fail";

/** Une ligne de terminal. `seq` permet au front de détecter un trou. */
export interface IScaffoldLine {
  seq: number;
  ts: number;
  stream: ScaffoldStream;
  text: string;
}

export type ScaffoldJobStatus = "running" | "done" | "failed";

/** État d'un job, tel que servi au front (snapshot sérialisable). */
export interface IScaffoldJobState {
  id: string;
  type: string;
  status: ScaffoldJobStatus;
  startedAt: number;
  endedAt: number | null;
  /** Fichiers écrits par le moteur (chemins relatifs) — vide tant que l'écriture n'a pas eu lieu. */
  files: string[];
  /** Notes du moteur (routes/canaux câblés) — affichables telles quelles. */
  notes: string[];
  lines: IScaffoldLine[];
}

/**
 * Ce qui transite sur le canal `scaffold:job@<id>`.
 *
 * Deux natures, et pas une seule : une ligne de terminal **et** l'état du job. Sans le
 * second, le front n'aurait aucun moyen d'apprendre par la socket qu'un job est terminé
 * (les lignes ne disent pas « c'est fini ») — il devrait sonder le serveur en boucle,
 * alors qu'une connexion temps réel est déjà ouverte. On pousse donc l'état : à
 * l'abonnement (après le rejeu), et à chaque changement.
 */
export type IScaffoldEvent =
  | { kind: "line"; line: IScaffoldLine }
  | { kind: "state"; state: IScaffoldJobState };

interface IJob extends IScaffoldJobState {
  child: ChildProcess | null;
  listeners: Set<(event: IScaffoldEvent) => void> | null;
}

/** Nombre de lignes conservées par job (rejouées à l'abonnement). Borne la mémoire. */
const MAX_LINES = 4000;
/** Un job terminé est purgé après ce délai — sinon le registre fuit à chaque création. */
const JOB_TTL_MS = 10 * 60 * 1000;

const serviceName = "scaffold";

/**
 * Pilote la création de code (`nodefony create …`) depuis Studio, en **streamant** la
 * progression comme un terminal.
 *
 * Le moteur de scaffold (core) est PUR : il écrit des fichiers et rend la liste de ce
 * qu'il a écrit, sans rien exécuter. Ce service lui ajoute ce que l'adaptateur CLI fait
 * de son côté — `npm install`, `npm run build`, `npm run typecheck` — mais en poussant
 * chaque ligne de sortie sur un canal temps réel, pour que l'humain VOIE ce qui se passe
 * au lieu d'attendre un POST muet.
 *
 * ## Ce qui est écrit sur le disque
 *
 * `runScaffold` ne se contente pas de créer des fichiers : pour un module ou une entité,
 * il **modifie le projet** (câblage dans `index.ts`, dépendances dans `package.json`).
 * Il n'existe **aucun mode simulation** dans le moteur — d'où la confirmation exigée
 * côté front avant de lancer un job.
 *
 * ## Pourquoi c'est réservé au développement
 *
 * Un endpoint qui écrit sur le disque et lance `npm` n'a rien à faire sur un serveur de
 * production, même derrière un rôle d'administrateur. Le refus est prononcé ICI (côté
 * serveur), pas seulement en masquant l'entrée de menu.
 */
class ScaffoldService extends Service {
  /** Lazy : un Studio qui ne scaffolde jamais n'alloue pas ce registre. */
  #jobs: Map<string, IJob> | null = null;
  #seq = 0;

  constructor(public module: Module) {
    super(
      serviceName,
      module.container as Container,
      module.notificationsCenter as Event,
      module.options,
    );
  }

  /** `true` seulement en développement — la seule situation où créer du code a un sens. */
  get enabled(): boolean {
    const env = this.module.kernel?.environment;
    return env === "development" || env === "dev";
  }

  /**
   * Racine du projet (l'app qui tourne), point d'ancrage de toute écriture.
   *
   * @throws si le kernel n'est pas booté (aucune app → rien à scaffolder).
   */
  get projectRoot(): string {
    const start = this.module.kernel?.path;
    if (!start) throw new Error("kernel path unavailable");
    // `findProjectRoot` remonte jusqu'au `nodefony.config.ts` ; `null` = on ne tourne
    // pas dans un projet Nodefony (cas théorique ici, mais il ne se devine pas).
    const root = findProjectRoot(start);
    if (!root) throw new Error("aucun projet Nodefony trouvé depuis " + start);
    return root;
  }

  /** Modules existants — alimente le sélecteur « dans quel module ? » du formulaire. */
  targets(): IScaffoldTarget[] {
    return listTargets(this.projectRoot);
  }

  /**
   * Démarre un job et rend son identifiant **immédiatement** : l'écriture et les étapes
   * se déroulent en arrière-plan, le front suit par le canal `scaffold:job@<id>`.
   *
   * Le backlog est conservé : un abonné qui arrive après le début ne perd aucune ligne.
   *
   * @param type - type de scaffold (`module` / `controller` / `front` / `entity`).
   * @param answers - réponses au formulaire, validées par la spec du moteur.
   * @param steps - étapes à enchaîner après l'écriture (allowlist).
   * @returns l'identifiant du job.
   * @throws si le service est désactivé (hors développement).
   */
  start(
    type: string,
    answers: TScaffoldAnswers,
    steps: ScaffoldStep[],
  ): IScaffoldJobState {
    if (!this.enabled) {
      throw new Error("scaffold is development-only");
    }
    const job: IJob = {
      id: randomUUID(),
      type,
      status: "running",
      startedAt: Date.now(),
      endedAt: null,
      files: [],
      notes: [],
      lines: [],
      child: null,
      listeners: null,
    };
    if (this.#jobs === null) this.#jobs = new Map();
    this.#jobs.set(job.id, job);

    // Lancement différé d'un tick : le front reçoit son jobId (et s'abonne) pendant que
    // le job démarre — et de toute façon le backlog rattrape ce qu'il aurait raté.
    queueMicrotask(() => {
      // Un rejet ici (ex. racine de projet introuvable) laisserait le job « running »
      // pour toujours et le verrou du watcher posé : on le rabat sur un échec propre.
      this.#run(job, type, answers, steps).catch((e: unknown) => {
        this.#emit(job, "fail", (e as Error)?.message ?? String(e));
        this.#finish(job, "failed");
      });
    });

    return this.#snapshot(job);
  }

  /**
   * Snapshot d'un job (1ᵉʳ paint HTTP, ou reprise après un rechargement de page).
   *
   * ⚠️ Nommée `getJob` et pas `get` : `Service.get()` est le point d'accès au conteneur
   * d'injection — la surcharger couperait le DI sous nos pieds.
   */
  getJob(id: string): IScaffoldJobState | null {
    const job = this.#jobs?.get(id);
    return job ? this.#snapshot(job) : null;
  }

  /**
   * S'abonne au flux d'un job. Le **backlog est rejoué** d'abord (rien n'est perdu entre
   * le lancement et l'abonnement), puis l'**état courant** est poussé, puis les
   * événements arrivent au fil de l'eau.
   *
   * L'état est envoyé juste après le rejeu : un abonné qui arrive alors que le job est
   * DÉJÀ terminé (page rechargée après coup) reçoit ainsi tout le terminal ET son issue,
   * sans avoir à interroger le serveur.
   *
   * @returns la fonction de désabonnement (à appeler au `unsubscribe` ET à la fermeture).
   */
  subscribe(id: string, onEvent: (event: IScaffoldEvent) => void): () => void {
    const job = this.#jobs?.get(id);
    if (!job) return () => {};
    for (const line of job.lines) onEvent({ kind: "line", line });
    onEvent({ kind: "state", state: this.#snapshot(job) });
    if (job.listeners === null) job.listeners = new Set();
    job.listeners.add(onEvent);
    return () => {
      job.listeners?.delete(onEvent);
      if (job.listeners?.size === 0) job.listeners = null;
    };
  }

  /** Tue le process en cours d'un job (bouton « arrêter »). */
  cancel(id: string): boolean {
    const job = this.#jobs?.get(id);
    if (!job || job.status !== "running") return false;
    job.child?.kill("SIGTERM");
    this.#emit(job, "fail", "— interrompu —");
    this.#finish(job, "failed");
    return true;
  }

  #snapshot(job: IJob): IScaffoldJobState {
    const { child: _child, listeners: _listeners, ...state } = job;
    return { ...state, files: [...job.files], lines: [...job.lines] };
  }

  #emit(job: IJob, stream: ScaffoldStream, text: string): void {
    const line: IScaffoldLine = {
      seq: (this.#seq += 1),
      ts: Date.now(),
      stream,
      text,
    };
    job.lines.push(line);
    // Ring : on jette les plus vieilles lignes plutôt que de gonfler indéfiniment.
    if (job.lines.length > MAX_LINES) job.lines.shift();
    this.#publish(job, { kind: "line", line });
  }

  #publish(job: IJob, event: IScaffoldEvent): void {
    if (job.listeners) for (const fn of job.listeners) fn(event);
  }

  /**
   * Point de sortie UNIQUE d'un job (succès, échec, annulation).
   *
   * Le verrou du watcher se lève ICI, et nulle part ailleurs : un verrou qu'on oublie de
   * lever muselle le rechargement automatique pour toute la session — on éditerait ses
   * fichiers sans que rien ne se recharge, et sans la moindre explication.
   */
  #finish(job: IJob, status: ScaffoldJobStatus): void {
    job.status = status;
    job.endedAt = Date.now();
    job.child = null;
    try {
      resumeSupervisor(this.projectRoot);
    } catch {
      /* best-effort : de toute façon un verrou dont le process est mort est ignoré */
    }
    // L'issue du job part par la MÊME socket que les lignes : le front n'a jamais à
    // demander « alors, c'est fini ? ».
    this.#publish(job, { kind: "state", state: this.#snapshot(job) });
    // Purge différée : le front peut encore relire le job juste après la fin.
    const timer = setTimeout(() => {
      this.#jobs?.delete(job.id);
      if (this.#jobs?.size === 0) this.#jobs = null;
    }, JOB_TTL_MS);
    timer.unref();
  }

  async #run(
    job: IJob,
    type: string,
    answers: TScaffoldAnswers,
    steps: ScaffoldStep[],
  ): Promise<void> {
    const root = this.projectRoot;
    // Le scaffold écrit LÀ OÙ LE WATCHER REGARDE (`nodefony/`, `index.ts`). Sans ce
    // verrou, le superviseur dev rebuild et redémarre le serveur au milieu du job — ce
    // qui tue le `npm install` en cours (process enfant du serveur). On le muselle le
    // temps du job ; il rechargera de lui-même à la levée, module généré compris.
    suspendSupervisor(root, "génération de code", `${type} ${job.id}`);
    try {
      this.#emit(job, "info", `$ nodefony create ${type}`);
      const request: IScaffoldRequest = {
        type,
        answers,
        dir: root,
        force: false,
      };
      const version = (this.module.kernel?.version as string) ?? "0.0.0";
      const result: IScaffoldResult = runScaffold(request, version);

      job.files = result.files;
      job.notes = result.notes ?? [];
      for (const file of result.files) this.#emit(job, "ok", `créé  ${file}`);
      for (const note of job.notes) this.#emit(job, "info", note);
      this.#emit(
        job,
        "ok",
        `${result.files.length} fichier(s) écrit(s) dans ${result.dest}`,
      );
      // Les fichiers sont connus MAINTENANT — pas la peine d'attendre la fin d'un
      // `npm install` d'une minute pour que le front puisse les afficher.
      this.#publish(job, { kind: "state", state: this.#snapshot(job) });
    } catch (e) {
      // Le moteur valide AVANT d'écrire : un throw ici veut dire que rien n'a été touché.
      this.#emit(job, "fail", (e as Error).message);
      this.#finish(job, "failed");
      return;
    }

    for (const step of steps) {
      const ok = await this.#spawnStep(job, step, root);
      if (!ok) {
        this.#finish(job, "failed");
        return;
      }
    }

    if (steps.includes("build")) {
      this.#emit(
        job,
        "info",
        "Redémarre le serveur pour que le kernel charge le nouveau code.",
      );
    }
    this.#finish(job, "done");
  }

  /** Lance UNE étape de l'allowlist et streame sa sortie ligne par ligne. */
  #spawnStep(job: IJob, step: ScaffoldStep, cwd: string): Promise<boolean> {
    const args = STEP_COMMANDS[step];
    if (!args) {
      this.#emit(job, "fail", `étape inconnue: ${step}`);
      return Promise.resolve(false);
    }
    this.#emit(job, "info", `$ npm ${args.join(" ")}`);

    return new Promise<boolean>((resolve) => {
      const child = spawn("npm", [...args], {
        cwd,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      job.child = child;

      // Découpage en lignes : un chunk stdout ne s'aligne pas sur les fins de ligne.
      const pipe = (
        stream: NodeJS.ReadableStream | null,
        kind: ScaffoldStream,
      ): void => {
        let rest = "";
        stream?.on("data", (chunk: Buffer) => {
          const parts = (rest + chunk.toString("utf8")).split("\n");
          rest = parts.pop() ?? "";
          for (const part of parts) {
            if (part.trim()) this.#emit(job, kind, part);
          }
        });
        stream?.on("end", () => {
          if (rest.trim()) this.#emit(job, kind, rest);
        });
      };
      pipe(child.stdout, "out");
      pipe(child.stderr, "err");

      child.once("error", (err) => {
        this.#emit(job, "fail", `npm introuvable ou illisible: ${err.message}`);
        resolve(false);
      });
      child.once("close", (code) => {
        job.child = null;
        if (code === 0) {
          this.#emit(job, "ok", `npm ${args.join(" ")} — terminé`);
          resolve(true);
        } else {
          this.#emit(job, "fail", `npm ${args.join(" ")} — échec (code ${code})`);
          resolve(false);
        }
      });
    });
  }
}

export default ScaffoldService;
export { ScaffoldService, serviceName as scaffoldServiceName };
