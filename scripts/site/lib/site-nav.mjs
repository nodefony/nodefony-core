/**
 * Le menu commun des sites VOISINS de la documentation — performance et
 * qualité — rendu par chacun de leurs générateurs.
 *
 * Sans lui, un lecteur qui cliquait « Performance » dans le menu de la doc
 * arrivait sur une page sans menu : plus aucun chemin vers les pages sœurs, ni
 * retour à la doc autrement que par le navigateur. Une seule implémentation,
 * appelée par `build-perf-site.mjs`, `build-qualite-site.mjs` et le générateur
 * des pages de version — trois copies divergeraient au premier ajout de page.
 *
 * Les liens sont RELATIFS à la page courante : le même site est publié à la
 * racine et sous `/next/`, et la copie `latest/` d'une version doit rester
 * juste sans être recalculée.
 *
 * @usage import { siteNav, relativeUrl, menuTargets } from "./lib/site-nav.mjs"
 * @module
 */

import path from "node:path";

/**
 * Le plan des sites voisins, en chemins absolus depuis la racine du site.
 * `children` : les pages sœurs que le menu déplie sous leur section.
 */
export const SIBLING_SITES = [
  { url: "/docs/", label: "Documentation" },
  {
    url: "/performance/",
    label: "📊 Performance",
    children: [
      { url: "/performance/latest/", label: "Toutes les mesures" },
      { url: "/performance/analyses/", label: "Où part le temps" },
      { url: "/performance/protocole/", label: "Comment on mesure" },
    ],
  },
  {
    url: "/qualite/",
    label: "🧪 Qualité",
    children: [{ url: "/qualite/latest/", label: "Dernière campagne" }],
  },
];

/**
 * Chemin relatif d'une page de dossier vers une autre, les deux écrites en
 * absolu depuis la racine du site (`/a/b/` → `/c/` donne `../../c/`).
 *
 * @param {string} from - URL de la page courante, terminée par `/`.
 * @param {string} to - URL cible, terminée par `/`.
 * @returns {string} le lien relatif, `./` si c'est la même page.
 */
export function relativeUrl(from, to) {
  const a = from.split("/").filter(Boolean);
  const b = to.split("/").filter(Boolean);
  let common = 0;
  while (common < a.length && common < b.length && a[common] === b[common])
    common++;
  const up = "../".repeat(a.length - common);
  const down = b.slice(common).join("/");
  return up + (down ? `${down}/` : "") || "./";
}

const escapeHtml = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

/**
 * Le menu latéral d'une page des sites voisins, au format que `doc({ nav })`
 * place dans sa colonne de gauche.
 *
 * L'entrée marquée « page courante » est celle dont l'URL est le plus long
 * préfixe de la page : une page de version (`/performance/10.0.0/methode/`)
 * allume sa section, une page sœur s'allume elle-même.
 *
 * @param {string} from - URL de la page courante, absolue depuis la racine du site.
 * @param {typeof SIBLING_SITES} [sites] - le plan (injecté par les tests).
 * @returns {string} le HTML du menu.
 */
export function siteNav(from, sites = SIBLING_SITES) {
  const all = sites.flatMap((s) => [s, ...(s.children ?? [])]);
  const current = all
    .filter((e) => from.startsWith(e.url))
    .sort((x, y) => y.url.length - x.url.length)[0]?.url;
  const link = (e, cls = "") =>
    `<a${cls ? ` class="${cls}"` : ""} href="${escapeHtml(relativeUrl(from, e.url))}"${
      e.url === current ? ' aria-current="page"' : ""
    }>${escapeHtml(e.label)}</a>`;
  const items = sites
    .map(
      (s) =>
        `<li>${link(s)}${
          s.children?.length
            ? `<ul>${s.children.map((c) => `<li>${link(c)}</li>`).join("")}</ul>`
            : ""
        }</li>`,
    )
    .join("");
  return (
    `<a class="nav-up" href="${escapeHtml(relativeUrl(from, "/"))}">← Accueil Nodefony</a>` +
    `<ul class="nav-flat">${items}</ul>`
  );
}

/**
 * Les adresses qu'un menu rendu atteint, résolues en absolu depuis sa page.
 *
 * Sert la garde « aucune page publiée hors du menu » : une page qu'aucune entrée
 * n'atteint ne se trouve que par lien ou par moteur de recherche — vécu, les ADR
 * publiés n'avaient aucune entrée. Lire le HTML RENDU plutôt que recopier les
 * règles du menu : la garde voit ce que le lecteur voit, et ne diverge pas.
 *
 * @param {string} navHtml - le menu tel que la page le rend
 * @param {string} fromUrl - l'adresse absolue de cette page (`/docs/x/`)
 * @returns {Set<string>} les adresses atteintes, absolues, terminées par `/`
 */
export function menuTargets(navHtml, fromUrl) {
  const out = new Set();
  for (const m of navHtml.matchAll(/<a\s[^>]*href="([^"#]*)[^"]*"/g)) {
    const href = m[1];
    if (href === "" || /^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
    const abs = path.posix.resolve(fromUrl, href);
    out.add(abs.endsWith("/") ? abs : `${abs}/`);
  }
  return out;
}
