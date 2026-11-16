#!/usr/bin/env node
/**
 * Construit le site « Performance » publié — une page par version, plus `latest`.
 *
 * POURQUOI CE SCRIPT EXISTE, ET CE QU'IL NE FAIT PAS.
 * Il ne MESURE rien. Mesurer sur un exécuteur d'intégration continue partagé rendrait
 * des chiffres faux — la leçon est déjà payée : aucun absolu pris derrière un chemin
 * virtualisé n'est transposable. La mesure est un geste manuel, sur une machine nommée,
 * dont le résultat est COMMITÉ dans `docs/performance/data/<version>.json`. Ce script ne
 * fait que RENDRE ces données ; il est donc déterministe, rejouable en local, et son
 * résultat ne dépend pas de la machine qui l'exécute.
 *
 * Chaque version versionnée devient `<sortie>/<version>/index.html`, la plus récente est
 * dupliquée en `<sortie>/latest/index.html`, et un sommaire liste le tout. Un chiffre
 * reste ainsi attaché à SA version, définitivement — c'est ce qui permet de comparer deux
 * releases sans croire quiconque sur parole.
 *
 * Usage :
 *   node scripts/site/build-perf-site.mjs [--out tmp/sites/perf] [--data docs/performance/data]
 *
 * Sortie 1 si AUCUNE version n'a pu être rendue (un site vide se publierait en silence).
 *
 * @usage node scripts/site/build-perf-site.mjs [--out tmp/sites/perf] [--data docs/performance/data]
 */
import {
  readdirSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  cpSync,
  existsSync,
} from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { NODEFONY_BRAND } from "../../.claude/skills/nodefony-html-report/lib/brand.mjs";
import { STYLE_GRAPHES } from "../../.claude/skills/nodefony-html-report/lib/echarts.mjs";
import {
  doc,
  section,
  cards,
  table,
  warn,
  esc,
} from "../../.claude/skills/nodefony-html-report/lib/report.mjs";
import {
  renderFigures,
  insertFigures,
} from "../../.claude/skills/nodefony-load-test/scripts/perf-figures.mjs";
import MarkdownIt from "markdown-it";
import { highlight, STYLE_CODE } from "./markdown-highlight.mjs";
import { anchorHeadings } from "./lib/html-text.mjs";
import { REPO_ROOT as ROOT } from "../lib/repo-root.mjs";
import { siteNav } from "./lib/site-nav.mjs";

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const OUT = path.resolve(ROOT, arg("out", "tmp/sites/perf"));
const DATA_DIR = path.resolve(ROOT, arg("data", "docs/performance/data"));
const GENERATOR = path.join(
  ROOT,
  ".claude/skills/nodefony-load-test/scripts/prod-readiness-report.mjs",
);
// L'ancien « dossier du chantier » (une troisième page, au récit figé à sa date)
// est FONDU dans les deux pages de prose : « Où part le temps » porte les
// analyses, « Méthode de mesure » le protocole et les instruments qui ont menti.
// Trois pages qui racontaient le même chantier à trois dates différentes se
// contredisaient dès la campagne suivante.

/** Ordre de version décroissant (numérique par segment, pré-release après la finale). */
const compareVersions = (a, b) => {
  const parse = (v) =>
    v.split(/[.-]/).map((p) => (/^\d+$/.test(p) ? Number(p) : p));
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x === y) continue;
    if (typeof x === typeof y) return x > y ? -1 : 1;
    return typeof x === "number" ? -1 : 1;
  }
  return 0;
};

const versions = existsSync(DATA_DIR)
  ? readdirSync(DATA_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""))
      .sort(compareVersions)
  : [];

if (versions.length === 0) {
  console.error(`aucun jeu de mesures dans ${DATA_DIR}`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
const rendered = [];
const skipped = [];

for (const version of versions) {
  const dataFile = path.join(DATA_DIR, `${version}.json`);
  const dir = path.join(OUT, version);
  mkdirSync(dir, { recursive: true });
  try {
    execFileSync(
      process.execPath,
      [
        GENERATOR,
        "--data",
        dataFile,
        "--out",
        path.join(dir, "index.html"),
        // Rendue DANS le site : la page pose le menu des sites voisins.
        "--site-path",
        `/performance/${version}/`,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const meta = JSON.parse(readFileSync(dataFile, "utf8"));
    rendered.push({
      version,
      measuredAt: meta.provenance?.measuredAt ?? "?",
      data: meta,
    });
    console.log(`✓ ${version}`);
  } catch (err) {
    // Un jeu incomplet ne fait PAS tomber le site : il est nommé, et son absence
    // est visible sur le sommaire. Ce qui serait grave, c'est de le taire.
    const why =
      String(err.stderr ?? err.message)
        .split("\n")
        .find((l) => l.startsWith("Error:")) ?? "rendu impossible";
    skipped.push({ version, why: why.replace(/^Error:\s*/, "") });
    console.warn(`⚠ ${version} — ${why}`);
  }
}

if (rendered.length === 0) {
  console.error("aucune version rendue — rien à publier");
  process.exit(1);
}

const latest = rendered[0];
// Les figures de la prose sont calculées depuis le jeu de la version COURANTE :
// une page « Où part le temps » illustre les mesures qu'elle commente, jamais
// celles d'une campagne antérieure recopiées à la main.
const figures = renderFigures(latest.data);
// `latest` recopie TOUT le dossier de la version, pas seulement sa page d'accueil.
// Depuis que le rapport se découpe en plusieurs pages, ne copier `index.html`
// laissait une page dont chaque lien de navigation tombait en 404 — et un lien
// mort sur la page la plus lue du dossier ne se voit pas depuis le générateur.
cpSync(path.join(OUT, latest.version), path.join(OUT, "latest"), {
  recursive: true,
});

/* ── La PROSE du dossier ──────────────────────────────────────────────────
 *
 * 🔴 DEUX PAGES ÉCRITES, MAINTENUES, ET PUBLIÉES NULLE PART.
 *
 * Le site de documentation exclut `docs/performance/` au motif qu'il est
 * « publié par son propre site ». C'est vrai des MESURES — ce script les rend
 * depuis les jeux versionnés — et faux de la méthode et des analyses, qu'aucun
 * générateur ne lisait. Le lien « protocole » du sommaire devait donc sortir
 * vers GitHub : on demandait au lecteur de quitter le site pour savoir comment
 * les chiffres qu'on lui montre ont été obtenus.
 *
 * Elles sont rendues ICI, sous `/performance/`, parce que c'est là qu'un lecteur
 * les cherche — et non dans la documentation, dont les groupes racine sont
 * définis par le PRODUIT et pilotent aussi le menu de la console d'administration.
 */
const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  highlight,
});

/** Retire le frontmatter YAML et rend le corps. */
function rendreMarkdown(fichier) {
  const brut = readFileSync(fichier, "utf8").replace(
    /^---\n[\s\S]*?\n---\n/,
    "",
  );
  const BLOB = "https://github.com/nodefony/nodefony-core/blob/main/";
  // Les liens RELATIFS d'un fichier de `docs/performance/` visent des cibles qui,
  // ici, n'ont plus la même place. Ce qui a une page sur ce site y pointe ; le
  // reste part vers le dépôt, où il existe vraiment. Une cible inventée passerait
  // le gate de liens tant qu'elle est absolue — d'où la liste EXPLICITE.
  const CIBLES = {
    "index.md": "../",
    "methode.md": "../protocole/",
    "analyses.md": "../analyses/",
    "README.md": "../",
  };
  // Titres ancrés par la règle commune : `analyses.md` vise des sections de
  // `methode.md`, mortes tant que ses titres n’avaient pas d’`id`.
  return insertFigures(
    anchorHeadings(md.render(brut)),
    figures,
    path.basename(fichier),
  )
    .replace(/href="(?!https?:|#|mailto:)([^"]+)"/g, (_, href) => {
      const [chemin, ancre] = href.split("#");
      const connu = CIBLES[chemin];
      if (connu) return `href="${connu}${ancre ? `#${ancre}` : ""}"`;
      return `href="${BLOB}docs/performance/${chemin}${ancre ? `#${ancre}` : ""}"`;
    })
    .replace(
      /src="(?!https?:|data:)([^"]+)"/g,
      (_, p) =>
        `src="https://raw.githubusercontent.com/nodefony/nodefony-core/main/docs/performance/${p}"`,
    );
}

const PROSE = [
  {
    slug: "protocole",
    source: "methode.md",
    titre: "Méthode de mesure",
    sous: "Comment un chiffre devient une mesure — et les instruments qui ont menti avant qu'on s'en aperçoive.",
  },
  {
    slug: "analyses",
    source: "analyses.md",
    titre: "Où part le temps",
    sous: "Le budget d'une requête, décomposé : le pipeline, les autres frameworks, les bases de données.",
  },
];

const prose = [];
for (const page of PROSE) {
  const src = path.join(ROOT, "docs", "performance", page.source);
  if (!existsSync(src)) {
    console.warn(`⚠ prose absente, page non rendue : ${page.source}`);
    continue;
  }
  const dir = path.join(OUT, page.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "index.html"),
    doc({
      nav: siteNav(`/performance/${page.slug}/`),
      style: STYLE_CODE + STYLE_GRAPHES,
      title: page.titre,
      subtitle: page.sous,
      sections: [rendreMarkdown(src)],
      footer: `<a href="../">← Performance</a> · <a href="../../docs/">Documentation</a> — source <code>docs/performance/${page.source}</code>`,
    }),
  );
  prose.push(page);
  console.log(`✓ ${page.slug}`);
}

const rows = rendered.map((r) => [
  `<a href="./${esc(r.version)}/">Nodefony ${esc(r.version)}</a>${
    r.version === latest.version
      ? ' <span class="badge-latest">version courante</span>'
      : ""
  }`,
  esc(r.measuredAt),
]);

/**
 * Ce qu'un lecteur vient chercher ici, dans l'ordre : combien ça encaisse, face
 * à quoi, est-ce que ça tient, et sur quelle machine. Les chiffres viennent des
 * données de la version courante ; si elles manquent, la section disparaît
 * plutôt que d'afficher des trous.
 */
function chiffresCles(d) {
  const nf = d?.comparison?.frameworks?.nodefony;
  if (!nf) return [];
  const soak = d.soak;
  const w = d.provenance?.witnesses ?? {};
  const nb = (v, n = 0) =>
    v == null
      ? "—"
      : v.toLocaleString("fr-FR", {
          minimumFractionDigits: n,
          maximumFractionDigits: n,
        });
  const out = [];

  out.push(
    section(
      "Ce que Nodefony encaisse",
      `<p class="lead">Une route qui ne fait aucun travail applicatif, servie par le pipeline
complet — sécurité, routage, contexte asynchrone, en-têtes : le cas où le framework pèse le plus
lourd, puisqu'il est 100 % du budget. Un seul processus, médiane de tirs de
${nf.durSec ?? 10} s à ${nf.conn ?? 64} connexions.</p>` +
        cards(
          [
            {
              k: "Débit",
              v: nb(nf.med),
              unit: "req/s",
              sub: `dispersion ${nb(nf.dispersionPct, 1)} %`,
            },
            {
              k: "Latence médiane",
              v: nb(nf.medP50Ms, 2),
              unit: "ms",
              sub: "la moitié des requêtes sous ce seuil",
            },
            {
              k: "Latence p99",
              v: nb(nf.medP99Ms, 2),
              unit: "ms",
              sub: "99 requêtes sur 100 sous ce seuil",
            },
            soak && {
              k: "Tenue dans le temps",
              v:
                soak.verdict === "clean"
                  ? "aucune fuite"
                  : soak.verdict === "non-conclusif"
                    ? "non conclusif"
                    : soak.verdict,
              sub: `${Math.round(soak.observedMinutes ?? soak.minutes)} min sous charge — tas à ${nb(soak.heapSlopeMbPerHour, 1)} Mo/h, ${nb(soak.footprintMbPerMillionReq ?? soak.rssMbPerMillionReq, 2)} Mo d'empreinte par million de requêtes`,
            },
          ].filter(Boolean),
        ),
    ),
  );

  // La figure des parts : barres depuis zéro (on compare des LONGUEURS) et
  // aucune couleur de podium — chaque barre dit « tant % de ce témoin ».
  if (figures.has("parts"))
    out.push(
      section(
        "Face à quoi",
        figures.get("parts") +
          `<p>Chaque témoin rend le <strong>même résultat observable</strong> que Nodefony —
statut, en-têtes de sécurité, identifiant de requête, corrélation <code>traceparent</code>, CORS,
contrôle anti-CSRF, zones du pare-feu —, et un contrôle de parité le vérifie avant chaque campagne.
Témoins mesurés : Express ${esc(w.express ?? "?")}, NestJS ${esc(w["@nestjs/core"] ?? "?")} sur
Fastify ${esc(w.fastify ?? "?")} et sur <code>node:http</code>, Drizzle ${esc(w["drizzle-orm"] ?? "?")}
avec better-sqlite3 ${esc(w["better-sqlite3"] ?? "?")} des deux côtés.</p>
<p>La parité prouve le résultat, pas le travail invisible : Nodefony tient en plus, sur chaque
requête, une portée d'injection, un contexte unifié HTTP/WebSocket et ses points d'extension. Ce
travail a un coût, mesuré et décomposé dans <a href="./analyses/">Où part le temps</a>.</p>`,
      ),
    );

  const m = d.provenance?.machine;
  if (m)
    out.push(
      section(
        "Sur quoi ces chiffres ont été pris",
        warn(
          `<strong>Des mesures de développement, pas une promesse de production.</strong>
${esc(m.cpu)}, ${m.logicalCores} cœurs logiques, ${m.memoryGb} Go, ${esc(m.os)} — un portable de
2018, générateur de charge sur la même machine, Node ${esc(d.provenance?.node ?? "?")}. Les valeurs
ABSOLUES sont basses pour tous les camps ; seuls les <strong>rapports entre camps</strong>, pris en
alternance dans la même fenêtre, sont exploitables.`,
        ),
      ),
    );
  return out;
}

const sections = [
  section(
    "Où aller",
    cards([
      {
        k: "Les mesures",
        v: `<a href="./latest/"><strong>Toutes les mesures</strong></a>`,
        sub: "comparatif, base de données, tenue dans la durée, dimensionnement d'un pod",
      },
      ...(prose.some((x) => x.slug === "analyses")
        ? [
            {
              k: "Le budget d'une requête",
              v: `<a href="./analyses/"><strong>Où part le temps</strong></a>`,
              sub: "étage par étage, ce que Node fait faire, le binaire, et ce qui reste ouvert",
            },
          ]
        : []),
      ...(prose.some((x) => x.slug === "protocole")
        ? [
            {
              k: "La méthode",
              v: `<a href="./protocole/"><strong>Comment on mesure</strong></a>`,
              sub: "paires alternées, gardes de décor, et les instruments qui ont menti",
            },
          ]
        : []),
    ]),
  ),
  ...chiffresCles(latest?.data),
  section(
    "Une page par version publiée",
    `<p class="lead">Un chiffre reste attaché à SA version : deux releases se comparent sans croire
quiconque sur parole.</p>` +
      table([{ label: "Version" }, { label: "Mesuré le" }], rows, {
        sortable: true,
        id: "versions",
      }),
  ),
];

if (skipped.length)
  sections.push(
    section(
      "Non publiées",
      `<p>Un jeu de mesures incomplet ne fait pas tomber le site — il est nommé ici. Ce qui serait
grave, ce serait de le taire.</p><ul>${skipped
        .map(
          (x) => `<li><strong>${esc(x.version)}</strong> — ${esc(x.why)}</li>`,
        )
        .join("")}</ul>`,
    ),
  );

writeFileSync(
  path.join(OUT, "index.html"),
  doc({
    nav: siteNav("/performance/"),
    title: "Performance de Nodefony",
    subtitle:
      "Les chiffres sont mesurés à la main, sur une machine nommée, puis versionnés dans le dépôt — cette page ne fait que les rendre.",
    // La marque ramène à l'accueil du site, comme partout ailleurs : cette page
    // est publiée à côté de la documentation, pas toute seule.
    brand: { ...NODEFONY_BRAND, href: "../" },
    head: `<link rel="icon" href="../favicon.svg" type="image/svg+xml">`,

    sections,
    style:
      STYLE_GRAPHES +
      `
/* Deux largeurs, pas une. La PAGE porte des cartes, des tableaux et des figures
   qui gagnent à respirer ; le TEXTE COURANT, lui, se lit sur une mesure bornée —
   une ligne de 170 caractères ne se suit pas. Constaté au navigateur sur la page
   d'accueil, qui portait le même max-width:none — 1372 px de titre sur 1440. */
.wrap { max-width:1240px; margin-inline:auto; padding:30px 34px 88px; }
.wrap p, .wrap li, .wrap blockquote { max-width:74ch; }
.wrap td p, .wrap th p, .wrap td li, .wrap th li,
.wrap figure p, .wrap figcaption, .wrap .card p, .wrap .card li { max-width:none; }
.wrap h1, .wrap h2, .wrap h3 { text-wrap:pretty; max-width:34ch; }
@media (min-width:1500px) { .wrap { max-width:1320px; } }
@media (max-width:820px) { .wrap { padding:20px 18px 60px; } }
.badge-latest { font-size:11.5px; padding:2px 9px; border-radius:20px; margin-left:8px;
  border:1px solid var(--accent); color:var(--accent); }`,
    footer:
      `<a href="../docs/">← Documentation Nodefony</a> — les données brutes sont versionnées dans ` +
      `<a href="https://github.com/nodefony/nodefony-core/tree/main/docs/performance"><code>docs/performance/</code></a>, ` +
      `cette page les rend.`,
  }),
);

console.log(
  `\nsite : ${rendered.length} version(s) rendue(s)${skipped.length ? `, ${skipped.length} sautée(s)` : ""} → ${OUT}`,
);
