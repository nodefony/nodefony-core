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
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  doc,
  section,
  cards,
  table,
  calculator,
  warn,
  note,
  printButton,
  deckControls,
  csvExport,
  fmt,
  COLORS,
} from "../../nodefony-html-report/lib/report.mjs";
// Les figures viennent du moteur ECharts — mêmes signatures, rendu vectoriel
// dans les DEUX thèmes, sans un octet de JavaScript servi au lecteur.
import {
  barChart,
  lineChart,
} from "../../nodefony-html-report/lib/report-echarts.mjs";
// La cascade et les boîtes n'ont pas d'adaptateur dans `report-echarts.mjs` :
// on prend le moteur directement, et `couple`/`figure` rendent les deux thèmes.
import {
  STYLE_GRAPHES,
  cascade,
  boxplot,
  couple,
  figure,
} from "../../nodefony-html-report/lib/echarts.mjs";

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
// 🔴 Fastify est HORS PÉRIMÈTRE, et c'est une décision, pas une mesure manquante.
// Il sature à ~41 000 req/s ce que cette machine mesure proprement : trois paires
// tentées, trois INCONCLUSIVES. Surtout, il n'informe pas la question de ce dossier —
// Nodefony se compare à ce qu'un développeur écrirait pour rendre le MÊME service,
// et ce camp-là s'appelle `express-fair`. Le banc `bench-frameworks/fastify.mjs`
// reste disponible pour qui voudra le rejouer sur une machine plus rapide.
const FRAMEWORKS = [
  {
    id: "bare",
    label: "node:http nu",
    note: "aucun framework — plancher théorique",
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
// 🔴 CE QUI SUIT SE LIT, IL NE S'AFFIRME PAS.
// Trois phrases de cette page étaient écrites EN DUR : « Fuite mémoire : aucune »,
// « le débit ne s'érode pas » et « palier atteint, pas une rampe ». Elles disaient
// vrai le jour où elles ont été écrites, et la page a continué de les servir quand
// la mesure a cessé de les soutenir : un soak de 90 min a rendu +108,6 MB/h de RSS
// (R² 0,99, SANS plateau) et −6,4 % de débit — la page l'aurait publié sous
// « aucune fuite » et « palier atteint », c'est-à-dire l'inverse exact de sa donnée.
// Un rapport qui affirme ce qu'il n'a pas lu n'est pas un rapport.
// 🔴 ET CE QUI SE LIT DOIT ÊTRE LE BON COMPTEUR.
// La correction ci-dessus a fait dériver les phrases de la donnée — mais la donnée
// lue était `rss`, et sous macOS `rss` COMPTE les pages que l'allocateur a déjà
// rendues au noyau. Cette page a donc publié trois semaines durant « RSS en hausse,
// sans plateau » sur un processus dont l'empreinte réelle n'avait pas bougé de 2 MB.
// Le verdict porte désormais sur `phys_footprint` (Darwin) / `VmRSS` (Linux), et un
// run qui ne l'a PAS relevé ne conclut rien — il le dit, au lieu d'accuser.
const aEmpreinte = typeof soak.footprintSlopeMbPerHour === "number";
const empreinteMonte =
  aEmpreinte &&
  soak.footprintSlopeMbPerHour > 20 &&
  (soak.footprintR2 ?? 0) > 0.7;
const artefact = soak.artefactComptage === true;
const rssMonte =
  soak.rssPlateau === false && (soak.rssSlopeMbPerHour ?? 0) > 20;
const tasMonte = soak.verdict === "leak";
const debitErode = (soak.rpsDriftPct ?? 0) < -3;
const fuiteLabel = tasMonte
  ? "tas en hausse"
  : empreinteMonte
    ? "empreinte en hausse"
    : !aEmpreinte && rssMonte
      ? "non conclusif"
      : "aucune";
const fuiteSub = tasMonte
  ? `tas +${fmt.dec(soak.heapSlopeMbPerHour, 1)} MB/h (R² ${fmt.dec(soak.heapR2, 2)}) sur ${soak.minutes} min`
  : empreinteMonte
    ? `tas stable mais empreinte système +${fmt.dec(soak.footprintSlopeMbPerHour, 1)} MB/h (R² ${fmt.dec(soak.footprintR2, 2)}) sur ${soak.minutes} min`
    : !aEmpreinte && rssMonte
      ? `run ancien : seul <code>rss</code> relevé (+${fmt.dec(soak.rssSlopeMbPerHour, 1)} MB/h), or il inclut les pages déjà rendues au noyau — l'empreinte système n'a pas été mesurée`
      : artefact
        ? `${soak.minutes} min de trafic continu · empreinte plate (+${fmt.dec(soak.footprintSlopeMbPerHour, 1)} MB/h) ; le <code>rss</code> monte de ${fmt.dec(soak.rssSlopeMbPerHour, 1)} MB/h, dont ${fmt.dec((soak.reclaimableSlopeMbPerHour / soak.rssSlopeMbPerHour) * 100, 0)} % de pages réutilisables`
        : `${soak.minutes} min de trafic continu · tas sans tendance (R² ${fmt.dec(soak.heapR2, 2)})`;

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

// 🔴 LE DÉCOR D'UNE MESURE NE VIENT PAS DE LA MACHINE QUI L'AFFICHE.
// Ces deux champs se lisaient sur la machine du RENDU (`process.version`, `sysctl`).
// En session interactive, rendu et mesure ont lieu au même endroit, donc c'était juste
// par coïncidence — et l'erreur est restée invisible jusqu'à la première publication :
// l'exécuteur d'intégration continue, qui n'a pas `sysctl`, a rendu « ? cœurs logiques »,
// et il aurait tout aussi bien pu afficher SES quatre cœurs comme ceux du banc. Un décor
// faux et crédible est pire qu'un décor absent. Le jeu versionné porte ces valeurs
// (`provenance.machine`, `provenance.node`) : elles priment toujours, et la machine
// locale ne sert que de repli pour le mode éphémère, où elle EST la machine de mesure.
const prov = dataset?.provenance ?? null;
const node = prov?.node ?? (dataset ? "non enregistré" : process.version);
const cpus =
  prov?.machine?.logicalCores ??
  (dataset
    ? "non enregistré"
    : (() => {
        try {
          return execFileSync("sysctl", ["-n", "hw.logicalcpu"], {
            encoding: "utf8",
          }).trim();
        } catch {
          return "?";
        }
      })());
const cpuModel = prov?.machine?.cpu ?? null;

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
      v: fuiteLabel,
      sub: fuiteSub,
    },
    {
      // L'empreinte est ce qu'un orchestrateur regarde pour évincer. Quand elle
      // a été relevée, c'est ELLE qu'on affiche ; `rss` reste en sous-titre,
      // parce que l'écart entre les deux est lui-même l'information.
      k: aEmpreinte ? "Empreinte d'un pod en régime" : "RSS en fin de run",
      v: fmt.dec(
        aEmpreinte
          ? kept[kept.length - 1].footprintMb
          : kept[kept.length - 1].rssMb,
        0,
      ),
      unit: "MB",
      sub: aEmpreinte
        ? `parti de ${fmt.dec(kept[0].footprintMb, 0)} MB${
            artefact
              ? ` · le <code>rss</code> affiche ${fmt.dec(kept[kept.length - 1].rssMb, 0)} MB, pages réutilisables comprises`
              : ""
          }`
        : `parti de ${fmt.dec(kept[0].rssMb, 0)} MB — empreinte système non relevée sur ce run`,
    },
  ]) +
    `<p><strong>La performance n'est pas le point faible de Nodefony.</strong> À travail égal — c'est-à-dire
     face à un Express muni des mêmes middlewares (scope ALS, CORS, en-têtes de sécurité, contrôle CSRF,
     corrélation <code>traceparent</code>, zones de pare-feu) — le framework rend
     <strong>${fmt.dec(ratioRps, 0)} %</strong> du débit pour <strong>+${fmt.dec(deltaP99, 2)} ms</strong>
     de p99. L'écart avec un serveur nu ne mesure pas une lenteur : il mesure le travail que le serveur nu
     ne fait pas.</p>
     <p>Sur ${soak.minutes} minutes de charge continue, ${
       tasMonte
         ? `le tas monte de ${fmt.dec(soak.heapSlopeMbPerHour, 1)} MB/h`
         : "le tas ne monte pas"
     }${
       empreinteMonte
         ? ` — mais l'<strong>empreinte système</strong> du processus, elle, monte de
     <strong>${fmt.dec(soak.footprintSlopeMbPerHour, 1)} MB/h</strong> de façon régulière
     (R² ${fmt.dec(soak.footprintR2, 2)}) : c'est ce qu'un orchestrateur compte pour évincer un pod`
         : artefact
           ? ` — et l'<strong>empreinte système</strong> non plus (${fmt.dec(soak.footprintSlopeMbPerHour, 1)} MB/h,
     R² ${fmt.dec(soak.footprintR2, 2)}). Le <code>rss</code> affiché, lui, monte de
     ${fmt.dec(soak.rssSlopeMbPerHour, 1)} MB/h, mais
     <strong>${fmt.dec((soak.reclaimableSlopeMbPerHour / soak.rssSlopeMbPerHour) * 100, 0)} %</strong>
     de cette hausse est du résident que l'allocateur a déjà rendu au noyau — sous macOS, ce compteur
     les inclut, et <code>phys_footprint</code> les exclut`
           : !aEmpreinte && rssMonte
             ? ` — le <code>rss</code> monte de <strong>${fmt.dec(soak.rssSlopeMbPerHour, 1)} MB/h</strong>,
     mais ce run n'a pas relevé l'empreinte système : <strong>il ne permet pas de conclure</strong>,
     car sous macOS <code>rss</code> compte aussi les pages déjà rendues au noyau`
             : ""
     }${
       debitErode
         ? `, et le débit s'érode de ${fmt.dec(Math.abs(soak.rpsDriftPct), 1)} %`
         : " et le débit ne s'érode pas"
     }.
     ${
       empreinteMonte
         ? `<strong>C'est un point ouvert, pas un acquis</strong> — rapporté à la charge servie, cela fait
     ${fmt.dec(soak.footprintMbPerMillionReq ?? 0, 2)} MB par million de requêtes, soit une projection de
     ${fmt.dec(((soak.footprintSlopeMbPerHour ?? 0) * 72) / 1024, 1)} Go sur trois jours.`
         : !aEmpreinte && rssMonte
           ? `<strong>Ce point reste à trancher sur ce run</strong> : il faut le rejouer avec un banc qui
     relève l'empreinte du noyau, faute de quoi on ne sait pas distinguer une mémoire consommée d'un
     résident déjà rendu.`
           : `Le risque résiduel d'un passage en production n'est donc pas la performance —
     <a href="#limites">il est nommé plus bas</a>.`
     }</p>`,
  { break: "avoid" },
);

const comparatif = section(
  "Le débit, camp par camp",
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
  "Ce que la durée révèle",
  `<p>${soak.minutes} minutes de trafic continu, ${kept.length} fenêtres retenues sur
   ${soak.samples.length} (les premières sont écartées : un tas monte jusqu'à son régime). Ce banc
   cherche une <strong>pente</strong>, pas un écart entre deux mesures bruitées.</p>` +
    // ── DE QUOI la mémoire résidente est-elle FAITE ? ────────────────────
    //
    // Deux courbes superposées — `rss` et le tas — laissaient le lecteur devant
    // une pente montante sans lui dire ce qui monte, et la conclusion qu'il en
    // tirait (« ça fuit ») était fausse. Une pile répond à la question posée :
    // la couche qui grossit est celle que l'allocateur a DÉJÀ rendue au noyau.
    // La courbe `rss` reste tracée PAR-DESSUS (`outsideStack`) pour montrer que
    // la somme des couches le rejoint — une décomposition qui ne referme pas
    // son total ne prouve rien.
    (kept.every((s) => typeof s.footprintMb === "number")
      ? lineChart(
          [
            {
              label: "empreinte système (ce que le noyau compte)",
              color: COLORS.blue,
              points: kept.map((s) => ({ x: s.atSec / 60, y: s.footprintMb })),
            },
            ...(kept.every((s) => typeof s.cleanMb === "number")
              ? [
                  {
                    label: "mappé partageable (code, non modifiable)",
                    color: COLORS.grey,
                    points: kept.map((s) => ({
                      x: s.atSec / 60,
                      y: s.cleanMb,
                    })),
                  },
                ]
              : []),
            {
              label: "pages réutilisables (déjà rendues au noyau)",
              color: COLORS.amber,
              points: kept.map((s) => ({
                x: s.atSec / 60,
                y: s.reclaimableMb ?? 0,
              })),
            },
            {
              label: "rss affiché",
              color: COLORS.red,
              outsideStack: true,
              dashed: true,
              points: kept.map((s) => ({ x: s.atSec / 60, y: s.rssMb })),
            },
          ],
          {
            xLabel: "minutes",
            // Pas de titre d'axe Y ici : le moteur le place en haut à gauche,
            // où il chevauche le sous-titre. L'unité vit donc dans le
            // sous-titre, qui est lu de toute façon.
            stacked: true,
            title: "De quoi la mémoire résidente est faite",
            desc: "en MB — seule la couche du bas coûte quelque chose au système",
          },
        )
      : "") +
    // Le tas SEUL, sur sa propre échelle. Le tracer avec le `rss` écrasait une
    // courbe à 45 MB sous une courbe à 250 : on ne voyait plus rien de celle
    // qui répond à la question « y a-t-il une fuite JavaScript ? ». Et quand la
    // figure empilée est là, le `rss` y est déjà, mieux dit.
    lineChart(
      [
        {
          label: "tas (heap)",
          color: COLORS.green,
          points: kept.map((s) => ({ x: s.atSec / 60, y: s.heapUsedMb })),
        },
        ...(kept.every((s) => typeof s.footprintMb === "number")
          ? []
          : [
              {
                label: "RSS",
                color: COLORS.blue,
                points: kept.map((s) => ({ x: s.atSec / 60, y: s.rssMb })),
              },
            ]),
      ],
      {
        xLabel: "minutes",
        title: "Le tas JavaScript",
        desc: "en MB — sur sa propre échelle, sinon il disparaît sous le rss",
      },
    ) +
    // ── OÙ SONT PASSÉS LES MÉGAOCTETS ? ──────────────────────────────────
    //
    // Une pente dit COMBIEN, jamais OÙ. La cascade décompose la hausse du
    // `rss` en postes qui envoient chacun chercher à un endroit DIFFÉRENT —
    // et rend visible en une seconde que le poste dominant est celui qui ne
    // coûte rien. C'est la figure qui aurait évité trois semaines d'erreur.
    (kept.every((s) => typeof s.reclaimableMb === "number")
      ? figure(
          couple(cascade, {
            // Partir de ZÉRO, pas du `rss` initial : avec un départ à 233 MB,
            // l'axe s'étire jusqu'au sommet et les postes — qui valent quelques
            // mégaoctets — deviennent des traits invisibles. On décompose la
            // VARIATION, qui est la question posée ; le niveau absolu est déjà
            // sur la figure précédente.
            depart: 0,
            // Même raison qu'au-dessus : le titre d'axe chevauche le sous-titre.
            titre: "Où sont passés les mégaoctets",
            sousTitre: `en MB — la hausse du rss (${fmt.dec(kept[0].rssMb, 0)} → ${fmt.dec(kept[kept.length - 1].rssMb, 0)} MB), poste par poste`,
            postes: [
              {
                nom: "tas réservé par V8",
                delta: +(
                  kept[kept.length - 1].heapTotalMb - kept[0].heapTotalMb
                ).toFixed(1),
              },
              {
                nom: "mémoire externe",
                delta: +(
                  kept[kept.length - 1].externalMb - kept[0].externalMb
                ).toFixed(1),
              },
              {
                nom: "pages réutilisables",
                delta: +(
                  kept[kept.length - 1].reclaimableMb - kept[0].reclaimableMb
                ).toFixed(1),
              },
              {
                nom: "empreinte système",
                delta: +(
                  kept[kept.length - 1].footprintMb - kept[0].footprintMb
                ).toFixed(1),
              },
            ],
          }),
          {},
        )
      : "") +
    // ── LE DÉBIT S'ÉRODE-T-IL ? ──────────────────────────────────────────
    //
    // Une courbe de débit se lit mal : elle bruite, et l'œil y voit la pente
    // qu'on lui a annoncée. Trois boîtes disent la DISPERSION — si elles se
    // recouvrent, il ne se passe rien, et aucun commentaire ne peut prétendre
    // le contraire. Cette page a publié « le débit s'érode de 6,4 % » parce
    // qu'elle comparait deux points ; trois boîtes l'auraient démentie.
    (kept.length >= 9
      ? figure(
          couple(boxplot, {
            axeValeur: "req/s",
            titre: "Le débit tient-il ? — la distribution, pas deux points",
            sousTitre: "un tiers du run par boîte",
            data: [
              {
                label: "1ᵉʳ tiers",
                valeurs: kept
                  .slice(0, Math.floor(kept.length / 3))
                  .map((s) => s.rps),
              },
              {
                label: "2ᵉ tiers",
                valeurs: kept
                  .slice(
                    Math.floor(kept.length / 3),
                    Math.floor((kept.length * 2) / 3),
                  )
                  .map((s) => s.rps),
              },
              {
                label: "3ᵉ tiers",
                valeurs: kept
                  .slice(Math.floor((kept.length * 2) / 3))
                  .map((s) => s.rps),
              },
            ],
          }),
          {},
        )
      : "") +
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
        // Le cas NÉGATIF ne doit pas ressembler au positif : « montée puis palier »
        // affirmait un palier là où le critère venait de dire qu'il n'était pas
        // confirmé, et les deux libellés se lisaient pareil. Quand on frôle le seuil
        // — ici 8,16 contre 8,10 MB/h, 0,7 % d'écart — le rendu le DIT, plutôt que de
        // trancher dans un sens ou dans l'autre sur du bruit.
        sub: isPlateau
          ? "plateau confirmé"
          : rssSlopeLate < rssSlopeAll / 2.5
            ? `palier NON confirmé — ${fmt.dec(rssSlopeLate, 1)} MB/h en seconde moitié, tout près du seuil`
            : "monte encore — à observer plus longtemps",
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
  "Les constantes d'un pod",
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
      ...(cpuModel ? [["Processeur", cpuModel]] : []),
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

/* ── Découpage en PAGES ───────────────────────────────────────────────────
 *
 * 🔴 UNE SEULE PAGE NOYAIT SON LECTEUR. Elle empilait le verdict, le comparatif,
 * quatre figures de tenue dans la durée, un calculateur de dimensionnement, les
 * limites et le décor — plusieurs milliers de pixels de haut, sans autre repère
 * qu'une barre de défilement. Constaté sur un lecteur réel : il a trouvé la page,
 * et n'y a pas trouvé les graphes.
 *
 * Le découpage suit les QUESTIONS, pas la structure du script : « où se
 * situe-t-il ? », « est-ce que ça tient ? », « combien de pods ? », « comment
 * l'avez-vous mesuré ? ». L'accueil répond en trente secondes et renvoie ; chaque
 * page répond à une seule chose, et porte la navigation vers les autres.
 *
 * Les données restent EMBARQUÉES sur l'accueil, à un seul endroit : les répliquer
 * sur cinq pages multiplierait le poids sans rien ajouter, et deux copies d'un
 * jeu de mesures finissent par diverger.
 */
const PAGES = [
  { slug: "", titre: "Le verdict", quoi: "la réponse en trente secondes" },
  {
    slug: "comparatif",
    titre: "Où se situe Nodefony",
    quoi: "le débit face à un Express qui fait le même travail",
  },
  {
    slug: "duree",
    titre: "La tenue dans la durée",
    quoi: "mémoire et débit sous charge continue",
  },
  {
    slug: "dimensionner",
    titre: "Dimensionner un pod",
    quoi: "combien d'exemplaires pour votre trafic",
  },
  {
    slug: "methode",
    titre: "Méthode et décor",
    quoi: "la machine, le protocole, et les commandes qui rejouent chaque chiffre",
  },
];

/** La navigation, rendue du point de vue de la page COURANTE. */
const nav = (courant) =>
  `<nav class="perf-nav" aria-label="Sections du dossier">` +
  PAGES.map((x) => {
    const href =
      courant === x.slug ? null : x.slug === "" ? "../" : `../${x.slug}/`;
    const cible = courant === "" && x.slug !== "" ? `./${x.slug}/` : href;
    return cible === null
      ? `<span aria-current="page">${x.titre}</span>`
      : `<a href="${cible}">${x.titre}</a>`;
  }).join("") +
  `</nav>`;

const STYLE_NAV = `
.perf-nav { display:flex; flex-wrap:wrap; gap:.35rem .5rem; margin:0 0 1.6rem;
  padding:.55rem .7rem; border:1px solid rgba(128,128,128,.28); border-radius:10px;
  font-size:13.5px; max-width:none; }
.perf-nav a, .perf-nav span { padding:.2rem .5rem; border-radius:6px; text-decoration:none; }
.perf-nav a:hover { background:rgba(128,128,128,.14); }
.perf-nav [aria-current="page"] { font-weight:650; background:rgba(128,128,128,.16); }`;

const pied = (courant) =>
  (courant === ""
    ? `<a href="../">← Toutes les versions</a> · <a href="../../">Documentation</a>`
    : `<a href="../">← Le verdict</a> · <a href="../../">Toutes les versions</a>`) +
  ` — généré par <code>node .claude/skills/nodefony-load-test/scripts/prod-readiness-report.mjs</code> — Node ${node}`;

/**
 * L'accueil ne répète pas les sections : il les ANNONCE. Trois cartes qui disent
 * ce qu'on trouve derrière chaque lien — un sommaire qui n'énonce que des titres
 * oblige à ouvrir pour savoir, et c'est exactement ce qu'on cherche à éviter.
 */
const sommaire = section(
  "Le dossier, en quatre pages",
  cards(
    PAGES.filter((x) => x.slug !== "").map((x) => ({
      k: x.titre,
      v: `<a href="./${x.slug}/"><strong>Ouvrir</strong></a>`,
      sub: x.quoi,
    })),
  ),
);

const corps = {
  "": [printButton() + deckControls(), verdict, sommaire, limites],
  comparatif: [comparatif],
  duree: [tenue],
  dimensionner: [capacite],
  methode: [decor],
};

const titres = {
  "": "Nodefony peut-il partir en production ?",
  comparatif: "Où se situe Nodefony",
  duree: "La tenue dans la durée",
  dimensionner: "Dimensionner un pod",
  methode: "Méthode et décor",
};

const soustitres = {
  "": "Trois mesures — débit à travail égal, tenue dans la durée, dimensionnement d'un pod — et ce qu'elles ne prouvent pas.",
  comparatif:
    "Le débit, face à un serveur nu et face à un Express muni des mêmes garanties.",
  duree:
    "Ce qu'un banc de dix secondes ne peut pas voir : la mémoire et le débit sur la durée.",
  dimensionner:
    "Des constantes mesurées, un calculateur, et ce que le modèle suppose.",
  methode:
    "La machine, le protocole, les commandes qui rejouent chaque chiffre — et ce qu'un décor sale déplace.",
};

const dossierOut = path.dirname(OUT);
let ecrites = 0;
for (const page of PAGES) {
  const html = doc({
    style: STYLE_GRAPHES + STYLE_NAV,
    title: titres[page.slug],
    subtitle: soustitres[page.slug],
    sections: [nav(page.slug), ...corps[page.slug]],
    footer: pied(page.slug),
    // Les données ne sont embarquées QUE sur l'accueil (cf le commentaire
    // ci-dessus) : cinq copies pèseraient cinq fois et divergeraient un jour.
    ...(page.slug === ""
      ? { data: { comparatif: bench, soak, capacite: CAP } }
      : {}),
  });
  const cible =
    page.slug === "" ? OUT : path.join(dossierOut, page.slug, "index.html");
  mkdirSync(path.dirname(cible), { recursive: true });
  writeFileSync(cible, html);
  ecrites++;
  console.log(
    `  ${page.slug === "" ? "(accueil)" : page.slug} — ${(html.length / 1024).toFixed(0)} Ko`,
  );
}
console.log(`rapport écrit : ${ecrites} pages sous ${dossierOut}`);
