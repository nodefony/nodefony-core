import { writeSync } from "node:fs";
import {
  clearSupervisorPidFile,
  defaultDevPorts,
  discoverDevProcesses,
  probePorts,
  terminateDevProcesses,
  type PortState,
} from "./devProcess";

/**
 * Commande `nodefony stop` — arrêt PROPRE et COMPLET des process de dev (remplace le
 * `pkill -9` manuel). Standalone : aucun boot kernel, aucune trunk requise → lançable
 * de n'importe où (cf le fast-path de `CliKernel.start`).
 *
 * Stratégie : vérité = `ps` (pas le seul pidfile). On tue les GROUPES « racines » (un
 * process dont le parent n'est pas dans la liste) — group-kill du superviseur emporte
 * déjà son enfant serveur + ses Vite ; un serveur/Vite orphelin (pidfile périmé) est
 * sa propre racine et tombe aussi. SIGTERM (arrêt gracieux) puis SIGKILL des récalcitrants.
 */

const ANSI = {
  dim: "\x1b[90m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
};

/** Délai d'arrêt gracieux (SIGTERM) avant d'escalader en SIGKILL. */
const TERM_WAIT_MS = 4000;
/** Délai max d'attente de libération des ports après le kill. */
const PORTS_WAIT_MS = 4000;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Attend que tous les `ports` soient libres (poll), renvoie le dernier état sondé. */
async function waitPortsFree(
  ports: readonly number[],
  timeoutMs: number,
): Promise<PortState[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const states = await probePorts(ports);
    if (states.every((s) => !s.listening)) return states;
    if (Date.now() >= deadline) return states;
    await delay(150);
  }
}

const portsLine = (states: readonly PortState[], freeLabel: string): string =>
  states
    .map(
      (p) =>
        `${p.port} ${
          p.listening
            ? `${ANSI.red}✗ encore occupé${ANSI.reset}`
            : `${ANSI.green}${freeLabel}${ANSI.reset}`
        }`,
    )
    .join("   ");

/** Découvre, tue (SIGTERM→SIGKILL) et nettoie ; écrit un rapport sur stdout. */
export async function runStopReport(cwd: string): Promise<void> {
  const tag = `${ANSI.dim}[stop]${ANSI.reset}`;
  const before = discoverDevProcesses();

  // Idempotent : rien à tuer → on nettoie un éventuel pidfile résiduel et on le dit.
  if (before.length === 0) {
    clearSupervisorPidFile(cwd);
    const ports = await probePorts(defaultDevPorts());
    writeSync(
      1,
      [
        "",
        `${tag} ${ANSI.bold}Nodefony dev — aucune instance en cours (déjà arrêté)${ANSI.reset}`,
        `  ${ANSI.dim}ports${ANSI.reset} : ${portsLine(ports, "libre")}`,
        "",
      ].join("\n") + "\n",
    );
    return;
  }

  const nSup = before.filter((p) => p.role === "supervisor").length;
  const nSrv = before.filter((p) => p.role === "server").length;
  const nVite = before.filter((p) => p.role === "vite").length;
  // Annonce l'intention AVANT de tuer (l'arrêt peut prendre quelques secondes).
  writeSync(
    1,
    `\n${tag} ${ANSI.bold}arrêt de ${before.length} process dev${ANSI.reset}` +
      ` (${nSup} superviseur · ${nSrv} serveur · ${nVite} Vite)…\n`,
  );

  // Group-kill SIGTERM→SIGKILL (logique partagée avec le verrou single-instance).
  const alive = await terminateDevProcesses(before, {
    termWaitMs: TERM_WAIT_MS,
    killWaitMs: 1500,
  });

  clearSupervisorPidFile(cwd);
  const ports = await waitPortsFree(defaultDevPorts(), PORTS_WAIT_MS);

  const verdict =
    alive.length === 0
      ? `${ANSI.green}✓ arrêté proprement${ANSI.reset}`
      : `${ANSI.red}⚠ ${alive.length} process survivent (pid ${alive.join(", ")}) — relance \`nodefony stop\`${ANSI.reset}`;
  writeSync(
    1,
    [
      `  ${verdict}`,
      `  ${ANSI.dim}ports${ANSI.reset} : ${portsLine(ports, "libéré")}`,
      "",
    ].join("\n") + "\n",
  );
}
