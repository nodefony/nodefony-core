// ─────────────────────────────────────────────────────────────────────────────
// Les FIGURES du dossier de performance, calculées depuis le jeu publié
// (`docs/performance/data/<version>.json`) — jamais saisies à la main.
//
// Pourquoi un registre. Une figure recopiée dans une page de prose diverge du
// chiffre qu'elle illustre dès la campagne suivante, et rien ne le voit : le
// graphe reste plausible. Ici, chaque figure est une FONCTION du jeu de données ;
// la prose l'appelle par son identifiant (`<!-- figure: budget-etages -->`) et le
// générateur du site refuse un identifiant inconnu.
//
// Deux étages, séparés exprès :
//   - `figureSpecs(data)` rend des SPÉCIFICATIONS pures (famille + options) — c'est
//     ce que le test confronte au JSON, nombre par nombre ;
//   - `renderFigures(data)` les dessine (SVG clair + sombre, ECharts côté serveur).
//
// Une figure dont la pièce manque au jeu n'est PAS rendue vide : elle est absente
// du registre, et la page qui l'appelle échoue en la nommant.
// ─────────────────────────────────────────────────────────────────────────────
import {
  bars,
  barsEtendue,
  cascade,
  couple,
  figure,
  heatmap,
  lines,
  treemap,
} from "../../nodefony-html-report/lib/echarts.mjs";

const FAMILLES = { bars, barsEtendue, cascade, heatmap, lines, treemap };

/** Libellé lisible d'un camp — le nom de banc ne dit rien au lecteur. */
export const CAMP_LABELS = {
  bare: "node:http nu",
  express: "Express nu",
  "express-fair": "Express équipé",
  "nest-fair": "NestJS équipé (Fastify)",
  "nest-fair-node": "NestJS équipé (node:http)",
  "express-fair-sqlite": "Express équipé + Drizzle",
  "nest-fair-sqlite": "NestJS équipé + Drizzle",
  nodefony: "Nodefony",
  "nodefony-orm": "Nodefony + Drizzle",
};

const STAGE_LABELS = {
  entry: "Node : analyse HTTP, socket, écriture",
  context: "contexte de requête",
  pipeline: "stockage asynchrone, CORS, gardes",
  route: "routage",
  action: "résolution de l'action",
  complet: "action, rendu, en-têtes",
};

const round = (v, n = 2) => Math.round(v * 10 ** n) / 10 ** n;
/** Un nombre dans une LÉGENDE se lit en français (« 45,9 »), jamais « 45.9 ». */
const fr = (v, n = 1) =>
  v.toLocaleString("fr-FR", { maximumFractionDigits: n });

/**
 * Part de Nodefony face à un témoin, avec son ÉTENDUE : la médiane publiée
 * (rapport de la paire), et les bornes que donnent les séries alternées —
 * la plus défavorable et la plus favorable des combinaisons série à série.
 */
export function shareWithRange(witness, subject, rapportPct) {
  const w = witness.series.map((s) => s.med);
  const n = subject.series.map((s) => s.med);
  return {
    med: round(10000 / rapportPct, 1),
    min: round((Math.min(...n) / Math.max(...w)) * 100, 1),
    max: round((Math.max(...n) / Math.min(...w)) * 100, 1),
  };
}

/** Les parts de Nodefony face à chaque témoin publié, route triviale puis base. */
function sharesSpec(d) {
  const rows = [];
  const fw = d.comparison?.frameworks ?? {};
  for (const p of d.comparison?.pairs ?? []) {
    const [a, b] = p.paire.split(" ↔ ");
    if (b !== "nodefony" || a === b || !fw[a] || !fw[b]) continue;
    rows.push({
      label: `${CAMP_LABELS[a] ?? a} — route triviale${p.separation === "nette" ? "" : " (dans le bruit)"}`,
      ...shareWithRange(fw[a], fw[b], p.rapportPct),
    });
  }
  const app = d.applicative;
  const LABEL = {
    "read-write": "lecture + écriture",
    "post-valid": "POST validé",
    "post-422": "POST refusé (422)",
  };
  // Paires { cas, témoin } : le cas publié est lu tel quel, jamais recopié.
  const ormCases = [
    ...(app?.frameworks?.["express-fair-sqlite"]
      ? [
          {
            ref: "express-fair-sqlite",
            cas: {
              id: "read-write",
              frameworks: app.frameworks,
              rapportPct: app.rapportPct,
            },
          },
        ]
      : []),
    ...(app?.cases ?? []).map((cas) => ({ cas, ref: "express-fair-sqlite" })),
    ...(d.applicativeNest?.cases ?? []).map((cas) => ({
      cas,
      ref: "nest-fair-sqlite",
    })),
  ];
  for (const { cas: c, ref } of ormCases) {
    const w = c.frameworks?.[ref];
    const n = c.frameworks?.["nodefony-orm"];
    if (!w?.series || !n?.series) continue;
    // Ici le rapport publié est Nodefony / témoin (et non témoin / Nodefony).
    rows.push({
      label: `${CAMP_LABELS[ref]} — ${LABEL[c.id] ?? c.id}`,
      ...shareWithRange(w, n, 10000 / c.rapportPct),
    });
  }
  if (rows.length === 0) return null;
  return {
    id: "parts",
    famille: "barsEtendue",
    titre: "Débit de Nodefony, en % de chaque témoin",
    desc: "barre = rapport de la paire alternée ; trait = étendue entre séries. 100 % = même débit.",
    options: {
      axeValeur: "% du témoin",
      accent: -1,
      largeur: 900,
      hauteur: 66 + rows.length * 30,
      data: rows,
    },
  };
}

/** Les parts restreintes au cas applicatif (base de données dans la boucle). */
function ormSharesSpec(d) {
  const all = sharesSpec(d);
  const rows =
    all?.options.data.filter((r) => r.label.includes("+ Drizzle")) ?? [];
  if (rows.length === 0) return null;
  return {
    ...all,
    id: "parts-applicatif",
    titre: "Avec une base : débit de Nodefony, en % de chaque témoin",
    desc: "même ORM, même pilote, même schéma ; barre = rapport de la paire, trait = étendue entre séries. 100 % = même débit.",
    options: { ...all.options, hauteur: 66 + rows.length * 30, data: rows },
  };
}

/** Le budget d'une requête triviale, étage par étage (bissection par coupe). */
function stagesSpec(d) {
  const s = d.stages;
  if (!s?.stages?.length) return null;
  // Écart entre CUMULS médians successifs, et non médiane des écarts par
  // manche (`stepUs`) : la médiane d'une somme n'est pas la somme des
  // médianes, et la cascade doit retomber sur le total publié.
  const postes = s.stages.map((r, i) => ({
    nom: STAGE_LABELS[r.stage] ?? r.stage,
    delta: round(i === 0 ? r.cumulUs : r.cumulUs - s.stages[i - 1].cumulUs, 2),
  }));
  return {
    id: "budget-etages",
    famille: "cascade",
    titre: "Où part le temps d'une requête triviale",
    desc: `µs de CPU du fil principal par requête, médiane de ${s.rounds} manches — total ${fr(s.stages.at(-1).cumulUs)} µs, contre ${fr(s.witnessUs)} µs pour ${CAMP_LABELS[s.witness] ?? s.witness}.${s.indicative ? " Une coupe disperse au-delà de 3 % : ordre de grandeur, pas verdict." : ""}`,
    options: { axeValeur: "µs/req", largeur: 900, hauteur: 380, postes },
  };
}

/** Ce que chaque framework fait faire à Node, fonction à fonction (profil). */
function nodeGapSpec(d) {
  const p = d.profile;
  if (!p?.node?.length) return null;
  // `(program)` et `(idle)` ne sont pas des fonctions de Node : du temps hors
  // JavaScript, que le profil range à part. Le ramasse-miettes, lui, reste.
  const top = [...p.node]
    .filter((r) => !/^\((program|idle)\)/.test(r.fn))
    .sort((x, y) => Math.abs(y.gap) - Math.abs(x.gap))
    .slice(0, 10);
  // Le nom de trame porte « fonction node:internal/module:ligne » : on garde la
  // fonction et le module, assez pour chercher, pas assez pour déborder.
  const label = (fn) =>
    fn
      .replace(/\s+node:internal\/([\w/]+):\d+$/, " · $1")
      .replace(/\s+\S*:\d+$/, "");
  return {
    id: "ecart-node",
    famille: "bars",
    titre: "Ce que chaque framework fait faire à Node",
    desc: `µs par requête, profil V8 — les dix fonctions de Node dont le coût diffère le plus. Le profil sur-attribue : lire les écarts relatifs, pas les absolus.`,
    options: {
      horizontal: true,
      axeValeur: "µs/req",
      decimales: true,
      largeur: 900,
      series: [p.a, p.b].map((camp) => ({
        nom: CAMP_LABELS[camp] ?? camp,
        data: top.map((r) => [label(r.fn), round(r[camp], 2)]),
      })),
    },
  };
}

/** Le code propre de Nodefony, par module (profil). */
function ownCodeSpec(d) {
  const own = d.profile?.own?.nodefony;
  if (!own?.origins?.length) return null;
  return {
    id: "code-propre",
    famille: "treemap",
    titre: `Le code propre de Nodefony : ${fr(own.totalUs)} µs par requête`,
    desc: "surface = µs par requête, profil V8, par module d'origine",
    options: {
      largeur: 900,
      hauteur: 320,
      racine: own.origins.map((o) => ({
        nom: o.origin,
        valeur: round(o.us, 2),
      })),
    },
  };
}

/** Débit binaire : coût d'un message selon sa taille, par transport. */
function binarySpec(d) {
  const r = d.binary?.results;
  if (!r?.length) return null;
  const camps = [...new Set(r.map((x) => x.camp))];
  const NOMS = {
    grpc: "gRPC (Connect)",
    socket: "socket Nodefony (CBOR)",
    "h2-nu": "HTTP/2 nu",
    "h2-écriture": "HTTP/2 + écriture Connect",
  };
  const worst = Math.max(...r.map((x) => x.spreadPct));
  return {
    id: "binaire",
    famille: "lines",
    titre: "Coût d'un message binaire selon sa taille",
    desc: `µs par message (échelle logarithmique) selon sa taille en octets, médiane de ${d.binary.decor?.runs ?? "?"} runs.${worst > 3 ? ` Dispersion jusqu'à ${fr(worst, 0)} % : seuls les ordres de grandeur se lisent.` : ""}`,
    options: {
      log: true,
      lisse: false,
      axeY: "µs/msg",
      largeur: 900,
      series: camps.map((c) => ({
        nom: NOMS[c] ?? c,
        points: r
          .filter((x) => x.camp === c)
          .map((x) => [String(x.bytes), round(x.usPerMsg, 2)]),
      })),
    },
  };
}

/** La qualité de chaque série publiée : sa dispersion, camp par camp. */
function qualitySpec(d) {
  const lignes = [];
  const add = (label, camp) => {
    if (camp?.series?.length) lignes.push([label, camp.series]);
  };
  for (const [id, camp] of Object.entries(d.comparison?.frameworks ?? {}))
    add(`${CAMP_LABELS[id] ?? id} — route triviale`, camp);
  for (const [id, camp] of Object.entries(d.applicative?.frameworks ?? {}))
    add(`${CAMP_LABELS[id] ?? id} — lecture + écriture`, camp);
  if (lignes.length === 0) return null;
  const nCols = Math.max(...lignes.map(([, s]) => s.length));
  return {
    id: "qualite",
    famille: "heatmap",
    titre: "Dispersion de chaque série publiée",
    desc: "% entre le run le plus lent et le plus rapide d'une série — refusée au-delà de 3 %",
    options: {
      largeur: 900,
      hauteur: 80 + lignes.length * 30,
      min: 0,
      max: 3,
      x: Array.from({ length: nCols }, (_, i) => `série ${i + 1}`),
      y: lignes.map(([l]) => l),
      cellules: lignes.flatMap(([, s], j) =>
        s.map((x, i) => [i, j, round(x.dispersionPct, 1)]),
      ),
    },
  };
}

/**
 * Les spécifications de toutes les figures que ce jeu permet de dessiner.
 * @returns {Map<string, {id, famille, titre, desc, options}>}
 */
export function figureSpecs(data) {
  const specs = [
    sharesSpec(data),
    ormSharesSpec(data),
    stagesSpec(data),
    nodeGapSpec(data),
    ownCodeSpec(data),
    binarySpec(data),
    qualitySpec(data),
  ].filter(Boolean);
  return new Map(specs.map((s) => [s.id, s]));
}

/** Les figures dessinées (HTML d'une `<figure>` clair + sombre), par identifiant. */
export function renderFigures(data) {
  const out = new Map();
  for (const [id, s] of figureSpecs(data)) {
    out.set(
      id,
      figure(couple(FAMILLES[s.famille], s.options), {
        titre: s.titre,
        desc: s.desc,
      }),
    );
  }
  return out;
}

/**
 * Remplace chaque `<!-- figure: id -->` d'un HTML rendu par la figure du
 * registre. Un identifiant inconnu LÈVE en le nommant : une page qui annonce une
 * figure absente ne se publie pas avec un trou.
 * @param {string} html
 * @param {Map<string, string>} figures - sortie de `renderFigures`.
 * @param {string} [source] - nom de la page, pour l'erreur.
 */
export function insertFigures(html, figures, source = "page") {
  return html.replace(/<!--\s*figure:\s*([\w-]+)\s*-->/g, (_, id) => {
    const f = figures.get(id);
    if (!f)
      throw new Error(
        `${source} : figure « ${id} » inconnue ou sans données — connues : ${[...figures.keys()].join(", ") || "aucune"}`,
      );
    return f;
  });
}
