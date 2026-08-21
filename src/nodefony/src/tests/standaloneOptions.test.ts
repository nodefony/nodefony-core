import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 🔴 Les commandes STANDALONE déclarent leurs options DEUX fois, et la seconde
 * déclaration est muette quand elle oublie une option.
 *
 * Ces commandes (`card`, `check`, `env`, `symbols`, `ai:sync`, `ai:mcp`,
 * `git:hooks`) s'exécutent sans booter le kernel : un fast-path de `CliKernel`
 * les intercepte et c'est leur PARSEUR qui fait le travail. Mais commander doit
 * quand même connaître la commande — c'est lui qui alimente `--help`, la
 * complétion, le menu et `man nodefony`. D'où une classe `*Command` qui redit
 * les mêmes options.
 *
 * Rien ne reliait les deux. Une option ajoutée au parseur FONCTIONNE mais
 * n'apparaît nulle part : ni à l'aide, ni au TAB, ni au menu, ni au manuel.
 * Constaté par le développeur sur `ai:mcp --auth` livrée le jour même — puis
 * mesuré : SIX options invisibles sur cinq commandes, dont `git:hooks --get`
 * et `--show-toplevel`, et le `--cwd` de trois commandes.
 *
 * Ce test compare les deux déclarations, dans les deux sens. Il ne prouve pas
 * qu'une option est utile : il prouve qu'on ne peut plus en livrer une que
 * personne ne peut découvrir.
 */

const ICI = path.dirname(fileURLToPath(import.meta.url));

/**
 * Drapeaux qu'un PARSEUR reconnaît : ceux qu'il COMPARE à un mot de la ligne de
 * commande (`word === "--json"`).
 *
 * ⚠️ Lire tous les littéraux `"--x"` du fichier ne marche pas — la première
 * version de ce test l'a fait et a accusé `git:hooks` de cacher `--get` et
 * `--show-toplevel`, qui sont des arguments passés à **git**
 * (`git config --get core.hooksPath`). Une sonde trop large invente des
 * défauts, et on corrige alors ce qui n'est pas cassé.
 */
function drapeauxAcceptes(fichier: string): Set<string> {
  const source = readFileSync(fichier, "utf8");
  const trouves = source.match(/===\s*"(--[a-z][a-z-]*)"/gu) ?? [];
  return new Set(trouves.map((f) => f.slice(f.indexOf('"--') + 1, -1)));
}

/** Drapeaux qu'une commande commander PUBLIE (`addOption`). */
function drapeauxPublies(fichier: string): Set<string> {
  const source = readFileSync(fichier, "utf8");
  const trouves = source.match(/addOption\(\s*"[^"]+"/gu) ?? [];
  const flags = new Set<string>();
  for (const appel of trouves) {
    for (const mot of appel.match(/--[a-z][a-z-]*/gu) ?? []) flags.add(mot);
  }
  return flags;
}

/**
 * Les paires (parseur standalone, commande commander).
 *
 * `check` est absent : son parseur vit dans `kernel/checks/runCheck.ts`, pas
 * dans `cli/`. Il est ajouté ici parce que le défaut ne connaît pas les
 * dossiers.
 */
const PAIRES: ReadonlyArray<readonly [string, string, string]> = [
  ["ai:mcp", "../cli/aiMcp.ts", "../kernel/commands/AiMcpCommand.ts"],
  ["ai:sync", "../cli/aiSync.ts", "../kernel/commands/AiSyncCommand.ts"],
  ["card", "../cli/card.ts", "../kernel/commands/CardCommand.ts"],
  ["env", "../cli/env.ts", "../kernel/commands/EnvCommand.ts"],
  ["git:hooks", "../cli/gitHooks.ts", "../kernel/commands/GitHooksCommand.ts"],
  ["symbols", "../cli/symbols.ts", "../kernel/commands/SymbolsCommand.ts"],
  [
    "check",
    "../kernel/checks/runCheck.ts",
    "../kernel/commands/CheckCommand.ts",
  ],
];

describe("commandes standalone — l'aide et la complétion connaissent CHAQUE option", () => {
  for (const [nom, parseur, commande] of PAIRES) {
    it(`${nom} : aucune option acceptée n'est invisible`, () => {
      const accepte = drapeauxAcceptes(path.join(ICI, parseur));
      const publie = drapeauxPublies(path.join(ICI, commande));
      const invisibles = [...accepte].filter((f) => !publie.has(f)).sort();
      expect(
        invisibles,
        `${nom} accepte ${invisibles.join(", ")} mais ne le publie pas : ` +
          `absent de --help, de la complétion, du menu et du man`,
      ).toEqual([]);
    });

    it(`${nom} : aucune option annoncée n'est refusée`, () => {
      const accepte = drapeauxAcceptes(path.join(ICI, parseur));
      const publie = drapeauxPublies(path.join(ICI, commande));
      // L'inverse est PIRE : l'aide promet un drapeau que le parseur rejette
      // en « option inconnue ». Le développeur croit à un bug de sa ligne.
      const menteuses = [...publie].filter((f) => !accepte.has(f)).sort();
      expect(
        menteuses,
        `${nom} annonce ${menteuses.join(", ")} que son parseur refuse`,
      ).toEqual([]);
    });
  }
});
