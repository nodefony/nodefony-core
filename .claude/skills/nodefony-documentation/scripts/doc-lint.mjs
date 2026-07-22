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
    // Un hub doit offrir un POINT DE DÉPART, pas forcément une section : il peut
    // porter les parcours lui-même (titre) ou mener à la page qui les porte.
    key: "point de départ (parcours guidés, ou lien vers la page qui les porte)",
    re: /^#{1,2}\s+(?:\S+\s+)?Par o[uù] commencer|demarrer\.md/im,
  },
  // Catalogue : soit des cards déclaratives (bloc de fence `nodefony-cards`),
  // soit la forme markdown historique `### `nom` — titre`.
  { key: "catalogue (cards)", re: /^```nodefony-cards\b|^###\s+\[?`/m },
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
// Un LEXIQUE / GLOSSAIRE ne décrit pas UN concept : il DÉFINIT du vocabulaire (tables
// sigle → développé). Lui réclamer « Qu'est-ce/Vision », « Pièges », des ancres `fichier:ligne`
// et un inventaire de tests fabriquerait du remplissage — exactement ce que le hub évite déjà.
// 3ᵉ régime, ses propres exigences : une section « Lexique » (le cœur) + une sortie
// « Pour aller plus loin ». Frontmatter, intro et navigation (Ariane + retour) restent dus.
const REQUIRED_LEXIQUE = [
  { key: "lexique", re: /^##\s+(?:\S+\s+)?Lexique/im },
  {
    key: "pour aller plus loin",
    re: /^##\s+(?:\S+\s+)?Pour aller plus loin/im,
  },
];
// Section Tests : obligatoire SAUF opt-out explicite via frontmatter `tests: none`.
const TESTS_HEADING = /^##\s+(?:\S+\s+)?Tests?\b/im;

// Neutralise le CODE (fences + code inline) en préservant le nombre de lignes.
// Sans ça, une page qui ENSEIGNE la syntaxe des liens est punie pour ses exemples :
// `[Service](../../src/nodefony/docs/service.md)` cité en modèle était compté comme un
// lien réel, donc mort — un gate qui crie sur l'illustration d'une règle apprend à être
// ignoré. Un exemple n'est pas une navigation : il n'est ni cliquable, ni promis au lecteur.
// Scan ligne à ligne (et non regex globale) pour tenir les fences à 4 backticks, qui
// encadrent les blocs contenant eux-mêmes du ```.
// ⚠️ Les fences DÉCLARATIVES (`nodefony-cards`) sont bien de la navigation : elles restent
// vérifiées en 5ter, qui lit la source brute et non ce texte-ci.
function stripCode(src) {
  const out = [];
  let fence = null;
  for (const line of src.split("\n")) {
    const m = line.match(/^\s*(`{3,})(.*)$/);
    if (fence !== null) {
      out.push("");
      if (m && m[1].length >= fence.length && !m[2].trim()) fence = null;
      continue;
    }
    if (m) {
      fence = m[1];
      out.push("");
      continue;
    }
    out.push(line.replace(/`[^`\n]*`/g, "``"));
  }
  return out.join("\n");
}

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
  const prose = stripCode(src);
  const fm = parseFrontmatter(src);
  const errs = [];

  // Un `README.md` de dossier n'est pas une page du portail : le portail publie `index.md`.
  // C'est une pancarte lue dans l'ARBORESCENCE (dépôt, forge, session IA) qui dit ce que
  // contient le répertoire. Lui réclamer Lexique, Pièges, ancres `fichier:ligne`, carte de
  // tests et fil d'Ariane produirait du remplissage sur quatre lignes de sommaire — et un
  // gate qui échoue toujours pour de mauvaises raisons finit ignoré, y compris le jour où
  // il a raison. 4ᵉ régime, donc : on ne garde que ce qu'un index doit tenir — dire à quoi
  // sert le dossier (intro), et POINTER JUSTE (liens vivants), son unique travail.
  const isIndexReadme = path.basename(f) === "README.md";

  // 1) Frontmatter minimal (convention A). Un index de dossier ne porte pas les champs de
  // publication (`title`/`updated`/`source`) : il n'est ni rendu, ni versionné comme une page.
  for (const k of isIndexReadme
    ? ["module", "topic", "audience", "status"]
    : ["title", "topic", "audience", "updated", "source", "status"]) {
    if (!fm[k]) errs.push(`frontmatter manquant: ${k}`);
  }

  // Deux régimes : HUB (oriente) vs page de BRIQUE (explique). Un hub est
  // généralement un `index.md`, mais une page d'orientation peut porter un autre
  // nom (`demarrer.md`) — elle le déclare alors par `hub: true`.
  const isHub =
    path.basename(f) === "index.md" || /^hub:\s*true\s*$/im.test(src);
  // Un glossaire se reconnaît à son nom canonique (`lexique.md`/`glossaire.md`, aux deux
  // niveaux — global et par-module) ou au drapeau `lexique: true` en secours.
  const isLexique =
    /^(lexique|glossaire)\.md$/i.test(path.basename(f)) ||
    /^lexique:\s*true\s*$/im.test(src);
  // La racine `docs/index.md` n'a pas de parent : elle EST le sommet de l'Ariane.
  const isRoot = f.replace(/^\.\//, "") === "docs/index.md";

  // 2) Sections obligatoires (un régime par nature de page).
  const required = isIndexReadme
    ? []
    : isHub
      ? REQUIRED_HUB
      : isLexique
        ? REQUIRED_LEXIQUE
        : REQUIRED;
  for (const r of required)
    if (!r.re.test(src)) errs.push(`section manquante: ${r.key}`);

  // 3) Intro blockquote (schéma général/mise en contexte).
  if (!/^>\s+/m.test(src)) errs.push("intro (blockquote >) manquante");

  // 4) INVENTAIRE DES TESTS — le défaut historique. Obligatoire sauf opt-out.
  // Un hub renvoie aux compteurs de ses pages, il n'en porte pas lui-même. Un lexique
  // définit du vocabulaire, il ne teste aucun code : dispensé de tests ET d'ancres.
  const testsOptOut =
    /^tests:\s*none/im.test(src) || isHub || isLexique || isIndexReadme;
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
  // Un index de dossier n'est atteint par aucun parcours de lecture : on tombe dessus en
  // ouvrant le répertoire. Il n'a donc ni amont à rappeler, ni retour à proposer.
  if (!isRoot && !isIndexReadme && !/^📍\s+.*›/m.test(src))
    errs.push(
      "fil d'Ariane manquant (ligne `📍 [Documentation](…) › [Module](index.md) › **Page**`)",
    );
  // « Retour au hub » pour une page de module ; « Retour » suffit pour une page
  // transverse, qui n'a pas de hub de module au-dessus d'elle — seulement la racine.
  if (
    !isHub &&
    !isIndexReadme &&
    !/⬆️\s+\*\*Retour(\s+au\s+hub)?\*\*/m.test(src)
  )
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
  for (const m of prose.matchAll(
    /\]\((?!https?:|#|mailto:)([^)\s]+\.md)(?:#[^)\s]*)?\)/g,
  )) {
    if (!existsSync(path.resolve(dir, m[1]))) dead.push(m[1]);
  }
  if (dead.length)
    errs.push(`lien(s) interne(s) mort(s) : ${[...new Set(dead)].join(", ")}`);

  // 5ter) LIENS DES FENCES DÉCLARATIVES — un catalogue de hub rendu en cards porte ses
  // cibles dans du JSON (`"href": "./x.md"`), pas dans la syntaxe `](…)`. Sans ce contrôle,
  // convertir un catalogue en cards SORT tous ses liens du champ de vision du gate : la
  // navigation d'un hub cesse d'être vérifiée au moment précis où elle devient sa raison
  // d'être. On valide donc aussi le JSON lui-même — une fence illisible ne rend rien.
  for (const fence of src.matchAll(/```nodefony-cards\s*\n([\s\S]*?)\n```/g)) {
    let items;
    try {
      items = JSON.parse(fence[1]);
    } catch (e) {
      errs.push(
        `fence nodefony-cards illisible (JSON invalide) : ${e.message}`,
      );
      continue;
    }
    if (!Array.isArray(items)) {
      errs.push("fence nodefony-cards : un tableau d'objets est attendu");
      continue;
    }
    const deadCards = [];
    for (const it of items) {
      if (!it || typeof it !== "object") continue;
      if (typeof it.title !== "string" || !it.title.trim())
        errs.push("card sans `title` (une card sans titre n'a pas de sens)");
      const href = it.href;
      if (typeof href !== "string" || /^(https?:|#|mailto:)/.test(href))
        continue;
      const target = href.replace(/#.*$/, "");
      if (target.endsWith(".md") && !existsSync(path.resolve(dir, target)))
        deadCards.push(target);
    }
    if (deadCards.length)
      errs.push(
        `card(s) pointant une page inexistante : ${[...new Set(deadCards)].join(", ")}`,
      );
  }

  // 6) Pas de HTML brut (le portail n'a pas rehype-raw). Une balise CITÉE (fence ou
  // backticks) s'affiche comme du texte : elle ne demande rien au moteur de rendu.
  if (/<(div|span|table|br|img|svg)\b/i.test(prose))
    errs.push(
      "HTML brut détecté (interdit — le portail Studio n'a pas rehype-raw)",
    );

  if (errs.length) failed++;
  report.push([f, errs]);
}

console.log("\n=== doc-lint — Definition of Done ===\n");
// Le nom court se lit mieux… tant qu'il désigne UNE page. Or `README.md` et `index.md` se
// répètent d'un dossier à l'autre : un rapport de sept lignes « ❌ README.md » ne dit pas
// lequel réparer. Les noms ambigus DANS CE LOT passent donc en chemin relatif au dépôt.
const seen = new Map();
for (const [f] of report) {
  const n = f.split("/").pop();
  seen.set(n, (seen.get(n) || 0) + 1);
}
for (const [f, errs] of report) {
  const short = f.split("/").pop();
  const name =
    seen.get(short) > 1 ? path.relative(REPO, path.resolve(f)) : short;
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
