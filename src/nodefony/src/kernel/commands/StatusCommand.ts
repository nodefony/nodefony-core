import { writeSync } from "node:fs";
import path from "node:path";
import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
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
  type PortState,
} from "../../service/dev/devProcess";

const ANSI = {
  dim: "\x1b[90m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
};

const options: OptionsCommandInterface = {
  showBanner: false,
  // `onStart` = le plus tôt possible dans le boot : la commande fait son diagnostic
  // (pidfile + `ps` + sonde ports) puis s'auto-termine AVANT le chargement des modules
  // applicatifs. Conséquence voulue : `status` reste FIABLE même quand l'app est
  // cassée (config invalide, module qui throw au boot) — c'est précisément là qu'on
  // en a besoin. Pur diagnostic : aucun serveur monté, aucun IPC.
  kernelEvent: "onStart",
};

/**
 * Commande `nodefony status` — photo instantanée des process de développement.
 *
 * Répond au besoin « ne plus être perdu » : d'un coup d'œil, quels process dev
 * tournent (superviseur / serveur / Vite), avec PID, parent, uptime, RSS, %CPU, et
 * l'état des ports serveur. 100 % observation externe ({@link discoverDevProcesses}
 * via `ps` + sonde TCP), cohérent avec le choix no-IPC du superviseur.
 *
 * Signale les états INCOHÉRENTS (fail-loud, principe « pas de dégradation
 * silencieuse ») : pidfile périmé, process orphelins sans superviseur, empilement
 * anormal — autant de symptômes que `nodefony stop` (à venir) corrigera.
 */
class Status extends Command {
  constructor(cli: CliKernel) {
    super(
      "status",
      "Show running Nodefony dev processes (supervisor/server/vite) and server ports",
      cli as CliKernel,
      options,
    );
  }

  override async onKernelPreStart(): Promise<void> {
    // Diagnostic pur : on coupe le bruit de boot et on n'arme aucun serveur. La
    // commande s'auto-termine dans generate() avant que le boot n'aille plus loin.
    (this.cli as CliKernel).quietBoot = true;
    (this.cli as CliKernel).setRunProfile({
      servers: false,
      lifetime: "oneshot",
      interactive: false,
    });
  }

  override async generate(): Promise<this> {
    const cwd = process.cwd();
    const pid = readSupervisorPid(cwd);
    const procs = discoverDevProcesses();
    const ports = await probePorts(defaultDevPorts());

    const lines: string[] = [];
    this.#render(lines, cwd, pid, procs, ports);
    // Sortie en UN écrit synchrone (writeSync) → jamais tronquée par l'exit qui suit
    // (process.stdout.write est async sur un pipe). Pas via syslog (quietBoot actif).
    writeSync(1, lines.join("\n") + "\n");

    await this.terminate(0);
    return this;
  }

  /** Compose le rapport (tableau + ports + synthèse + avertissements) dans `lines`. */
  #render(
    lines: string[],
    cwd: string,
    pid: number | null,
    procs: readonly DevProcessInfo[],
    ports: readonly PortState[],
  ): void {
    const tag = `${ANSI.dim}[status]${ANSI.reset}`;
    const pidRel = path.relative(cwd, devSupervisorPidFile(cwd));

    // VÉRITÉ = `ps` (process réels), pas le pidfile : un PID recyclé ferait croire le
    // superviseur vivant. Aucun process dev réel → état « repos », et le pidfile n'est
    // qu'un indice (absent / périmé : pid mort, ou vivant mais étranger).
    if (procs.length === 0) {
      const pidNote =
        pid === null
          ? `${ANSI.dim}absent${ANSI.reset}`
          : isPidAlive(pid)
            ? `${ANSI.yellow}périmé (pid ${pid} vivant mais non-superviseur)${ANSI.reset}`
            : `${ANSI.yellow}périmé (pid ${pid} mort)${ANSI.reset}`;
      lines.push(
        "",
        `${tag} ${ANSI.bold}Nodefony dev — aucune instance en cours${ANSI.reset}`,
        `  ${ANSI.dim}pidfile${ANSI.reset}  ${pidRel} — ${pidNote}`,
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
    );

    const nSup = procs.filter((p) => p.role === "supervisor").length;
    const nSrv = procs.filter((p) => p.role === "server").length;
    const nVite = procs.filter((p) => p.role === "vite").length;
    const upPorts = ports.filter((p) => p.listening).length;
    lines.push(
      `  ${ANSI.dim}synthèse${ANSI.reset}      : ${nSup} superviseur · ${nSrv} serveur · ${nVite} Vite · ${upPorts}/${ports.length} ports UP`,
    );

    // États incohérents → fail-loud (principe « pas de dégradation silencieuse »).
    const warns: string[] = [];
    const supPids = procs
      .filter((p) => p.role === "supervisor")
      .map((p) => p.pid);
    if (pid !== null && !supPids.includes(pid))
      warns.push(
        isPidAlive(pid)
          ? `pidfile pointe pid ${pid} (vivant) qui n'est pas le superviseur réel — pidfile incohérent`
          : `pidfile pointe pid ${pid} mort — pidfile périmé`,
      );
    if (nSup === 0 && (nSrv > 0 || nVite > 0))
      warns.push(
        "process dev orphelins (serveur/Vite sans superviseur) — `nodefony stop` (à venir) les nettoiera",
      );
    if (nSup > 1)
      warns.push(`${nSup} superviseurs simultanés — empilement anormal`);
    if (nSrv > 1)
      warns.push(`${nSrv} serveurs simultanés — empilement anormal`);
    for (const w of warns) lines.push(`  ${ANSI.yellow}⚠ ${w}${ANSI.reset}`);
    lines.push("");
  }
}

export default Status;
