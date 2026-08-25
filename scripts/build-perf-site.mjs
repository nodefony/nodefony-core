#!/usr/bin/env node
/**
 * Construit le site « Performance » publié — une page par version, plus `latest`.
 *
 * POURQUOI CE SCRIPT EXISTE, ET CE QU'IL NE FAIT PAS.
 * Il ne MESURE rien. Mesurer sur un exécuteur d'intégration continue partagé rendrait
 * des chiffres faux — la leçon est déjà payée : aucun absolu pris derrière un chemin
 * virtualisé n'est transposable. La mesure est un geste manuel, sur une machine nommée,
 * dont le résultat est COMMITÉ dans `docs/performance/data/<version>.json`. Ce script ne
 * fait que RENDRE ces données ; il est donc déterministe, rejouable en local, et son
 * résultat ne dépend pas de la machine qui l'exécute.
 *
 * Chaque version versionnée devient `<sortie>/<version>/index.html`, la plus récente est
 * dupliquée en `<sortie>/latest/index.html`, et un sommaire liste le tout. Un chiffre
 * reste ainsi attaché à SA version, définitivement — c'est ce qui permet de comparer deux
 * releases sans croire quiconque sur parole.
 *
 * Usage :
 *   node scripts/build-perf-site.mjs [--out dist-perf-site] [--data docs/performance/data]
 *
 * Sortie 1 si AUCUNE version n'a pu être rendue (un site vide se publierait en silence).
 */
import {
  readdirSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  existsSync,
} from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { NODEFONY_BRAND } from "../.claude/skills/nodefony-html-report/lib/brand.mjs";
import {
  couple,
  bars,
  figure,
  STYLE_GRAPHES,
} from "../.claude/skills/nodefony-html-report/lib/echarts.mjs";
import {
  doc,
  section,
  cards,
  table,
  note,
  warn,
  esc,
  calculator,
} from "../.claude/skills/nodefony-html-report/lib/report.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const OUT = path.resolve(ROOT, arg("out", "dist-perf-site"));
const DATA_DIR = path.resolve(ROOT, arg("data", "docs/performance/data"));
const GENERATOR = path.join(
  ROOT,
  ".claude/skills/nodefony-load-test/scripts/prod-readiness-report.mjs",
);
// Le DOSSIER du chantier — un second objet, pour un second public. La page de
// version répond « peut-on partir en production ? » en trois minutes ; celle-ci
// raconte COMMENT on l'a su : le profilage, les lots gardés, celui qui a été
// annulé par son propre A/B, et les instruments qui ont menti. Un verdict seul se
// lit comme une plaquette ; la méthode seule, personne ne l'ouvre. Ses données
// sont déclarées dans son générateur et couvrent le chantier jusqu'au 2026-08-07 —
// il porte sa propre table de chronologie, ce qui lui permet de cohabiter avec des
// mesures plus récentes sans les contredire.
const DOSSIER = path.join(
  ROOT,
  ".claude/skills/nodefony-load-test/scripts/perf-dossier-report.mjs",
);

/** Ordre de version décroissant (numérique par segment, pré-release après la finale). */
const compareVersions = (a, b) => {
  const parse = (v) =>
    v.split(/[.-]/).map((p) => (/^\d+$/.test(p) ? Number(p) : p));
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x === y) continue;
    if (typeof x === typeof y) return x > y ? -1 : 1;
    return typeof x === "number" ? -1 : 1;
  }
  return 0;
};

const versions = existsSync(DATA_DIR)
  ? readdirSync(DATA_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""))
      .sort(compareVersions)
  : [];

if (versions.length === 0) {
  console.error(`aucun jeu de mesures dans ${DATA_DIR}`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
const rendered = [];
const skipped = [];

for (const version of versions) {
  const dataFile = path.join(DATA_DIR, `${version}.json`);
  const dir = path.join(OUT, version);
  mkdirSync(dir, { recursive: true });
  try {
    execFileSync(
      process.execPath,
      [GENERATOR, "--data", dataFile, "--out", path.join(dir, "index.html")],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const meta = JSON.parse(readFileSync(dataFile, "utf8"));
    rendered.push({
      version,
      measuredAt: meta.provenance?.measuredAt ?? "?",
      data: meta,
    });
    console.log(`✓ ${version}`);
  } catch (err) {
    // Un jeu incomplet ne fait PAS tomber le site : il est nommé, et son absence
    // est visible sur le sommaire. Ce qui serait grave, c'est de le taire.
    const why =
      String(err.stderr ?? err.message)
        .split("\n")
        .find((l) => l.startsWith("Error:")) ?? "rendu impossible";
    skipped.push({ version, why: why.replace(/^Error:\s*/, "") });
    console.warn(`⚠ ${version} — ${why}`);
  }
}

if (rendered.length === 0) {
  console.error("aucune version rendue — rien à publier");
  process.exit(1);
}

// Le dossier se rend une fois, à part : il ne dépend d'aucune version.
let dossier = false;
try {
  const dir = path.join(OUT, "dossier");
  mkdirSync(dir, { recursive: true });
  execFileSync(process.execPath, [DOSSIER, path.join(dir, "index.html")], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  dossier = true;
  console.log("✓ dossier du chantier");
} catch (err) {
  console.warn(
    `⚠ dossier non rendu — ${String(err.stderr ?? err.message).split("\n")[0]}`,
  );
}

const latest = rendered[0];
mkdirSync(path.join(OUT, "latest"), { recursive: true });
copyFileSync(
  path.join(OUT, latest.version, "index.html"),
  path.join(OUT, "latest", "index.html"),
);

const rows = rendered.map((r) => [
  `<a href="./${esc(r.version)}/">Nodefony ${esc(r.version)}</a>${
    r.version === latest.version
      ? ' <span class="badge-latest">version courante</span>'
      : ""
  }`,
  esc(r.measuredAt),
]);

/**
 * Ce qu'un lecteur vient chercher ici, dans l'ordre : combien ça encaisse, face
 * à quoi, est-ce que ça tient, et sur quelle machine. Un sommaire de versions ne
 * répond à AUCUNE de ces questions — c'était pourtant tout ce que cette page
 * montrait. Les chiffres viennent des données de la version courante ; si elles
 * manquent, la section disparaît plutôt que d'afficher des trous.
 */
function chiffresCles(d) {
  const f = d?.comparison?.frameworks;
  const nf = f?.nodefony;
  if (!nf) return [];
  const ref = f?.[d.comparison.reference];
  const soak = d.soak;
  const out = [];

  const nb = (v, n = 0) =>
    v == null
      ? "—"
      : v.toLocaleString("fr-FR", {
          minimumFractionDigits: n,
          maximumFractionDigits: n,
        });

  out.push(
    section(
      "Ce que Nodefony encaisse",
      `<p class="lead">Une route qui fait un vrai travail applicatif, servie par le pipeline complet —
sécurité, session, routage, contexte asynchrone. Médiane de ${d.provenance?.protocol?.runs ?? 3} tirs
de ${d.provenance?.protocol?.durationSec ?? 10} s à ${d.provenance?.protocol?.connections ?? 64}
connexions.</p>` +
        cards(
          [
            {
              k: "Débit",
              v: nb(nf.med),
              unit: "req/s",
              sub: `dispersion ${nb(nf.dispersionPct, 1)} %`,
            },
            {
              k: "Latence médiane",
              v: nb(nf.medP50Ms, 2),
              unit: "ms",
              sub: "la moitié des requêtes sous ce seuil",
            },
            {
              k: "Latence p99",
              v: nb(nf.medP99Ms, 2),
              unit: "ms",
              sub: "99 requêtes sur 100 sous ce seuil",
            },
            ref && {
              k: "Face à Express équipé",
              v: `${Math.round((nf.med / ref.med) * 100)} %`,
              sub: "du débit d'un Express qui fait le MÊME travail",
            },
            soak && {
              k: "Tenue dans le temps",
              v: soak.verdict === "clean" ? "aucune fuite" : soak.verdict,
              sub: `${soak.minutes} min sous charge — tas JS à ${nb(soak.heapSlopeMbPerHour, 2)} Mo/h`,
            },
          ].filter(Boolean),
        ),
    ),
  );

  // Le comparatif, en barres depuis zéro : ce qui se compare ici est une
  // LONGUEUR, et couper l'axe transformerait un écart de 9 % en doublement.
  const ordre = ["bare", "fastify", "express", "express-fair", "nodefony"];
  const LIB = {
    bare: "Serveur nu (node:http)",
    fastify: "Fastify",
    express: "Express nu",
    "express-fair": "Express équipé (même travail)",
    nodefony: "Nodefony (pipeline complet)",
  };
  // `[["étiquette", valeur], …]` — la forme que le moteur normalise.
  const donnees = ordre.filter((k) => f[k]).map((k) => [LIB[k], f[k].med]);
  if (donnees.length > 1) {
    const svgs = couple(bars, {
      titre: "Débit par camp",
      axeValeur: "req/s",
      horizontal: true,
      largeur: 900,
      series: [{ nom: "req/s", data: donnees }],
    });
    out.push(
      section(
        "Face à quoi",
        figure(svgs, {
          titre: "Débit mesuré, du serveur nu au pipeline complet",
          desc: "médiane de 3 tirs, même route, même machine, même fenêtre",
        }) +
          `<p>Comparer un pipeline complet à un serveur nu ne compare pas le même travail. Le camp qui
compte est <strong>Express équipé</strong> : même route, mêmes garanties — un scope
<code>AsyncLocalStorage</code> avec identifiant de requête, la corrélation W3C
<code>traceparent</code>, CORS, les en-têtes de sécurité, le contrôle anti-CSRF par
<em>Fetch Metadata</em>, et le matching des zones du pare-feu, sur CHAQUE requête.</p>`,
      ),
    );
  }

  // ── Ce que ces 92 % veulent dire, et ce qu'ils ne disent pas ───────────────
  //
  // La question que tout le monde pose devant ce comparatif — « Nodefony est
  // donc plus lent ? » — appelle deux réponses de nature DIFFÉRENTE, et les
  // mélanger serait malhonnête : le prix des garanties est MESURÉ ici même,
  // l'effet du travail applicatif est CALCULÉ à partir de ces mesures. Chacune
  // est annoncée comme telle.
  const nu = f?.express;
  if (ref && nu) {
    const prixEquipement = Math.round((1 - ref.med / nu.med) * 1000) / 10;
    const usNodefony = 1e6 / nf.med;
    const usRef = 1e6 / ref.med;
    const ecartUs = Math.round((usNodefony - usRef) * 10) / 10;
    out.push(
      section(
        "Ce que ces chiffres veulent dire",
        `<p class="lead">Un pipeline ne se juge pas au débit d'une route vide, mais à ce qu'il
FAIT pendant qu'il la sert — et à ce qui reste de cet écart quand l'application, elle, commence à
travailler.</p>

<h3>Le prix des garanties est mesuré, et il est payé par tout le monde</h3>
<p>Express nu rend <strong>${nb(nu.med)} req/s</strong> ; le même Express, équipé des six briques
ci-dessus, en rend <strong>${nb(ref.med)}</strong>. <strong>Équiper Express coûte
${nb(prixEquipement, 1)} %&nbsp;de son débit.</strong> Ce prix n'est pas celui d'un framework :
c'est celui des fonctionnalités, et il se paie quel que soit l'outil qui les rend. Nodefony arrive
avec ces briques déjà en place — les ${nb(nf.med)} req/s ci-dessus sont mesurées pipeline complet
traversé, pas moteur nu.</p>
<p>Reste alors l'écart d'implémentation, et lui seul :
<strong>${nb(ecartUs, 1)}&nbsp;µs par requête</strong> (${nb(usNodefony, 1)} µs contre
${nb(usRef, 1)} µs de temps de service). C'est le seul terrain où le choix du framework décide.</p>

<h3>Puis le travail du développeur commence</h3>
<p>Une application ne sert pas des routes vides : elle interroge une base, appelle un service,
rend une vue. Ce travail-là s'ajoute au temps de service <em>des deux côtés</em>, tandis que
l'écart de pipeline, lui, ne bouge pas. Sa part relative fond donc à mesure que l'application
devient réelle. Le calculateur ci-dessous le montre sur VOS hypothèses.</p>` +
          calculator({
            id: "calc-travail",
            constants: {
              usNodefony: Math.round(usNodefony * 100) / 100,
              usRef: Math.round(usRef * 100) / 100,
              rpsNodefony: nf.med,
              rpsRef: ref.med,
            },
            inputs: [
              {
                id: "travailMs",
                label:
                  "Travail applicatif par requête (ms) — requête ORM, appel de service, rendu",
                value: 2,
                step: "0.1",
                min: 0,
              },
            ],
            compute: `(v, K) => {
              const t = Math.max(0, v.travailMs) * 1000;
              const nf = K.usNodefony + t, ref = K.usRef + t;
              const pct = (ref / nf) * 100;
              const perte = 100 - pct;
              const rpsNf = 1e6 / nf, rpsRef = 1e6 / ref;
              const n = (x, d) => x.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
              return {
                html:
                  "<p><strong>Avec " + n(v.travailMs, 1) + " ms de travail applicatif par requête, " +
                  "Nodefony rend " + n(pct, 1) + " % du débit d'Express équipé</strong> — " +
                  n(rpsNf, 0) + " contre " + n(rpsRef, 0) + " req/s. " +
                  "L'écart de pipeline représente alors " + n(perte, 2) + " % du temps de service.</p>",
                alerts: v.travailMs === 0
                  ? ["Route vide : c'est le cas MESURÉ ci-dessus, celui où le framework pèse le plus. Aucune application réelle ne s'y tient."]
                  : (perte < 1 ? ["Sous 1 %, l'écart de framework est noyé dans la variance d'une machine — il ne se mesure même plus."] : []),
              };
            }`,
          }) +
          note(
            `<strong>Ce bloc est un CALCUL, pas une mesure.</strong> Il ajoute un temps de travail
au temps de service des deux camps et en refait le rapport. Posez le curseur à
<strong>0 ms</strong> : il retombe sur les ${nb(Math.round((nf.med / ref.med) * 1000) / 10, 1)} %
mesurés plus haut — c'est le seul contrôle qui vaille pour un modèle, retrouver la mesure là où
elle existe. Le modèle est <em>conservateur</em>
pour tout travail d'entrée-sortie : pendant qu'une requête attend sa base, elle ne consomme pas de
processeur, et le débit réel baisse donc MOINS que ce que ce calcul annonce. Il vaut tel quel pour
un travail qui consomme du processeur (sérialisation, rendu, chiffrement).`,
          ) +
          `<h3>Ce que ce comparatif ne mesure pas</h3>
<p>Le camp équipé reproduit six briques. Il ne reproduit ni les sessions, ni l'autorisation par
rôles, ni le WebSocket co-citoyen du même contexte, ni l'ORM, ni le plan d'administration — tout
ce qu'une application finit par réclamer. Chacune de ces briques, ajoutée à Express, sera un
intergiciel de plus dans la chaîne, et se paiera comme les six premières se sont payées
(${nb(prixEquipement, 1)} %). Chez Nodefony, elles partagent la traversée déjà comptée dans les
${nb(nf.med)} req/s ci-dessus.</p>
<p>C'est une différence de STRUCTURE, et nous ne la chiffrons pas ici : il faudrait un banc par
brique ajoutée, des deux côtés. Ce qui est chiffré, et qui suffit à situer le débat, c'est que le
prix des six premières est déjà connu — et qu'il est plus élevé que l'écart de ${nb(ecartUs, 1)} µs
qui sépare les deux pipelines complets.</p>`,
      ),
    );
  }

  const m = d.provenance?.machine;
  if (m)
    out.push(
      section(
        "Sur quoi ces chiffres ont été pris",
        warn(
          `<strong>Ce sont des mesures de développement, pas une promesse de production.</strong>
${esc(m.cpu)}, ${m.logicalCores} cœurs logiques, ${m.memoryGb} Go, ${esc(m.os)} — un
<strong>portable</strong>, avec le générateur de charge sur la même machine. Les valeurs ABSOLUES
sont donc basses pour tous les participants : seuls les <strong>rapports entre camps</strong>, pris
dans la même fenêtre, sont exploitables.`,
        ),
      ),
    );
  return out;
}

const sections = [
  ...chiffresCles(latest?.data),
  section(
    "Une page par version publiée",
    `<p class="lead">Ce qui a été mesuré, sur quelle machine, avec quel protocole — et ce que ces
chiffres ne permettent PAS de conclure.</p>` +
      table([{ label: "Version" }, { label: "Mesuré le" }], rows, {
        sortable: true,
        id: "versions",
      }),
  ),
];

if (dossier)
  sections.push(
    section(
      "Le dossier du chantier",
      `<p><a href="./dossier/"><strong>Où part le temps, et comment on l'a su</strong></a> — le
profilage, les lots gardés, <strong>celui qui a été annulé par son propre A/B</strong>, les
instruments qui ont menti avant qu'on s'en aperçoive, et ce qu'un chemin virtualisé interdit de
conclure.</p>` +
        note(
          `Ce dossier couvre le chantier jusqu'au 2026-08-07 ; chaque chiffre y porte l'état du code
auquel il correspond. Les mesures d'une version publiée, elles, sont dans le tableau ci-dessus.`,
        ),
    ),
  );

if (skipped.length)
  sections.push(
    section(
      "Non publiées",
      `<p>Un jeu de mesures incomplet ne fait pas tomber le site — il est nommé ici. Ce qui serait
grave, ce serait de le taire.</p><ul>${skipped
        .map(
          (x) => `<li><strong>${esc(x.version)}</strong> — ${esc(x.why)}</li>`,
        )
        .join("")}</ul>`,
    ),
  );

writeFileSync(
  path.join(OUT, "index.html"),
  doc({
    title: "Performance de Nodefony",
    subtitle:
      "Les chiffres sont mesurés à la main, sur une machine nommée, puis versionnés dans le dépôt — cette page ne fait que les rendre.",
    // La marque ramène à l'accueil du site, comme partout ailleurs : cette page
    // est publiée à côté de la documentation, pas toute seule.
    brand: { ...NODEFONY_BRAND, href: "../" },
    head: `<link rel="icon" href="../favicon.png">`,

    sections,
    style:
      STYLE_GRAPHES +
      `
.wrap { max-width:none; padding:26px 34px 80px; }
@media (max-width:820px) { .wrap { padding:20px 18px 60px; } }
.badge-latest { font-size:11.5px; padding:2px 9px; border-radius:20px; margin-left:8px;
  border:1px solid var(--accent); color:var(--accent); }`,
    footer:
      `<a href="../">← Documentation Nodefony</a> — les données brutes sont versionnées dans ` +
      `<a href="https://github.com/nodefony/nodefony-core/tree/main/docs/performance"><code>docs/performance/</code></a>, ` +
      `cette page les rend.`,
  }),
);

console.log(
  `\nsite : ${rendered.length} version(s) rendue(s)${skipped.length ? `, ${skipped.length} sautée(s)` : ""} → ${OUT}`,
);
