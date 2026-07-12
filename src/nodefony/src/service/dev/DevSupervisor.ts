import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  type Stats,
} from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import readline from "node:readline";
import { watch, type FSWatcher } from "chokidar";
import { SysExit } from "../../cli/sysexits";
import {
  defaultDevPorts,
  devSupervisorPidFile,
  discoverDevProcesses,
  findRuntimeConflict,
  missingWorkspaceDists,
  probePorts,
  splitByProject,
  terminateDevProcesses,
} from "./devProcess";

/** Options du superviseur de dev. */
export interface DevSupervisorOptions {
  /** Racine du projet (cwd). */
  readonly cwd: string;
  /** Dossiers/fichiers backend surveillés (relatifs au cwd). */
  readonly paths?: readonly string[];
  /** Délai d'anti-rebond avant rebuild+restart (ms). */
  readonly debounceMs?: number;
  /** Variable d'env injectée dans l'enfant pour le distinguer du parent. */
  readonly childEnvKey?: string;
  /**
   * Ports serveur à attendre **libres** avant de relancer l'enfant (évite
   * `EADDRINUSE` au restart). Défaut : `[5151, 5152]` (HTTP/HTTPS Nodefony) ou
   * `NODEFONY_DEV_PORTS` (liste séparée par des virgules). Les ports Vite ne sont
   * pas listés : le group-kill tue les instances Vite et chacune a son propre
   * port-retry au redémarrage.
   */
  readonly ports?: readonly number[];
}

const ANSI = {
  dim: "\x1b[90m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  reset: "\x1b[0m",
};

/** Frames braille du spinner de build (mêmes que le BootReporter enfant). */
const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

/** Au-delà de cette durée de vie, un crash n'est plus considéré « rapide ». */
const FAST_CRASH_MS = 3000;
/** Nombre maximal de redémarrages auto après un crash rapide (anti-boucle). */
const MAX_SPAWN_RETRIES = 3;
/** Pause avant un redémarrage après crash rapide (laisse les ports se libérer). */
const RETRY_DELAY_MS = 1200;
/** Délai max d'attente de libération des ports avant un restart. */
const PORTS_FREE_TIMEOUT_MS = 5000;
/**
 * Délai max d'attente de l'écoute des ports après un (re)spawn avant de signaler
 * un boot qui ne vient pas. Le boot dev peut être lent (Vite + modules) → marge
 * large : on ne crie au loup que si le serveur est vraiment muet.
 */
const READY_TIMEOUT_MS = 30000;
/** Cadence de sonde « le serveur écoute-t-il ? » après un (re)spawn. */
const READY_POLL_MS = 200;
/**
 * Fenêtre de stabilisation du verdict de santé après que les ports écoutent. Les ports
 * TCP acceptent (bind OS) AVANT que le Kernel finalise `bootServers` / la fin du boot →
 * `livez.degraded` est transitoirement vrai (`healthy=false` tant qu'aucun serveur n'est
 * encore enregistré). On re-sonde jusqu'au verdict STABLE (`booted:true`) au plus ce
 * délai avant de conclure : crier « dégradé » à tort érode la confiance dans le signal
 * (anti-pattern « au loup », l'inverse du but de la sonde).
 */
const DEGRADED_SETTLE_MS = 5000;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Superviseur de développement « auto-restart » (modèle nodemon, cloud-native :
 * le process serveur est jetable).
 *
 * Topologie : ce process **parent** ne boote PAS le kernel applicatif — il
 * `spawn` le serveur dans un process **enfant** (même commande + variable d'env
 * `NODEFONY_DEV_CHILD=1`), surveille les sources **backend** et, à chaque
 * changement, rebuild puis **redémarre l'enfant**.
 *
 * L'enfant est spawné **detached** (leader de groupe de processus) : il devient
 * la tête d'un groupe qui contient ses propres enfants (les instances Vite du
 * `ViteProcessSupervisor`, spawnées `detached:false`). Le restart tue donc le
 * **groupe entier** (`process.kill(-pid, …)`) → aucun orphelin Vite ne retient
 * un port. Avant chaque relance, le superviseur attend que les ports serveur
 * soient libres (anti-`EADDRINUSE`) et retente de façon bornée si l'enfant
 * crashe immédiatement.
 *
 * Pourquoi pas de HMR backend : Node ne décharge pas un module ESM déjà importé →
 * un re-bundle du `dist/` ne rechargerait rien. Le restart de process est le seul
 * rechargement backend fiable. Le **frontend** (Vite) garde son HMR : le dossier
 * `frontend/` est exclu de la surveillance → une modif front ne redémarre pas le
 * serveur.
 */
export class DevSupervisor {
  readonly #cwd: string;
  readonly #paths: readonly string[];
  readonly #debounceMs: number;
  readonly #childEnvKey: string;
  readonly #ports: readonly number[];
  /** Fichier verrou single-instance (PID du superviseur courant). */
  readonly #pidFile: string;
  /**
   * App STANDALONE (générée par `create app`) vs monorepo du framework — signal :
   * `turbo.json` (l'orchestrateur multi-workspace n'existe que dans le repo).
   * En standalone, TOUT passage turbo serait un échec bruyant hors sujet
   * (« Could not resolve workspace », vécu dans une app générée) : le seul
   * build est celui de l'app (`rolldown -c`, le même que `npm run build`).
   */
  readonly #standalone: boolean;

  #child: ChildProcess | null = null;
  #childSpawnedAt = 0;
  #spawnRetries = 0;
  #watcher: FSWatcher | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #building = false;
  #pending = false;
  /**
   * Problèmes du build INITIAL (verdict + tail de sortie), rejoués APRÈS le
   * boot de l'enfant : le splash ASCII + les logs de boot noient le verdict
   * émis AVANT le spawn — en scrollant, le dev ne le retrouvait plus (vécu).
   * `null` = build initial sain, rien à rejouer.
   */
  #bootBuildIssues: { verdict: string; tail: string[] } | null = null;
  // Spinner de la phase de build initial (`#ensureBuilt`) — anime une ligne
  // unique sur stdout en TTY (sinon logs statiques). `null` = inactif.
  #spinTimer: ReturnType<typeof setInterval> | null = null;
  #spinFrame = 0;
  #spinLabel = "";
  #stopping = false;
  /** Fichiers modifiés depuis le dernier build (pour cibler le rebuild). */
  readonly #dirty = new Set<string>();
  /** Cache dir → nom de workspace (`null` = app racine). */
  readonly #pkgCache = new Map<string, string | null>();

  constructor(options: DevSupervisorOptions) {
    this.#cwd = options.cwd;
    this.#debounceMs = options.debounceMs ?? 250;
    this.#childEnvKey = options.childEnvKey ?? "NODEFONY_DEV_CHILD";
    // Inclut les fichiers de config racine `nodefony.config.ts` + `env.ts` (modèle
    // defineConfig, Lot 5) : un changement déclenche un rebuild root (`rolldown -c` via
    // resolveWorkspace → null) puis le restart → la config éditée est appliquée en dev.
    // `config` = dossier d'extraction optionnel (recette « grandir », cf docs/guides/configuration.md).
    const wanted = options.paths ?? [
      "src",
      "nodefony",
      "config",
      "index.ts",
      "nodefony.config.ts",
      "env.ts",
    ];
    this.#paths = wanted.filter((p) => existsSync(path.resolve(this.#cwd, p)));
    // Ports + pidfile = source de vérité PARTAGÉE avec les commandes d'introspection
    // (`nodefony status`/`stop`, cf devProcess.ts) : une divergence écrivain/lecteur
    // serait un bug (status ne verrait jamais l'instance). Définis une seule fois là-bas.
    this.#ports = options.ports ?? defaultDevPorts();
    this.#pidFile = devSupervisorPidFile(this.#cwd);
    this.#standalone = !existsSync(path.resolve(this.#cwd, "turbo.json"));
  }

  /** Écrit une ligne préfixée sur stdout (pas de `console.log` — code core). */
  #log(msg: string, color: keyof typeof ANSI = "cyan"): void {
    process.stdout.write(
      `${ANSI.dim}[dev]${ANSI.reset} ${ANSI[color]}${msg}${ANSI.reset}\n`,
    );
  }

  // ── Spinner de build (TTY) ─────────────────────────────────────────────────

  /** Démarre le spinner `[dev] ⠋ <label>…` (TTY) ou une ligne statique (non-TTY). */
  #startSpin(label: string): void {
    this.#spinLabel = label;
    if (!process.stdout.isTTY) {
      this.#log(`⚙ ${label}…`, "yellow");
      return;
    }
    this.#renderSpin();
    this.#spinTimer = setInterval(() => this.#renderSpin(), 80);
    this.#spinTimer.unref?.();
  }

  /** Réécrit la ligne du spinner avec la frame suivante (TTY animé). */
  #renderSpin(): void {
    this.#spinFrame = (this.#spinFrame + 1) % SPIN.length;
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    process.stdout.write(
      `${ANSI.dim}[dev]${ANSI.reset} ${ANSI.cyan}${SPIN[this.#spinFrame]}${ANSI.reset} ` +
        `${this.#spinLabel}${ANSI.dim}…${ANSI.reset}`,
    );
  }

  /** Fige le spinner sur `[dev] <mark> <msg>` (verdict de la phase de build). */
  #stopSpin(mark: string, msg: string, color: keyof typeof ANSI): void {
    if (this.#spinTimer) {
      clearInterval(this.#spinTimer);
      this.#spinTimer = null;
    }
    if (process.stdout.isTTY) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
    }
    process.stdout.write(
      `${ANSI.dim}[dev]${ANSI.reset} ${mark} ${ANSI[color]}${msg}${ANSI.reset}\n`,
    );
  }

  /**
   * Variante de {@link #run} qui CAPTURE la sortie au lieu de l'hériter — le
   * spinner remplace le mur de logs turbo/rolldown. La sortie n'est révélée que sur
   * ÉCHEC (le dev doit voir l'erreur de build : fail-loud).
   */
  #runCaptured(
    cmd: string,
    args: readonly string[],
  ): Promise<{ ok: boolean; output: string }> {
    return new Promise((resolve) => {
      let output = "";
      const p = spawn(cmd, args as string[], {
        cwd: this.#cwd,
        stdio: ["ignore", "pipe", "pipe"],
        shell: process.platform === "win32",
      });
      p.stdout?.on("data", (d: Buffer) => (output += d.toString()));
      p.stderr?.on("data", (d: Buffer) => (output += d.toString()));
      p.once("exit", (code) => resolve({ ok: code === 0, output }));
      p.once("error", () => resolve({ ok: false, output }));
    });
  }

  /** Déverse la sortie d'un build qui a échoué (après avoir figé le spinner). */
  #dumpBuild(output: string): void {
    const txt = output.trim();
    if (txt) process.stdout.write(`${txt}\n`);
  }

  /** Mémorise le verdict + les dernières lignes utiles pour le rejeu post-boot. */
  #rememberBuildIssues(verdict: string, outputs: readonly string[]): void {
    const tail = outputs
      .join("\n")
      .split("\n")
      .map((l) => l.trimEnd())
      .filter((l) => l.trim().length > 0)
      .slice(-15);
    this.#bootBuildIssues = { verdict, tail };
  }

  /**
   * Rejoue le verdict de build APRÈS le boot (appelé par {@link #reportReady}) —
   * le splash ASCII et les logs de boot de l'enfant ont défilé depuis : sans ce
   * rappel, un build en échec au démarrage disparaissait dans le scroll.
   */
  #replayBuildIssues(): void {
    if (!this.#bootBuildIssues) return;
    const { verdict, tail } = this.#bootBuildIssues;
    this.#bootBuildIssues = null;
    this.#log("── rappel : le BUILD de démarrage avait un problème ──", "red");
    this.#log(verdict, "red");
    for (const line of tail) process.stdout.write(`${line}\n`);
    this.#log("── fin du rappel build (corrige puis sauvegarde) ──", "red");
  }

  /**
   * Démarre le superviseur : revendique le verrou single-instance (tue tout
   * superviseur précédent resté en vie), branche les signaux d'arrêt, attend les
   * ports libres puis lance l'enfant et la surveillance.
   */
  async start(): Promise<void> {
    // Nom de process repérable (`ps`/`top`/`pgrep nodefony-dev`) — même convention
    // que le master cluster (`nodefony master [cluster Nw]`). L'enfant serveur prend
    // `nodefony-dev-server` (DevCommand). Pose APRÈS le boot CLI (qui set un title
    // générique) → ce nom gagne.
    process.title = "nodefony-dev-supervisor";
    await this.#claimSingleInstance();
    this.#installSignals();
    // Garantit un dist FRAIS avant le premier spawn (anti « vert mais cassé » :
    // booter sur un dist périmé = routes manquantes en 404 silencieux).
    await this.#ensureBuilt();
    // Un ancien enfant peut encore tenir les ports le temps de mourir.
    await this.#waitPortsFree();
    this.#spawnChild();
    this.#startWatch();
    this.#log(
      `superviseur actif (pid ${process.pid}) — recharge le backend à chaque ` +
        `modif de ${this.#paths.join(", ")} (frontend exclu → HMR Vite)`,
      "green",
    );
  }

  /**
   * Garantit un `dist/` à jour AVANT le premier `spawn` — `turbo` (cache par
   * hash de contenu) décide ce qui doit réellement être reconstruit, l'app racine
   * (`rolldown`, sans cache) n'est rebuildée que si ses sources sont plus récentes
   * que son `dist`.
   *
   * Pourquoi : `start()` spawnait l'enfant sur le `dist/` existant **sans le
   * vérifier**. Si une source avait changé hors d'une session du superviseur
   * (`git pull`, `npm run clean` partiel, build oublié), le serveur bootait sur
   * du vieux code → routes/providers manquants en **404 silencieux** (« vert mais
   * cassé »). On corrige + on **annonce** (fail-loud sur la dégradation) ; un échec
   * d'outillage ne BLOQUE pas le boot (fail-soft sur la disponibilité) mais est
   * signalé bruyamment.
   */
  async #ensureBuilt(): Promise<void> {
    if (this.#standalone) {
      return this.#ensureBuiltStandalone();
    }
    const t0 = Date.now();
    const errors: string[] = [];
    // Info que le dev veut voir : ce qui MANQUE avant le build (le label le dit).
    const missingBefore = missingWorkspaceDists(this.#cwd);
    this.#startSpin(
      missingBefore.length
        ? `Build du framework — ${missingBefore.length} dist manquant(s) : ${missingBefore.join(", ")}`
        : "Vérification du framework (turbo)",
    );

    const ws = await this.#runCaptured("npx", ["turbo", "run", "build"]);
    if (!ws.ok) errors.push(ws.output);

    let rootOk = true;
    if (this.#rootDistStale()) {
      this.#spinLabel = "Build de l'app (rolldown)";
      const root = await this.#runCaptured("npx", [
        "rolldown",
        "-c",
        "rolldown.config.ts",
      ]);
      rootOk = root.ok;
      if (!root.ok) errors.push(root.output);
    }

    // POST-CONDITION (la confiance n'exclut pas le contrôle) : `turbo run build` peut
    // renvoyer 0 en « cache hit » SANS restaurer un dist supprimé (gitignored, clean
    // partiel, checkout de branche). On vérifie sur le DISQUE que chaque workspace à
    // build a bien son dist — sinon il tombe en fail-soft au boot et cascade en
    // silence (« vert mais cassé », vécu : security absent → test → 404 OAuth).
    let missing = missingWorkspaceDists(this.#cwd);
    if (missing.length > 0) {
      this.#spinLabel = `Rebuild forcé : ${missing.join(", ")}`;
      const filters = missing.flatMap((n) => ["--filter", n]);
      const forced = await this.#runCaptured("npx", [
        "turbo",
        "run",
        "build",
        "--force",
        ...filters,
      ]);
      if (!forced.ok) errors.push(forced.output);
      missing = missingWorkspaceDists(this.#cwd);
    }

    const ms = Date.now() - t0;
    if (missing.length > 0) {
      // fail-LOUD : ces modules NE se chargeront PAS → app DÉGRADÉE. On le CRIE
      // (jamais « vert mais cassé » en silence) ; le boot continue (fail-soft dispo).
      const verdict =
        `dist TOUJOURS absent : ${missing.join(", ")} — ces modules ne se ` +
        "chargeront pas (app DÉGRADÉE). Corrige puis `npm run build`.";
      this.#stopSpin(`${ANSI.red}✗${ANSI.reset}`, verdict, "red");
      this.#rememberBuildIssues(verdict, errors);
    } else if (ws.ok && rootOk) {
      const built = missingBefore.length
        ? ` — (re)construits : ${missingBefore.join(", ")}`
        : "";
      this.#stopSpin(
        `${ANSI.green}✓${ANSI.reset}`,
        `Framework prêt${built} (${ms}ms)`,
        "green",
      );
    } else {
      const verdict =
        "build INCOMPLET — démarrage sur le dist EXISTANT (possiblement périmé)";
      this.#stopSpin(`${ANSI.yellow}⚠${ANSI.reset}`, verdict, "red");
      this.#rememberBuildIssues(verdict, errors);
    }
    // Sur ÉCHEC seulement : déverser la sortie capturée APRÈS le verdict (spinner
    // figé) → le dev voit l'erreur de build sans le mur de logs en cas de succès.
    for (const e of errors) this.#dumpBuild(e);
  }

  /**
   * Variante STANDALONE de {@link #ensureBuilt} — même contrat de résilience :
   * fail-soft sur la DISPONIBILITÉ (un dist existant démarre quand même),
   * fail-loud sur la DÉGRADATION (échec de build ANNONCÉ avec sa sortie et la
   * marche à suivre — le dev ne doit jamais rester devant un « qu'est-ce que
   * je fais ? »).
   */
  async #ensureBuiltStandalone(): Promise<void> {
    const dist = path.join(this.#cwd, "dist", "index.js");
    if (!this.#rootDistStale()) {
      this.#log("app déjà construite (dist à jour)", "green");
      return;
    }
    const t0 = Date.now();
    this.#startSpin(
      existsSync(dist)
        ? "Rebuild de l'app (rolldown)"
        : "Premier build de l'app (rolldown)",
    );
    const res = await this.#runCaptured("npx", [
      "rolldown",
      "-c",
      "rolldown.config.ts",
    ]);
    if (res.ok) {
      this.#stopSpin(
        `${ANSI.green}✓${ANSI.reset}`,
        `app construite (${Date.now() - t0}ms)`,
        "green",
      );
      return;
    }
    const verdict = existsSync(dist)
      ? "build en ÉCHEC — démarrage sur le dist EXISTANT (possiblement périmé). " +
        "Corrige l'erreur ci-dessous puis sauvegarde (rebuild automatique)."
      : "build en ÉCHEC et AUCUN dist — le serveur ne peut pas démarrer. " +
        "Corrige l'erreur ci-dessous puis sauvegarde (rebuild automatique).";
    this.#stopSpin(
      existsSync(dist)
        ? `${ANSI.yellow}⚠${ANSI.reset}`
        : `${ANSI.red}✗${ANSI.reset}`,
      verdict,
      "red",
    );
    this.#rememberBuildIssues(verdict, [res.output]);
    this.#dumpBuild(res.output);
  }

  /**
   * `true` si le `dist/index.js` racine est absent ou plus ancien qu'une de ses
   * sources — fichiers racine (`index.ts`/`nodefony.config.ts`/`env.ts`, 3 stats)
   * et, en STANDALONE, les sources de l'app (`nodefony/`, `config/`, `modules/`)
   * que turbo ne couvre pas (il n'y a pas de turbo). Une app est petite : la
   * marche récursive coûte quelques stats, une fois, au boot.
   */
  #rootDistStale(): boolean {
    const dist = path.join(this.#cwd, "dist", "index.js");
    if (!existsSync(dist)) return true;
    let distMtime: number;
    try {
      distMtime = statSync(dist).mtimeMs;
    } catch {
      return true;
    }
    const stale = ["index.ts", "nodefony.config.ts", "env.ts"].some((src) => {
      const p = path.join(this.#cwd, src);
      try {
        return existsSync(p) && statSync(p).mtimeMs > distMtime;
      } catch {
        return false;
      }
    });
    if (stale || !this.#standalone) {
      return stale;
    }
    for (const dirName of ["nodefony", "config", "modules"]) {
      const dir = path.join(this.#cwd, dirName);
      if (!existsSync(dir)) continue;
      try {
        for (const entry of readdirSync(dir, {
          withFileTypes: true,
          recursive: true,
        })) {
          if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
          const p = path.join(entry.parentPath, entry.name);
          if (statSync(p).mtimeMs > distMtime) return true;
        }
      } catch {
        // dossier illisible → ne bloque pas la détection
      }
    }
    return false;
  }

  /**
   * Garde **single-instance** : empêche l'empilement de superviseurs.
   *
   * Le superviseur est de type CONSOLE — il ne bind **aucun** port serveur, donc
   * rien (pas d'`EADDRINUSE`) n'empêche d'en lancer plusieurs. Lancé `detached`,
   * il survit à la fermeture du terminal. Sans ce verrou, chaque
   * `nodefony development` ajoutait un superviseur orphelin de plus, et **tous**
   * rebuildaient (turbo + rolldown) au moindre changement → machine saturée.
   *
   * Deux gardes complémentaires :
   *
   * 1. **Balayage `ps` (vérité terrain)** : single-instance ⇒ au démarrage AUCUN autre
   *    process dev ne doit subsister (notre enfant n'est pas encore spawné). On découvre
   *    et on tue tout résiduel — superviseur empilé MAIS aussi **orphelins** (serveur/Vite
   *    sans superviseur parent, laissés par un `kill -9` brutal que le pidfile périmé ne
   *    référence plus → cause de l'empilement). `discoverDevProcesses` s'auto-exclut, on
   *    ne se tue donc pas (notre `process.title` est déjà posé).
   * 2. **Fallback pidfile** : si `ps` est indisponible (Windows, sandbox) le balayage rend
   *    une liste vide → on retombe sur la garde historique par PID lu dans le pidfile.
   *
   * Puis on écrit notre propre PID.
   */
  async #claimSingleInstance(): Promise<void> {
    // 1. Vérité terrain (`ps`) : séparer les RÉSIDUELS DEV (jetables → kill auto) d'un
    //    runtime d'un AUTRE mode (prod/cluster) occupant les mêmes ports.
    try {
      const all = discoverDevProcesses(); // s'auto-exclut (notre pid)

      // MULTI-PROJET : plusieurs apps Nodefony sur le même poste = normal. Le
      // balayage `ps` est GLOBAL — sans scoping par cwd, l'app 2 « nettoyait »
      // le runtime de l'app 1 (destructeur). Règle : on ne touche JAMAIS un
      // process d'un autre dossier ; seule la collision de PORTS le concerne.
      const conflict = findRuntimeConflict(all, "dev");
      const conflictHere = splitByProject(conflict, this.#cwd);

      // 1a. Conflit cross-mode de CE projet → REFUS fail-loud. On ne tue JAMAIS
      //     un prod/cluster automatiquement (il est intentionnel — bench, démo).
      if (conflictHere.mine.length > 0) {
        const first = conflictHere.mine[0];
        const otherMode = first.mode === "cluster" ? "cluster" : "production";
        const pids = conflictHere.mine.map((p) => p.pid).join(", ");
        this.#log(
          `⛔ un runtime Nodefony ${otherMode} de CE projet tourne déjà (pid ${pids}) ` +
            `sur les ports ${this.#ports.join("/")} — le mode dev ne peut pas démarrer par-dessus`,
          "red",
        );
        this.#log("arrête-le d'abord : `nodefony stop`", "red");
        process.exit(SysExit.UNAVAILABLE);
      }
      // 1a-bis. Runtime d'un AUTRE projet : non touché. S'il tient NOS ports, on
      //     refuse en NOMMANT l'occupant (le dev sait immédiatement quoi faire :
      //     l'arrêter depuis SON dossier, ou changer les ports de cette app) —
      //     jamais d'attente muette ni de kill trans-projet.
      const others = [
        ...conflictHere.foreign,
        ...splitByProject(
          all.filter((p) => p.mode === "dev"),
          this.#cwd,
        ).foreign,
      ];
      if (others.length > 0) {
        const busy = await probePorts(this.#ports);
        const taken = busy.filter((p) => p.listening).map((p) => p.port);
        const who = others
          .map((p) => `pid ${p.pid} (${p.cwd ?? "dossier inconnu"})`)
          .join(", ");
        if (taken.length > 0) {
          this.#log(
            `⛔ ports ${taken.join(", ")} occupés par un AUTRE projet Nodefony : ${who}`,
            "red",
          );
          this.#log(
            "arrête-le depuis SON dossier (`nodefony stop`) ou change les ports " +
              "de cette app (nodefony.config.ts + NODEFONY_DEV_PORTS)",
            "red",
          );
          process.exit(SysExit.UNAVAILABLE);
        }
        this.#log(
          `${others.length} runtime(s) Nodefony d'un autre projet détecté(s) (${who}) — non touchés`,
          "yellow",
        );
      }

      // 1b. Résiduels DEV de CE projet (empilés OU orphelins) → nettoyage auto.
      const stale = splitByProject(
        all.filter((p) => p.mode === "dev"),
        this.#cwd,
      ).mine;
      if (stale.length > 0) {
        this.#log(
          `${stale.length} process dev résiduel(s) de ce projet — nettoyage avant démarrage`,
          "yellow",
        );
        const survivors = await terminateDevProcesses(stale, {
          termWaitMs: 1500,
        });
        if (survivors.length > 0)
          this.#log(
            `⚠ ${survivors.length} process résiduel(s) survivent (pid ${survivors.join(", ")}) — ` +
              "lance `nodefony stop` si le démarrage échoue",
            "red",
          );
      }
    } catch {
      /* best-effort : le fallback pidfile + l'attente des ports prennent le relais */
    }

    // 2. Fallback pidfile (ps indisponible → liste vide ci-dessus).
    try {
      if (existsSync(this.#pidFile)) {
        const prev = Number.parseInt(
          readFileSync(this.#pidFile, "utf8").trim(),
          10,
        );
        if (
          Number.isInteger(prev) &&
          prev > 0 &&
          prev !== process.pid &&
          this.#isNodefonySupervisor(prev)
        ) {
          this.#log(
            `superviseur précédent encore actif (pid ${prev}) — arrêt avant démarrage`,
            "yellow",
          );
          await this.#killSupervisor(prev);
        }
      }
    } catch {
      /* pidfile illisible / périmé → on l'écrase */
    }
    try {
      mkdirSync(path.dirname(this.#pidFile), { recursive: true });
      writeFileSync(this.#pidFile, String(process.pid), "utf8");
    } catch {
      /* best-effort : pas de verrou possible, on démarre quand même */
    }
  }

  /**
   * `true` si `pid` est vivant ET correspond à un process Nodefony — évite de
   * tuer un PID recyclé par un process tiers. POSIX : vérifié via `ps`. Windows :
   * pas de `ps` fiable → best-effort (vivant suffit).
   */
  #isNodefonySupervisor(pid: number): boolean {
    try {
      process.kill(pid, 0); // throw si le process n'existe plus
    } catch {
      return false;
    }
    if (process.platform === "win32") return true;
    try {
      const out = spawnSync("ps", ["-p", String(pid), "-o", "command="], {
        encoding: "utf8",
      });
      return (out.stdout ?? "").toLowerCase().includes("nodefony");
    } catch {
      return true; // ps indisponible → on ne bloque pas le nettoyage
    }
  }

  /**
   * Tue le superviseur précédent et **son groupe** (enfant serveur + Vite) :
   * SIGTERM (arrêt propre), puis SIGKILL si toujours vivant après 1,5 s.
   */
  async #killSupervisor(pid: number): Promise<void> {
    const groupKill = (signal: NodeJS.Signals): void => {
      try {
        if (process.platform !== "win32") process.kill(-pid, signal);
      } catch {
        /* pas leader de groupe / groupe disparu */
      }
      try {
        process.kill(pid, signal);
      } catch {
        /* déjà mort */
      }
    };
    groupKill("SIGTERM");
    const deadline = Date.now() + 1500;
    while (Date.now() < deadline) {
      await delay(100);
      try {
        process.kill(pid, 0);
      } catch {
        return; // mort proprement
      }
    }
    groupKill("SIGKILL");
    await delay(200);
  }

  /** (Re)lance le serveur enfant — même commande + flag enfant, en leader de groupe. */
  #spawnChild(): void {
    this.#childSpawnedAt = Date.now();
    const child = spawn(process.execPath, process.argv.slice(1), {
      cwd: this.#cwd,
      env: { ...process.env, [this.#childEnvKey]: "1" },
      stdio: "inherit",
      // Leader de groupe (POSIX) → kill du groupe entier (Vite inclus) au restart.
      // Windows n'a pas de groupes POSIX → kill direct de l'enfant (fallback).
      detached: process.platform !== "win32",
    });
    this.#child = child;
    child.once("exit", (code, signal) => {
      // Restart sollicité : `#killChild` a déjà mis `#child` à null avant l'exit.
      if (this.#child !== child) return;
      this.#child = null;
      if (this.#stopping) return;
      this.#onChildCrash(code, signal);
    });
    // Confirme « framework ready » par OBSERVATION EXTERNE (sonde de ports), JAMAIS
    // par IPC (choix acté : le superviseur n'a aucun canal vers l'enfant — il
    // l'observe via le code de sortie + l'écoute des ports). Non bloquant.
    void this.#reportReady(child);
  }

  /**
   * Signale « serveur prêt » dès que les ports écoutent — et, surtout, détecte un
   * boot qui **ne vient jamais** (enfant vivant mais muet : import qui pend, hook
   * lifecycle bloqué) en émettant un avertissement après {@link READY_TIMEOUT_MS}.
   *
   * 100 % OBSERVATION EXTERNE (sonde TCP loopback, cf {@link #isPortFree}) — aucun
   * IPC avec l'enfant (choix d'architecture). La sonde s'efface dès qu'un restart
   * remplace l'enfant ({@link #child} change) ou que le superviseur s'arrête.
   */
  async #reportReady(child: ChildProcess): Promise<void> {
    const t0 = Date.now();
    const deadline = t0 + READY_TIMEOUT_MS;
    for (;;) {
      if (this.#child !== child || this.#stopping) return; // restart/stop → abandon
      if (await this.#anyPortListening()) {
        // Ports à l'écoute ≠ boot SAIN : un module peut être tombé en fail-soft
        // (cascade silencieuse « vert mais cassé »). On interroge `livez` (HTTP
        // loopback, observation externe) pour le dire HAUT (fail-loud DX). MAIS les
        // ports TCP acceptent avant la fin du boot → on attend le verdict STABLE
        // (`booted:true`, `#probeDegraded` renvoie null tant qu'il est en cours) par
        // re-sonde brève, pour ne pas crier « dégradé » sur la race port-up/boot.
        let degraded: boolean | null = null;
        const settleDeadline = Date.now() + DEGRADED_SETTLE_MS;
        for (;;) {
          if (this.#child !== child || this.#stopping) return;
          degraded = await this.#probeDegraded();
          if (degraded !== null || Date.now() >= settleDeadline) break;
          await delay(READY_POLL_MS);
        }
        if (degraded === true) {
          this.#log(
            `✓ ports à l'écoute en ${Date.now() - t0}ms — ⚠ MAIS boot DÉGRADÉ ` +
              "(modules ignorés) : lance `nodefony status` / vois les logs ci-dessus",
            "yellow",
          );
        } else {
          this.#log(
            `✓ serveur prêt en ${Date.now() - t0}ms — framework ready`,
            "green",
          );
        }
        // Verdict de build rejoué APRÈS le boot : le splash + les logs de
        // l'enfant ont défilé — sans rappel, l'erreur se perdait dans le scroll.
        this.#replayBuildIssues();
        return;
      }
      if (Date.now() >= deadline) {
        if (this.#child === child && !this.#stopping) {
          this.#log(
            `⚠ serveur toujours pas à l'écoute après ${Math.round(READY_TIMEOUT_MS / 1000)}s ` +
              `(ports ${this.#ports.join(", ")}) — boot bloqué ? voir les logs ci-dessus`,
            "yellow",
          );
          this.#replayBuildIssues();
        }
        return;
      }
      await delay(READY_POLL_MS);
    }
  }

  /**
   * `true` si AU MOINS UN port surveillé accepte une connexion. « Au moins un »
   * et pas « tous » : la liste est une CONVENTION du superviseur (5151/5152),
   * pas la topologie réelle — une app `https: false` n'ouvre JAMAIS 5152 et un
   * « tous » criait « boot bloqué ? » à 30 s sur un serveur qui répondait très
   * bien (même règle que la readiness de `launchDetached`, vécu 2×).
   */
  async #anyPortListening(): Promise<boolean> {
    if (this.#ports.length === 0) return true;
    const states = await Promise.all(
      this.#ports.map((p) => this.#isPortFree(p)),
    );
    return states.some((free) => !free);
  }

  /**
   * Interroge `/nodefony/kernel/api/livez` (HTTP loopback, OBSERVATION EXTERNE — pas
   * d'IPC) pour savoir si le boot est DÉGRADÉ (champ `degraded` : modules ignorés en
   * fail-soft ou serveur attendu absent). Renvoie `null` = INCONCLUSIF dans deux cas :
   * (a) boot pas encore terminé (`booted:false` — `degraded` y est transitoire, race
   * port-up/boot) ; (b) tout échec best-effort (timeout, port HTTPS seul, JSON
   * inattendu). Sur `null`, l'appelant re-sonde puis affiche le « prêt » normal. C'est
   * ce qui rend le « vert mais cassé » VISIBLE au boot dev SANS fausse alarme.
   */
  #probeDegraded(): Promise<boolean | null> {
    const port = this.#ports[0];
    if (!port) return Promise.resolve(null);
    return new Promise((resolve) => {
      const req = http.get(
        {
          host: "127.0.0.1",
          port,
          path: "/nodefony/kernel/api/livez",
          timeout: 1500,
        },
        (res) => {
          let data = "";
          res.setEncoding("utf8");
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            try {
              const j = JSON.parse(data) as {
                booted?: boolean;
                degraded?: boolean;
              };
              // Verdict INCONCLUSIF tant que le boot n'est pas terminé (`booted:false`) :
              // `degraded` est alors transitoire (race port-up/boot). null → re-sonde.
              resolve(j.booted ? Boolean(j.degraded) : null);
            } catch {
              resolve(null);
            }
          });
        },
      );
      req.once("error", () => resolve(null));
      req.once("timeout", () => {
        req.destroy();
        resolve(null);
      });
    });
  }

  /**
   * Sortie **non sollicitée** de l'enfant. Crash rapide (< {@link FAST_CRASH_MS})
   * → probable port pas encore libre : retry borné après attente des ports. Crash
   * tardif ou exit propre → on attend une sauvegarde (workflow nodemon).
   */
  #onChildCrash(code: number | null, signal: NodeJS.Signals | null): void {
    const uptime = Date.now() - this.#childSpawnedAt;
    const killed = signal === "SIGTERM" || signal === "SIGKILL";
    // Boot raté SÉMANTIQUE (canal = code de sortie, pas d'IPC) : le Kernel enfant
    // s'est arrêté « sans jamais démarrer » — soit aucun serveur en écoute
    // (EX_UNAVAILABLE, garde-fou 0-serveur), soit config invalide (EX_CONFIG).
    // Ce n'est NI un crash runtime à retry, NI un arrêt propre : message honnête
    // + on attend une correction (le watch relancera à la prochaine sauvegarde).
    // Le « pourquoi » détaillé a déjà été imprimé par l'enfant (stdout hérité).
    if (!killed && (code === SysExit.UNAVAILABLE || code === SysExit.CONFIG)) {
      const why =
        code === SysExit.CONFIG
          ? "configuration invalide"
          : "aucun serveur démarré";
      this.#log(
        `le serveur ne démarre pas (${why}, code ${code}) — ` +
          `corrige puis sauvegarde (voir le diagnostic ci-dessus)`,
        "red",
      );
      this.#spawnRetries = 0;
      return;
    }
    if (killed || !code) {
      this.#log(
        `serveur arrêté (${signal ?? `code ${code}`}) — en attente d'un changement`,
        "yellow",
      );
      this.#spawnRetries = 0;
      return;
    }
    if (uptime > FAST_CRASH_MS) {
      this.#log(
        `serveur arrêté (code ${code}) — en attente d'un changement`,
        "red",
      );
      this.#spawnRetries = 0;
      return;
    }
    if (this.#spawnRetries >= MAX_SPAWN_RETRIES) {
      this.#log(
        `crash rapide ×${this.#spawnRetries} — abandon ; corrige puis sauvegarde`,
        "red",
      );
      this.#spawnRetries = 0;
      return;
    }
    this.#spawnRetries += 1;
    this.#log(
      `crash rapide (${uptime}ms) — retry ${this.#spawnRetries}/${MAX_SPAWN_RETRIES}`,
      "yellow",
    );
    void this.#respawnAfterPorts();
  }

  /** Attend les ports libres puis relance (sauf arrêt en cours). */
  async #respawnAfterPorts(): Promise<void> {
    await delay(RETRY_DELAY_MS);
    if (this.#stopping) return;
    await this.#waitPortsFree();
    if (this.#stopping) return;
    this.#spawnChild();
  }

  /** Surveillance chokidar des sources backend (frontend/dist/tests exclus). */
  #startWatch(): void {
    this.#watcher = watch(this.#paths as string[], {
      cwd: this.#cwd,
      ignoreInitial: true,
      ignored: (p: string, stats?: Stats) => {
        if (
          /(^|[/\\])(node_modules|dist|\.git|frontend|tests)([/\\]|$)/.test(p)
        )
          return true;
        if (/\.(test|spec)\.ts$/.test(p)) return true;
        if (stats?.isFile() && !p.endsWith(".ts")) return true;
        return false;
      },
    });
    this.#watcher.on("all", (_event, file: string) => {
      if (!file.endsWith(".ts")) return;
      this.#dirty.add(file);
      this.#scheduleRestart(file);
    });
  }

  /** Anti-rebond : regroupe plusieurs sauvegardes rapprochées en un restart. */
  #scheduleRestart(file: string): void {
    this.#log(
      `↻ changement : ${path.relative(this.#cwd, path.resolve(this.#cwd, file))}`,
    );
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.#restart(), this.#debounceMs);
  }

  /** Rebuild (CIBLÉ sur les workspaces touchés) puis tue le groupe et relance. */
  async #restart(): Promise<void> {
    if (this.#stopping) return;
    if (this.#building) {
      this.#pending = true; // une autre modif est arrivée pendant le build
      return;
    }
    const dirty = [...this.#dirty];
    this.#dirty.clear();
    this.#building = true;
    const t0 = Date.now();
    const ok = await this.#build(dirty);
    this.#building = false;
    if (!ok) {
      this.#log(
        "build en échec — serveur courant conservé, corrige puis sauvegarde",
        "red",
      );
      return;
    }
    this.#log(
      `✓ build OK (${Date.now() - t0}ms) — rechargement backend…`,
      "green",
    );
    await this.#killChild();
    await this.#waitPortsFree();
    this.#spawnRetries = 0;
    this.#spawnChild();
    if (this.#pending) {
      this.#pending = false;
      this.#scheduleRestart("(modifs en attente)");
    }
  }

  /**
   * Rebuild **ciblé** : ne reconstruit que les workspaces touchés (+ leurs
   * dépendants via `turbo --filter=pkg...`) et l'app racine (`rolldown -c`) si un
   * fichier racine a changé. Évite de rebuilder les 17 workspaces pour un seul
   * fichier (le `npm run build` complet coûtait > 80 s).
   */
  async #build(dirty: readonly string[]): Promise<boolean> {
    // Standalone : UN build, celui de l'app — jamais turbo (pas de workspaces).
    // Un module local (`modules/<x>` avec son package.json) rentre aussi ici :
    // son build relève du rolldown de l'app, pas d'un orchestrateur absent.
    if (this.#standalone) {
      this.#log("rebuild app (rolldown -c)…", "yellow");
      return this.#run("npx", ["rolldown", "-c", "rolldown.config.ts"]);
    }
    const pkgs = new Set<string>();
    let rootTouched = false;
    for (const f of dirty) {
      const name = this.#resolvePackage(f);
      if (name === null) rootTouched = true;
      else pkgs.add(name);
    }

    // 1. Workspaces (turbo, avec dépendants). Cache turbo → no-op si inchangé.
    if (pkgs.size > 0) {
      const filters = [...pkgs].flatMap((p) => ["--filter", `${p}...`]);
      this.#log(`⚙ rebuild ${[...pkgs].join(", ")}…`, "yellow");
      if (!(await this.#run("npx", ["turbo", "run", "build", ...filters])))
        return false;
    }
    // 2. App racine (l'app dépend des workspaces → après turbo).
    if (rootTouched || pkgs.size === 0) {
      this.#log("rebuild app racine (rolldown -c)…", "yellow");
      if (!(await this.#run("npx", ["rolldown", "-c", "rolldown.config.ts"])))
        return false;
    }
    return true;
  }

  /** Spawn une commande de build, résout `true` si code de sortie 0. */
  #run(cmd: string, args: readonly string[]): Promise<boolean> {
    return new Promise((resolve) => {
      const p = spawn(cmd, args as string[], {
        cwd: this.#cwd,
        stdio: "inherit",
        shell: process.platform === "win32",
      });
      p.once("exit", (code) => resolve(code === 0));
      p.once("error", () => resolve(false));
    });
  }

  /**
   * Remonte de `file` jusqu'au `package.json` le plus proche et renvoie son
   * `name` (workspace turbo), ou `null` si c'est le `package.json` racine
   * (= app, buildée par `rolldown -c`). Résultat caché par dossier.
   */
  #resolvePackage(file: string): string | null {
    const root = path.resolve(this.#cwd);
    let dir = path.dirname(path.resolve(this.#cwd, file));
    for (;;) {
      const cached = this.#pkgCache.get(dir);
      if (cached !== undefined) return cached;
      const pj = path.join(dir, "package.json");
      if (existsSync(pj)) {
        let name: string | null = null;
        if (dir !== root) {
          try {
            name =
              (JSON.parse(readFileSync(pj, "utf8")) as { name?: string })
                .name ?? null;
          } catch {
            name = null;
          }
        }
        this.#pkgCache.set(dir, name);
        return name;
      }
      if (dir === root) return null;
      const parent = path.dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  }

  /**
   * Envoie un signal au **groupe** de l'enfant (POSIX, pid négatif) — tue Vite et
   * tout descendant. Fallback `child.kill` sur Windows / pid indisponible.
   */
  #signalGroup(c: ChildProcess, signal: NodeJS.Signals): void {
    try {
      if (process.platform === "win32" || typeof c.pid !== "number") {
        c.kill(signal);
      } else {
        process.kill(-c.pid, signal);
      }
    } catch {
      /* déjà mort / groupe disparu */
    }
  }

  /** Tue le groupe de l'enfant (SIGTERM, puis SIGKILL après 4 s) et attend l'exit. */
  #killChild(): Promise<void> {
    return new Promise((resolve) => {
      const c = this.#child;
      this.#child = null; // marque le restart sollicité avant l'exit
      if (!c || c.exitCode !== null || c.signalCode !== null) return resolve();
      const kill9 = setTimeout(() => this.#signalGroup(c, "SIGKILL"), 4000);
      c.once("exit", () => {
        clearTimeout(kill9);
        resolve();
      });
      this.#signalGroup(c, "SIGTERM");
    });
  }

  /** `true` si rien n'écoute sur `port` en loopback (connexion refusée). */
  #isPortFree(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.connect({ host: "127.0.0.1", port });
      const settle = (free: boolean): void => {
        socket.removeAllListeners();
        socket.destroy();
        resolve(free);
      };
      socket.once("connect", () => settle(false)); // quelqu'un écoute → occupé
      socket.once("error", () => settle(true)); // refusé/injoignable → libre
      socket.setTimeout(400, () => settle(true));
    });
  }

  /** Attend que tous les ports surveillés soient libres (ou expire). */
  async #waitPortsFree(timeoutMs = PORTS_FREE_TIMEOUT_MS): Promise<void> {
    if (this.#ports.length === 0) return;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const states = await Promise.all(
        this.#ports.map((p) => this.#isPortFree(p)),
      );
      if (states.every(Boolean)) return;
      if (Date.now() >= deadline) {
        const busy = this.#ports.filter((_, i) => !states[i]);
        this.#log(
          `ports encore occupés après ${timeoutMs}ms : ${busy.join(", ")} — relance quand même`,
          "yellow",
        );
        return;
      }
      await delay(120);
    }
  }

  /** Arrête le superviseur : ferme le watcher, tue le groupe, libère le verrou. */
  async #shutdown(): Promise<void> {
    if (this.#stopping) return;
    this.#stopping = true;
    if (this.#timer) clearTimeout(this.#timer);
    await this.#watcher?.close();
    await this.#killChild();
    this.#releaseLock();
    process.exit(0);
  }

  /** Supprime le pidfile s'il nous appartient encore (idempotent, best-effort). */
  #releaseLock(): void {
    try {
      if (
        existsSync(this.#pidFile) &&
        readFileSync(this.#pidFile, "utf8").trim() === String(process.pid)
      ) {
        rmSync(this.#pidFile, { force: true });
      }
    } catch {
      /* best-effort */
    }
  }

  /**
   * Branche les signaux d'arrêt → arrêt propre.
   *
   * `SIGHUP` est **essentiel** : c'est le signal reçu quand le terminal se ferme.
   * Sans lui, un superviseur lancé `detached` survivait indéfiniment (orphelin
   * PPID 1 qui rebuild en boucle). Le handler `exit` libère le verrou en dernier
   * recours (kill non interceptable, ou sortie inattendue).
   */
  #installSignals(): void {
    process.once("SIGINT", () => void this.#shutdown());
    process.once("SIGTERM", () => void this.#shutdown());
    process.once("SIGHUP", () => void this.#shutdown());
    process.once("exit", () => this.#releaseLock());
  }
}

export default DevSupervisor;
