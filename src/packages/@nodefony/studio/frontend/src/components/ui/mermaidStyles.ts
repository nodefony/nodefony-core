/**
 * Feuille de style d'un schéma mermaid, séparée de son SVG (ADR-0024 §C2).
 *
 * Mermaid rend un SVG qui embarque sa propre feuille `<style>`. Sous la
 * politique par défaut, `style-src` est signé d'un nonce : le navigateur ignore
 * alors `'unsafe-inline'` et bloque ce `<style>` posé par `innerHTML`. Le SVG
 * retombe sur les valeurs par défaut, soit un remplissage NOIR. La feuille est
 * donc retirée du SVG pour être appliquée par `adoptStyles`, qui passe par le
 * CSSOM et que la politique ne gouverne pas.
 */

/** Toute balise `<style>` du SVG, attributs compris. Le rendu vient de mermaid, pas d'un tiers. */
const STYLE_ELEMENT = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;

/** Un SVG mermaid sans sa feuille, et le texte de cette feuille. */
export interface ISvgStyles {
  /** Le SVG, sans aucune balise `<style>`. */
  readonly svg: string;
  /** Le texte des feuilles retirées, concaténé ; chaîne vide s'il n'y en avait pas. */
  readonly css: string;
}

/**
 * Retire les balises `<style>` d'un SVG et rend leur texte à part.
 *
 * Les sélecteurs de mermaid sont préfixés par l'id du schéma (`#mermaid-…`) :
 * appliquée au document, la feuille ne touche que le schéma qui l'a produite.
 *
 * @param svg - SVG rendu par `mermaid.render`.
 * @returns le SVG nettoyé et le texte de ses feuilles.
 */
export function splitSvgStyles(svg: string): ISvgStyles {
  let css = "";
  const stripped = svg.replace(STYLE_ELEMENT, (_match, text: string) => {
    css += text;
    return "";
  });
  return { svg: stripped, css };
}

/**
 * Retire du document une feuille posée par `adoptStyles`.
 *
 * Chaque rendu d'un schéma (montage, changement de thème) adopte une feuille
 * neuve : sans ce retrait, elles s'empileraient à chaque navigation.
 *
 * @param sheet - ce qu'`adoptStyles` a rendu : feuille construite, ou `<style>` du repli.
 */
export function releaseStyles(sheet: CSSStyleSheet | HTMLStyleElement): void {
  if (typeof CSSStyleSheet === "function" && sheet instanceof CSSStyleSheet) {
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
      (s) => s !== sheet,
    );
    return;
  }
  if (sheet instanceof HTMLStyleElement) sheet.remove();
}
