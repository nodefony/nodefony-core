import { writeSync } from "node:fs";
import path from "node:path";
import {
  clearRuntimeState,
  clearSupervisorPidFile,
  defaultDevPorts,
  detectRuntimeMode,
  discoverDevProcessesDetailed,
  discoverFromRuntimeState,
  foreignPortOwners,
  formatForeignRuntimes,
  isNodefonyProjectDir,
  portOwnership,
  probePorts,
  processCwd,
  readRuntimeState,
  splitByProject,
  terminateDevProcesses,
  type DevObservationDeps,
  type DevProcessInfo,
  type DevProcessWithCwd,
  type PortState,
  type RuntimeMode,
} from "./devProcess";
import {
  buildProjectTable,
  formatProjectTable,
  resolveProjectTarget,
} from "./devProjects";

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
  probe: (ports: readonly number[]) => Promise<PortState[]> = probePorts,
): Promise<PortState[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const states = await probe(ports);
    if (states.every((s) => !s.listening)) return states;
    if (Date.now() >= deadline) return states;
    await delay(150);
  }
}

/**
 * Ligne d'état des ports après (ou faute d') arrêt.
 *
 * `✗ encore occupé` est un VERDICT D'ÉCHEC : il dit « je n'ai pas réussi à libérer
 * ce port ». Il ne doit donc jamais tomber sur un port qui n'est pas le nôtre —
 * `stop` venait d'annoncer lui-même que ces runtimes appartenaient à un AUTRE projet,
 * puis marquait leurs ports en rouge : deux phrases qui se contredisent dans le même
 * rapport. Un propriétaire identifié ({@link foreignPortOwners}) est donc NOMMÉ, et
 * un port occupé sans propriétaire connu reste un échec quand on a tué quelque chose.
 *
 * @param states - ports sondés.
 * @param freeLabel - libellé (déjà coloré) d'un port que personne ne tient.
 * @param occupiedLabel - libellé d'un port tenu par un propriétaire INCONNU. C'est
 *   l'appelant qui sait s'il s'agit d'un échec : après avoir tué nos process, oui ;
 *   avant d'avoir tué quoi que ce soit, non.
 * @param owners - port → projet étranger qui le tient.
 */
const portsLine = (
  states: readonly PortState[],
  freeLabel: string,
  occupiedLabel: string,
  owners: Record<number, string> = {},
): string =>
  states
    .map((p) => {
      switch (portOwnership(p, owners)) {
        case "free":
          return `${p.port} ${freeLabel}`;
        case "foreign":
          return `${p.port} ${ANSI.yellow}occupé par ${owners[p.port]}${ANSI.reset}`;
        default:
          return `${p.port} ${occupiedLabel}`;
      }
    })
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

/**
 * Racines des projets auxquels appartiennent `procs` — dédupliquées.
 *
 * Sert à `--all` pour savoir QUELS ports vérifier après un arrêt trans-projets :
 * un port qu'on ne sonde pas ne peut ni confirmer ni infirmer l'arrêt, et le
 * rapport concluait « ✓ arrêté proprement » sans avoir regardé les trois quarts
 * des ports qu'il venait de libérer.
 *
 * Fonction PURE (lecture du cwd injectable). Les rôles Vite sont ignorés : ils
 * travaillent parfois dans un sous-dossier, et leur parent porte déjà la racine.
 *
 * @param procs - runtimes sur le point d'être arrêtés.
 * @param getCwd - lecture du répertoire courant d'un pid.
 * @returns les racines distinctes, sans celles qu'on n'a pas pu lire.
 */
export function hostProjects(
  procs: readonly DevProcessInfo[],
  getCwd: (pid: number) => string | null = processCwd,
): string[] {
  const roots = new Set<string>();
  for (const p of procs) {
    if (p.role === "vite") continue;
    const cwd = getCwd(p.pid);
    if (cwd) roots.add(path.resolve(cwd));
  }
  return [...roots];
}

/** Applique {@link scopeAllToNodefonyProjects} et ANNONCE les process épargnés. */
function allRuntimesOfThisPoste(
  procs: readonly DevProcessInfo[],
  write: (chunk: string) => void,
): DevProcessInfo[] {
  const { kept, rejected } = scopeAllToNodefonyProjects(procs);
  if (rejected.length > 0) {
    write(
      `${ANSI.dim}[stop]${ANSI.reset} ${rejected.length} process au titre Nodefony NON confirmé(s), épargné(s) :\n` +
        rejected
          .map((r) => `  pid ${r.proc.pid} (${r.proc.label}) — ${r.why}`)
          .join("\n") +
        "\n",
    );
  }
  return kept;
}

/**
 * Découvre, tue (SIGTERM→SIGKILL) et nettoie ; écrit un rapport sur stdout.
 *
 * `opts.target` désigne un AUTRE projet par son nom ou son chemin — strictement
 * l'équivalent de `cd <projet> && nodefony stop`, obtenu en substituant la racine
 * visée au répertoire courant : une seule mécanique d'arrêt, jamais deux.
 *
 * @returns le code de sortie — `0` si l'arrêt a eu lieu (ou n'avait rien à faire),
 *   `1` si la cible n'a pas pu être DÉSIGNÉE sans ambiguïté. Un `stop` qui n'a rien
 *   arrêté parce qu'il n'a pas compris la cible ne doit pas se lire comme un succès
 *   dans un script.
 */
export async function runStopReport(
  cwd: string,
  opts: { all?: boolean; target?: string } & DevObservationDeps = {},
): Promise<number> {
  const tag = `${ANSI.dim}[stop]${ANSI.reset}`;
  const write = opts.write ?? ((chunk: string) => writeSync(1, chunk));
  const probe = opts.probe ?? probePorts;
  const observed = (opts.discover ?? discoverDevProcessesDetailed)({});
  const discovered = observed.procs;

  // ── Cible explicite : la résoudre AVANT tout, et REFUSER si elle est douteuse.
  // Rien n'est tué tant que la désignation n'est pas certaine — un arrêt est
  // irréversible, et « le plus proche » ferait tomber le mauvais serveur.
  let root = cwd;
  if (opts.target !== undefined && opts.target !== "") {
    if (opts.all) {
      write(
        `\n${tag} ${ANSI.yellow}\`--all\` et une cible sont contradictoires${ANSI.reset} — choisis l'un ou l'autre.\n\n`,
      );
      return 1;
    }
    const here = splitByProject(discovered, cwd, opts.getCwd);
    const projects = buildProjectTable(
      cwd,
      here.mine,
      here.foreign,
      (await probe(defaultDevPorts(cwd)))
        .filter((p) => p.listening)
        .map((p) => p.port),
    );
    // Le rattachement d'un process à son projet est une CAPACITÉ, pas un acquis :
    // il repose sur le répertoire courant d'un pid, que `lsof` fournit — absent
    // sous Windows et sur les images Node minces. Sans lui, aucune racine n'est
    // connue : répondre « aucun projet ne s'appelle X » serait affirmer une
    // absence là où l'on n'a rien pu regarder, et un développeur Windows en
    // conclurait que son application est éteinte. On ÉNONCE la cécité, et on
    // renvoie vers les deux voies qui n'en dépendent pas.
    const aveugle =
      projects.length === 0 &&
      discovered.length > 0 &&
      here.foreign.every((p) => p.cwd === null);
    if (aveugle) {
      write(
        [
          "",
          `${tag} ${ANSI.yellow}impossible de rattacher les process à un projet ici${ANSI.reset}`,
          `  ${ANSI.dim}${discovered.length} runtime(s) Nodefony tournent, mais leur répertoire de travail${ANSI.reset}`,
          `  ${ANSI.dim}n'est pas lisible (\`lsof\` absent ? Windows ?) — une cible par NOM est${ANSI.reset}`,
          `  ${ANSI.dim}donc indécidable, et rien ne sera arrêté au hasard.${ANSI.reset}`,
          `  ${ANSI.dim}→ ${ANSI.reset}${ANSI.bold}cd <projet> && nodefony stop${ANSI.reset}${ANSI.dim}, ou ${ANSI.reset}${ANSI.bold}nodefony stop --all${ANSI.reset}`,
          "",
        ].join("\n") + "\n",
      );
      return 1;
    }
    const resolved = resolveProjectTarget(opts.target, projects);
    if (!resolved.ok) {
      write(
        [
          "",
          resolved.reason === "inconnu"
            ? `${tag} ${ANSI.yellow}aucun projet Nodefony en cours ne s'appelle « ${opts.target} »${ANSI.reset}`
            : `${tag} ${ANSI.yellow}« ${opts.target} » désigne ${resolved.candidates.length} projets — donne le chemin complet${ANSI.reset}`,
          ...(resolved.candidates.length > 0
            ? formatProjectTable(resolved.candidates)
            : [
                `  ${ANSI.dim}(aucun runtime Nodefony observé sur ce poste)${ANSI.reset}`,
              ]),
          "",
        ].join("\n") + "\n",
      );
      return 1;
    }
    root = resolved.project.root;
    write(
      `${tag} cible : ${ANSI.bold}${resolved.project.name}${ANSI.reset} ${ANSI.dim}(${root})${ANSI.reset}\n`,
    );
  }
  cwd = root;

  const scoped = opts.all
    ? {
        mine: allRuntimesOfThisPoste(discovered, write),
        foreign: [] as DevProcessWithCwd[],
      }
    : splitByProject(discovered, cwd, opts.getCwd);
  // Quand `ps` n'a pas pu répondre — Windows, mais AUSSI une image Node mince où
  // `procps` n'est pas installé, ce qui est le cas de déploiement nominal — la
  // découverte rend une liste vide qu'on ne peut pas distinguer de « rien ne tourne » :
  // l'arrêt annonçait alors « déjà arrêté » pendant qu'un serveur continuait d'écouter.
  // Le fichier d'état du projet, lui, dit la vérité — et ne désigne QUE ce projet.
  const byState = observed.supported ? [] : discoverFromRuntimeState(cwd);
  if (byState.length > 0) {
    write(
      `${tag} observation des process indisponible ici — runtime retrouvé par son fichier d'état (pid ${byState[0].pid}).\n`,
    );
  }
  const before = scoped.mine.length > 0 ? scoped.mine : byState;

  // Les runtimes des AUTRES projets : jamais touchés, mais NOMMÉS (le dev sait
  // où aller — jamais un « pourquoi mon port est pris ? » sans réponse).
  if (scoped.foreign.length > 0) {
    // Bloc aéré partagé (1 process/ligne, groupé par projet, commandes exactes).
    write(
      `${tag} ${scoped.foreign.length} runtime(s) d'un AUTRE projet non touché(s) :\n` +
        formatForeignRuntimes(scoped.foreign).join("\n") +
        "\n",
    );
  }

  // À QUI sont les ports que nous allons sonder, si ce n'est pas à nous. Calculé une
  // fois, servi aux deux issues (rien à arrêter / arrêt effectué).
  const owners = foreignPortOwners(scoped.foreign);

  // Idempotent : rien à tuer → on nettoie un éventuel pidfile résiduel et on le dit.
  if (before.length === 0) {
    clearSupervisorPidFile(cwd);
    const ports = await probe(defaultDevPorts(cwd));
    // « Rien trouvé » ne vaut « déjà arrêté » que si l'on POUVAIT chercher. Là où les
    // process ne s'observent pas et où aucun fichier d'état ne subsiste, un port encore
    // tenu est la seule preuve qui reste — l'annoncer plutôt que déclarer le calme.
    const occupied = ports.filter((p) => p.listening).map((p) => p.port);
    const blind = !observed.supported && occupied.length > 0;
    write(
      [
        "",
        blind
          ? `${tag} ${ANSI.bold}Nodefony — process non observables ici, mais ${occupied.join(", ")} répond(ent) encore${ANSI.reset}`
          : `${tag} ${ANSI.bold}Nodefony — aucune instance de ce projet en cours (déjà arrêté)${ANSI.reset}`,
        // Rien n'a été tué ici : un port occupé n'est donc l'échec de RIEN — sauf
        // là où l'on ne peut pas observer les process, où il reste la seule preuve
        // qu'un runtime à nous tourne encore (cas `blind`, annoncé au-dessus).
        `  ${ANSI.dim}ports${ANSI.reset} : ${portsLine(
          ports,
          `${ANSI.green}libre${ANSI.reset}`,
          blind
            ? `${ANSI.yellow}occupé — un runtime répond encore${ANSI.reset}`
            : `${ANSI.yellow}occupé (pas par ce projet)${ANSI.reset}`,
          owners,
        )}`,
        ...(blind
          ? [
              `  ${ANSI.dim}un runtime tourne sans fichier d'état — l'arrêter par son PID (Get-Process node)${ANSI.reset}`,
            ]
          : []),
        "",
      ].join("\n") + "\n",
    );
    return 0;
  }

  // Ports de NOTRE runtime, lus TANT QU'IL EST VIVANT. Après le kill, son state
  // file est purgé (process mort) et `defaultDevPorts` retomberait sur la
  // convention `[5151, 5152]` — qu'un AUTRE projet peut très bien tenir. Le
  // rapport final annoncerait alors « 5151 encore occupé » en montrant du doigt
  // le serveur du voisin, sur un arrêt pourtant impeccable.
  // `--all` tue les runtimes de TOUS les projets du poste : ne sonder que les
  // nôtres, c'était conclure « ✓ arrêté proprement » sur une preuve partielle —
  // mesuré, 6 process de deux projets tués et 2 ports vérifiés sur 4. Les ports
  // des autres projets se lisent ici, TANT QUE leurs process vivent : après le
  // kill, leur fichier d'état est parti avec eux.
  const ourPorts = opts.all
    ? [
        ...new Set([
          ...defaultDevPorts(cwd),
          ...hostProjects(before, opts.getCwd).flatMap(
            (projectRoot) =>
              readRuntimeState(projectRoot, { purgeStale: false })?.ports ?? [],
          ),
        ]),
      ]
    : defaultDevPorts(cwd);

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
  write(
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
  const ports = await waitPortsFree(ourPorts, PORTS_WAIT_MS, probe);

  const verdict =
    alive.length === 0
      ? `${ANSI.green}✓ arrêté proprement${ANSI.reset}`
      : `${ANSI.red}⚠ ${alive.length} process survivent (pid ${alive.join(", ")}) — relance \`nodefony stop\`${ANSI.reset}`;
  write(
    [
      `  ${verdict}`,
      `  ${ANSI.dim}ports${ANSI.reset} : ${portsLine(
        ports,
        `${ANSI.green}libéré${ANSI.reset}`,
        `${ANSI.red}✗ encore occupé${ANSI.reset}`,
        owners,
      )}`,
      "",
    ].join("\n") + "\n",
  );
  return 0;
}
