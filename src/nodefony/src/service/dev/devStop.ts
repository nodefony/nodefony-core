import { writeSync } from "node:fs";
import path from "node:path";
import {
  clearRuntimeState,
  clearSupervisorPidFile,
  defaultDevPorts,
  detectRuntimeMode,
  discoverDevProcessesDetailed,
  discoverFromRuntimeState,
  formatForeignRuntimes,
  isNodefonyProjectDir,
  probePorts,
  processCwd,
  splitByProject,
  terminateDevProcesses,
  type DevProcessInfo,
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

/**
 * Filtre de `--all` : sans projet de référence, la SEULE preuve restante serait le
 * titre de process. C'est peu pour un `kill -9` trans-projets — un homonyme
 * suffirait. On exige donc une SECONDE preuve, indépendante du nom : le process
 * travaille bien dans un projet Nodefony (`package.json` qui dépend de `nodefony`,
 * ou `node_modules/nodefony`), lui-même ou un ancêtre (un Vite tourne dans le
 * SOUS-dossier de son bundle). Un cwd illisible — process d'un autre utilisateur,
 * `lsof` muet — ne prouve rien : on n'y touche pas.
 *
 * PURE (dépendances injectables) : `--all` tue sans garde-fou de projet, il ne
 * doit pas rester une branche non éprouvée.
 *
 * @param procs - runtimes découverts par `ps`.
 * @param getCwd - lecture du cwd d'un pid (défaut : `processCwd`).
 * @param isProject - test « ce dossier est un projet Nodefony » (défaut : `isNodefonyProjectDir`).
 * @returns `kept` = appartenance PROUVÉE (tuables) ; `rejected` = épargnés + le motif.
 */
export function scopeAllToNodefonyProjects(
  procs: readonly DevProcessInfo[],
  getCwd: (pid: number) => string | null = processCwd,
  isProject: (dir: string) => boolean = isNodefonyProjectDir,
): {
  kept: DevProcessInfo[];
  rejected: { proc: DevProcessInfo; why: string }[];
} {
  const kept: DevProcessInfo[] = [];
  const rejected: { proc: DevProcessInfo; why: string }[] = [];
  for (const p of procs) {
    const cwd = getCwd(p.pid);
    if (cwd === null) {
      rejected.push({ proc: p, why: "cwd illisible" });
      continue;
    }
    let cur = path.resolve(cwd);
    let belongs = false;
    for (;;) {
      if (isProject(cur)) {
        belongs = true;
        break;
      }
      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
    if (belongs) kept.push(p);
    else rejected.push({ proc: p, why: `${cwd} n'est pas un projet Nodefony` });
  }
  return { kept, rejected };
}

/** Applique {@link scopeAllToNodefonyProjects} et ANNONCE les process épargnés. */
function allRuntimesOfThisPoste(
  procs: readonly DevProcessInfo[],
): DevProcessInfo[] {
  const { kept, rejected } = scopeAllToNodefonyProjects(procs);
  if (rejected.length > 0) {
    writeSync(
      1,
      `${ANSI.dim}[stop]${ANSI.reset} ${rejected.length} process au titre Nodefony NON confirmé(s), épargné(s) :\n` +
        rejected
          .map((r) => `  pid ${r.proc.pid} (${r.proc.label}) — ${r.why}`)
          .join("\n") +
        "\n",
    );
  }
  return kept;
}

/** Découvre, tue (SIGTERM→SIGKILL) et nettoie ; écrit un rapport sur stdout. */
export async function runStopReport(
  cwd: string,
  opts: { all?: boolean } = {},
): Promise<void> {
  const tag = `${ANSI.dim}[stop]${ANSI.reset}`;
  const observed = discoverDevProcessesDetailed();
  const discovered = observed.procs;
  const scoped = opts.all
    ? { mine: allRuntimesOfThisPoste(discovered), foreign: [] }
    : splitByProject(discovered, cwd);
  // Quand `ps` n'a pas pu répondre — Windows, mais AUSSI une image Node mince où
  // `procps` n'est pas installé, ce qui est le cas de déploiement nominal — la
  // découverte rend une liste vide qu'on ne peut pas distinguer de « rien ne tourne » :
  // l'arrêt annonçait alors « déjà arrêté » pendant qu'un serveur continuait d'écouter.
  // Le fichier d'état du projet, lui, dit la vérité — et ne désigne QUE ce projet.
  const byState = observed.supported ? [] : discoverFromRuntimeState(cwd);
  if (byState.length > 0) {
    writeSync(
      1,
      `${tag} observation des process indisponible ici — runtime retrouvé par son fichier d'état (pid ${byState[0].pid}).\n`,
    );
  }
  const before = scoped.mine.length > 0 ? scoped.mine : byState;

  // Les runtimes des AUTRES projets : jamais touchés, mais NOMMÉS (le dev sait
  // où aller — jamais un « pourquoi mon port est pris ? » sans réponse).
  if (scoped.foreign.length > 0) {
    // Bloc aéré partagé (1 process/ligne, groupé par projet, commandes exactes).
    writeSync(
      1,
      `${tag} ${scoped.foreign.length} runtime(s) d'un AUTRE projet non touché(s) :\n` +
        formatForeignRuntimes(scoped.foreign).join("\n") +
        "\n",
    );
  }

  // Idempotent : rien à tuer → on nettoie un éventuel pidfile résiduel et on le dit.
  if (before.length === 0) {
    clearSupervisorPidFile(cwd);
    const ports = await probePorts(defaultDevPorts(cwd));
    // « Rien trouvé » ne vaut « déjà arrêté » que si l'on POUVAIT chercher. Là où les
    // process ne s'observent pas et où aucun fichier d'état ne subsiste, un port encore
    // tenu est la seule preuve qui reste — l'annoncer plutôt que déclarer le calme.
    const occupied = ports.filter((p) => p.listening).map((p) => p.port);
    const blind = !observed.supported && occupied.length > 0;
    writeSync(
      1,
      [
        "",
        blind
          ? `${tag} ${ANSI.bold}Nodefony — process non observables ici, mais ${occupied.join(", ")} répond(ent) encore${ANSI.reset}`
          : `${tag} ${ANSI.bold}Nodefony — aucune instance de ce projet en cours (déjà arrêté)${ANSI.reset}`,
        `  ${ANSI.dim}ports${ANSI.reset} : ${portsLine(ports, blind ? "occupé" : "libre")}`,
        ...(blind
          ? [
              `  ${ANSI.dim}un runtime tourne sans fichier d'état — l'arrêter par son PID (Get-Process node)${ANSI.reset}`,
            ]
          : []),
        "",
      ].join("\n") + "\n",
    );
    return;
  }

  // Ports de NOTRE runtime, lus TANT QU'IL EST VIVANT. Après le kill, son state
  // file est purgé (process mort) et `defaultDevPorts` retomberait sur la
  // convention `[5151, 5152]` — qu'un AUTRE projet peut très bien tenir. Le
  // rapport final annoncerait alors « 5151 encore occupé » en montrant du doigt
  // le serveur du voisin, sur un arrêt pourtant impeccable.
  const ourPorts = defaultDevPorts(cwd);

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
  clearRuntimeState(cwd); // plus personne n'écoute : le canal ne doit plus rien dire
  const ports = await waitPortsFree(ourPorts, PORTS_WAIT_MS);

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
