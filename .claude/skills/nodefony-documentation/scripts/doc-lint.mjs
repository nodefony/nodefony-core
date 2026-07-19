#!/usr/bin/env node
// doc-lint.mjs — Definition of Done mécanique pour la doc Nodefony.
// Une page ne peut être marquée ✅ que si elle PASSE ce linter.
// Usage : node doc-lint.mjs /tmp/corpus/*.md
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Les compteurs sont des ARTEFACTS régénérables (gen-counters.mjs) → tmp/doc-work/.
import { execSync } from "node:child_process";
const REPO = execSync("git rev-parse --show-toplevel", {
  encoding: "utf8",
}).trim();
const COVERAGE = path.join(REPO, "tmp/doc-work/coverage");
const files = process.argv.slice(2);
if (!files.length) {
  console.error("usage: node doc-lint.mjs <fichier.md ...>");
  process.exit(2);
}

// Sections obligatoires (regex sur les titres H2, insensible casse/accents partiels).
// `(?:\S+\s+)?` tolère l'icône de section canonique (standard §6-ergo n°8 : `## 🚀 Démarrage…`).
//
// Un HUB (`index.md`) n'est pas une page de brique : il ORIENTE (parcours guidés + catalogue en
// cards) au lieu d'expliquer un concept. Lui réclamer Lexique/Pièges/Tests/ancres produirait du
// remplissage — exactement ce que le standard interdit. Il a donc ses propres exigences (§8bis-index).
const REQUIRED_HUB = [
  {
    key: "par où commencer (parcours guidés)",
    re: /^##\s+(?:\S+\s+)?Par o[uù] commencer/im,
  },
  { key: "catalogue (cards)", re: /^###\s+\[?`/m },
  {
    key: "pour aller plus loin",
    re: /^##\s+(?:\S+\s+)?Pour aller plus loin/im,
  },
];
const REQUIRED = [
  { key: "lexique", re: /^##\s+(?:\S+\s+)?Lexique/im },
  {
    key: "qu'est-ce / vision",
    re: /^##\s+(?:\S+\s+)?(Qu['e]|La vision|Le mod[eè]le)/im,
  },
  { key: "pièges", re: /^##\s+(?:\S+\s+)?Pi[eè]ges/im },
  {
    key: "pour aller plus loin",
    re: /^##\s+(?:\S+\s+)?Pour aller plus loin/im,
  },
];
// Section Tests : obligatoire SAUF opt-out explicite via frontmatter `tests: none`.
const TESTS_HEADING = /^##\s+(?:\S+\s+)?Tests?\b/im;

function parseFrontmatter(src) {
  const m = src.match(/^---\n([\s\S]*?)\n---/);
  const fm = {};
  if (!m) return fm;
  for (const line of m[1].split("\n")) {
    const mm = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (mm) fm[mm[1]] = mm[2].replace(/^["']|["']$/g, "").trim();
  }
  return fm;
}

let failed = 0;
const report = [];
for (const f of files) {
  if (!existsSync(f)) {
    report.push([f, ["FICHIER ABSENT"]]);
    failed++;
    continue;
  }
  const src = readFileSync(f, "utf8");
  const fm = parseFrontmatter(src);
  const errs = [];

  // 1) Frontmatter minimal (convention A).
  for (const k of [
    "title",
    "topic",
    "audience",
    "updated",
    "source",
    "status",
  ]) {
    if (!fm[k]) errs.push(`frontmatter manquant: ${k}`);
  }

  // Deux régimes : HUB (oriente) vs page de BRIQUE (explique).
  const isHub = path.basename(f) === "index.md";
  // La racine `docs/index.md` n'a pas de parent : elle EST le sommet de l'Ariane.
  const isRoot = f.replace(/^\.\//, "") === "docs/index.md";

  // 2) Sections obligatoires.
  for (const r of isHub ? REQUIRED_HUB : REQUIRED)
    if (!r.re.test(src)) errs.push(`section manquante: ${r.key}`);

  // 3) Intro blockquote (schéma général/mise en contexte).
  if (!/^>\s+/m.test(src)) errs.push("intro (blockquote >) manquante");

  // 4) INVENTAIRE DES TESTS — le défaut historique. Obligatoire sauf opt-out.
  // Un hub renvoie aux compteurs de ses pages, il n'en porte pas lui-même.
  const testsOptOut = /^tests:\s*none/im.test(src) || isHub;
  if (!testsOptOut) {
    if (!TESTS_HEADING.test(src))
      errs.push("section « Tests » manquante (ou `tests: none` si justifié)");
    if (fm.topic && !existsSync(`${COVERAGE}/tests.${fm.topic}.json`))
      errs.push(
        `compteur absent: coverage/tests.${fm.topic}.json (carte tests non rendue)`,
      );
  }

  // 4bis) NAVIGATION (standard §8bis-nav) — on ne se perd jamais : fil d'Ariane en tête,
  // retour au hub en pied. Un hub (`index.md`) porte l'Ariane mais ne se renvoie pas à
  // lui-même : il est la destination.
  if (!isRoot && !/^📍\s+.*›/m.test(src))
    errs.push(
      "fil d'Ariane manquant (ligne `📍 [Documentation](…) › [Module](index.md) › **Page**`)",
    );
  // « Retour au hub » pour une page de module ; « Retour » suffit pour une page
  // transverse, qui n'a pas de hub de module au-dessus d'elle — seulement la racine.
  if (!isHub && !/⬆️\s+\*\*Retour(\s+au\s+hub)?\*\*/m.test(src))
    errs.push(
      "retour manquant (1ʳᵉ ligne de « Pour aller plus loin » : `- ⬆️ **Retour au hub** : …`)",
    );

  // 5) Ancres fichier:ligne présentes (une doc « code = vérité » sans ancre = suspecte).
  // Un hub oriente et ne cite pas le code : lui réclamer des ancres fabriquerait du faux.
  const anchors = src.match(/[\w./@-]+\.ts:\d+/g) || [];
  if (!isHub && !testsOptOut && anchors.length < 3)
    errs.push(
      `trop peu d'ancres fichier:ligne (${anchors.length}) — doc probablement superficielle`,
    );

  // 5bis) LIENS INTERNES VIVANTS — une navigation par hubs ne vaut que si les liens tiennent.
  // Un lien mort dans un hub est pire qu'une absence de lien : il promet une page qui n'existe pas.
  const dir = path.dirname(f);
  const dead = [];
  for (const m of src.matchAll(
    /\]\((?!https?:|#|mailto:)([^)\s]+\.md)(?:#[^)\s]*)?\)/g,
  )) {
    if (!existsSync(path.resolve(dir, m[1]))) dead.push(m[1]);
  }
  if (dead.length)
    errs.push(`lien(s) interne(s) mort(s) : ${[...new Set(dead)].join(", ")}`);

  // 6) Pas de HTML brut (le portail n'a pas rehype-raw).
  if (
    /<(div|span|table|br|img|svg)\b/i.test(src.replace(/```[\s\S]*?```/g, ""))
  )
    errs.push(
      "HTML brut détecté (interdit — le portail Studio n'a pas rehype-raw)",
    );

  if (errs.length) failed++;
  report.push([f, errs]);
}

console.log("\n=== doc-lint — Definition of Done ===\n");
for (const [f, errs] of report) {
  const name = f.split("/").pop();
  if (!errs.length) console.log(`✅ ${name}`);
  else {
    console.log(`❌ ${name}`);
    for (const e of errs) console.log(`     - ${e}`);
  }
}
const ok = report.length - failed;
console.log(
  `\n${ok}/${report.length} pages conformes. ${failed} à corriger.\n`,
);
process.exit(failed ? 1 : 0);
