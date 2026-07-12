import { writeSync } from "node:fs";
import path from "node:path";
import Cli from "../../Cli";
import {
  defaultDevPorts,
  detectRuntimeMode,
  devSupervisorPidFile,
  discoverDevProcesses,
  formatUptime,
  isNodefonyProjectDir,
  isPidAlive,
  probePorts,
  readSupervisorPid,
  runtimeModes,
  type DevProcessInfo,
  type DiscoverOptions,
  type PortState,
  type RuntimeMode,
} from "./devProcess";
import { runStopReport } from "./devStop";

/**
 * Rapport `nodefony status` — composition + exécution DÉCOUPLÉES de la classe Command.
 *
 * Pur outillage de process (ps + sonde ports + pidfile) : aucun boot kernel, aucune
 * trunk requise → exécutable depuis N'IMPORTE OÙ (cf le fast-path « standalone » de
 * `CliKernel.start`). Cohérent avec le choix no-IPC du superviseur (observation externe).
 */

const ANSI = {
  dim: "\x1b[90m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
};

/** Commandes « système » exécutables SANS boot kernel ni trunk (outillage process). */
const STANDALONE_DEV_COMMANDS = new Set<string>(["status", "stop"]);

/** `true` si `name` est une commande système standalone (status/stop). */
export function isStandaloneDevCommand(name: string): boolean {
  return STANDALONE_DEV_COMMANDS.has(name);
}

/**
 * Exécute une commande système standalone par son nom — point d'entrée du fast-path
 * `CliKernel.start` (avant tout boot). N'écrit jamais via le syslog (kernel non booté).
 * `stop --all` = trans-projets explicite (défaut : scope au projet du cwd).
 */
export async function runStandaloneDevCommand(name: string): Promise<void> {
  const cwd = process.cwd();
  if (name === "status") return runStatusReport(cwd);
  if (name === "stop")
    return runStopReport(cwd, { all: process.argv.includes("--all") });
}

/**
 * Rapport d'introspection des process dev — forme JSON, SOURCE DE VÉRITÉ unique
 * partagée par le rendu ANSI CLI (`nodefony status`) et le data plane Studio
 * (`GET /nodefony/kernel/api/processes`). CLI et Web affichent EXACTEMENT le même état.
 */
export interface DevStatusReport {
  /** `false` si l'introspection `ps` est indisponible (Windows). */
  readonly supported: boolean;
  /** `true` si au moins un process runtime Nodefony tourne. */
  readonly running: boolean;
  /**
   * Mode runtime dominant détecté (`dev`/`prod`/`cluster`), ou `null` si aucun process
   * principal vivant. Pilote le libellé du rapport (dev vs production vs cluster).
   */
  readonly mode: RuntimeMode | null;
  /** Process runtime observés (triés superviseur/master → serveur/worker → Vite). */
  readonly processes: readonly DevProcessInfo[];
  /** État des ports serveur sondés. */
  readonly ports: readonly PortState[];
  /** Décompte par rôle + ports à l'écoute. */
  readonly summary: {
    readonly supervisors: number;
    readonly servers: number;
    readonly vites: number;
    /** Masters cluster (superviseurs prod, 0 HTTP). */
    readonly masters: number;
    /** Workers cluster (servent le HTTP). */
    readonly workers: number;
    readonly portsUp: number;
    readonly portsTotal: number;
  };
  /** Incohérences détectées (pidfile périmé, orphelins, empilement) — fail-loud. */
  readonly warnings: readonly string[];
  /** Pidfile single-instance du superviseur — indice, chemin RELATIF (pas de fuite FS). */
  readonly pidfile: {
    readonly path: string;
    readonly pid: number | null;
    readonly alive: boolean;
  };
  /**
   * `false` si le cwd n'est PAS un projet Nodefony (`isNodefonyProjectDir`) —
   * le rendu remplace alors « lance nodefony dev » par un message explicite
   * (un dev perdu hors projet croyait l'app simplement arrêtée, vécu).
   */
  readonly inProject: boolean;
}

/**
 * Compose le {@link DevStatusReport} (décompte + incohérences) — fonction PURE :
 * `pidAlive` est fourni par l'appelant (aucun syscall ici → testable sans `ps`/process).
 * Centralise la synthèse + les warnings consommés AUSSI BIEN par le rendu ANSI CLI
 * ({@link renderStatus}) que par le data plane Studio ({@link collectDevStatus}).
 */
export function buildDevStatus(
  cwd: string,
  pid: number | null,
  pidAlive: boolean,
  procs: readonly DevProcessInfo[],
  ports: readonly PortState[],
  inProject = true,
): DevStatusReport {
  const nSup = procs.filter((p) => p.role === "supervisor").length;
  const nSrv = procs.filter((p) => p.role === "server").length;
  const nVite = procs.filter((p) => p.role === "vite").length;
  const nMaster = procs.filter((p) => p.role === "master").length;
  const nWorker = procs.filter((p) => p.role === "worker").length;
  const portsUp = ports.filter((p) => p.listening).length;
  const mode = detectRuntimeMode(procs);

  // États incohérents → fail-loud (principe « pas de dégradation silencieuse »).
  const warnings: string[] = [];

  // Cohabitation anormale de plusieurs runtimes (ex. un dev ET un prod tiennent les mêmes
  // ports) — la 1ʳᵉ cause du bug « dev démarré par-dessus prod ». À signaler en priorité.
  const modes = runtimeModes(procs);
  if (modes.size > 1)
    warnings.push(
      `${modes.size} runtimes Nodefony cohabitent (${[...modes].join(" + ")}) — ` +
        "anormal : `nodefony stop` pour tout arrêter",
    );

  const supPids = procs
    .filter((p) => p.role === "supervisor")
    .map((p) => p.pid);
  // Le pidfile single-instance ne concerne QUE le superviseur dev — pas de warning en
  // mode prod/cluster (où il est légitimement absent).
  if (pid !== null && !supPids.includes(pid))
    warnings.push(
      pidAlive
        ? `pidfile pointe pid ${pid} (vivant) qui n'est pas le superviseur réel — pidfile incohérent`
        : `pidfile pointe pid ${pid} mort — pidfile périmé`,
    );
  // Orphelins = serveur/Vite DEV sans superviseur dev (un kill -9 brutal). N'a de sens
  // qu'en dev : en prod mono / cluster, l'absence de superviseur dev est NORMALE.
  const devSrv = procs.filter(
    (p) => p.mode === "dev" && p.role === "server",
  ).length;
  if (nSup === 0 && (devSrv > 0 || nVite > 0))
    warnings.push(
      "process dev orphelins (serveur/Vite sans superviseur) — `nodefony stop` les nettoiera",
    );
  if (nSup > 1)
    warnings.push(`${nSup} superviseurs simultanés — empilement anormal`);
  if (nMaster > 1)
    warnings.push(`${nMaster} masters cluster simultanés — empilement anormal`);
  // Plusieurs `server` (rôle prod/dev mono) = empilement ; les workers cluster (rôle
  // distinct) sont, eux, attendus en nombre → exclus de ce contrôle.
  if (nSrv > 1)
    warnings.push(`${nSrv} serveurs simultanés — empilement anormal`);

  return {
    supported: true,
    running: procs.length > 0,
    mode,
    processes: procs,
    ports,
    summary: {
      supervisors: nSup,
      servers: nSrv,
      vites: nVite,
      masters: nMaster,
      workers: nWorker,
      portsUp,
      portsTotal: ports.length,
    },
    warnings,
    pidfile: {
      path: path.relative(cwd, devSupervisorPidFile(cwd)),
      pid,
      alive: pidAlive,
    },
    inProject,
  };
}

/**
 * Collecte l'état dev (ps + sonde ports + pidfile) → {@link DevStatusReport} JSON.
 * Best-effort : Windows (pas de `ps` POSIX) → `supported:false`. `opts.includeSelf`
 * (data plane = le serveur DOIT se compter). AUCUN boot kernel requis (observation
 * externe pure) → utilisable depuis le fast-path standalone ET depuis le data plane.
 */
export async function collectDevStatus(
  cwd: string,
  opts: DiscoverOptions = {},
): Promise<DevStatusReport> {
  const pidPath = path.relative(cwd, devSupervisorPidFile(cwd));
  if (process.platform === "win32")
    return {
      supported: false,
      running: false,
      mode: null,
      processes: [],
      ports: [],
      summary: {
        supervisors: 0,
        servers: 0,
        vites: 0,
        masters: 0,
        workers: 0,
        portsUp: 0,
        portsTotal: 0,
      },
      warnings: [],
      pidfile: { path: pidPath, pid: null, alive: false },
      inProject: isNodefonyProjectDir(cwd),
    };
  const pid = readSupervisorPid(cwd);
  const procs = discoverDevProcesses(opts);
  const ports = await probePorts(defaultDevPorts());
  return buildDevStatus(
    cwd,
    pid,
    pid !== null && isPidAlive(pid),
    procs,
    ports,
    isNodefonyProjectDir(cwd),
  );
}

/** Collecte (ps + ports + pidfile) puis écrit le rapport status sur stdout. */
export async function runStatusReport(cwd: string): Promise<void> {
  // CLI standalone : le process appelant n'est PAS un process dev → `includeSelf` neutre.
  const report = await collectDevStatus(cwd);
  const lines: string[] = [];
  renderStatus(lines, report);
  // UN écrit synchrone (writeSync) → jamais tronqué par l'exit qui suit.
  writeSync(1, lines.join("\n") + "\n");
}

/**
 * Tableau ANSI des process dev (RÔLE/PID/PPID/UPTIME/RSS/%CPU + `↳ bundles`) —
 * LE gabarit partagé `nodefony status` ⇄ bilan de fin de boot (même topologie,
 * même sérieux). `indent` décale toute la grille (le bilan l'aligne sous ses
 * lignes `➜`).
 *
 * Largeur de la colonne RÔLE = plus long label réel (labels courts : supervisor /
 * server / vite) → alignement stable. Le détail des bundles Vite passe sur une 2ᵉ
 * ligne indentée (hors colonne) au lieu de faire déborder la grille.
 */
export function renderProcessTable(
  lines: string[],
  procs: readonly DevProcessInfo[],
  indent: string = "  ",
): void {
  const roleW = Math.max(4, ...procs.map((p) => p.label.length));
  lines.push(
    `${ANSI.dim}${indent}${"RÔLE".padEnd(roleW)}  ${"PID".padEnd(7)}  ${"PPID".padEnd(7)}  ${"UPTIME".padEnd(9)}  ${"RSS".padEnd(9)}  %CPU${ANSI.reset}`,
    `${ANSI.dim}${indent}${"─".repeat(roleW + 46)}${ANSI.reset}`,
  );
  for (const p of procs) {
    const color =
      p.role === "supervisor" || p.role === "master"
        ? ANSI.cyan
        : p.role === "server" || p.role === "worker"
          ? ANSI.green
          : ANSI.dim;
    lines.push(
      `${indent}${color}${p.label.padEnd(roleW)}${ANSI.reset}  ` +
        `${String(p.pid).padEnd(7)}  ${String(p.ppid).padEnd(7)}  ` +
        `${formatUptime(p.uptimeSec).padEnd(9)}  ` +
        `${Cli.niceBytes(p.rssKb * 1024).padEnd(9)}  ${p.cpu.toFixed(1)}`,
    );
    if (p.detail)
      lines.push(
        `${indent}  ${ANSI.dim}↳ ${p.detail.replace(/\+/g, ", ")}${ANSI.reset}`,
      );
  }
}

/** Rend le {@link DevStatusReport} en ANSI (tableau + ports + synthèse + warnings) dans `lines`. */
function renderStatus(lines: string[], report: DevStatusReport): void {
  const tag = `${ANSI.dim}[status]${ANSI.reset}`;
  const { processes: procs, ports } = report;

  // VÉRITÉ = `ps` (process réels), pas le pidfile : un PID recyclé ferait croire le
  // superviseur vivant. Aucun process dev réel → état « repos », et le pidfile n'est
  // qu'un indice (absent / périmé : pid mort, ou vivant mais étranger).
  if (!report.running) {
    const { pid, alive } = report.pidfile;
    const pidNote =
      pid === null
        ? `${ANSI.dim}absent${ANSI.reset}`
        : alive
          ? `${ANSI.yellow}périmé (pid ${pid} vivant mais non-superviseur)${ANSI.reset}`
          : `${ANSI.yellow}périmé (pid ${pid} mort)${ANSI.reset}`;
    lines.push(
      "",
      `${tag} ${ANSI.bold}Nodefony dev — aucune instance en cours${ANSI.reset}`,
      `  ${ANSI.dim}pidfile${ANSI.reset}  ${report.pidfile.path} — ${pidNote}`,
      `  ${ANSI.dim}ports${ANSI.reset}    ${ports
        .map(
          (p) =>
            `${p.port} ${
              p.listening
                ? `${ANSI.yellow}occupé${ANSI.reset}`
                : `${ANSI.dim}libre${ANSI.reset}`
            }`,
        )
        .join("   ")}`,
      // Hors projet, « lance nodefony dev » serait un conseil voué à l'échec →
      // dire la vraie situation (dossier sans app Nodefony) + les 2 sorties.
      report.inProject
        ? `  ${ANSI.dim}→ lance ${ANSI.reset}${ANSI.cyan}nodefony dev${ANSI.reset}${ANSI.dim} pour démarrer${ANSI.reset}`
        : `  ${ANSI.yellow}⚠ ce dossier n'est pas un projet Nodefony${ANSI.reset}${ANSI.dim} (aucun package.json avec la dépendance « nodefony »)${ANSI.reset}\n` +
            `  ${ANSI.dim}→ place-toi à la racine d'une app, ou crée-en une : ${ANSI.reset}${ANSI.cyan}nodefony create app${ANSI.reset}`,
      "",
    );
    return;
  }

  lines.push(
    "",
    `${tag} ${ANSI.bold}Nodefony ${runtimeLabel(report.mode)} — ${procs.length} process${ANSI.reset}`,
  );
  // Hors projet : les process listés appartiennent à D'AUTRES dossiers — le dire,
  // sinon « stop » d'ici ne les touchera pas (scoping projet) et le dev tourne en rond.
  if (!report.inProject) {
    lines.push(
      `  ${ANSI.yellow}⚠ ce dossier n'est pas un projet Nodefony${ANSI.reset}${ANSI.dim} — vue globale du poste ;` +
        ` stop/dev se lancent depuis la racine d'une app (ou nodefony stop --all)${ANSI.reset}`,
    );
  }
  lines.push("");
  renderProcessTable(lines, procs);

  lines.push(
    "",
    `  ${ANSI.dim}ports serveur${ANSI.reset} : ${ports
      .map(
        (p) =>
          `${p.port} ${
            p.listening
              ? `${ANSI.green}✓ UP${ANSI.reset}`
              : `${ANSI.red}✗ DOWN${ANSI.reset}`
          }`,
      )
      .join("   ")}`,
    `  ${ANSI.dim}synthèse${ANSI.reset}      : ${summaryLine(report)}`,
  );
  for (const w of report.warnings)
    lines.push(`  ${ANSI.yellow}⚠ ${w}${ANSI.reset}`);
  lines.push("");
}

/** Libellé du mode runtime pour le titre du rapport (`dev`/`production`/`cluster`). */
function runtimeLabel(mode: RuntimeMode | null): string {
  if (mode === "prod") return "production";
  if (mode === "cluster") return "cluster";
  if (mode === "dev") return "dev";
  return "runtime"; // que des Vite orphelins ou mode indéterminé
}

/** Ligne de synthèse : segments non-nuls seulement (s'adapte à dev / prod / cluster). */
function summaryLine(report: DevStatusReport): string {
  const s = report.summary;
  const seg: string[] = [];
  if (s.supervisors) seg.push(`${s.supervisors} superviseur`);
  if (s.masters) seg.push(`${s.masters} master`);
  if (s.workers) seg.push(`${s.workers} worker`);
  if (s.servers) seg.push(`${s.servers} serveur`);
  if (s.vites) seg.push(`${s.vites} Vite`);
  seg.push(`${s.portsUp}/${s.portsTotal} ports UP`);
  return seg.join(" · ");
}
