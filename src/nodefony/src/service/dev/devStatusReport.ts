import { writeSync } from "node:fs";
import path from "node:path";
import Cli from "../../Cli";
import {
  defaultDevPorts,
  detectRuntimeMode,
  devSupervisorPidFile,
  discoverDevProcessesDetailed,
  discoverFromRuntimeState,
  foreignPortOwners,
  formatForeignRuntimes,
  formatUptime,
  isNodefonyProjectDir,
  isPidAlive,
  portOwnership,
  probePorts,
  readSupervisorPid,
  runtimeModes,
  splitByProject,
  type DevObservationDeps,
  type DevProcessInfo,
  type DevProcessWithCwd,
  type DiscoverOptions,
  type PortState,
  type RuntimeMode,
} from "./devProcess";
import { buildProjectTable, type IProjectRuntime } from "./devProjects";
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
export async function runStandaloneDevCommand(name: string): Promise<number> {
  const cwd = process.cwd();
  if (name === "status") {
    await runStatusReport(cwd);
    return 0;
  }
  if (name === "stop")
    return runStopReport(cwd, {
      all: process.argv.includes("--all"),
      target: standaloneTarget("stop"),
    });
  return 0;
}

/**
 * Argument positionnel d'une commande standalone, lu sur `process.argv` — le
 * fast-path court AVANT commander, il n'a donc personne pour l'analyser.
 *
 * Seul le premier mot qui suit le nom de la commande et ne commence pas par `-`
 * est retenu ; tout le reste appartient aux options. Rendre `undefined` plutôt
 * qu'une chaîne vide garde la distinction « pas de cible » / « cible vide ».
 *
 * @param name - nom de la commande (`stop`).
 * @returns la cible tapée, ou `undefined`.
 */
function standaloneTarget(name: string): string | undefined {
  const argv = process.argv;
  const at = argv.indexOf(name);
  if (at === -1) return undefined;
  for (const arg of argv.slice(at + 1)) {
    if (!arg.startsWith("-")) return arg;
  }
  return undefined;
}

/**
 * Rapport d'introspection des process dev — forme JSON, SOURCE DE VÉRITÉ unique
 * partagée par le rendu ANSI CLI (`nodefony status`) et le data plane Studio
 * (`GET /nodefony/kernel/api/processes`). CLI et Web affichent EXACTEMENT le même état.
 */
export interface DevStatusReport {
  /**
   * `false` si l'OBSERVATION EXTERNE n'a pas pu être menée — CONSTATÉ, jamais déduit
   * de la plateforme : Windows, mais aussi `ps` absent (images Node minces, distroless,
   * Alpine nu) ou syntaxe refusée (certaines BSD).
   *
   * Ne signifie plus « rapport vide » : le pidfile, le fichier d'état et la sonde TCP
   * répondent partout, donc la topologie et les ports restent rapportés. Le drapeau dit
   * seulement que les colonnes issues de `ps` (mémoire résidente, part CPU, instances
   * Vite) manquent — ce qu'un avertissement du rapport énonce en toutes lettres.
   */
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
  /**
   * Runtimes des AUTRES projets du poste — jamais comptés dans {@link processes},
   * jamais tus. `status` s'attribuait ces process : une application arrêtée
   * s'entendait dire « 4 process · 2/2 ports UP », diagnostic faux et rassurant à
   * tort. Ils sont NOMMÉS avec leur dossier, exactement comme `nodefony stop` le
   * fait — un dev qui cherche qui tient son port a besoin de la réponse.
   */
  readonly foreign: readonly DevProcessWithCwd[];
  /**
   * Ports occupés par un projet identifié qui n'est PAS le nôtre (port → racine).
   * Sépare « pas à moi » de « pas mort » : sans cette table, un port du voisin se
   * lit comme un serveur à nous, ou comme un arrêt qui a échoué.
   */
  readonly portOwners: Readonly<Record<number, string>>;
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
  /**
   * `true` si `ps` a réellement répondu — verdict fourni par l'appelant. Paramètre et
   * non lecture d'environnement : la fonction reste PURE, et un test peut éprouver
   * depuis n'importe quel système ce que dit un rapport privé d'observation.
   */
  discoverySupported = true,
  /**
   * Runtimes des AUTRES projets, déjà écartés de `procs` par l'appelant — la
   * partition coûte un `lsof` par pid hors Linux (mesuré à plus d'une seconde pour
   * un seul process), elle se fait donc UNE fois, là où les syscalls ont lieu.
   */
  foreign: readonly DevProcessWithCwd[] = [],
  /**
   * `true` si le rattachement au projet n'a pas pu être établi (répertoire courant
   * des pids illisible) : `procs` est alors la liste GLOBALE du poste, et le rapport
   * doit l'annoncer plutôt que laisser croire à un décompte scopé.
   */
  projectScopeBlind = false,
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
  // Restreint à CE projet : un dev ici + un prod dans le dossier d'à côté n'a rien
  // d'anormal (chacun ses ports, cf `servers.portPolicy: "auto"`).
  //
  // `procs` NE CONTIENT QUE nos process — la partition par projet est faite par
  // l'appelant, une seule fois : `splitByProject` demande au système le répertoire
  // courant de chaque pid, ce qui coûte un `lsof` hors Linux (mesuré à plus d'une
  // seconde pour un seul process). La faire ICI, en plus, coûtait deux fois le même
  // prix — et surtout n'écartait les étrangers QUE des avertissements : le décompte,
  // les ports et le drapeau `running`, eux, comptaient l'application du voisin.
  const modes = runtimeModes(procs);
  if (modes.size > 1)
    warnings.push(
      `${modes.size} runtimes Nodefony cohabitent sur CE projet ` +
        `(${[...modes].join(" + ")}) — anormal : \`nodefony stop\` pour tout arrêter`,
    );

  // « Empilement » = plusieurs runtimes DE CE PROJET. Depuis que les ports se
  // replient tout seuls (`servers.portPolicy: "auto"`), faire tourner deux apps
  // Nodefony en parallèle est NORMAL — `ps` voit alors 2 superviseurs et 2
  // serveurs, et un compte GLOBAL criait « anormal » sur une situation saine.
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
    warnings.push(
      `${nSup} superviseurs simultanés sur CE projet — empilement anormal`,
    );
  if (nMaster > 1)
    warnings.push(
      `${nMaster} masters cluster simultanés sur CE projet — empilement anormal`,
    );
  // Plusieurs `server` (rôle prod/dev mono) = empilement ; les workers cluster (rôle
  // distinct) sont, eux, attendus en nombre → exclus de ce contrôle.
  if (nSrv > 1)
    warnings.push(
      `${nSrv} serveurs simultanés sur CE projet — empilement anormal`,
    );

  // Dire d'OÙ vient l'information : un tableau sans mémoire ni CPU, affiché sans un mot,
  // se lit comme un serveur au repos plutôt que comme une mesure absente.
  if (!discoverySupported && procs.length > 0)
    warnings.push(
      "process non observables ici (`ps` indisponible) — topologie lue dans le pidfile et le fichier d'état (ni RSS, ni %CPU, ni Vite)",
    );
  // Fail-loud : mieux vaut une liste trop large ANNONCÉE qu'un « aucune instance »
  // faux. Le décompte ci-dessous porte sur tout le poste, pas sur ce projet.
  if (projectScopeBlind)
    warnings.push(
      "appartenance au projet indéterminable (répertoire courant des process illisible — `lsof` absent ?) — liste GLOBALE du poste, `nodefony stop` n'agira que sur ce projet",
    );

  return {
    supported: discoverySupported,
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
    foreign,
    portOwners: foreignPortOwners(foreign),
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
  opts: DiscoverOptions & DevObservationDeps = {},
): Promise<DevStatusReport> {
  const pid = readSupervisorPid(cwd);
  // Là où les process ne s'observent pas, on ne rend plus un rapport VIDE : c'était se
  // taire au moment précis où l'on a besoin de savoir ce qui tourne. Le pidfile, le
  // fichier d'état et la sonde TCP ne dépendent d'aucun `ps` — ils répondent partout.
  const observed = (opts.discover ?? discoverDevProcessesDetailed)(opts);
  // Le balayage `ps` est GLOBAL au poste : il faut le ramener à CE projet, sinon on
  // rapporte l'application du voisin comme la sienne. Le repli par fichier d'état,
  // lui, est déjà scopé par construction (le fichier vit sous notre racine).
  const scoped = observed.supported
    ? splitByProject(observed.procs, cwd, opts.getCwd)
    : {
        mine: discoverFromRuntimeState(cwd),
        foreign: [] as DevProcessWithCwd[],
      };
  // Le rattachement à un projet repose sur le répertoire courant d'un pid — une
  // capacité qui se CONSTATE : `lsof` peut manquer (image mince), le lien
  // `/proc/<pid>/cwd` être refusé. Aucun process rattaché alors qu'il en tourne =
  // l'attribution est AVEUGLE, pas « rien à moi ». Écarter dans ce cas serait
  // annoncer « aucune instance » pendant que le serveur répond — un mensonge pire
  // que celui qu'on corrige. On rend alors la liste GLOBALE et on le DIT (warning).
  const cwdBlind =
    observed.procs.length > 0 &&
    scoped.mine.length === 0 &&
    scoped.foreign.every((p) => p.cwd === null);
  const ports = await (opts.probe ?? probePorts)(defaultDevPorts(cwd));
  return buildDevStatus(
    cwd,
    pid,
    pid !== null && isPidAlive(pid),
    cwdBlind ? observed.procs : scoped.mine,
    ports,
    isNodefonyProjectDir(cwd),
    observed.supported,
    cwdBlind ? [] : scoped.foreign,
    cwdBlind,
  );
}

/** Collecte (ps + ports + pidfile) puis écrit le rapport status sur stdout. */
export async function runStatusReport(
  cwd: string,
  deps: DevObservationDeps = {},
): Promise<void> {
  // CLI standalone : le process appelant n'est PAS un process dev → `includeSelf` neutre.
  const report = await collectDevStatus(cwd, deps);
  const lines: string[] = [];
  // La table n'est composée QUE pour l'affichage CLI, et seulement s'il y a un
  // voisin : sans projet étranger elle n'apprendrait rien, et son coût (un
  // `package.json` lu par projet) ne se paierait pour personne.
  const projects =
    report.foreign.length > 0
      ? buildProjectTable(
          cwd,
          report.processes,
          report.foreign,
          report.ports.filter((p) => p.listening).map((p) => p.port),
        )
      : [];
  // Les ports d'un voisin se SONDENT, comme les nôtres : c'est une connexion TCP
  // locale, et un projet dont le serveur est vivant mérite mieux qu'un « déclaré »
  // qui laisse croire au doute. Ne restent « déclarés » que les ports qu'aucune
  // sonde n'a pu atteindre.
  const portsVoisins = [
    ...new Set(projects.filter((p) => !p.current).flatMap((p) => p.ports)),
  ].filter((port) => !report.ports.some((p) => p.port === port));
  const sondesVoisines =
    portsVoisins.length > 0
      ? await (deps.probe ?? probePorts)(portsVoisins)
      : [];
  renderStatus(lines, report, projects, sondesVoisines);
  // UN écrit synchrone (writeSync) → jamais tronqué par l'exit qui suit.
  (deps.write ?? ((chunk: string) => writeSync(1, chunk)))(
    lines.join("\n") + "\n",
  );
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

/**
 * Bloc des runtimes ÉTRANGERS — même mise en forme que `nodefony stop` (une seule
 * implémentation, `formatForeignRuntimes`), y compris les commandes exactes pour
 * aller les arrêter. `status` les taisait tout en les COMPTANT comme les siens : le
 * dev voyait « 4 process » sans savoir qu'aucun n'était à lui.
 */
function renderForeign(
  lines: string[],
  report: DevStatusReport,
  /**
   * Table des projets vivants. Vide par défaut : un appelant qui ne la fournit
   * pas obtient EXACTEMENT le rendu d'avant — le bloc est un ajout, jamais une
   * réécriture de ce rendu.
   */
  projects: readonly IProjectRuntime[] = [],
  sondesVoisines: readonly PortState[] = [],
): void {
  if (report.foreign.length === 0) return;
  // Un projet voisin se lit comme le nôtre : MÊME tableau, sous son nom. La liste
  // à plat qu'affichait `status` répétait ce que les blocs disent déjà, et le
  // lecteur devait recouper trois endroits pour répondre à « qui tient mon port ».
  const voisins = projects.filter((p) => !p.current);
  if (voisins.length === 0) {
    lines.push(
      `  ${ANSI.dim}${report.foreign.length} runtime(s) d'un AUTRE projet sur ce poste (non comptés ci-dessus) :${ANSI.reset}`,
      ...formatForeignRuntimes(report.foreign).map(
        (l) => `${ANSI.dim}${l}${ANSI.reset}`,
      ),
    );
    return;
  }
  // Les sondes DÉJÀ faites sont transmises : ce sont les mêmes ports, il n'y a
  // aucune raison de les présenter deux fois avec deux degrés de certitude.
  for (const projet of voisins)
    renderProjectBlock(
      lines,
      projet,
      [...report.ports, ...sondesVoisines],
      report.portOwners,
    );
}

/**
 * Bloc d'UN projet : son nom, sa racine, ses process, ses ports.
 *
 * Le projet courant et un voisin s'affichent pareil — la seule différence est le
 * repère `▸` et le fait que NOS ports sont sondés quand ceux d'un voisin sont
 * seulement DÉCLARÉS (il publie son état, on ne va pas frapper à sa porte). Cette
 * nuance est écrite plutôt que gommée : un port « déclaré » n'est pas un port
 * vérifié, et laisser croire l'inverse est le genre de raccourci qui fait
 * chercher une panne au mauvais endroit.
 */
function renderProjectBlock(
  lines: string[],
  projet: IProjectRuntime,
  /** États sondés — fournis pour NOTRE projet seulement. */
  sondes: readonly PortState[] = [],
  owners: Readonly<Record<number, string>> = {},
): void {
  const marque = projet.current
    ? `${ANSI.cyan}▸ ${ANSI.bold}${projet.name}${ANSI.reset} ${ANSI.dim}— ce projet${ANSI.reset}`
    : `  ${ANSI.bold}${projet.name}${ANSI.reset}`;
  const source =
    projet.nameSource === "dossier"
      ? ` ${ANSI.dim}(nom du dossier — aucun nom dans package.json)${ANSI.reset}`
      : "";
  lines.push(
    "",
    `  ${marque}${source}`,
    `    ${ANSI.dim}${projet.root}${ANSI.reset}`,
  );
  if (projet.procs.length > 0) renderProcessTable(lines, projet.procs, "    ");

  // Un port dont la SONDE a déjà répondu ne se présente pas comme « non sondé » :
  // le rapport porte l'état de tous les ports qu'il a interrogés, et `portOwners`
  // dit à qui ils appartiennent. Annoncer « déclaré, non sondé » un port que la
  // ligne du dessus donne pour occupé est un mensonge du rapport sur lui-même —
  // exactement le genre d'écart qui fait douter de tout le reste.
  const rendus = projet.ports.map((port) => {
    const sonde = sondes.find((s) => s.port === port);
    const tenuPar = owners[port];
    // Un port déclaré par ce projet mais attribué à un AUTRE trahit un état
    // périmé : le dire plutôt que rendre un verdict qui semblerait le sien.
    if (tenuPar !== undefined && tenuPar !== projet.root)
      return `${port} ${ANSI.yellow}tenu par ${tenuPar}${ANSI.reset}`;
    if (sonde)
      return sonde.listening
        ? `${port} ${ANSI.green}✓ écoute${ANSI.reset}`
        : `${port} ${ANSI.red}✗ silencieux${ANSI.reset}`;
    return `${port} ${ANSI.dim}déclaré${ANSI.reset}`;
  });
  if (rendus.length > 0)
    lines.push(`    ${ANSI.dim}ports${ANSI.reset}   ${rendus.join("   ")}`);
  if (rendus.some((r) => r.includes("déclaré")))
    lines.push(
      `    ${ANSI.dim}        « déclaré » = publié par le projet, pas sondé par cette commande${ANSI.reset}`,
    );
}

/**
 * Résumé de fin — ce que le lecteur doit retenir, et le geste qui suit.
 *
 * Il n'est écrit QUE si un voisin existe : dans le cas nominal (une seule
 * application), expliquer le cloisonnement serait du bruit. C'est l'inverse qui
 * a coûté cher — voir « aucune instance » avec un serveur qui répond, sans que
 * rien ne dise que les deux phrases parlent de projets différents.
 */
function renderSummary(
  lines: string[],
  report: DevStatusReport,
  projects: readonly IProjectRuntime[],
): void {
  const voisins = projects.filter((p) => !p.current);
  if (voisins.length === 0) return;
  const nVoisinProcs = voisins.reduce((n, p) => n + p.procs.length, 0);
  const aMoi = report.processes.length;
  const portsUp = report.ports.filter((p) => p.listening).length;
  const pluriel = voisins.length > 1 ? "s" : "";
  lines.push(
    "",
    `  ${ANSI.bold}Résumé${ANSI.reset}`,
    `    ce projet : ${aMoi === 0 ? `${ANSI.yellow}rien ne tourne${ANSI.reset}` : `${aMoi} process · ${portsUp}/${report.ports.length} ports en écoute`}`,
    `    voisin${pluriel}   : ${voisins.length} projet${pluriel} · ${nVoisinProcs} process`,
    // L'explication suit la SITUATION : rappeler ce que « aucune instance » veut
    // dire à quelqu'un dont l'application tourne serait répondre à côté.
    ...(aMoi === 0
      ? [
          `    ${ANSI.dim}status et stop ne voient QUE ce projet : « aucune instance » signifie${ANSI.reset}`,
          `    ${ANSI.dim}« aucune à MOI », jamais « rien ne tourne sur ce poste ».${ANSI.reset}`,
        ]
      : [
          `    ${ANSI.dim}les process du haut sont ceux de CE projet ; le${pluriel} voisin${pluriel} n'${voisins.length > 1 ? "en font" : "en fait"} pas partie${ANSI.reset}`,
          `    ${ANSI.dim}et ${voisins.length > 1 ? "ne sont" : "n'est"} ni compté${pluriel} dans la synthèse, ni arrêté${pluriel} par ${ANSI.reset}${ANSI.cyan}nodefony stop${ANSI.reset}${ANSI.dim}.${ANSI.reset}`,
        ]),
    `    ${ANSI.dim}arrêter un voisin, sans changer de dossier : ${ANSI.reset}${ANSI.cyan}nodefony stop ${voisins[0].name}${ANSI.reset}`,
  );
}

/**
 * Ligne d'état des ports. `listening` seul ne dit pas à QUI : un port tenu par le
 * projet voisin s'affichait `✓ UP` sous le titre de notre application. Le
 * propriétaire connu est donc nommé, et un port étranger n'est jamais un verdict
 * sur notre runtime.
 */
function portsLine(
  ports: readonly PortState[],
  owners: Readonly<Record<number, string>>,
  upLabel: string,
  freeLabel: string,
): string {
  return ports
    .map((p) => {
      switch (portOwnership(p, owners)) {
        case "free":
          return `${p.port} ${freeLabel}`;
        case "foreign":
          return `${p.port} ${ANSI.yellow}occupé par ${owners[p.port]}${ANSI.reset}`;
        default:
          return `${p.port} ${upLabel}`;
      }
    })
    .join("   ");
}

/**
 * Rend le {@link DevStatusReport} en ANSI (tableau + ports + synthèse + warnings)
 * dans `lines`.
 *
 * `projects` est FACULTATIF : omis, le rendu est identique à celui d'avant. Il
 * n'entre pas dans {@link DevStatusReport} parce que le rapport est aussi le
 * contrat du data plane — nommer les projets exige de lire un `package.json` par
 * projet voisin, un coût que la console d'administration n'a pas demandé.
 */
function renderStatus(
  lines: string[],
  report: DevStatusReport,
  projects: readonly IProjectRuntime[] = [],
  /** États des ports des projets VOISINS, réellement sondés par l'appelant. */
  sondesVoisines: readonly PortState[] = [],
): void {
  const tag = `${ANSI.dim}[status]${ANSI.reset}`;
  const { processes: procs } = report;

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
    // Quand des projets voisins sont détaillés plus bas, deux lignes deviennent du
    // BRUIT et l'une d'elles trompe : le pidfile d'un dossier qui n'est pas un
    // projet ne veut rien dire, et « 5151 occupé par <racine> » redit — moins bien
    // — ce que le bloc de ce projet montre avec ses process et ses ports sondés.
    const detaille = projects.some((p) => !p.current);
    lines.push(
      "",
      `${tag} ${ANSI.bold}Nodefony dev — aucune instance de ce projet en cours${ANSI.reset}`,
      ...(report.inProject
        ? [
            `  ${ANSI.dim}pidfile${ANSI.reset}  ${report.pidfile.path} — ${pidNote}`,
          ]
        : []),
      ...(detaille
        ? []
        : [
            `  ${ANSI.dim}ports${ANSI.reset}    ${portsLine(
              report.ports,
              report.portOwners,
              `${ANSI.yellow}occupé${ANSI.reset}`,
              `${ANSI.dim}libre${ANSI.reset}`,
            )}`,
          ]),
      // Hors projet, « lance nodefony dev » serait un conseil voué à l'échec →
      // dire la vraie situation (dossier sans app Nodefony) + les 2 sorties.
      report.inProject
        ? `  ${ANSI.dim}→ lance ${ANSI.reset}${ANSI.cyan}nodefony dev${ANSI.reset}${ANSI.dim} pour démarrer${ANSI.reset}`
        : `  ${ANSI.yellow}⚠ ce dossier n'est pas un projet Nodefony${ANSI.reset}${ANSI.dim} (aucun package.json avec la dépendance « nodefony »)${ANSI.reset}\n` +
            `  ${ANSI.dim}→ place-toi à la racine d'une app, ou crée-en une : ${ANSI.reset}${ANSI.cyan}nodefony create app${ANSI.reset}`,
    );
    renderForeign(lines, report, projects, sondesVoisines);
    renderSummary(lines, report, projects);
    lines.push("");
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
    `  ${ANSI.dim}ports serveur${ANSI.reset} : ${portsLine(
      report.ports,
      report.portOwners,
      `${ANSI.green}✓ UP${ANSI.reset}`,
      `${ANSI.red}✗ DOWN${ANSI.reset}`,
    )}`,
    `  ${ANSI.dim}synthèse${ANSI.reset}      : ${summaryLine(report)}`,
  );
  for (const w of report.warnings)
    lines.push(`  ${ANSI.yellow}⚠ ${w}${ANSI.reset}`);
  renderForeign(lines, report, projects, sondesVoisines);
  renderSummary(lines, report, projects);
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
