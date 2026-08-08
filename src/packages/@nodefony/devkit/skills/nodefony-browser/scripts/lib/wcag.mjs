/**
 * Calculs WCAG 2.x — luminance, contraste, seuils — en fonctions PURES.
 *
 * Une seule source pour deux mondes : ces fonctions sont importées par les
 * tests (Node) et INJECTÉES par leur code source dans la page mesurée (la
 * sonde compose `String(fn)` dans l'expression qu'elle fait évaluer au
 * navigateur). C'est pourquoi chacune est AUTOSUFFISANTE — pas d'import, pas
 * d'état de module, pas de fermeture : une référence au module ne survivrait
 * pas au voyage vers la page, et l'erreur n'apparaîtrait qu'à l'exécution,
 * dans le navigateur, où personne ne la lit.
 */

/**
 * Luminance relative d'une couleur CSS `rgb()`/`rgba()` — définition WCAG 2.x.
 *
 * @param {string} couleur - couleur telle que rendue par `getComputedStyle`.
 * @returns {number} luminance entre 0 (noir) et 1 (blanc) ; 0 si illisible.
 */
export function srgbLuminance(couleur) {
  const m = String(couleur).match(/\d+(\.\d+)?/g);
  if (!m) return 0;
  const [r, g, b] = m.slice(0, 3).map((v) => {
    const s = Number(v) / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Rapport de contraste WCAG entre deux couleurs CSS, arrondi à 2 décimales.
 *
 * @param {string} a - une couleur (l'ordre est indifférent).
 * @param {string} b - l'autre couleur.
 * @returns {number} rapport entre 1 (identiques) et 21 (noir sur blanc).
 */
export function contrastRatio(a, b) {
  const [x, y] = [srgbLuminance(a), srgbLuminance(b)].sort((p, q) => q - p);
  return +((x + 0.05) / (y + 0.05)).toFixed(2);
}

/**
 * Un texte est-il « large » au sens WCAG — c'est la POLICE qui décide du seuil.
 *
 * WCAG appelle large un texte d'au moins 24 px, ou 18,66 px en gras. Rendre un
 * contraste sans trancher cette question laisse le lecteur choisir son seuil au
 * hasard entre 3:1 et 4,5:1 — c'est-à-dire ne rien conclure.
 *
 * @param {number} px - taille de police calculée, en pixels.
 * @param {boolean} gras - graisse calculée ≥ 700.
 * @returns {boolean} vrai si les seuils « texte large » s'appliquent.
 */
export function estTexteLarge(px, gras) {
  return px >= 24 || (gras === true && px >= 18.66);
}

/**
 * Verdict WCAG d'un contraste, compte tenu de la police qui l'affiche.
 *
 * @param {number} ratio - rapport de contraste mesuré.
 * @param {number} px - taille de police calculée, en pixels.
 * @param {boolean} gras - graisse calculée ≥ 700.
 * @returns {"AAA"|"AA"|"ÉCHEC"} le niveau atteint.
 */
export function verdictWcag(ratio, px, gras) {
  const large = estTexteLarge(px, gras);
  if (ratio >= (large ? 4.5 : 7)) return "AAA";
  if (ratio >= (large ? 3 : 4.5)) return "AA";
  return "ÉCHEC";
}

/**
 * Le code source des quatre fonctions, prêt à être injecté dans une page.
 *
 * @returns {string} déclarations de fonctions concaténées, évaluables telles
 *   quelles dans la portée où la sonde compose son expression.
 */
export function sourceWcag() {
  return [srgbLuminance, contrastRatio, estTexteLarge, verdictWcag]
    .map(String)
    .join("\n");
}
