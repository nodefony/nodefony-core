#!/usr/bin/env node
/**
 * Auto-contrôle du moteur de graphes ECharts — les CONTRATS, pas l'esthétique.
 *
 * Ce que ce fichier garde, et pourquoi chacun a déjà été enfreint :
 *
 * 1. **Aucun script, aucune animation dans le SVG** — c'est la promesse du
 *    rendu serveur ; ECharts injecte des animations CSS dès qu'on oublie
 *    `animation: false`, et la figure se met à bouger à l'impression.
 * 2. **Les nombres sont français** — le point décimal anglais est le défaut
 *    d'ECharts, et il est passé en production une première fois (« -0.04 Mo/h »).
 * 3. **Chaque figure est énonçable** — sans `aria-label`, un graphe n'existe pas
 *    pour un lecteur d'écran.
 * 4. **Le couple clair/sombre est un vrai couple** — deux rendus qui diffèrent
 *    par les couleurs et se superposent par la géométrie.
 *
 * Chaque contrôle est éprouvé sur un TÉMOIN FAUTIF : un test qui n'a jamais vu
 * rouge ne prouve rien. `--prove` montre les témoins tomber.
 *
 * ```bash
 * node .claude/skills/nodefony-html-report/scripts/echarts.selftest.mjs
 * node .claude/skills/nodefony-html-report/scripts/echarts.selftest.mjs --prove
 * ```
 */
import {
  bars,
  barsEtendue,
  lines,
  scatter,
  boxplot,
  pie,
  gauge,
  radar,
  sankey,
  heatmap,
  treemap,
  reseau,
  funnel,
  cascade,
  couple,
  figure,
  nombre,
} from "../lib/echarts.mjs";

const PROUVE = process.argv.includes("--prove");
let rouges = 0;
const cas = (nom, ok, detail = "") => {
  if (!ok) rouges += 1;
  console.log(
    `  ${ok ? "✅" : "❌"} ${nom}${ok || !detail ? "" : ` — ${detail}`}`,
  );
};

/* ── Les treize familles, avec des données minimales mais réalistes ─────── */

const FAMILLES = {
  bars: () =>
    bars({
      titre: "Barres",
      axeValeur: "req/s",
      series: [
        {
          nom: "débit",
          data: [
            ["A", 12226],
            ["B", 13333],
          ],
        },
      ],
      horizontal: true,
    }),
  barsEtendue: () =>
    barsEtendue({
      titre: "Étendue",
      axeValeur: "req/s",
      data: [{ label: "A", med: 12226, min: 12192, max: 12258 }],
    }),
  lines: () =>
    lines({
      titre: "Courbe",
      axeX: "routes",
      axeY: "µs",
      series: [
        {
          nom: "scan",
          points: [
            [16, 0.18],
            [136, 0.54],
            [1000, 2.1],
          ],
        },
      ],
    }),
  scatter: () =>
    scatter({
      titre: "Nuage",
      axeX: "p99 (ms)",
      axeY: "req/s",
      points: [{ nom: "A", x: 9.57, y: 12226, accent: true }],
    }),
  boxplot: () =>
    boxplot({
      titre: "Boîtes",
      axeValeur: "ms",
      data: [{ label: "A", valeurs: [16.75, 9.57, 8.78] }],
    }),
  pie: () =>
    pie({
      titre: "Anneau",
      parts: [
        { nom: "a", valeur: 39 },
        { nom: "b", valeur: 27 },
      ],
    }),
  gauge: () =>
    gauge({ titre: "Jauge", valeur: -0.04, min: -4, max: 4, unite: "Mo/h" }),
  radar: () =>
    radar({
      titre: "Radar",
      axes: [{ nom: "x" }, { nom: "y" }, { nom: "z" }],
      series: [{ nom: "A", valeurs: [0.8, 0.6, 0.9] }],
    }),
  sankey: () =>
    sankey({
      titre: "Sankey",
      noeuds: [{ nom: "Requête" }, { nom: "Node" }, { nom: "Framework" }],
      liens: [
        { de: "Requête", vers: "Node", valeur: 23.2 },
        { de: "Requête", vers: "Framework", valeur: 16.09 },
      ],
    }),
  heatmap: () =>
    heatmap({
      titre: "Chaleur",
      x: ["r1", "r2"],
      y: ["A", "B"],
      cellules: [
        [0, 0, 1.2],
        [1, 0, 0.5],
        [0, 1, 0.3],
        [1, 1, 1.8],
      ],
    }),
  treemap: () =>
    treemap({
      titre: "Arbre",
      racine: [{ nom: "m", enfants: [{ nom: "a", valeur: 15 }] }],
    }),
  reseau: () =>
    reseau({
      titre: "Réseau",
      noeuds: [{ nom: "http" }, { nom: "core" }],
      liens: [{ de: "http", vers: "core" }],
    }),
  funnel: () =>
    funnel({
      titre: "Entonnoir",
      etapes: [
        { nom: "a", valeur: 1000 },
        { nom: "b", valeur: 870 },
      ],
    }),
  cascade: () =>
    cascade({
      titre: "Cascade",
      axeValeur: "%",
      postes: [{ nom: "a", delta: -7.3 }],
    }),
};

/* ── Les quatre contrats ────────────────────────────────────────────────── */

/** Le SVG ne doit rien exécuter : ni script, ni animation. */
const statique = (svg) => !/<script|<animate|@keyframes|animation:/i.test(svg);

/** Aucun nombre écrit avec un point décimal (le défaut anglais d'ECharts). */
const nombresFrancais = (svg) => {
  const textes = [...svg.matchAll(/>([^<>]+)</g)].map((m) => m[1]);
  return !textes.some((t) => /^-?\d{1,3}(?:[  ]?\d{3})*\.\d/.test(t.trim()));
};

/** Une figure s'énonce. */
const enonce = (svg) =>
  /role="img"/.test(svg) && /aria-label="[^"]+"/.test(svg);

console.log("━━ les 14 familles rendent un SVG conforme");
const rendus = {};
for (const [nom, fabrique] of Object.entries(FAMILLES)) {
  let svg = "";
  let erreur = null;
  try {
    svg = fabrique();
  } catch (e) {
    erreur = e.message;
  }
  rendus[nom] = svg;
  cas(
    `${nom} — rend un SVG`,
    !erreur && svg.startsWith("<svg") && svg.length > 500,
    erreur ?? `${svg.length} octets`,
  );
  cas(`${nom} — statique (0 script, 0 animation)`, statique(svg));
  cas(`${nom} — nombres en français`, nombresFrancais(svg));
  cas(`${nom} — énonçable (role + aria-label)`, enonce(svg));
}

console.log("━━ le couple clair/sombre");
const c = couple(bars, {
  titre: "Couple",
  axeValeur: "req/s",
  series: [{ nom: "d", data: [["A", 12226]] }],
});
const viewBox = (s) =>
  /viewBox="([^"]*)"/.exec(s)?.[1] ?? /width="(\d+)"/.exec(s)?.[1];
cas("les deux rendus DIFFÈRENT par les couleurs", c.clair !== c.sombre);
cas(
  "les deux rendus ont la MÊME géométrie",
  viewBox(c.clair) === viewBox(c.sombre),
);
cas("l'encre du sombre est claire", c.sombre.includes("#e8eaed"));
cas("l'encre du clair est sombre", c.clair.includes("#1a1d21"));
const frag = figure(c, { titre: "T", desc: "D" });
cas(
  "figure() enveloppe les deux",
  /g-clair/.test(frag) && /g-sombre/.test(frag),
);
cas(
  "figure() échappe le titre",
  figure(c, { titre: "<b>x" }).includes("&lt;b&gt;x"),
);

console.log("━━ le formateur");
cas("12226 → « 12 226 »", nombre(12226).replace(/ | /g, " ") === "12 226");
cas("-0.04 → « -0,04 »", nombre(-0.04, true).includes(","));
cas("une valeur absente rend un tiret", nombre(undefined) === "—");

/* ── Les témoins fautifs : chaque contrôle DOIT tomber sur eux ───────────── */

console.log("━━ témoins fautifs — les contrôles doivent les REFUSER");
const temoins = [
  ["un SVG qui anime", "<svg><style>@keyframes a{}</style></svg>", statique],
  ["un SVG qui script", "<svg><script>x()</script></svg>", statique],
  ["un nombre anglais", "<svg><text>12 226.45</text></svg>", nombresFrancais],
  ["un nombre anglais court", "<svg><text>-0.04</text></svg>", nombresFrancais],
  ["un SVG muet", "<svg width='10'></svg>", enonce],
];
for (const [nom, faux, controle] of temoins) {
  const refuse = !controle(faux);
  cas(`refusé : ${nom}`, refuse);
  if (PROUVE && refuse) console.log(`       (témoin : ${faux.slice(0, 52)}…)`);
}

console.log(
  rouges === 0
    ? `\n━━ tout vert — ${Object.keys(FAMILLES).length} familles, 4 contrats, ${temoins.length} témoins refusés`
    : `\n━━ ${rouges} ROUGE(S)`,
);
process.exit(rouges === 0 ? 0 : 1);
