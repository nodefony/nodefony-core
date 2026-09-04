import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { SysExit } from "./sysexits";
import { findProjectRoot } from "./projectRoot";
import { printUsage, printUsageError, type IUsagePage } from "./usageReport";
import {
  buildCard,
  renderCard,
  type ICard,
  type ICardInput,
} from "./cardReport";

/**
 * `nodefony card [--json]` — qui répond, et où aller ensuite.
 *
 * La PREMIÈRE commande qu'un agent (ou un humain) lance en arrivant dans une
 * application qu'il ne connaît pas. C'est ce qui décide de son placement :
 * standalone, comme `check` et `env`, elle ne lit que des fichiers.
 *
 * Ce qu'elle répare, mesuré sur le terrain, deux portes fermées au moment exact
 * où elle sert :
 *
 * 1. **Application NON CONSTRUITE** — le cas d'une app fraîchement générée, donc
 *    précisément celle où l'on cherche par où commencer. Faire booter la carte
 *    la rendait muette (`diagnoseUnbootableProject` répond « lance npm run
 *    build » à toute commande qui exige un Kernel).
 * 2. **`NODE_ENV` non posé** — la carte était portée par une commande du module
 *    `@nodefony/devkit`, `policy: "dev"`. Hors développement le module n'est pas
 *    chargé : la commande n'EXISTAIT pas, et le CLI répondait `unknown command`,
 *    sans piste. Une porte d'accueil qui disparaît selon l'environnement n'est
 *    pas une porte d'accueil.
 *
 * La contrepartie est ÉNONCÉE, jamais masquée : sans boot, on ne connaît que les
 * modules INSTALLÉS, pas les modules CHARGÉS (cf `renderCard`). La vérité
 * runtime reste à `npx nodefony inspect modules`, que la carte cite.
 *
 * La composition (`buildCard`) et le rendu (`renderCard`) vivent dans
 * `cli/cardReport.ts` : le module `@nodefony/devkit` les réutilise pour sa porte
 * HTTP, où le Kernel tourne et où la liste est celle des modules chargés. Une
 * source, deux portes.
 */

/** La page d'aide — `nodefony card --help`, et le rappel après un refus. */
const PAGE: IUsagePage = {
  command: "nodefony card",
  tagline:
    "la carte de visite de cette application : où l'on est, ce qu'elle " +
    "embarque, et quoi taper ensuite",
  aliases: ["nodefony devkit:card"],
  sections: [
    {
      title: "CE QU'ELLE LIT",
      paragraph:
        "Des fichiers, et rien d'autre : elle ne DÉMARRE pas l'application. " +
        "Elle répond donc dans une application pas encore construite, et dans " +
        "un terminal qui n'a pas posé NODE_ENV — les deux situations où l'on " +
        "cherche précisément par où commencer. La contrepartie est écrite dans " +
        "la carte : elle connaît les modules INSTALLÉS, pas les modules " +
        "CHARGÉS. Pour ceux-là, `nodefony inspect modules`.",
    },
  ],
  options: [
    { term: "-j, --json", text: "la même carte, exploitable par un script" },
    {
      term: "--cwd <chemin>",
      text: "point de départ (la racine de l'app est résolue en remontant)",
    },
  ],
  examples: [
    { term: "nodefony card", text: "la carte de l'application d'ici" },
    {
      term: "nodefony card --json | jq .",
      text: "la même, pour un script ou un agent",
    },
  ],
  exitCodes: [{ term: "66", text: "aucune application ici (EX_NOINPUT)" }],
};

/** Ce que la ligne de commande demande. */
interface ICardRequest {
  json: boolean;
  /** Racine de recherche (défaut : le cwd). */
  cwd: string;
  /** `true` si l'on veut seulement la page d'aide. */
  help: boolean;
}

/**
 * Parse l'argv après le mot `card` (ou son alias).
 *
 * @param argv - `process.argv` complet.
 * @returns la demande, ou le motif du refus.
 */
export function parseCardArgv(
  argv: string[],
): ICardRequest | { error: string } {
  const at = argv.findIndex((a) => a === "card" || a === "devkit:card");
  const rest = at === -1 ? [] : argv.slice(at + 1);
  let json = false;
  let cwd = process.cwd();
  let help = false;
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i];
    if (word === "--help" || word === "-h") {
      // Une commande qui répond « option inconnue : --help » apprend au
      // lecteur à ne plus croire le pied de l'aide, qui promet ce drapeau.
      help = true;
    } else if (word === "--json" || word === "-j") {
      json = true;
    } else if (word === "--cwd") {
      cwd = path.resolve(rest[++i] ?? "");
    } else {
      return { error: `option inconnue : ${word}` };
    }
  }
  return { json, cwd, help };
}

/** Lit un `package.json` sans jamais lever — absent ou illisible → `null`. */
function readPackage(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Liste les entrées d'un dossier sans jamais lever — absent → `[]`. */
function listDir(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() || e.isSymbolicLink())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Nom COURT d'un module à partir de son nom npm : `@nodefony/studio` → `studio`.
 *
 * C'est la clé du conteneur — celle que le Kernel expose dans `kernel.modules`,
 * et donc la seule qui permette à la carte froide et à la carte chaude de dire
 * la même chose du même module.
 */
function shortName(pkgName: string): string {
  const at = pkgName.lastIndexOf("/");
  return at === -1 ? pkgName : pkgName.slice(at + 1);
}

/**
 * Compose l'état de la carte à FROID : ce que des fichiers suffisent à établir.
 *
 * Que des lectures, aucune exécution : le `package.json` de l'application (nom,
 * version, briques déclarées), celui du framework installé (sa version), puis le
 * DISQUE — `node_modules/@nodefony/*` et `modules/*`, réunis aux déclarations.
 *
 * Ce sont des FAITS, là où lire les `use()` de `nodefony.config.ts` à
 * l'expression régulière produirait une liste fausse dès qu'un appel est
 * conditionnel, sans le dire. Ils restent des modules INSTALLÉS : ce qui sera
 * réellement chargé dépend du gating `policy`/`when`, qui n'a pas encore eu lieu
 * — d'où `source: "static"`, que le rendu annonce.
 *
 * @param projectRoot - racine de l'application (cf `findProjectRoot`).
 * @param fallbackVersion - version du framework à afficher si l'application ne
 *   l'a pas encore installé (celle du CLI qui répond).
 * @returns l'état à passer à `buildCard`, ou `null` si le `package.json` de
 *   l'application est illisible.
 */
export function readColdCardInput(
  projectRoot: string,
  fallbackVersion: string,
): ICardInput | null {
  const appPkg = readPackage(path.join(projectRoot, "package.json"));
  if (appPkg === null) return null;

  const deps = {
    ...(appPkg.dependencies as Record<string, string> | undefined),
    ...(appPkg.devDependencies as Record<string, string> | undefined),
  };
  const modules = new Set<string>(
    Object.keys(deps)
      .filter((name) => name.startsWith("@nodefony/"))
      .map(shortName),
  );
  // Le DISQUE fait foi sur ce qui est installé, et il dit plus que le manifeste :
  // dans un dépôt en espaces de travail (ce dépôt-ci, une app liée par `--link`),
  // les briques sont des liens symboliques posés par npm sans figurer dans
  // `dependencies`. Lire les seules deps déclarées y rendait « 0 module » —
  // exact au sens du manifeste, faux pour qui regarde l'application.
  for (const name of listDir(
    path.join(projectRoot, "node_modules", "@nodefony"),
  )) {
    if (!name.startsWith(".")) modules.add(name);
  }
  // Les modules LOCAUX de l'application (`modules/<nom>` — cf `create module`) :
  // ils portent le scope de l'app, pas `@nodefony`, et un agent qui arrive a
  // justement besoin de savoir ce que cette application a écrit en propre.
  for (const name of listDir(path.join(projectRoot, "modules"))) {
    if (!name.startsWith(".")) modules.add(name);
  }

  // La version du framework se lit dans ce qui est INSTALLÉ, pas dans la plage
  // déclarée (`^10.0.0` n'est pas une version). Absent → celle du CLI qui répond.
  const corePkg = readPackage(
    path.join(projectRoot, "node_modules", "nodefony", "package.json"),
  );
  const nodefonyVersion =
    typeof corePkg?.version === "string" ? corePkg.version : fallbackVersion;

  return {
    appName: typeof appPkg.name === "string" ? appPkg.name : "application",
    appVersion: typeof appPkg.version === "string" ? appPkg.version : "0.0.0",
    nodefonyVersion,
    // Rien n'a démarré : l'environnement affiché est celui du SHELL, et il n'a
    // pas encore traversé la résolution du Kernel. C'est la valeur qui décidera
    // du gating au prochain boot, donc celle qui intéresse ici.
    environment: process.env.NODE_ENV ?? "development",
    modules: [...modules],
    source: "static",
  };
}

/**
 * Commande `nodefony card` — orchestre : résout le projet, lit l'état statique,
 * délègue la composition au module pur, rend.
 *
 * @param argv - `process.argv` complet.
 * @param fallbackVersion - version du CLI courant, affichée si l'application n'a
 *   pas (encore) `nodefony` dans ses `node_modules`.
 * @returns exit code sémantique (`OK`, `USAGE`, `NOINPUT` hors projet).
 */
export function runCardCommand(
  argv: string[],
  fallbackVersion: string,
): number {
  const parsed = parseCardArgv(argv);
  if ("error" in parsed) {
    return printUsageError(PAGE, parsed.error);
  }
  if (parsed.help) {
    return printUsage(PAGE);
  }
  const projectRoot = findProjectRoot(parsed.cwd);
  if (projectRoot === null) {
    // Hors projet il n'y a pas d'application à présenter — et le dire vaut mieux
    // qu'une carte générique qui décrirait un dossier quelconque.
    process.stderr.write(
      `card: aucun projet Nodefony ici (nodefony.config.ts introuvable en remontant).\n` +
        `Pour en créer un :\n  npx nodefony create app mon-app\n`,
    );
    return SysExit.NOINPUT;
  }
  const input = readColdCardInput(projectRoot, fallbackVersion);
  if (input === null) {
    process.stderr.write(`card: package.json illisible dans ${projectRoot}\n`);
    return SysExit.NOINPUT;
  }
  const card: ICard = buildCard(input);
  process.stdout.write(
    parsed.json ? `${JSON.stringify(card, null, 2)}\n` : renderCard(card),
  );
  return SysExit.OK;
}
