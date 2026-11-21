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
 * RENDU (`tmp/sites/docs/` en local), jamais sur les sources : le tri du périmètre vit dans
 * `build-docs-site.mjs`, et le recopier ici garantirait qu'un jour les deux ne
 * disent plus la même chose. Ce qui est publié est ce qui est là.
 *
 * PORTÉE RÉELLE. Un `robots.txt` n'est lu par un moteur qu'à la racine du
 * DOMAINE : il agit parce que le site y est servi (`https://nodefony.net/`).
 * Un sous-chemin (`next/`, `<version>/`) n'a pas de `robots.txt` propre : la
 * préversion `next/` se retire de l'index par le `noindex` de ses pages.
 *
 * Usage : node scripts/site/build-site-plan.mjs [--out tmp/sites/docs] [--base <url>]
 *
 * @usage npm run site:plan
 * @usage node scripts/site/build-site-plan.mjs [--out tmp/sites/docs] [--base <url>]
 */
import fs from "node:fs";
import path from "node:path";
import { minimalAppDependencies } from "./lib/app-template-deps.mjs";
import { llmsPlan } from "./lib/llms-plan.mjs";
import { REPO_ROOT } from "../lib/repo-root.mjs";

const DEFAULT_BASE = "https://nodefony.net";

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

/** Échappe ce qui ne peut pas entrer tel quel dans du XML. */
const xmlEscape = (text) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

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

const out = path.resolve(REPO_ROOT, flag("out", "tmp/sites/docs"));
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

// Les faits du plan se lisent ici, au bord : `llms-plan.mjs` reste pur.
const facts = {
  deps: minimalAppDependencies(REPO_ROOT),
  packageCount: fs
    .readdirSync(path.join(REPO_ROOT, "src", "packages", "@nodefony"), {
      withFileTypes: true,
    })
    .filter((e) => e.isDirectory()).length,
  version: JSON.parse(
    fs.readFileSync(
      path.join(REPO_ROOT, "src", "nodefony", "package.json"),
      "utf8",
    ),
  ).version,
};
fs.writeFileSync(path.join(out, "llms.txt"), llmsPlan(pages, base, facts));
fs.writeFileSync(path.join(out, "sitemap.xml"), sitemapXml(pages, base));
fs.writeFileSync(path.join(out, "robots.txt"), robotsTxt(base));

console.log(
  `plan du site écrit — ${pages.length} pages · base ${base}\n` +
    `  ${agreement}\n` +
    `  llms.txt     ${fs.statSync(path.join(out, "llms.txt")).size} octets\n` +
    `  sitemap.xml  ${fs.statSync(path.join(out, "sitemap.xml")).size} octets\n` +
    `  robots.txt   ${fs.statSync(path.join(out, "robots.txt")).size} octets`,
);
