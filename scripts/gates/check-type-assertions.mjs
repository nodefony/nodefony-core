#!/usr/bin/env node
/**
 * check-type-assertions — cliquet : le total des conversions de type qui
 * RESSERRENT un type (`x as T` plus étroit que `x`, donc `as unknown as T`) ne
 * monte jamais, paquet par paquet.
 *
 * Il RESTE (décision de #572) : seules les conversions de FRONTIÈRE (valeur
 * venue du réseau, d'un store, d'un IPC) se corrigent par un geste dédié ; les
 * conversions INTERNES se résorbent au fil des retouches, le cliquet figeant
 * chaque baisse. La règle `typescript/no-unsafe-type-assertion` ne passera donc
 * pas en `"error"` : le dépôt refuse les listes de FICHIERS dans sa
 * configuration (`fb1169479`), il compte par PAQUET, une douzaine de nombres.
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

/**
 * Lignes ajoutées ou modifiées par le travail en cours (arbre ET index contre
 * `HEAD`) ; sur un arbre propre — la forge —, celles du dernier commit.
 * Rend `null` si git ne répond pas : le refus reste juste, il ne localise plus.
 */
function changedLines() {
  const read = (args) =>
    execFileSync("git", ["diff", "--unified=0", "--no-color", ...args], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  let diff;
  let label;
  try {
    diff = read(["HEAD"]);
    label = "modifiées depuis le dernier commit";
    if (diff.trim() === "") {
      diff = read(["HEAD~1", "HEAD"]);
      label = "du dernier commit";
    }
  } catch {
    return null;
  }
  const lines = new Map();
  let file = null;
  for (const l of diff.split("\n")) {
    const f = /^\+\+\+ b\/(.+)$/.exec(l);
    if (f) {
      file = f[1];
      lines.set(file, new Set());
      continue;
    }
    const h = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(l);
    if (h && file) {
      const start = Number(h[1]);
      const count = h[2] === undefined ? 1 : Number(h[2]);
      for (let n = start; n < start + count; n++) lines.get(file).add(n);
    }
  }
  return { lines, label };
}

/**
 * Les conversions d'un paquet en excès qui tombent sur une ligne que le
 * travail en cours a touchée — les coupables probables, avec le type d'origine
 * et le type imposé que donne l'aide d'oxlint.
 */
function locateNew(candidates) {
  const changed = changedLines();
  if (changed === null) return { lines: [], label: "(git n'a pas répondu)" };
  const out = [];
  for (const d of candidates) {
    const file = d.filename.split(path.sep).join("/");
    const line = d.labels?.[0]?.span?.line;
    if (!line || !changed.lines.get(file)?.has(line)) continue;
    const types =
      /has type `(.+?)`, and the assertion changes it to `(.+?)`/.exec(
        d.help ?? "",
      );
    const col = d.labels[0].span.column ?? 1;
    out.push(
      `${file}:${line}:${col}` + (types ? `  ${types[1]} → ${types[2]}` : ""),
    );
  }
  return { lines: out, label: changed.label };
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
// Lu une fois : l'absence se constate par l'échec de la lecture, jamais par un
// `existsSync` que le fichier peut démentir avant l'écriture (js/file-system-race).
let ceilingsText = null;
try {
  ceilingsText = fs.readFileSync(CEILINGS, "utf8");
} catch {
  // première pose : aucun plafond encore écrit
}
const ceilings = ceilingsText === null ? {} : JSON.parse(ceilingsText).ceilings;
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
  if (over.length > 0 && ceilingsText !== null) {
    console.error("❌ refus : un plafond ne MONTE jamais.");
    for (const l of over) console.error(`   ${l}`);
    process.exit(1);
  }
  const next = {};
  for (const key of keys) if ((current[key] ?? 0) > 0) next[key] = current[key];
  const total = Object.values(next).reduce((a, b) => a + b, 0);
  fs.writeFileSync(
    CEILINGS,
    `${JSON.stringify({ _note: "cliquet — plafonds abaissés par --update, jamais montés (#572)", total, ceilings: next }, null, 2)}\n`,
  );
  console.log(`✓ plafonds abaissés — total ${total}`);
  process.exit(0);
}

if (over.length > 0) {
  const overKeys = new Set(
    keys.filter((k) => (current[k] ?? 0) > (ceilings[k] ?? 0)),
  );
  const suspects = locateNew(
    diagnostics.filter((d) => overKeys.has(packageOf(d.filename))),
  );
  console.error(
    "❌ conversions de type REFUSÉ : un paquet dépasse son plafond de conversions qui resserrent un type.",
  );
  for (const l of over) console.error(`   ${l}`);
  console.error(
    "   Pourquoi : `x as T` fait taire le compilateur sans rien vérifier — si la valeur n'est pas un T,",
  );
  console.error(
    "   l'erreur sort plus loin, en production, sans désigner la conversion.",
  );
  if (suspects.lines.length > 0) {
    console.error(`   Où (${suspects.label}) :`);
    for (const l of suspects.lines) console.error(`     ${l}`);
  } else {
    console.error(
      `   Où : aucune ligne ${suspects.label} n'en porte — c'est un TYPE qui a changé et rendu une conversion`,
    );
    console.error(
      "   existante « resserrante ». Lister celles du paquet et comparer avec le dernier commit vert :",
    );
    console.error(
      `     ./node_modules/.bin/oxlint -A all -D ${RULE} <dossier du paquet>`,
    );
  }
  console.error(
    '   Faire : vérifier la valeur au lieu de l\'affirmer — `instanceof`, une garde (`typeof v === "object" && …`),',
  );
  console.error(
    "           un schéma Zod à la frontière, ou un type d'entrée plus juste qui rend la conversion inutile.",
  );
  console.error(
    `   Contrôler : ./node_modules/.bin/oxlint -A all -D ${RULE} <fichier>`,
  );
  console.error(
    "   Puis : git add <fichier> && git commit (le plafond ne se relève JAMAIS)",
  );
  process.exit(1);
}
if (under.length > 0) {
  console.error(
    "❌ conversions de type REFUSÉ : des conversions ont été corrigées, et le plafond ne le sait pas encore.",
  );
  for (const l of under) console.error(`   ${l}`);
  console.error(
    "   Pourquoi : la marge regagnée serait reprise en silence par la prochaine conversion ajoutée ailleurs.",
  );
  console.error(
    "   Faire : node scripts/gates/check-type-assertions.mjs --update",
  );
  console.error(
    "   Puis  : git add scripts/gates/type-assertions.ceiling.json && git commit",
  );
  process.exit(1);
}
const total = Object.values(current).reduce((a, b) => a + b, 0);
console.log(
  `✓ conversions de type : ${total}, aucun paquet au-delà de son plafond`,
);
