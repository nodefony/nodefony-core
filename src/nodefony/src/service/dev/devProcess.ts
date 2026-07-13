import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import path from "node:path";

/**
 * Helpers d'INTROSPECTION des process de développement Nodefony — source de vérité
 * PARTAGÉE entre le superviseur (`DevSupervisor`, écrivain du pidfile) et les
 * commandes de diagnostic (`nodefony status`, `nodefony stop`, lecteurs).
 *
 * 100 % OBSERVATION EXTERNE : pidfile + `ps` + sonde TCP, AUCUN IPC superviseur↔enfant
 * (choix d'architecture). Toute valeur dont la divergence écrivain/lecteur serait un
 * bug (chemin du pidfile, ports surveillés) vit ICI et n'est dupliquée nulle part.
 */

/** Titre de process du superviseur de dev (posé par {@link DevSupervisor.start}). */
export const DEV_SUPERVISOR_TITLE = "nodefony-dev-supervisor";
/** Titre de process du serveur enfant supervisé (posé par `DevCommand` à `onReady`). */
export const DEV_SERVER_TITLE = "nodefony-dev-server";
/** Préfixe de titre des process Vite (`ViteProcessSupervisor`, via `argv0`). */
export const DEV_VITE_PREFIX = "nodefony-vite";
/**
 * Titre du serveur prod **mono-process** (`production` ou `cluster` avec `workers:1`,
 * posé par `Prod`/`ClusterCommand.generate`). Espace (≠ tiret de `nodefony-dev-server`)
 * → aucune collision de `String.includes` entre les deux.
 */
export const PROD_SERVER_TITLE = "nodefony server";
/** Préfixe du titre du master cluster (posé par `startClusterMaster`, ex. `nodefony master [cluster 6w]`). */
export const CLUSTER_MASTER_PREFIX = "nodefony master";
/** Préfixe du titre d'un worker cluster (posé par `Prod`/`ClusterCommand.generate`, ex. `nodefony worker 3 [cluster]`). */
export const CLUSTER_WORKER_PREFIX = "nodefony worker";

/**
 * Mode de runtime d'un process Nodefony — la « molette front » (cf modèle 2 molettes).
 * `dev` = superviseur + serveur + Vite (HMR) ; `prod` = serveur mono-process foreground
 * (1 pod) ; `cluster` = master superviseur + N workers. Distingue un `nodefony server`
 * (prod) d'un `nodefony-dev-server` (dev) là où le seul `role` ne suffit pas.
 */
export type RuntimeMode = "dev" | "prod" | "cluster";

/**
 * Rôle d'un process dans la topologie runtime Nodefony (dev OU prod OU cluster).
 * `supervisor`/`master` = superviseurs (0 HTTP) ; `server`/`worker` = servent le HTTP ;
 * `vite` = enfant dev (bundler).
 */
export type DevProcessRole =
  "supervisor" | "server" | "vite" | "master" | "worker";

/** Rôles « principaux » (tiennent les ports ou supervisent) — Vite exclu (enfant jetable). */
const PRIMARY_ROLES: ReadonlySet<DevProcessRole> = new Set<DevProcessRole>([
  "supervisor",
  "server",
  "master",
  "worker",
]);

/** Process runtime Nodefony vivant observé via `ps` (sans IPC) — dev, prod ou cluster. */
export interface DevProcessInfo {
  readonly pid: number;
  /** PID du parent (relie l'enfant au superviseur/master, Vite à l'enfant). */
  readonly ppid: number;
  /** Mode runtime du process (dev/prod/cluster) — distingue prod-server de dev-server. */
  readonly mode: RuntimeMode;
  readonly role: DevProcessRole;
  /** Étiquette courte de colonne (`supervisor`, `server`, `vite`). */
  readonly label: string;
  /** Détail optionnel hors colonne (bundles d'une instance Vite : `react+vue`). */
  readonly detail?: string;
  /** Mémoire résidente en kilo-octets (champ `rss` de `ps`). */
  readonly rssKb: number;
  /** Pourcentage CPU instantané (champ `pcpu` de `ps`). */
  readonly cpu: number;
  /** Durée de vie en secondes (champ `etime` de `ps`, normalisé). */
  readonly uptimeSec: number;
}

/** État de sonde d'un port serveur. */
export interface PortState {
  readonly port: number;
  /** `true` si un service accepte une connexion loopback sur ce port. */
  readonly listening: boolean;
}

/**
 * Chemin du pidfile single-instance du superviseur dev — **source UNIQUE** lue par
 * `status`/`stop` et écrite par le superviseur (divergence = bug : le lecteur ne
 * verrait jamais l'instance). Sous `node_modules/.cache` (déjà gitignoré).
 */
export function devSupervisorPidFile(cwd: string): string {
  return path.join(
    cwd,
    "node_modules",
    ".cache",
    "nodefony",
    "dev-supervisor.pid",
  );
}

/** Ports Nodefony historiques — le point de départ, pas une vérité. */
export const FALLBACK_DEV_PORTS: readonly number[] = [5151, 5152];

/**
 * Chemin du **state file runtime** — le canal par lequel le serveur DIT sur quels
 * ports il écoute VRAIMENT.
 *
 * Il existe parce que le port n'est plus une convention : avec
 * `servers.portPolicy: "auto"`, un port occupé fait glisser l'écoute (5151 → 5153).
 * `status`, `stop` et la readiness `--detach` sondaient `[5151, 5152]` **en dur** —
 * ils deviendraient aveugles à la première app décalée. Le serveur écrit donc ses
 * ports effectifs ici, et les lecteurs les prennent à la source.
 *
 * À côté du pidfile, même dossier déjà gitignoré.
 */
export function runtimeStateFile(cwd: string): string {
  return path.join(cwd, "node_modules", ".cache", "nodefony", "runtime.json");
}

/** Ce que le serveur publie sur lui-même une fois ses serveurs en écoute. */
export interface RuntimeState {
  /** PID du process qui écoute. */
  pid: number;
  /** Ports EFFECTIFS (après résolution d'un éventuel conflit). */
  ports: number[];
  /** Ports DÉSIRÉS (config) — diffèrent des effectifs si `auto` a dû décaler. */
  desiredPorts?: number[];
  /** Horodatage d'écriture (`Date.now()`). */
  ts: number;
}

/**
 * Publie les ports EFFECTIFS du runtime. Best-effort : un échec d'écriture ne doit
 * jamais faire tomber un serveur qui, lui, écoute très bien (les lecteurs
 * retomberont sur les ports par défaut).
 */
export function writeRuntimeState(
  cwd: string,
  state: Omit<RuntimeState, "ts">,
): void {
  try {
    const file = runtimeStateFile(cwd);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ ...state, ts: Date.now() }), "utf8");
  } catch {
    /* best-effort — cf TSDoc */
  }
}

/**
 * Lit les ports publiés par le runtime, ou `null`.
 *
 * **Un state file dont le process est MORT est ignoré** (et purgé) : sinon un
 * `status` lirait les ports d'un serveur d'hier et sonderait dans le vide.
 */
export function readRuntimeState(cwd: string): RuntimeState | null {
  try {
    const file = runtimeStateFile(cwd);
    if (!existsSync(file)) return null;
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<RuntimeState>;
    const pid = typeof raw.pid === "number" ? raw.pid : 0;
    const ports = Array.isArray(raw.ports)
      ? raw.ports.filter((n) => Number.isInteger(n) && n > 0)
      : [];
    if (ports.length === 0) return null;
    if (pid > 0 && !isPidAlive(pid)) {
      clearRuntimeState(cwd); // reliquat d'un run mort — ne jamais s'y fier
      return null;
    }
    return {
      pid,
      ports,
      desiredPorts: Array.isArray(raw.desiredPorts)
        ? raw.desiredPorts
        : undefined,
      ts: typeof raw.ts === "number" ? raw.ts : 0,
    };
  } catch {
    return null;
  }
}

/** Retire le state file (arrêt propre, ou reliquat d'un process mort). */
export function clearRuntimeState(cwd: string): void {
  try {
    rmSync(runtimeStateFile(cwd), { force: true });
  } catch {
    /* best-effort */
  }
}

/**
 * Ports serveur à SONDER (`status`, `stop`, readiness, attente de libération).
 *
 * Ordre de vérité, du plus fiable au moins fiable :
 *  1. `NODEFONY_DEV_PORTS` — override explicite de l'opérateur, il gagne toujours ;
 *  2. le **state file runtime** — ce que le serveur écoute VRAIMENT (seule source
 *     exacte quand `portPolicy: "auto"` a décalé l'écoute) ;
 *  3. `[5151, 5152]` — la convention historique, quand rien ne tourne encore
 *     (cas du tout premier boot : personne n'a pu publier quoi que ce soit).
 *
 * @param cwd - racine du projet (le state file est par projet).
 */
export function defaultDevPorts(cwd: string = process.cwd()): number[] {
  const env = process.env.NODEFONY_DEV_PORTS;
  if (env) {
    const parsed = env
      .split(",")
      .map((s) => Number.parseInt(s.trim(), 10))
      .filter((n) => Number.isInteger(n) && n > 0);
    if (parsed.length > 0) return parsed;
  }
  const state = readRuntimeState(cwd);
  if (state && state.ports.length > 0) return [...state.ports];
  return [...FALLBACK_DEV_PORTS];
}

/** Lit le PID du superviseur depuis le pidfile, ou `null` si absent / illisible. */
export function readSupervisorPid(cwd: string): number | null {
  const file = devSupervisorPidFile(cwd);
  try {
    if (!existsSync(file)) return null;
    const pid = Number.parseInt(readFileSync(file, "utf8").trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** `true` si le process `pid` est vivant (signal 0 — ne le tue pas). */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Envoie `signal` au GROUPE de process de `pid` (POSIX : `-pid` → atteint les
 * descendants, ex. l'enfant serveur + ses Vite quand `pid` est le superviseur leader
 * de groupe) PUIS au `pid` lui-même en fallback. No-op silencieux si le process /
 * groupe n'existe plus. Windows : pas de groupe POSIX → kill direct du pid.
 */
export function signalProcessGroup(pid: number, signal: NodeJS.Signals): void {
  if (process.platform !== "win32") {
    try {
      process.kill(-pid, signal);
    } catch {
      /* pas leader de groupe / groupe déjà parti */
    }
  }
  try {
    process.kill(pid, signal);
  } catch {
    /* déjà mort */
  }
}

/** Supprime le pidfile du superviseur (best-effort, idempotent). */
export function clearSupervisorPidFile(cwd: string): void {
  try {
    const f = devSupervisorPidFile(cwd);
    if (existsSync(f)) rmSync(f, { force: true });
  } catch {
    /* best-effort */
  }
}

/** Petite pause (poll/backoff des boucles d'attente). */
const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Racines d'un ensemble de process : ceux dont le parent n'est PAS lui-même dans
 * l'ensemble. Tuer le GROUPE d'une racine suffit à emporter ses descendants présents
 * (le superviseur emporte enfant serveur + Vite ; un orphelin est sa propre racine).
 */
export function rootProcesses(
  procs: readonly DevProcessInfo[],
): DevProcessInfo[] {
  const pids = new Set(procs.map((p) => p.pid));
  return procs.filter((p) => !pids.has(p.ppid));
}

/** Attend que tous les `pids` soient morts (poll), renvoie ceux encore vivants à l'échéance. */
export async function waitAllDead(
  pids: readonly number[],
  timeoutMs: number,
): Promise<number[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const alive = pids.filter((pid) => isPidAlive(pid));
    if (alive.length === 0) return [];
    if (Date.now() >= deadline) return alive;
    await delay(120);
  }
}

/** Options de {@link terminateDevProcesses}. */
export interface TerminateOptions {
  /** Délai d'arrêt gracieux (SIGTERM) avant d'escalader en SIGKILL. Défaut 4000 ms. */
  readonly termWaitMs?: number;
  /** Délai d'attente de la mort après SIGKILL. Défaut 1500 ms. */
  readonly killWaitMs?: number;
}

/**
 * Arrête un ensemble de process dev par GROUPE — SIGTERM (arrêt gracieux) sur les
 * racines puis SIGKILL des récalcitrants (groupes racines + PID restants un à un).
 * Renvoie les PID encore vivants à la fin (vide = arrêt complet).
 *
 * OBSERVATION EXTERNE pure (signaux POSIX, aucun IPC). Logique PARTAGÉE entre
 * `nodefony stop` (rapport user, cf {@link DevProcessInfo}) et le verrou single-instance
 * du superviseur (nettoyage des résiduels au démarrage) → une seule définition de « tuer
 * proprement un arbre de process dev » (divergence = bug).
 */
export async function terminateDevProcesses(
  procs: readonly DevProcessInfo[],
  opts: TerminateOptions = {},
): Promise<number[]> {
  if (procs.length === 0) return [];
  const termWaitMs = opts.termWaitMs ?? 4000;
  const killWaitMs = opts.killWaitMs ?? 1500;
  const roots = rootProcesses(procs);
  for (const r of roots) signalProcessGroup(r.pid, "SIGTERM");
  let alive = await waitAllDead(
    procs.map((p) => p.pid),
    termWaitMs,
  );
  if (alive.length > 0) {
    for (const r of roots) signalProcessGroup(r.pid, "SIGKILL");
    for (const pid of alive) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* déjà mort entre-temps */
      }
    }
    alive = await waitAllDead(alive, killWaitMs);
  }
  return alive;
}

/**
 * Répertoire de travail d'un process — `/proc/<pid>/cwd` (Linux) ou `lsof -d cwd`
 * (macOS/BSD). `null` si irrésolu (process mort, permissions, outil absent).
 *
 * Sert au SCOPING PAR PROJET du multi-app : plusieurs apps Nodefony peuvent
 * tourner en dev sur le même poste — un balayage `ps` global sans notion de
 * projet faisait tuer le runtime d'un AUTRE dossier (destructeur, vécu en
 * design review). Le cwd est le seul identifiant de projet observable de
 * l'extérieur (aucun IPC — choix d'architecture de ce module).
 */
export function processCwd(pid: number): string | null {
  if (process.platform === "linux") {
    try {
      return readlinkSync(`/proc/${pid}/cwd`);
    } catch {
      return null;
    }
  }
  try {
    const res = spawnSync(
      "lsof",
      ["-a", "-p", String(pid), "-d", "cwd", "-Fn"],
      { encoding: "utf8", env: { ...process.env, LC_ALL: "C" } },
    );
    if (typeof res.stdout !== "string") return null;
    for (const line of res.stdout.split("\n")) {
      if (line.startsWith("n")) return line.slice(1);
    }
  } catch {
    /* lsof absent / interdit → inconnu */
  }
  return null;
}

/** Un process découvert, enrichi du cwd résolu (`null` = irrésolu). */
export type DevProcessWithCwd = DevProcessInfo & { cwd: string | null };

/**
 * Scinde des process découverts entre CE projet (`mine` — tuables par les gardes
 * single-instance / `nodefony stop`) et les AUTRES (`foreign` — JAMAIS touchés).
 *
 * Règles de rattachement :
 * - rôles racine (supervisor/master/server/worker) : cwd EXACTEMENT le projet —
 *   ils sont toujours spawnés à la racine ;
 * - `vite` : projet OU sous-dossier (le builder peut travailler dans `frontend/`) ;
 * - cwd IRRÉSOLU → `foreign` : on préfère laisser vivre un orphelin (bénin, la
 *   collision de ports est refusée plus loin) plutôt que tuer la session d'un
 *   autre projet (destructeur).
 *
 * Limite assumée : deux projets IMBRIQUÉS (une app dans un sous-dossier du repo)
 * partagent le préfixe → le Vite de l'app peut être adopté par le parent.
 */
export function splitByProject(
  procs: readonly DevProcessInfo[],
  projectCwd: string,
  getCwd: (pid: number) => string | null = processCwd,
): { mine: DevProcessInfo[]; foreign: DevProcessWithCwd[] } {
  const root = path.resolve(projectCwd);
  const mine: DevProcessInfo[] = [];
  const foreign: DevProcessWithCwd[] = [];
  for (const p of procs) {
    const cwd = getCwd(p.pid);
    const resolved = cwd === null ? null : path.resolve(cwd);
    const belongs =
      resolved !== null &&
      (resolved === root ||
        (p.role === "vite" && resolved.startsWith(root + path.sep)));
    if (belongs) {
      mine.push(p);
    } else {
      foreign.push({ ...p, cwd: resolved });
    }
  }
  return { mine, foreign };
}

/**
 * `true` si `cwd` ressemble à un projet Nodefony : `package.json` déclarant la
 * dépendance `nodefony`, OU `node_modules/nodefony` présent (app installée sans
 * la déclarer). MÊME heuristique que `Kernel.resolveAppEntry` (détection d'app),
 * mais STANDALONE (fs seul, aucun kernel) — pour que `nodefony status`/`stop`
 * lancés hors projet le DISENT au lieu de suggérer un `nodefony dev` voué à
 * l'échec.
 *
 * @param cwd - dossier à tester.
 */
export function isNodefonyProjectDir(cwd: string): boolean {
  try {
    const pkg = JSON.parse(
      readFileSync(path.resolve(cwd, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    if (
      pkg.dependencies?.nodefony ??
      pkg.devDependencies?.nodefony ??
      pkg.peerDependencies?.nodefony
    ) {
      return true;
    }
  } catch {
    // pas de package.json lisible → on retombe sur node_modules/nodefony
  }
  return existsSync(path.resolve(cwd, "node_modules", "nodefony"));
}

/**
 * Met en forme les runtimes ÉTRANGERS (autre projet) en bloc multi-lignes AÉRÉ :
 * groupés par racine de projet (un Vite au cwd sous-dossier est rattaché à la
 * racine qui le préfixe, affiché en relatif), un process par ligne (pid + rôle),
 * puis les commandes EXACTES à copier-coller pour les arrêter. Partagé par le
 * refus de boot (`DevSupervisor`), `nodefony dev --detach` et `nodefony stop` —
 * même pédagogie partout (vécu : un pavé mono-ligne de 4 pids, dev bloqué sans
 * savoir QUOI taper).
 *
 * @param foreign - runtimes d'autres projets (sortie `splitByProject().foreign`).
 * @returns lignes prêtes à afficher (sans couleur ; l'appelant préfixe/colore).
 */
export function formatForeignRuntimes(
  foreign: readonly DevProcessWithCwd[],
): string[] {
  // Racines = cwd des rôles racine (supervisor/master/server/worker) — toujours
  // spawnés à la racine de leur projet. Les Vite s'y rattachent par préfixe.
  const roots = [
    ...new Set(
      foreign
        .filter((p) => p.role !== "vite" && p.cwd)
        .map((p) => p.cwd as string),
    ),
  ];
  const projectOf = (p: DevProcessWithCwd): string => {
    if (!p.cwd) return "(dossier inconnu)";
    return (
      roots.find((r) => p.cwd === r || p.cwd!.startsWith(r + path.sep)) ?? p.cwd
    );
  };
  const byProject = new Map<string, DevProcessWithCwd[]>();
  for (const p of foreign) {
    const key = projectOf(p);
    const list = byProject.get(key);
    if (list) {
      list.push(p);
    } else {
      byProject.set(key, [p]);
    }
  }
  const lines: string[] = [""];
  for (const [project, procs] of byProject) {
    lines.push(`  projet ${project}`);
    for (const p of procs) {
      const sub =
        p.cwd && p.cwd !== project
          ? `  (${path.relative(project, p.cwd)})`
          : "";
      lines.push(`    · pid ${p.pid}  ${p.label}${sub}`);
    }
  }
  lines.push("", "  pour les arrêter :");
  for (const project of byProject.keys()) {
    if (!project.startsWith("(")) {
      lines.push(`    cd ${project} && nodefony stop`);
    }
  }
  lines.push(
    "    nodefony stop --all        (tout Nodefony, tous projets)",
    "",
  );
  return lines;
}

/**
 * `true` si un service écoute sur `port` en loopback (connexion acceptée). Inverse de
 * la sonde « port libre » du superviseur : ici on confirme qu'un serveur RÉPOND.
 */
export function isPortListening(
  port: number,
  host = "127.0.0.1",
  timeoutMs = 400,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const settle = (listening: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(listening);
    };
    socket.once("connect", () => settle(true)); // quelqu'un répond → à l'écoute
    socket.once("error", () => settle(false)); // refusé / injoignable → muet
    socket.setTimeout(timeoutMs, () => settle(false));
  });
}

/** Sonde TCP de plusieurs ports en parallèle. */
export async function probePorts(
  ports: readonly number[],
): Promise<PortState[]> {
  return Promise.all(
    ports.map(async (port) => ({
      port,
      listening: await isPortListening(port),
    })),
  );
}

/** Convertit le champ `etime` de `ps` (`[[DD-]HH:]MM:SS`) en secondes. */
function parseEtime(etime: string): number {
  let rest = etime.trim();
  let days = 0;
  const dash = rest.indexOf("-");
  if (dash >= 0) {
    days = Number.parseInt(rest.slice(0, dash), 10) || 0;
    rest = rest.slice(dash + 1);
  }
  const parts = rest.split(":").map((n) => Number.parseInt(n, 10) || 0);
  let h = 0;
  let m = 0;
  let s = 0;
  if (parts.length === 3) [h, m, s] = parts;
  else if (parts.length === 2) [m, s] = parts;
  else if (parts.length === 1) [s] = parts;
  return days * 86400 + h * 3600 + m * 60 + s;
}

/** Formate une durée (s) en libellé court (`45s`, `2m14s`, `1h03m`, `2d 05h`). */
export function formatUptime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d > 0) return `${d}d ${String(h).padStart(2, "0")}h`;
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}m`;
  return `${m}m${String(s).padStart(2, "0")}s`;
}

/** Extrait le détail d'un titre Vite (`nodefony-vite[studio]` → `studio`). */
function viteEntries(command: string): string {
  const m = command.match(/nodefony-vite\[([^\]]*)\]/);
  return m ? m[1] : "";
}

/** Regex d'une ligne `ps -o pid=,ppid=,rss=,pcpu=,etime=,command=`. */
const PS_ROW_RE = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d.,]+)\s+(\S+)\s+(.*)$/;

/**
 * Parse UNE ligne `ps` (pid ppid rss pcpu etime command) en {@link DevProcessInfo},
 * ou `null` si la ligne ne matche pas ou n'est pas un process dev connu. `%CPU` toléré
 * avec point OU virgule décimale (robustesse locale — la virgule FR a déjà fait passer
 * la détection à zéro). Fonction PURE (testable sans `ps`).
 */
export function parsePsRow(line: string): DevProcessInfo | null {
  const m = line.match(PS_ROW_RE);
  if (!m) return null;
  const c = classify(m[6]);
  if (!c) return null;
  return {
    pid: Number.parseInt(m[1], 10),
    ppid: Number.parseInt(m[2], 10),
    mode: c.mode,
    role: c.role,
    label: c.label,
    detail: c.detail,
    rssKb: Number.parseInt(m[3], 10),
    cpu: Number.parseFloat(m[4].replace(",", ".")),
    uptimeSec: parseEtime(m[5]),
  };
}

/**
 * Classe une ligne de commande `ps` en (mode, rôle) runtime Nodefony, ou `null` si hors
 * périmètre. Ordre du matching : titres dev (les plus spécifiques) d'abord, puis cluster
 * (master/worker), puis le serveur prod mono générique en dernier — `nodefony-dev-server`
 * (tiret) ne contient jamais `nodefony server` (espace), donc aucune ambiguïté.
 */
function classify(command: string): {
  mode: RuntimeMode;
  role: DevProcessRole;
  label: string;
  detail?: string;
} | null {
  if (command.includes(DEV_SUPERVISOR_TITLE))
    return { mode: "dev", role: "supervisor", label: "supervisor" };
  if (command.includes(DEV_SERVER_TITLE))
    return { mode: "dev", role: "server", label: "server" };
  if (command.includes(DEV_VITE_PREFIX)) {
    // Rôle court en colonne (`vite`) ; les bundles vont en `detail` (hors colonne)
    // pour ne pas faire déborder l'alignement quand ils sont nombreux/longs.
    const e = viteEntries(command);
    return { mode: "dev", role: "vite", label: "vite", detail: e || undefined };
  }
  if (command.includes(CLUSTER_MASTER_PREFIX)) {
    // Détail = nombre de workers déclaré dans le titre (`[cluster 6w]`).
    const w = command.match(/\[cluster\s+(\d+)w\]/);
    return {
      mode: "cluster",
      role: "master",
      label: "master",
      detail: w ? `${w[1]} workers` : undefined,
    };
  }
  if (command.includes(CLUSTER_WORKER_PREFIX)) {
    // Détail = id du worker (`nodefony worker 3 [cluster]`).
    const id = command.match(/nodefony worker (\d+)/);
    return {
      mode: "cluster",
      role: "worker",
      label: "worker",
      detail: id ? `#${id[1]}` : undefined,
    };
  }
  if (command.includes(PROD_SERVER_TITLE))
    return { mode: "prod", role: "server", label: "server" };
  return null;
}

/** Options de {@link discoverDevProcesses}. */
export interface DiscoverOptions {
  /**
   * Inclure le process APPELANT s'il porte lui-même un titre dev connu. Défaut
   * `false` (comportement CLI : `nodefony status`/`stop` tournent dans un process
   * standalone qui n'est PAS un process dev → l'exclusion est neutre). Le data
   * plane (`GET /kernel/api/processes`) tourne DANS le serveur enfant
   * (`nodefony-dev-server`) → il doit `includeSelf:true` pour SE compter, sinon
   * le rôle « server » manquerait à la topologie rapportée.
   */
  readonly includeSelf?: boolean;
}

/**
 * Découvre les process dev Nodefony vivants par OBSERVATION EXTERNE (`ps`) — zéro IPC.
 *
 * Ne retient que les process dont la commande porte un titre dev connu (superviseur /
 * serveur / Vite) et en extrait PID/PPID/RSS/CPU/uptime. S'auto-exclut par défaut (le
 * process appelant) sauf `opts.includeSelf`. Tri : superviseur, puis serveur, puis Vite.
 * Best-effort : Windows (pas de `ps` POSIX fiable) ou `ps` en échec → liste vide (le
 * lecteur le signale).
 */
export function discoverDevProcesses(
  opts: DiscoverOptions = {},
): DevProcessInfo[] {
  if (process.platform === "win32") return [];
  let out: string;
  try {
    const res = spawnSync(
      "ps",
      ["-A", "-o", "pid=,ppid=,rss=,pcpu=,etime=,command="],
      {
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
        // Locale POSIX forcée : sans ça, une locale FR/… formate `%CPU` avec une
        // VIRGULE décimale (`0,0`) que le parsing rejetterait silencieusement
        // (→ 0 process détecté). `C` garantit un format stable, machine-indépendant.
        env: { ...process.env, LC_ALL: "C", LANG: "C" },
      },
    );
    if (res.status !== 0 || typeof res.stdout !== "string") return [];
    out = res.stdout;
  } catch {
    return [];
  }
  const procs: DevProcessInfo[] = [];
  for (const raw of out.split("\n")) {
    const info = parsePsRow(raw);
    if (!info) continue;
    if (!opts.includeSelf && info.pid === process.pid) continue; // ignore soi-même (défaut CLI)
    procs.push(info);
  }
  // Superviseurs (dev) / masters (cluster) en tête, puis ceux qui servent
  // (server/worker), puis les Vite ; départage par pid.
  const order: Record<DevProcessRole, number> = {
    supervisor: 0,
    master: 0,
    server: 1,
    worker: 1,
    vite: 2,
  };
  procs.sort((a, b) => order[a.role] - order[b.role] || a.pid - b.pid);
  return procs;
}

/**
 * Modes runtime présents parmi les process PRINCIPAUX (Vite exclu — un Vite ne « tient »
 * pas les ports serveur). Set vide = aucun runtime principal vivant. Fonction PURE.
 */
export function runtimeModes(
  procs: readonly DevProcessInfo[],
): Set<RuntimeMode> {
  const modes = new Set<RuntimeMode>();
  for (const p of procs) if (PRIMARY_ROLES.has(p.role)) modes.add(p.mode);
  return modes;
}

/**
 * Mode runtime dominant observé, ou `null` si aucun process principal. Priorité
 * dev > cluster > prod en cas de cohabitation anormale (le conflit est signalé par
 * ailleurs en warning / refus). Fonction PURE.
 */
export function detectRuntimeMode(
  procs: readonly DevProcessInfo[],
): RuntimeMode | null {
  const modes = runtimeModes(procs);
  if (modes.has("dev")) return "dev";
  if (modes.has("cluster")) return "cluster";
  if (modes.has("prod")) return "prod";
  return null;
}

/**
 * Process PRINCIPAUX appartenant à un runtime d'un mode DIFFÉRENT de `intended` — un
 * conflit de cohabitation (ex. un `prod`/`cluster` occupe les ports quand on veut
 * démarrer en `dev`, ou l'inverse). Vite exclu (enfant). Sert aux gardes anti-collision :
 * fail-loud (refus + message), JAMAIS de kill cross-mode automatique (un prod est
 * intentionnel). Fonction PURE.
 */
export function findRuntimeConflict(
  procs: readonly DevProcessInfo[],
  intended: RuntimeMode,
): DevProcessInfo[] {
  return procs.filter((p) => PRIMARY_ROLES.has(p.role) && p.mode !== intended);
}

/** Résout les globs `workspaces` (`a/b`, `a/*`) en chemins de dossiers absolus. */
function resolveWorkspaceDirs(cwd: string, globs: readonly string[]): string[] {
  const out: string[] = [];
  for (const g of globs) {
    if (g.endsWith("/*")) {
      const base = path.join(cwd, g.slice(0, -2));
      try {
        for (const e of readdirSync(base, { withFileTypes: true }))
          if (e.isDirectory()) out.push(path.join(base, e.name));
      } catch {
        /* base de glob absente → rien */
      }
    } else {
      out.push(path.join(cwd, g));
    }
  }
  return out;
}

/**
 * Liste les workspaces qui DEVRAIENT produire un dist (présence d'un `rolldown.config.ts`)
 * mais dont le dossier `dist/` est absent ou vide — renvoie leurs **noms de package**
 * (pour `turbo --filter`). On cible l'ABSENCE de build, pas l'entrée exacte (le core
 * sort `dist/node/…`, d'autres `dist/index.js`) → vérifier « dist non vide » est le
 * critère robuste et uniforme.
 *
 * POST-CONDITION du build du superviseur : `turbo run build` peut renvoyer 0 en « cache
 * hit » SANS restaurer un dist supprimé (gitignored, `clean` partiel, checkout de
 * branche) → le module manquant tombe en fail-soft au boot et cascade en silence
 * (« vert mais cassé »). On vérifie le terrain (la confiance n'exclut pas le contrôle).
 * Pur filesystem, aucun boot. Un workspace sans config de bundler (WIP non câblé) est
 * ignoré : aucun dist n'est attendu de lui.
 */
export function missingWorkspaceDists(cwd: string): string[] {
  let globs: readonly string[];
  try {
    const root = JSON.parse(
      readFileSync(path.join(cwd, "package.json"), "utf8"),
    ) as { workspaces?: string[] };
    globs = root.workspaces ?? [];
  } catch {
    return []; // pas de package.json racine lisible → rien à vérifier
  }
  const missing: string[] = [];
  for (const dir of resolveWorkspaceDirs(cwd, globs)) {
    if (!existsSync(path.join(dir, "rolldown.config.ts"))) continue; // pas de build attendu
    if (distIsBuilt(dir)) continue;
    // dist absent/vide → résout le NOM de package (pour `turbo --filter`).
    let name = path.basename(dir);
    try {
      const pj = JSON.parse(
        readFileSync(path.join(dir, "package.json"), "utf8"),
      ) as { name?: string };
      if (pj.name) name = pj.name;
    } catch {
      /* package.json illisible → garde le basename du dossier */
    }
    missing.push(name);
  }
  return missing;
}

/** `true` si le dossier `dist/` du workspace existe et contient au moins un fichier. */
function distIsBuilt(dir: string): boolean {
  try {
    return readdirSync(path.join(dir, "dist")).length > 0;
  } catch {
    return false; // dist/ absent → pas buildé
  }
}
