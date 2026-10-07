/**
 * Lisibilité des figures mermaid d'une page — ce qu'on ne voit qu'en REGARDANT
 * le rendu, ramené à des règles qu'une machine relit.
 *
 * La console d'administration rend les schémas avec mermaid 11 et les met à
 * l'échelle de la colonne, plafonnés à 60 % de la hauteur d'écran
 * (`MarkdownDoc.tsx`, règle `.nf-mermaid > svg`) ; le site les rend avec
 * `nodefony-html-report/lib/schemas.mjs`. Trois défauts ont été constatés à
 * l'image, et aucun ne se voyait dans la source :
 *
 * - une courbe `xychart-beta` sans couleur déclarée sort en lavande pâle dans
 *   la console : presque invisible sur fond blanc ;
 * - une courbe sans taille déclarée fait 540 px de haut dans la console ;
 * - un organigramme VERTICAL de plus de quatre rangs est réduit pour tenir
 *   dans la hauteur, et son texte devient illisible.
 *
 * Les deux premiers se corrigent en une ligne et ne concernent que les pages
 * neuves : ce sont des ERREURS. Le troisième touche des pages existantes et
 * demande de repenser le schéma : c'est un AVERTISSEMENT, qui nomme le cas sans
 * casser le corpus.
 *
 * @module
 */
import {
  lireMermaid,
  placerEnCouches,
} from "../../nodefony-html-report/lib/schemas.mjs";

/** Au-delà de ce nombre de rangs, un schéma vertical devient illisible dans la console. */
export const MAX_RANGS_VERTICAUX = 4;

/** La directive qui donne couleur ET taille à une courbe, à recopier telle quelle. */
export const DIRECTIVE_COURBE =
  '%%{init: {"xyChart": {"width": 800, "height": 260}, "themeVariables": {"xyChart": {"plotColorPalette": "#0072B2, #D55E00"}}}}%%';

/**
 * Les défauts de lisibilité des figures d'une page.
 *
 * @param {string} src - le markdown de la page.
 * @returns {{erreurs: string[], avertissements: string[]}}
 */
export function defautsDesFigures(src) {
  const erreurs = [];
  const avertissements = [];
  let n = 0;
  for (const m of src.matchAll(/```mermaid\n([\s\S]*?)```/g)) {
    n += 1;
    const bloc = m[1];
    const modele = lireMermaid(bloc);
    if (modele.type === "xy") {
      const titre = modele.titre ? ` « ${modele.titre} »` : "";
      if (!/plotColorPalette/.test(bloc))
        erreurs.push(
          `figure ${n}${titre} : courbe sans couleur déclarée — la console la trace en lavande pâle, presque invisible. Ajouter en tête : ${DIRECTIVE_COURBE}`,
        );
      if (!/"xyChart"\s*:\s*\{[^}]*"height"/.test(bloc))
        erreurs.push(
          `figure ${n}${titre} : courbe sans taille déclarée — 540 px de haut dans la console. Déclarer "xyChart": {"width": 800, "height": 260} dans la directive`,
        );
      continue;
    }
    if (modele.type === "flux" && /^(TB|TD|BT)$/.test(modele.dir)) {
      const rangs =
        Math.max(
          -1,
          ...[...placerEnCouches(modele).values()].map((v) => v.rang),
        ) + 1;
      if (rangs > MAX_RANGS_VERTICAUX)
        avertissements.push(
          `figure ${n} : schéma vertical de ${rangs} rangs — la console le réduit à 60 % de la hauteur d'écran et son texte devient illisible. Passer en \`flowchart LR\`, ou le découper`,
        );
    }
  }
  return { erreurs, avertissements };
}
