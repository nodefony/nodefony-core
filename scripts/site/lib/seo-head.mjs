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

/** Image d'aperçu du site — rendue par `render-og-image.mjs`, commitée, posée à la racine de chaque site. */
export const OG_IMAGE = Object.freeze({
  file: "og-image.png",
  width: 1200,
  height: 630,
  alt: "Nodefony — Node.js framework: HTTP & WebSocket, TypeScript, CBOR realtime, gRPC, MCP",
});

/**
 * L'image d'aperçu d'un site, en adresse absolue.
 *
 * @param siteUrl - adresse du site, sans `/` final
 * @returns `{ url, width, height, alt }` pour {@link seoHead}
 */
export function siteImage(siteUrl) {
  return {
    url: `${siteUrl}/${OG_IMAGE.file}`,
    width: OG_IMAGE.width,
    height: OG_IMAGE.height,
    alt: OG_IMAGE.alt,
  };
}

/** Au-delà, un moteur de recherche tronque le titre — et la marque part la première. */
export const TAB_TITLE_MAX = 65;

/**
 * Le titre d'ONGLET d'une page, marque comprise, dans {@link TAB_TITLE_MAX}
 * caractères : le titre complet s'il tient ; sinon sa partie avant le tiret
 * cadratin (« Flux d'octets — servir la sortie… » → « Flux d'octets ») ; sinon
 * une coupe au dernier mot entier. Le `<h1>` et `og:title` gardent le titre
 * entier : seul l'onglet — le lien bleu d'un résultat — est raccourci.
 *
 * @param title - le titre de la page
 * @returns le titre d'onglet
 */
export function tabTitle(title) {
  const fits = (t) => [...brandTitle(t)].length <= TAB_TITLE_MAX;
  if (fits(title)) return brandTitle(title);
  const head = title.split(" — ")[0].trim();
  if (head !== title && [...head].length >= 8 && fits(head))
    return brandTitle(head);
  const room = TAB_TITLE_MAX - [` · ${SITE_NAME}`].join("").length - 1;
  const chars = [...title];
  const cut = chars.slice(0, room).join("");
  const word = cut.lastIndexOf(" ");
  return brandTitle(
    `${(word > 0 ? cut.slice(0, word) : cut).replace(/[\s,;:—-]+$/, "")}…`,
  );
}

/**
 * Le nœud schema.org du SITE, identifié par un `@id` stable : chaque page s'y
 * rattache par cet identifiant au lieu de répéter un nœud anonyme.
 *
 * @param siteUrl - adresse du site, sans `/` final
 * @returns un nœud `WebSite`
 */
export function websiteNode(siteUrl) {
  return {
    "@type": "WebSite",
    "@id": `${siteUrl}/#website`,
    name: SITE_NAME,
    url: `${siteUrl}/`,
  };
}

/**
 * Le nœud schema.org du LOGICIEL décrit par le site, identifié par un `@id` stable.
 *
 * @param p.siteUrl - adresse du site, sans `/` final
 * @param p.description - ce qu'il est, une phrase
 * @param p.version - version publiée, ou rien
 * @param p.author - nom de l'auteur, ou rien
 * @returns un nœud `SoftwareSourceCode`
 */
export function softwareNode({ siteUrl, description, version, author }) {
  return {
    "@type": "SoftwareSourceCode",
    "@id": `${siteUrl}/#software`,
    name: SITE_NAME,
    ...(description ? { description } : {}),
    codeRepository: CODE_REPOSITORY,
    programmingLanguage: "TypeScript",
    runtimePlatform: "Node.js",
    license: "https://www.apache.org/licenses/LICENSE-2.0",
    ...(version ? { version } : {}),
    ...(author ? { author: { "@type": "Person", name: author } } : {}),
  };
}

/**
 * Le fil d'Ariane d'une page en données structurées — recopié de la hiérarchie
 * RÉELLE des pages publiées, jamais inventé.
 *
 * @param items - `[{ name, url }]` de la racine à la page, la page comprise
 * @returns un nœud `BreadcrumbList`, ou `null` s'il y a moins de deux niveaux
 */
export function breadcrumbList(items) {
  if (items.length < 2) return null;
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: it.url,
    })),
  };
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
 * @param p.author - nom de l'auteur, ou rien
 * @returns un nœud schema.org `TechArticle`
 */
export function techArticle({
  title,
  description,
  url,
  siteUrl,
  lang = "fr",
  dateModified,
  author,
}) {
  return {
    "@type": "TechArticle",
    "@id": `${url}#article`,
    headline: title,
    description,
    inLanguage: lang,
    url,
    mainEntityOfPage: url,
    ...(dateModified ? { dateModified } : {}),
    ...(author ? { author: { "@type": "Person", name: author } } : {}),
    isPartOf: { "@id": `${siteUrl}/#website` },
    about: { "@id": `${siteUrl}/#software` },
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
    "@id": `${url}#page`,
    name: title,
    description,
    inLanguage: lang,
    url,
    isPartOf: { "@id": `${siteUrl}/#website` },
  };
}

/**
 * Région par défaut de chaque langue, au format Open Graph. Une TABLE, jamais
 * une déduction : `ja` ne se dit pas `ja_JA` mais `ja_JP`, `zh` pas `zh_ZH`.
 * Une langue absente se refuse — on l'ajoute ici le jour où on la publie.
 */
export const OG_LOCALES = Object.freeze({
  fr: "fr_FR",
  en: "en_US",
  es: "es_ES",
  de: "de_DE",
  it: "it_IT",
  pt: "pt_BR",
  nl: "nl_NL",
  ja: "ja_JP",
  zh: "zh_CN",
  ko: "ko_KR",
  ru: "ru_RU",
  uk: "uk_UA",
  sv: "sv_SE",
  pl: "pl_PL",
});

/**
 * Langue d'une page (`fr`, `en`, `fr-CA`) au format Open Graph (`fr_FR`).
 *
 * @param lang - code de langue BCP 47 ; une région explicite est gardée, un
 *   sous-tag d'écriture (`zh-Hans`) est ignoré
 * @returns la locale Open Graph
 * @throws Error si la langue n'a pas de région connue dans {@link OG_LOCALES}
 */
export function ogLocale(lang) {
  const parts = String(lang).split(/[-_]/);
  const base = parts[0].toLowerCase();
  const region = parts.slice(1).find((p) => /^[A-Za-z]{2}$/.test(p));
  if (region !== undefined) return `${base}_${region.toUpperCase()}`;
  const known = OG_LOCALES[base];
  if (known === undefined)
    throw new Error(
      `langue « ${lang} » sans locale Open Graph connue (OG_LOCALES)`,
    );
  return known;
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
 * @param p.image - image d'aperçu ({@link siteImage}) — exigée par Open Graph
 * @param p.noindex - page à NE PAS indexer (site `/next/`, page introuvable)
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
  noindex = false,
  image,
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
    ...(noindex ? [`<meta name="robots" content="noindex">`] : []),
    `<link rel="canonical" href="${attr(url)}">`,
    `<meta property="og:type" content="${attr(type)}">`,
    `<meta property="og:site_name" content="${SITE_NAME}">`,
    `<meta property="og:title" content="${attr(title)}">`,
    `<meta property="og:description" content="${attr(description)}">`,
    `<meta property="og:url" content="${attr(url)}">`,
    `<meta property="og:locale" content="${attr(locale)}">`,
    ...(image
      ? [
          `<meta property="og:image" content="${attr(image.url)}">`,
          `<meta property="og:image:width" content="${image.width}">`,
          `<meta property="og:image:height" content="${image.height}">`,
          `<meta property="og:image:alt" content="${attr(image.alt)}">`,
        ]
      : []),
    `<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">`,
    `<meta name="twitter:title" content="${attr(title)}">`,
    `<meta name="twitter:description" content="${attr(description)}">`,
    ...languages,
    `<script type="application/ld+json">${json}</script>`,
  ].join("\n");
}
