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

import type { MantineColorsTuple } from "@mantine/core";

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

/** Nuanciers du thème Studio dont un schéma tire ses couleurs (dix teintes, clair → foncé). */
export interface IDiagramPalette {
  /** Bleu de marque (`brand`). */
  readonly brand: MantineColorsTuple;
  /** Gris du schéma clair (`gray`). */
  readonly gray: MantineColorsTuple;
  /** Surfaces du schéma sombre (`dark`, celles de la barre de debug). */
  readonly dark: MantineColorsTuple;
  /** Texte du schéma clair. */
  readonly black: string;
  /** Fond du schéma clair. */
  readonly white: string;
  /** Police de l'interface. */
  readonly fontFamily: string;
}

/**
 * Variables du thème `base` de mermaid, tirées de la palette de Studio.
 *
 * Les thèmes livrés par mermaid (`default` : grappes jaunes, nœuds lavande)
 * n'ont rien de commun avec la console. Le thème `base` est le seul que mermaid
 * laisse entièrement régler : nœuds sur la surface des cartes, filet et flèches
 * neutres, bordure de nœud au bleu de marque, grappe en retrait. Les couleurs
 * sont LUES dans le thème Mantine, jamais recopiées : la console reste la
 * seule source.
 *
 * @param scheme - schéma de couleur affiché.
 * @param p - nuanciers du thème Studio.
 * @returns les `themeVariables` à passer à `mermaid.initialize`.
 */
export function diagramThemeVariables(
  scheme: "light" | "dark",
  p: IDiagramPalette,
): Record<string, string | boolean> {
  const dark = scheme === "dark";
  const surface = dark ? p.dark[6] : p.white;
  const text = dark ? p.dark[0] : p.black;
  const line = dark ? p.dark[2] : p.gray[6];
  const accent = dark ? p.brand[4] : p.brand[6];
  return {
    darkMode: dark,
    background: dark ? p.dark[7] : p.white,
    fontFamily: p.fontFamily,
    fontSize: "14px",
    primaryColor: surface,
    primaryTextColor: text,
    primaryBorderColor: accent,
    secondaryColor: surface,
    tertiaryColor: surface,
    nodeBorder: accent,
    nodeTextColor: text,
    mainBkg: surface,
    textColor: text,
    titleColor: dark ? p.dark[1] : p.gray[7],
    lineColor: line,
    defaultLinkColor: line,
    clusterBkg: dark ? p.dark[8] : p.gray[0],
    clusterBorder: dark ? p.dark[4] : p.gray[3],
    edgeLabelBackground: dark ? p.dark[7] : p.white,
    // Ombre portée des nœuds (gris fixe de mermaid) : elle bave sur fond
    // sombre et alourdit le trait en clair. Les cartes de Studio n'en ont pas.
    dropShadow: "none",
  };
}

/** Jeton qui remplace l'id du schéma dans un patron de feuille. */
const ID_TOKEN = "__nf_mermaid_id__";

/**
 * Patron d'une feuille mermaid : l'id du schéma remplacé par un jeton.
 *
 * Mermaid MESURE ses libellés dans un rendu interne dont le `<style>` est
 * bloqué lui aussi : sans feuille à ce moment-là, le dessin sort écrasé (boîtes
 * étroites, texte minuscule). Pour un thème donné, la feuille ne varie que par
 * l'id du schéma : le patron permet d'adopter AVANT le rendu celle du schéma
 * suivant.
 *
 * @param css - feuille rendue par mermaid pour le schéma `id`.
 * @param id - id passé à `mermaid.render`.
 * @returns la feuille, l'id remplacé par le jeton.
 */
export function toStyleTemplate(css: string, id: string): string {
  return css.replaceAll(id, ID_TOKEN);
}

/**
 * Feuille d'un schéma tirée d'un patron (`toStyleTemplate`).
 *
 * @param template - patron de la feuille.
 * @param id - id du schéma à rendre.
 * @returns la feuille, prête à être adoptée avant `mermaid.render(id, …)`.
 */
export function fromStyleTemplate(template: string, id: string): string {
  return template.replaceAll(ID_TOKEN, id);
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
