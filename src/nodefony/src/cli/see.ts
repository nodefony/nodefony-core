import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { findProjectRoot } from "./projectRoot";
import { portableSpawn } from "./execPortable";
import { printUsage, type IUsagePage } from "./usageReport";

/**
 * Les trois façons de regarder un écran, et ce que chacune exige.
 *
 * Elles vivaient en scripts npm du gabarit d'application — cinq entrées, dont
 * deux qui ne faisaient qu'un `npm i -D` et trois qui portaient un chemin EN DUR
 * vers `node_modules/@nodefony/devkit/…`. Ce chemin n'est pas un contrat : le
 * jour où le paquet réorganise ses dossiers, les trois cassent dans toutes les
 * applications déjà générées, sans que rien ne le signale. Une commande, elle,
 * résout le script et DIT ce qu'elle ne trouve pas.
 */
const MODES = {
  inspect: {
    script: "inspect.mjs",
    devDependencies: ["playwright", "axe-core"],
  },
  watch: { script: "watch.mjs", devDependencies: ["playwright", "axe-core"] },
  audit: { script: "audit.mjs", devDependencies: ["playwright", "lighthouse"] },
} as const;

/** Le mode demandé — l'inspection est le cas nominal. */
export type SeeMode = keyof typeof MODES;

/**
 * Où vivent les scripts du navigateur piloté, dans le paquet qui les publie.
 *
 * C'est un CONTRAT entre deux paquets : le cœur compose ce chemin, `@nodefony/devkit`
 * le sert. Exporté pour qu'un test le confronte au paquet réel — sans quoi une
 * réorganisation du devkit casserait `see` dans toutes les applications, et le
 * seul symptôme serait « le navigateur piloté n'est pas installé », qui envoie
 * chercher là où il n'y a rien.
 */
export const BROWSER_SCRIPTS_DIR = ["skills", "nodefony-browser", "scripts"];

/** Les sondes attendues dans ce dossier, une par mode. */
export const BROWSER_PROBES = Object.values(MODES).map((m) => m.script);

/**
 * Lit le mode dans une ligne de commande.
 *
 * @param argv - la ligne complète (`process.argv`).
 * @returns le mode demandé.
 */
export function pickMode(argv: readonly string[]): SeeMode {
  if (argv.includes("--audit")) return "audit";
  if (argv.includes("--watch")) return "watch";
  return "inspect";
}

/**
 * Les arguments à passer au script, mode retiré.
 *
 * @param argv - la ligne complète (`process.argv`).
 * @returns ce qui suit `see`, sans les drapeaux de mode.
 */
export function scriptArguments(argv: readonly string[]): string[] {
  const start = argv.findIndex((a) => a === "see");
  return (start === -1 ? [] : argv.slice(start + 1)).filter(
    (a) => a !== "--audit" && a !== "--watch" && a !== "--install",
  );
}

/**
 * Les paquets d'un mode qui manquent à un projet.
 *
 * Constaté sur disque, jamais déduit d'un `package.json` : ce qui compte est ce
 * qui est INSTALLÉ. Un paquet déclaré mais absent de `node_modules` ferait
 * échouer le script sur une trace de résolution que personne ne relie à une
 * installation manquante.
 *
 * @param root - racine du projet.
 * @param mode - le mode demandé.
 * @returns les noms de paquets absents, dans l'ordre.
 */
export function missingDependencies(root: string, mode: SeeMode): string[] {
  return MODES[mode].devDependencies.filter(
    (name) => !existsSync(path.join(root, "node_modules", ...name.split("/"))),
  );
}

/**
 * Le script du navigateur piloté, pour un mode.
 *
 * @param root - racine du projet.
 * @param mode - le mode demandé.
 * @returns le chemin absolu, ou `null` si le paquet qui le publie est absent.
 */
export function resolveBrowserScript(
  root: string,
  mode: SeeMode,
): string | null {
  const file = path.join(
    root,
    "node_modules",
    "@nodefony",
    "devkit",
    ...BROWSER_SCRIPTS_DIR,
    MODES[mode].script,
  );
  return existsSync(file) ? file : null;
}

/**
 * La page de `nodefony see --help`.
 *
 * Elle existe parce que le pied de l'aide PROMET `--help` à toute commande : le
 * fast-path de `see` passait ses arguments au script sans jamais regarder ce
 * drapeau, si bien que `nodefony see --help` tentait d'ouvrir la page
 * « --help » — `https://127.0.0.1:5152--help`, plantage du pilote. Une commande
 * qui ne tient pas cette promesse apprend au lecteur à ne plus la croire.
 */
const PAGE: IUsagePage = {
  command: "nodefony see",
  tagline:
    "Ouvre une page de l'application dans un navigateur piloté, et la MESURE.",
  synopsis: [
    "nodefony see [<chemin>] [<texte attendu>] [options]",
    "nodefony see --audit [<chemin>]",
    "nodefony see --watch [<chemin>] [<durée ms>]",
  ],
  sections: [
    {
      title: "MODES",
      entries: [
        {
          term: "(défaut)",
          text: "Photographie la page : contrastes CALCULÉS, accessibilité, réseau, console, capture.",
        },
        {
          term: "--watch",
          text: "Observe ce qui se PASSE dans la durée — frames du socket, requêtes, erreurs.",
        },
        {
          term: "--audit",
          text: "Audit Lighthouse complet, sur une page authentifiée.",
        },
      ],
    },
    {
      title: "CE QU'IL FAUT SAVOIR",
      bullets: [
        "N'installe RIEN sans qu'on le demande : l'outillage d'un navigateur piloté pèse des centaines de mégaoctets. La commande nomme ce qui manque et la ligne qui l'installe.",
        "Le décor se passe par variables d'environnement : NF_BROWSER_LOGIN, NF_BROWSER_USER, NF_BROWSER_PASSWORD, NF_BROWSER_PROBES, NF_BROWSER_ACTIONS, NF_BROWSER_FAMILIES.",
        "Se lance depuis la racine de l'application, là où vit nodefony.config.ts.",
      ],
    },
  ],
  options: [
    {
      term: "--install",
      text: "Installe les paquets manquants du mode demandé.",
    },
    { term: "--audit", text: "Mode audit Lighthouse." },
    { term: "--watch", text: "Mode observation dans la durée." },
    { term: "--help, -h", text: "Affiche cette page." },
  ],
  examples: [
    {
      term: "nodefony see",
      text: "La page d'accueil, telle qu'elle se monte.",
    },
    {
      term: 'nodefony see /connexion "Connexion"',
      text: "Une page précise, en attendant un texte qui prouve qu'elle est peuplée.",
    },
    { term: "nodefony see --audit /", text: "L'audit complet de l'accueil." },
  ],
  exitCodes: [
    {
      term: "1",
      text: "Décor absent : hors d'une application, paquet du navigateur non installé, ou dépendances du mode manquantes.",
    },
  ],
  footer:
    "Le navigateur est celui de la machine (chromium, sinon chrome, sinon msedge) — il n'y a le plus souvent rien à télécharger.",
};

/**
 * Commande `nodefony see` — ouvrir une page dans un navigateur piloté et la MESURER.
 *
 * Trois modes sous une seule entrée, et c'est délibéré : déplacer cinq scripts
 * npm vers trois commandes n'aurait fait que gonfler une autre surface. Ce qu'un
 * lecteur compte, ce sont les entrées qu'il voit — dans un `package.json` comme
 * dans un `--help`.
 *
 * N'installe RIEN sans qu'on le demande : l'outillage d'un navigateur piloté
 * pèse des centaines de mégaoctets. La commande dit ce qui manque et la ligne
 * exacte qui l'installe ; `--install` le fait.
 *
 * @param argv - la ligne de commande (`process.argv`).
 * @returns le code de sortie à rendre au shell.
 */
export async function runSeeCommand(argv: readonly string[]): Promise<number> {
  // Avant TOUT le reste : `--help` est une réponse, pas un chemin de page. Le
  // contrôle passe même hors d'une application — une page d'aide ne dépend pas
  // d'un décor, et la refuser ici renverrait l'erreur de décor à qui demandait
  // simplement ce que fait la commande.
  if (argv.includes("--help") || argv.includes("-h")) return printUsage(PAGE);

  const root = findProjectRoot(process.cwd());
  if (!root) {
    process.stderr.write(
      "[nodefony] aucune application ici — `see` mesure l'écran d'une application " +
        "Nodefony, depuis sa racine (là où vit `nodefony.config.ts`).\n",
    );
    return 1;
  }

  const mode = pickMode(argv);
  const script = resolveBrowserScript(root, mode);
  if (!script) {
    process.stderr.write(
      "[nodefony] le paquet qui porte le navigateur piloté n'est pas installé.\n" +
        "           npm i -D @nodefony/devkit\n",
    );
    return 1;
  }

  const missing = missingDependencies(root, mode);
  if (missing.length) {
    const install = `npm i -D ${missing.join(" ")}`;
    if (!argv.includes("--install")) {
      process.stderr.write(
        `[nodefony] il manque ${missing.join(" et ")} pour ce mode.\n` +
          `           ${install}\n` +
          `           ou relancer avec --install (plusieurs centaines de Mo).\n`,
      );
      return 1;
    }
    process.stdout.write(`[nodefony] installation : ${install}\n`);
    const npm = portableSpawn("npm", ["i", "-D", ...missing]);
    const installed = spawnSync(npm.file, npm.args, {
      cwd: root,
      stdio: "inherit",
      windowsVerbatimArguments: npm.windowsVerbatimArguments,
    });
    if (installed.status !== 0) return installed.status ?? 1;
  }

  // Le script est lancé par le Node COURANT, chemin absolu : aucun interpréteur
  // intermédiaire, donc rien à citer ni à échapper sur aucune plateforme.
  const run = spawnSync(process.execPath, [script, ...scriptArguments(argv)], {
    cwd: root,
    stdio: "inherit",
  });
  return run.status ?? 1;
}
