import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, type Stats } from "node:fs";
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
}

const ANSI = {
  dim: "\x1b[90m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  reset: "\x1b[0m",
};

/**
 * Superviseur de développement « auto-restart » (modèle nodemon, cloud-native :
 * le process serveur est jetable).
 *
 * Topologie : ce process **parent** ne boote PAS le kernel applicatif — il
 * `spawn` le serveur dans un process **enfant** (même commande + variable d'env
 * `NODEFONY_DEV_CHILD=1`), surveille les sources **backend** et, à chaque
 * changement, rebuild puis **redémarre l'enfant**.
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

  #child: ChildProcess | null = null;
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
    const wanted = options.paths ?? ["src", "nodefony", "config", "index.ts"];
    this.#paths = wanted.filter((p) => existsSync(path.resolve(this.#cwd, p)));
  }

  /** Écrit une ligne préfixée sur stdout (pas de `console.log` — code core). */
  #log(msg: string, color: keyof typeof ANSI = "cyan"): void {
    process.stdout.write(
      `${ANSI.dim}[dev]${ANSI.reset} ${ANSI[color]}${msg}${ANSI.reset}\n`,
    );
  }

  /** Démarre l'enfant, attache la surveillance et les signaux d'arrêt. */
  start(): void {
    this.#installSignals();
    this.#spawnChild();
    this.#startWatch();
    this.#log(
      `superviseur actif — surveille ${this.#paths.join(", ")} (frontend exclu → HMR Vite intact)`,
      "green",
    );
  }

  /** (Re)lance le serveur enfant — même commande + flag enfant. */
  #spawnChild(): void {
    this.#child = spawn(process.execPath, process.argv.slice(1), {
      cwd: this.#cwd,
      env: { ...process.env, [this.#childEnvKey]: "1" },
      stdio: "inherit",
    });
    this.#child.once("exit", (code, signal) => {
      // Sortie non sollicitée (crash) hors restart/arrêt → on le signale et on
      // reste en vie : la prochaine sauvegarde relancera (workflow nodemon).
      if (this.#stopping || signal === "SIGTERM" || signal === "SIGKILL") return;
      if (code && code !== 0) {
        this.#log(`serveur arrêté (code ${code}) — en attente d'un changement`, "red");
      }
    });
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
    this.#log(`changement : ${path.relative(this.#cwd, path.resolve(this.#cwd, file))}`);
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.#restart(), this.#debounceMs);
  }

  /** Rebuild (CIBLÉ sur les workspaces touchés) puis tue l'enfant et le relance. */
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
      this.#log("build en échec — serveur courant conservé, corrige puis sauvegarde", "red");
      return;
    }
    this.#log(`build OK (${Date.now() - t0}ms) — restart`, "green");
    await this.#killChild();
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
              (JSON.parse(readFileSync(pj, "utf8")) as { name?: string }).name ??
              null;
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

  /** Tue l'enfant proprement (SIGTERM, puis SIGKILL après 4 s) et attend l'exit. */
  #killChild(): Promise<void> {
    return new Promise((resolve) => {
      const c = this.#child;
      this.#child = null;
      if (!c || c.exitCode !== null || c.signalCode !== null) return resolve();
      const kill9 = setTimeout(() => c.kill("SIGKILL"), 4000);
      c.once("exit", () => {
        clearTimeout(kill9);
        resolve();
      });
      c.kill("SIGTERM");
    });
  }

  /** Arrêt propre du superviseur (Ctrl+C) : ferme le watcher et tue l'enfant. */
  async #shutdown(): Promise<void> {
    if (this.#stopping) return;
    this.#stopping = true;
    if (this.#timer) clearTimeout(this.#timer);
    await this.#watcher?.close();
    await this.#killChild();
    process.exit(0);
  }

  /** Branche SIGINT/SIGTERM → arrêt propre. */
  #installSignals(): void {
    process.once("SIGINT", () => void this.#shutdown());
    process.once("SIGTERM", () => void this.#shutdown());
  }
}

export default DevSupervisor;
