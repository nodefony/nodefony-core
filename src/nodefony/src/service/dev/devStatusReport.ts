import { writeSync } from "node:fs";
import path from "node:path";
import Cli from "../../Cli";
import {
  defaultDevPorts,
  devSupervisorPidFile,
  discoverDevProcesses,
  formatUptime,
  isPidAlive,
  probePorts,
  readSupervisorPid,
  type DevProcessInfo,
  type DiscoverOptions,
  type PortState,
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
 */
export async function runStandaloneDevCommand(name: string): Promise<void> {
  const cwd = process.cwd();
  if (name === "status") return runStatusReport(cwd);
  if (name === "stop") return runStopReport(cwd);
}

/**
 * Rapport d'introspection des process dev — forme JSON, SOURCE DE VÉRITÉ unique
 * partagée par le rendu ANSI CLI (`nodefony status`) et le data plane Studio
 * (`GET /nodefony/kernel/api/processes`). CLI et Web affichent EXACTEMENT le même état.
 */
export interface DevStatusReport {
  /** `false` si l'introspection `ps` est indisponible (Windows). */
  readonly supported: boolean;
  /** `true` si au moins un process dev (superviseur/serveur/Vite) tourne. */
  readonly running: boolean;
  /** Process dev observés (triés superviseur → serveur → Vite). */
  readonly processes: readonly DevProcessInfo[];
  /** État des ports serveur sondés. */
  readonly ports: readonly PortState[];
  /** Décompte par rôle + ports à l'écoute. */
  readonly summary: {
    readonly supervisors: number;
    readonly servers: number;
    readonly vites: number;
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
): DevStatusReport {
  const nSup = procs.filter((p) => p.role === "supervisor").length;
  const nSrv = procs.filter((p) => p.role === "server").length;
  const nVite = procs.filter((p) => p.role === "vite").length;
  const portsUp = ports.filter((p) => p.listening).length;

  // États incohérents → fail-loud (principe « pas de dégradation silencieuse »).
  const warnings: string[] = [];
  const supPids = procs
    .filter((p) => p.role === "supervisor")
    .map((p) => p.pid);
  if (pid !== null && !supPids.includes(pid))
    warnings.push(
      pidAlive
        ? `pidfile pointe pid ${pid} (vivant) qui n'est pas le superviseur réel — pidfile incohérent`
        : `pidfile pointe pid ${pid} mort — pidfile périmé`,
    );
  if (nSup === 0 && (nSrv > 0 || nVite > 0))
    warnings.push(
      "process dev orphelins (serveur/Vite sans superviseur) — `nodefony stop` les nettoiera",
    );
  if (nSup > 1)
    warnings.push(`${nSup} superviseurs simultanés — empilement anormal`);
  if (nSrv > 1)
    warnings.push(`${nSrv} serveurs simultanés — empilement anormal`);

  return {
    supported: true,
    running: procs.length > 0,
    processes: procs,
    ports,
    summary: {
      supervisors: nSup,
      servers: nSrv,
      vites: nVite,
      portsUp,
      portsTotal: ports.length,
    },
    warnings,
    pidfile: {
      path: path.relative(cwd, devSupervisorPidFile(cwd)),
      pid,
      alive: pidAlive,
    },
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
      processes: [],
      ports: [],
      summary: {
        supervisors: 0,
        servers: 0,
        vites: 0,
        portsUp: 0,
        portsTotal: 0,
      },
      warnings: [],
      pidfile: { path: pidPath, pid: null, alive: false },
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
      `  ${ANSI.dim}→ lance ${ANSI.reset}${ANSI.cyan}nodefony dev${ANSI.reset}${ANSI.dim} pour démarrer${ANSI.reset}`,
      "",
    );
    return;
  }

  // Largeur de la colonne RÔLE = plus long label réel (labels courts : supervisor /
  // server / vite) → alignement stable. Le détail des bundles Vite passe sur une 2ᵉ
  // ligne indentée (hors colonne) au lieu de faire déborder la grille.
  const roleW = Math.max(4, ...procs.map((p) => p.label.length));
  lines.push(
    "",
    `${tag} ${ANSI.bold}Nodefony dev — ${procs.length} process${ANSI.reset}`,
    "",
    `${ANSI.dim}  ${"RÔLE".padEnd(roleW)}  ${"PID".padEnd(7)}  ${"PPID".padEnd(7)}  ${"UPTIME".padEnd(9)}  ${"RSS".padEnd(9)}  %CPU${ANSI.reset}`,
    `${ANSI.dim}  ${"─".repeat(roleW + 46)}${ANSI.reset}`,
  );
  for (const p of procs) {
    const color =
      p.role === "supervisor"
        ? ANSI.cyan
        : p.role === "server"
          ? ANSI.green
          : ANSI.dim;
    lines.push(
      `  ${color}${p.label.padEnd(roleW)}${ANSI.reset}  ` +
        `${String(p.pid).padEnd(7)}  ${String(p.ppid).padEnd(7)}  ` +
        `${formatUptime(p.uptimeSec).padEnd(9)}  ` +
        `${Cli.niceBytes(p.rssKb * 1024).padEnd(9)}  ${p.cpu.toFixed(1)}`,
    );
    if (p.detail)
      lines.push(
        `    ${ANSI.dim}↳ ${p.detail.replace(/\+/g, ", ")}${ANSI.reset}`,
      );
  }

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
    `  ${ANSI.dim}synthèse${ANSI.reset}      : ${report.summary.supervisors} superviseur · ${report.summary.servers} serveur · ${report.summary.vites} Vite · ${report.summary.portsUp}/${report.summary.portsTotal} ports UP`,
  );
  for (const w of report.warnings)
    lines.push(`  ${ANSI.yellow}⚠ ${w}${ANSI.reset}`);
  lines.push("");
}
