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

export const POLICE =
  "ui-sans-serif, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** Les deux thèmes. Un SVG fige ses couleurs : il en faut un par thème. */
export const THEMES = {
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

/**
 * Formateur d'axe dont les DÉCIMALES sont décidées par les données.
 *
 * « 20,0 tours » et « 1,0 » sur une carte binaire sont des décimales qui
 * n'apportent rien et que l'œil doit écarter à chaque graduation. À l'inverse,
 * arrondir une latence de 9,57 ms à « 10 » détruit la mesure. La règle est donc
 * la donnée : des valeurs entières s'écrivent entières.
 *
 * @param {number[]} valeurs - les valeurs portées par l'axe.
 * @param {string} [u] - unité suffixée.
 * @returns {(v: number) => string}
 */
const formateur = (valeurs, u = "") => {
  const finies = valeurs.filter((v) => Number.isFinite(v));
  const entier = finies.length > 0 && finies.every((v) => Number.isInteger(v));
  return unite(u, !entier);
};

/* ──────────────────────── 2 bis. L'ÉCHELLE ─────────────────────────────── */

/**
 * Décide l'échelle d'un axe de valeurs — la question la plus lourde de
 * conséquences d'une figure, et la seule qu'on ne doit jamais laisser au hasard.
 *
 * 🔴 **Le zéro n'est pas un détail esthétique.** Sur des BARRES, le lecteur
 * compare des LONGUEURS : couper l'axe multiplie visuellement un écart de 3 %
 * jusqu'à le faire passer pour un doublement. Sur un NUAGE ou des BOÎTES, il
 * compare des POSITIONS : imposer le zéro écrase toute la structure dans un coin.
 * D'où deux régimes, choisis par la nature de la figure et non par son auteur.
 *
 * `dataMax` (ECharts 6.1) réserve la place des étiquettes de valeur **sans**
 * casser l'algorithme de graduations « rondes » — ce que `max` ferait.
 * Doc conservée : `references/echarts/axis-common.md`.
 *
 * @param {number[]} valeurs - les valeurs portées par l'axe.
 * @param {{compareDesLongueurs?: boolean, placePourEtiquettes?: boolean}} o
 * @returns {object} le fragment d'option d'axe.
 */
export function echelle(valeurs, o = {}) {
  const { compareDesLongueurs = false, placePourEtiquettes = false } = o;
  const finies = valeurs.filter((v) => Number.isFinite(v));
  if (!finies.length) return {};
  const min = Math.min(...finies);
  const max = Math.max(...finies);
  const frag = {};

  // Comparer des longueurs impose le zéro ; comparer des positions l'interdit.
  frag.scale = !compareDesLongueurs;
  // …sauf si les valeurs sont NÉGATIVES : le zéro y est un repère, pas un
  // plancher, et l'axe doit alors couvrir les deux côtés.
  if (compareDesLongueurs && min < 0) frag.scale = false;

  // Des entiers restent des entiers : « 2,5 requêtes » n'existe pas.
  if (finies.every((v) => Number.isInteger(v))) frag.minInterval = 1;

  // De la place au bout des barres pour leur étiquette, sans figer le maximum.
  if (placePourEtiquettes && max > 0) frag.dataMax = max * 1.12;

  // Un axe dont toutes les valeurs sont égales n'a pas d'étendue : ECharts
  // rendrait une graduation unique et une barre pleine largeur. On lui donne
  // un intervalle lisible autour de la valeur — par `dataMin`/`dataMax` quand
  // on réserve la place des étiquettes, pour ne pas FIGER les bornes (`min` et
  // `max` désactivent l'algorithme de graduations rondes ; `dataMin`/`dataMax`
  // le préservent — doc `references/echarts/axis-common.md`).
  if (min === max) {
    const bas = Math.min(0, min * 1.2);
    const haut = max === 0 ? 1 : max * 1.2;
    if (placePourEtiquettes) {
      frag.dataMin = bas;
      frag.dataMax = haut;
    } else {
      frag.min = bas;
      frag.max = haut;
      delete frag.scale;
    }
  }
  return frag;
}

/**
 * Hauteur DÉRIVÉE du contenu — une figure ne se dimensionne pas au jugé.
 *
 * Vingt catégories dans 340 pixels donnent des barres de six pixels et des
 * étiquettes qu'ECharts finit par masquer pour éviter le chevauchement : la
 * figure devient fausse par omission, sans le dire. La hauteur suit donc le
 * nombre de catégories, entre un plancher et un plafond raisonnables.
 *
 * @param {number} nbCategories
 * @param {{haut?: number, bas?: number, parCategorie?: number, min?: number, max?: number}} o
 * @returns {number} hauteur en pixels.
 */
export const hauteurPour = (nbCategories, o = {}) => {
  const { haut = 70, bas = 30, parCategorie = 30, min = 190, max = 900 } = o;
  return Math.max(min, Math.min(max, haut + bas + nbCategories * parCategorie));
};

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
const marges = ({ titre, sousTitre, legende, largeur }) => {
  // 🔴 On ne réserve QUE le titre et la légende. Les étiquettes et les noms
  // d'axes sont placés par le mécanisme d'« outer bounds » d'ECharts 6, activé
  // par défaut — doc conservée dans `references/echarts/grid.md`. Y ajouter des
  // marges à la main revenait à corriger deux fois le même écart, et déplaçait
  // la figure au lieu de la caler.
  const haut = (titre ? 24 : 0) + (sousTitre ? 18 : 0) + 14;
  if (!legende?.length) return { haut, bas: 12 };
  // ~7,4 px par caractère + 26 px de pastille et d'espace, replié à la largeur.
  const parLigne = Math.max(
    1,
    Math.floor(
      largeur / (Math.max(...legende.map((l) => l.length)) * 7.4 + 26),
    ),
  );
  const lignes = Math.ceil(legende.length / parLigne);
  return { haut, bas: 10 + lignes * 17 };
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
    // 🔴 PAS de `containLabel` : déprécié en 6.0, et il équivaut à
    // `outerBoundsContain: 'axisLabel'` — qui EXCLUT les noms d'axes. C'est
    // exactement ce qui faisait déborder « p99 (ms) » hors de la figure, et que
    // des marges à la main ne faisaient que déplacer. Le défaut de la v6
    // (`outerBoundsMode: 'auto'`, `outerBoundsContain: 'all'`) contraint la
    // grille, les étiquettes ET les noms. Doc : `references/echarts/grid.md`.
    grid: { left: 10, right: 20, top: m.haut, bottom: m.bas },
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
    theme = "clair",
    titre,
    sousTitre,
    desc,
  } = o;
  const legende = series.length > 1 ? series.map((s) => s.nom) : undefined;
  const toutes = series.flatMap((x) => paires(x.data).valeurs);
  // La hauteur SUIT le contenu quand les barres sont couchées : vingt
  // catégories dans 340 pixels donnent des barres de six pixels et des
  // étiquettes qu'ECharts masque pour éviter le chevauchement — la figure
  // devient fausse par omission, sans le dire.
  const hauteur =
    o.hauteur ??
    (horizontal
      ? hauteurPour(
          paires(series[0].data).valeurs.length * (empile ? 1 : series.length),
          {
            parCategorie: 26,
            haut: 66 + (legende ? 20 : 0),
          },
        )
      : 340);
  const s = socle({ titre, sousTitre, legende, largeur, hauteur, theme });
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
      // Des barres se comparent par leur LONGUEUR : l'axe garde le zéro, et
      // réserve de quoi écrire la valeur au bout sans figer le maximum.
      ...echelle(toutes, {
        compareDesLongueurs: true,
        placePourEtiquettes: etiquettes && !empile,
      }),
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
          // L'axe doit contenir les MOUSTACHES, pas seulement les médianes :
          // un maximum tronqué couperait la mesure qu'on prétend montrer.
          ...echelle(
            data.flatMap((d) => [d.min, d.med, d.max]),
            { compareDesLongueurs: true, placePourEtiquettes: true },
          ),
          axisLabel: {
            color: s.T.muet,
            fontSize: 11,
            hideOverlap: true,
            formatter: formateur(data.flatMap((d) => [d.min, d.med, d.max])),
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
    axeYDroite = "",
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
  const s = socle({ titre, sousTitre, legende, largeur, hauteur, theme });
  const categoriel = typeof series[0].points[0][0] === "string";
  // Des courbes HÉTÉROGÈNES — des req/s et des millisecondes — ne partagent pas
  // une échelle : la seconde vit sur un axe de droite, qu'une série demande par
  // `droite: true`.
  const aDroite = series.some((x) => x.droite);
  const valeursDe = (cote) =>
    series
      .filter((x) => Boolean(x.droite) === cote)
      .flatMap((x) => x.points.map((pt) => pt[1]));
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
      // 🔴 `alignTicks` (ECharts ≥ 5.3) est OBLIGATOIRE dès qu'il y a deux axes
      // de valeurs : sans lui, chacun choisit ses graduations dans son coin, les
      // deux grilles ne coïncident plus, et le point où les courbes se croisent
      // ne veut plus rien dire. Doc : `references/echarts/y-axis.md`.
      yAxis: [
        s.axe(
          axeY,
          {
            type: log ? "log" : "value",
            alignTicks: aDroite,
            ...(log ? {} : echelle(valeursDe(false))),
            axisLabel: {
              color: s.T.muet,
              fontSize: 11,
              hideOverlap: true,
              formatter: unite(""),
            },
          },
          "y",
        ),
        ...(aDroite
          ? [
              s.axe(
                axeYDroite,
                {
                  type: "value",
                  position: "right",
                  alignTicks: true,
                  ...echelle(valeursDe(true)),
                  axisLabel: {
                    color: s.T.muet,
                    fontSize: 11,
                    hideOverlap: true,
                    formatter: formateur(valeursDe(true)),
                  },
                },
                "y",
              ),
            ]
          : []),
      ],
      series: series.map((serie, i) => ({
        name: serie.nom,
        type: "line",
        smooth: lisse,
        symbolSize: 6,
        yAxisIndex: serie.droite && aDroite ? 1 : 0,
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
          ...echelle(points.map((p) => p.x)),
          axisLabel: {
            color: s.T.muet,
            fontSize: 11,
            hideOverlap: true,
            formatter: formateur(points.map((p) => p.x)),
          },
        },
        "x",
      ),
      yAxis: s.axe(
        axeY,
        {
          type: "value",
          ...echelle(points.map((p) => p.y)),
          axisLabel: {
            color: s.T.muet,
            fontSize: 11,
            hideOverlap: true,
            formatter: formateur(points.map((p) => p.y)),
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
          ...echelle(data.flatMap((d) => d.valeurs)),
          // Décimales seulement quand l'échelle en a besoin : « 18,0 » sur un axe
          // qui va de 0 à 18 est du bruit.
          axisLabel: {
            color: s.T.muet,
            fontSize: 11,
            formatter: formateur(data.flatMap((d) => d.valeurs)),
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
            // Les graduations suivent les BORNES : une jauge de 0 à 100 n'a que
            // faire de « 20,0 ». La valeur centrale, elle, garde ses décimales.
            formatter: formateur([min, max]),
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
            formatter: (p) => formateur(vals)(p.value[2]),
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
          formatter: formateur(postes.map((x) => x.delta)),
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
/* Un SCHÉMA porte une taille intrinsèque et beaucoup de texte : le réduire à la
   colonne rend ses libellés illisibles. Il DÉFILE, comme un tableau large. */
.schema-zone{overflow-x:auto}
.schema-zone svg{display:block;margin:0 auto;max-width:none;height:auto}
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
