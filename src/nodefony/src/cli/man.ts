import path from "node:path";
import { spawnSync } from "node:child_process";
import { printUsage, printUsageError, type IUsagePage } from "./usageReport";
import { SysExit } from "./sysexits";
import { stripGlobalCliFlags } from "./globalFlags";
import { findPackageRoot } from "./scaffold/engine";

/** La page d'aide — `nodefony man --help`, et le rappel après un refus. */
const PAGE: IUsagePage = {
  command: "nodefony man",
  tagline:
    "ouvre la page de manuel livrée avec le paquet nodefony de ce projet",
  sections: [
    {
      title: "POURQUOI PAS `man nodefony`",
      paragraph:
        "`man nodefony` ne trouve la page que si le paquet est installé en " +
        "GLOBAL : npm ne l'inscrit au chemin du manuel qu'à ce moment-là. " +
        "Dans une application (installation locale, `npx`), cette commande " +
        "ouvre la page du paquet du projet — celle de la version qui le " +
        "pilote. Sans programme `man` (Windows), elle donne le chemin du " +
        "fichier, et `nodefony --help` en porte le contenu.",
    },
  ],
  options: [
    { term: "--path", text: "écrit le chemin de la page, sans l'ouvrir" },
  ],
  examples: [
    { term: "nodefony man", text: "lit le manuel" },
    {
      term: 'man "$(nodefony man --path)"',
      text: "même page, ouverte par le `man` du système",
    },
  ],
  exitCodes: [
    {
      term: "69",
      text: "aucun programme `man` sur ce système (EX_UNAVAILABLE)",
    },
  ],
};

/**
 * Lit les options de `nodefony man`.
 *
 * @param argv - `process.argv` complet.
 * @returns les options, ou l'erreur d'usage à rendre.
 */
export function parseManArgv(
  argv: string[],
): { path: boolean; help: boolean } | { error: string } {
  const args = stripGlobalCliFlags(argv.slice(2).filter((a) => a !== "man"));
  let printPath = false;
  let help = false;
  for (const a of args) {
    if (a === "--help" || a === "-h") help = true;
    else if (a === "--path") printPath = true;
    else return { error: `option inconnue : ${a}` };
  }
  return { path: printPath, help };
}

/**
 * Chemin de la page de manuel du paquet `nodefony` qui exécute la commande.
 *
 * @returns le chemin absolu de `man/nodefony.1`, natif (on l'OUVRE).
 */
export function manPagePath(): string {
  return path.join(findPackageRoot(), "man", "nodefony.1");
}

/**
 * Point d'entrée de `nodefony man` — sans boot du kernel.
 *
 * La présence de `man` se CONSTATE (le lancement échoue ou non), elle ne se
 * déduit pas de `process.platform` : un conteneur Linux minimal n'en a pas
 * davantage qu'un poste Windows.
 *
 * @param argv - `process.argv` complet.
 * @returns exit code du `man` lancé, `OK` pour `--path`, `UNAVAILABLE` sans
 *   programme `man`, `USAGE` sur une option inconnue.
 */
export function runManCommand(argv: string[]): number {
  const parsed = parseManArgv(argv);
  if ("error" in parsed) return printUsageError(PAGE, parsed.error);
  if (parsed.help) return printUsage(PAGE);
  const page = manPagePath();
  if (parsed.path) {
    process.stdout.write(`${page}\n`);
    return SysExit.OK;
  }
  const run = spawnSync("man", [page], { stdio: "inherit" });
  if (run.error) {
    process.stderr.write(
      `man: aucun programme \`man\` ici (${run.error.message}).\n` +
        `La page est ${page} ; \`nodefony --help\` en porte le contenu.\n`,
    );
    return SysExit.UNAVAILABLE;
  }
  return run.status ?? SysExit.OK;
}
