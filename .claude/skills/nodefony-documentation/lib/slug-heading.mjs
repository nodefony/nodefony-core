/**
 * Slug d'un titre de page — la SEULE implémentation côté Node.
 *
 * Elle pose les ancres `#…` du site publié et sert de référence au gate
 * `anchor-inpage.mjs` qui vérifie que les sommaires ne pointent pas dans le
 * vide. Une troisième copie de cette règle, et les sommaires meurent en
 * silence : c'est déjà arrivé (77 ancres cassées d'un coup).
 *
 * Reste UNE copie ailleurs, inévitable car de l'autre côté d'une frontière de
 * paquets : `slugifyHeading()` dans
 * `@nodefony/studio/frontend/src/components/ui/DocToc.tsx`, qui pose les `id`
 * du portail Studio. Toucher l'une = toucher l'autre.
 *
 * Convention GitHub : accents CONSERVÉS, ponctuation/symboles/emoji retirés.
 * Les sélecteurs de variante (U+FE00–U+FE0F) sont retirés À PART : ils suivent
 * les emoji « texte » (⚙️ ⚠️ …), sont INVISIBLES, et survivraient à la regex
 * suivante en tant que marques (\p{M}) — l'ancre en devenait intapable.
 *
 * @param {string} text - texte brut du titre (balises déjà retirées).
 * @returns {string} l'ancre, sans `#`.
 */
export const slugifyHeading = (text) =>
  text
    .toLowerCase()
    .replace(/[︀-️]/g, "")
    .replace(/[^\p{L}\p{N}\p{M}\s-]/gu, "")
    .replace(/\s/g, "-");
