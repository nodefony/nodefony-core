/**
 * Le référencement d'un site RENDU, page par page : ce qu'un moteur de
 * recherche, l'aperçu d'un lien partagé et un agent lisent dans l'en-tête.
 *
 * La règle : CHAQUE page porte un titre, une description, une adresse
 * canonique, un aperçu de partage (Open Graph + carte) et des données
 * structurées qui lui APPARTIENNENT. Un titre ou une description partagés par
 * deux pages est un défaut : le moteur n'en retient qu'une, et le lecteur ne
 * sait pas laquelle ouvrir dans une liste de résultats.
 *
 * Fonctions PURES (texte HTML en entrée, constats en sortie) : le contrôle se
 * prouve sans rendre le site, et le même code juge le rendu réel
 * (`check-site-seo.mjs`).
 *
 * @usage import { readSeoHead, siteDefects } from "./lib/seo-check.mjs"
 */

/**
 * Les attributs d'une balise ouvrante, en table — l'ordre d'écriture ne compte
 * pas, les guillemets simples ou doubles non plus.
 *
 * @param tag - la balise entière, `<meta …>`
 * @returns nom d'attribut (minuscules) → valeur
 */
export function tagAttributes(tag) {
  const out = new Map();
  const re = /([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (let m = re.exec(tag); m !== null; m = re.exec(tag))
    out.set(m[1].toLowerCase(), m[2] ?? m[3]);
  return out;
}

/** Décode les entités qu'un générateur échappe — pour COMPARER, pas pour afficher. */
const decode = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();

/**
 * Ce que l'en-tête d'une page déclare pour le référencement.
 *
 * @param html - la page entière
 * @returns titre, description, canonique, propriétés Open Graph et Twitter,
 *   et les blocs de données structurées (texte brut, non parsé)
 */
export function readSeoHead(html) {
  const headEnd = html.search(/<\/head>/i);
  const head = headEnd === -1 ? html : html.slice(0, headEnd);
  const title = /<title>([\s\S]*?)<\/title>/i.exec(head);
  const meta = new Map();
  let canonical = null;
  let robots = null;
  /** hreflang → adresse, x-default compris */
  const hreflang = new Map();
  for (const tag of head.match(/<(?:meta|link)\s[^>]*>/gi) ?? []) {
    const a = tagAttributes(tag);
    if (tag.toLowerCase().startsWith("<link")) {
      if (a.get("rel") === "canonical") canonical = decode(a.get("href") ?? "");
      else if (a.get("rel") === "alternate" && a.has("hreflang"))
        hreflang.set(a.get("hreflang"), decode(a.get("href") ?? ""));
      continue;
    }
    const key = a.get("property") ?? a.get("name");
    if (key === undefined) continue;
    if (key === "robots") robots = a.get("content") ?? null;
    else if (!meta.has(key)) meta.set(key, decode(a.get("content") ?? ""));
  }
  const jsonLd = [];
  const re =
    /<script\s[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (let m = re.exec(head); m !== null; m = re.exec(head)) jsonLd.push(m[1]);
  return {
    title: title === null ? "" : decode(title[1]),
    description: meta.get("description") ?? "",
    canonical: canonical ?? "",
    robots,
    meta,
    jsonLd,
    hreflang,
  };
}

/** Les propriétés d'aperçu exigées sur chaque page. */
export const REQUIRED_PREVIEW = [
  "og:type",
  "og:title",
  "og:description",
  "og:url",
  "og:site_name",
  "twitter:card",
];

/**
 * Les défauts d'UNE page, sans regarder les autres.
 *
 * @param head - le résultat de {@link readSeoHead}
 * @returns un message par défaut, vide si la page est complète
 */
export function pageDefects(head) {
  const out = [];
  if (head.title === "") out.push("sans <title>");
  if (head.description === "") out.push("sans meta description");
  if (head.canonical === "") out.push("sans adresse canonique");
  else if (!head.canonical.startsWith("https://"))
    out.push(`adresse canonique non absolue : ${head.canonical}`);
  for (const key of REQUIRED_PREVIEW)
    if ((head.meta.get(key) ?? "") === "") out.push(`sans ${key}`);
  const ogUrl = head.meta.get("og:url");
  if (ogUrl && head.canonical && ogUrl !== head.canonical)
    out.push(`og:url (${ogUrl}) ≠ canonique (${head.canonical})`);
  if (head.jsonLd.length === 0) out.push("sans données structurées (ld+json)");
  for (const raw of head.jsonLd) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      out.push(`ld+json illisible : ${e.message}`);
      continue;
    }
    const nodes = Array.isArray(data?.["@graph"]) ? data["@graph"] : [data];
    if (data?.["@context"] !== "https://schema.org")
      out.push("ld+json sans @context https://schema.org");
    for (const n of nodes)
      if (typeof n?.["@type"] !== "string" || n["@type"] === "")
        out.push("ld+json : un nœud sans @type");
  }
  return out;
}

/**
 * Les défauts d'un SITE : ceux de chaque page, plus les titres et
 * descriptions partagés par plusieurs pages.
 *
 * Deux pages qui déclarent la MÊME adresse canonique ne sont pas en double :
 * l'une se donne pour copie de l'autre (`performance/latest/` d'une version),
 * et c'est exactement ce que la canonique dit au moteur.
 *
 * @param pages - `{ path, html }` pour chaque page rendue
 * @returns `{ path, defect }` par défaut, trié par chemin
 */
export function siteDefects(pages) {
  const out = [];
  /** valeur → (canonique ou chemin → chemins) */
  const byTitle = new Map();
  const byDescription = new Map();
  const push = (map, key, group, p) => {
    if (key === "") return;
    let groups = map.get(key);
    if (groups === undefined) map.set(key, (groups = new Map()));
    const list = groups.get(group);
    if (list === undefined) groups.set(group, [p]);
    else list.push(p);
  };
  const heads = [];
  for (const { path, html } of pages) {
    const head = readSeoHead(html);
    heads.push({ path, head });
    for (const defect of pageDefects(head)) out.push({ path, defect });
    const group = head.canonical || path;
    push(byTitle, head.title, group, path);
    push(byDescription, head.description, group, path);
  }
  const shared = (label, map) => {
    for (const [value, groups] of map) {
      if (groups.size < 2) continue;
      for (const paths of groups.values())
        for (const path of paths)
          out.push({
            path,
            defect: `${label} partagé avec ${groups.size - 1} autre(s) page(s) : « ${value.slice(0, 70)} »`,
          });
    }
  };
  shared("titre", byTitle);
  shared("description", byDescription);
  for (const d of hreflangDefects(heads)) out.push(d);
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Une liste `hreflang` lisible et comparable : `lang=url` triés. */
const langSet = (map) =>
  [...map]
    .map(([l, u]) => `${l}=${u}`)
    .sort()
    .join(" ");

/**
 * Les versions linguistiques d'une page doivent être RÉCIPROQUES : chaque
 * version se liste elle-même et liste exactement les mêmes versions que les
 * autres, et chaque adresse annoncée existe sur le site. Un moteur ignore une
 * paire non réciproque — sans le dire.
 *
 * @param heads - `{ path, head }` par page rendue
 * @returns `{ path, defect }` par défaut
 */
export function hreflangDefects(heads) {
  const out = [];
  const byUrl = new Map();
  for (const h of heads) if (h.head.canonical) byUrl.set(h.head.canonical, h);
  for (const { path, head } of heads) {
    if (head.hreflang.size === 0) continue;
    const own = [...head.hreflang].filter(([l]) => l !== "x-default");
    if (!own.some(([, u]) => u === head.canonical))
      out.push({
        path,
        defect: "hreflang : la page ne se liste pas elle-même",
      });
    for (const [lang, url] of head.hreflang) {
      const target = byUrl.get(url);
      if (target === undefined) {
        out.push({ path, defect: `hreflang ${lang} : ${url} absente du site` });
        continue;
      }
      if (langSet(target.head.hreflang) !== langSet(head.hreflang))
        out.push({
          path,
          defect: `hreflang ${lang} : ${target.path} ne déclare pas les mêmes versions (non réciproque)`,
        });
    }
  }
  return out;
}
