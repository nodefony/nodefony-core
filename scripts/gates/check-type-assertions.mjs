#!/usr/bin/env node
/**
 * check-type-assertions — PROVISOIRE : le total des conversions de type qui
 * RESSERRENT un type (`x as T` plus étroit que `x`, donc `as unknown as T`) ne
 * monte pas, paquet par paquet, d'ici à leur correction.
 *
 * ⚠️ À SUPPRIMER avec son fichier de plafonds dès que les sites sont corrigés :
 * la règle `typescript/no-unsafe-type-assertion` passe alors en `"error"` dans
 * `.oxlintrc.json` et mord partout, comme les autres. Ce garde-fou n'existe que
 * parce que 2 151 sites ne se corrigent pas en un commit — et le dépôt refuse
 * les listes de FICHIERS dans sa configuration (`fb1169479`) : il compte donc
 * par PAQUET, une douzaine de nombres, jamais par fichier.
 *
 * Deux refus :
 * - un paquet dépasse son plafond (une conversion de plus, ou un paquet neuf
 *   qui en porte) — la conversion se remplace par un `instanceof`, une garde,
 *   un type honnête ;
 * - un paquet est SOUS son plafond — le plafond s'abaisse dans le même commit
 *   (`--update`), sinon la marge regagnée serait reprise en silence ailleurs.
 *
 * ⚠️ L'analyse lit les types PUBLIÉS des paquets (`dist/types`) : pendant qu'un
 * build les vide (superviseur de développement qui rebâtit), le compte d'un
 * paquet voisin saute de quelques unités. Un rouge sur un paquet qu'on n'a pas
 * touché se RELANCE une fois le build fini, avant de se lire.
 *
 * @usage    node scripts/gates/check-type-assertions.mjs            # contrôle
 * @usage    node scripts/gates/check-type-assertions.mjs --update   # abaisse les plafonds (jamais ne les monte)
 * @output   l'écart par paquet ; sortie 0 tenu · 1 refusé · 78 oxlint n'a pas répondu
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const CEILINGS = path.join(
  ROOT,
  "scripts",
  "gates",
  "type-assertions.ceiling.json",
);
const RULE = "typescript/no-unsafe-type-assertion";
const UPDATE = process.argv.includes("--update");

/** Paquet d'un fichier : `nodefony`, `packages/@nodefony/http`, `modules/test`… */
function packageOf(file) {
  const m = /^src\/(nodefony|packages\/@nodefony\/[^/]+|modules\/[^/]+)\//.exec(
    file.split(path.sep).join("/"),
  );
  return m ? m[1] : file;
}

/** Conversions par paquet, code de PRODUCTION seul (les tests sont exemptés). */
function measure() {
  // Le point d'entrée JS, lancé par `node` : sous Windows, `node_modules/.bin`
  // ne porte qu'un `oxlint.cmd`, qu'`execFileSync` ne sait pas lancer sans shell.
  const oxlint = path.join(ROOT, "node_modules", "oxlint", "bin", "oxlint");
  let out;
  try {
    out = execFileSync(
      process.execPath,
      [
        oxlint,
        "-A",
        "all",
        "-D",
        RULE,
        "--format",
        "json",
        "src/nodefony/src",
        "src/packages",
        "src/modules",
        "--ignore-pattern",
        "**/tests/**",
        "--ignore-pattern",
        "**/*.test.ts",
        "--ignore-pattern",
        "**/*.test.tsx",
      ],
      {
        cwd: ROOT,
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch (e) {
    // oxlint sort 1 quand il trouve : c'est le cas nominal, la sortie est là.
    out = e.stdout;
  }
  let report;
  try {
    report = JSON.parse(out);
  } catch {
    console.error(
      "check-type-assertions : oxlint n'a pas rendu de JSON lisible.",
    );
    process.exit(78);
  }
  const counts = {};
  for (const d of report.diagnostics) {
    // Sans `code` : les directives `oxlint-disable` rendues inutiles par `-A all`.
    if (!d.code?.includes("no-unsafe-type-assertion")) continue;
    const key = packageOf(d.filename);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

const current = measure();
const ceilings = fs.existsSync(CEILINGS)
  ? JSON.parse(fs.readFileSync(CEILINGS, "utf8")).ceilings
  : {};
const keys = [
  ...new Set([...Object.keys(ceilings), ...Object.keys(current)]),
].sort();
const over = [];
const under = [];
for (const key of keys) {
  const now = current[key] ?? 0;
  const max = ceilings[key] ?? 0;
  if (now > max) over.push(`${key} : ${now} (plafond ${max}, +${now - max})`);
  else if (now < max)
    under.push(`${key} : ${now} (plafond ${max}, −${max - now})`);
}

if (UPDATE) {
  // Première pose seulement : sans fichier, les plafonds se relèvent tels quels.
  if (over.length > 0 && fs.existsSync(CEILINGS)) {
    console.error("❌ refus : un plafond ne MONTE jamais.");
    for (const l of over) console.error(`   ${l}`);
    process.exit(1);
  }
  const next = {};
  for (const key of keys) if ((current[key] ?? 0) > 0) next[key] = current[key];
  const total = Object.values(next).reduce((a, b) => a + b, 0);
  fs.writeFileSync(
    CEILINGS,
    `${JSON.stringify({ _provisoire: "supprimer avec check-type-assertions.mjs une fois les sites corrigés", total, ceilings: next }, null, 2)}\n`,
  );
  console.log(`✓ plafonds abaissés — total ${total}`);
  process.exit(0);
}

if (over.length > 0) {
  console.error(
    "❌ conversion(s) de type qui resserrent le type — au-delà du plafond du paquet :",
  );
  for (const l of over) console.error(`   ${l}`);
  console.error(
    "   → remplacer par un instanceof, une garde ou un type honnête :",
  );
  console.error(`     ./node_modules/.bin/oxlint -A all -D ${RULE} <fichier>`);
  process.exit(1);
}
if (under.length > 0) {
  console.error(
    "❌ plafond en retard — des conversions ont été corrigées, il faut l'abaisser :",
  );
  for (const l of under) console.error(`   ${l}`);
  console.error(
    "   → node scripts/gates/check-type-assertions.mjs --update  puis git add scripts/gates/type-assertions.ceiling.json",
  );
  process.exit(1);
}
const total = Object.values(current).reduce((a, b) => a + b, 0);
console.log(
  `✓ conversions de type : ${total}, aucun paquet au-delà de son plafond`,
);
