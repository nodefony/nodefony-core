/**
 * report.mjs — bibliothèque de rendu de RAPPORTS HTML autonomes.
 *
 * UNE seule implémentation, importée par tous les générateurs de rapport du repo
 * (banc de capacité, audits, revues). Ne recopiez PAS ces fonctions dans un
 * script : importez-les. Deux implémentations d'une même règle = dérive garantie.
 *
 * Ce que produit `doc()` :
 *  - un fichier HTML **autonome** — zéro CDN, zéro dépendance, CSS + JS + SVG
 *    inline. Il survit à un partage de fichiers, une pièce jointe, un artefact de CI.
 *  - **imprimable** : sauts de page maîtrisés, en-têtes de tableau répétés,
 *    titres jamais orphelins, couleurs conservées, contrôles interactifs masqués.
 *  - **lisible dans les deux thèmes** (clair/sombre auto + bascule manuelle).
 *
 * Toutes les fonctions rendent des `string` HTML et sont PURES.
 */

import { NODEFONY_BRAND } from "./brand.mjs";
export { NODEFONY_BRAND } from "./brand.mjs";

/* ── primitives ─────────────────────────────────────────────────────────── */

/** Échappe tout ce qui vient de données. Non négociable : un rapport affiche des entrées non maîtrisées. */
export const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

export const fmt = {
  int: (x) =>
    x == null || Number.isNaN(x) ? "—" : Math.round(x).toLocaleString("fr-FR"),
  // 🔴 Français, comme le reste de la page. Le point décimal anglais était resté
  // ici parce que le TRI relisait le texte affiché : il suffisait d'une virgule
  // pour que « 4,66 » soit lu « 466 » et que la colonne se trie à l'envers. Le
  // tri normalise désormais avant de convertir (voir SORT_JS) ; les deux se
  // corrigent ensemble, jamais l'un sans l'autre.
  dec: (x, n = 1) =>
    x == null || Number.isNaN(x)
      ? "—"
      : x.toLocaleString("fr-FR", {
          minimumFractionDigits: n,
          maximumFractionDigits: n,
        }),
  pct: (x, n = 0) =>
    x == null
      ? "—"
      : `${(x * 100).toLocaleString("fr-FR", { minimumFractionDigits: n, maximumFractionDigits: n })} %`,
  bytes: (b) => {
    if (b == null) return "—";
    const u = ["o", "Ko", "Mo", "Go", "To"];
    let i = 0;
    let v = b;
    while (v >= 1024 && i < u.length - 1) {
      v /= 1024;
      i++;
    }
    const d = v < 10 && i > 0 ? 1 : 0;
    return `${v.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d })} ${u[i]}`;
  },
  ms: (x) => {
    if (x == null) return "—";
    const fr = (v, n) =>
      v.toLocaleString("fr-FR", {
        minimumFractionDigits: n,
        maximumFractionDigits: n,
      });
    return x < 1
      ? `${fr(x, 2)} ms`
      : x < 1000
        ? `${fr(x, 1)} ms`
        : `${fr(x / 1000, 2)} s`;
  },
};

/**
 * Palette **Okabe-Ito réordonnée**, sûre pour les daltonismes.
 *
 * Réordonnée par contraste décroissant sur fond blanc, pour que les premières
 * séries d'un graphe passent le seuil 3:1 exigé par WCAG 1.4.11 (objets
 * graphiques signifiants) : `#0072B2` (5,2:1) → `#D55E00` (3,9) → `#009E73`
 * (3,4) → `#CC79A7` (3,1). Les suivantes descendent sous le seuil et ne sont
 * utilisables **qu'en aplat contouré** (cf `series()`).
 *
 * ⚠️ Vérité contre-intuitive : **aucune palette qualitative de 8 couleurs** ne
 * peut garantir 3:1 entre séries adjacentes (8 paliers espacés de 3:1 sortent du
 * gamut). La conformité ne vient donc PAS du choix des couleurs, mais de la
 * **redondance** (forme + étiquette directe) et du **liseré de fond** entre deux
 * aplats contigus. C'est pour ça que les aplats de cette bibliothèque portent un
 * `stroke` de la couleur de la surface.
 *
 * Test le moins cher : passer la page en `filter: grayscale(1)`. Si elle reste
 * lisible, elle l'est pour tous — et elle s'imprimera en noir et blanc.
 */
export const COLORS = {
  accent: "#0072B2", // bleu — 5,2:1 sur blanc
  blue: "#0072B2",
  vermillion: "#D55E00", // 3,9:1
  green: "#009E73", // 3,4:1
  pink: "#CC79A7", // 3,1:1
  amber: "#E69F00", // 2,3:1 → aplat contouré uniquement
  skyblue: "#56B4E9", // 2,3:1 → idem
  yellow: "#F0E442", // 1,3:1 → jamais un trait, jamais du texte
  grey: "#8a9099",
  red: "#D55E00",
  magenta: "#CC79A7",
  purple: "#CC79A7",
  cyan: "#56B4E9",
};

/** Couleurs de séries, dans l'ordre où elles restent distinguables. */
export const series = (i) =>
  [
    COLORS.blue,
    COLORS.vermillion,
    COLORS.green,
    COLORS.pink,
    COLORS.amber,
    COLORS.skyblue,
    COLORS.grey,
  ][i % 7];

/**
 * Preset **imprimable / noir et blanc** (Paul Tol high-contrast). À utiliser
 * quand le rapport est destiné au papier avant l'écran.
 */
export const PRINT_SAFE = ["#004488", "#DDAA33", "#BB5566"];

/* ── blocs de page ──────────────────────────────────────────────────────── */

/**
 * Section de rapport. `break` contrôle l'impression :
 *   "avoid" (défaut) — ne pas couper au milieu si possible
 *   "before"        — commencer sur une nouvelle page
 *   "auto"          — laisser couper (tableaux longs)
 */
export const section = (
  title,
  body,
  { id, break: brk = "avoid", lead } = {},
) => `
<section class="sec ${brk === "before" ? "page-break" : ""} ${brk === "auto" ? "" : "keep"}"${id ? ` id="${esc(id)}"` : ""}>
  ${title ? `<h2>${esc(title)}</h2>` : ""}
  ${lead ? `<p class="lead">${lead}</p>` : ""}
  ${body}
</section>`;

/** Saut de page explicite (impression). Invisible à l'écran. */
export const pageBreak = () => `<div class="page-break"></div>`;

/** Bandeau d'avertissement — pour ce qui invaliderait une décision. */
export const warn = (html) => `<div class="warn">${html}</div>`;
export const note = (html) => `<div class="note">${html}</div>`;

/** Rangée de cartes de chiffres-clés. */
export const cards = (items) => `
<div class="cards">${items
  .map(
    (c) => `<div class="card">
    <div class="k">${esc(c.k)}</div>
    <div class="v">${c.v}${c.unit ? ` <span class="u">${esc(c.unit)}</span>` : ""}</div>
    ${c.sub ? `<div class="u">${esc(c.sub)}</div>` : ""}
  </div>`,
  )
  .join("")}</div>`;

/**
 * Tableau. `cols` : [{ label, align?: "left"|"right", strong?, dim? }].
 * Triable au clic si `sortable` (l'en-tête reste répété à l'impression).
 */
export const table = (cols, rows, { sortable = false, id } = {}) => {
  const tid = id ?? `t${Math.abs(hash(JSON.stringify(cols))) % 9999}`;
  // ARIA APG « sortable table » : le `th` porte `aria-sort`, et c'est un BOUTON
  // À L'INTÉRIEUR qui est cliquable. Mettre `role="button"` sur le `th` lui-même
  // est invalide (le validateur W3C le refuse) ET casse la sémantique de tableau
  // pour les lecteurs d'écran.
  const head = cols
    .map(
      (c, i) =>
        `<th${c.align === "right" ? ' class="r"' : ""}${sortable ? ` aria-sort="none" data-sort="${i}"` : ""}>` +
        (sortable
          ? `<button type="button" class="th-btn">${esc(c.label)}<span class="sort" aria-hidden="true"></span></button>`
          : esc(c.label)) +
        `</th>`,
    )
    .join("");
  const body = rows
    .map(
      (r) =>
        `<tr>${r
          .map((cell, i) => {
            const c = cols[i] ?? {};
            const cls = [
              c.align === "right" ? "r" : "",
              c.strong ? "strong" : "",
              c.dim ? "dim" : "",
            ]
              .filter(Boolean)
              .join(" ");
            const raw =
              typeof cell === "object" ? cell : { html: cell, sort: cell };
            return `<td${cls ? ` class="${cls}"` : ""}${raw.sort !== undefined ? ` data-v="${esc(raw.sort)}"` : ""}>${raw.html ?? ""}</td>`;
          })
          .join("")}</tr>`,
    )
    .join("");
  return `<div class="scroll"><table id="${tid}"${sortable ? ' class="sortable"' : ""}><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
};

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/* ── graphiques (SVG pur — aucune lib, imprimables tels quels) ──────────── */

/**
 * Barres horizontales comparatives. `logScale` quand les ordres de grandeur
 * diffèrent (1 µs vs 500 µs : en linéaire, la petite barre disparaît).
 */
export const barChart = (
  rows,
  {
    unit = "",
    width = 640,
    logScale = false,
    fmt: f = fmt.int,
    title = "",
    desc = "",
  } = {},
) => {
  const H = 34;
  const padL = Math.min(
    220,
    Math.max(...rows.map((r) => r.label.length)) * 7 + 12,
  );
  // Un label plus long que la réserve (plafonnée) passerait SOUS la barre — le
  // SVG ne clippe pas le texte. Tronquer avec ellipse ; le libellé complet reste
  // dans la <desc> ARIA (et un label long est un défaut à corriger côté données).
  const maxLbl = Math.floor((padL - 12) / 7);
  const lbl = (s) => (s.length > maxLbl ? `${s.slice(0, maxLbl - 1)}…` : s);
  const max = Math.max(...rows.map((r) => r.value), 1);
  // Réserve droite dimensionnée sur la valeur formatée la plus large + l'unité :
  // une unité longue débordait du cadre avec la réserve fixe historique (110).
  const padR = Math.max(110, (f(max).length + unit.length + 2) * 7 + 16);
  const usable = width - padL - padR;
  // Les barres partent TOUJOURS de zéro : une barre encode une LONGUEUR, un axe
  // tronqué ment. (Une ligne, qui encode une pente, peut légitimement être
  // tronquée — mais il faut alors l'annoncer.) Pas d'option pour désactiver.
  const scale = (v) =>
    logScale
      ? (Math.log10(Math.max(v, 1)) / Math.log10(Math.max(max, 10))) * usable
      : (v / max) * usable;
  const bars = rows
    .map((r, i) => {
      const y = i * H + 8;
      const w = Math.max(scale(r.value), 2);
      // Liseré de la couleur de la SURFACE : c'est lui qui sépare deux aplats de
      // couleurs voisines pour un œil daltonien (aucune palette de 8 couleurs ne
      // peut garantir 3:1 entre séries — le bord, si).
      return `<text x="0" y="${y + 15}" class="lbl">${esc(lbl(r.label))}</text>
      <rect x="${padL}" y="${y + 3}" width="${w}" height="16" rx="3" fill="${r.color ?? COLORS.accent}"
        stroke="var(--bg)" stroke-width="1"/>
      <text x="${padL + w + 8}" y="${y + 16}" class="val">${f(r.value)} ${esc(unit)}${r.note ? ` <tspan class="dim">${esc(r.note)}</tspan>` : ""}</text>`;
    })
    .join("");
  return svgFigure(
    `<svg viewBox="0 0 ${width} ${rows.length * H + 16}" class="chart" role="img" %ARIA%>%TD%${bars}</svg>`,
    {
      title: title || "Graphique en barres",
      desc:
        desc ||
        rows.map((r) => `${r.label} : ${f(r.value)} ${unit}`).join(" · "),
    },
  );
};

/**
 * Enveloppe un SVG avec son alternative textuelle — `role="img"` + `<title>` +
 * `<desc>` liés par `aria-labelledby`.
 *
 * Pourquoi ce n'est pas décoratif : **sans `role="img"`, les lecteurs d'écran
 * descendent dans le SVG et récitent tous les `<text>` en vrac** (les libellés,
 * les valeurs, les graduations, dans l'ordre du DOM) — inaudible. Et le support
 * de `<title>` seul est inconsistant : il faut l'`aria-labelledby`.
 *
 * L'alternative *réelle* d'un graphe de données reste le **tableau** (WCAG 1.1.1) :
 * la `desc` résume, elle ne remplace pas les chiffres. D'où l'usage recommandé :
 * un graphe + `details("Voir les données", table(...))`.
 */
let _svgSeq = 0;
export const svgFigure = (svgTemplate, { title, desc }) => {
  const n = ++_svgSeq;
  const tid = `svg${n}-t`;
  const did = `svg${n}-d`;
  return svgTemplate
    .replace("%ARIA%", `aria-labelledby="${tid} ${did}"`)
    .replace(
      "%TD%",
      `<title id="${tid}">${esc(title)}</title><desc id="${did}">${esc(desc)}</desc>`,
    );
};

/** Nuage de points + droite ajustée (une série = { points:[{x,y}], color, fit(x), label }). */
export const scatterFit = (
  seriesList,
  { width = 640, height = 240, xLabel = "", yLabel = "" } = {},
) => {
  const padL = 56;
  const padB = 30;
  const xs = seriesList.flatMap((s) => s.points.map((p) => p.x));
  const ys = seriesList.flatMap((s) => s.points.map((p) => p.y));
  const maxX = Math.max(...xs, 1);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanY = maxY - minY || 1;
  const sx = (x) => padL + (x / maxX) * (width - padL - 16);
  const sy = (y) => height - padB - ((y - minY) / spanY) * (height - padB - 16);
  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => {
      const y = sy(minY + f * spanY);
      return `<line x1="${padL}" y1="${y}" x2="${width - 16}" y2="${y}" class="grid"/>
        <text x="${padL - 8}" y="${y + 4}" class="axis" text-anchor="end">${fmt.dec(minY + f * spanY)}</text>`;
    })
    .join("");
  const body = seriesList
    .map((s) => {
      const line = `<line x1="${sx(0)}" y1="${sy(s.fit(0))}" x2="${sx(maxX)}" y2="${sy(s.fit(maxX))}" stroke="${s.color}" stroke-width="1.5" stroke-dasharray="4 3" opacity=".85"/>`;
      const pts = s.points
        .map(
          (p) =>
            `<circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="3.5" fill="${s.color}"/>`,
        )
        .join("");
      return line + pts;
    })
    .join("");
  return `<svg viewBox="0 0 ${width} ${height}" class="chart" role="img">
    ${grid}${body}
    <text x="${(width + padL) / 2}" y="${height - 6}" class="axis" text-anchor="middle">${esc(xLabel)}</text>
    <text x="4" y="12" class="axis">${esc(yLabel)}</text>
  </svg>`;
};

/** Courbes temporelles (séries = [{ label, color, points:[{x,y}] }]). */
export const lineChart = (
  seriesList,
  { width = 640, height = 220, xLabel = "", yLabel = "" } = {},
) => {
  const padL = 52;
  // Bande de titre en HAUT (yLabel) et bande basse (graduations X + xLabel) :
  // le yLabel était dessiné DANS la zone de tracé et chevauchait graduations et
  // courbes dès qu'il dépassait quelques caractères (vécu, rapport perf PG).
  const padT = yLabel ? 22 : 8;
  const padB = 40;
  const xs = seriesList.flatMap((s) => s.points.map((p) => p.x));
  const ys = seriesList.flatMap((s) => s.points.map((p) => p.y));
  const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
  const maxY = Math.max(...ys, 1);
  const sx = (x) =>
    padL + ((x - minX) / (maxX - minX || 1)) * (width - padL - 16);
  const sy = (y) => height - padB - (y / maxY) * (height - padB - padT);
  const grid = [0, 0.5, 1]
    .map((f) => {
      const y = sy(f * maxY);
      return `<line x1="${padL}" y1="${y}" x2="${width - 16}" y2="${y}" class="grid"/>
        <text x="${padL - 8}" y="${y + 4}" class="axis" text-anchor="end">${fmt.int(f * maxY)}</text>`;
    })
    .join("");
  // Graduations X aux abscisses réelles des points — sans elles, une courbe ne
  // se lit pas (on voyait des lignes sans savoir où tombaient 25/50/100).
  // Au-delà de 8 valeurs uniques : 5 repères répartis, sinon illisible.
  let xvals = [...new Set(xs)].sort((a, b) => a - b);
  if (xvals.length > 8) {
    const last = xvals.length - 1;
    xvals = [0, 0.25, 0.5, 0.75, 1].map((f) => xvals[Math.round(f * last)]);
  }
  const xticks = xvals
    .map(
      (
        x,
      ) => `<line x1="${sx(x)}" y1="${height - padB}" x2="${sx(x)}" y2="${height - padB + 4}" class="grid"/>
      <text x="${sx(x)}" y="${height - padB + 16}" class="axis" text-anchor="middle">${fmt.int(x)}</text>`,
    )
    .join("");
  // Marqueurs aux points de données : avec peu de points, une ligne nue ne
  // montre pas OÙ on a mesuré (le reste est interpolé).
  const paths = seriesList
    .map(
      (s) =>
        `<path d="${s.points.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ")}" fill="none" stroke="${s.color}" stroke-width="2"/>` +
        s.points
          .map(
            (p) =>
              `<circle cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="3.5" fill="${s.color}" stroke="var(--bg)" stroke-width="1"/>`,
          )
          .join(""),
    )
    .join("");
  return svgFigure(
    `<svg viewBox="0 0 ${width} ${height}" class="chart" role="img" %ARIA%>%TD%${grid}${xticks}${paths}
    <text x="${(width + padL) / 2}" y="${height - 4}" class="axis" text-anchor="middle">${esc(xLabel)}</text>
    <text x="4" y="13" class="axis">${esc(yLabel)}</text></svg>`,
    {
      title:
        yLabel || xLabel
          ? `${yLabel}${yLabel && xLabel ? " selon " : ""}${xLabel}`
          : "Courbes",
      desc: seriesList
        .map(
          (s) =>
            `${s.label ?? ""} : ${s.points.map((p) => `${fmt.int(p.x)} → ${fmt.int(p.y)}`).join(", ")}`,
        )
        .join(" · "),
    },
  );
};

/** Légende de séries. */
export const legend = (items) =>
  `<div class="legend">${items
    .map(
      (i) =>
        `<span><span class="dot" style="background:${i.color}"></span>${esc(i.label)}</span>`,
    )
    .join("")}</div>`;

/* ── interactivité ──────────────────────────────────────────────────────── */

/**
 * Calculateur : des entrées, une fonction de calcul, un bloc de sortie.
 *
 * C'est ce qui justifie le HTML plutôt qu'un PDF : le lecteur ne consulte pas des
 * chiffres, il teste SES hypothèses. `compute` est du JS **injecté tel quel** —
 * il reçoit `v` (valeurs des champs, par id) et `K` (constantes mesurées), et
 * rend un objet `{ html, alerts?: string[] }`.
 *
 * À l'impression, les champs deviennent des valeurs figées (`.no-print` masque
 * les contrôles) : le PDF garde le scénario qui était affiché.
 */
export const calculator = ({ id = "calc", inputs, constants, compute }) => `
<div class="calc" id="${esc(id)}">
  <div class="grid2 no-print">
    ${inputs
      .map((i) =>
        i.type === "checkbox"
          ? `<div class="switch"><input type="checkbox" id="${esc(i.id)}"${i.value ? " checked" : ""}>
             <label for="${esc(i.id)}">${esc(i.label)}</label></div>`
          : `<div><label for="${esc(i.id)}">${esc(i.label)}</label>
             <input type="number" id="${esc(i.id)}" value="${esc(i.value)}"${i.step ? ` step="${esc(i.step)}"` : ""}${i.min !== undefined ? ` min="${esc(i.min)}"` : ""}></div>`,
      )
      .join("")}
  </div>
  <div class="calc-print print-only"></div>
  <div class="out" id="${esc(id)}-out"></div>
</div>
<script>
(() => {
  const K = ${JSON.stringify(constants)};
  const IDS = ${JSON.stringify(inputs.map((i) => ({ id: i.id, type: i.type ?? "number", label: i.label })))};
  const compute = ${compute};
  const out = document.getElementById(${JSON.stringify(`${id}-out`)});
  const printed = document.querySelector(${JSON.stringify(`#${id} .calc-print`)});
  const read = () => Object.fromEntries(IDS.map((i) => {
    const el = document.getElementById(i.id);
    return [i.id, i.type === "checkbox" ? el.checked : (+el.value || 0)];
  }));
  const run = () => {
    const v = read();
    const r = compute(v, K);
    out.innerHTML = r.html + (r.alerts?.length
      ? '<div class="alerts">' + r.alerts.map((a) => "<div>" + a + "</div>").join("") + "</div>"
      : "");
    // L'impression fige le scénario affiché (un PDF sans ses hypothèses ne vaut rien).
    printed.innerHTML = '<div class="hyp"><strong>Hypothèses :</strong> ' + IDS.map((i) =>
      i.label + " = " + (typeof v[i.id] === "boolean" ? (v[i.id] ? "oui" : "non") : v[i.id])).join(" · ") + "</div>";
  };
  for (const i of IDS) document.getElementById(i.id).addEventListener("input", run);
  run();
})();
</script>`;

/**
 * Lit un nombre écrit à la FRANÇAISE dans un texte de cellule.
 *
 * 🔴 Une seule implémentation, ici : elle est utilisée par les tests, et
 * INJECTÉE telle quelle dans le script de tri envoyé au navigateur (voir
 * `SORT_JS`). Une copie recopiée à la main dans la chaîne aurait divergé au
 * premier correctif — et la divergence ne se serait vue que sur une colonne
 * triée à l'envers, ce que personne ne remarque.
 *
 * « 12 226,45 » porte une espace fine insécable comme séparateur de milliers et
 * une virgule décimale : les effacer toutes les deux donnerait « 1222645 ».
 *
 * @param {unknown} v - le texte de la cellule, ou son `data-v`.
 * @returns {number} le nombre, ou `NaN` si la cellule n'en contient pas.
 */
export const nombreDepuisTexte = (v) =>
  parseFloat(
    String(v)
      .replace(/[\s\u00a0\u202f]/g, "")
      .replace(/(\d),(\d)/g, "$1.$2")
      .replace(/[^\d.eE+-]/g, ""),
  );

/** Tri de tableau au clic sur l'en-tête (data-v = valeur de tri, sinon texte). */
const SORT_JS = `
// La MÊME fonction que \`nombreDepuisTexte\`, sérialisée : une seule règle, une
// seule implémentation, éprouvée par l'auto-contrôle.
const num = ${nombreDepuisTexte.toString()};
for (const t of document.querySelectorAll("table.sortable")) {
  const tb = t.tBodies[0];
  t.querySelectorAll("th[data-sort]").forEach((th) => {
    let asc = false;
    // Le bouton EST le contrôle (clic + Entrée + Espace natifs, focus natif) :
    // pas de gestion clavier à réécrire, et le lecteur d'écran annonce le tri
    // via aria-sort sur la colonne.
    th.querySelector(".th-btn").addEventListener("click", () => {
      const i = +th.dataset.sort;
      asc = !asc;
      const rows = [...tb.rows].sort((a, b) => {
        const va = a.cells[i].dataset.v ?? a.cells[i].textContent;
        const vb = b.cells[i].dataset.v ?? b.cells[i].textContent;
        // Normaliser AVANT de convertir : « 12 226,45 » porte une espace fine
        // insécable comme séparateur de milliers et une virgule décimale. Les
        // effacer toutes les deux donnerait « 1222645 » — une colonne triée à
        // l'envers, sans le moindre signe d'erreur.
        const num = (v) => parseFloat(
          String(v)
            .replace(/[\\s\\u00a0\\u202f]/g, "")
            .replace(/(\\d),(\\d)/g, "$1.$2")
            .replace(/[^\\d.eE+-]/g, ""),
        );
        const na = num(va);
        const nb = num(vb);
        const cmp = !isNaN(na) && !isNaN(nb) ? na - nb : String(va).localeCompare(String(vb), "fr");
        return asc ? cmp : -cmp;
      });
      rows.forEach((r) => tb.appendChild(r));
      t.querySelectorAll("th[data-sort]").forEach((x) => {
        x.setAttribute("aria-sort", "none");
        x.classList.remove("asc", "desc");
      });
      th.setAttribute("aria-sort", asc ? "ascending" : "descending");
      th.classList.add(asc ? "asc" : "desc");
    });
  });
}`;

/** Bascule de thème (le système décide par défaut ; l'utilisateur peut forcer). */
/**
 * Bascule de thème, MÉMORISÉE.
 *
 * Sans mémoire, le choix ne survit pas au lien suivant : sur un rapport d'une
 * seule page cela ne se voyait pas, sur un site de cent pages c'est un réglage
 * qu'il faut refaire à chaque clic. Le choix est donc rangé dans le stockage
 * local — propre au navigateur du lecteur, jamais transmis — et réappliqué au
 * chargement, AVANT le premier rendu pour éviter que la page n'apparaisse dans
 * l'autre thème le temps d'un battement.
 *
 * Tous les accès sont protégés : un navigateur en navigation privée, ou réglé
 * pour refuser le stockage, lève à la LECTURE comme à l'ÉCRITURE. La page doit
 * alors fonctionner exactement comme avant — préférence du système, bascule
 * opérante, simplement non retenue.
 */
const THEME_JS = `
(function(){
  var K="nf-theme", root=document.documentElement;
  function lire(){ try { return localStorage.getItem(K); } catch (e) { return null; } }
  function ecrire(v){ try { localStorage.setItem(K, v); } catch (e) {} }
  var choisi = lire();
  if (choisi === "dark" || choisi === "light") root.dataset.theme = choisi;
  var tgl = document.getElementById("theme-toggle");
  if (!tgl) return;
  function etiquette(){
    var t = root.dataset.theme
      || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    tgl.setAttribute("aria-label", t === "dark" ? "Passer au thème clair" : "Passer au thème sombre");
    tgl.setAttribute("title", tgl.getAttribute("aria-label"));
  }
  etiquette();
  tgl.addEventListener("click", function(){
    var cur = root.dataset.theme
      || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    var suivant = cur === "dark" ? "light" : "dark";
    root.dataset.theme = suivant;
    ecrire(suivant);
    etiquette();
  });
})();`;

/**
 * Préparation à l'impression — CE QUE LE CSS SEUL NE PEUT PAS FAIRE.
 *
 * Un `<details>` FERMÉ n'est pas imprimé. Pas « mal imprimé » : **absent du PDF**,
 * dans les trois moteurs, et aucun CSS portable n'y remédie. Idem pour un onglet
 * masqué (`hidden`) ou une section cachée par le mode présentation. Sans ce
 * hook, un rapport peut donc perdre silencieusement la moitié de son contenu à
 * l'impression — et personne ne s'en aperçoit avant que le PDF soit envoyé.
 *
 * On déplie tout avant, on restaure l'état du lecteur après.
 */
const PRINT_JS = `
let _printRestore = [];
addEventListener("beforeprint", () => {
  _printRestore = [];
  for (const d of document.querySelectorAll("details")) {
    if (!d.open) { _printRestore.push(d); d.open = true; }   // sinon : ABSENT du PDF
  }
  for (const p of document.querySelectorAll("[role=tabpanel][hidden]")) {
    _printRestore.push(p); p.hidden = false;                  // idem pour un onglet masqué
  }
  for (const s of document.querySelectorAll("section.sec")) s.style.display = "";
});
addEventListener("afterprint", () => {
  for (const el of _printRestore) {
    if (el.tagName === "DETAILS") el.open = false;
    else el.hidden = true;
  }
  _printRestore = [];
});`;

/* ── CSS ────────────────────────────────────────────────────────────────── */

const CSS = `
:root {
  --bg:#fff; --fg:#12161c; --dim:#667085; --line:#e4e7ec; --card:#f8fafc;
  --accent:#0067ba; --warn-bg:#fff6e5; --warn-fg:#7a4b00; --note-bg:#eef5ff; --note-fg:#0a4a86;
}
@media (prefers-color-scheme: dark) {
  :root { --bg:#0f1319; --fg:#e6e9ef; --dim:#8a94a6; --line:#232a35; --card:#161b23;
          --accent:#4c9aff; --warn-bg:#2b2312; --warn-fg:#ffc46b; --note-bg:#0f2438; --note-fg:#8fc6ff; }
}
:root[data-theme="dark"] { --bg:#0f1319; --fg:#e6e9ef; --dim:#8a94a6; --line:#232a35; --card:#161b23;
  --accent:#4c9aff; --warn-bg:#2b2312; --warn-fg:#ffc46b; --note-bg:#0f2438; --note-fg:#8fc6ff; }
:root[data-theme="light"] { --bg:#fff; --fg:#12161c; --dim:#667085; --line:#e4e7ec; --card:#f8fafc;
  --accent:#0067ba; --warn-bg:#fff6e5; --warn-fg:#7a4b00; --note-bg:#eef5ff; --note-fg:#0a4a86; }

* { box-sizing: border-box; }
/* Les liens n'avaient AUCUNE règle : ils gardaient le bleu par défaut du
   navigateur (#0000ee), correct sur blanc et à 1,8:1 sur fond sombre. Tout
   rapport lu en thème sombre était concerné, pas seulement les pages de site. */
a { color: var(--accent); }
a:hover { text-decoration: underline; }
a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 3px; }
body { margin:0; background:var(--bg); color:var(--fg);
  font:15px/1.62 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  -webkit-font-smoothing:antialiased; }
.wrap { max-width:900px; margin:0 auto; padding:40px 20px 90px; }
/* Site de documentation — la grille ne s'active QUE si la page fournit une
   navigation. Un rapport qui n'en passe pas garde exactement sa colonne unique :
   les pages deja publiees ne bougent pas d'un pixel. */
/* Un site de documentation occupe TOUTE la largeur : la nav et le sommaire sont
   des colonnes fixes, le contenu prend le reste. Une largeur maximale centrée
   convient à un rapport qu'on imprime, pas à une doc qu'on parcourt en gardant
   l'arborescence sous les yeux. */
.wrap.has-nav { max-width:none; width:100%; display:grid; gap:0 40px;
  padding:26px 34px 80px;
  grid-template-columns:272px minmax(0,1fr) 232px;
  grid-template-areas:"head head head" "nav main toc"; }
.wrap.has-nav > .rep-head { grid-area:head; }
a.brand { text-decoration:none; color:inherit; }
a.brand:hover .brand-name { color:var(--accent); }
a.brand:focus-visible { outline:2px solid var(--accent); outline-offset:3px; border-radius:6px; }
.wrap.has-nav > main { grid-area:main; min-width:0; }
.site-nav { grid-area:nav; position:sticky; top:76px; align-self:start;
  max-height:calc(100vh - 150px); overflow-y:auto; font-size:13.5px; padding-right:6px; }
.site-toc { grid-area:toc; position:sticky; top:76px; align-self:start;
  max-height:calc(100vh - 150px); overflow-y:auto; font-size:12.5px; }
/* Pied COLLANT sur un site : la provenance de la page (source, version, commit)
   reste lisible sans redescendre. Deux précautions, sans lesquelles il devient
   illisible dès qu'on défile : un fond OPAQUE — la couleur de fond de
   la page, jamais une transparence, sinon le texte défile derrière — et une
   hauteur bornée, sinon il mange l'écran sur les petits appareils.
   À l'impression il redevient un pied normal (cf le bloc @media print). */
.wrap.has-nav > .foot { grid-column:1/-1; position:sticky; bottom:0; z-index:15;
  background:var(--bg); margin-top:40px; padding:10px 0;
  border-top:1px solid var(--line); max-height:22vh; overflow-y:auto; }
/* L'en-tête est déjà collant ; sur un site il doit passer AU-DESSUS
   des colonnes latérales, elles-mêmes collantes. */
.wrap.has-nav > .rep-head { z-index:25; }
@media (max-width:1180px) { .site-toc { display:none; }
  .wrap.has-nav { grid-template-columns:250px minmax(0,1fr);
    grid-template-areas:"head head" "nav main"; } }
@media (max-width:820px) { .site-nav { display:none; }
  .wrap.has-nav { padding:20px 18px 60px; grid-template-columns:minmax(0,1fr);
    grid-template-areas:"head" "main"; } }
@media print { .site-nav, .site-toc { display:none; }
  .wrap.has-nav { display:block; max-width:none; padding:0; }
  .wrap.has-nav > .foot { position:static; max-height:none; overflow:visible; } }
h1 { font-size:28px; line-height:1.22; margin:0 0 8px; letter-spacing:-.021em; }
h2 { font-size:20px; margin:0 0 10px; letter-spacing:-.012em; }
h3 { font-size:15px; margin:22px 0 6px; }
.sub { color:var(--dim); margin:0 0 8px; font-size:16px; }
.lead { color:var(--dim); margin:0 0 14px; }
.sec { margin-top:46px; }
.warn, .note { border-radius:8px; padding:12px 16px; margin:16px 0; font-size:14px; }
.warn { background:var(--warn-bg); color:var(--warn-fg); }
.note { background:var(--note-bg); color:var(--note-fg); }
.cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; margin:16px 0; }
.card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:12px 14px; }
.card .k { color:var(--dim); font-size:12px; text-transform:uppercase; letter-spacing:.04em; }
.card .v { font-size:22px; font-weight:650; margin-top:2px; letter-spacing:-.02em; }
.card .u { color:var(--dim); font-size:12px; font-weight:400; }
.scroll { overflow-x:auto; }
table { border-collapse:collapse; width:100%; font-size:14px; min-width:520px; }
th, td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--line); }
th { color:var(--dim); font-weight:600; font-size:12px; text-transform:uppercase; letter-spacing:.04em; }
table.sortable th[data-sort] { cursor:pointer; user-select:none; }
table.sortable th.asc .sort::after { content:" ▲"; }
table.sortable th.desc .sort::after { content:" ▼"; }
td.r, th.r { text-align:right; font-variant-numeric:tabular-nums; }
td.strong { font-weight:650; }
td.dim, .dim { color:var(--dim); }
.chart { width:100%; height:auto; margin:12px 0 4px; }
.chart .lbl, .chart .val { fill:var(--fg); font-size:12px; }
.chart .val { font-variant-numeric:tabular-nums; }
.chart .dim { fill:var(--dim); }
.chart .grid { stroke:var(--line); }
.chart .axis { fill:var(--dim); font-size:11px; }
.legend { display:flex; flex-wrap:wrap; gap:16px; font-size:12px; color:var(--dim); }
.dot { display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:5px; }
.calc { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:18px; margin-top:14px; }
.grid2 { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:12px; }
label { display:block; font-size:12px; color:var(--dim); margin-bottom:3px; }
input[type=number] { width:100%; padding:7px 9px; font-size:14px; border:1px solid var(--line);
  border-radius:7px; background:var(--bg); color:var(--fg); }
.switch { display:flex; align-items:center; gap:8px; align-self:end; }
.switch label { margin:0; font-size:14px; color:var(--fg); }
.out { margin-top:18px; padding-top:16px; border-top:1px solid var(--line); }
.alerts { margin-top:14px; font-size:13px; }
.alerts div { padding:6px 10px; border-radius:6px; margin-bottom:5px; background:var(--warn-bg); color:var(--warn-fg); }
code { background:var(--card); border:1px solid var(--line); border-radius:4px; padding:1px 5px; font-size:13px; }
.foot { margin-top:56px; padding-top:14px; border-top:1px solid var(--line); color:var(--dim); font-size:12px; }
.topbar { display:flex; justify-content:space-between; align-items:center; gap:12px; }
button.ghost { background:none; border:1px solid var(--line); color:var(--dim); border-radius:7px;
  padding:5px 10px; font-size:12px; cursor:pointer; }
/* ── marque : en-tête et pied ──────────────────────────────────────────────
   Le logo est un data-URI (jamais un fichier externe) : le rapport reste
   autonome hors ligne. Il est CONSERVÉ à l'impression — un PDF sans en-tête ne
   dit pas d'où il vient, et un rapport dont on ignore la provenance ne prouve
   rien. print-color-adjust:exact (plus haut) empêche le navigateur de le
   vider de ses couleurs pour économiser l'encre. */
/* En-tête COLLANTE : la marque et la bascule de thème restent visibles pendant
   qu'on parcourt le rapport. Un lecteur qui a scrollé 6 écrans plus bas doit
   toujours savoir de QUEL document il lit une ligne — c'est la première question
   qu'on se pose en rouvrant un PDF ou un onglet laissé ouvert la veille.
   Fond OPAQUE obligatoire (var(--bg)) : sans lui, le contenu défile sous le
   texte de l'en-tête et les deux deviennent illisibles. */
.rep-head { position:sticky; top:0; z-index:20; background:var(--bg);
  display:flex; justify-content:space-between; align-items:flex-start;
  gap:16px; padding:14px 0 12px; margin-bottom:22px; border-bottom:1px solid var(--line); }
.brand { display:flex; align-items:center; gap:11px; }
.brand-logo { height:34px; width:auto; display:block; }
.brand-name { font-weight:650; font-size:15px; letter-spacing:-.01em; }
.brand-tag { color:var(--dim); font-size:12px; }
.foot-row { display:flex; align-items:flex-start; gap:12px; }
.foot-logo { height:26px; width:auto; flex:none; opacity:.85; }
.print-only { display:none; }
.hyp { font-size:13px; color:var(--dim); }

/* composants avancés */
.spark { vertical-align:middle; }
.tablist { display:flex; gap:4px; border-bottom:1px solid var(--line); margin-bottom:14px; }
/* Cibles de clic : 24x24 px minimum (WCAG 2.2 AA, critere 2.5.8). */
.tab { background:none; border:none; border-bottom:2px solid transparent; color:var(--dim);
  padding:10px 14px; min-height:24px; font-size:14px; cursor:pointer; }
.th-btn { background:none; border:none; color:inherit; font:inherit; text-transform:inherit;
  letter-spacing:inherit; cursor:pointer; padding:4px 0; min-height:24px; }
.det summary { min-height:24px; }
.tab[aria-selected="true"] { color:var(--fg); border-bottom-color:var(--accent); font-weight:600; }
.tab:focus-visible, input:focus-visible, button:focus-visible, th:focus-visible, .dnd-item:focus-visible {
  outline:2px solid var(--accent); outline-offset:2px; }
.det { border:1px solid var(--line); border-radius:8px; padding:10px 14px; margin:12px 0; }
.det summary { cursor:pointer; font-weight:600; font-size:14px; }
.det-body { margin-top:10px; }
.filter { width:100%; max-width:320px; padding:7px 10px; font-size:14px; border:1px solid var(--line);
  border-radius:7px; background:var(--bg); color:var(--fg); margin-bottom:10px; }
.dnd { list-style:none; padding:0; margin:12px 0; }
.dnd-item { display:flex; align-items:center; gap:10px; padding:9px 12px; margin-bottom:6px;
  background:var(--card); border:1px solid var(--line); border-radius:8px; cursor:grab; font-size:14px; }
.dnd-item.dragging { opacity:.45; cursor:grabbing; }
.dnd-item .grip { color:var(--dim); cursor:grab; }
.dnd-item .rank { color:var(--dim); font-variant-numeric:tabular-nums; width:18px; flex:none; }
.dnd-label { flex:1; }
/* ── mode présentation (« PowerPoint-like », sans PowerPoint) ─────────────── */
/* MODE PRÉSENTATION — même principe que la page : l'en-tête reste EN HAUT, la
   diapositive défile DESSOUS. Une diapo plus haute que l'écran doit pouvoir se
   parcourir : sans overflow-y:auto sur la section, le bas d'un long tableau est
   simplement inatteignable (le body est en overflow:hidden). D'où la colonne
   flex : en-tête figée (flex:none), section élastique et scrollable.
   min-height:0 est indispensable — sans lui, un enfant flex refuse de rétrécir
   sous sa hauteur de contenu et le scroll ne s'active jamais. */
body.deck { overflow:hidden; height:100vh; }
body.deck .wrap { max-width:1180px; height:100vh; padding:0 40px 64px;
  display:flex; flex-direction:column; }
body.deck .rep-head { flex:none; margin-bottom:14px; }
/* Les sections vivent dans un element main, pas directement dans l'enveloppe :
   sans relayer
   la colonne flexible ici, le flex:1 d'une section ne s'applique à rien, sa
   hauteur n'est pas contrainte, son overflow-y ne defile jamais — et le
   overflow:hidden du corps COUPE ce qui depasse. Une diapositive longue
   perdait ainsi sa fin, sans barre de défilement pour le dire. */
body.deck main { flex:1; min-height:0; display:flex; flex-direction:column; }
body.deck h1 { display:none; }
body.deck section.sec { flex:1; min-height:0; overflow-y:auto; overscroll-behavior:contain;
  margin-top:0; padding-right:6px; animation:slidein .28s ease-out; }
body.deck h2 { font-size:32px; margin-bottom:14px; }
body.deck .lead { font-size:18px; }
body.deck .card .v { font-size:30px; }
body.deck table { font-size:16px; }
body.deck .foot, body.deck .topbar, body.deck .sub { display:none; }
@keyframes slidein { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:none; } }
@media (prefers-reduced-motion: reduce) { body.deck section.sec { animation:none; } }
.deck-ui { position:fixed; left:0; right:0; bottom:0; z-index:9; }
.deck-bar { height:3px; background:var(--line); }
.deck-bar span { display:block; height:100%; width:0; background:var(--accent); transition:width .25s ease; }
.deck-nav { display:flex; align-items:center; justify-content:center; gap:14px; padding:10px;
  background:var(--bg); border-top:1px solid var(--line); }
.deck-count { color:var(--dim); font-size:13px; font-variant-numeric:tabular-nums; }

/* ── IMPRESSION / PDF ─────────────────────────────────────────────────────
   Un rapport qui s'imprime mal n'est pas un rapport : il sera relu en PDF, en
   réunion, joint à un dossier. Les règles qui comptent :
   - forcer le thème CLAIR (une page sombre vide une cartouche d'encre)
   - conserver les à-plats de couleur (sinon les graphes deviennent illisibles)
   - ne jamais couper une carte, un graphe, un tableau court, ni orphelin de titre
   - répéter l'en-tête d'un tableau qui court sur plusieurs pages
   - masquer les contrôles interactifs, et figer les hypothèses en texte */
@page { size: A4; margin: 16mm 14mm; }
@media print {
  :root, :root[data-theme="dark"] {
    --bg:#fff; --fg:#000; --dim:#555; --line:#ccc; --card:#f6f7f9;
    --accent:#0067ba; --warn-bg:#fff6e5; --warn-fg:#6b4200; --note-bg:#eef5ff; --note-fg:#0a4a86;
  }
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  body { font-size: 11pt; }
  .wrap { max-width: none; padding: 0; }
  .no-print, button.ghost, .rep-head button { display: none !important; }
  /* La marque RESTE (c'est la provenance du document). */
  /* position:sticky n'a pas de sens sur papier — et laissé tel quel, il décale
     l'en-tête dans le PDF. On le neutralise explicitement. */
  .rep-head { position: static; border-bottom: 1px solid #ccc; padding: 0 0 10px; margin-bottom: 16px; }
  .brand-logo { height: 26px; }
  .foot-logo { height: 20px; }
  .print-only { display: block; }
  a { color: inherit; text-decoration: none; }

  /* Sauts de page maîtrisés.
     ATTENTION — break-after:avoid (pour ne pas laisser un titre seul en bas de
     page) est un NO-OP en Firefox ET Safari : seul Chrome l'honore. La seule
     protection PORTABLE est break-inside:avoid sur un bloc qui contient le titre
     ET son contenu : c'est le rôle de .sec.keep. On garde break-after en bonus
     Chrome, mais on ne construit RIEN dessus.
     De même, orphans/widows sont ignorés par Firefox. */
  .page-break { break-before: page; page-break-before: always; }
  .sec.keep, .card, .calc, .warn, .note, .legend, .det { break-inside: avoid; page-break-inside: avoid; }
  .chart { break-inside: avoid; page-break-inside: avoid; max-height: 240mm; }
  h1, h2, h3 { break-after: avoid; page-break-after: avoid; }
  h2 { margin-top: 18px; }
  p, li { orphans: 3; widows: 3; }

  /* Une animation jamais jouée laisse un opacity:0 — donc du VIDE sur le papier. */
  *, *::before, *::after { animation: none !important; transition: none !important;
    opacity: 1 !important; transform: none !important; }
  /* Le top layer (dialog/popover ouvert) a un rendu d'impression non spécifié. */
  dialog, [popover], dialog::backdrop { display: none !important; }
  /* content-visibility:auto provoque des pages blanches à l'impression. */
  * { content-visibility: visible !important; }

  /* Un tableau long PEUT couper — mais son en-tête se répète sur chaque page */
  table { break-inside: auto; }
  thead { display: table-header-group; }
  tfoot { display: table-footer-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  .scroll { overflow: visible; }
  table { min-width: 0; }
}`;

/* ── document ───────────────────────────────────────────────────────────── */

/**
 * Assemble le document HTML complet (autonome).
 *
 * @param title - titre (onglet + en-tête)
 * @param subtitle - une phrase : ce que le lecteur doit RETENIR
 * @param sections - HTML déjà rendu (cf `section()`)
 * @param data - **données sources** du rapport → embarquées en JSON (cf `embedData`).
 *   Fortement recommandé : c'est ce qui rend le rapport rejouable, comparable d'un
 *   run à l'autre, et lisible par une machine. Le HTML redevient une VUE ; les
 *   données restent la vérité.
 * @param footer - provenance : commande exacte, date, version, environnement.
 *   Un rapport qu'on ne peut pas rejouer ne prouve rien.
 */
export const doc = ({
  title,
  subtitle = "",
  sections = [],
  footer = "",
  data = null,
  lang = "fr",
  brand = NODEFONY_BRAND,
  /**
   * Navigation latérale du SITE (arbre des pages). Absente pour un rapport —
   * une photo de mesures n'a pas de voisines. Sa seule présence bascule la page
   * en grille trois colonnes.
   */
  nav = "",
  /**
   * `brand.href` — rend la marque en tête CLIQUABLE. C'est le geste que tout
   * lecteur essaie pour revenir à l'accueil d'un site ; un rapport isolé, lui,
   * n'a nulle part où revenir, donc rien ne change sans ce champ.
   */
  /** Sommaire de la page courante, colonne de droite. Suit le sort de `nav`. */
  aside = "",
  /**
   * Balises ajoutées au `<head>` — description, icône, canonique, partage.
   * Un rapport n'en a pas besoin : il se lit par le fichier qu'on a reçu. Une
   * page PUBLIÉE, si : sans description, un moteur de recherche invente son
   * propre extrait, et sans icône chaque visiteur récolte un 404 dans sa
   * console. Le contenu passe tel quel — c'est à l'appelant de l'échapper.
   */
  head = "",
  /**
   * Style ADDITIONNEL de la page — par exemple `STYLE_GRAPHES` du moteur
   * ECharts, qui bascule les figures entre thème clair et thème sombre. Sans ce
   * point d'injection, une page ne pouvait pas déclarer de style propre : il
   * fallait modifier le CSS commun pour un besoin local.
   */
  style = "",
}) => `<!doctype html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${head}
<style>${CSS}</style>
${style ? `<style>${style}</style>` : ""}
</head>
<body>
<script>
// Avant le premier pixel : sans cette ligne, une page choisie en sombre
// apparaît en clair le temps que le script de fin de page s'exécute.
try{var t=localStorage.getItem("nf-theme");if(t==="dark"||t==="light")document.documentElement.dataset.theme=t;}catch(e){}
</script>
<div class="wrap${nav || aside ? " has-nav" : ""}">
  <header class="rep-head">
    ${
      brand
        ? `<${brand.href ? "a" : "div"} class="brand"${brand.href ? ` href="${esc(brand.href)}"` : ""}>
      <img src="${brand.logo}" alt="${esc(brand.name)}" class="brand-logo">
      <div>
        <div class="brand-name">${esc(brand.name)}</div>
        ${brand.tagline ? `<div class="brand-tag">${esc(brand.tagline)}</div>` : ""}
      </div>
    </${brand.href ? "a" : "div"}>`
        : "<div></div>"
    }
    <button class="ghost no-print" id="theme-toggle" aria-label="Changer de thème">◐</button>
  </header>
  ${nav ? `<nav class="site-nav" aria-label="Navigation de la documentation">${nav}</nav>` : ""}
  ${aside ? `<aside class="site-toc" aria-label="Sommaire de la page">${aside}</aside>` : ""}
  <main>
  <h1>${esc(title)}</h1>
  ${subtitle ? `<p class="sub">${subtitle}</p>` : ""}
  ${sections.join("\n")}
  </main>
  ${
    footer || data
      ? `<footer class="foot">
    <div class="foot-row">
      ${brand ? `<img src="${brand.logo}" alt="" class="foot-logo">` : ""}
      <div>${footer}</div>
    </div>
    ${data ? embedData(data) : ""}
  </footer>`
      : ""
  }
</div>
<script>${SORT_JS}${THEME_JS}${PRINT_JS}</script>
</body>
</html>`;

/* ═══════════════════════════════════════════════════════════════════════════
   COMPOSANTS AVANCÉS — ce que HTML5 sait faire nativement, sans une seule lib.
   Chacun est AUTONOME (markup + comportement), imprimable, et accessible au
   clavier : un rapport qu'on ne peut pas parcourir sans souris est un rapport
   qu'une partie des lecteurs ne lira pas.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Sparkline compacte (tendance dans une cellule de tableau ou une carte). */
export const sparkline = (
  values,
  { width = 90, height = 22, color = COLORS.accent } = {},
) => {
  if (!values.length) return "";
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const d = values
    .map((v, i) => {
      const x = (i / (values.length - 1 || 1)) * (width - 2) + 1;
      const y = height - 2 - ((v - min) / span) * (height - 4);
      return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return `<svg viewBox="0 0 ${width} ${height}" class="spark" role="img" aria-label="tendance">
    <path d="${d}" fill="none" stroke="${color}" stroke-width="1.5"/></svg>`;
};

/** Jauge (0→1) — pour un taux d'utilisation, une saturation, un score. */
export const gauge = (
  ratio,
  // oxlint-disable-next-line no-shadow -- `warn` est le nom PUBLIC de ce seuil dans l'API de `gauge` ; il masque le helper `warn()` exporté plus haut, sans conséquence ici (aucun appel), et le renommer casserait les appelants.
  { label = "", width = 180, danger = 0.85, warn = 0.7 } = {},
) => {
  const r = Math.max(0, Math.min(1, ratio));
  const color =
    r >= danger ? COLORS.red : r >= warn ? COLORS.amber : COLORS.green;
  const R = 54;
  const C = Math.PI * R; // demi-cercle
  return `<svg viewBox="0 0 130 78" class="chart" style="max-width:${width}px" role="img"
    aria-label="${esc(label)}: ${fmt.pct(r)}">
    <path d="M11,68 A${R},${R} 0 0,1 119,68" fill="none" stroke="var(--line)" stroke-width="11" stroke-linecap="round"/>
    <path d="M11,68 A${R},${R} 0 0,1 119,68" fill="none" stroke="${color}" stroke-width="11" stroke-linecap="round"
      stroke-dasharray="${(C * r).toFixed(1)} ${C.toFixed(1)}"/>
    <text x="65" y="58" text-anchor="middle" class="val" style="font-size:19px;font-weight:650">${fmt.pct(r)}</text>
    <text x="65" y="74" text-anchor="middle" class="axis">${esc(label)}</text>
  </svg>`;
};

/** Anneau de répartition (parts d'un total). */
export const donut = (parts, { size = 150, hole = 0.62 } = {}) => {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  const R = size / 2;
  const r = R * hole;
  let a0 = -Math.PI / 2;
  const arcs = parts
    .map((p, i) => {
      const a1 = a0 + (p.value / total) * Math.PI * 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const pt = (ang, rad) =>
        `${(R + rad * Math.cos(ang)).toFixed(2)},${(R + rad * Math.sin(ang)).toFixed(2)}`;
      const d = `M${pt(a0, R)} A${R},${R} 0 ${large},1 ${pt(a1, R)} L${pt(a1, r)} A${r},${r} 0 ${large},0 ${pt(a0, r)} Z`;
      a0 = a1;
      return `<path d="${d}" fill="${p.color ?? series(i)}" stroke="var(--bg)" stroke-width="2"><title>${esc(p.label)} — ${fmt.pct(p.value / total)}</title></path>`;
    })
    .join("");
  return svgFigure(
    `<svg viewBox="0 0 ${size} ${size}" class="chart" style="max-width:${size}px" role="img" %ARIA%>%TD%${arcs}</svg>`,
    {
      title: "Répartition",
      desc: parts
        .map((p) => `${p.label} : ${fmt.pct(p.value / total)}`)
        .join(" · "),
    },
  );
};

/** Carte de chaleur (matrice) — ex. latence par route × heure, erreurs par module. */
export const heatmap = (
  rows,
  cols,
  values,
  { cell = 26, color = COLORS.accent } = {},
) => {
  const max = Math.max(...values.flat(), 1);
  const padL = 110;
  const padT = 22;
  const w = padL + cols.length * cell + 8;
  const h = padT + rows.length * cell + 8;
  const cells = rows
    .flatMap((rl, y) =>
      cols.map((cl, x) => {
        const v = values[y]?.[x] ?? 0;
        return `<rect x="${padL + x * cell}" y="${padT + y * cell}" width="${cell - 2}" height="${cell - 2}" rx="2"
          fill="${color}" fill-opacity="${(0.08 + 0.92 * (v / max)).toFixed(3)}">
          <title>${esc(rl)} / ${esc(cl)} : ${fmt.int(v)}</title></rect>`;
      }),
    )
    .join("");
  const ylab = rows
    .map(
      (rl, y) =>
        `<text x="${padL - 8}" y="${padT + y * cell + cell / 2 + 2}" class="axis" text-anchor="end">${esc(rl)}</text>`,
    )
    .join("");
  const xlab = cols
    .map(
      (cl, x) =>
        `<text x="${padL + x * cell + cell / 2 - 1}" y="${padT - 8}" class="axis" text-anchor="middle">${esc(cl)}</text>`,
    )
    .join("");
  return svgFigure(
    `<svg viewBox="0 0 ${w} ${h}" class="chart" role="img" %ARIA%>%TD%${cells}${ylab}${xlab}</svg>`,
    {
      title: "Carte de chaleur",
      desc: `${rows.length} lignes × ${cols.length} colonnes, maximum ${fmt.int(max)}.`,
    },
  );
};

/** Waterfall (phases d'une requête, étapes d'un pipeline). */
export const waterfall = (bars, { width = 640, rowH = 22 } = {}) => {
  const padL = 110;
  const min = Math.min(...bars.map((b) => b.start));
  const max = Math.max(...bars.map((b) => b.start + b.duration));
  const span = max - min || 1;
  const body = bars
    .map((b, i) => {
      const x = padL + ((b.start - min) / span) * (width - padL - 90);
      const w = Math.max((b.duration / span) * (width - padL - 90), 2);
      const y = i * rowH + 4;
      return `<text x="0" y="${y + 13}" class="lbl">${esc(b.label)}</text>
        <rect x="${x}" y="${y + 3}" width="${w}" height="12" rx="2" fill="${b.color ?? series(i)}"/>
        <text x="${width - 84}" y="${y + 13}" class="val">${fmt.ms(b.duration)}</text>`;
    })
    .join("");
  return svgFigure(
    `<svg viewBox="0 0 ${width} ${bars.length * rowH + 10}" class="chart" role="img" %ARIA%>%TD%${body}</svg>`,
    {
      title: "Chronologie des phases",
      desc: bars.map((b) => `${b.label} : ${fmt.ms(b.duration)}`).join(" · "),
    },
  );
};

/** Onglets (aucune lib — `hidden` + ARIA, navigables au clavier ; tout s'imprime à plat). */
export const tabs = (items, { id = "tabs" } = {}) => `
<div class="tabs" id="${esc(id)}">
  <div role="tablist" class="tablist no-print">
    ${items
      .map(
        (t, i) =>
          `<button role="tab" id="${esc(id)}-t${i}" aria-controls="${esc(id)}-p${i}" aria-selected="${i === 0}"
             tabindex="${i === 0 ? 0 : -1}" class="tab">${esc(t.label)}</button>`,
      )
      .join("")}
  </div>
  ${items
    .map(
      (t, i) =>
        `<div role="tabpanel" id="${esc(id)}-p${i}" aria-labelledby="${esc(id)}-t${i}" class="tabpanel"${i ? " hidden" : ""}>
           <h3 class="print-only">${esc(t.label)}</h3>${t.body}</div>`,
    )
    .join("")}
</div>
<script>
(() => {
  const root = document.getElementById(${JSON.stringify(id)});
  const tabs = [...root.querySelectorAll('[role=tab]')];
  const panels = [...root.querySelectorAll('[role=tabpanel]')];
  const sel = (i) => {
    tabs.forEach((t, j) => { t.setAttribute("aria-selected", j === i); t.tabIndex = j === i ? 0 : -1; });
    panels.forEach((p, j) => { p.hidden = j !== i; });
    tabs[i].focus();
  };
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => sel(i));
    t.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") sel((i + 1) % tabs.length);
      if (e.key === "ArrowLeft") sel((i - 1 + tabs.length) % tabs.length);
    });
  });
  // À l'impression, tout doit être VISIBLE : un onglet masqué serait perdu du PDF.
  addEventListener("beforeprint", () => panels.forEach((p) => (p.hidden = false)));
  addEventListener("afterprint", () => panels.forEach((p, j) => (p.hidden = j !== tabs.findIndex((t) => t.getAttribute("aria-selected") === "true"))));
})();
</script>`;

/** Bloc repliable natif (`<details>`) — zéro JS, imprimé OUVERT. */
export const details = (summary, body, { open = false } = {}) =>
  `<details class="det"${open ? " open" : ""}><summary>${esc(summary)}</summary><div class="det-body">${body}</div></details>`;

/**
 * Liste RÉORDONNABLE par glisser-déposer (HTML5 Drag and Drop API).
 *
 * Usage type dans un rapport : laisser le lecteur classer des priorités, ordonner
 * un plan d'action, arbitrer des options — et **exporter son classement**.
 * Accessible : chaque élément se déplace aussi au clavier (Alt+↑/↓), sinon la
 * fonctionnalité n'existe que pour ceux qui tiennent une souris.
 */
export const sortableList = (
  items,
  { id = "dnd", onChangeExport = true } = {},
) => `
<ul class="dnd" id="${esc(id)}">
  ${items
    .map(
      (
        it,
        i,
      ) => `<li class="dnd-item" draggable="true" tabindex="0" data-id="${esc(it.id ?? i)}">
      <span class="grip no-print" aria-hidden="true">⠿</span>
      <span class="rank">${i + 1}</span>
      <span class="dnd-label">${it.html ?? esc(it.label)}</span>
    </li>`,
    )
    .join("")}
</ul>
${onChangeExport ? `<button class="ghost no-print" id="${esc(id)}-copy">Copier l'ordre</button>` : ""}
<script>
(() => {
  const list = document.getElementById(${JSON.stringify(id)});
  let dragged = null;
  const renumber = () => [...list.children].forEach((li, i) => (li.querySelector(".rank").textContent = i + 1));
  list.addEventListener("dragstart", (e) => {
    dragged = e.target.closest(".dnd-item");
    dragged.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", dragged.dataset.id); // requis par Firefox
  });
  list.addEventListener("dragend", () => { dragged?.classList.remove("dragging"); dragged = null; renumber(); });
  list.addEventListener("dragover", (e) => {
    e.preventDefault();                       // sans ça, aucun drop n'est autorisé
    e.dataTransfer.dropEffect = "move";
    const over = e.target.closest(".dnd-item");
    if (!over || over === dragged) return;
    const r = over.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    list.insertBefore(dragged, after ? over.nextSibling : over);
  });
  list.addEventListener("drop", (e) => e.preventDefault());
  // Équivalent CLAVIER — une poignée de drag n'est pas une interface accessible.
  list.addEventListener("keydown", (e) => {
    const li = e.target.closest(".dnd-item");
    if (!li || !e.altKey) return;
    if (e.key === "ArrowUp" && li.previousElementSibling) { list.insertBefore(li, li.previousElementSibling); e.preventDefault(); }
    if (e.key === "ArrowDown" && li.nextElementSibling) { list.insertBefore(li.nextElementSibling, li); e.preventDefault(); }
    li.focus(); renumber();
  });
  const copy = document.getElementById(${JSON.stringify(`${id}-copy`)});
  if (copy) copy.addEventListener("click", async () => {
    const txt = [...list.children].map((li, i) => (i + 1) + ". " + li.querySelector(".dnd-label").textContent.trim()).join("\\n");
    await navigator.clipboard.writeText(txt);
    copy.textContent = "Copié ✓";
    setTimeout(() => (copy.textContent = "Copier l'ordre"), 1500);
  });
})();
</script>`;

/** Filtre de recherche plein-texte sur un tableau (masque les lignes hors résultat). */
export const tableFilter = (tableId, { placeholder = "Filtrer…" } = {}) => `
<input type="search" class="filter no-print" id="f-${esc(tableId)}" placeholder="${esc(placeholder)}"
  aria-label="${esc(placeholder)}">
<script>
(() => {
  const inp = document.getElementById(${JSON.stringify(`f-${tableId}`)});
  const rows = [...document.querySelectorAll(${JSON.stringify(`#${tableId} tbody tr`)})];
  inp.addEventListener("input", () => {
    const q = inp.value.trim().toLowerCase();
    for (const r of rows) r.hidden = q && !r.textContent.toLowerCase().includes(q);
  });
})();
</script>`;

/** Export CSV d'un tableau (Blob + a[download] — aucune dépendance, aucun serveur). */
export const csvExport = (tableId, filename = "export.csv") => `
<button class="ghost no-print" id="csv-${esc(tableId)}">Exporter en CSV</button>
<script>
(() => {
  document.getElementById(${JSON.stringify(`csv-${tableId}`)}).addEventListener("click", () => {
    const t = document.getElementById(${JSON.stringify(tableId)});
    const esc = (s) => '"' + String(s).replace(/"/g, '""') + '"';   // RFC 4180
    const csv = [...t.rows].map((r) => [...r.cells].map((c) => esc(c.textContent.trim())).join(",")).join("\\r\\n");
    const url = URL.createObjectURL(new Blob(["\\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: ${JSON.stringify(filename)} });
    a.click();
    URL.revokeObjectURL(url);
  });
})();
</script>`;

/**
 * Mode PRÉSENTATION — le même document devient un jeu de diapositives.
 *
 * Oui, HTML fait « comme PowerPoint », et sans rien installer : plein écran natif
 * (Fullscreen API), une section = une diapo, navigation clavier / clic / balayage
 * tactile, barre de progression, compteur, et transition douce (View Transitions
 * quand le navigateur la propose, sinon un fondu CSS — jamais de dépendance).
 *
 * Le point fort par rapport à un vrai PowerPoint : **les diapos sont vivantes** —
 * le calculateur reste utilisable, les tableaux triables, les graphes lisibles.
 * On peut répondre à une question en séance au lieu de promettre un chiffre.
 *
 * Sortie : `Échap`. L'impression ignore le mode présentation (le PDF reste un
 * document, pas un diaporama).
 */
export const deckControls = ({ id = "deck" } = {}) => `
<button class="ghost no-print" id="${esc(id)}-btn" aria-pressed="false">Mode présentation</button>
<div class="deck-ui no-print" id="${esc(id)}-ui" hidden aria-live="polite">
  <div class="deck-bar"><span id="${esc(id)}-fill"></span></div>
  <div class="deck-nav">
    <button class="ghost" id="${esc(id)}-prev" aria-label="Diapositive précédente">◀</button>
    <span class="deck-count" id="${esc(id)}-count"></span>
    <button class="ghost" id="${esc(id)}-next" aria-label="Diapositive suivante">▶</button>
  </div>
</div>
<script>
(() => {
  const $ = (s) => document.getElementById(s);
  const btn = $(${JSON.stringify(`${id}-btn`)});
  const ui = $(${JSON.stringify(`${id}-ui`)});
  const fill = $(${JSON.stringify(`${id}-fill`)});
  const count = $(${JSON.stringify(`${id}-count`)});
  // Les sections sont collectées À L'ENTRÉE du mode, jamais au chargement du
  // script. Pourquoi : ce bloc s'exécute PENDANT le parsing, à l'endroit où il
  // est inséré. Placé en haut du document (le cas naturel : les boutons vont en
  // tête de page), aucune <section> n'existe encore dans le DOM — la collecte
  // rendait un tableau VIDE et la présentation affichait « 1 / 0 » sans jamais
  // changer de diapo. Collecter tard rend le composant indifférent à sa position.
  let secs = [];
  let on = false, i = 0;
  // Transition injectée ICI, pas dans la feuille statique : le validateur W3C ne
  // connaît pas encore les pseudo-éléments view-transition et rejette la règle.
  // Le CSS livré reste donc 100 % conforme, et le navigateur qui sait faire
  // reçoit quand même la transition (amélioration progressive).
  if (document.startViewTransition) {
    const st = document.createElement("style");
    st.textContent = "::view-transition-old(root),::view-transition-new(root){animation-duration:.25s}";
    document.head.appendChild(st);
  }

  const paint = () => {
    secs.forEach((s, j) => (s.style.display = j === i ? "block" : "none"));
    // Une diapo s'ouvre EN HAUT. Sans ça, la section hérite du défilement de la
    // précédente et l'orateur enchaîne sur un titre déjà passé.
    if (secs[i]) secs[i].scrollTop = 0;
    fill.style.width = ((i + 1) / secs.length) * 100 + "%";
    count.textContent = (i + 1) + " / " + secs.length;
  };
  // View Transitions si le navigateur sait : une diapo qui apparaît sèchement
  // casse le fil du discours. Sinon, transition CSS (dégradation silencieuse).
  const go = (n) => {
    const next = Math.max(0, Math.min(n, secs.length - 1));
    if (next === i) return;
    i = next;
    if (document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches)
      document.startViewTransition(paint);
    else paint();
  };
  const enter = async () => {
    secs = [...document.querySelectorAll("section.sec")];
    if (!secs.length) return; // rien à présenter : ne pas piéger l'utilisateur dans un mode vide
    on = true; i = 0;
    document.body.classList.add("deck");
    ui.hidden = false;
    btn.setAttribute("aria-pressed", "true");
    paint();
    try { await document.documentElement.requestFullscreen(); } catch { /* refusé : on reste en page */ }
  };
  const exit = async () => {
    on = false;
    document.body.classList.remove("deck");
    ui.hidden = true;
    btn.setAttribute("aria-pressed", "false");
    secs.forEach((s) => (s.style.display = ""));
    if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch {} }
  };
  btn.addEventListener("click", () => (on ? exit() : enter()));
  $(${JSON.stringify(`${id}-prev`)}).addEventListener("click", () => go(i - 1));
  $(${JSON.stringify(`${id}-next`)}).addEventListener("click", () => go(i + 1));
  addEventListener("keydown", (e) => {
    if (!on) return;
    if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") { e.preventDefault(); go(i + 1); }
    if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); go(i - 1); }
    if (e.key === "Home") go(0);
    if (e.key === "End") go(secs.length - 1);
    if (e.key === "Escape") exit();
  });
  // Balayage tactile — une présentation se pilote aussi depuis une tablette.
  let x0 = null;
  addEventListener("touchstart", (e) => { if (on) x0 = e.touches[0].clientX; }, { passive: true });
  addEventListener("touchend", (e) => {
    if (!on || x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 50) go(i + (dx < 0 ? 1 : -1));
    x0 = null;
  }, { passive: true });
  addEventListener("fullscreenchange", () => { if (!document.fullscreenElement && on) exit(); });
  // Imprimer PENDANT la présentation ne doit pas produire un PDF d'une seule diapo.
  addEventListener("beforeprint", () => secs.forEach((s) => (s.style.display = "")));
  addEventListener("afterprint", () => { if (on) paint(); });
})();
</script>`;

/**
 * Embarque les DONNÉES SOURCES du rapport dans la page (modèle Lighthouse).
 *
 * C'est ce qui retire au HTML son seul défaut irrécupérable face au Markdown :
 * un rapport HTML n'est plus un cul-de-sac illisible pour une machine. Le JSON
 * embarqué est **rejouable** (on régénère la page), **diffable** (on compare deux
 * runs), et **ré-ingérable par un LLM** (on lui donne les données, pas les balises).
 *
 * ⚠️ Le seul piège d'un JSON dans une page : la séquence `</script>` à l'intérieur
 * d'une chaîne FERME le bloc et injecte du HTML. On l'échappe. C'est exactement
 * la faille « improper output handling » (OWASP LLM05) : les données affichées par
 * un rapport (logs, messages d'erreur, noms de routes) ne sont PAS de confiance.
 */
export const embedData = (
  data,
  { id = "report-data", filename = "report-data.json" } = {},
) => {
  const json = JSON.stringify(data, null, 2)
    .replace(/<\/script/gi, "<\\/script")
    .replace(/<!--/g, "<\\!--");
  return `
<script type="application/json" id="${esc(id)}">${json}</script>
<button class="ghost no-print" id="${esc(id)}-dl">Télécharger les données (JSON)</button>
<script>
document.getElementById(${JSON.stringify(`${id}-dl`)}).addEventListener("click", () => {
  const raw = document.getElementById(${JSON.stringify(id)}).textContent;
  const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: ${JSON.stringify(filename)} });
  a.click();
  URL.revokeObjectURL(url);
});
</script>`;
};

/** Bouton d'impression (rappelle au lecteur que le PDF est soigné). */
export const printButton = (label = "Imprimer / PDF") =>
  `<button class="ghost no-print" onclick="print()">${esc(label)}</button>`;
