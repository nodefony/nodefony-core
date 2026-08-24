#!/usr/bin/env node
/**
 * Construit la page « Un agent sait-il développer avec Nodefony ? ».
 *
 * ELLE NE MESURE RIEN. Le banc (`nodefony-devkit-bench`) lance de vrais agents,
 * coûte de l'argent et prend des heures ; sa sortie est COMMITÉE dans
 * `docs/devkit/data/<version>.json`. Cette page n'est qu'un rendu de ce jeu —
 * déterministe, rejouable, et indépendant de la machine qui l'exécute. C'est le
 * même contrat que le site de performance, pour la même raison : un chiffre doit
 * rester attaché à sa version, définitivement.
 *
 * ```bash
 * node scripts/build-devkit-report.mjs [--data docs/devkit/data/10.0.0.json] [--out tmp/devkit.html]
 * ```
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import {
  doc,
  section,
  cards,
  table,
  tableFilter,
  csvExport,
  warn,
  note,
  details,
  printButton,
  deckControls,
  fmt,
} from "../.claude/skills/nodefony-html-report/lib/report.mjs";
import {
  bars,
  barsEtendue,
  scatter,
  gauge,
  heatmap,
  couple,
  figure,
  nombre,
  STYLE_GRAPHES,
  PALETTE,
} from "../.claude/skills/nodefony-html-report/lib/echarts.mjs";

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const DATA = arg("data", "docs/devkit/data/10.0.0.json");
const OUT = arg("out", "tmp/devkit.html");

const D = JSON.parse(readFileSync(DATA, "utf8"));
const T = D.taches;
const P = D.provenance;
const G = D.totaux;

const echecs = T.filter((t) => t.verdict === "FAIL");
const stablesRouges = echecs.filter((t) => t.passesReussies === 0);
const instables = T.filter((t) => !t.stable);
const parTours = [...T]
  .filter((t) => t.tours)
  .sort((a, b) => b.tours - a.tours);

/* ── 1. Le verdict ──────────────────────────────────────────────────────── */

const verdict = section(
  "Le verdict",
  cards([
    {
      k: "Tâches réussies",
      v: `${G.reussies}/${G.tachesJugees}`,
      sub: `${fmt.pct(G.tauxReussite)} — un verdict n'est acquis qu'à l'unanimité des ${P.passes} passes`,
    },
    {
      k: "Échecs constants",
      v: String(stablesRouges.length),
      sub: "ratés aux trois passes — ce sont des trous, pas des aléas",
    },
    {
      k: "Résultats instables",
      v: String(instables.length),
      sub: "réussis une ou deux fois sur trois : le guidage y est au fil du rasoir",
    },
    {
      k: "Effort médian",
      v: String(G.toursMedian),
      unit: "tours",
      sub: `de ${Math.min(...T.map((t) => t.tours || 999))} à ${Math.max(...T.map((t) => t.tours || 0))} selon la tâche`,
    },
  ]) +
    figure(
      couple(gauge, {
        titre: "Part des tâches réussies",
        sousTitre: `${P.passes} passes, verdict à l'unanimité`,
        valeur: G.tauxReussite * 100,
        min: 0,
        max: 100,
        unite: "%",
        zones: [
          [0.6, "#D55E00"],
          [0.85, "#E69F00"],
          [1, "#009E73"],
        ],
        largeur: 560,
        hauteur: 260,
      }),
      { desc: "Rouge sous 60 %, orange jusqu'à 85 %, vert au-delà." },
    ) +
    note(
      `<strong>Ce que ce banc mesure, et ce qu'il ne mesure pas.</strong> Il lâche un agent muni du
       modèle le plus FAIBLE de sa famille dans une application fraîchement générée, avec une tâche
       à accomplir et aucune indication. La question n'est donc pas « un développeur y arriverait-il ? »
       mais « l'application se laisse-t-elle DÉCOUVRIR sans qu'on la connaisse ? ». Un modèle plus
       fort compenserait les trous en devinant juste — c'est exactement ce qu'on cherche à éviter de
       mesurer.`,
    ),
  { break: "avoid" },
);

/* ── 2. Ce qui passe, ce qui casse ──────────────────────────────────────── */

const couleurTache = (t) =>
  t.passesReussies === 3
    ? PALETTE[2]
    : t.passesReussies === 0
      ? PALETTE[1]
      : PALETTE[4];

const stabilite = section(
  "1 · Ce qui passe, ce qui casse — et ce qui hésite",
  `<p>Chaque tâche est jouée <strong>${P.passes} fois</strong>, décor remis à zéro entre chaque.
    La barre donne le nombre de passes réussies : <strong>3 sur 3</strong> est un acquis,
    <strong>0 sur 3</strong> un trou, et tout ce qui est entre les deux signale un guidage qui ne
    tient qu'à un fil — la tâche est réussie ou ratée selon la façon dont l'agent aborde le
    problème, ce qui est le contraire d'un outillage qui guide.</p>` +
    figure(
      couple(bars, {
        titre: "Passes réussies par tâche",
        sousTitre:
          "sur 3 — vert : acquis · orange : instable · rouge : jamais réussi",
        axeValeur: "passes",
        horizontal: true,
        largeur: 700,
        series: [
          {
            nom: "passes réussies",
            data: [...T]
              .sort(
                (a, b) => a.passesReussies - b.passesReussies || a.id - b.id,
              )
              .map((t) => [
                `${t.id} · ${t.nom.slice(0, 46)}`,
                t.passesReussies,
              ]),
            couleurs: [...T]
              .sort(
                (a, b) => a.passesReussies - b.passesReussies || a.id - b.id,
              )
              .map(couleurTache),
          },
        ],
      }),
      {
        desc: "Une tâche à 1 ou 2 sur 3 ne dit pas « presque réussi » : elle dit « au hasard ».",
      },
    ) +
    figure(
      couple(heatmap, {
        titre: "Détail passe par passe",
        sousTitre: "1 = réussie, 0 = ratée",
        x: Array.from({ length: P.passes }, (_, i) => `passe ${i + 1}`),
        y: echecs
          .concat(instables.filter((t) => t.verdict === "PASS"))
          .map((t) => `${t.id}`),
        cellules: echecs
          .concat(instables.filter((t) => t.verdict === "PASS"))
          .flatMap((t, j) =>
            Array.from({ length: P.passes }, (_, i) => [
              i,
              j,
              i < t.passesReussies ? 1 : 0,
            ]),
          ),
        min: 0,
        max: 1,
        largeur: 520,
        hauteur: 300,
      }),
      {
        desc: "Seules les tâches qui ont échoué au moins une fois sont montrées — les autres sont vertes trois fois.",
      },
    ),
);

/* ── 3. L'effort ────────────────────────────────────────────────────────── */

const effort = section(
  "2 · L'effort — le même défaut, vu par l'autre bout",
  `<p>Un outillage qui finit par donner la bonne réponse au bout de soixante-dix allers-retours a
    échoué autrement : plus lentement, plus cher, et sur un fil — chaque tour est une occasion de
    partir dans une impasse. <strong>Le nombre de tours n'est pas une métrique de confort</strong> :
    c'est ce que l'agent n'a pas trouvé du premier coup.</p>` +
    figure(
      couple(barsEtendue, {
        titre: "Tours par tâche — les douze plus coûteuses",
        sousTitre: "médiane des 3 passes, avec l'étendue observée",
        axeValeur: "tours",
        largeur: 700,
        data: parTours.slice(0, 12).map((t) => ({
          label: `${t.id} · ${t.nom.slice(0, 40)}`,
          med: t.tours,
          min: Math.min(
            ...(t.toursParPasse.length ? t.toursParPasse : [t.tours]),
          ),
          max: Math.max(
            ...(t.toursParPasse.length ? t.toursParPasse : [t.tours]),
          ),
        })),
      }),
      {
        desc: "Une étendue large signale une tâche dont l'issue dépend du chemin pris.",
      },
    ) +
    figure(
      couple(scatter, {
        titre: "Effort et résultat",
        sousTitre: "chaque point est une tâche",
        axeX: "tours",
        axeY: "passes réussies",
        largeur: 620,
        hauteur: 320,
        points: T.filter((t) => t.tours).map((t) => ({
          nom: String(t.id),
          x: t.tours,
          y: t.passesReussies,
          accent: t.verdict === "FAIL",
        })),
      }),
      {
        desc: "En bas à droite : cher ET raté. C'est là que le devkit doit gagner d'abord.",
      },
    ) +
    note(
      `<strong>Les tâches qui échouent sont aussi les plus chères.</strong> Les deux mesures ne sont
       pas indépendantes : l'agent qui ne trouve pas cherche, et le nombre de tours est le prix de
       cette recherche. Réduire les échecs et réduire l'effort sont donc le même chantier.`,
    ),
);

/* ── 4. Ce que l'agent n'a pas trouvé ───────────────────────────────────── */

const trous = section(
  "3 · Ce que l'agent a cherché sans trouver",
  `<p>La partie la plus actionnable de ce rapport. Chaque ligne est un sujet sur lequel une
    application Nodefony ne se laisse pas découvrir assez vite.</p>` +
    table(
      [
        { label: "#", align: "right" },
        { label: "Sujet", strong: true },
        { label: "Passes réussies", align: "right" },
        { label: "Tours", align: "right" },
        { label: "Lecture" },
      ],
      echecs.map((t) => [
        String(t.id),
        t.nom,
        `${t.passesReussies}/${P.passes}`,
        String(t.tours ?? "—"),
        t.passesReussies === 0
          ? "<strong>trou constant</strong> — jamais réussi"
          : t.passesReussies === 1
            ? "guidage faible — réussi par exception"
            : "au fil du rasoir",
      ]),
      { sortable: true, id: "t-echecs" },
    ) +
    warn(
      stablesRouges.length
        ? `<strong>${stablesRouges.length} sujets échouent aux trois passes : ${stablesRouges
            .map((t) => `« ${t.nom} »`)
            .join(
              " et ",
            )}.</strong> Ce ne sont pas des aléas de modèle — sur ces sujets, un agent
           au modèle faible n'y arrive <em>jamais</em>. Ce sont les deux premiers à instruire au
           transcript : lire ce que l'agent a cherché, et ce qu'il a fini par inventer.`
        : `Aucun sujet n'échoue aux trois passes.`,
    ),
);

/* ── 5. Le MCP ──────────────────────────────────────────────────────────── */

const mcp = section(
  "4 · La porte MCP : atteinte, pas adoptée",
  `<p>Le décor de cette campagne rend la porte MCP de l'application <strong>joignable et
    authentifiée</strong> — l'agent peut interroger l'application en marche au lieu de lire ses
    sources. Il l'a fait <strong>${G.appelsMcp} fois, sur ${G.tachesAvecMcp} tâches</strong> :</p>` +
    figure(
      couple(bars, {
        titre: "Appels à la porte MCP",
        sousTitre: `${G.tachesAvecMcp} tâches sur ${G.tachesJugees} l'ont utilisée`,
        axeValeur: "appels",
        horizontal: true,
        largeur: 560,
        series: [
          {
            nom: "appels",
            data: T.filter((t) => t.appelsMcp > 0).map((t) => [
              `${t.id} · ${t.nom.slice(0, 40)}`,
              t.appelsMcp,
            ]),
          },
        ],
      }),
      {
        desc: "Les autres tâches n'ont jamais touché la porte, alors qu'elle répondait.",
      },
    ) +
    warn(
      `<strong>Disponible ne veut pas dire adopté.</strong> ${G.tachesJugees - G.tachesAvecMcp}
       tâches sur ${G.tachesJugees} n'ont pas ouvert cette porte. On ne peut donc rien conclure du
       gain qu'elle apporte : les trois tâches qui s'en sont servies réussissent, mais elles
       réussissaient peut-être déjà. <strong>Le delta reste à mesurer</strong>, par une campagne
       identique menée porte fermée — le seul protocole qui ne fasse varier qu'une chose.`,
    ),
);

/* ── 6. Décor ───────────────────────────────────────────────────────────── */

const decor = section(
  "Décor, protocole et rejouabilité",
  table(
    [{ label: "Élément" }, { label: "Valeur" }],
    [
      ["Agent", `${P.agent} — modèle <code>${P.model}</code>`],
      ["Décor", P.decor],
      ["Passes", `${P.passes}, verdict à l'unanimité`],
      ["Machine", P.machine],
      ["Node.js", P.node],
      ["Mesuré le", (P.measuredAt ?? "").slice(0, 10)],
      ["État du code", `<code>${P.headCommit}</code>`],
      ["Coût de la campagne", `≈ ${nombre(G.coutTotalUsd, true)} $ d'agents`],
    ],
    { id: "t-decor" },
  ) +
    note(`<strong>Protocole.</strong> ${P.protocole}`) +
    details(
      "Toutes les tâches, avec leur effort",
      table(
        [
          { label: "#", align: "right" },
          { label: "Tâche" },
          { label: "Verdict", strong: true },
          { label: "Passes", align: "right" },
          { label: "Tours", align: "right" },
          { label: "Coût médian", align: "right" },
          { label: "MCP", align: "right", dim: true },
        ],
        T.map((t) => [
          String(t.id),
          t.nom,
          t.verdict,
          `${t.passesReussies}/${P.passes}`,
          String(t.tours ?? "—"),
          t.coutUsdMedian ? `${nombre(t.coutUsdMedian, true)} $` : "—",
          String(t.appelsMcp),
        ]),
        { sortable: true, id: "t-toutes" },
      ) +
        tableFilter("t-toutes") +
        csvExport("t-toutes", "devkit-taches.csv"),
    ) +
    `<pre><code># rejouer la campagne (elle lance de VRAIS agents et coûte de l'argent)
NF_DEVKIT_BENCH_MCP=auth node .claude/skills/nodefony-devkit-bench/scripts/bench-discoverability.mjs --runs 3

# agréger des passes déjà jouées, sans redérouler
node .claude/skills/nodefony-devkit-bench/scripts/bench-discoverability.mjs --analyze-only &lt;run1&gt;,&lt;run2&gt;

# cette page
node scripts/build-devkit-report.mjs</code></pre>`,
  { break: "before" },
);

/* ── La page ────────────────────────────────────────────────────────────── */

const html = doc({
  title: "Nodefony — un agent sait-il développer avec ce framework ?",
  subtitle: `Campagne ${D.version} — ${G.reussies} tâches réussies sur ${G.tachesJugees}, ${P.passes} passes, verdict à l'unanimité. Ce que l'agent trouve, ce qu'il cherche, et ce qu'il finit par inventer.`,
  sections: [verdict, stabilite, effort, trous, mcp, decor],
  data: D,
  style: STYLE_GRAPHES,
  footer:
    `${deckControls()} ${printButton()} — Généré par <code>node scripts/build-devkit-report.mjs</code>. ` +
    `Mesures versionnées dans <code>${DATA}</code> : la page se rejoue et se compare d'une release à l'autre.`,
});

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log(
  `✅ ${OUT} — ${(html.length / 1024).toFixed(0)} Ko · ${T.length} tâches`,
);
