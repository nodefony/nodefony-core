import path from "node:path";
import { readFileSync } from "node:fs";
import type { DevProcessInfo, DevProcessWithCwd } from "./devProcess";
import { foreignProjectRoots, readRuntimeState } from "./devProcess";

/**
 * Un projet Nodefony vivant sur ce poste — ce que `nodefony status` affiche et ce
 * que `nodefony stop <projet>` accepte comme cible.
 *
 * Les deux commandes lisent la MÊME table : publier un nom qu'on ne pourrait pas
 * viser, ou accepter un nom qui ne s'affiche nulle part, ferait de la table une
 * décoration. C'est aussi pourquoi l'identité reste la RACINE et jamais le nom :
 * deux clones d'un même dépôt portent le même `name` de `package.json`.
 */
export interface IProjectRuntime {
  /** Étiquette lisible — `package.json#name`, ou le nom du dossier à défaut. */
  readonly name: string;
  /**
   * D'où vient le nom, CONSTATÉ et non supposé : un `package.json` illisible
   * (absent, JSON invalide, sans `name`) ne doit pas se lire comme un projet qui
   * s'appellerait ainsi.
   */
  readonly nameSource: "package" | "dossier";
  /** Racine du projet — l'IDENTITÉ, seule valeur sur laquelle on agit. */
  readonly root: string;
  /** `true` pour le projet du répertoire courant. */
  readonly current: boolean;
  /**
   * Runtimes observés pour ce projet — la LISTE, pas un compte : `status` rend
   * un tableau par projet (rôle, pid, uptime, mémoire), et un décompte seul
   * obligerait à retourner chercher les process ailleurs.
   */
  readonly procs: readonly DevProcessInfo[];
  /** Ports que ce projet déclare tenir (triés). */
  readonly ports: readonly number[];
}

/**
 * Lit le nom d'un projet dans son `package.json`.
 *
 * Repli sur le nom du DOSSIER, jamais sur une chaîne inventée : un projet sans
 * `package.json` lisible reste désignable, et l'appelant sait par `nameSource`
 * que le nom n'a pas été déclaré.
 *
 * @param root - racine du projet.
 * @returns le nom déclaré, ou `null` si aucun n'est lisible.
 */
export function readProjectName(root: string): string | null {
  try {
    const raw = readFileSync(path.join(root, "package.json"), "utf8");
    const name: unknown = (JSON.parse(raw) as { name?: unknown }).name;
    return typeof name === "string" && name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

/** Dépendances injectables de {@link buildProjectTable} — aucun I/O par défaut imposé. */
export interface IProjectTableDeps {
  /** Nom déclaré d'un projet (défaut : lecture de son `package.json`). */
  readonly readName?: (root: string) => string | null;
  /** Ports qu'un projet déclare tenir (défaut : son fichier d'état runtime). */
  readonly readPorts?: (root: string) => readonly number[];
}

/**
 * Compose la table des projets Nodefony vivants — fonction PURE (toute lecture
 * disque passe par {@link IProjectTableDeps}), donc éprouvable sans process ni
 * fichier.
 *
 * Le projet courant figure toujours en tête et n'est OMIS que s'il ne tourne pas :
 * une table qui listerait le voisin sans dire lequel est le nôtre obligerait à
 * comparer des chemins à l'œil.
 *
 * @param cwd - racine du projet courant.
 * @param mine - runtimes du projet courant.
 * @param foreign - runtimes des autres projets (sortie `splitByProject().foreign`).
 * @param myPorts - ports à l'écoute du projet courant.
 * @param deps - lectures injectables (nom, ports).
 * @returns la table, projet courant d'abord puis les autres par nom.
 */
export function buildProjectTable(
  cwd: string,
  mine: readonly DevProcessInfo[],
  foreign: readonly DevProcessWithCwd[],
  myPorts: readonly number[] = [],
  deps: IProjectTableDeps = {},
): IProjectRuntime[] {
  const readName = deps.readName ?? readProjectName;
  const readPorts =
    deps.readPorts ??
    ((root: string) =>
      readRuntimeState(root, { purgeStale: false })?.ports ?? []);

  const entry = (
    root: string,
    procs: readonly DevProcessInfo[],
    ports: readonly number[],
    current: boolean,
  ): IProjectRuntime => {
    const declared = readName(root);
    return {
      name: declared ?? path.basename(root),
      nameSource: declared ? "package" : "dossier",
      root,
      current,
      procs,
      ports: [...ports].sort((a, b) => a - b),
    };
  };

  const table: IProjectRuntime[] = [];
  if (mine.length > 0) table.push(entry(cwd, mine, myPorts, true));

  const roots = foreignProjectRoots(foreign);
  const others = roots.map((root) => {
    // Un Vite travaille parfois dans un sous-dossier : il se rattache à la racine
    // qui le préfixe, exactement comme le fait l'affichage groupé des runtimes
    // étrangers — une seule règle de rattachement, pas deux.
    const procs = foreign.filter(
      (p) => p.cwd === root || p.cwd?.startsWith(root + path.sep),
    );
    return entry(root, procs, readPorts(root), false);
  });
  others.sort((a, b) => a.name.localeCompare(b.name));
  return [...table, ...others];
}

/**
 * Met en forme la table des projets — lignes SANS couleur (l'appelant colore et
 * indente), colonnes alignées sur le contenu réel.
 *
 * Le nom du projet courant porte un repère : c'est lui qu'on cherche d'abord, et
 * comparer des racines à l'œil est précisément ce que cette table supprime. Un nom
 * qui vient du dossier plutôt que du `package.json` est marqué `~` — l'utilisateur
 * peut le viser tout autant, mais il sait que le projet ne s'est pas nommé.
 *
 * @param projects - table produite par {@link buildProjectTable}.
 * @returns lignes prêtes à afficher (vide si aucun projet).
 */
export function formatProjectTable(
  projects: readonly IProjectRuntime[],
): string[] {
  if (projects.length === 0) return [];
  const rows = projects.map((p) => ({
    nom: `${p.name}${p.nameSource === "dossier" ? "~" : ""}${p.current ? " ▸" : ""}`,
    proc: String(p.procs.length),
    ports: p.ports.length > 0 ? p.ports.join(" ") : "—",
    root: p.root,
  }));
  const w = (key: "nom" | "proc" | "ports", head: string): number =>
    Math.max(head.length, ...rows.map((r) => r[key].length));
  const wNom = w("nom", "NOM");
  const wProc = w("proc", "PROC");
  const wPorts = w("ports", "PORTS");
  const line = (
    nom: string,
    proc: string,
    ports: string,
    root: string,
  ): string =>
    `  ${nom.padEnd(wNom)}  ${proc.padEnd(wProc)}  ${ports.padEnd(wPorts)}  ${root}`;
  const lines = [
    "",
    "  Projets Nodefony sur ce poste",
    line("NOM", "PROC", "PORTS", "RACINE"),
    ...rows.map((r) => line(r.nom, r.proc, r.ports, r.root)),
  ];
  if (projects.some((p) => p.current)) lines.push("  ▸ projet courant");
  if (projects.some((p) => p.nameSource === "dossier"))
    lines.push("  ~ nom du dossier (aucun nom déclaré dans package.json)");
  lines.push("  arrêter un projet : nodefony stop <nom|chemin>");
  return lines;
}

/** Verdict de {@link resolveProjectTarget} — jamais un « le plus proche ». */
export type ProjectResolution =
  | { readonly ok: true; readonly project: IProjectRuntime }
  | {
      readonly ok: false;
      readonly reason: "inconnu" | "ambigu";
      /** Les projets qui expliquent le refus (tous, ou les homonymes). */
      readonly candidates: readonly IProjectRuntime[];
    };

/**
 * Résout une cible `nodefony stop <projet>` — par NOM ou par CHEMIN.
 *
 * Le refus est la règle dès que la désignation n'est pas certaine : arrêter des
 * process est irréversible, et deviner « le plus proche » ferait tomber le mauvais
 * serveur sur une faute de frappe. Zéro correspondance et deux correspondances
 * sont donc deux refus distincts, chacun avec de quoi corriger.
 *
 * Un argument contenant un séparateur, ou absolu, est traité comme un CHEMIN
 * (résolu contre le répertoire courant) ; sinon il est comparé au nom déclaré ET
 * au nom du dossier — un projet se désigne comme on le nomme, pas comme son
 * `package.json` l'a nommé.
 *
 * ⚠️ La comparaison de chemins est exacte, casse comprise. Sur un système de
 * fichiers insensible à la casse, une casse différente rend donc « inconnu »
 * plutôt qu'une correspondance : un refus, jamais un mauvais arrêt.
 *
 * @param arg - ce que l'utilisateur a tapé.
 * @param projects - table produite par {@link buildProjectTable}.
 * @returns le projet visé, ou le motif du refus avec ses candidats.
 */
export function resolveProjectTarget(
  arg: string,
  projects: readonly IProjectRuntime[],
  /**
   * Grammaire de chemins — INJECTABLE pour que la règle s'éprouve sous une autre
   * plateforme que celle qui joue le test (`path.win32` depuis un poste UNIX).
   * Sans cela, le comportement Windows ne serait jamais qu'une intention : ici,
   * `\` est un séparateur et `C:\…` est absolu, deux faits qu'un test macOS ne
   * rencontre jamais par lui-même.
   */
  grammaire: Pick<
    typeof path,
    "isAbsolute" | "sep" | "resolve" | "basename"
  > = path,
): ProjectResolution {
  // Un `/` reste reconnu même sous Windows : les développeurs l'y tapent, et
  // `path.win32` le normalise sans broncher.
  const looksLikePath =
    grammaire.isAbsolute(arg) ||
    arg.includes("/") ||
    arg.includes(grammaire.sep);
  const matches = looksLikePath
    ? projects.filter(
        (p) => grammaire.resolve(p.root) === grammaire.resolve(arg),
      )
    : projects.filter(
        (p) => p.name === arg || grammaire.basename(p.root) === arg,
      );

  if (matches.length === 1) return { ok: true, project: matches[0] };
  if (matches.length === 0)
    return { ok: false, reason: "inconnu", candidates: projects };
  return { ok: false, reason: "ambigu", candidates: matches };
}
