/**
 * Retrait des balises HTML — **une seule implémentation pour tout le dépôt**.
 *
 * Deux scripts extraient du texte depuis du HTML rendu (le sommaire du site de
 * documentation, les titres du README). Chacun portait sa copie ; l'une bouclait
 * jusqu'au point fixe, l'autre non — et c'est celle-là que CodeQL a signalée
 * (`js/incomplete-multi-character-sanitization`, alerte #205). Deux copies d'une
 * même règle divergent en silence : chacune passe ses propres contrôles.
 *
 * ⚠️ Ce module ne peut PAS vivre dans l'un des deux scripts : les importer les
 * EXÉCUTE (ils travaillent au top-level), et lire un titre déclencherait une
 * construction de site.
 *
 * @usage import { sansBalises, anchorHeadings } from "./lib/html-text.mjs"
 */
import { slugifyHeading } from "../../../.claude/skills/nodefony-documentation/lib/slug-heading.mjs";

/**
 * Retire toutes les balises, en **répétant jusqu'au point fixe**.
 *
 * Une passe unique n'est pas idempotente : elle laisse repasser ce qu'elle vient
 * de reformer — `<<b>b>` rend `<b>`, et `<<script>script>` rend `<script>`. La
 * boucle coûte une passe de plus qui ne trouve rien, sur des titres de quelques mots.
 *
 * ⚠️ Ce n'est PAS un assainisseur : la sortie n'est sûre en HTML que si elle est
 * ÉCHAPPÉE au rendu. Un appelant qui décode les entités après coup (`&lt;img
 * onerror=…&gt;`) reforme du HTML actif — c'est l'échappement qui le rend inoffensif.
 *
 * @param html - le fragment dont on veut le texte.
 * @returns le même fragment, sans aucune balise.
 */
export const sansBalises = (html) => {
  let avant;
  let apres = html;
  do {
    avant = apres;
    apres = avant.replace(/<[^>]*>/gu, "");
  } while (apres !== avant);
  return apres;
};

/**
 * Entités que le rendu Markdown produit dans un titre. Sans leur décodage, un
 * titre `mode: "first"` arrivé en `mode: &quot;first&quot;` donnait le slug
 * `mode-quotfirstquot` — une ancre qu'aucun autre outil ne produit.
 */
const ENTITIES = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

/**
 * Rend son texte à un fragment de HTML : balises retirées, entités décodées.
 *
 * ⚠️ Le décodage vient APRÈS le retrait des balises : un titre contenant
 * `&lt;img onerror=…&gt;` ressort en HTML actif. Tout appelant qui réaffiche ce
 * texte l'ÉCHAPPE (le sommaire du site le fait) — c'est cet échappement qui
 * protège, pas le retrait des balises.
 *
 * @param html - le contenu rendu d'un titre.
 * @returns son texte brut.
 */
export const headingText = (html) =>
  sansBalises(html)
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (e) => ENTITIES[e])
    .trim();

/**
 * Pose sur chaque titre `h2`–`h6` l'`id` que donne la règle de slug commune.
 *
 * Les niveaux sont ceux qu'accepte `anchor-inpage.mjs` (`#{2,6}`) : un générateur
 * qui n'ancrait que `h2`/`h3` publiait mortes des ancres que le gate des sources
 * déclarait valides. Les deux sites (documentation, performance) passent par ici.
 *
 * @param html - le HTML rendu d'une page.
 * @param options.toc - reçoit les titres `h2`/`h3`, pour le sommaire.
 * @param options.selfLink - ajoute le lien « # » vers la section.
 * @returns le HTML, titres ancrés.
 */
export function anchorHeadings(html, { toc = null, selfLink = false } = {}) {
  return html.replace(/<h([2-6])>([\s\S]*?)<\/h\1>/g, (_, lvl, inner) => {
    const text = headingText(inner);
    const id = slugifyHeading(text);
    if (toc !== null && Number(lvl) <= 3)
      toc.push({ lvl: Number(lvl), id, text });
    const link = selfLink
      ? `<a class="h-anchor" href="#${id}" aria-label="Lien vers cette section">#</a>`
      : "";
    return `<h${lvl} id="${id}">${inner}${link}</h${lvl}>`;
  });
}
