/// <reference types="node" />
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  Service,
  runScaffold,
  listTargets,
  findProjectRoot,
  suspendSupervisor,
  resumeSupervisor,
  resolveScaffoldDestination,
  isSafeSubPath,
  isInsideRoot,
  ScaffoldDestinationError,
  SCAFFOLD_STEPS,
  SCAFFOLD_STEP_COMMANDS,
  type Container,
  type Event,
  type Module,
  type IScaffoldChange,
  type IScaffoldRequest,
  type IScaffoldResult,
  type IScaffoldRoot,
  type IScaffoldTarget,
  type TScaffoldAnswers,
  type TScaffoldStep,
} from "nodefony";

/**
 * Étapes exécutables APRÈS l'écriture des fichiers, et la commande npm de
 * chacune : décrites par le CORE (`nodefony/cli/scaffold/steps`), pour que le
 * CLI et Studio ne puissent pas en donner deux définitions.
 *
 * C'est une **allowlist fermée** : le client coche une étape connue, il n'envoie
 * JAMAIS une ligne de commande. Sans ça, on offrirait une exécution de code
 * arbitraire derrière une session web.
 */
export { SCAFFOLD_STEPS };
export type ScaffoldStep = TScaffoldStep;

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

/**
 * Où atterrit une application créée depuis Studio.
 *
 * - `install` — elle naît sur le disque du serveur, dans un espace de travail autorisé.
 *   C'est le cas quand Studio tourne sur SA machine (le cas courant en développement).
 * - `download` — elle est générée dans un dossier temporaire jetable, archivée, et
 *   proposée au téléchargement. Le serveur ne garde rien. C'est la voie quand Studio
 *   tourne AILLEURS : écrire sur le disque d'une autre machine ne rendrait service à
 *   personne.
 */
export type ScaffoldDelivery = "install" | "download";

/** Archive prête au téléchargement — le chemin réel reste côté serveur. */
export interface IScaffoldArchive {
  filename: string;
  bytes: number;
}

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
  /** Présente quand l'app a été archivée (mode `download`) — sans aucun chemin serveur. */
  archive: IScaffoldArchive | null;
}

/**
 * Ce qui transite sur le canal `nodefony:scaffold:job@<id>`.
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
  /**
   * Chemins INTERNES du mode `download` : l'archive à servir, et le dossier temporaire à
   * effacer. Ils ne sortent JAMAIS dans le snapshot envoyé au client — celui-ci ne
   * télécharge pas « un chemin », il télécharge « l'archive du job `id` ».
   */
  archivePath: string | null;
  tempDir: string | null;
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
 * D'où {@link ScaffoldService.preview} : la même exécution, sans le disque, qui rend le
 * plan et le diff des fichiers réécrits — le front montre ce qui va changer au lieu de
 * demander un accord à l'aveugle.
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
   * Emplacements où l'on a le droit de créer une **nouvelle application**.
   *
   * Par défaut : le dossier PARENT du projet courant — l'espace de travail où vivent
   * déjà les autres projets. C'est l'endroit naturel, et surtout un espace BORNÉ : le
   * client choisira une racine par identifiant, jamais un chemin.
   *
   * Surchargeable par la config du module (`scaffold.roots`), pour désigner un autre
   * espace de travail. Les chemins sont résolus une fois ici.
   */
  roots(): IScaffoldRoot[] {
    const configured = (
      this.options as {
        scaffold?: { roots?: { label: string; path: string }[] };
      }
    )?.scaffold?.roots;
    if (configured?.length) {
      return configured.map((r, i) => ({
        id: `root${i}`,
        label: r.label,
        path: path.resolve(r.path),
      }));
    }
    const parent = path.dirname(this.projectRoot);
    return [
      {
        id: "workspace",
        label: `Espace de travail (${path.basename(parent)})`,
        path: parent,
      },
    ];
  }

  /**
   * Liste les sous-dossiers navigables sous une racine autorisée.
   *
   * Deux gardes, et il faut les DEUX :
   *  - le sous-chemin est recomposé (aucun chemin n'arrive du client) ;
   *  - le chemin RÉEL est vérifié (`realpathSync`) — sans quoi un lien symbolique posé
   *    dans la racine ferait sortir l'exploration de l'espace autorisé, alors même que
   *    tous les segments seraient irréprochables.
   *
   * @throws {ScaffoldDestinationError} racine inconnue, sous-chemin refusé, ou évasion.
   */
  browse(rootId: string, sub: string): { sub: string; dirs: string[] } {
    const roots = this.roots();
    const root = roots.find((r) => r.id === rootId);
    if (!root) throw new ScaffoldDestinationError("emplacement inconnu");
    if (!isSafeSubPath(sub)) {
      throw new ScaffoldDestinationError("sous-dossier invalide");
    }
    const rootReal = realpathSync(root.path);
    const target = sub ? path.resolve(rootReal, sub) : rootReal;
    const targetReal = realpathSync(target);
    if (targetReal !== rootReal && !isInsideRoot(rootReal, targetReal)) {
      throw new ScaffoldDestinationError(
        "dossier hors de l'emplacement autorisé",
      );
    }
    const dirs = readdirSync(targetReal, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      // `node_modules` n'est pas un endroit où l'on crée une application.
      .filter((e) => e.name !== "node_modules")
      .map((e) => e.name)
      .sort();
    return { sub, dirs };
  }

  /**
   * Destination d'une nouvelle app — recomposée côté serveur, jamais reçue du client.
   *
   * Le contrôle sur les chemins RÉELS (liens symboliques) se fait sur le parent
   * EXISTANT le plus proche : la destination, elle, n'existe pas encore (c'est le but).
   */
  #appDestination(answers: TScaffoldAnswers): string {
    const rootId = String(answers.root ?? "");
    const sub = String(answers.subPath ?? "");
    const name = String(answers.name ?? "");
    const roots = this.roots();
    const dest = resolveScaffoldDestination(roots, rootId, sub, name);

    // Le parent existe (c'est là qu'on va écrire) → on peut le résoudre réellement.
    const parent = path.dirname(dest);
    let parentReal: string;
    try {
      parentReal = realpathSync(parent);
    } catch {
      throw new ScaffoldDestinationError(
        "le dossier d'installation n'existe pas",
      );
    }
    const root = roots.find((r) => r.id === rootId) as IScaffoldRoot;
    const rootReal = realpathSync(root.path);
    if (parentReal !== rootReal && !isInsideRoot(rootReal, parentReal)) {
      // Le cas que la validation par motif ne voit PAS : un lien symbolique dans la
      // racine qui pointe ailleurs. Les segments sont propres, le chemin réel ne l'est pas.
      throw new ScaffoldDestinationError(
        "destination hors de l'emplacement autorisé",
      );
    }
    return path.join(parentReal, path.basename(dest));
  }

  /**
   * Destination d'un scaffold — le dossier que le moteur prendra pour cible.
   *
   * Une APP naît AILLEURS : sa destination est recomposée sous une racine
   * autorisée (le client envoie un identifiant de racine et un nom, jamais un
   * chemin). Tout le reste s'écrit dans le projet courant, et `dir` sert de
   * point de départ à la remontée vers sa racine.
   *
   * Partagée par l'exécution et la simulation : prévisualiser une destination
   * qui ne serait pas celle du vrai run n'apprendrait rien.
   */
  #destination(type: string, answers: TScaffoldAnswers): string {
    if (type !== "app") return this.projectRoot;
    if (answers.delivery === "download") {
      // Mode archive : l'app naîtra dans un temporaire JETABLE, créé par le run
      // lui-même. Ici on rend le chemin nominal, sans rien créer — ce qui suffit
      // à la simulation, dont le dossier de travail n'a aucune importance.
      return path.join(tmpdir(), String(answers.name ?? "app"));
    }
    return this.#appDestination(answers);
  }

  /**
   * Ce qu'un scaffold FERAIT, sans rien écrire : fichiers créés, fichiers
   * réécrits, et l'ancien contenu de ces derniers.
   *
   * Studio demandait une confirmation à l'aveugle — « générer ? » — alors que
   * la réponse utile est « quoi, et par-dessus quoi ». Les scaffolds
   * in-project modifient de vrais fichiers de l'utilisateur (`index.ts`,
   * `package.json`, `nodefony.config.ts`) : voir le diff AVANT de valider est
   * la différence entre accepter et parier.
   *
   * La simulation traverse le MÊME moteur avec les mêmes gardes : un scaffold
   * qui serait refusé l'est aussi ici, avec son message.
   *
   * @throws si le service est désactivé, ou si le moteur refuse (message tel quel).
   */
  preview(
    type: string,
    answers: TScaffoldAnswers,
  ): { dest: string; changes: IScaffoldChange[] } {
    if (!this.enabled) {
      throw new Error("scaffold is development-only");
    }
    const request: IScaffoldRequest = {
      type,
      answers,
      dir: this.#destination(type, answers),
      force: false,
    };
    const version = (this.module.kernel?.version as string) ?? "0.0.0";
    const result = runScaffold(request, version, { dryRun: true });
    return { dest: result.dest, changes: result.changes ?? [] };
  }

  /**
   * Démarre un job et rend son identifiant **immédiatement** : l'écriture et les étapes
   * se déroulent en arrière-plan, le front suit par le canal `nodefony:scaffold:job@<id>`.
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
      archive: null,
      child: null,
      listeners: null,
      archivePath: null,
      tempDir: null,
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

  /**
   * Chemin de l'archive d'un job, pour la servir en téléchargement.
   *
   * Le client demande « l'archive du job `id` », jamais un chemin : c'est le service qui
   * détient le chemin réel, et il n'existe que pour les jobs qu'il a lui-même archivés.
   *
   * @returns le chemin absolu de l'archive, ou `null` (job inconnu, ou sans archive).
   */
  archivePathOf(id: string): string | null {
    const job = this.#jobs?.get(id);
    return job?.archivePath ?? null;
  }

  #snapshot(job: IJob): IScaffoldJobState {
    const {
      child: _child,
      listeners: _listeners,
      archivePath: _archivePath,
      tempDir: _tempDir,
      ...state
    } = job;
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
    // Purge différée : le front peut encore relire le job (et TÉLÉCHARGER son archive)
    // juste après la fin. Passé le délai, le temporaire disparaît AVEC le job — sinon
    // chaque téléchargement laisserait une application entière sur le disque du serveur.
    const timer = setTimeout(() => {
      if (job.tempDir) {
        try {
          rmSync(job.tempDir, { recursive: true, force: true });
        } catch {
          /* best-effort : c'est un dossier temporaire, l'OS finira le travail */
        }
      }
      this.#jobs?.delete(job.id);
      if (this.#jobs?.size === 0) this.#jobs = null;
    }, JOB_TTL_MS);
    timer.unref();
  }

  /**
   * Archive l'app générée pour la livrer au navigateur.
   *
   * `tar` plutôt qu'une bibliothèque npm : aucune dépendance ajoutée pour ça (règle du
   * projet), et l'outil est présent sur macOS, Linux et Windows 10+. On archive le
   * DOSSIER de l'app depuis son parent, pour que l'arborescence se décompresse dans un
   * dossier propre et non en vrac.
   *
   * @returns `true` si l'archive est prête.
   */
  #archive(job: IJob, appDir: string, name: string): Promise<boolean> {
    const parent = path.dirname(appDir);
    const folder = path.basename(appDir);
    const filename = `${name}.tar.gz`;
    const out = path.join(parent, filename);
    this.#emit(job, "info", `$ tar -czf ${filename} ${folder}`);

    return new Promise<boolean>((resolve) => {
      const child = spawn("tar", ["-czf", out, "-C", parent, folder], {
        stdio: ["ignore", "ignore", "pipe"],
      });
      job.child = child;
      let err = "";
      child.stderr?.on("data", (c: Buffer) => {
        err += c.toString("utf8");
      });
      child.once("error", (e) => {
        this.#emit(job, "fail", `tar indisponible : ${e.message}`);
        resolve(false);
      });
      child.once("close", (code) => {
        job.child = null;
        if (code !== 0) {
          this.#emit(job, "fail", `archivage impossible ${err.trim()}`);
          resolve(false);
          return;
        }
        const bytes = statSync(out).size;
        job.archivePath = out;
        job.archive = { filename, bytes };
        this.#emit(
          job,
          "ok",
          `archive prête : ${filename} (${Math.round(bytes / 1024)} Ko)`,
        );
        resolve(true);
      });
    });
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
    //
    // Une APP naît en dehors du projet courant → elle ne touche à rien de surveillé.
    // On suspend quand même : le `npm install` de la nouvelle app est un enfant de CE
    // serveur, et le voir mourir en cours de route serait tout aussi fatal.
    suspendSupervisor(root, "génération de code", `${type} ${job.id}`);
    // Dossier où tourneront les étapes npm — connu seulement après l'écriture (le moteur
    // rend sa destination réelle). Défaut prudent : le projet courant.
    let stepCwd = root;
    // Mode « je télécharge » : l'app naît dans un temporaire jetable, personne n'écrit
    // dans l'espace de travail. Réservé au type `app` (une app est AUTONOME ; un module,
    // lui, recâble le projet — l'extraire de son projet n'aurait aucun sens).
    const delivery: ScaffoldDelivery =
      type === "app" && answers.delivery === "download"
        ? "download"
        : "install";
    try {
      // Pour une app, la destination est RECOMPOSÉE sous une racine autorisée (le client
      // n'envoie jamais un chemin) ; pour tout le reste, c'est le projet courant, et
      // `dir` sert de point de départ à la remontée vers sa racine.
      let dir: string;
      if (delivery === "download") {
        job.tempDir = mkdtempSync(path.join(tmpdir(), "nodefony-app-"));
        dir = path.join(job.tempDir, String(answers.name ?? "app"));
      } else {
        dir = this.#destination(type, answers);
      }
      const label =
        type === "app"
          ? `$ nodefony create app ${answers.name}${delivery === "download" ? " (archive)" : ` (${dir})`}`
          : `$ nodefony create ${type}`;
      this.#emit(job, "info", label);
      const request: IScaffoldRequest = {
        type,
        answers,
        dir,
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
      // Les étapes npm tournent LÀ OÙ LE CODE A ÉTÉ ÉCRIT : dans la nouvelle app pour un
      // `create app` (son `package.json` est le sien), dans le projet courant sinon.
      // Se tromper de dossier installerait les dépendances de l'app… dans le projet hôte.
      stepCwd = result.dest;
    } catch (e) {
      // Le moteur valide AVANT d'écrire : un throw ici veut dire que rien n'a été touché.
      this.#emit(job, "fail", (e as Error).message);
      this.#finish(job, "failed");
      return;
    }

    if (delivery === "download") {
      // On n'installe RIEN avant d'archiver : embarquer `node_modules` ferait des
      // centaines de mégaoctets pour un code qui sera de toute façon installé à
      // l'arrivée. L'archive porte le code ; le terminal dit quoi taper ensuite.
      if (steps.length > 0) {
        this.#emit(
          job,
          "info",
          "Étapes npm ignorées : l'archive contient le code, tu l'installeras après l'avoir décompressée.",
        );
      }
      const ok = await this.#archive(
        job,
        stepCwd,
        String(answers.name ?? "app"),
      );
      if (!ok) {
        this.#finish(job, "failed");
        return;
      }
      this.#emit(
        job,
        "info",
        "Décompresse l'archive où tu veux, puis : npm install && npm run dev",
      );
      this.#finish(job, "done");
      return;
    }

    for (const step of steps) {
      const ok = await this.#spawnStep(job, step, stepCwd);
      if (!ok) {
        this.#finish(job, "failed");
        return;
      }
    }

    if (type === "app") {
      this.#emit(job, "ok", `Application prête : ${stepCwd}`);
      this.#emit(
        job,
        "info",
        steps.includes("install")
          ? "Lance-la : cd <dossier> && npm run dev"
          : "Prochaine étape : cd <dossier> && npm install && npm run dev",
      );
    } else if (steps.includes("build")) {
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
    const args = SCAFFOLD_STEP_COMMANDS[step];
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
          this.#emit(
            job,
            "fail",
            `npm ${args.join(" ")} — échec (code ${code})`,
          );
          resolve(false);
        }
      });
    });
  }
}

export default ScaffoldService;
export { ScaffoldService, serviceName as scaffoldServiceName };
