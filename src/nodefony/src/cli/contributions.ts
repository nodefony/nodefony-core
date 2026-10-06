import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { printUsage, printUsageError, type IUsagePage } from "./usageReport";
import { SysExit } from "./sysexits";
import { findProjectRoot } from "./projectRoot";
import { installedPackageRoots } from "./installedPackages";
import { stripGlobalCliFlags } from "./globalFlags";

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
   * @param relative - chemin relatif à la racine, en `/`
   * @param content - texte ou octets
   * @returns `true` si le fichier est (ou serait, en simulation) écrit
   */
  write(relative: string, content: string | Uint8Array): boolean;
  /**
   * Recopie un dossier du paquet, fichier par fichier, sans jamais remplacer.
   *
   * @param sourceDir - dossier source (chemin natif absolu, dans le paquet)
   * @param relative - dossier de destination, relatif à la racine, en `/`
   */
  copyTree(sourceDir: string, relative: string): void;
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
  /** Fichiers déjà présents, laissés tels quels. */
  readonly kept: readonly string[];
  /** Raison de l'échec, ou `null`. */
  readonly error: string | null;
}

/**
 * Le champ du `package.json` d'un paquet qui déclare sa contribution :
 * `{ "nodefony": { "contribute": "./dist/…/contribute.js" } }`.
 */
export const CONTRIBUTE_FIELD = "contribute";

/** Traduit un chemin relatif en `/` vers un chemin natif SOUS `root`, ou lève. */
function resolveInside(root: string, relative: string): string {
  const absolute = path.resolve(root, ...relative.split("/"));
  const rel = path.relative(root, absolute);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`chemin hors de la racine refusé : ${relative}`);
  }
  return absolute;
}

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

/** Le chemin de contribution déclaré par un paquet, ou `null`. */
function declaredContributor(packageDir: string): string | null {
  try {
    const manifest = JSON.parse(
      readFileSync(path.join(packageDir, "package.json"), "utf8"),
    ) as { nodefony?: Record<string, unknown> };
    const entry = manifest.nodefony?.[CONTRIBUTE_FIELD];
    return typeof entry === "string" ? entry : null;
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
  options: { appName?: string; dryRun?: boolean } = {},
): {
  context: IAppContributionContext;
  written: string[];
  kept: string[];
} {
  const appName = options.appName ?? readAppName(appRoot);
  const dryRun = options.dryRun ?? false;
  const written: string[] = [];
  const kept: string[] = [];
  const write = (relative: string, content: string | Uint8Array): boolean => {
    const target = resolveInside(appRoot, relative);
    if (existsSync(target)) {
      kept.push(relative);
      return false;
    }
    if (!dryRun) {
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, content);
    }
    written.push(relative);
    return true;
  };
  const copyTree = (sourceDir: string, relative: string): void => {
    for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
      const source = path.join(sourceDir, entry.name);
      const target = `${relative}/${entry.name}`;
      if (entry.isDirectory()) copyTree(source, target);
      else if (entry.isFile()) write(target, readFileSync(source));
    }
  };
  const context: IAppContributionContext = {
    appRoot,
    appName,
    dryRun,
    exists: (relative) => existsSync(resolveInside(appRoot, relative)),
    read: (relative) => {
      const target = resolveInside(appRoot, relative);
      return existsSync(target) ? readFileSync(target, "utf8") : null;
    },
    write,
    copyTree,
  };
  return { context, written, kept };
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
): Promise<IAppContributionReport[]> {
  const appName = readAppName(appRoot);
  const reports: IAppContributionReport[] = [];
  for (const pkg of installedPackageRoots(appRoot)) {
    const declared = declaredContributor(pkg.dir);
    if (declared === null) continue;
    const { context, written, kept } = createAppContributionContext(appRoot, {
      appName,
      dryRun,
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
      await contribute(context);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    reports.push({ packageName: pkg.name, written, kept, error });
  }
  return reports;
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
          (r.kept.length > 0 ? `, ${String(r.kept.length)} gardé(s)` : ""),
    )
    .join(" · ");
}

/** La page d'aide — `nodefony scaffold:sync --help`. */
const PAGE: IUsagePage = {
  command: "nodefony scaffold:sync",
  tagline:
    "pose dans ce projet les fichiers que livrent les paquets installés " +
    "(décor Docker, thèmes…), sans jamais remplacer un fichier présent",
  sections: [
    {
      title: "CE QU'ELLE ÉCRIT",
      paragraph:
        "Chaque paquet qui déclare `nodefony.contribute` dans son package.json " +
        "pose ses fichiers. Un fichier déjà là appartient à l'application — elle " +
        "a pu le retoucher — et n'est jamais remplacé : pour reprendre la version " +
        "du paquet, supprime-le puis relance. `create app` la joue après " +
        "l'installation ; à relancer après un --no-install ou un npm update. " +
        "Elle ne DÉMARRE pas l'application.",
    },
  ],
  options: [
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
      term: "nodefony scaffold:sync --dry-run",
      text: "ce qu'elle ferait, avant de la laisser faire",
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
export function parseScaffoldSyncArgv(
  argv: string[],
):
  | { cwd: string; json: boolean; dryRun: boolean; help: boolean }
  | { error: string } {
  const args = stripGlobalCliFlags(
    argv.slice(2).filter((a) => a !== "scaffold:sync"),
  );
  let cwd = process.cwd();
  let json = false;
  let dryRun = false;
  let help = false;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--help" || a === "-h") help = true;
    else if (a === "--json") json = true;
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--cwd") {
      const v = args.at(i + 1);
      if (v === undefined) return { error: "--cwd attend un chemin" };
      cwd = path.resolve(v);
      i += 1;
    } else return { error: `option inconnue : ${String(a)}` };
  }
  return { cwd, json, dryRun, help };
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
  const reports = await runAppContributions(projectRoot, parsed.dryRun);
  if (parsed.json) {
    process.stdout.write(`${JSON.stringify(reports, null, 2)}\n`);
  } else if (reports.length === 0) {
    process.stdout.write(
      existsSync(path.join(projectRoot, "node_modules"))
        ? "Aucun paquet installé ne livre de fichiers.\n"
        : "Aucun node_modules ici — installe d'abord les dépendances (yarn PnP n'est pas pris en charge).\n",
    );
  } else {
    const verb = parsed.dryRun ? "à poser" : "posé";
    for (const r of reports) {
      process.stdout.write(`${r.packageName}\n`);
      if (r.error !== null) process.stdout.write(`  ✗ ${r.error}\n`);
      for (const f of r.written) process.stdout.write(`  + ${f} (${verb})\n`);
      for (const f of r.kept)
        process.stdout.write(`  = ${f} (déjà là, gardé)\n`);
    }
  }
  return reports.some((r) => r.error !== null) ? 1 : SysExit.OK;
}
