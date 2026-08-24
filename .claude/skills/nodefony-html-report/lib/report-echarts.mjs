/**
 * **Adaptateurs** — les fonctions de `report.mjs`, rendues par ECharts.
 *
 * ## Pourquoi passer par des adaptateurs plutôt que réécrire les appels
 *
 * Les deux pages publiées portent vingt-trois figures, chacune avec ses données,
 * ses unités, ses couleurs d'accent et ses libellés. Les réécrire une par une,
 * c'est vingt-trois occasions d'intervertir deux séries ou de perdre une note —
 * des erreurs qu'aucun test ne rattraperait, parce que le résultat reste une
 * figure plausible. Ici, la SIGNATURE est identique à celle de `report.mjs` :
 * migrer une page revient à changer une ligne d'import, et le contenu des
 * appels n'est pas touché.
 *
 * ```js
 * // avant
 * import { barChart, lineChart, donut, gauge } from "…/lib/report.mjs";
 * // après — mêmes appels, rendus par ECharts, clair ET sombre
 * import { barChart, lineChart, donut, gauge } from "…/lib/report-echarts.mjs";
 * ```
 *
 * Chaque adaptateur rend **les deux thèmes** enveloppés par `figure()` : la page
 * doit donc inclure `STYLE_GRAPHES` une fois (voir `echarts.mjs`).
 *
 * ## Ce que les adaptateurs ne rendent pas identique, à dessein
 *
 * - Les figures maison **tronquaient** un libellé trop long ; ici il est placé
 *   par le mécanisme d'« outer bounds » d'ECharts, donc lisible en entier.
 * - Les barres maison partaient toujours de zéro sans le dire ; `echelle()`
 *   l'impose désormais **explicitement** pour les barres, et l'interdit pour les
 *   nuages et les boîtes.
 * - La hauteur n'est plus fixe : elle suit le nombre de catégories.
 */
import {
  bars,
  lines,
  pie,
  gauge as jauge,
  couple,
  figure,
} from "./echarts.mjs";

/**
 * Barres horizontales — signature de `report.mjs`.
 *
 * @param {Array<{label: string, value: number, color?: string, note?: string}>} rows
 * @param {{unit?: string, width?: number, title?: string, desc?: string, logScale?: boolean}} o
 * @returns {string} fragment HTML (les deux thèmes).
 */
export const barChart = (rows, o = {}) => {
  const { unit = "", width = 640, title = "", desc = "" } = o;
  const svgs = couple(bars, {
    titre: title || undefined,
    sousTitre: desc || undefined,
    axeValeur: unit,
    largeur: width,
    horizontal: true,
    decimales: rows.some((r) => !Number.isInteger(r.value)),
    series: [
      {
        nom: title || "valeur",
        data: rows.map((r) => [r.label, r.value]),
        couleurs: rows.map((r) => r.color),
      },
    ],
  });
  // Les notes par ligne du rendu maison n'ont pas d'équivalent ici : ECharts
  // écrit la VALEUR au bout de la barre, ce qui couvrait leur usage réel.
  return figure(svgs, {});
};

/**
 * Courbes — signature de `report.mjs`.
 *
 * @param {Array<{label: string, color?: string, points: Array<{x: number, y: number}>}>} seriesList
 * @param {{width?: number, height?: number, xLabel?: string, yLabel?: string, title?: string, desc?: string}} o
 * @returns {string} fragment HTML.
 */
export const lineChart = (seriesList, o = {}) => {
  const {
    width = 640,
    height = 260,
    xLabel = "",
    yLabel = "",
    title = "",
    desc = "",
  } = o;
  const svgs = couple(lines, {
    titre: title || undefined,
    sousTitre: desc || undefined,
    axeX: xLabel,
    axeY: yLabel,
    largeur: width,
    hauteur: Math.max(240, height),
    series: seriesList.map((s) => ({
      nom: s.label,
      couleur: s.color,
      points: s.points.map((p) => [p.x, p.y]),
    })),
  });
  return figure(svgs, {});
};

/**
 * Anneau — signature de `report.mjs`.
 *
 * @param {Array<{label: string, value: number, color?: string}>} parts
 * @param {{size?: number, title?: string, desc?: string}} o
 * @returns {string} fragment HTML.
 */
export const donut = (parts, o = {}) => {
  const svgs = couple(pie, {
    titre: o.title || undefined,
    sousTitre: o.desc || undefined,
    largeur: Math.max(420, (o.size ?? 150) * 2.6),
    hauteur: 300,
    anneau: true,
    parts: parts.map((p) => ({
      nom: p.label,
      valeur: p.value,
      couleur: p.color,
    })),
  });
  return figure(svgs, {});
};

/**
 * Jauge — signature de `report.mjs` : un RATIO de 0 à 1.
 *
 * Les seuils gardent leur sens d'origine : au-delà de `warn` on s'inquiète,
 * au-delà de `danger` c'est rouge.
 *
 * @param {number} ratio
 * @param {{label?: string, width?: number, danger?: number, warn?: number}} o
 * @returns {string} fragment HTML.
 */
export const gauge = (ratio, o = {}) => {
  const { label = "", width = 380, danger = 0.85, warn = 0.7 } = o;
  const svgs = couple(jauge, {
    titre: label || undefined,
    largeur: Math.max(320, width),
    hauteur: 260,
    valeur: Math.max(0, Math.min(1, ratio)) * 100,
    min: 0,
    max: 100,
    unite: "%",
    zones: [
      [warn, "#009E73"],
      [danger, "#E69F00"],
      [1, "#D55E00"],
    ],
  });
  return figure(svgs, {});
};
