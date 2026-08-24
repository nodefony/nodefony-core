/**
 * Moteur de graphes **Apache ECharts** rendu CÔTÉ SERVEUR, en SVG statique.
 *
 * ## Pourquoi ce fichier existe à côté de `report.mjs`
 *
 * `report.mjs` dessine ses graphes à la main : quelques familles, tracées en SVG
 * littéral. C'est suffisant pour un banc, et ça le restera pour les figures
 * simples — mais la documentation demande des formes qu'aucun tracé maison ne
 * rendra correctement : flux de Sankey, boîtes à moustaches, radars, cartes de
 * chaleur, arbres pondérés. Les écrire une par une reviendrait à réimplémenter
 * une bibliothèque de graphes.
 *
 * ECharts (Apache-2.0) les rend toutes, et — c'est ce qui décide — depuis la
 * 5.3 il sait le faire **sans navigateur** : `renderToSVGString()` produit du
 * SVG que le lecteur reçoit tel quel. Conséquences, toutes voulues :
 *
 * - **aucun JavaScript n'est servi** — la page reste lisible script désactivé ;
 * - **net à tout zoom et à l'impression** — c'est du vectoriel, pas une image ;
 * - **rien à charger** — pas de bibliothèque de 1 Mo dans chaque page ;
 * - en contrepartie, **aucune interaction** : pas d'infobulle, pas de légende
 *   cliquable. Ce que le graphe doit dire, il doit le dire sans qu'on le touche.
 *
 * ## Ce que ce moteur ajoute à ECharts, et pourquoi il faut un moteur
 *
 * Les réglages par défaut d'ECharts produisent des figures correctes et
 * **fautives sur les détails qui se voient** — mesuré sur une première épreuve :
 * nom d'axe tronqué à deux lettres, étiquettes de points superposées, légende
 * mordant sur l'axe, graduations de jauge par-dessus le sous-titre, et un point
 * décimal anglais sur une page française. Corriger cela à chaque appel serait
 * garantir qu'on l'oublie une fois sur deux. Ici c'est le moteur qui le porte :
 *
 * - le **thème** (palette sûre pour les daltoniens, polices, axes discrets) ;
 * - les **formats français** — virgule décimale, séparateur de milliers ;
 * - les **marges calculées** d'après ce que la figure contient réellement
 *   (titre, sous-titre, nom d'axe, légende sur une ou deux lignes) ;
 * - l'**anti-chevauchement** partout où ECharts l'offre ;
 * - le **couple clair/sombre** : deux SVG rendus, l'un ou l'autre affiché par
 *   CSS — un SVG porte ses couleurs en dur, il ne peut pas suivre un thème ;
 * - l'**accessibilité** : chaque figure porte un titre et une description.
 *
 * ## Usage
 *
 * ```js
 * import { bars, sankey, figure } from "./echarts.mjs";
 *
 * const svg = bars({
 *   titre: "Débit médian par camp",
 *   sousTitre: "req/s — médiane de 3 runs",
 *   axeValeur: "req/s",
 *   series: [{ nom: "débit", data: [["Nodefony", 12226], ["Express", 13333]] }],
 *   horizontal: true,
 * });
 * page += figure(svg, { titre: "Débit", desc: "…" });
 * ```
 *
 * Chaque famille rend une **chaîne SVG complète**. `figure()` l'enveloppe pour
 * une page (débordement maîtrisé, couple clair/sombre, légende accessible).
 */
import { createRequire } from "node:module";

/**
 * ECharts est une dépendance de **développement du dépôt**, pas du framework :
 * aucun paquet publié ne l'importe, elle ne pèse donc rien pour qui installe
 * Nodefony. Elle est chargée par `createRequire` plutôt que par un `import`
 * statique pour une seule raison : un `import` manquant fait échouer le module
 * ENTIER à son chargement, sur un « ERR_MODULE_NOT_FOUND » qui ne dit pas quoi
 * faire. Ici l'absence s'annonce avec la commande à taper — même doctrine que
 * Playwright dans `nodefony-browser`, et que `mmdc` dans le rendu de la doc.
 */
const echarts = (() => {
  try {
    return createRequire(import.meta.url)("echarts");
  } catch {
    return null;
  }
})();

/** Lève un message ACTIONNABLE plutôt qu'une erreur de résolution de module. */
function exigeEcharts() {
  if (!echarts)
    throw new Error(
      "Le moteur de graphes exige Apache ECharts, absent de cette installation.\n" +
        "  npm i -D echarts       (dans nodefony-core)\n" +
        "Aucun paquet publié n'en dépend : c'est un outil de build de rapports.",
    );
  return echarts;
}

/* ───────────────────────────── 1. La charte ────────────────────────────── */

/**
 * Palette sûre pour les daltonismes (Okabe–Ito), identique à celle de
 * `report.mjs` — deux fichiers, une seule identité visuelle.
 */
export const PALETTE = [
  "#0072B2",
  "#D55E00",
  "#009E73",
  "#CC79A7",
  "#E69F00",
  "#56B4E9",
  "#8a9099",
];

const POLICE =
  "ui-sans-serif, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** Les deux thèmes. Un SVG fige ses couleurs : il en faut un par thème. */
const THEMES = {
  clair: {
    encre: "#1a1d21",
    muet: "#6b7280",
    trait: "#e5e7eb",
    fond: "#ffffff",
    fondDoux: "#f7f8fa",
    neutre: "#c9ced6",
  },
  sombre: {
    encre: "#e8eaed",
    muet: "#9aa3ad",
    trait: "#343a42",
    fond: "#15181c",
    fondDoux: "#1c2027",
    neutre: "#4a5158",
  },
};

/* ─────────────────────── 2. Les formats, en français ───────────────────── */

const NF = new Intl.NumberFormat("fr-FR");
const NF2 = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
});

/**
 * Nombre à la française — virgule décimale, milliers séparés.
 *
 * 🔴 Le défaut par défaut d'ECharts est le point décimal : sur une page en
 * français, « -0.04 Mo/h » est une faute qui se voit, et elle se répète sur
 * chaque étiquette de chaque figure. Le moteur formate, l'appelant n'y pense
 * plus.
 *
 * @param {number} v - la valeur.
 * @param {boolean} [decimales] - garder une ou deux décimales.
 * @returns {string}
 */
export const nombre = (v, decimales = false) =>
  !Number.isFinite(v)
    ? "—"
    : decimales
      ? NF2.format(v)
      : NF.format(Math.round(v));

/** Fabrique un formateur d'axe qui suffixe une unité. */
const unite =
  (u, dec = false) =>
  (v) =>
    u ? `${nombre(v, dec)} ${u}` : nombre(v, dec);

/* ───────────────── 3. Le rendu : thème, marges, accessibilité ───────────── */

const echappe = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * Place calculée pour le titre, le sous-titre et la légende.
 *
 * Sans ce calcul, une légende de dix entrées se replie sur deux lignes et
 * recouvre l'axe — constaté, et invisible tant qu'on ne regarde pas la figure.
 *
 * @param {{titre?: string, sousTitre?: string, legende?: string[], largeur: number}} o
 * @returns {{haut: number, bas: number}} marges en pixels.
 */
const marges = ({ titre, sousTitre, legende, largeur, axeX, axeY }) => {
  // 🔴 Le nom d'un axe occupe de la place que la grille ne réserve PAS : sans
  // ces deux termes, « ms » se pose sur le sous-titre et « p99 (ms) » sort par
  // le bas de la figure. Constaté sur la première galerie, sur trois figures.
  const haut = (titre ? 24 : 0) + (sousTitre ? 18 : 0) + 14 + (axeY ? 14 : 0);
  const basAxe = axeX ? 22 : 0;
  if (!legende?.length) return { haut, bas: 12 + basAxe };
  // ~7,4 px par caractère + 26 px de pastille et d'espace, replié à la largeur.
  const parLigne = Math.max(
    1,
    Math.floor(
      largeur / (Math.max(...legende.map((l) => l.length)) * 7.4 + 26),
    ),
  );
  const lignes = Math.ceil(legende.length / parLigne);
  return { haut, bas: 10 + lignes * 17 + basAxe };
};

/**
 * Applique le thème et rend le SVG.
 *
 * @param {object} option - l'option ECharts, déjà thématisée par un helper.
 * @param {{largeur?: number, hauteur?: number, theme?: "clair"|"sombre", titre?: string, desc?: string}} o
 * @returns {string} le SVG.
 */
export function rendre(option, o = {}) {
  const { largeur = 640, hauteur = 340, theme = "clair", titre, desc } = o;
  const T = THEMES[theme];
  const chart = exigeEcharts().init(null, null, {
    renderer: "svg",
    ssr: true,
    width: largeur,
    height: hauteur,
  });
  chart.setOption({
    // 🔴 En rendu serveur, une animation devient une animation CSS écrite DANS
    // le SVG : la figure bouge à l'impression et au premier affichage, sans
    // qu'aucun code ne l'ait demandé.
    animation: false,
    backgroundColor: "transparent",
    color: PALETTE,
    textStyle: { fontFamily: POLICE, color: T.encre },
    ...option,
  });
  const svg = chart.renderToSVGString();
  chart.dispose();

  // Accessibilité : un graphe sans énoncé n'existe pas pour un lecteur d'écran.
  const entete =
    `role="img" aria-label="${echappe(titre ?? "graphique")}"` +
    (desc ? ` aria-description="${echappe(desc)}"` : "");
  return svg.replace(/^<svg /, `<svg ${entete} `);
}

/** Le squelette commun : titre, sous-titre, légende, grille, axes. */
function socle({
  titre,
  sousTitre,
  legende,
  largeur,
  hauteur,
  theme,
  axeX,
  axeY,
}) {
  const T = THEMES[theme];
  const m = marges({ titre, sousTitre, legende, largeur, axeX, axeY });
  return {
    T,
    hauteur,
    title: titre
      ? {
          text: titre,
          subtext: sousTitre,
          left: 0,
          top: 0,
          textStyle: {
            fontSize: 14,
            fontWeight: 600,
            color: T.encre,
            fontFamily: POLICE,
          },
          subtextStyle: { fontSize: 12, color: T.muet, fontFamily: POLICE },
        }
      : undefined,
    legend: legende?.length
      ? {
          data: legende,
          bottom: 0,
          type: "scroll",
          itemHeight: 8,
          itemWidth: 14,
          textStyle: { color: T.muet, fontSize: 11, fontFamily: POLICE },
        }
      : undefined,
    grid: {
      left: 10,
      right: 20,
      top: m.haut,
      bottom: m.bas,
      containLabel: true,
    },
    // `sens` décide OÙ le nom se pose : en tête pour un axe vertical (au-dessus
    // des graduations, aligné à gauche), au milieu et bas pour un axe horizontal.
    axe: (nom, extra = {}, sens = "y") => ({
      name: nom,
      nameLocation: sens === "x" ? "middle" : "end",
      nameTextStyle: {
        color: T.muet,
        fontSize: 11,
        align: sens === "x" ? "center" : "left",
        verticalAlign: sens === "x" ? "top" : "bottom",
      },
      nameGap: sens === "x" ? 30 : 12,
      axisLine: { lineStyle: { color: T.trait } },
      axisTick: { show: false },
      // 🔴 `hideOverlap` : sans lui les étiquettes se chevauchent en silence.
      axisLabel: { color: T.muet, fontSize: 11, hideOverlap: true },
      splitLine: { lineStyle: { color: T.trait, type: "dashed" } },
      ...extra,
    }),
  };
}

/**
 * Normalise l'entrée des séries : `[["étiquette", valeur], …]` ou `[valeur, …]`.
 *
 * @param {Array} data
 * @returns {{categories: string[]|null, valeurs: number[]}}
 */
const paires = (data) =>
  Array.isArray(data[0])
    ? {
        categories: data.map((d) => String(d[0])),
        valeurs: data.map((d) => Number(d[1])),
      }
    : { categories: null, valeurs: data.map(Number) };

/* ─────────────────────────── 4. Les familles ───────────────────────────── */

/**
 * Barres — verticales ou horizontales, une ou plusieurs séries, empilables.
 *
 * @param {object} o
 * @param {Array<{nom: string, data: Array, couleur?: string}>} o.series
 * @param {boolean} [o.horizontal] - barres couchées (meilleur pour des noms longs).
 * @param {boolean} [o.empile] - empiler les séries.
 * @param {string} [o.axeValeur] - unité affichée sur l'axe des valeurs.
 * @param {boolean} [o.etiquettes] - écrire la valeur au bout de chaque barre.
 * @returns {string} SVG.
 */
export function bars(o) {
  const {
    series,
    horizontal = false,
    empile = false,
    axeValeur = "",
    etiquettes = true,
    decimales = false,
    largeur = 640,
    hauteur = 340,
    theme = "clair",
    titre,
    sousTitre,
    desc,
  } = o;
  const legende = series.length > 1 ? series.map((s) => s.nom) : undefined;
  const s = socle({
    titre,
    sousTitre,
    legende,
    largeur,
    hauteur,
    theme,
    axeX: horizontal ? axeValeur : undefined,
    axeY: horizontal ? undefined : axeValeur,
  });
  const { categories } = paires(series[0].data);

  const axeCat = s.axe(
    undefined,
    {
      type: "category",
      data: categories,
      splitLine: { show: false },
    },
    horizontal ? "y" : "x",
  );
  const axeVal = s.axe(
    axeValeur,
    {
      type: "value",
      axisLabel: {
        color: s.T.muet,
        fontSize: 11,
        hideOverlap: true,
        formatter: unite("", decimales),
      },
    },
    horizontal ? "x" : "y",
  );

  return rendre(
    {
      title: s.title,
      legend: s.legend,
      grid: s.grid,
      xAxis: horizontal ? axeVal : axeCat,
      yAxis: horizontal ? axeCat : axeVal,
      series: series.map((serie, i) => ({
        name: serie.nom,
        type: "bar",
        stack: empile ? "pile" : undefined,
        data: paires(serie.data).valeurs.map((v, j) => ({
          value: v,
          itemStyle: {
            color:
              serie.couleurs?.[j] ??
              serie.couleur ??
              PALETTE[i % PALETTE.length],
            borderRadius: empile ? 0 : horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0],
          },
        })),
        barMaxWidth: 30,
        label:
          etiquettes && !empile
            ? {
                show: true,
                position: horizontal ? "right" : "top",
                formatter: (p) => nombre(p.value, decimales),
                fontSize: 11,
                color: s.T.encre,
                fontFamily: POLICE,
              }
            : { show: false },
      })),
    },
    { largeur, hauteur, theme, titre, desc },
  );
}

/**
 * Barres avec **étendue** — la médiane, et le min/max des runs qui la fondent.
 *
 * Une barre seule cache la dispersion : deux campagnes de médianes identiques
 * peuvent recouvrir des mesures qui ne se ressemblent pas. La moustache le dit.
 *
 * @param {Array<{label: string, med: number, min: number, max: number}>} o.data
 * @returns {string} SVG.
 */
export function barsEtendue(o) {
  const {
    data,
    axeValeur = "",
    largeur = 640,
    hauteur = 340,
    theme = "clair",
    titre,
    sousTitre,
    desc,
    accent = 0,
  } = o;
  const s = socle({
    titre,
    sousTitre,
    largeur,
    hauteur,
    theme,
    axeX: axeValeur,
  });
  const grille = { ...s.grid, right: 74 };
  return rendre(
    {
      title: s.title,
      grid: grille,
      xAxis: s.axe(
        axeValeur,
        {
          type: "value",
          axisLabel: {
            color: s.T.muet,
            fontSize: 11,
            hideOverlap: true,
            formatter: unite(""),
          },
        },
        "x",
      ),
      yAxis: s.axe(
        undefined,
        {
          type: "category",
          data: data.map((d) => d.label),
          splitLine: { show: false },
        },
        "y",
      ),
      series: [
        {
          type: "bar",
          data: data.map((d, i) => ({
            value: d.med,
            itemStyle: {
              color: i === accent ? PALETTE[0] : s.T.neutre,
              borderRadius: [0, 3, 3, 0],
            },
          })),
          barMaxWidth: 20,
          label: {
            show: true,
            position: "right",
            distance: 14,
            formatter: (p) => nombre(p.value),
            fontSize: 11,
            color: s.T.encre,
            fontFamily: POLICE,
          },
          z: 1,
        },
        {
          type: "custom",
          // La moustache se dessine par-dessus la barre, jamais sous l'étiquette.
          renderItem: (params, api) => {
            const i = api.value(0);
            const d = data[i];
            const y = api.coord([0, i])[1];
            const lo = api.coord([d.min, i])[0];
            const hi = api.coord([d.max, i])[0];
            const style = { stroke: THEMES[theme].encre, lineWidth: 1 };
            return {
              type: "group",
              children: [
                {
                  type: "line",
                  shape: { x1: lo, y1: y, x2: hi, y2: y },
                  style,
                },
                {
                  type: "line",
                  shape: { x1: lo, y1: y - 4, x2: lo, y2: y + 4 },
                  style,
                },
                {
                  type: "line",
                  shape: { x1: hi, y1: y - 4, x2: hi, y2: y + 4 },
                  style,
                },
              ],
            };
          },
          data: data.map((_, i) => [i]),
          z: 3,
        },
      ],
    },
    { largeur, hauteur, theme, titre, desc },
  );
}

/**
 * Courbes — évolution, comparaison de tendances, échelle logarithmique possible.
 *
 * @param {Array<{nom: string, points: Array<[number|string, number]>, couleur?: string, pointille?: boolean}>} o.series
 * @returns {string} SVG.
 */
export function lines(o) {
  const {
    series,
    axeX = "",
    axeY = "",
    log = false,
    aire = false,
    lisse = true,
    largeur = 640,
    hauteur = 340,
    theme = "clair",
    titre,
    sousTitre,
    desc,
  } = o;
  const legende = series.length > 1 ? series.map((s) => s.nom) : undefined;
  const s = socle({
    titre,
    sousTitre,
    legende,
    largeur,
    hauteur,
    theme,
    axeX,
    axeY,
  });
  const categoriel = typeof series[0].points[0][0] === "string";
  return rendre(
    {
      title: s.title,
      legend: s.legend,
      grid: s.grid,
      xAxis: s.axe(
        axeX,
        {
          type: categoriel ? "category" : "value",
          boundaryGap: categoriel,
          data: categoriel ? series[0].points.map((p) => p[0]) : undefined,
          axisLabel: {
            color: s.T.muet,
            fontSize: 11,
            hideOverlap: true,
            formatter: categoriel ? undefined : unite(""),
          },
        },
        "x",
      ),
      yAxis: s.axe(
        axeY,
        {
          type: log ? "log" : "value",
          axisLabel: {
            color: s.T.muet,
            fontSize: 11,
            hideOverlap: true,
            formatter: unite(""),
          },
        },
        "y",
      ),
      series: series.map((serie, i) => ({
        name: serie.nom,
        type: "line",
        smooth: lisse,
        symbolSize: 6,
        data: serie.points.map((p) => (categoriel ? p[1] : p)),
        lineStyle: {
          width: 2,
          color: serie.couleur ?? PALETTE[i % PALETTE.length],
          type: serie.pointille ? "dashed" : "solid",
        },
        itemStyle: { color: serie.couleur ?? PALETTE[i % PALETTE.length] },
        areaStyle: aire ? { opacity: 0.12 } : undefined,
      })),
    },
    { largeur, hauteur, theme, titre, desc },
  );
}

/**
 * Nuage de points — deux dimensions à la fois, chaque point nommé.
 *
 * `labelLayout.hideOverlap` est indispensable : sans lui, deux points proches
 * empilent leurs noms et la figure devient illisible précisément là où elle
 * est intéressante.
 *
 * @param {Array<{nom: string, x: number, y: number, accent?: boolean}>} o.points
 * @returns {string} SVG.
 */
export function scatter(o) {
  const {
    points,
    axeX = "",
    axeY = "",
    largeur = 640,
    hauteur = 340,
    theme = "clair",
    titre,
    sousTitre,
    desc,
  } = o;
  const s = socle({ titre, sousTitre, largeur, hauteur, theme, axeX, axeY });
  return rendre(
    {
      title: s.title,
      grid: { ...s.grid, right: 34 },
      xAxis: s.axe(
        axeX,
        {
          type: "value",
          scale: true,
          axisLabel: {
            color: s.T.muet,
            fontSize: 11,
            hideOverlap: true,
            formatter: unite("", true),
          },
        },
        "x",
      ),
      yAxis: s.axe(
        axeY,
        {
          type: "value",
          scale: true,
          axisLabel: {
            color: s.T.muet,
            fontSize: 11,
            hideOverlap: true,
            formatter: unite(""),
          },
        },
        "y",
      ),
      series: [
        {
          type: "scatter",
          symbolSize: 14,
          data: points.map((p) => ({
            value: [p.x, p.y],
            name: p.nom,
            itemStyle: { color: p.accent ? PALETTE[0] : s.T.neutre },
          })),
          label: {
            show: true,
            formatter: (p) => p.data.name,
            position: "top",
            fontSize: 11,
            color: s.T.muet,
            fontFamily: POLICE,
          },
          labelLayout: { hideOverlap: true },
        },
      ],
    },
    { largeur, hauteur, theme, titre, desc },
  );
}

/**
 * Boîtes à moustaches — la distribution, pas seulement le centre.
 *
 * @param {Array<{label: string, valeurs: number[]}>} o.data - au moins 3 valeurs.
 * @returns {string} SVG.
 */
export function boxplot(o) {
  const {
    data,
    axeValeur = "",
    largeur = 640,
    hauteur = 340,
    theme = "clair",
    titre,
    sousTitre,
    desc,
  } = o;
  const s = socle({
    titre,
    sousTitre,
    largeur,
    hauteur,
    theme,
    axeY: axeValeur,
  });
  const quantile = (tri, q) => {
    const i = (tri.length - 1) * q;
    const bas = Math.floor(i);
    return tri[bas] + (tri[Math.ceil(i)] - tri[bas]) * (i - bas);
  };
  return rendre(
    {
      title: s.title,
      grid: { ...s.grid, bottom: s.grid.bottom + 18 },
      xAxis: s.axe(undefined, {
        type: "category",
        data: data.map((d) => d.label),
        splitLine: { show: false },
        axisLabel: {
          color: s.T.muet,
          fontSize: 11,
          hideOverlap: false,
          rotate: 18,
        },
      }),
      yAxis: s.axe(
        axeValeur,
        {
          type: "value",
          scale: true,
          // Décimales seulement quand l'échelle en a besoin : « 18,0 » sur un axe
          // qui va de 0 à 18 est du bruit.
          axisLabel: {
            color: s.T.muet,
            fontSize: 11,
            formatter: unite(
              "",
              Math.max(...data.flatMap((d) => d.valeurs)) < 5,
            ),
          },
        },
        "y",
      ),
      series: [
        {
          type: "boxplot",
          data: data.map((d) => {
            const t = [...d.valeurs].sort((a, b) => a - b);
            return [
              t[0],
              quantile(t, 0.25),
              quantile(t, 0.5),
              quantile(t, 0.75),
              t[t.length - 1],
            ];
          }),
          itemStyle: {
            color: theme === "sombre" ? "#1e2833" : "#eaf2f8",
            borderColor: PALETTE[0],
            borderWidth: 1.4,
          },
          boxWidth: [12, 36],
        },
      ],
    },
    { largeur, hauteur, theme, titre, desc },
  );
}

/**
 * Camembert ou anneau — une composition, quand les parts sont peu nombreuses.
 *
 * @param {Array<{nom: string, valeur: number, couleur?: string}>} o.parts
 * @param {boolean} [o.anneau] - laisser le centre vide (plus lisible).
 * @returns {string} SVG.
 */
export function pie(o) {
  const {
    parts,
    anneau = true,
    largeur = 640,
    hauteur = 340,
    theme = "clair",
    titre,
    sousTitre,
    desc,
  } = o;
  const s = socle({ titre, sousTitre, largeur, hauteur, theme });
  const total = parts.reduce((a, p) => a + p.valeur, 0);
  return rendre(
    {
      title: s.title,
      series: [
        {
          type: "pie",
          radius: anneau ? ["42%", "68%"] : "68%",
          center: ["38%", "56%"],
          data: parts.map((p, i) => ({
            name: p.nom,
            value: p.valeur,
            itemStyle: { color: p.couleur ?? PALETTE[i % PALETTE.length] },
          })),
          label: {
            formatter: (p) =>
              `${p.name}\n${nombre((p.value / total) * 100, true)} %`,
            fontSize: 11,
            color: s.T.muet,
            fontFamily: POLICE,
          },
          labelLine: {
            length: 8,
            length2: 10,
            lineStyle: { color: s.T.trait },
          },
          labelLayout: { hideOverlap: true },
          itemStyle: { borderColor: s.T.fond, borderWidth: 1.5 },
        },
      ],
    },
    { largeur, hauteur, theme, titre, desc },
  );
}

/**
 * Jauge — une valeur unique qui doit se lire en une seconde.
 *
 * @param {number} o.valeur
 * @param {Array<[number, string]>} [o.zones] - bornes normalisées et couleurs.
 * @returns {string} SVG.
 */
export function gauge(o) {
  const {
    valeur,
    min = 0,
    max = 100,
    unite: u = "",
    zones = [
      [0.5, "#009E73"],
      [0.75, "#E69F00"],
      [1, "#D55E00"],
    ],
    largeur = 640,
    hauteur = 340,
    theme = "clair",
    titre,
    sousTitre,
    desc,
  } = o;
  const s = socle({ titre, sousTitre, largeur, hauteur, theme });
  return rendre(
    {
      title: s.title,
      series: [
        {
          type: "gauge",
          min,
          max,
          radius: "76%",
          // 🔴 Descendu sous le titre : au centre, les graduations passent
          // par-dessus le sous-titre — vu sur la première épreuve.
          center: ["50%", "74%"],
          startAngle: 200,
          endAngle: -20,
          axisLine: { lineStyle: { width: 14, color: zones } },
          progress: { show: false },
          pointer: { width: 4, itemStyle: { color: s.T.encre } },
          axisLabel: {
            color: s.T.muet,
            fontSize: 10,
            distance: -42,
            formatter: (v) => nombre(v, true),
          },
          axisTick: { show: false },
          splitLine: {
            distance: -14,
            length: 12,
            lineStyle: { color: s.T.fond, width: 2 },
          },
          detail: {
            formatter: () => `${nombre(valeur, true)}${u ? ` ${u}` : ""}`,
            fontSize: 20,
            color: s.T.encre,
            fontFamily: POLICE,
            offsetCenter: [0, "34%"],
          },
          data: [{ value: valeur }],
        },
      ],
    },
    { largeur, hauteur, theme, titre, desc },
  );
}

/**
 * Radar — plusieurs critères comparés d'un seul regard.
 *
 * @param {Array<{nom: string, max?: number}>} o.axes
 * @param {Array<{nom: string, valeurs: number[]}>} o.series
 * @returns {string} SVG.
 */
export function radar(o) {
  const {
    axes,
    series,
    largeur = 640,
    hauteur = 360,
    theme = "clair",
    titre,
    sousTitre,
    desc,
  } = o;
  const legende = series.map((x) => x.nom);
  const s = socle({ titre, sousTitre, legende, largeur, hauteur, theme });
  return rendre(
    {
      title: s.title,
      legend: s.legend,
      radar: {
        indicator: axes.map((a) => ({ name: a.nom, max: a.max ?? 1 })),
        radius: "58%",
        center: ["50%", "54%"],
        axisName: { color: s.T.muet, fontSize: 11, fontFamily: POLICE },
        splitLine: { lineStyle: { color: s.T.trait } },
        splitArea: { areaStyle: { color: [s.T.fond, s.T.fondDoux] } },
        axisLine: { lineStyle: { color: s.T.trait } },
      },
      series: [
        {
          type: "radar",
          data: series.map((x, i) => ({
            name: x.nom,
            value: x.valeurs,
            areaStyle: { opacity: i === 0 ? 0.18 : 0.08 },
            lineStyle: { width: i === 0 ? 2 : 1.4 },
          })),
        },
      ],
    },
    { largeur, hauteur, theme, titre, desc },
  );
}

/**
 * Sankey — un flux qui se répartit. La forme qui raconte un pipeline.
 *
 * @param {Array<{nom: string, couleur?: string}>} o.noeuds
 * @param {Array<{de: string, vers: string, valeur: number}>} o.liens
 * @returns {string} SVG.
 */
export function sankey(o) {
  const {
    noeuds,
    liens,
    largeur = 640,
    hauteur = 380,
    theme = "clair",
    titre,
    sousTitre,
    desc,
  } = o;
  const s = socle({ titre, sousTitre, largeur, hauteur, theme });
  // La réserve de droite se calcule sur le PLUS LONG libellé : sans elle,
  // « Analyse HTTP entrante » se coupe à « Analyse HTTP entrar ».
  const plusLong = Math.max(...noeuds.map((n) => n.nom.length));
  return rendre(
    {
      title: s.title,
      series: [
        {
          type: "sankey",
          left: 4,
          right: Math.min(220, plusLong * 6.6 + 14),
          top: s.grid.top,
          bottom: 10,
          nodeGap: 9,
          nodeWidth: 13,
          data: noeuds.map((n, i) => ({
            name: n.nom,
            itemStyle: { color: n.couleur ?? PALETTE[i % PALETTE.length] },
          })),
          links: liens.map((l) => ({
            source: l.de,
            target: l.vers,
            value: l.valeur,
          })),
          label: { fontSize: 11, color: s.T.encre, fontFamily: POLICE },
          lineStyle: { color: "gradient", opacity: 0.34 },
          emphasis: { disabled: true },
        },
      ],
    },
    { largeur, hauteur, theme, titre, desc },
  );
}

/**
 * Carte de chaleur — une grandeur sur deux axes discrets.
 *
 * @param {string[]} o.x - libellés de colonnes.
 * @param {string[]} o.y - libellés de lignes.
 * @param {Array<[number, number, number]>} o.cellules - [colonne, ligne, valeur].
 * @returns {string} SVG.
 */
export function heatmap(o) {
  const {
    x,
    y,
    cellules,
    min,
    max,
    largeur = 640,
    hauteur = 340,
    theme = "clair",
    titre,
    sousTitre,
    desc,
  } = o;
  const s = socle({ titre, sousTitre, largeur, hauteur, theme });
  const vals = cellules.map((c) => c[2]);
  return rendre(
    {
      title: s.title,
      grid: { ...s.grid, right: 24 },
      xAxis: s.axe(undefined, {
        type: "category",
        data: x,
        splitArea: { show: true },
        splitLine: { show: false },
      }),
      yAxis: s.axe(undefined, {
        type: "category",
        data: y,
        splitArea: { show: true },
        splitLine: { show: false },
      }),
      visualMap: {
        min: min ?? Math.min(...vals),
        max: max ?? Math.max(...vals),
        // 🔴 MASQUÉE À DESSEIN. La barre de valeurs se rend de travers en SSR
        // horizontal (elle traverse le graphe), et chaque cellule porte déjà
        // son nombre : l'échelle visible coûtait une figure abîmée pour une
        // information déjà écrite. L'échelle de couleurs, elle, reste active.
        show: false,
        inRange: { color: ["#eaf2f8", PALETTE[0], "#003b5e"] },
      },
      series: [
        {
          type: "heatmap",
          data: cellules,
          label: {
            show: true,
            fontSize: 10,
            color: s.T.encre,
            fontFamily: POLICE,
            formatter: (p) => nombre(p.value[2], true),
          },
          itemStyle: { borderColor: s.T.fond, borderWidth: 1 },
        },
      ],
    },
    { largeur, hauteur, theme, titre, desc },
  );
}

/**
 * Arbre pondéré (treemap) — une hiérarchie dont la surface porte la valeur.
 *
 * @param {Array<{nom: string, valeur?: number, enfants?: Array}>} o.racine
 * @returns {string} SVG.
 */
export function treemap(o) {
  const {
    racine,
    largeur = 640,
    hauteur = 360,
    theme = "clair",
    titre,
    sousTitre,
    desc,
  } = o;
  const s = socle({ titre, sousTitre, largeur, hauteur, theme });
  const conv = (n, i = 0) => ({
    name: n.nom,
    value: n.valeur,
    itemStyle: n.couleur
      ? { color: n.couleur }
      : { color: PALETTE[i % PALETTE.length] },
    children: n.enfants?.map((e, j) => conv(e, j)),
  });
  return rendre(
    {
      title: s.title,
      series: [
        {
          type: "treemap",
          top: s.grid.top,
          left: 4,
          right: 4,
          bottom: 6,
          roam: false,
          nodeClick: false,
          breadcrumb: { show: false },
          data: racine.map((n, i) => conv(n, i)),
          label: {
            fontSize: 11,
            color: "#fff",
            fontFamily: POLICE,
            formatter: (p) => `${p.name}\n${nombre(p.value, true)}`,
          },
          upperLabel: {
            show: true,
            height: 18,
            color: s.T.encre,
            fontSize: 11,
          },
          itemStyle: { borderColor: s.T.fond, borderWidth: 2, gapWidth: 2 },
          levels: [
            { itemStyle: { gapWidth: 3 } },
            { colorSaturation: [0.35, 0.6] },
          ],
        },
      ],
    },
    { largeur, hauteur, theme, titre, desc },
  );
}

/**
 * Graphe de relations — qui dépend de qui, disposé automatiquement.
 *
 * @param {Array<{nom: string, groupe?: string, taille?: number}>} o.noeuds
 * @param {Array<{de: string, vers: string}>} o.liens
 * @returns {string} SVG.
 */
export function reseau(o) {
  const {
    noeuds,
    liens,
    largeur = 640,
    hauteur = 400,
    theme = "clair",
    titre,
    sousTitre,
    desc,
  } = o;
  const s = socle({ titre, sousTitre, largeur, hauteur, theme });
  const groupes = [...new Set(noeuds.map((n) => n.groupe).filter(Boolean))];
  return rendre(
    {
      title: s.title,
      series: [
        {
          type: "graph",
          // 🔴 `force` ne CONVERGE pas en rendu serveur : la disposition est
          // calculée par itérations pilotées par l'animation, qui est coupée.
          // Le cercle est déterministe, donc reproductible d'un rendu à l'autre.
          layout: "circular",
          circular: { rotateLabel: false },
          top: s.grid.top,
          roam: false,
          data: noeuds.map((n) => ({
            name: n.nom,
            symbolSize: n.taille ?? 26,
            category: n.groupe ? groupes.indexOf(n.groupe) : 0,
            itemStyle: {
              color:
                PALETTE[
                  (n.groupe ? groupes.indexOf(n.groupe) : 0) % PALETTE.length
                ],
            },
          })),
          categories: groupes.map((g) => ({ name: g })),
          links: liens.map((l) => ({ source: l.de, target: l.vers })),
          lineStyle: { color: s.T.trait, width: 1.2, curveness: 0.08 },
          label: {
            show: true,
            position: "right",
            fontSize: 11,
            color: s.T.encre,
            fontFamily: POLICE,
          },
          labelLayout: { hideOverlap: true },
          emphasis: { disabled: true },
        },
      ],
    },
    { largeur, hauteur, theme, titre, desc },
  );
}

/**
 * Entonnoir — des étapes qui perdent du monde à chaque passage.
 *
 * @param {Array<{nom: string, valeur: number}>} o.etapes
 * @returns {string} SVG.
 */
export function funnel(o) {
  const {
    etapes,
    largeur = 640,
    hauteur = 340,
    theme = "clair",
    titre,
    sousTitre,
    desc,
  } = o;
  const s = socle({ titre, sousTitre, largeur, hauteur, theme });
  return rendre(
    {
      title: s.title,
      series: [
        {
          type: "funnel",
          top: s.grid.top,
          bottom: 10,
          left: "12%",
          right: "12%",
          minSize: "24%",
          gap: 2,
          data: etapes.map((e, i) => ({
            name: e.nom,
            value: e.valeur,
            itemStyle: {
              color: PALETTE[i % PALETTE.length],
              borderColor: s.T.fond,
              borderWidth: 1.5,
            },
          })),
          label: {
            position: "inside",
            formatter: (p) => `${p.name} — ${nombre(p.value)}`,
            fontSize: 11,
            color: "#fff",
            fontFamily: POLICE,
          },
        },
      ],
    },
    { largeur, hauteur, theme, titre, desc },
  );
}

/**
 * Cascade — la décomposition d'un écart, poste par poste.
 *
 * ECharts n'a pas de type « waterfall » : il se compose d'une pile invisible et
 * d'une pile visible. Le moteur le fait, l'appelant donne juste des deltas.
 *
 * @param {Array<{nom: string, delta: number}>} o.postes
 * @param {number} [o.depart]
 * @returns {string} SVG.
 */
export function cascade(o) {
  const {
    postes,
    depart = 0,
    axeValeur = "",
    largeur = 640,
    hauteur = 340,
    theme = "clair",
    titre,
    sousTitre,
    desc,
  } = o;
  const s = socle({
    titre,
    sousTitre,
    largeur,
    hauteur,
    theme,
    axeY: axeValeur,
  });
  const socles = [];
  const hauts = [];
  let courant = depart;
  for (const p of postes) {
    socles.push(p.delta >= 0 ? courant : courant + p.delta);
    hauts.push(Math.abs(p.delta));
    courant += p.delta;
  }
  return rendre(
    {
      title: s.title,
      grid: { ...s.grid, bottom: s.grid.bottom + 18 },
      xAxis: s.axe(undefined, {
        type: "category",
        data: postes.map((p) => p.nom),
        splitLine: { show: false },
        axisLabel: {
          color: s.T.muet,
          fontSize: 11,
          rotate: 18,
          hideOverlap: false,
        },
      }),
      yAxis: s.axe(axeValeur, {
        type: "value",
        axisLabel: {
          color: s.T.muet,
          fontSize: 11,
          formatter: unite("", true),
        },
      }),
      series: [
        {
          type: "bar",
          stack: "c",
          data: socles,
          itemStyle: { color: "transparent" },
          silent: true,
        },
        {
          type: "bar",
          stack: "c",
          data: hauts.map((h, i) => ({
            value: h,
            itemStyle: {
              color: postes[i].delta >= 0 ? PALETTE[2] : PALETTE[1],
            },
          })),
          barMaxWidth: 34,
          label: {
            show: true,
            position: "top",
            formatter: (p) =>
              `${postes[p.dataIndex].delta >= 0 ? "+" : "−"}${nombre(p.value, true)}`,
            fontSize: 11,
            color: s.T.encre,
            fontFamily: POLICE,
          },
        },
      ],
    },
    { largeur, hauteur, theme, titre, desc },
  );
}

/* ──────────────── 5. L'enveloppe de page : clair ET sombre ─────────────── */

/**
 * Enveloppe une figure pour une page : le couple clair/sombre, le débordement
 * maîtrisé, la légende accessible.
 *
 * 🔴 **Un SVG rendu au serveur porte ses couleurs en dur** — il ne peut pas
 * suivre le thème du lecteur. D'où deux rendus et un basculement par CSS. C'est
 * la seule façon d'avoir un graphe correct dans les deux thèmes sans JavaScript.
 *
 * @param {{clair: string, sombre: string}} svgs
 * @param {{titre?: string, desc?: string}} o
 * @returns {string} le fragment HTML.
 */
export function figure(svgs, o = {}) {
  const { titre, desc } = o;
  return (
    `<figure class="graphe">` +
    (titre ? `<figcaption>${echappe(titre)}</figcaption>` : "") +
    `<div class="graphe-zone"><div class="g-clair">${svgs.clair}</div>` +
    `<div class="g-sombre">${svgs.sombre}</div></div>` +
    (desc ? `<p class="graphe-desc">${echappe(desc)}</p>` : "") +
    `</figure>`
  );
}

/**
 * Rend une figure dans les DEUX thèmes en un appel.
 *
 * @param {Function} famille - une des familles ci-dessus.
 * @param {object} o - ses options (sans `theme`).
 * @returns {{clair: string, sombre: string}}
 */
export const couple = (famille, o) => ({
  clair: famille({ ...o, theme: "clair" }),
  sombre: famille({ ...o, theme: "sombre" }),
});

/** Le style que `figure()` attend — à insérer une fois dans la page. */
export const STYLE_GRAPHES = `
.graphe{margin:0 0 18px;padding:0}
.graphe figcaption{font-size:13px;font-weight:600;margin:0 0 6px}
.graphe-desc{font-size:12px;color:var(--muted,#6b7280);margin:6px 0 0}
.graphe-zone{overflow-x:auto}
.graphe-zone svg{display:block;margin:0 auto;max-width:100%;height:auto}
.g-sombre{display:none}
@media (prefers-color-scheme:dark){
  :root:not([data-theme="light"]) .g-clair{display:none}
  :root:not([data-theme="light"]) .g-sombre{display:block}
}
[data-theme="dark"] .g-clair{display:none}
[data-theme="dark"] .g-sombre{display:block}
[data-theme="light"] .g-clair{display:block}
[data-theme="light"] .g-sombre{display:none}
`;
