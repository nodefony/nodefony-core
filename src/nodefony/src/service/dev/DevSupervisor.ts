import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  type Stats,
} from "node:fs";
import net from "node:net";
import path from "node:path";
import { watch, type FSWatcher } from "chokidar";

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

/** Au-delà de cette durée de vie, un crash n'est plus considéré « rapide ». */
const FAST_CRASH_MS = 3000;
/** Nombre maximal de redémarrages auto après un crash rapide (anti-boucle). */
const MAX_SPAWN_RETRIES = 3;
/** Pause avant un redémarrage après crash rapide (laisse les ports se libérer). */
const RETRY_DELAY_MS = 1200;
/** Délai max d'attente de libération des ports avant un restart. */
const PORTS_FREE_TIMEOUT_MS = 5000;

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

  #child: ChildProcess | null = null;
  #childSpawnedAt = 0;
  #spawnRetries = 0;
  #watcher: FSWatcher | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #building = false;
  #pending = false;
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
    // defineConfig, Lot 5) : un changement déclenche un rebuild root (`rollup -c` via
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
    this.#ports = options.ports ?? this.#defaultPorts();
    // Verrou par projet, sous node_modules/.cache (déjà gitignoré, pas de
    // pollution du repo). Un seul superviseur par cwd à la fois.
    this.#pidFile = path.join(
      this.#cwd,
      "node_modules",
      ".cache",
      "nodefony",
      "dev-supervisor.pid",
    );
  }

  /** Ports par défaut : `NODEFONY_DEV_PORTS` (CSV) sinon HTTP/HTTPS Nodefony. */
  #defaultPorts(): readonly number[] {
    const env = process.env.NODEFONY_DEV_PORTS;
    if (!env) return [5151, 5152];
    const parsed = env
      .split(",")
      .map((s) => Number.parseInt(s.trim(), 10))
      .filter((n) => Number.isInteger(n) && n > 0);
    return parsed.length > 0 ? parsed : [5151, 5152];
  }

  /** Écrit une ligne préfixée sur stdout (pas de `console.log` — code core). */
  #log(msg: string, color: keyof typeof ANSI = "cyan"): void {
    process.stdout.write(
      `${ANSI.dim}[dev]${ANSI.reset} ${ANSI[color]}${msg}${ANSI.reset}\n`,
    );
  }

  /**
   * Démarre le superviseur : revendique le verrou single-instance (tue tout
   * superviseur précédent resté en vie), branche les signaux d'arrêt, attend les
   * ports libres puis lance l'enfant et la surveillance.
   */
  async start(): Promise<void> {
    await this.#claimSingleInstance();
    this.#installSignals();
    // Un ancien enfant peut encore tenir les ports le temps de mourir.
    await this.#waitPortsFree();
    this.#spawnChild();
    this.#startWatch();
    this.#log(
      `superviseur actif (pid ${process.pid}) — surveille ${this.#paths.join(", ")} (frontend exclu → HMR Vite intact)`,
      "green",
    );
  }

  /**
   * Garde **single-instance** : empêche l'empilement de superviseurs.
   *
   * Le superviseur est de type CONSOLE — il ne bind **aucun** port serveur, donc
   * rien (pas d'`EADDRINUSE`) n'empêche d'en lancer plusieurs. Lancé `detached`,
   * il survit à la fermeture du terminal. Sans ce verrou, chaque
   * `nodefony development` ajoutait un superviseur orphelin de plus, et **tous**
   * rebuildaient (turbo + rollup) au moindre changement → machine saturée.
   *
   * On lit le PID du superviseur précédent ; s'il est encore vivant **et** que
   * c'est bien un process Nodefony, on le tue (avec son groupe) avant de prendre
   * la main et d'écrire notre propre PID.
   */
  async #claimSingleInstance(): Promise<void> {
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
  }

  /**
   * Sortie **non sollicitée** de l'enfant. Crash rapide (< {@link FAST_CRASH_MS})
   * → probable port pas encore libre : retry borné après attente des ports. Crash
   * tardif ou exit propre → on attend une sauvegarde (workflow nodemon).
   */
  #onChildCrash(code: number | null, signal: NodeJS.Signals | null): void {
    const uptime = Date.now() - this.#childSpawnedAt;
    const killed = signal === "SIGTERM" || signal === "SIGKILL";
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
      `changement : ${path.relative(this.#cwd, path.resolve(this.#cwd, file))}`,
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
    this.#log(`build OK (${Date.now() - t0}ms) — restart`, "green");
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
   * dépendants via `turbo --filter=pkg...`) et l'app racine (`rollup -c`) si un
   * fichier racine a changé. Évite de rebuilder les 17 workspaces pour un seul
   * fichier (le `npm run build` complet coûtait > 80 s).
   */
  async #build(dirty: readonly string[]): Promise<boolean> {
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
      this.#log(`rebuild ${[...pkgs].join(", ")}…`, "yellow");
      if (!(await this.#run("npx", ["turbo", "run", "build", ...filters])))
        return false;
    }
    // 2. App racine (l'app dépend des workspaces → après turbo).
    if (rootTouched || pkgs.size === 0) {
      this.#log("rebuild app racine (rollup -c)…", "yellow");
      if (!(await this.#run("npx", ["rollup", "-c"]))) return false;
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
   * (= app, buildée par `rollup -c`). Résultat caché par dossier.
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
