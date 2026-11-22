/**
 * L'en-tête de référencement d'UNE page publiée : description, adresse
 * canonique, aperçu de partage (Open Graph + carte), données structurées
 * schema.org — tout ce que `check-site-seo.mjs` exige, émis au même endroit
 * pour toutes les pages du site (documentation, accueil, mesures, qualité).
 *
 * Une seule brique pour tous les générateurs : une page qui oublierait un champ
 * le ferait parce qu'elle a recopié l'en-tête, et le gate le dirait trop tard.
 *
 * @usage import { seoHead, brandTitle, techArticle } from "./lib/seo-head.mjs"
 */

/** Nom du site, tel que les aperçus et les données structurées le portent. */
export const SITE_NAME = "Nodefony";

/** Dépôt du code — `codeRepository` des données structurées. */
export const CODE_REPOSITORY = "https://github.com/nodefony/nodefony-core";

/** Échappe une valeur d'attribut HTML. */
const attr = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/**
 * Le titre d'ONGLET d'une page : son titre, suivi de la marque — sauf s'il la
 * porte déjà. C'est ce qu'un résultat de recherche affiche en lien bleu.
 *
 * @param title - le titre de la page (celui de son `<h1>`)
 * @returns « titre · Nodefony »
 */
export function brandTitle(title) {
  return /\bnodefony\b/i.test(title) ? title : `${title} · ${SITE_NAME}`;
}

/**
 * Données structurées d'une page de documentation.
 *
 * @param p.title - titre de la page
 * @param p.description - son résumé
 * @param p.url - son adresse canonique, absolue
 * @param p.siteUrl - adresse du site, sans `/` final
 * @param p.lang - langue de la page (`fr`)
 * @param p.dateModified - date de dernière modification déclarée, ou rien
 * @returns un nœud schema.org `TechArticle`
 */
export function techArticle({
  title,
  description,
  url,
  siteUrl,
  lang = "fr",
  dateModified,
}) {
  return {
    "@type": "TechArticle",
    headline: title,
    description,
    inLanguage: lang,
    url,
    mainEntityOfPage: url,
    ...(dateModified ? { dateModified } : {}),
    isPartOf: { "@type": "WebSite", name: SITE_NAME, url: `${siteUrl}/` },
    about: {
      "@type": "SoftwareSourceCode",
      name: SITE_NAME,
      codeRepository: CODE_REPOSITORY,
    },
  };
}

/**
 * Données structurées d'une page qui n'est pas un article — mesures, campagnes,
 * page introuvable.
 *
 * @param p.type - type schema.org (`WebPage`, `CollectionPage`, `Dataset`…)
 * @returns un nœud schema.org
 */
export function webPage({
  type = "WebPage",
  title,
  description,
  url,
  siteUrl,
  lang = "fr",
}) {
  return {
    "@type": type,
    name: title,
    description,
    inLanguage: lang,
    url,
    isPartOf: { "@type": "WebSite", name: SITE_NAME, url: `${siteUrl}/` },
  };
}

/**
 * Langue d'une page (`fr`, `en`, `fr-CA`) au format Open Graph (`fr_FR`).
 *
 * @param lang - code de langue BCP 47 de la page
 * @returns la locale Open Graph ; une région explicite est gardée
 */
export function ogLocale(lang) {
  const [base, region] = String(lang).split(/[-_]/);
  const regions = {
    fr: "FR",
    en: "US",
    es: "ES",
    de: "DE",
    it: "IT",
    pt: "BR",
  };
  return `${base.toLowerCase()}_${(region ?? regions[base.toLowerCase()] ?? base).toUpperCase()}`;
}

/**
 * Le bloc `<head>` de référencement d'une page.
 *
 * MULTILINGUE dès l'écriture : une page traduite déclare la liste COMPLÈTE de
 * ses versions (`alternates`, elle-même comprise) — le générateur n'a rien
 * d'autre à savoir. Les moteurs exigent la réciprocité (chaque version liste
 * toutes les autres) : `check-site-seo.mjs` la contrôle sur le site rendu.
 *
 * @param p.title - titre de la page (sans la marque : les aperçus l'ont déjà
 *   par `og:site_name`)
 * @param p.description - son résumé, déjà coupé à la bonne longueur
 * @param p.url - son adresse canonique, ABSOLUE — celle qu'on veut voir citée
 * @param p.type - `article` (une page) ou `website` (l'accueil)
 * @param p.lang - langue de la page (`fr` par défaut) ; fixe `og:locale`
 * @param p.locale - locale Open Graph forcée, sinon déduite de `lang`
 * @param p.alternates - versions de la page : `[{ lang, url, isDefault? }]`,
 *   la page comprise ; `isDefault` désigne la version `x-default`. Vide : page
 *   sans traduction, aucune balise `hreflang`.
 * @param p.jsonLd - un nœud schema.org ou une liste de nœuds
 * @returns les balises, une par ligne
 * @throws Error si une adresse n'est pas absolue, ou si `alternates` omet la page
 */
export function seoHead({
  title,
  description,
  url,
  type = "article",
  lang = "fr",
  locale = ogLocale(lang),
  alternates = [],
  jsonLd,
}) {
  if (!url.startsWith("https://"))
    throw new Error(`adresse canonique non absolue : ${url}`);
  if (alternates.length > 0 && !alternates.some((a) => a.url === url))
    throw new Error(`alternates de ${url} : la page doit s'y lister elle-même`);
  for (const a of alternates)
    if (!a.url.startsWith("https://"))
      throw new Error(`hreflang ${a.lang} : adresse non absolue ${a.url}`);
  const byDefault = alternates.find((a) => a.isDefault);
  const languages = [
    ...alternates.map(
      (a) =>
        `<link rel="alternate" hreflang="${attr(a.lang)}" href="${attr(a.url)}">`,
    ),
    ...(byDefault
      ? [
          `<link rel="alternate" hreflang="x-default" href="${attr(byDefault.url)}">`,
        ]
      : []),
    ...alternates
      .filter((a) => a.url !== url)
      .map(
        (a) =>
          `<meta property="og:locale:alternate" content="${attr(ogLocale(a.lang))}">`,
      ),
  ];
  const nodes = Array.isArray(jsonLd) ? jsonLd : [jsonLd];
  const graph =
    nodes.length === 1
      ? { "@context": "https://schema.org", ...nodes[0] }
      : { "@context": "https://schema.org", "@graph": nodes };
  // `<` échappé : un titre qui contiendrait `</script>` ne doit pas fermer le bloc.
  const json = JSON.stringify(graph).replace(/</g, "\\u003c");
  return [
    `<meta name="description" content="${attr(description)}">`,
    `<link rel="canonical" href="${attr(url)}">`,
    `<meta property="og:type" content="${attr(type)}">`,
    `<meta property="og:site_name" content="${SITE_NAME}">`,
    `<meta property="og:title" content="${attr(title)}">`,
    `<meta property="og:description" content="${attr(description)}">`,
    `<meta property="og:url" content="${attr(url)}">`,
    `<meta property="og:locale" content="${attr(locale)}">`,
    `<meta name="twitter:card" content="summary">`,
    `<meta name="twitter:title" content="${attr(title)}">`,
    `<meta name="twitter:description" content="${attr(description)}">`,
    ...languages,
    `<script type="application/ld+json">${json}</script>`,
  ].join("\n");
}
