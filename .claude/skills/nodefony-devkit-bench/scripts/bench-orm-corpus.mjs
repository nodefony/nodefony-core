#!/usr/bin/env node
/**
 * Corpus du banc ORM — les tables `llx_user`, `llx_societe`, `llx_facture` du
 * corpus `erp` (et celles qu'elles référencent), écrites dans le module `test`
 * pour son décor opt-in `NF_BENCH_ORM=1` (`entity/benchOrm.ts`).
 *
 * Aucune seconde traduction : les descriptions viennent de `specs.json`
 * (`mysql-ddl-to-specs.mjs`) et le matérialiseur est recopié, imports relus
 * (`lib/materializer-copy.mjs`). Le dossier écrit est IGNORÉ par git — corpus
 * sous licence tierce, jamais versionné — et compilé par le build du module :
 * le serveur ET les camps témoins du banc (`nodefony-load-test`) lisent la MÊME
 * table dans son `dist`.
 *
 * Usage : `node bench-orm-corpus.mjs [--specs <specs.json>]`, puis
 * `npm run build` dans `src/modules/test`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  copyMaterializer,
  referenceClosure,
} from "./lib/materializer-copy.mjs";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(ICI, "..", "..", "..", "..");
const ROOTS = ["llx_user", "llx_societe", "llx_facture"];
const OUT = path.join(
  REPO,
  "src",
  "modules",
  "test",
  "nodefony",
  "entity",
  "benchCorpus",
);

const at = process.argv.indexOf("--specs");
const SPECS_FILE =
  at > 0 && process.argv[at + 1]
    ? path.resolve(process.argv[at + 1])
    : path.join(REPO, "tmp", "bench", "corpus", "erp", "specs.json");

if (!existsSync(SPECS_FILE)) {
  console.error(
    `❌ ${SPECS_FILE} absent — le produire d'abord :\n` +
      "   node .claude/skills/nodefony-devkit-bench/scripts/corpus-fetch.mjs\n" +
      "   node .claude/skills/nodefony-devkit-bench/scripts/mysql-ddl-to-specs.mjs",
  );
  process.exit(2);
}

const { specs } = JSON.parse(readFileSync(SPECS_FILE, "utf8"));
const kept = referenceClosure(specs, ROOTS);

mkdirSync(OUT, { recursive: true });
writeFileSync(
  path.join(OUT, "serializedSpecs.ts"),
  copyMaterializer(REPO, "bench-orm-corpus.mjs"),
);
writeFileSync(
  path.join(OUT, "corpus.ts"),
  [
    "// GÉNÉRÉ par bench-orm-corpus.mjs — corpus tiers, jamais versionné.",
    `import { materializeSpecs, type ISerializedSpec } from "./serializedSpecs";`,
    "",
    `const SPECS: readonly ISerializedSpec[] = ${JSON.stringify(kept)};`,
    "",
    "/** Les tables du banc ORM et celles qu'elles référencent, par nom. */",
    "export const BENCH_CORPUS = materializeSpecs(SPECS);",
    "",
  ].join("\n"),
);
process.stdout.write(
  `✅ ${kept.length} tables (${kept.map((s) => s.name).join(", ")}) → ${path.relative(REPO, OUT)}\n` +
    "   Suite : (cd src/modules/test && npm run build)\n",
);
