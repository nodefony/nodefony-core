import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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

/** Rôle d'un process dans la topologie de développement. */
export type DevProcessRole = "supervisor" | "server" | "vite";

/** Process dev vivant observé via `ps` (sans IPC). */
export interface DevProcessInfo {
  readonly pid: number;
  /** PID du parent (relie l'enfant au superviseur, Vite à l'enfant). */
  readonly ppid: number;
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

/**
 * Ports serveur dev par défaut : `NODEFONY_DEV_PORTS` (CSV) sinon HTTP/HTTPS Nodefony
 * (`[5151, 5152]`). Partagé : `status` sonde EXACTEMENT les ports que le superviseur
 * attend libres au restart.
 */
export function defaultDevPorts(): number[] {
  const env = process.env.NODEFONY_DEV_PORTS;
  if (!env) return [5151, 5152];
  const parsed = env
    .split(",")
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && n > 0);
  return parsed.length > 0 ? parsed : [5151, 5152];
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
    role: c.role,
    label: c.label,
    detail: c.detail,
    rssKb: Number.parseInt(m[3], 10),
    cpu: Number.parseFloat(m[4].replace(",", ".")),
    uptimeSec: parseEtime(m[5]),
  };
}

/** Classe une ligne de commande `ps` en rôle dev, ou `null` si hors périmètre. */
function classify(command: string): {
  role: DevProcessRole;
  label: string;
  detail?: string;
} | null {
  if (command.includes(DEV_SUPERVISOR_TITLE))
    return { role: "supervisor", label: "supervisor" };
  if (command.includes(DEV_SERVER_TITLE))
    return { role: "server", label: "server" };
  if (command.includes(DEV_VITE_PREFIX)) {
    // Rôle court en colonne (`vite`) ; les bundles vont en `detail` (hors colonne)
    // pour ne pas faire déborder l'alignement quand ils sont nombreux/longs.
    const e = viteEntries(command);
    return { role: "vite", label: "vite", detail: e || undefined };
  }
  return null;
}

/**
 * Découvre les process dev Nodefony vivants par OBSERVATION EXTERNE (`ps`) — zéro IPC.
 *
 * Ne retient que les process dont la commande porte un titre dev connu (superviseur /
 * serveur / Vite) et en extrait PID/PPID/RSS/CPU/uptime. S'auto-exclut (le process
 * appelant). Tri : superviseur, puis serveur, puis Vite. Best-effort : Windows (pas
 * de `ps` POSIX fiable) ou `ps` en échec → liste vide (le lecteur le signale).
 */
export function discoverDevProcesses(): DevProcessInfo[] {
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
    if (!info || info.pid === process.pid) continue; // ignore soi-même
    procs.push(info);
  }
  const order: Record<DevProcessRole, number> = {
    supervisor: 0,
    server: 1,
    vite: 2,
  };
  procs.sort((a, b) => order[a.role] - order[b.role] || a.pid - b.pid);
  return procs;
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
 * Liste les workspaces qui DEVRAIENT produire un dist (présence d'un `rollup.config.ts`)
 * mais dont le dossier `dist/` est absent ou vide — renvoie leurs **noms de package**
 * (pour `turbo --filter`). On cible l'ABSENCE de build, pas l'entrée exacte (le core
 * sort `dist/node/…`, d'autres `dist/index.js`) → vérifier « dist non vide » est le
 * critère robuste et uniforme.
 *
 * POST-CONDITION du build du superviseur : `turbo run build` peut renvoyer 0 en « cache
 * hit » SANS restaurer un dist supprimé (gitignored, `clean` partiel, checkout de
 * branche) → le module manquant tombe en fail-soft au boot et cascade en silence
 * (« vert mais cassé »). On vérifie le terrain (la confiance n'exclut pas le contrôle).
 * Pur filesystem, aucun boot. Un workspace sans `rollup.config.ts` (WIP non câblé) est
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
    if (!existsSync(path.join(dir, "rollup.config.ts"))) continue; // pas de build attendu
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
