/**
 * generate-symbols.ts — Symbol graph extractor for AI agents.
 *
 * Parses TS files matching the config globs, emits three JSON outputs — all
 * GENERATED and git-ignored, never committed:
 *  - .ai/symbols.json              → le graphe du dépôt entier, pour les agents
 *  - src/nodefony/.ai/symbols.json → la copie PUBLIÉE avec `nodefony`, réduite
 *                                    aux modules publiés
 *  - .ai/symbols.verbose.json      → le détail complet
 *
 * Les hooks git `post-commit`, `post-merge` et `post-checkout` le régénèrent en
 * arrière-plan quand la zone parsée a bougé ; la CI le régénère où elle le lit.
 *
 * @usage npm run generate-symbols
 * @option --verbose  détail ligne par ligne des homonymes
 * @option --check-staged  code 1 si un fichier indexé touche la zone parsée
 * @option --check-range <de> <à>  code 1 si la zone a bougé entre deux révisions, ou si le graphe manque
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import ts from "typescript";
import picomatch from "picomatch";
import config from "./generate-symbols.config.ts";
import {
  filterGraphToModules,
  moduleOf,
  publishableWorkspaces,
  publishedModules,
} from "../lib/symbols-publish.mjs";
import { REPO_ROOT as repoRoot } from "../lib/repo-root.mjs";
// SOURCE du cœur, pas son dist : le graphe se régénère sur un clone neuf, avant
// tout build. L'extraction n'a qu'une implémentation — celle que
// `nodefony symbols --generate` exécute dans une application.
import {
  buildSymbolsGraph,
  readSourceInputs,
  readSymbolsProducer,
  SYMBOLS_PRODUCER_REPOSITORY,
  writeFileAtomic,
} from "../../src/nodefony/src/cli/symbolsGraph.ts";

// ─── Main ───────────────────────────────────────────────────────────────────

function generate(): void {
  console.log("🔧 generate-symbols — parsing TypeScript sources…");

  // `fs.globSync` (Node ≥ 22 — sans dépendance : `fast-glob` tirait `braces`
  // dans l'audit).
  const matched = fs.globSync(config.include, {
    cwd: repoRoot,
    exclude: config.exclude,
  });
  const { inputs, skipped } = readSourceInputs(repoRoot, matched, moduleOf);
  for (const s of skipped) {
    console.log(
      `  ⚠ skip large file (${(s.bytes / 1024).toFixed(0)} KB): ${s.file}`,
    );
  }
  console.log(
    `  → ${matched.length} files matched, ${inputs.length} parsed (skipped: ${skipped.length} large)`,
  );

  const { stable, verbose, homonyms } = buildSymbolsGraph(
    ts,
    inputs,
    SYMBOLS_PRODUCER_REPOSITORY,
  );
  // Les homonymes (même nom dans 2 modules) sont attendus et namespacés : un
  // résumé suffit, le détail ligne par ligne vient avec `--verbose`.
  if (process.argv.includes("--verbose")) {
    for (const h of homonyms) console.warn(`  ⚠ homonym: ${h}`);
  } else if (homonyms.length > 0) {
    console.warn(
      `  ⚠ ${homonyms.length} homonymes namespacés (lancer avec --verbose pour le détail)`,
    );
  }

  const stablePath = path.join(repoRoot, config.output.stable);
  writeFileAtomic(stablePath, JSON.stringify(stable, null, 2) + "\n");

  // ─── Copie PUBLIÉE : le graphe part avec le paquet `nodefony` ──────────────
  // Sans elle, une application installée depuis npm lisait un fichier absent
  // et recevait une liste vide, sans qu'un seul message ne le dise. Un seul
  // exemplaire, porté par le CŒUR, pas un par paquet : 19 copies dériveraient
  // dès qu'une seule ne serait pas régénérée.
  //
  // RÉDUIT aux modules PUBLIÉS : le graphe du dépôt décrit aussi les modules de
  // banc et les paquets privés en chantier, qu'aucune application n'installera.
  const shippedPath = path.join(repoRoot, "src/nodefony/.ai/symbols.json");
  const shipped = filterGraphToModules(
    stable,
    publishedModules(publishableWorkspaces(repoRoot)),
  );
  writeFileAtomic(shippedPath, JSON.stringify(shipped, null, 2) + "\n");

  const verbosePath = path.join(repoRoot, config.output.verbose);
  writeFileAtomic(verbosePath, JSON.stringify(verbose, null, 2) + "\n");

  const { stats } = stable;
  console.log("✅ generate-symbols done");
  console.log(`  → ${stats.files} files, ${stats.symbols} symbols`);
  console.log(
    `     classes: ${stats.classes}, interfaces: ${stats.interfaces}, types: ${stats.types}, enums: ${stats.enums}, functions: ${stats.functions}, constants: ${stats.constants}`,
  );
  console.log(
    `  → stable  : ${config.output.stable} (${(fs.statSync(stablePath).size / 1024).toFixed(1)} KB, ${Object.keys(stable.symbols).length} exported symbols)`,
  );
  console.log(
    `  → verbose : ${config.output.verbose} (${(fs.statSync(verbosePath).size / 1024).toFixed(1)} KB, ${Object.keys(verbose.symbols).length} symbols)`,
  );
}

// ─── --check-staged mode (for pre-commit hook) ──────────────────────────────
//
// Reads `git diff --cached --name-only` and tests staged files against the
// same include/exclude globs the script uses for parsing.
//   exit 0 → no staged file matches → no regeneration needed
//   exit 1 → at least one match → caller should run generate-symbols
//
// This is the unique source of truth: change include/exclude in
// `generate-symbols.config.ts` and both the parsing scope and the hook
// trigger update together.

/** Un des fichiers donnés est-il dans la zone parsée (include − exclude) ? */
function touchesParsedZone(files: string[]): boolean {
  const includeMatchers = config.include.map((p) => picomatch(p));
  const excludeMatchers = config.exclude.map((p) => picomatch(p));
  return files.some(
    (file) =>
      includeMatchers.some((m) => m(file)) &&
      !excludeMatchers.some((m) => m(file)),
  );
}

/** Lance `git` et rend ses lignes non vides — `null` si git refuse. */
function gitLines(args: string): string[] | null {
  try {
    return execSync(`git ${args}`, { cwd: repoRoot, encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
  } catch {
    return null;
  }
}

function checkStaged(): never {
  const staged = gitLines("diff --cached --name-only --diff-filter=ACMR");
  process.exit(staged && touchesParsedZone(staged) ? 1 : 0);
}

// ─── --check-range mode (hooks post-commit / post-merge / post-checkout) ────
//
// Le graphe n'est plus versionné : les hooks le régénèrent APRÈS coup, en
// arrière-plan, quand la zone parsée a bougé entre deux révisions.
//   exit 1 → régénérer (zone touchée, ou graphe absent : clone neuf)
//   exit 0 → rien à faire
function checkRange(from: string | undefined, to: string | undefined): never {
  // Absent, ou écrit par un AUTRE producteur : ce dépôt est aussi une
  // application de développement, dont le superviseur sait écrire le graphe
  // du code applicatif — réduit, et qui masquerait celui du framework.
  if (
    readSymbolsProducer(path.join(repoRoot, config.output.stable)) !==
    SYMBOLS_PRODUCER_REPOSITORY
  )
    process.exit(1);
  if (!from || !to) process.exit(1);
  const changed = gitLines(`diff --name-only ${from} ${to}`);
  // Révision illisible (premier commit, ORIG_HEAD absent) : dans le doute, on
  // régénère — dix secondes en arrière-plan coûtent moins qu'un graphe faux.
  process.exit(changed === null || touchesParsedZone(changed) ? 1 : 0);
}

// Entrypoint
if (process.argv.includes("--check-staged")) {
  checkStaged();
}
const rangeAt = process.argv.indexOf("--check-range");
if (rangeAt !== -1) {
  checkRange(process.argv[rangeAt + 1], process.argv[rangeAt + 2]);
}

generate();
