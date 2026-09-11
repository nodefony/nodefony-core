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
 * Décompose une couleur CSS en canaux 0–255 et son alpha.
 *
 * Deux notations coexistent dans ce que rend `getComputedStyle`, et elles
 * n'ont PAS la même échelle : l'héritée `rgb(0, 87, 156)` compte en 0–255,
 * la moderne `color(srgb 0 0.34 0.61 / 0.13)` en 0–1. Les lire avec la même
 * expression régulière donne une couleur presque noire là où il y a du bleu —
 * un contraste faux, et des échecs inventés qui noient les vrais.
 *
 * Une TROISIÈME notation compte, bien que `getComputedStyle` ne la rende
 * jamais : l'hexadécimal. Ce module est publié dans le devkit, et qui veut
 * vérifier une palette AVANT de l'écrire appelle avec ses propres couleurs,
 * donc en `#rrggbb`. L'expression régulière ci-dessous n'y voit qu'un ou deux
 * nombres — `#149eca` donne « 149 » — et rendait du noir : un contraste de
 * 1,24 au lieu de 4,68, sans un mot.
 *
 * Et ce qui reste ILLISIBLE lève. Rendre du noir opaque sur une entrée
 * incomprise fabrique un verdict plausible et FAUX, ce qui est pire qu'une
 * absence de verdict : on croit avoir mesuré. Les noms CSS (`chartreuse`) sont
 * dans ce cas — les résoudre demanderait la table des 148 mots-clés, que la
 * page, elle, rend déjà en `rgb()`.
 *
 * @param {string} color - couleur telle que rendue par `getComputedStyle`, ou
 *   écrite à la main en hexadécimal.
 * @returns {{ r: number, g: number, b: number, a: number }} canaux 0–255 et
 *   alpha 0–1.
 * @throws {Error} si la notation n'est pas reconnue.
 */
export function parseColor(color) {
  const s = String(color).trim();
  // `transparent` est le SEUL mot-clé que les navigateurs rendent parfois tel
  // quel, et il a une valeur définie : `rgba(0, 0, 0, 0)`. Le refuser serait
  // faux — un fond non peint est un cas courant, pas une erreur de mesure.
  if (/^transparent$/i.test(s)) return { r: 0, g: 0, b: 0, a: 0 };
  // Hexadécimal — 3, 4, 6 ou 8 quartets. Les formes courtes DOUBLENT chaque
  // quartet (`#0af` → `#00aaff`) : c'est la règle de la spécification, pas une
  // approximation.
  const hex = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (hex) {
    const d = hex[1];
    if (d.length === 3 || d.length === 4) {
      const q = [...d].map((c) => parseInt(c + c, 16));
      return {
        r: q[0],
        g: q[1],
        b: q[2],
        a: q[3] === undefined ? 1 : q[3] / 255,
      };
    }
    if (d.length === 6 || d.length === 8) {
      const o = [0, 2, 4, 6].map((i) => d.slice(i, i + 2));
      return {
        r: parseInt(o[0], 16),
        g: parseInt(o[1], 16),
        b: parseInt(o[2], 16),
        a: o[3] === "" ? 1 : parseInt(o[3], 16) / 255,
      };
    }
    throw new Error(`couleur hexadécimale de longueur invalide : ${s}`);
  }
  const numbers = s.match(/-?\d*\.?\d+(?:e-?\d+)?%?/gi);
  if (!numbers || numbers.length < 3)
    throw new Error(
      `notation de couleur non reconnue : ${JSON.stringify(String(color))} — ` +
        "attendu rgb()/rgba(), color(srgb …) ou #rrggbb",
    );
  // `color(srgb …)` et `color(display-p3 …)` : canaux en 0–1. Le pourcentage
  // est explicite dans les deux familles et se ramène toujours à 0–1.
  const modern = /^color\(/i.test(s);
  const channel = (v) => {
    if (v.endsWith("%")) return (parseFloat(v) / 100) * 255;
    const n = parseFloat(v);
    return modern ? n * 255 : n;
  };
  const [r, g, b] = numbers.slice(0, 3).map(channel);
  const rawAlpha = numbers[3];
  const a =
    rawAlpha === undefined
      ? 1
      : rawAlpha.endsWith("%")
        ? parseFloat(rawAlpha) / 100
        : parseFloat(rawAlpha);
  const clamp = (n) => Math.min(255, Math.max(0, n));
  return {
    r: clamp(r),
    g: clamp(g),
    b: clamp(b),
    a: Number.isFinite(a) ? Math.min(1, Math.max(0, a)) : 1,
  };
}

/**
 * Compose une couleur semi-transparente sur celle qui se trouve dessous.
 *
 * Sans cette étape, le contraste d'un texte posé sur un voile à 13 % est
 * calculé contre le voile SEUL — c'est-à-dire contre une couleur que
 * personne ne voit. C'est ainsi qu'un aplat pâle passe pour très sombre.
 *
 * @param {string} over - la couche du dessus (éventuellement transparente).
 * @param {string} under - ce qu'il y a derrière (supposé opaque).
 * @returns {string} une couleur `rgb()` opaque, telle qu'elle est PERÇUE.
 */
export function compose(over, under) {
  const h = parseColor(over);
  if (h.a >= 1)
    return `rgb(${Math.round(h.r)}, ${Math.round(h.g)}, ${Math.round(h.b)})`;
  const b = parseColor(under);
  const blend = (x, y) => Math.round(x * h.a + y * (1 - h.a));
  return `rgb(${blend(h.r, b.r)}, ${blend(h.g, b.g)}, ${blend(h.b, b.b)})`;
}

/**
 * Luminance relative d'une couleur CSS — définition WCAG 2.x.
 *
 * L'alpha est ignoré ici À DESSEIN : une couleur translucide doit avoir été
 * composée sur son fond AVANT (`composer`), sans quoi la luminance décrit une
 * couleur que l'œil ne rencontre jamais.
 *
 * @param {string} color - couleur telle que rendue par `getComputedStyle`.
 * @returns {number} luminance entre 0 (noir) et 1 (blanc).
 */
export function srgbLuminance(color) {
  const { r, g, b } = parseColor(color);
  const [lr, lg, lb] = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
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
 * @param {boolean} bold - graisse calculée ≥ 700.
 * @returns {boolean} vrai si les seuils « texte large » s'appliquent.
 */
export function isLargeText(px, bold) {
  return px >= 24 || (bold === true && px >= 18.66);
}

/**
 * Verdict WCAG d'un contraste, compte tenu de la police qui l'affiche.
 *
 * @param {number} ratio - rapport de contraste mesuré.
 * @param {number} px - taille de police calculée, en pixels.
 * @param {boolean} bold - graisse calculée ≥ 700.
 * @returns {"AAA"|"AA"|"ÉCHEC"} le niveau atteint.
 */
export function verdictWcag(ratio, px, bold) {
  const isLarge = isLargeText(px, bold);
  if (ratio >= (isLarge ? 4.5 : 7)) return "AAA";
  if (ratio >= (isLarge ? 3 : 4.5)) return "AA";
  return "ÉCHEC";
}

/**
 * Le code source des quatre fonctions, prêt à être injecté dans une page.
 *
 * @returns {string} déclarations de fonctions concaténées, évaluables telles
 *   quelles dans la portée où la sonde compose son expression.
 */
export function sourceWcag() {
  return [
    parseColor,
    compose,
    srgbLuminance,
    contrastRatio,
    isLargeText,
    verdictWcag,
  ]
    .map(String)
    .join("\n");
}
