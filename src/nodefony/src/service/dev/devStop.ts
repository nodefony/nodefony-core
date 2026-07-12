import { writeSync } from "node:fs";
import {
  clearSupervisorPidFile,
  defaultDevPorts,
  detectRuntimeMode,
  discoverDevProcesses,
  probePorts,
  splitByProject,
  terminateDevProcesses,
  type PortState,
  type RuntimeMode,
} from "./devProcess";

/**
 * Commande `nodefony stop` — arrêt PROPRE et COMPLET de tout runtime Nodefony (dev,
 * production mono, cluster) **du PROJET courant** ; remplace le `pkill -9` manuel.
 * Standalone : aucun boot kernel, aucune trunk requise → lançable de n'importe où
 * (cf le fast-path de `CliKernel.start`).
 *
 * MULTI-PROJET : plusieurs apps Nodefony peuvent tourner sur le même poste — le
 * balayage `ps` étant global, `stop` ne tue QUE les process dont le cwd est CE
 * projet (`splitByProject`) ; les autres sont LISTÉS avec leur dossier (le dev
 * sait où aller les arrêter). `--all` = comportement trans-projets explicite.
 *
 * Stratégie : vérité = `ps` (pas le seul pidfile). On tue les GROUPES « racines » (un
 * process dont le parent n'est pas dans la liste) — group-kill du superviseur/master
 * emporte déjà ses enfants (serveur + Vite, ou workers) ; un orphelin (pidfile périmé)
 * est sa propre racine et tombe aussi. SIGTERM (arrêt gracieux — déclenche le graceful
 * shutdown du ClusterManager pour un master) puis SIGKILL des récalcitrants un à un.
 */

/** Libellé du mode runtime pour les messages (`dev`/`production`/`cluster`). */
function runtimeLabel(mode: RuntimeMode | null): string {
  if (mode === "prod") return "production";
  if (mode === "cluster") return "cluster";
  if (mode === "dev") return "dev";
  return "runtime";
}

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
export async function runStopReport(
  cwd: string,
  opts: { all?: boolean } = {},
): Promise<void> {
  const tag = `${ANSI.dim}[stop]${ANSI.reset}`;
  const discovered = discoverDevProcesses();
  const scoped = opts.all
    ? { mine: [...discovered], foreign: [] }
    : splitByProject(discovered, cwd);
  const before = scoped.mine;

  // Les runtimes des AUTRES projets : jamais touchés, mais NOMMÉS (le dev sait
  // où aller — jamais un « pourquoi mon port est pris ? » sans réponse).
  if (scoped.foreign.length > 0) {
    const who = scoped.foreign
      .map((p) => `pid ${p.pid} (${p.cwd ?? "dossier inconnu"})`)
      .join(", ");
    writeSync(
      1,
      `${tag} ${scoped.foreign.length} runtime(s) d'un AUTRE projet non touché(s) : ${who}\n` +
        `${tag} pour les arrêter : \`nodefony stop\` depuis LEUR dossier, ou \`nodefony stop --all\`\n`,
    );
  }

  // Idempotent : rien à tuer → on nettoie un éventuel pidfile résiduel et on le dit.
  if (before.length === 0) {
    clearSupervisorPidFile(cwd);
    const ports = await probePorts(defaultDevPorts());
    writeSync(
      1,
      [
        "",
        `${tag} ${ANSI.bold}Nodefony — aucune instance de ce projet en cours (déjà arrêté)${ANSI.reset}`,
        `  ${ANSI.dim}ports${ANSI.reset} : ${portsLine(ports, "libre")}`,
        "",
      ].join("\n") + "\n",
    );
    return;
  }

  // Décompte par rôle (segments non-nuls) → message adapté à dev / prod / cluster.
  const mode = runtimeLabel(detectRuntimeMode(before));
  const count = (role: string): number =>
    before.filter((p) => p.role === role).length;
  const seg: string[] = [];
  for (const [role, word] of [
    ["supervisor", "superviseur"],
    ["master", "master"],
    ["worker", "worker"],
    ["server", "serveur"],
    ["vite", "Vite"],
  ] as const) {
    const n = count(role);
    if (n) seg.push(`${n} ${word}`);
  }
  // Annonce l'intention AVANT de tuer (l'arrêt peut prendre quelques secondes).
  writeSync(
    1,
    `\n${tag} ${ANSI.bold}arrêt de ${before.length} process ${mode}${ANSI.reset}` +
      ` (${seg.join(" · ")})…\n`,
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
