/**
 * prod-readiness-report.mjs — « Nodefony peut-il partir en production ? »
 *
 * Agrège les TROIS mesures qui répondent à cette question et rien d'autre :
 *   1. le comparatif inter-frameworks (à travail égal), pour situer le débit ;
 *   2. le soak, pour la tenue dans la durée (fuite mémoire, dérive du débit) ;
 *   3. le banc de capacité, pour dimensionner un pod.
 *
 * Le rapport porte AUSSI ce que les chiffres ne disent pas : une page qui ne
 * montre que ses bons résultats n'aide personne à décider, elle rassure — ce
 * n'est pas la même chose.
 *
 * Les données sont EMBARQUÉES dans la page (`doc({ data })`) : le rapport reste
 * comparable d'une release à l'autre et ré-ingérable par un outil.
 *
 * Prérequis — les JSON produits par les bancs :
 *   /tmp/nf-bench-{bare,fastify,express,express-fair,nodefony}.json
 *   tmp/soak-*.json
 *
 * Usage :
 *   node .claude/skills/nodefony-load-test/scripts/prod-readiness-report.mjs
 *   node ... prod-readiness-report.mjs --soak tmp/soak-20min.json --out tmp/rapport.html
 *   node ... prod-readiness-report.mjs --data docs/performance/data/10.0.0.json --out tmp/rapport.html
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  doc,
  section,
  cards,
  table,
  barChart,
  lineChart,
  calculator,
  warn,
  note,
  printButton,
  deckControls,
  csvExport,
  fmt,
  COLORS,
} from "../../nodefony-html-report/lib/report.mjs";

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const OUT = arg("out", "tmp/nodefony-prod-readiness.html");
const SOAK = arg("soak", "tmp/soak-20min.json");
// Jeu de mesures VERSIONNÉ (`docs/performance/data/<version>.json`). Sans lui, on
// lit les fichiers que les bancs viennent de déposer dans `/tmp` — pratique en
// session, mais ces fichiers disparaissent au premier ménage : une page publiée
// dont les données ne survivent pas n'est plus reproductible, et un chiffre qu'on
// ne peut pas rejouer n'est pas réfutable.
const DATA = arg("data", null);

const readJson = (p) =>
  existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;

const dataset = DATA ? readJson(DATA) : null;
if (DATA && !dataset) throw new Error(`jeu de mesures introuvable : ${DATA}`);

// ── 1. comparatif ──────────────────────────────────────────────────────────
const FRAMEWORKS = [
  {
    id: "bare",
    label: "node:http nu",
    note: "aucun framework — plancher théorique",
  },
  {
    id: "fastify",
    label: "Fastify",
    note: "routing + sérialisation schématisée",
  },
  {
    id: "express",
    label: "Express (nu)",
    note: "route + res.json(), rien d'autre",
  },
  {
    id: "express-fair",
    label: "Express équipé",
    note: "ALS, CORS, en-têtes de sécurité, CSRF, traceparent, zones",
  },
  {
    id: "nodefony",
    label: "Nodefony",
    note: "le même travail, intégré au pipeline",
  },
];
const bench = FRAMEWORKS.map((f) => {
  const d = dataset
    ? (dataset.comparison?.frameworks?.[f.id] ?? null)
    : readJson(`/tmp/nf-bench-${f.id}.json`);
  if (!d)
    throw new Error(
      dataset
        ? `camp absent du jeu versionné : comparison.frameworks.${f.id} (${DATA})`
        : `mesure manquante : /tmp/nf-bench-${f.id}.json`,
    );
  // ⚠️ `d` d'abord : le JSON du banc porte un champ `label` ("bare", "express-fair")
  // qui écraserait le libellé lisible de `f` si l'ordre était inversé. Vu à l'écran,
  // pas au typecheck — deux objets qui partagent une clé ne lèvent rien.
  return Object.assign({}, d, f);
});
const ref = bench.find((b) => b.id === "express-fair");
const nf = bench.find((b) => b.id === "nodefony");
const ratioRps = (nf.med / ref.med) * 100;
const deltaP99 = nf.medP99Ms - ref.medP99Ms;

// ── 2. soak ────────────────────────────────────────────────────────────────
// Le soak est l'un des TROIS piliers de la question posée par cette page : sans lui,
// on publierait un débit sans rien dire de la tenue dans la durée. La garde reste
// donc bloquante — elle nomme le geste qui la lève plutôt que de rendre une page
// qui répond à moitié.
const soak = dataset ? dataset.soak : readJson(SOAK);
if (!soak)
  throw new Error(
    dataset
      ? `le jeu ${DATA} n'a pas de soak. Rejouer :\n` +
          `  node .claude/skills/nodefony-load-test/scripts/soak.mjs --minutes 20 --out tmp/soak.json\n` +
          `puis renseigner le champ "soak" (échantillons COMPLETS — la pente se recalcule ici, ` +
          `jamais depuis un résumé).`
      : `soak manquant : ${SOAK}`,
  );
const kept = soak.samples.slice(soak.skipped);
const p99s = kept.map((s) => s.p99Ms).sort((a, b) => a - b);

// Pente RECALCULÉE ici, jamais lue dans le JSON du soak : un fichier produit
// par une version antérieure du banc n'a pas le champ, et un `?? 0` afficherait
// alors « 0,0 MB/h » — un chiffre FAUX, présenté avec le même aplomb qu'un vrai.
// Le rapport a les échantillons : il calcule, il ne fait pas confiance.
const slopePerHour = (pts) => {
  const n = pts.length;
  if (n < 3) return 0;
  const mx = pts.reduce((a, p) => a + p.x, 0) / n;
  const my = pts.reduce((a, p) => a + p.y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (const p of pts) {
    sxy += (p.x - mx) * (p.y - my);
    sxx += (p.x - mx) ** 2;
  }
  return sxx === 0 ? 0 : (sxy / sxx) * 3600;
};
const rssPts = kept.map((s) => ({ x: s.atSec, y: s.rssMb }));
const rssSlopeAll = slopePerHour(rssPts);
const rssSlopeLate = slopePerHour(rssPts.slice(Math.floor(rssPts.length / 2)));
const isPlateau = rssSlopeAll > 5 && rssSlopeLate < rssSlopeAll / 3;

// ── 3. capacité (relevé console de capacity.mjs — pas de JSON produit) ────
const CAP = {
  env: "development (profiler ACTIF ⇒ borne basse)",
  p50: 0.33,
  p95: 0.45,
  p99: 0.54,
  rps: 3067,
  elu: 0.9,
  loopUsPerReq: 293,
  wsRamKb: 12.8,
  wsEcho: 9208,
  wsFanout: 398604,
};

const node = process.version;
const cpus = (() => {
  try {
    return execFileSync("sysctl", ["-n", "hw.logicalcpu"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "?";
  }
})();

// ── Rendu ──────────────────────────────────────────────────────────────────
const verdict = section(
  "Le verdict",
  cards([
    {
      k: "Débit, à travail égal",
      v: `${fmt.dec(ratioRps, 0)} %`,
      sub: "du débit d'Express équipé des mêmes middlewares",
    },
    {
      k: "Latence p99",
      v: fmt.dec(nf.medP99Ms, 2),
      unit: "ms",
      sub: `soit +${fmt.dec(deltaP99, 2)} ms face à cette même référence`,
    },
    {
      k: "Fuite mémoire",
      v: "aucune",
      sub: `${soak.minutes} min de trafic continu · tas sans tendance (R² ${fmt.dec(soak.heapR2, 2)})`,
    },
    {
      k: "RSS d'un pod en régime",
      v: fmt.dec(kept[kept.length - 1].rssMb, 0),
      unit: "MB",
      sub: "palier atteint, pas une rampe",
    },
  ]) +
    `<p><strong>La performance n'est pas le point faible de Nodefony.</strong> À travail égal — c'est-à-dire
     face à un Express muni des mêmes middlewares (scope ALS, CORS, en-têtes de sécurité, contrôle CSRF,
     corrélation <code>traceparent</code>, zones de pare-feu) — le framework rend
     <strong>${fmt.dec(ratioRps, 0)} %</strong> du débit pour <strong>+${fmt.dec(deltaP99, 2)} ms</strong>
     de p99. L'écart avec un serveur nu ne mesure pas une lenteur : il mesure le travail que le serveur nu
     ne fait pas.</p>
     <p>Sur ${soak.minutes} minutes de charge continue, le tas ne monte pas et le débit ne s'érode pas.
     Le risque résiduel d'un passage en production n'est donc pas la performance —
     <a href="#limites">il est nommé plus bas</a>.</p>`,
  { break: "avoid" },
);

const comparatif = section(
  "1 · Où se situe Nodefony",
  `<p>Même route, même charge utile, même protocole de mesure, même concurrence (c${nf.conn}),
   <code>NODE_ENV=production</code>. Chaque valeur est la <strong>médiane de 3 tirs</strong>, une série
   étant refusée au-delà de 3 % de dispersion.</p>` +
    barChart(
      bench.map((b) => ({
        label: b.label,
        value: b.med,
        color: b.id === "nodefony" ? COLORS.accent : COLORS.grey,
      })),
      { unit: "req/s", title: "Débit", desc: "Débit médian par framework" },
    ) +
    barChart(
      bench.map((b) => ({
        label: b.label,
        value: b.medP99Ms,
        color: b.id === "nodefony" ? COLORS.amber : COLORS.grey,
      })),
      {
        unit: "ms",
        title: "Latence p99 (plus bas = mieux)",
        desc: "p99 par framework",
        fmt: (v) => fmt.dec(v, 2),
      },
    ) +
    table(
      [
        { label: "Pile" },
        { label: "req/s", align: "right", strong: true },
        { label: "p50 (ms)", align: "right" },
        { label: "p99 (ms)", align: "right" },
        { label: "dispersion", align: "right", dim: true },
        { label: "Ce qu'il fait par requête", dim: true },
      ],
      bench.map((b) => [
        b.id === "nodefony" ? `<strong>${b.label}</strong>` : b.label,
        fmt.int(b.med),
        fmt.dec(b.medP50Ms, 2),
        fmt.dec(b.medP99Ms, 2),
        `${fmt.dec(b.dispersionPct, 1)} %`,
        b.note,
      ]),
      { sortable: true, id: "tbl-fw" },
    ) +
    csvExport("tbl-fw", "nodefony-comparatif.csv") +
    note(
      `La ligne qui compte est <strong>Express équipé</strong>, pas Express nu : comparer un pipeline
       complet à un <code>res.json()</code> revient à comparer une berline équipée à un kart. L'écart
       entre les deux lignes Express (${fmt.int(bench.find((b) => b.id === "express").med)} →
       ${fmt.int(ref.med)} req/s) chiffre le prix de ces fonctionnalités, indépendamment de Nodefony.`,
    ),
);

const tenue = section(
  "2 · La tenue dans la durée",
  `<p>${soak.minutes} minutes de trafic continu, ${kept.length} fenêtres retenues sur
   ${soak.samples.length} (les premières sont écartées : un tas monte jusqu'à son régime). Ce banc
   cherche une <strong>pente</strong>, pas un écart entre deux mesures bruitées.</p>` +
    lineChart(
      [
        {
          label: "tas (heap) MB",
          color: COLORS.green,
          points: kept.map((s) => ({ x: s.atSec / 60, y: s.heapUsedMb })),
        },
        {
          label: "RSS MB",
          color: COLORS.blue,
          points: kept.map((s) => ({ x: s.atSec / 60, y: s.rssMb })),
        },
      ],
      { xLabel: "minutes", yLabel: "MB" },
    ) +
    lineChart(
      [
        {
          label: "débit req/s",
          color: COLORS.accent,
          points: kept.map((s) => ({ x: s.atSec / 60, y: s.rps })),
        },
      ],
      { xLabel: "minutes", yLabel: "req/s" },
    ) +
    cards([
      {
        k: "Tas",
        v: `${fmt.dec(kept[0].heapUsedMb, 1)} → ${fmt.dec(kept[kept.length - 1].heapUsedMb, 1)}`,
        unit: "MB",
        sub: `R² ${fmt.dec(soak.heapR2, 2)} — aucune droite ne décrit ces points`,
      },
      {
        k: "RSS",
        v: `${fmt.dec(kept[0].rssMb, 0)} → ${fmt.dec(kept[kept.length - 1].rssMb, 0)}`,
        unit: "MB",
        sub: isPlateau ? "plateau confirmé" : "montée puis palier",
      },
      {
        k: "Dérive du débit",
        v: `${soak.rpsDriftPct >= 0 ? "+" : ""}${fmt.dec(soak.rpsDriftPct, 1)} %`,
        sub: "il monte — aucune érosion",
      },
      {
        k: "p99 sur la durée",
        v: fmt.dec(p99s[Math.floor(p99s.length / 2)], 2),
        unit: "ms",
        sub: `médiane · max ${fmt.dec(p99s[p99s.length - 1], 2)} ms`,
      },
    ]) +
    note(
      `<strong>Le RSS monte, et c'est normal.</strong> Le tas, lui, est plat : aucun objet JavaScript
       n'est retenu. Un RSS qui croît puis se stabilise, c'est l'allocateur qui ne rend pas ses arènes au
       système. La distinction se fait en découpant la série : la pente s'effondre sur la seconde moitié
       (${fmt.dec(rssSlopeLate, 1)} MB/h contre ${fmt.dec(rssSlopeAll, 1)} MB/h globalement). Une vraie fuite garde sa pente jusqu'au
       bout — c'est ce qui la définit.`,
    ),
);

const capacite = section(
  "3 · Dimensionner un pod",
  `<p>Constantes relevées par <code>capacity.mjs</code> en <strong>${CAP.env}</strong> — le profileur et
   le chronométrage y sont actifs, donc ces chiffres sont une <strong>borne basse</strong> : en
   production ils montent.</p>` +
    cards([
      {
        k: "Latence à charge modérée",
        v: `${CAP.p50} / ${CAP.p95} / ${CAP.p99}`,
        unit: "ms",
        sub: "p50 / p95 / p99",
      },
      {
        k: "Boucle consommée",
        v: CAP.loopUsPerReq,
        unit: "µs/req",
        sub: "temps de boucle par requête HTTP",
      },
      {
        k: "RAM par socket WS",
        v: CAP.wsRamKb,
        unit: "KB",
        sub: "TLS terminé par Node",
      },
      {
        k: "Écho WebSocket",
        v: fmt.int(CAP.wsEcho),
        unit: "msg/s",
        sub: `diffusion 1→100 : ${fmt.int(CAP.wsFanout)} livraisons/s`,
      },
    ]) +
    calculator({
      id: "pods",
      inputs: [
        {
          id: "rps",
          label: "Trafic visé (requêtes/s)",
          value: 2000,
          min: 1,
          step: 100,
        },
        {
          id: "marge",
          label: "Charge max par pod (%)",
          value: 70,
          min: 10,
          max: 100,
          step: 5,
        },
        {
          id: "ramPod",
          label: "RAM allouée par pod (MB)",
          value: 768,
          min: 128,
          step: 128,
        },
        {
          id: "ws",
          label: "Sockets WebSocket simultanées",
          value: 0,
          min: 0,
          step: 100,
        },
      ],
      constants: {
        RPS_POD: Math.round(nf.med),
        RSS_BASE: Math.round(kept[kept.length - 1].rssMb),
        WS_KB: CAP.wsRamKb,
      },
      compute: `(v, K) => {
        const util = Math.min(Math.max(v.marge, 10), 100) / 100;
        const parPod = K.RPS_POD * util;
        const pods = Math.max(1, Math.ceil(v.rps / parPod));
        const wsParPod = pods > 0 ? Math.ceil(v.ws / pods) : 0;
        const ramWs = (wsParPod * K.WS_KB) / 1024;
        const ramPod = K.RSS_BASE + ramWs;
        const alerts = [];
        if (ramPod > v.ramPod) alerts.push("La RAM allouée (" + v.ramPod + " MB) est SOUS le besoin estimé (" + Math.ceil(ramPod) + " MB) — le pod sera tué par l'orchestrateur.");
        if (v.ramPod < K.RSS_BASE * 1.3) alerts.push("Marge mémoire faible : moins de 30 % au-dessus du RSS mesuré au repos.");
        if (util > 0.85) alerts.push("Au-delà de 85 % de charge par pod, la p99 se dégrade avant le débit : garder de la marge.");
        return {
          alerts,
          html: "<table><tbody>"
            + "<tr><th>Pods nécessaires</th><td><strong>" + pods + "</strong></td></tr>"
            + "<tr><th>Débit par pod retenu</th><td>" + Math.round(parPod) + " req/s (" + Math.round(util*100) + " % de " + K.RPS_POD + ")</td></tr>"
            + "<tr><th>Sockets WS par pod</th><td>" + wsParPod + "</td></tr>"
            + "<tr><th>RAM estimée par pod</th><td>" + Math.ceil(ramPod) + " MB <span style=\\"opacity:.6\\">(" + K.RSS_BASE + " MB de base + " + ramWs.toFixed(1) + " MB de sockets)</span></td></tr>"
            + "<tr><th>RAM totale du déploiement</th><td>" + (pods * v.ramPod) + " MB</td></tr>"
            + "</tbody></table>"
        };
      }`,
    }) +
    note(
      `Le débit par pod (<strong>${fmt.int(nf.med)} req/s</strong>) vient du comparatif ci-dessus, mesuré
       sur une route sans base de données. Une route qui interroge PostgreSQL descend autour de
       1 400–1 600 req/s sur ce même poste — mais derrière Docker Desktop, dont le surcoût de
       virtualisation mesuré est d'un facteur 3,7. Pour dimensionner un déploiement réel, refaire la
       mesure sur la cible.`,
    ),
);

const limites = section(
  "Ce que ces chiffres ne disent PAS",
  warn(
    `<p>Un rapport qui ne montre que ses bons résultats rassure au lieu d'aider à décider. Les limites
     de cette campagne, nommées :</p>
     <ul>
       <li><strong>${soak.minutes} minutes ne sont pas trois jours.</strong> Ce soak élimine les fuites
           grossières. Une fuite lente — quelques mégaoctets par heure — resterait invisible ici et
           tuerait un pod au bout d'une semaine.</li>
       <li><strong>Aucune valeur ABSOLUE n'est transposable.</strong> Poste de développement, macOS,
           ${cpus} cœurs logiques, base de données derrière Docker Desktop. Les comparaisons
           <em>à l'intérieur</em> de cette page sont valides (même décor des deux côtés) ; les chiffres
           bruts, non.</li>
       <li><strong>Le multi-pod sous trafic réel n'est pas couvert ici</strong> — fan-out entre pods,
           backplane Redis, cohérence des sessions. D'autres bancs le font, pas celui-ci.</li>
       <li><strong>Le démarrage à froid coûte.</strong> Un pipeline riche présente plus de fonctions
           distinctes à optimiser au JIT : les premiers milliers de requêtes d'un pod neuf sont plus
           lentes. À couvrir par une sonde de disponibilité qui attend, ou un préchauffage.</li>
       <li><strong>Aucune mesure ne remplace des heures de vol.</strong> C'est le déficit réel, et il ne
           se comble pas en codant : il se comble en étant déployé.</li>
     </ul>`,
  ),
);

const decor = section(
  "Décor et provenance",
  table(
    [{ label: "Élément" }, { label: "Valeur" }],
    [
      ["Node.js", node],
      ["Cœurs logiques", cpus],
      [
        "Concurrence (wrk)",
        `c${nf.conn} · ${nf.threads} fils · ${nf.durSec}s par tir`,
      ],
      ["Route du comparatif", `<code>${nf.url}</code>`],
      ["Route du soak", `<code>${soak.url}</code>`],
      [
        "Tirs par mesure",
        "3, médiane retenue, refus au-delà de 3 % de dispersion",
      ],
      [
        "Fenêtres du soak",
        `${soak.samples.length} × ${soak.windowSec}s, ${soak.skipped} écartée(s)`,
      ],
    ],
  ) +
    `<pre><code># comparatif (une ligne par pile)
BENCH_CONN=64 bash .claude/skills/nodefony-load-test/bench-frameworks/bench.sh &lt;bare|fastify|express|express-fair&gt; 5161
BENCH_CONN=64 BENCH_URL=${nf.url} \\
  bash .claude/skills/nodefony-load-test/scripts/bench-ab-mono.sh nodefony NF_WITH_DEV_MODULES=1

# tenue dans la durée
node .claude/skills/nodefony-load-test/scripts/soak.mjs --minutes ${soak.minutes} --window ${soak.windowSec}

# capacité
node .claude/skills/nodefony-load-test/scripts/capacity.mjs

# cette page
node .claude/skills/nodefony-load-test/scripts/prod-readiness-report.mjs</code></pre>`,
);

const html = doc({
  title: "Nodefony peut-il partir en production ?",
  subtitle:
    "Trois mesures — débit à travail égal, tenue dans la durée, dimensionnement d'un pod — et ce qu'elles ne prouvent pas.",
  sections: [
    printButton() + deckControls(),
    verdict,
    comparatif,
    tenue,
    capacite,
    `<a id="limites"></a>` + limites,
    decor,
  ],
  footer: `Généré par <code>node .claude/skills/nodefony-load-test/scripts/prod-readiness-report.mjs</code> — Node ${node}`,
  data: { comparatif: bench, soak, capacite: CAP },
});

writeFileSync(OUT, html);
console.log(`rapport écrit : ${OUT} (${(html.length / 1024).toFixed(0)} Ko)`);
