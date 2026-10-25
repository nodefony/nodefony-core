/**
 * Normalisation de texte pour les recherches tolérantes du Studio — PUR (0 JSX).
 *
 * Une seule règle pour tous les champs de recherche : sans accents, en
 * minuscules. `ConfigLayout` (recherche d'un module) et la recherche globale de
 * la page Configuration la partagent : deux copies finiraient par ne plus
 * trouver la même chose.
 */

/**
 * Normalise pour une recherche tolérante : décompose les caractères accentués,
 * retire les diacritiques et passe en minuscules.
 *
 * @param s - texte brut.
 * @returns le texte normalisé (`Délai` → `delai`).
 */
export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/**
 * Forme COMPACTE d'un texte : normalisé, puis débarrassé de tout ce qui n'est
 * ni lettre ni chiffre. Rend équivalents les séparateurs des différentes
 * écritures d'une même clé (`jwt.accessTtlS`, `JWT__ACCESSTTLS`, `jwt accessttls`).
 *
 * @param s - texte brut.
 * @returns la forme compacte (`NF__SECURITY__JWT` → `nfsecurityjwt`).
 */
export function compactText(s: string): string {
  return normalizeText(s).replace(/[^a-z0-9]+/g, "");
}
