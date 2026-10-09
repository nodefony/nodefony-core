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
 * @usage    node scripts/gates/check-type-assertions.mjs --triage   # relevé : d'où vient chaque valeur convertie (#572)
 * @output   l'écart par paquet ; sortie 0 tenu · 1 refusé · 78 oxlint n'a pas répondu
 * @output   --triage : tableau paquet × famille, détail dans tmp/reports/type-assertions-triage.json
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
const TRIAGE = process.argv.includes("--triage");

/** Paquet d'un fichier : `nodefony`, `packages/@nodefony/http`, `modules/test`… */
function packageOf(file) {
  const m = /^src\/(nodefony|packages\/@nodefony\/[^/]+|modules\/[^/]+)\//.exec(
    file.split(path.sep).join("/"),
  );
  return m ? m[1] : file;
}

/** Diagnostics de la règle, code de PRODUCTION seul (les tests sont exemptés). */
function collect() {
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
  // Sans `code` : les directives `oxlint-disable` rendues inutiles par `-A all`.
  return report.diagnostics.filter((d) =>
    d.code?.includes("no-unsafe-type-assertion"),
  );
}

/**
 * Familles du relevé, testées dans l'ordre sur l'expression CONVERTIE (le texte
 * que l'étiquette d'oxlint désigne). Heuristique par le nom de la source : elle
 * oriente la lecture, elle ne la remplace pas — `frontier` dit si la famille
 * porte une valeur venue de l'extérieur (#572), seules celles-là se traitent.
 */
const FAMILIES = [
  ["metadata", true, /Reflect\.(get|getOwn)Metadata/],
  ["file", true, /JSON\.parse\(\s*(await\s+)?(fs\.)?readFile(Sync)?\(/],
  ["parsed", true, /JSON\.parse|\.json\(\)/],
  ["thrown", false, /^\(?(e|err|error|reason|cause|ex)\)?$/],
  [
    "database",
    true,
    /\b(rows?|result|records?|docs?|lean)\b|\.(get|all|first)\(\)|\[0\]$/,
  ],
  [
    "wire",
    true,
    /\b(payload|message|msg|frame|body|chunk|packet|claims|parsed|headers|state|detail|data)\b/,
  ],
  ["storage", true, /(local|session)Storage|import\(/],
  ["container", true, /\b(container|getService)\b|\.get\(["'`]/],
  [
    "config",
    false,
    /module\.options|useConfig|\b(options|config|settings)\b|process\.env/,
  ],
  [
    "internal",
    false,
    /Object\.create|extend\(|getPrototypeOf|getProto|\.prototype|\bas unknown$|\bthis\.(context|controller|kernel|cli|server)\b|\bstore\??\.|\bcontext\b/,
  ],
];

/** Relevé #572 : chaque conversion rangée par l'origine probable de sa valeur. */
function triage(diagnostics) {
  const sources = new Map();
  const rows = diagnostics.map((d) => {
    const span = d.labels[0].span;
    if (!sources.has(d.filename))
      sources.set(d.filename, fs.readFileSync(path.join(ROOT, d.filename)));
    // L'étendue d'oxlint est en OCTETS : découper le Buffer, pas la chaîne.
    const text = sources
      .get(d.filename)
      .subarray(span.offset, span.offset + span.length)
      .toString("utf8")
      .replace(/\s+/g, " ")
      .trim();
    const fromAny = /from `any`/.test(d.message);
    const [family, frontier] = FAMILIES.find(([, , re]) => re.test(text)) ?? [
      "unclassified",
      false,
    ];
    return {
      package: packageOf(d.filename),
      file: d.filename.split(path.sep).join("/"),
      line: span.line,
      fromAny,
      family,
      frontier,
      text,
    };
  });
  const table = {};
  for (const r of rows) {
    const t = (table[r.package] ??= { frontière: 0, total: 0 });
    t.total++;
    if (r.frontier) t.frontière++;
    t[r.family] = (t[r.family] ?? 0) + 1;
  }
  const out = path.join(ROOT, "tmp", "reports", "type-assertions-triage.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(rows, null, 1)}\n`);
  console.table(
    Object.fromEntries(
      Object.entries(table).sort((a, b) => b[1].frontière - a[1].frontière),
    ),
  );
  const frontier = rows.filter((r) => r.frontier).length;
  console.log(
    `${rows.length} conversions, ${frontier} de frontière probable — détail : ${path.relative(ROOT, out)}`,
  );
}

const diagnostics = collect();
if (TRIAGE) {
  triage(diagnostics);
  process.exit(0);
}
const current = {};
for (const d of diagnostics) {
  const key = packageOf(d.filename);
  current[key] = (current[key] ?? 0) + 1;
}
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
