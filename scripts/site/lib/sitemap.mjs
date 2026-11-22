/**
 * Le plan pour les moteurs au format sitemap 0.9 — fonctions PURES, éprouvées
 * sans rendre le site (`site-plan.test.mjs`).
 *
 * @usage import { sitemapXml, sitemapEntries, modifiedDate } from "./lib/sitemap.mjs"
 */
import { isNoindex } from "./seo-check.mjs";

/** Échappe ce qui ne peut pas entrer tel quel dans du XML. */
const xmlEscape = (text) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * La date de modification déclarée par la page elle-même (`dateModified` de son
 * JSON-LD) — jamais la date du build, identique pour toutes les pages.
 *
 * @param jsonLd - les blocs ld+json bruts de l'en-tête
 * @returns la date, ou `""` si la page n'en déclare aucune
 */
export function modifiedDate(jsonLd) {
  for (const raw of jsonLd) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      continue;
    }
    const nodes = Array.isArray(data?.["@graph"]) ? data["@graph"] : [data];
    for (const n of nodes)
      if (typeof n?.dateModified === "string" && n.dateModified !== "")
        return n.dateModified;
  }
  return "";
}

/**
 * Les entrées du plan : une par adresse canonique, sans page `noindex`.
 *
 * @param pages - `{ urlPath, canonical, robots, lastmod }` par page rendue
 * @param base - racine d'URL du site publié
 * @returns `{ loc, lastmod }` dans l'ordre des pages
 */
export function sitemapEntries(pages, base) {
  const seen = new Set();
  const out = [];
  for (const p of pages) {
    if (isNoindex({ robots: p.robots })) continue;
    const loc = p.canonical || `${base}/${p.urlPath}`;
    if (seen.has(loc)) continue;
    seen.add(loc);
    out.push({ loc, lastmod: p.lastmod ?? "" });
  }
  return out;
}

/**
 * Le contenu de `sitemap.xml`. `<lastmod>` seulement quand la page déclare sa
 * date : l'horodatage du build annoncerait cent modifications à chaque
 * publication, ce qui est faux et se paie en crédit d'exploration.
 *
 * @param pages - voir {@link sitemapEntries}
 * @param base - racine d'URL du site publié
 * @returns le contenu du fichier
 */
export function sitemapXml(pages, base) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...sitemapEntries(pages, base).map(
      (e) =>
        `  <url><loc>${xmlEscape(e.loc)}</loc>${e.lastmod ? `<lastmod>${xmlEscape(e.lastmod)}</lastmod>` : ""}</url>`,
    ),
    "</urlset>",
    "",
  ].join("\n");
}
