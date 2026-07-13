/**
 * demo.mjs — vitrine ET test de non-régression de `lib/report.mjs`.
 *
 * Exerce TOUS les composants avec des données factices. Si un composant casse
 * (SVG mal formé, JS en erreur, saut de page absurde), ça se voit ici avant de
 * partir dans un vrai rapport.
 *
 *   node .claude/skills/nodefony-html-report/scripts/demo.mjs tmp/demo.html
 */
import { writeFileSync } from "node:fs";
import {
  doc,
  section,
  cards,
  table,
  tableFilter,
  csvExport,
  barChart,
  lineChart,
  scatterFit,
  waterfall,
  heatmap,
  gauge,
  donut,
  sparkline,
  calculator,
  sortableList,
  tabs,
  details,
  deckControls,
  printButton,
  warn,
  note,
  fmt,
  COLORS,
  series,
} from "../lib/report.mjs";

const OUT = process.argv[2] ?? "tmp/demo.html";

const routes = [
  ["/api/users", 1240, 0.42, 0.91, [3, 5, 4, 8, 6, 9, 7]],
  ["/api/orders", 860, 1.15, 3.2, [8, 7, 9, 6, 7, 5, 6]],
  ["/api/search", 430, 2.8, 9.4, [2, 4, 3, 7, 9, 12, 15]],
  ["/health", 5200, 0.08, 0.12, [1, 1, 1, 1, 1, 1, 1]],
];

const html = doc({
  title: "Rapport de démonstration",
  subtitle:
    "Toutes les briques de <code>report.mjs</code>, avec des données factices. " +
    "Sert de vitrine, de test visuel, et de point de départ à copier.",
  data: { routes, generatedBy: "demo.mjs" },
  sections: [
    section(
      "Chiffres-clés",
      cards([
        { k: "Requêtes", v: fmt.int(7730), sub: "sur 24 h" },
        { k: "p99", v: "3,2", unit: "ms", sub: "toutes routes" },
        { k: "Erreurs", v: "0,4", unit: "%", sub: "12 sur 7 730" },
        { k: "Saturation", v: fmt.pct(0.62), sub: "boucle événementielle" },
      ]) +
        note(
          "<strong>La conclusion d'abord.</strong> Les cartes portent la réponse ; le reste de la page " +
            "est la preuve. Un lecteur pressé doit pouvoir s'arrêter ici.",
        ),
      { lead: "Ce que le lecteur doit retenir en dix secondes." },
    ),

    section(
      "Tableau — triable, filtrable, exportable",
      tableFilter("t-routes", { placeholder: "Filtrer une route…" }) +
        table(
          [
            { label: "Route" },
            { label: "Requêtes", align: "right" },
            { label: "p50 (ms)", align: "right" },
            { label: "p99 (ms)", align: "right", strong: true },
            { label: "Tendance" },
          ],
          routes.map(([r, n, p50, p99, spark]) => [
            `<code>${r}</code>`,
            { html: fmt.int(n), sort: n },
            { html: fmt.dec(p50, 2), sort: p50 },
            { html: fmt.dec(p99, 2), sort: p99 },
            sparkline(spark, { color: p99 > 5 ? COLORS.red : COLORS.green }),
          ]),
          { sortable: true, id: "t-routes" },
        ) +
        csvExport("t-routes", "routes.csv"),
      {
        lead: "Cliquez un en-tête pour trier (clavier : Entrée). L'en-tête se répète à l'impression.",
      },
    ),

    section(
      "Graphes — SVG pur, zéro dépendance",
      tabs([
        {
          label: "Barres",
          body: barChart(
            routes.map(([r, n], i) => ({
              label: r,
              value: n,
              color: series(i),
            })),
            { unit: "req" },
          ),
        },
        {
          label: "Courbes",
          body: lineChart(
            [
              {
                label: "p99",
                color: COLORS.amber,
                points: [1, 2, 3, 4, 5, 6, 7].map((x) => ({
                  x,
                  y: 2 + Math.sin(x) * 1.5 + x * 0.3,
                })),
              },
              {
                label: "p50",
                color: COLORS.blue,
                points: [1, 2, 3, 4, 5, 6, 7].map((x) => ({
                  x,
                  y: 0.5 + x * 0.05,
                })),
              },
            ],
            { xLabel: "jour", yLabel: "ms" },
          ),
        },
        {
          label: "Régression",
          body:
            scatterFit(
              [
                {
                  color: COLORS.blue,
                  points: [0, 200, 400, 600, 800].map((x) => ({
                    x,
                    y: 40 + x * 0.015 + Math.random() * 2,
                  })),
                  fit: (x) => 40 + x * 0.015,
                },
              ],
              { xLabel: "connexions", yLabel: "Mo" },
            ) +
            `<p class="dim" style="font-size:13px">La <strong>pente</strong> est la mesure ; le nuage montre
             si elle veut dire quelque chose. Toujours publier l'ajustement (R²) avec la pente.</p>`,
        },
        {
          label: "Waterfall",
          body: waterfall([
            { label: "resolve", start: 0, duration: 0.12 },
            { label: "firewall", start: 0.12, duration: 0.48 },
            { label: "action", start: 0.6, duration: 1.55 },
            { label: "sql", start: 0.9, duration: 0.7, color: COLORS.magenta },
            { label: "send", start: 2.15, duration: 0.31 },
          ]),
        },
        {
          label: "Heatmap",
          body: heatmap(
            ["users", "orders", "search", "health"],
            ["0h", "4h", "8h", "12h", "16h", "20h"],
            [
              [2, 1, 8, 12, 9, 4],
              [1, 1, 5, 9, 14, 6],
              [0, 0, 3, 7, 11, 3],
              [1, 1, 1, 1, 1, 1],
            ],
          ),
        },
        {
          label: "Jauge & donut",
          body:
            `<div style="display:flex;gap:32px;flex-wrap:wrap;align-items:center">` +
            gauge(0.62, { label: "boucle" }) +
            gauge(0.91, { label: "mémoire" }) +
            donut([
              { label: "action", value: 55 },
              { label: "SQL", value: 25 },
              { label: "firewall", value: 12 },
              { label: "reste", value: 8 },
            ]) +
            `</div>`,
        },
      ]),
      {
        lead: "Les onglets se déplient à l'impression : rien ne disparaît du PDF.",
        break: "before",
      },
    ),

    section(
      "Calculateur — ce que le Markdown ne fera jamais",
      calculator({
        id: "demo-calc",
        inputs: [
          { id: "rps", label: "Requêtes / s", value: 500 },
          { id: "p99", label: "Budget p99 (ms)", value: 50 },
          { id: "cost", label: "Coût unitaire (µs)", value: 480 },
          {
            id: "redundant",
            label: "Redondance (pod de secours)",
            type: "checkbox",
            value: true,
          },
        ],
        constants: { target: 0.7 },
        compute: `(v, K) => {
          const loops = (v.rps * v.cost) / 1e6;
          const pods = Math.max(1, Math.ceil(loops / K.target)) + (v.redundant ? 1 : 0);
          const per = v.rps / pods;
          const alerts = [];
          if (loops / pods > K.target) alerts.push("Au-delà de 70 % de boucle, la latence p99 décroche.");
          if (v.p99 < 10) alerts.push("Un budget p99 sous 10 ms interdit tout appel réseau synchrone.");
          return {
            html: '<div class="verdict" style="font-size:17px;font-weight:650">Il faut ' +
              '<span style="font-size:30px;color:var(--accent)">' + pods + '</span> pod(s)' +
              '</div><p class="dim" style="font-size:13px">' + Math.round(per) +
              ' req/s par pod · ' + (loops).toFixed(2) + ' boucle(s) nécessaire(s)</p>',
            alerts,
          };
        }`,
      }),
      {
        lead: "Le lecteur teste SES hypothèses. À l'impression, les hypothèses affichées sont figées en texte.",
      },
    ),

    section(
      "Glisser-déposer — arbitrer, puis exporter",
      sortableList(
        [
          { id: "a", label: "Migrer le store de session vers Redis" },
          { id: "b", label: "Terminer TLS au load-balancer" },
          { id: "c", label: "Ajouter un pod de secours" },
          { id: "d", label: "Passer le cache d'idempotence en Postgres" },
        ],
        { id: "prio" },
      ),
      {
        lead:
          "Réordonnez à la souris ou au clavier (<kbd>Alt</kbd> + ↑/↓ — une poignée de glissement " +
          "seule n'est pas une interface accessible), puis copiez l'ordre obtenu.",
      },
    ),

    section(
      "Avertissements, notes, replis",
      warn(
        "<strong>Un chiffre sans son incertitude est un piège.</strong> Quand une mesure n'est pas " +
          "exploitable (dispersion trop forte, ajustement médiocre), il faut le DIRE — pas la maquiller.",
      ) +
        details(
          "Méthodologie (repliée par défaut, dépliée à l'impression)",
          "<p>Le détail qui n'intéresse qu'un relecteur exigeant se replie. Il ne pollue pas la lecture, " +
            "mais il reste dans le PDF — donc dans la preuve.</p>",
        ) +
        `<div class="row">${printButton()} ${deckControls()}</div>`,
      {
        lead: "Et les deux boutons qui changent la vie : impression soignée, et mode présentation.",
      },
    ),
  ],
  footer:
    "Généré par <code>node .claude/skills/nodefony-html-report/scripts/demo.mjs</code> — " +
    "données factices. Un rapport sans provenance ne prouve rien : mettez ici la commande, la date, " +
    "la version, l'environnement.",
});

writeFileSync(OUT, html);
console.log(`Démo écrite : ${OUT} (${(html.length / 1024).toFixed(0)} Ko)`);
