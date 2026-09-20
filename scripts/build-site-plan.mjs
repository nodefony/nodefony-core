#!/usr/bin/env node
/**
 * Publie le PLAN du site : `llms.txt`, `sitemap.xml` et `robots.txt`.
 *
 * POURQUOI. Un développeur interroge aujourd'hui un agent avant d'ouvrir un
 * README. Sans plan, l'agent descend dans le premier code qu'il trouve — donc
 * dans le monorepo de développement — et juge le produit sur l'outillage de son
 * mainteneur. Ce fichier existe pour lui dire où s'arrêter, et pour lui donner le
 * SEUL chiffre qui tranche : ce qu'une application installe vraiment.
 *
 * CE QU'IL NE FAIT PAS : décider ce qui est public. Le plan se lit sur l'artefact
 * RENDU (`dist-site/`), jamais sur les sources : le tri du périmètre vit dans
 * `build-docs-site.mjs`, et le recopier ici garantirait qu'un jour les deux ne
 * disent plus la même chose. Ce qui est publié est ce qui est là.
 *
 * ⚠️ PORTÉE RÉELLE SOUS GITHUB PAGES. Le site est servi sous un SOUS-CHEMIN
 * (`/nodefony-core/`). Un `robots.txt` n'est lu par un moteur qu'à la racine du
 * DOMAINE : celui qu'on écrit ici n'a donc aucun effet sur l'indexation tant
 * qu'un nom de domaine propre n'est pas posé. On l'écrit quand même — il coûte
 * trois lignes, il devient effectif le jour du domaine, et il déclare le plan du
 * site à qui le lit. Mais il ne faut pas croire avoir gagné une indexation :
 * seul `llms.txt`, que l'on va chercher explicitement sous l'URL du site, agit
 * dès maintenant.
 *
 * Usage : node scripts/build-site-plan.mjs [--out dist-site] [--base <url>]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  minimalAppDependencies,
  APP_TEMPLATE_HREF,
} from "./lib/app-template-deps.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const DEFAULT_BASE = "https://nodefony.github.io/nodefony-core";

/**
 * Les pages d'ENTRÉE, dans l'ordre où on veut qu'elles soient lues.
 *
 * C'est la seule liste écrite à la main de ce fichier, et elle est VÉRIFIÉE :
 * une entrée qui ne correspond à aucune page rendue fait échouer le script. Sans
 * ce contrôle, renommer une page de départ la ferait disparaître du plan en
 * silence — l'agent tomberait alors dans le catalogue, c'est-à-dire nulle part.
 */
const ENTRY_POINTS = ["", "docs/", "docs/demarrer/"];

/** Les groupes du plan, dans l'ordre de lecture. La clé est le premier segment. */
const GROUPS = [
  { segment: "docs", heading: "Documentation" },
  { segment: "performance", heading: "Optional" },
  { segment: "qualite", heading: "Optional" },
];

/**
 * Les pages rendues sous un dossier, avec ce que leur `<head>` déclare.
 *
 * Le titre se lit dans le `<head>` SEUL : les figures de ce site sont des SVG
 * en ligne, et un `<title>` y nomme un nœud d'organigramme — une recherche sur
 * tout le document ramènerait « oui », « non » ou « organigramme ».
 *
 * @param root - dossier de l'artefact rendu.
 * @returns une entrée par page, chemin d'URL en `/`, triée.
 */
function renderedPages(root) {
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.name === "index.html") found.push(abs);
    }
  };
  walk(root);
  return found
    .map((abs) => {
      const html = fs.readFileSync(abs, "utf8");
      const head = /<head>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? "";
      // Chemin d'URL : le dossier de la page, séparateurs d'URL, barre finale.
      const rel = path
        .relative(root, path.dirname(abs))
        .split(path.sep)
        .join("/");
      return {
        urlPath: rel === "" ? "" : `${rel}/`,
        segment: rel.split("/")[0] ?? "",
        depth: rel === "" ? 0 : rel.split("/").length,
        title: decodeEntities(
          /<title>([\s\S]*?)<\/title>/i.exec(head)?.[1]?.trim() ?? rel,
        ),
        description: decodeEntities(
          /<meta\s+name="description"\s+content="([^"]*)"/i
            .exec(head)?.[1]
            ?.trim() ?? "",
        ),
        canonical:
          /<link\s+rel="canonical"\s+href="([^"]*)"/i.exec(head)?.[1] ?? "",
        // Le markdown voisin, quand le générateur l'a publié : c'est LUI que le
        // plan donne à lire, pas la page HTML. Un agent qui reçoit du markdown ne
        // dépense rien à en extraire le texte, et ne confond pas le contenu avec
        // le chrome de la page.
        markdown: fs.existsSync(path.join(path.dirname(abs), "index.md")),
      };
    })
    .sort((a, b) => a.urlPath.localeCompare(b.urlPath, "en"));
}

/**
 * Décode les entités que le rendu a posées dans un attribut ou un titre.
 *
 * @param text - texte issu du HTML.
 * @returns le même texte, lisible.
 */
const decodeEntities = (text) =>
  text
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

/**
 * Raccourcit une description sur une frontière de mot.
 *
 * @param text - description complète.
 * @param max - longueur maximale rendue.
 * @returns la description, éventuellement suivie d'une ellipse.
 */
function shorten(text, max = 150) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:.]$/, "")}…`;
}

/** Échappe ce qui ne peut pas entrer tel quel dans du XML. */
const xmlEscape = (text) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Replie un paragraphe à 80 colonnes, sur des frontières de mot.
 *
 * @param text - le paragraphe, en une seule ligne.
 * @param width - largeur maximale d'une ligne.
 * @returns les lignes repliées.
 */
function wrap(text, width = 80) {
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && `${line} ${word}`.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Le plan de lecture au format llms.txt (https://llmstxt.org).
 *
 * L'en-tête porte les deux faits qu'un agent ne peut pas déduire du site : ce
 * qu'une application installe, et ce que le dépôt de développement n'est pas.
 * Aucun NUMÉRO de préversion n'y figure : il se périmerait à chaque publication,
 * et rien ici ne le contrôlerait — le canal, lui, reste vrai toute la série.
 *
 * @param pages - les pages rendues.
 * @param base - racine d'URL du site publié.
 * @returns le contenu du fichier.
 */
function llmsPlan(pages, base) {
  const deps = minimalAppDependencies(REPO_ROOT);
  const packageCount = fs
    .readdirSync(path.join(REPO_ROOT, "src", "packages", "@nodefony"), {
      withFileTypes: true,
    })
    .filter((e) => e.isDirectory()).length;

  const lines = [
    "# Nodefony",
    "",
    "> Framework Node.js fullstack en TypeScript strict, ESM uniquement, où HTTP et",
    "> WebSocket partagent la même route, la même session et le même pare-feu : un",
    "> même contrôleur répond aux deux, sans pont ni second serveur.",
    "",
    ...wrap(
      "Ce site est la documentation du framework, écrite pour qui construit une " +
        "application avec lui.",
    ),
    "",
    ...wrap(
      "**Ce qu'une application installe.** Une application créée par " +
        "`npm create nodefony@alpha`, en version minimale, porte " +
        `${numberWord(deps.length)} dépendances de production : ` +
        `${deps.map((d) => `\`${d}\``).join(", ")}. Le dépôt de développement du ` +
        `framework, lui, est un monorepo de ${packageCount} paquets qui porte en plus ses ` +
        "bancs de mesure, ses gabarits et son outillage d'agent : rien de cela n'entre " +
        "dans une application, et le lire ne dit rien du coût d'adoption. Se constate : " +
        `\`${APP_TEMPLATE_HREF}\`.`,
    ),
    "",
    ...wrap(
      "**État.** La ligne 10 est en préversion, publiée sur le canal `alpha` de npm — " +
        "`npm install nodefony` sert encore la génération précédente, écrite en " +
        "JavaScript. Projet libre sous licence Apache 2.0, développé bénévolement par " +
        "une seule personne.",
    ),
    "",
    ...wrap(
      "**Les sources sont en Markdown** et se lisent brutes, sans HTML : " +
        "`https://raw.githubusercontent.com/nodefony/nodefony-core/dev/<chemin>`.",
    ),
    "",
  ];

  // Les points d'entrée d'abord, et chacun doit exister.
  const entries = ENTRY_POINTS.map((urlPath) => {
    const page = pages.find((p) => p.urlPath === urlPath);
    if (!page)
      throw new Error(
        `page d'entrée absente du site rendu : « ${urlPath || "/"} » — ` +
          `corriger ENTRY_POINTS ou la page`,
      );
    return page;
  });
  lines.push("## Commencer", "");
  for (const page of entries) lines.push(entryLine(page, base));
  lines.push("");

  for (const group of dedupeHeadings(GROUPS)) {
    const segments = new Set(
      GROUPS.filter((g) => g.heading === group.heading).map((g) => g.segment),
    );
    const members = pages.filter(
      (p) => segments.has(p.segment) && !entries.includes(p),
    );
    if (!members.length) continue;
    lines.push(`## ${group.heading}`, "");
    for (const page of members) lines.push(entryLine(page, base));
    lines.push("");
  }
  return `${lines.join("\n")}`;
}

/**
 * Une ligne de lien du plan.
 *
 * @param page - la page rendue.
 * @param base - racine d'URL du site.
 * @returns la ligne markdown, description comprise quand la page en déclare une.
 */
function entryLine(page, base) {
  const html = page.canonical || `${base}/${page.urlPath}`;
  const url = page.markdown ? `${html}index.md` : html;
  const description = shorten(page.description);
  return `- [${page.title}](${url})${description ? `: ${description}` : ""}`;
}

/** Les groupes, un par titre, dans l'ordre de première apparition. */
const dedupeHeadings = (groups) =>
  groups.filter(
    (g, i) => groups.findIndex((o) => o.heading === g.heading) === i,
  );

/**
 * Écrit un nombre en toutes lettres quand il est petit.
 *
 * La phrase est lue par un humain autant que par un agent : « quatre
 * dépendances » se retient, « 4 dépendances » se survole.
 *
 * @param n - le nombre.
 * @returns le mot, ou le chiffre au-delà de dix.
 */
function numberWord(n) {
  const words = [
    "zéro",
    "une",
    "deux",
    "trois",
    "quatre",
    "cinq",
    "six",
    "sept",
    "huit",
    "neuf",
    "dix",
  ];
  return words[n] ?? String(n);
}

/**
 * Le plan pour les moteurs, au format sitemap 0.9.
 *
 * Sans `<lastmod>`, et c'est un choix : le seul horodatage disponible au rendu
 * est celui du build, identique pour toutes les pages — il annoncerait cent
 * modifications à chaque publication, ce qui est faux et se paie en crédit.
 *
 * @param pages - les pages rendues.
 * @param base - racine d'URL du site publié.
 * @returns le contenu du fichier.
 */
const sitemapXml = (pages, base) =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...pages.map(
      (p) =>
        `  <url><loc>${xmlEscape(p.canonical || `${base}/${p.urlPath}`)}</loc></url>`,
    ),
    "</urlset>",
    "",
  ].join("\n");

/**
 * Les règles d'exploration.
 *
 * @param base - racine d'URL du site publié.
 * @returns le contenu du fichier.
 */
const robotsTxt = (base) =>
  [
    "# Ce site est public et fait pour être lu — par des humains comme par des agents.",
    "# Rien n'y est privé : tout est déjà dans un dépôt public.",
    "User-agent: *",
    "Allow: /",
    "",
    `Sitemap: ${base}/sitemap.xml`,
    "",
  ].join("\n");

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const out = path.resolve(REPO_ROOT, flag("out", "dist-site"));
if (!fs.existsSync(path.join(out, "index.html"))) {
  console.error(
    `aucun site rendu sous ${out} — bâtir d'abord (readme-html.mjs + build-docs-site.mjs)`,
  );
  process.exit(2);
}

const pages = renderedPages(out);

/**
 * Le plan et l'index de recherche doivent décrire le MÊME corpus.
 *
 * Ce sont deux sorties du même générateur, produites par deux chemins différents :
 * l'index vient du scan des sources, le plan du balayage de l'artefact. Une page
 * écartée d'un côté et pas de l'autre est un défaut de périmètre qui ne se voit
 * nulle part — la page reste trouvable par la recherche et absente du plan, ou
 * l'inverse. On le constate ici, là où les deux existent côte à côte.
 */
function checkSearchIndexAgreement(rendered, root) {
  const indexPath = path.join(root, "docs", "search-index.json");
  if (!fs.existsSync(indexPath))
    return "index de recherche absent — non comparé";
  const indexed = new Set(
    JSON.parse(fs.readFileSync(indexPath, "utf8")).docs.map((d) => d.path),
  );
  const planned = new Set(
    rendered
      .filter((p) => p.segment === "docs")
      .map((p) => p.urlPath.replace(/^docs\//, "")),
  );
  const missing = [...planned].filter((p) => !indexed.has(p));
  const extra = [...indexed].filter((p) => !planned.has(p));
  if (missing.length || extra.length)
    throw new Error(
      `le plan et l'index de recherche divergent — ` +
        `dans le plan seul : ${missing.join(", ") || "aucune"} · ` +
        `dans l'index seul : ${extra.join(", ") || "aucune"}`,
    );
  return `${indexed.size} pages de documentation, plan et recherche d'accord`;
}

const agreement = checkSearchIndexAgreement(pages, out);
// La base se CONSTATE sur la page d'accueil quand elle porte un canonical : une
// base passée à la main et une page rendue sous une autre origine produiraient un
// plan qui pointe à côté du site qu'il décrit.
const rootCanonical = pages.find((p) => p.urlPath === "")?.canonical ?? "";
const base = (
  flag("base", rootCanonical || DEFAULT_BASE) ?? DEFAULT_BASE
).replace(/\/+$/, "");

fs.writeFileSync(path.join(out, "llms.txt"), llmsPlan(pages, base));
fs.writeFileSync(path.join(out, "sitemap.xml"), sitemapXml(pages, base));
fs.writeFileSync(path.join(out, "robots.txt"), robotsTxt(base));

console.log(
  `plan du site écrit — ${pages.length} pages · base ${base}\n` +
    `  ${agreement}\n` +
    `  llms.txt     ${fs.statSync(path.join(out, "llms.txt")).size} octets\n` +
    `  sitemap.xml  ${fs.statSync(path.join(out, "sitemap.xml")).size} octets\n` +
    `  robots.txt   ${fs.statSync(path.join(out, "robots.txt")).size} octets`,
);
