import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { printUsage, printUsageError, type IUsagePage } from "./usageReport";
import { SysExit } from "./sysexits";
import { findProjectRoot } from "./projectRoot";
import { installedPackageRoots } from "./installedPackages";
import { stripGlobalCliFlags } from "./globalFlags";
import { isPlainObject } from "../Tools";
import {
  CONTRIBUTE_FIELD,
  declaredPackageEntry,
  resolveInside,
} from "./packageManifest";

export { CONTRIBUTE_FIELD };

/**
 * Ce qu'une contribution reçoit : la racine de l'application et des gestes
 * d'écriture qui ne REMPLACENT jamais un fichier existant.
 *
 * Tous les chemins relatifs s'écrivent en `/` (ils voyagent : déclarés par un
 * paquet, affichés, comparés) ; le contexte les traduit en chemins natifs au
 * moment d'ouvrir.
 */
export interface IAppContributionContext {
  /** Racine de l'application (chemin natif absolu). */
  readonly appRoot: string;
  /** Nom de l'application — le `name` de son `package.json`. */
  readonly appName: string;
  /** `true` : rien n'est écrit, le rapport dit ce qui le serait. */
  readonly dryRun: boolean;
  /**
   * `true` (`scaffold:sync --update`) : un fichier SUIVI resté intact est
   * remplacé par la version du paquet. Un fichier retouché ne l'est jamais.
   */
  readonly update: boolean;
  /**
   * Le fichier existe-t-il dans l'application ?
   *
   * @param relative - chemin relatif à la racine, en `/`
   */
  exists(relative: string): boolean;
  /**
   * Lit un fichier texte de l'application.
   *
   * @param relative - chemin relatif à la racine, en `/`
   * @returns son contenu, ou `null` s'il n'existe pas
   */
  read(relative: string): string | null;
  /**
   * Pose un fichier — seulement s'il est ABSENT : un fichier présent est à
   * l'application, qui a pu le retoucher.
   *
   * Par défaut le fichier est une SEMENCE : posé une fois, il appartient
   * ensuite à l'application (un realm généré pour elle, qu'elle fait évoluer).
   * Avec `tracked`, c'est une COPIE du paquet : son empreinte entre au registre
   * de provenance, et `--update` la rafraîchit tant qu'elle n'a pas été retouchée.
   *
   * @param relative - chemin relatif à la racine, en `/`
   * @param content - texte ou octets
   * @param options - `tracked` : le fichier suit la version du paquet
   * @returns `true` si le fichier est (ou serait, en simulation) écrit ou mis à jour
   */
  write(
    relative: string,
    content: string | Uint8Array,
    options?: IContributionWriteOptions,
  ): boolean;
  /**
   * Recopie un dossier du paquet, fichier par fichier. Chaque fichier est SUIVI
   * (cf {@link IAppContributionContext.write}) : c'est une copie de ce que le
   * paquet livre, faite pour suivre ses versions.
   *
   * @param sourceDir - dossier source (chemin natif absolu, dans le paquet)
   * @param relative - dossier de destination, relatif à la racine, en `/`
   */
  copyTree(sourceDir: string, relative: string): void;
}

/** Options d'écriture d'une contribution. */
export interface IContributionWriteOptions {
  /**
   * `true` : le fichier est une copie du paquet, inscrite au registre de
   * provenance et rafraîchie par `scaffold:sync --update` tant qu'elle est
   * intacte. Défaut `false` : une semence, à l'application dès qu'elle existe.
   */
  readonly tracked?: boolean;
}

/**
 * La fonction qu'un paquet exporte sous le nom `contribute` pour poser ses
 * fichiers dans une application.
 */
export type TAppContributor = (
  context: IAppContributionContext,
) => void | Promise<void>;

/** Ce qu'une contribution a fait — une entrée par paquet contributeur. */
export interface IAppContributionReport {
  /** Le paquet (ou module local) qui contribue. */
  readonly packageName: string;
  /** Fichiers posés (ou qui le seraient), relatifs, en `/`. */
  readonly written: readonly string[];
  /** Fichiers déjà présents, laissés tels quels (quelle qu'en soit la raison). */
  readonly kept: readonly string[];
  /** Fichiers suivis remplacés par la version du paquet (`--update`). */
  readonly updated: readonly string[];
  /**
   * Fichiers suivis INTACTS mais en retard sur le paquet — `--update` les
   * rafraîchirait. Sous-ensemble de `kept`.
   */
  readonly outdated: readonly string[];
  /**
   * Fichiers suivis qui DIFFÈRENT de la version du paquet sans preuve d'être
   * intacts : retouchés par l'application, ou posés avant le registre. Jamais
   * remplacés. Sous-ensemble de `kept`.
   */
  readonly modified: readonly string[];
  /** Raison de l'échec, ou `null`. */
  readonly error: string | null;
}

/**
 * Le registre de provenance — `scaffold.lock.json` à la racine de
 * l'application, VERSIONNÉ avec elle : l'empreinte de chaque fichier suivi tel
 * que le paquet l'a livré. C'est lui qui distingue un fichier intact (donc
 * rafraîchissable) d'un fichier retouché (donc à l'application).
 */
export interface IScaffoldLock {
  /** Une phrase pour qui ouvre le fichier. */
  readonly description: string;
  /** Par paquet : sa version à la dernière synchronisation, et ses fichiers. */
  readonly packages: Readonly<Record<string, IScaffoldLockPackage>>;
}

/** L'entrée d'un paquet au registre de provenance. */
export interface IScaffoldLockPackage {
  /** Version du paquet à la dernière synchronisation, ou `null`. */
  readonly version: string | null;
  /** Chemin relatif (en `/`) → empreinte sha256 de la version livrée. */
  readonly files: Readonly<Record<string, string>>;
}

/** Le nom du registre de provenance, à la racine de l'application. */
export const SCAFFOLD_LOCK_FILE = "scaffold.lock.json";

const SCAFFOLD_LOCK_DESCRIPTION =
  "Empreintes des fichiers livrés par les paquets (nodefony scaffold:sync). " +
  "À versionner, à ne pas éditer : un fichier dont l'empreinte correspond est " +
  "intact, et `scaffold:sync --update` le rafraîchit.";

/** Le nom de l'application, lu dans son `package.json` ; repli : son dossier. */
function readAppName(appRoot: string): string {
  try {
    const name = (
      JSON.parse(readFileSync(path.join(appRoot, "package.json"), "utf8")) as {
        name?: unknown;
      }
    ).name;
    if (typeof name === "string" && name.length > 0) return name;
  } catch {
    // Pas de manifeste lisible : le nom du dossier fait foi.
  }
  return path.basename(appRoot);
}

/**
 * L'empreinte d'un fichier livré : sha256 de ses octets, fins de ligne
 * ramenées à `\n` pour un TEXTE (aucun octet nul). Sans cette normalisation, un
 * dépôt extrait sous Windows avec `core.autocrlf` ferait passer chaque fichier
 * intact pour retouché — donc jamais rafraîchi.
 *
 * @param content - texte ou octets
 * @returns l'empreinte, en hexadécimal
 */
export function contributionFingerprint(content: string | Uint8Array): string {
  const bytes = typeof content === "string" ? Buffer.from(content) : content;
  const hash = createHash("sha256");
  if (bytes.includes(0)) hash.update(bytes);
  else
    hash.update(
      Buffer.from(bytes).toString("latin1").replace(/\r\n/gu, "\n"),
      "latin1",
    );
  return hash.digest("hex");
}

/**
 * Lit le registre de provenance de l'application.
 *
 * @param appRoot - racine de l'application
 * @returns les entrées par paquet — vide si le registre manque ou est illisible
 *   (un registre illisible rend chaque fichier « d'origine inconnue » : gardé,
 *   jamais écrasé)
 */
export function readScaffoldLock(
  appRoot: string,
): Record<string, IScaffoldLockPackage> {
  try {
    const raw: unknown = JSON.parse(
      readFileSync(path.join(appRoot, SCAFFOLD_LOCK_FILE), "utf8"),
    );
    const packages: Record<string, IScaffoldLockPackage> = {};
    const declared = isPlainObject(raw) ? raw.packages : undefined;
    if (!isPlainObject(declared)) return packages;
    for (const [name, entry] of Object.entries(declared)) {
      if (!isPlainObject(entry) || !isPlainObject(entry.files)) continue;
      const files: Record<string, string> = {};
      for (const [file, hash] of Object.entries(entry.files)) {
        if (typeof hash === "string") files[file] = hash;
      }
      packages[name] = {
        version: typeof entry.version === "string" ? entry.version : null,
        files,
      };
    }
    return packages;
  } catch {
    return {};
  }
}

/** Rend le registre, clés triées : un diff git ne montre que ce qui a changé. */
function renderScaffoldLock(
  packages: Readonly<Record<string, IScaffoldLockPackage>>,
): string {
  const sorted: Record<string, IScaffoldLockPackage> = {};
  for (const name of Object.keys(packages).sort()) {
    const entry = packages[name];
    if (entry === undefined) continue;
    const files: Record<string, string> = {};
    for (const file of Object.keys(entry.files).sort()) {
      const hash = entry.files[file];
      if (hash !== undefined) files[file] = hash;
    }
    sorted[name] = { version: entry.version, files };
  }
  const lock: IScaffoldLock = {
    description: SCAFFOLD_LOCK_DESCRIPTION,
    packages: sorted,
  };
  return `${JSON.stringify(lock, null, 2)}\n`;
}

/** La version déclarée d'un paquet, ou `null`. */
function packageVersion(packageDir: string): string | null {
  try {
    const manifest: unknown = JSON.parse(
      readFileSync(path.join(packageDir, "package.json"), "utf8"),
    );
    const version = isPlainObject(manifest) ? manifest.version : undefined;
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

/**
 * Construit le contexte d'UNE contribution, qui consigne ce qu'elle pose et ce
 * qu'elle laisse.
 *
 * Public pour qu'un paquet éprouve sa contribution sur SA source, sans passer
 * par la découverte dans `node_modules` (qui exige un paquet bâti et installé).
 *
 * @param appRoot - racine de l'application
 * @param options - nom de l'application (défaut : le `name` de son
 *   `package.json`) et mode simulation
 * @returns le contexte, et les listes qu'il remplit au fil des écritures
 */
export function createAppContributionContext(
  appRoot: string,
  options: {
    appName?: string;
    dryRun?: boolean;
    update?: boolean;
    recorded?: Readonly<Record<string, string>>;
  } = {},
): {
  context: IAppContributionContext;
  written: string[];
  kept: string[];
  updated: string[];
  outdated: string[];
  modified: string[];
  files: Record<string, string>;
} {
  const appName = options.appName ?? readAppName(appRoot);
  const dryRun = options.dryRun ?? false;
  const update = options.update ?? false;
  const recorded = options.recorded ?? {};
  const written: string[] = [];
  const kept: string[] = [];
  const updated: string[] = [];
  const outdated: string[] = [];
  const modified: string[] = [];
  const files: Record<string, string> = {};
  const put = (target: string, content: string | Uint8Array): void => {
    if (dryRun) return;
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  };
  const write = (
    relative: string,
    content: string | Uint8Array,
    writeOptions: IContributionWriteOptions = {},
  ): boolean => {
    const target = resolveInside(appRoot, relative);
    const tracked = writeOptions.tracked === true;
    if (!existsSync(target)) {
      put(target, content);
      written.push(relative);
      if (tracked) files[relative] = contributionFingerprint(content);
      return true;
    }
    if (!tracked) {
      kept.push(relative);
      return false;
    }
    const delivered = contributionFingerprint(content);
    const current = contributionFingerprint(readFileSync(target));
    const previous = recorded[relative];
    if (current === delivered) {
      // Identique à la livraison : intact par constat, inscrit même s'il
      // précède le registre.
      files[relative] = delivered;
      kept.push(relative);
      return false;
    }
    if (previous === current) {
      // Intact (empreinte de la livraison précédente) mais en retard.
      if (update) {
        put(target, content);
        files[relative] = delivered;
        updated.push(relative);
        return true;
      }
      files[relative] = previous;
      outdated.push(relative);
      kept.push(relative);
      return false;
    }
    // Retouché, ou posé avant le registre : à l'application, jamais remplacé.
    // L'empreinte de la livraison précédente reste inscrite : si l'application
    // revient sur sa retouche, le fichier redevient rafraîchissable.
    if (previous !== undefined) files[relative] = previous;
    modified.push(relative);
    kept.push(relative);
    return false;
  };
  const copyTree = (sourceDir: string, relative: string): void => {
    for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
      const source = path.join(sourceDir, entry.name);
      const target = `${relative}/${entry.name}`;
      if (entry.isDirectory()) copyTree(source, target);
      else if (entry.isFile()) {
        write(target, readFileSync(source), { tracked: true });
      }
    }
  };
  const context: IAppContributionContext = {
    appRoot,
    appName,
    dryRun,
    update,
    exists: (relative) => existsSync(resolveInside(appRoot, relative)),
    read: (relative) => {
      const target = resolveInside(appRoot, relative);
      return existsSync(target) ? readFileSync(target, "utf8") : null;
    },
    write,
    copyTree,
  };
  return { context, written, kept, updated, outdated, modified, files };
}

/**
 * Exécute les contributions des paquets installés dans une application : chaque
 * paquet qui déclare `nodefony.contribute` dans son `package.json` y pose ses
 * fichiers, sans jamais remplacer un fichier présent.
 *
 * C'est le geste ENTIER, tel que l'exécutent ses deux appelants : `create app`
 * (après l'installation) et la commande `scaffold:sync`. Le cœur ne connaît
 * aucun contributeur : un paquet de sécurité livre son décor d'identité, un
 * autre livrera le sien, sans qu'on touche ici.
 *
 * @param appRoot - racine de l'application, déjà résolue
 * @param dryRun - `true` pour calculer sans rien écrire
 * @returns un rapport par contributeur ; une contribution qui lève est
 *   rapportée (`error`), jamais propagée — les autres passent quand même
 */
export async function runAppContributions(
  appRoot: string,
  dryRun = false,
  update = false,
): Promise<IAppContributionReport[]> {
  const appName = readAppName(appRoot);
  const reports: IAppContributionReport[] = [];
  const lock = readScaffoldLock(appRoot);
  const next: Record<string, IScaffoldLockPackage> = { ...lock };
  for (const pkg of installedPackageRoots(appRoot)) {
    const declared = declaredPackageEntry(pkg.dir, CONTRIBUTE_FIELD);
    if (declared === null) continue;
    const run = createAppContributionContext(appRoot, {
      appName,
      dryRun,
      update,
      recorded: lock[pkg.name]?.files ?? {},
    });
    let error: string | null = null;
    try {
      const entry = resolveInside(pkg.dir, declared.replace(/^\.\//u, ""));
      const loaded = (await import(pathToFileURL(entry).href)) as {
        contribute?: unknown;
      };
      if (typeof loaded.contribute !== "function") {
        throw new Error(`${declared} n'exporte pas de fonction « contribute »`);
      }
      const contribute = loaded.contribute as TAppContributor;
      await contribute(run.context);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    // Une contribution en échec garde son entrée : un registre réécrit sur une
    // passe partielle oublierait des fichiers intacts.
    if (error === null) {
      if (Object.keys(run.files).length > 0) {
        next[pkg.name] = { version: packageVersion(pkg.dir), files: run.files };
      } else delete next[pkg.name];
    }
    reports.push({
      packageName: pkg.name,
      written: run.written,
      kept: run.kept,
      updated: run.updated,
      outdated: run.outdated,
      modified: run.modified,
      error,
    });
  }
  if (!dryRun) writeScaffoldLock(appRoot, next);
  return reports;
}

/**
 * Écrit le registre — seulement s'il change : une synchronisation sans effet
 * ne salit pas l'arbre. Aucun fichier suivi, aucun registre préexistant ⇒ rien.
 */
function writeScaffoldLock(
  appRoot: string,
  packages: Readonly<Record<string, IScaffoldLockPackage>>,
): void {
  const target = path.join(appRoot, SCAFFOLD_LOCK_FILE);
  const exists = existsSync(target);
  if (!exists && Object.keys(packages).length === 0) return;
  const content = renderScaffoldLock(packages);
  if (exists && readFileSync(target, "utf8") === content) return;
  writeFileSync(target, content);
}

/**
 * Résume les contributions en une ligne — la note de `create app`.
 *
 * @param reports - le rendu de {@link runAppContributions}
 * @returns la note, jamais vide
 */
export function summarizeContributions(
  reports: readonly IAppContributionReport[],
): string {
  if (reports.length === 0) return "aucun paquet installé n'en déclare";
  return reports
    .map((r) =>
      r.error !== null
        ? `${r.packageName} en échec (${r.error})`
        : `${r.packageName} : ${String(r.written.length)} posé(s)` +
          (r.updated.length > 0
            ? `, ${String(r.updated.length)} mis à jour`
            : "") +
          (r.kept.length > 0 ? `, ${String(r.kept.length)} gardé(s)` : ""),
    )
    .join(" · ");
}

/**
 * Le rendu humain de `scaffold:sync` : chaque fichier posé, mis à jour,
 * périmé ou retouché est nommé ; les fichiers déjà à jour sont COMPTÉS — un
 * thème en porte des dizaines, et les lister noierait ce qui demande un geste.
 *
 * @param reports - le rendu de {@link runAppContributions}
 * @param mode - simulation, mise à jour
 * @returns le texte, terminé par un saut de ligne
 */
export function renderScaffoldSync(
  reports: readonly IAppContributionReport[],
  mode: { dryRun: boolean; update: boolean },
): string {
  const posed = mode.dryRun ? "à poser" : "posé";
  const refreshed = mode.dryRun ? "à mettre à jour" : "mis à jour";
  const lines: string[] = [];
  let outdated = 0;
  let modified = 0;
  for (const r of reports) {
    lines.push(r.packageName);
    if (r.error !== null) lines.push(`  ✗ ${r.error}`);
    for (const f of r.written) lines.push(`  + ${f} (${posed})`);
    for (const f of r.updated) lines.push(`  ↻ ${f} (${refreshed})`);
    for (const f of r.outdated)
      lines.push(`  ~ ${f} (en retard sur le paquet)`);
    for (const f of r.modified) {
      lines.push(
        `  ! ${f} (diffère du paquet — retouché ou d'origine inconnue, gardé)`,
      );
    }
    const flagged = new Set([...r.outdated, ...r.modified]);
    const plain = r.kept.filter((f) => !flagged.has(f)).length;
    if (plain > 0) lines.push(`  = ${String(plain)} déjà là, gardé(s)`);
    outdated += r.outdated.length;
    modified += r.modified.length;
  }
  if (outdated > 0) {
    lines.push(
      "",
      `${String(outdated)} copie(s) intacte(s) en retard : \`nodefony scaffold:sync --update\` les rafraîchit.`,
    );
  }
  if (modified > 0) {
    lines.push(
      "",
      `${String(modified)} copie(s) gardée(s) car différente(s) du paquet : pour reprendre sa version, supprime le fichier puis relance.`,
    );
  }
  return `${lines.join("\n")}\n`;
}

/** La page d'aide — `nodefony scaffold:sync --help`. */
const PAGE: IUsagePage = {
  command: "nodefony scaffold:sync",
  tagline:
    "pose dans ce projet les fichiers que livrent les paquets installés " +
    "(décor Docker, thèmes…), et rafraîchit ceux qui n'ont pas été retouchés",
  sections: [
    {
      title: "CE QU'ELLE ÉCRIT",
      paragraph:
        "Chaque paquet qui déclare `nodefony.contribute` dans son package.json " +
        "pose ses fichiers manquants. Un fichier déjà là n'est jamais remplacé " +
        "sans --update. `create app` la joue après l'installation ; à relancer " +
        "après un --no-install ou un npm update. Elle ne DÉMARRE pas l'application.",
    },
    {
      title: "CE QUE --update REMPLACE, ET CE QU'IL GARDE",
      paragraph:
        `Les copies livrées (un thème, par exemple) sont inscrites avec leur empreinte ` +
        `dans ${SCAFFOLD_LOCK_FILE}, à versionner. Une copie dont l'empreinte ` +
        "correspond est INTACTE : --update la remplace par la version du paquet. " +
        "Une copie qui diffère — retouchée, ou posée avant le registre — est à " +
        "l'application : gardée et signalée, jamais écrasée. Pour reprendre la " +
        "version du paquet, supprime-la puis relance. Les fichiers générés pour " +
        "l'application (un realm, par exemple) ne sont jamais remplacés.",
    },
  ],
  options: [
    { term: "--update", text: "rafraîchit les copies intactes en retard" },
    { term: "--dry-run", text: "le plan, sans rien écrire" },
    { term: "--json", text: "le même plan, exploitable par un script" },
    {
      term: "--cwd <chemin>",
      text: "point de départ (la racine de l'app est résolue en remontant)",
    },
  ],
  examples: [
    { term: "nodefony scaffold:sync", text: "pose les fichiers manquants" },
    {
      term: "nodefony scaffold:sync --update",
      text: "après un npm update : rafraîchit les copies intactes",
    },
    {
      term: "nodefony scaffold:sync --update --dry-run",
      text: "ce qu'elle remplacerait, avant de la laisser faire",
    },
  ],
  exitCodes: [
    { term: "1", text: "une contribution a échoué" },
    { term: "66", text: "aucune application ici (EX_NOINPUT)" },
  ],
};

/**
 * Analyse les arguments de `scaffold:sync`.
 *
 * @param argv - `process.argv` complet
 * @returns les options, ou une erreur d'usage
 */
export function parseScaffoldSyncArgv(argv: string[]):
  | {
      cwd: string;
      json: boolean;
      dryRun: boolean;
      update: boolean;
      help: boolean;
    }
  | { error: string } {
  const args = stripGlobalCliFlags(
    argv.slice(2).filter((a) => a !== "scaffold:sync"),
  );
  let cwd = process.cwd();
  let json = false;
  let dryRun = false;
  let update = false;
  let help = false;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--help" || a === "-h") help = true;
    else if (a === "--json") json = true;
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--update") update = true;
    else if (a === "--cwd") {
      const v = args.at(i + 1);
      if (v === undefined) return { error: "--cwd attend un chemin" };
      cwd = path.resolve(v);
      i += 1;
    } else return { error: `option inconnue : ${String(a)}` };
  }
  return { cwd, json, dryRun, update, help };
}

/**
 * Point d'entrée de `nodefony scaffold:sync` — sans boot du kernel.
 *
 * @param argv - `process.argv` complet
 * @returns exit code sémantique (`OK`, `SOFTWARE`-like 1 si une contribution
 *   échoue, `USAGE`, `NOINPUT` hors projet)
 */
export async function runScaffoldSyncCommand(argv: string[]): Promise<number> {
  const parsed = parseScaffoldSyncArgv(argv);
  if ("error" in parsed) return printUsageError(PAGE, parsed.error);
  if (parsed.help) return printUsage(PAGE);
  const projectRoot = findProjectRoot(parsed.cwd);
  if (projectRoot === null) {
    process.stderr.write(
      `scaffold:sync: aucun projet Nodefony ici (nodefony.config.ts introuvable en remontant).\n`,
    );
    return SysExit.NOINPUT;
  }
  const reports = await runAppContributions(
    projectRoot,
    parsed.dryRun,
    parsed.update,
  );
  if (parsed.json) {
    process.stdout.write(`${JSON.stringify(reports, null, 2)}\n`);
  } else if (reports.length === 0) {
    process.stdout.write(
      existsSync(path.join(projectRoot, "node_modules"))
        ? "Aucun paquet installé ne livre de fichiers.\n"
        : "Aucun node_modules ici — installe d'abord les dépendances (yarn PnP n'est pas pris en charge).\n",
    );
  } else {
    process.stdout.write(renderScaffoldSync(reports, parsed));
  }
  return reports.some((r) => r.error !== null) ? 1 : SysExit.OK;
}
