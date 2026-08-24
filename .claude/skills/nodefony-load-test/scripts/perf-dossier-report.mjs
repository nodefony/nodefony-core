/**
 * Rapport HTML de synthèse — dossier Performance de Nodefony.
 *
 * Restitue, pour un lecteur qui doit DÉCIDER, ce que le dossier `docs/performance/`
 * établit en Markdown : où part le temps, ce que le chantier a rendu, ce qu'il a
 * annulé, ce que le décor interdit de conclure, et combien de pods il faut.
 *
 * POURQUOI CE FICHIER EST VERSIONNÉ ICI, et pas dans `tmp/` avec sa sortie.
 * Le rapport HTML est une PHOTO : il se jette et se refabrique. Le générateur, lui,
 * est du CODE — et un générateur qui vit dans `tmp/` disparaît au premier ménage,
 * emportant la seule façon de reproduire la page. Corollaire tenu ici : la page
 * produite ne référence AUCUN chemin de `tmp/`, et le dossier Markdown non plus.
 *
 * Les données sont DÉCLARÉES dans ce fichier et EMBARQUÉES dans la page
 * (`doc({ data })`) → le rapport se rejoue, se compare et se ré-ingère. Mettre à
 * jour un chiffre = éditer la constante DATA ci-dessous, puis relancer.
 *
 * Usage :  node .claude/skills/nodefony-load-test/scripts/perf-dossier-report.mjs [sortie.html]
 * Défaut : tmp/performance-nodefony.html
 *
 * Source de vérité éditoriale : `docs/performance/` (Markdown versionné).
 */
import { writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
import {
  doc,
  section,
  cards,
  table,
  tabs,
  details,
  note,
  warn,
  calculator,
  tableFilter,
  csvExport,
  deckControls,
  printButton,
  legend,
  svgFigure,
  esc,
  fmt,
  COLORS,
  series,
} from "../../nodefony-html-report/lib/report.mjs";
// Les figures viennent du moteur ECharts — mêmes signatures, rendu vectoriel
// dans les DEUX thèmes, sans un octet de JavaScript servi au lecteur.
import {
  barChart,
  lineChart,
  donut,
  gauge,
} from "../../nodefony-html-report/lib/report-echarts.mjs";
import { STYLE_GRAPHES } from "../../nodefony-html-report/lib/echarts.mjs";

const OUT = process.argv[2] ?? "tmp/performance-nodefony.html";

// 🔴 UNE SOURCE, DEUX RENDUS. Le comparatif de frameworks vivait ici EN DUR et
// aussi dans `docs/performance/data/<version>.json` que rend la page de version :
// deux copies de la même mesure, qui ont divergé dès la campagne suivante — cette
// page annonçait encore les chiffres du 2026-08-07 pendant que l'autre publiait
// ceux du 08-23. Le jeu versionné fait autorité ; ce qu'il ne porte PAS (profilage
// V8, lots A→D, escalier ORM) reste déclaré ci-dessous avec sa fenêtre, et la
// table de chronologie dit à quel état du code chaque bloc correspond.
const DATASET = (() => {
  const dir = path.join(ROOT_DIR, "docs", "performance", "data");
  const explicit = process.argv.indexOf("--data");
  const file =
    explicit >= 0 && process.argv[explicit + 1]
      ? process.argv[explicit + 1]
      : (() => {
          if (!existsSync(dir)) return null;
          const versions = readdirSync(dir)
            .filter((f) => f.endsWith(".json"))
            .sort()
            .reverse();
          return versions.length ? path.join(dir, versions[0]) : null;
        })();
  if (!file || !existsSync(file)) return null;
  const d = JSON.parse(readFileSync(file, "utf8"));
  return d?.comparison?.frameworks ? d : null;
})();

/* ─────────────────────────── SCHÉMAS (SVG généré) ─────────────────────────── */

/**
 * Le trajet d'une requête dans le pipeline : chaque étage, sa nature (structurel
 * ou accidentel) et le lot qui l'a traité. Largeur de bloc ∝ coût relatif.
 */
const schemaPipeline = (etapes) => {
  const W = 660;
  const H = 60 + etapes.length * 34;
  const padL = 4;
  const barX = 186;
  const barW = W - barX - 96;
  const total = etapes.reduce((s, e) => s + e.poids, 0);
  const body = etapes
    .map((e, i) => {
      const y = 44 + i * 34;
      const w = Math.max((e.poids / total) * barW, 6);
      const fill = e.nature === "structurel" ? COLORS.grey : COLORS.green;
      return `
      <text x="${padL}" y="${y + 14}" class="lbl">${esc(e.label)}</text>
      <rect x="${barX}" y="${y + 2}" width="${w}" height="16" rx="3" fill="${fill}"/>
      <text x="${barX + w + 8}" y="${y + 15}" class="val">${esc(e.tag)}</text>`;
    })
    .join("");
  return svgFigure(
    `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" %ARIA%>%TD%
      <text x="${padL}" y="16" class="axis">Trajet d'une requête — largeur ∝ coût relatif</text>
      <rect x="${barX}" y="26" width="10" height="10" rx="2" fill="${COLORS.grey}"/>
      <text x="${barX + 16}" y="35" class="axis">structurel (assumé)</text>
      <rect x="${barX + 150}" y="26" width="10" height="10" rx="2" fill="${COLORS.green}"/>
      <text x="${barX + 166}" y="35" class="axis">accidentel (traité)</text>
      ${body}
    </svg>`,
    {
      title: "Étages traversés par une requête HTTP",
      desc: etapes.map((e) => `${e.label} : ${e.tag}`).join(" · "),
    },
  );
};

/**
 * Latence contre blocage : deux frises de la boucle d'événements. La zone pleine
 * est du temps que personne d'autre ne peut utiliser ; la zone hachurée est de
 * l'attente, pendant laquelle le serveur sert d'autres requêtes.
 */
const schemaBoucle = () => {
  const W = 660;
  const scale = (ms) => (ms / 520) * (W - 200);
  const ligne = (y, titre, occupe, attente, note) => `
    <text x="4" y="${y + 14}" class="lbl">${esc(titre)}</text>
    <rect x="180" y="${y}" width="${Math.max(scale(occupe), 3)}" height="18" rx="2" fill="${COLORS.vermillion}"/>
    <rect x="${180 + Math.max(scale(occupe), 3)}" y="${y}" width="${Math.max(scale(attente), 1)}" height="18" rx="2" fill="url(#hatch)"/>
    <text x="${180 + Math.max(scale(occupe + attente), 4) + 8}" y="${y + 14}" class="val">${esc(note)}</text>`;
  return svgFigure(
    `<svg viewBox="0 0 ${W} 168" class="chart" role="img" %ARIA%>%TD%
      <defs>
        <pattern id="hatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
          <rect width="6" height="6" fill="none"/>
          <line x1="0" y1="0" x2="0" y2="6" stroke="${COLORS.skyblue}" stroke-width="3"/>
        </pattern>
      </defs>
      <text x="4" y="16" class="axis">La boucle d'événements pendant une requête (échelle : 0 à 520 ms)</text>
      <rect x="180" y="26" width="10" height="10" rx="2" fill="${COLORS.vermillion}"/>
      <text x="196" y="35" class="axis">boucle OCCUPÉE — plafonne le processus</text>
      <rect x="440" y="26" width="10" height="10" rx="2" fill="url(#hatch)"/>
      <text x="456" y="35" class="axis">attente — gratuite</text>
      ${ligne(56, "SQLite synchrone", 133, 0, "133 ms bloqués")}
      ${ligne(96, "PostgreSQL asynchrone", 0.22, 503, "0,22 ms bloqués sur 503")}
      <text x="4" y="150" class="axis">Le rappel armé avant la requête part après 134 ms côté SQLite, après 0,22 ms côté PostgreSQL.</text>
    </svg>`,
    {
      title: "Latence et blocage de la boucle d'événements",
      desc:
        "SQLite occupe la boucle pendant toute sa requête (133 ms) ; PostgreSQL ne l'occupe que 0,22 ms " +
        "sur 503 ms de requête, le reste étant de l'attente pendant laquelle le serveur sert d'autres requêtes.",
    },
  );
};

/* ────────────────────────────── DONNÉES ────────────────────────────── */

const DATA = {
  decor: {
    machine:
      "MacBook Pro — Intel Core i9-8950HK @ 2,90 GHz, 6 cœurs physiques / 12 logiques, 32 Go",
    systeme: "macOS 15.7.7 (Darwin 24.6)",
    serveur:
      "mono-processus, NODE_ENV=production, boucle locale, NF_LOG_DRIVER=null",
    charge: "wrk 4.2.0 [kqueue], -t4",
    familles: [
      {
        nom: "Pipeline HTTP (A/B et profils)",
        node: "v26.5.0",
        wrk: "-c128, 10 s",
        routes: 136,
      },
      {
        nom: "Comparatif de frameworks",
        node: "v26.5.0",
        wrk: "-c128, 10 s",
        routes: 186,
      },
      {
        nom: "ORM et bases de données",
        node: "v26.7.0",
        wrk: "-c25, 7 s",
        routes: 186,
      },
    ],
  },

  // Niveau 1/2/3 de comparaison — chaque niveau dans SA fenêtre.
  comparatif: {
    n1: [
      { label: "node:http nu", rps: 37770, disp: 0.7, ratio: 3.23 },
      { label: "Fastify", rps: 33024, disp: 0.5, ratio: 2.82 },
      { label: "Express", rps: 18845, disp: 2.0, ratio: 1.61 },
      { label: "Nodefony", rps: 11702, disp: 0.8, ratio: 1.0 },
    ],
    n2: [
      { label: "node:http nu", rps: 37161 },
      { label: "Express nu", rps: 18497 },
      { label: "Express équipé (même travail)", rps: 14891 },
      { label: "Nodefony", rps: 11512 },
    ],
    n3: [
      { label: "Express nu + ORM naïf", rps: 1089 },
      { label: "Nodefony avant le lot", rps: 1017 },
      { label: "Nodefony livré", rps: 1640 },
      { label: "Express équipé + ORM préparé", rps: 1758 },
      { label: "Express nu + ORM préparé", rps: 1801 },
    ],
    ecarts: [
      { situation: "L'application ne fait rien", ratio: 1.61 },
      { situation: "Même travail par requête", ratio: 1.29 },
      { situation: "Même travail ET une vraie requête SQL", ratio: 1.07 },
    ],
  },

  // Profil CPU ACTUEL — une part par poste sur une requête servie. `null` quand
  // le poste n'a pas été re-profilé depuis sa dernière modification : le dire
  // vaut mieux que publier une valeur périmée en la présentant comme courante.
  profil: [
    {
      poste: "Écouteurs Node",
      actuel: 9.0,
      nature: "structurel",
    },
    {
      poste: "Analyse HTTP entrante",
      actuel: 8.0,
      nature: "structurel",
    },
    {
      poste: "Pose des en-têtes sortants",
      actuel: 7.3,
      nature: "propre au framework",
    },
    {
      poste: "Écriture sur la socket",
      actuel: 5.0,
      nature: "structurel",
    },
    {
      poste: "Portée d'injection",
      actuel: 4.4,
      nature: "propre au framework",
    },
    {
      poste: "Code du noyau HTTP",
      actuel: 3.47,
      nature: "propre au framework",
    },
    {
      poste: "Fabrique de contexte",
      actuel: null,
      nature: "propre au framework",
    },
    {
      poste: "Ramasse-miettes",
      actuel: 1.2,
      nature: "structurel",
    },
    {
      poste: "Résolution de route",
      actuel: 0.6,
      nature: "propre au framework",
    },
    {
      poste: "Reformatage d'URL",
      actuel: 0.16,
      nature: "propre au framework",
    },
    {
      poste: "Nonce CSP",
      actuel: 0.16,
      nature: "propre au framework",
    },
    {
      poste: "Armements de délai",
      actuel: 0.05,
      nature: "propre au framework",
    },
  ],

  // Comptes exacts par requête (sonde, 107 618 requêtes) — aucune mesure de temps.
  comptes: [
    {
      op: "res.setHeader",
      n: 10,
      detail:
        "serveur · nosniff · cadre · référent · CSP · id · traçage · type ×2 · longueur",
    },
    {
      op: "res.removeHeader",
      n: 3,
      detail: "type de contenu ×2 (aller-retour) · longueur",
    },
    {
      op: "socket.setTimeout",
      n: 3,
      detail: "2 par Node (délais désalignés) + 1 par le framework",
    },
    {
      op: "res.writeHead (message personnalisé)",
      n: 1,
      detail: "à chaque requête → chemin lent de Node",
    },
    {
      op: "res.getHeaders() (copie intégrale)",
      n: 1,
      detail: "un hasHeader maison qui copiait tout",
    },
    {
      op: "Écouteurs attachés",
      n: 4,
      detail: "fermeture ×2 · fin · terminé — majoritairement Node",
    },
    { op: "res.write + res.end", n: 2, detail: "deux écritures logiques" },
  ],

  // Escalier ORM — chaque marche n'ajoute qu'une chose.
  escalier: [
    {
      route: "Cible de banc (contrôle)",
      ajout: "pipeline nu",
      rps: 11580,
      us: 86,
      disp: 1.9,
    },
    {
      route: "Session — magasin mémoire",
      ajout: "session en mémoire",
      rps: 9664,
      us: 103,
      disp: 1.7,
    },
    {
      route: "Session — SQLite",
      ajout: "session via l'ORM",
      rps: 2350,
      us: 426,
      disp: 1.5,
    },
    {
      route: "Écriture d'une facture",
      ajout: "INSERT + 2 clés étrangères",
      rps: 1329,
      us: 752,
      disp: 1.4,
    },
    {
      route: "Lecture allégée",
      ajout: "find() 20 lignes",
      rps: 1068,
      us: 936,
      disp: 2.5,
    },
    {
      route: "Lecture complète",
      ajout: "+ JSON complet",
      rps: 1022,
      us: 978,
      disp: 3.0,
    },
    {
      route: "Cycle utilisateur — mémoire",
      ajout: "session mémoire + lecture",
      rps: 983,
      us: 1017,
      disp: 0.6,
    },
    {
      route: "Cycle utilisateur — SQLite",
      ajout: "session ORM + lecture",
      rps: 719,
      us: 1391,
      disp: 1.3,
    },
  ],
  postesOrm: [
    { poste: "Pipeline nu", us: 86 },
    { poste: "Cycle de session hors ORM", us: 17 },
    { poste: "Reprise de session — part ORM", us: 322 },
    { poste: "find() 20 lignes via le dépôt", us: 850 },
    { poste: "Sérialisation JSON des 20 lignes", us: 43 },
    { poste: "INSERT via le dépôt", us: 666 },
  ],
  couchesOrm: [
    { couche: "drizzle — construction de la requête", pct: 39.0 },
    { couche: "pilote drizzle → SQLite (préparation + exécution)", pct: 27.0 },
    { couche: "Node interne", pct: 5.5 },
    { couche: "V8 (anonyme / natif)", pct: 5.1 },
    { couche: "@nodefony/framework", pct: 4.8 },
    { couche: "repos", pct: 4.6 },
    { couche: "@nodefony/http", pct: 3.6 },
    { couche: "V8 (programme / natif)", pct: 3.1 },
    { couche: "cœur nodefony", pct: 2.9 },
    { couche: "divers", pct: 1.5 },
    { couche: "ramasse-miettes V8", pct: 1.1 },
    { couche: "@nodefony/orm-core", pct: 0.9 },
    { couche: "@nodefony/security + module test + adaptateur", pct: 0.8 },
  ],
  lotPrepared: [
    {
      route: "Lecture allégée",
      sqliteAvant: 1083,
      sqliteApres: 2019,
      sqliteGain: 86,
      pgAvant: 1017,
      pgApres: 1640,
      pgGain: 61,
    },
    {
      route: "Session + lecture",
      sqliteAvant: 773,
      sqliteApres: 1516,
      sqliteGain: 96,
      pgAvant: 642,
      pgApres: 1021,
      pgGain: 59,
    },
  ],
  dialectes: [
    {
      moteur: "SQLite",
      mecanisme: "Instruction native compilée une fois, réutilisée",
      gain: "compilation + JavaScript",
    },
    {
      moteur: "PostgreSQL",
      mecanisme: "Requête nommée ; plan mis en cache PAR CONNEXION du pool",
      gain: "JavaScript, surtout",
    },
    {
      moteur: "MySQL",
      mecanisme:
        "Le pilote passe par client.query() — aucune préparation protocole",
      gain: "JavaScript uniquement",
    },
  ],

  // Routeur : la courbe, pas le débit.
  routeur: [
    { routes: 136, dyn: 47, sansIndex: 1.09, avecIndex: 0.09, part: 1.3 },
    { routes: 300, dyn: 101, sansIndex: 2.62, avecIndex: 0.05, part: 3.0 },
    { routes: 600, dyn: 201, sansIndex: 8.89, avecIndex: 0.07, part: 10.3 },
    { routes: 1200, dyn: 401, sansIndex: 31.54, avecIndex: 0.07, part: 36.7 },
    { routes: 2400, dyn: 801, sansIndex: 56.77, avecIndex: 0.06, part: 66.0 },
  ],
  routeurMotifs: { avant: 26.3, apres: 2.8, pireAvant: 47, pireApres: 11 },

  // Boucle d'événements : latence ≠ blocage.
  boucle: {
    preuve: [
      {
        pilote: "SQLite (better-sqlite3)",
        requete: 133,
        retard: 134,
        verdict: "bloque la boucle",
      },
      {
        pilote: "PostgreSQL (pg_sleep 0,5 s)",
        requete: 503,
        retard: 0.22,
        verdict: "ne bloque pas",
      },
    ],
    cout: [
      { pilote: "SQLite synchrone", latence: 22, cpu: 24, plafond: 41700 },
      {
        pilote: "PostgreSQL asynchrone",
        latence: 1232,
        cpu: 194,
        plafond: 5100,
      },
    ],
  },

  // Dimensionnement.
  concurrence: [
    { route: "Lecture", c: 25, rps: 1642, p50: 13.7, p99: 27.4 },
    { route: "Lecture", c: 50, rps: 1663, p50: 27.8, p99: 49.1 },
    { route: "Lecture", c: 100, rps: 1597, p50: 59.6, p99: 163.8 },
    { route: "Lecture connectée", c: 25, rps: 1031, p50: 21.7, p99: 44.5 },
    { route: "Lecture connectée", c: 50, rps: 1054, p50: 43.2, p99: 75.9 },
  ],
  pod: { lecture: 1650, connectee: 1040 },

  // Le décor ment.
  instruments: [
    {
      instrument: "setInterval + setTimeout(0)",
      vice: "Node borne un délai de 0 à ~1 ms — on mesure le minuteur",
      degat: "« SQLite bloque 0,43 ms » pour une requête de 33 µs (facteur 13)",
    },
    {
      instrument: "monitorEventLoopDelay",
      vice: "résolution de l'ordre de la milliseconde",
      degat: "rend son propre plancher pour les DEUX pilotes",
    },
    {
      instrument: "Une colonne « bloque ? non »",
      vice: "assertion jamais mesurée, présentée comme un résultat",
      degat: "le plus dangereux : il ressemble à une réponse",
    },
    {
      instrument: "process.cpuUsage()",
      vice: "compte TOUS les fils, ramasse-miettes compris",
      degat: "110 % du temps mural sur une réponse volumineuse",
    },
  ],
  gardes: [
    {
      garde: "Régime CPU",
      empeche: "Comparer une fenêtre bridée à une fenêtre libre",
      chiffre: "×1,62 à code identique",
    },
    {
      garde: "Niveau thermique",
      empeche: "Comparer un run froid à un run chaud",
      chiffre: "peut INVERSER un verdict (−2 % vs +10 %)",
    },
    {
      garde: "Indexation système",
      empeche: "Mesurer pendant une réindexation",
      chiffre: "11–22 % de CPU par vagues",
    },
    {
      garde: "Docker arrêté",
      empeche: "Mesurer avec un conteneur inactif",
      chiffre: "64 % de CPU observés",
    },
    {
      garde: "Purge des résultats",
      empeche: "Un résultat d'un autre lot dans la comparaison",
      chiffre: "—",
    },
    {
      garde: "LC_ALL=C",
      empeche: "Une garde numérique muette (« 4,1 » vs « 4.1 »)",
      chiffre: "muette entre 3 et 4 %",
    },
    {
      garde: "Un seul serveur",
      empeche: "Un superviseur résiduel qui tient le port",
      chiffre: "—",
    },
    {
      garde: "Pas de pause longue",
      empeche: "La veille douce du processus inactif",
      chiffre: "−13 %, reproduit 3/3",
    },
  ],
  docker: [
    {
      element: "Machine virtuelle, vue de l'hôte",
      valeur: "~685 % (plafond pratique)",
    },
    { element: "Proxy com.docker.backend", valeur: "~152 %" },
    { element: "Processus Node", valeur: "~50 %" },
    { element: "Enveloppe disponible", valeur: "6 cœurs physiques" },
    {
      element: "Facteur intérieur / extérieur",
      valeur: "3,7 (16 222 tps dedans vs ~4 400 depuis l'hôte)",
    },
  ],

  ouvertures: [
    {
      sujet: "Transports HTTP et plafonds WebSocket",
      etat: "À re-mesurer",
      detail:
        "chiffres non rattachés à un état de code — retirés de ce rapport tant qu'ils ne le sont pas",
    },
    {
      sujet: "Profil de la fabrique de contexte",
      etat: "Non re-profilée",
      detail:
        "allégée depuis la dernière mesure de profil : sa part actuelle n'est pas connue",
    },
    {
      sujet: "Absolus PostgreSQL",
      etat: "Non transposables",
      detail: "pris derrière une virtualisation réseau à facteur 3,7",
    },
    {
      sujet: "Attribution fine du chemin virtualisé",
      etat: "Non établie",
      detail: "ordre de grandeur mesuré, décomposition non",
    },
    {
      sujet: "Renouvellement WebSocket",
      etat: "Non concluant",
      detail: "métrique à rampe ; non-régression établie, gain non",
    },
    {
      sujet: "Mémoire par socket sécurisée",
      etat: "Écartée",
      detail: "régression sans qualité d'ajustement (R² = 0,25)",
    },
    {
      sujet: "Mise à jour / insertion-remplacement ORM",
      etat: "Non entamé",
      detail: "hors du chemin chaud des bancs actuels",
    },
    {
      sujet: "Index sur les clés étrangères au scaffold",
      etat: "Question produit",
      detail: "le générateur doit-il les indexer par défaut ?",
    },
    {
      sujet: "MySQL — requêtes préparées",
      etat: "Non mesuré",
      detail: "gain attendu purement JavaScript (pas de préparation protocole)",
    },
  ],
};

// ── Le comparatif vient du jeu VERSIONNÉ dès qu'il y en a un ───────────────
// Les valeurs ci-dessus restent le repli hors dépôt (le générateur est publié
// avec le devkit). Les trois « niveaux d'équité » se RECALCULENT : figer 1,61 /
// 1,29 / 1,07 en dur, c'était garantir qu'ils survivent à la mesure qui les
// contredit — le défaut même que cette page reproche aux benchmarks qu'elle cite.
if (DATASET) {
  const f = DATASET.comparison.frameworks;
  const rps = (id) => f[id]?.med ?? null;
  const disp = (id) => f[id]?.dispersionPct ?? null;
  const nf = rps("nodefony");
  if (nf) {
    DATA.comparatif.n1 = [
      ["node:http nu", "bare"],
      ["Fastify", "fastify"],
      ["Express", "express"],
      ["Nodefony", "nodefony"],
    ]
      .filter(([, id]) => rps(id))
      .map(([label, id]) => ({
        label,
        rps: Math.round(rps(id)),
        disp: disp(id),
        ratio: Number((rps(id) / nf).toFixed(2)),
      }));
    DATA.comparatif.n2 = [
      ["node:http nu", "bare"],
      ["Express nu", "express"],
      ["Express équipé (même travail)", "express-fair"],
      ["Nodefony", "nodefony"],
    ]
      .filter(([, id]) => rps(id))
      .map(([label, id]) => ({ label, rps: Math.round(rps(id)) }));
    const fair = rps("express-fair");
    const nu = rps("express");
    DATA.comparatif.ecarts = [
      nu && {
        situation: "L'application ne fait rien",
        ratio: Number((nu / nf).toFixed(2)),
      },
      fair && {
        situation: "Même travail par requête",
        ratio: Number((fair / nf).toFixed(2)),
      },
      // Le troisième niveau (avec une vraie requête SQL) n'est pas dans le jeu :
      // il vient d'une autre campagne, et la table de chronologie le dit.
      DATA.comparatif.ecarts[2],
    ].filter(Boolean);
  }
}

/** Décimal à la française pour l'AFFICHAGE seul (jamais pour un `data-v` trié). */
const vir = (x, n = 2) => x.toFixed(n).replace(".", ",");

/* ────────────────────────────── RENDU ────────────────────────────── */

const pct = (v) => (v === null ? "—" : `${fmt.dec(v, 2)} %`);

/**
 * L'état de code d'un bloc de mesure — en discret, sous la figure.
 *
 * 🔴 Ce qu'il remplace, et pourquoi il ne se supprime pas. Cette page portait une
 * section entière de chronologie qui racontait le chantier fenêtre par fenêtre :
 * illisible, et elle noyait le résultat. Mais l'information qu'elle portait est
 * NÉCESSAIRE — les chapitres ne sont pas tous pris sur le même commit, et
 * présenter des chiffres hétérogènes comme un état homogène serait faux. La
 * narration part, le rattachement reste : chaque bloc dit d'où il vient.
 *
 * @param {string} quand - la date de la mesure.
 * @param {string} commit - l'état du code, ou ce qui en tient lieu.
 * @returns {string} une ligne discrète.
 */
const etatDuCode = (quand, commit) =>
  `<p class="dim" style="margin-top:.4rem"><small>Mesuré le ${esc(quand)} — état du code : <code>${esc(commit)}</code></small></p>`;

const sections = [
  /* 1 — BLUF */
  section(
    "Ce qu'il faut retenir",
    cards([
      // Le chiffre de tête se DÉRIVE du jeu versionné : écrit en dur, il survivait
      // à la mesure qui le contredit — c'est ce qui avait laissé « ≈ 93 % » en
      // vitrine pendant que la campagne suivante mesurait 91,7 %.
      (() => {
        const f = DATASET?.comparison?.frameworks;
        const nf = f?.nodefony?.med;
        const fair = f?.["express-fair"]?.med;
        if (!nf || !fair)
          return {
            k: "Écart avec Express, à travail et ORM égaux",
            v: "×1,07",
            sub: "≈ 93 % du débit d'un Express équipé",
          };
        return {
          k: "Écart avec un Express équipé du même travail",
          v: `×${vir(fair / nf)}`,
          sub: `≈ ${vir((nf / fair) * 100, 0)} % de son débit — et ×1,07 dès qu'une vraie requête SQL entre dans les deux`,
        };
      })(),
      {
        k: "Ce que tient un processus",
        v: `~${fmt.int(DATA.pod.lecture)}`,
        unit: "req/s",
        sub: `route de lecture ; ~${fmt.int(DATA.pod.connectee)} req/s si la session est chargée`,
      },
      {
        k: "Poids de la couche ORM du framework",
        v: "< 2,5 %",
        unit: "du CPU",
        sub: "le temps part dans le pilote et la base, pas dans le framework",
      },
      {
        k: "Motifs de route exécutés par requête",
        v: `${vir(DATA.routeurMotifs.apres, 1)}`,
        sub: `sur 136 routes déclarées — le scan ne suit plus la taille de la table`,
      },
      {
        k: "Part du budget d'une requête prise par le routeur",
        v: "0,6 %",
        sub: "~0,54 µs sur 86",
      },
    ]) +
      note(
        `<strong>Ce rapport ne revendique pas un record de débit.</strong> Il montre où part le temps d'une
         requête servie par Nodefony, et ce qu'il en reste pour l'application. Le fait central est que
         <em>l'écart avec un serveur nu fond à mesure que l'application fait un travail réel</em> : sur une
         route qui rend une constante, la comparaison mesure surtout ce que chaque framework fait EN PLUS ;
         dès qu'une requête SQL entre dans les deux camps, elle mesure l'application.`,
      ) +
      warn(
        `<strong>Lecture des chiffres absolus.</strong> Machine de développement, générateur de charge
         co-localisé : les valeurs absolues sont basses pour <em>tous</em> les participants. Seuls les
         <strong>rapports</strong> sont exploitables, à décor identique et dans la même fenêtre. Les mesures
         PostgreSQL portent une réserve supplémentaire : elles sont prises derrière une virtualisation
         réseau qui coûte un facteur 3,7 — <strong>aucun absolu PostgreSQL n'est transposable</strong>.`,
      ),
    { break: "avoid" },
  ),

  /* 1 — L'écart, à trois niveaux */
  section(
    "1 · L'écart avec Express, à trois niveaux d'équité",
    `<p>Comparer deux frameworks sur une route qui ne fait rien ne compare pas deux frameworks :
      cela compare <strong>ce qu'ils font</strong>. Trois niveaux, du plus flatteur pour la
      concurrence au plus honnête.</p>` +
      barChart(
        DATA.comparatif.ecarts.map((e, i) => ({
          label: e.situation,
          value: e.ratio,
          color: [COLORS.vermillion, COLORS.amber, COLORS.green][i],
          note: `×${fmt.dec(e.ratio, 2)}`,
        })),
        {
          unit: "×",
          title: "L'écart fond quand l'application grandit",
          // Dérivé : écrit en dur, ce sous-titre a fini par CONTREDIRE les barres
          // qu'il surmonte — la pire forme de chiffre faux, celle qui se lit à côté
          // de sa réfutation sans que personne ne les compare.
          desc: DATA.comparatif.ecarts
            .map((e) => `${vir(e.ratio)} ${e.situation}`)
            .join(" · "),
        },
      ) +
      tabs([
        {
          label: "Niveau 1 — pipeline nu",
          body:
            barChart(
              DATA.comparatif.n1.map((r, i) => ({
                label: r.label,
                value: r.rps,
                color: series(i),
              })),
              {
                unit: "req/s",
                title: "Débit sur une route qui rend un objet constant",
              },
            ) +
            table(
              [
                { label: "Cible" },
                { label: "Débit", align: "right" },
                { label: "Dispersion", align: "right" },
                { label: "Rapport", align: "right" },
              ],
              DATA.comparatif.n1.map((r) => [
                r.label,
                fmt.int(r.rps),
                `${fmt.dec(r.disp, 1)} %`,
                r.ratio === 1 ? "—" : `×${fmt.dec(r.ratio, 2)}`,
              ]),
              { sortable: true, id: "t-n1" },
            ) +
            warn(
              DATASET
                ? `Ces chiffres viennent du jeu <strong>versionné</strong> de la
                   ${esc(DATASET.version)} (mesuré le ${esc(DATASET.provenance?.measuredAt ?? "?")},
                   code ${esc(DATASET.provenance?.runtimeCommit ?? "?")}) — la même source que la page
                   de version, pour qu'aucune des deux ne puisse contredire l'autre.
                   Les rapports restent valides <em>entre eux</em> à la date de leur mesure.`
                : `Jeu versionné introuvable : les valeurs affichées sont celles déclarées dans le
                   générateur, d'une campagne antérieure. Elles restent valides <em>entre elles</em>,
                   mais ne décrivent pas l'état livré.`,
            ),
        },
        {
          label: "Niveau 2 — à service égal",
          body:
            barChart(
              DATA.comparatif.n2.map((r, i) => ({
                label: r.label,
                value: r.rps,
                color: series(i),
              })),
              {
                unit: "req/s",
                title:
                  "Express équipé des middlewares qui rendent le même travail",
              },
            ) +
            `<p>Le prix de ces fonctionnalités est de <strong>−19,5 % pour Express</strong> : ce n'est pas
              un coût de framework, c'est le coût du travail lui-même. <strong>L'écart honnête tombe à ×1,29.</strong></p>` +
            details(
              "La preuve d'équité — ce que la cible Nodefony ne fait pas",
              table(
                [
                  { label: "Ce qui est vérifié" },
                  { label: "Comment" },
                  { label: "Résultat", align: "right" },
                ],
                [
                  [
                    "Aucune session démarrée",
                    "Aucun en-tête Set-Cookie sur 1 000 réponses",
                    "0",
                  ],
                  [
                    "Aucune écriture en base",
                    "PRAGMA data_version depuis une connexion ouverte pendant la fenêtre",
                    "stable",
                  ],
                  [
                    "Aucune ligne ajoutée",
                    "Écarts sur les 6 tables du framework",
                    "0",
                  ],
                  [
                    "Profileur non monté en production",
                    "Son plan de données répond 404",
                    "404",
                  ],
                  [
                    "Chronométrage inactif",
                    "Vérifié au code : désactivé hors développement",
                    "inactif",
                  ],
                ],
              ) +
                note(
                  `L'instrument lui-même a été <strong>vérifié mordant</strong> : une écriture témoin par une
                   autre connexion fait bien bouger la valeur. Le « 0 » n'a été cru qu'après ce rouge.`,
                ),
            ),
        },
        {
          label: "Niveau 3 — à service ET ORM égaux",
          body:
            barChart(
              DATA.comparatif.n3.map((r) => ({
                label: r.label,
                value: r.rps,
                color: r.label.startsWith("Nodefony")
                  ? COLORS.accent
                  : COLORS.grey,
              })),
              {
                unit: "req/s",
                title:
                  "Même base PostgreSQL, même ORM, même schéma, même fenêtre",
              },
            ) +
            `<p><strong>×1,07</strong> face à un Express équipé du même service. Le prix des middlewares
              Express sur une route ORM n'est plus que de <strong>−2,4 %</strong> (1 801 nu contre 1 758
              équipé), là où il valait −19,5 % sans base : <strong>l'ORM dilue tout</strong>.</p>` +
            note(
              `<strong>Recoupement croisé.</strong> Express passe de 1 089 à 1 801 en mémoïsant sa requête
               (<strong>+65 %</strong>) ; Nodefony de 1 017 à 1 640 (<strong>+60 à 62 %</strong>). Même goulot,
               même remède, deux frameworks indépendants — et la prédiction avait été engagée avant la mesure.`,
            ),
        },
      ]) +
      etatDuCode(
        DATASET?.provenance?.measuredAt ?? "2026-08-23",
        DATASET?.provenance?.commit ?? "dfdada9e — état livré 10.0.0",
      ),
  ),

  section(
    "2 · Où part le temps d'une requête",
    schemaPipeline([
      {
        label: "Analyse HTTP entrante",
        poids: 8.0,
        nature: "structurel",
        tag: "Node — 8 %",
      },
      {
        label: "Écouteurs Node",
        poids: 9.0,
        nature: "structurel",
        tag: "Node — 9 %, 94 % des attaches",
      },
      {
        label: "Portée d'injection",
        poids: 4.4,
        nature: "structurel",
        tag: "~2 µs réels (sonde)",
      },
      {
        label: "Fabrique de contexte",
        poids: 3.4,
        nature: "propre au framework",
        tag: "allégée — non re-profilée depuis",
      },
      {
        label: "Analyse d'URL",
        poids: 0.16,
        nature: "propre au framework",
        tag: "une seule analyse par requête",
      },
      {
        label: "Résolution de route",
        poids: 0.6,
        nature: "propre au framework",
        tag: "2,8 motifs — 0,6 % du budget",
      },
      {
        label: "Pare-feu (zones, CSRF, en-têtes)",
        poids: 0.16,
        nature: "propre au framework",
        tag: "entropie amortie",
      },
      {
        label: "Pose des en-têtes sortants",
        poids: 7.3,
        nature: "propre au framework",
        tag: "10 en-têtes par réponse",
      },
      {
        label: "Écriture sur la socket",
        poids: 5.0,
        nature: "structurel",
        tag: "Node — ~5 %",
      },
    ]) +
      barChart(
        DATA.profil
          .filter((p) => typeof p.actuel === "number")
          .map((p) => ({
            label: p.poste,
            value: p.actuel,
            color: p.nature === "structurel" ? COLORS.grey : COLORS.accent,
          })),
        {
          unit: "% CPU",
          title: "Part de CPU par poste, sur une requête servie",
          desc: "Gris : ce que Node fait de toute façon. Couleur : ce que le framework ajoute.",
        },
      ) +
      table(
        [
          { label: "Poste" },
          { label: "% CPU", align: "right", strong: true },
          { label: "Nature" },
        ],
        DATA.profil.map((p) => [
          p.poste,
          typeof p.actuel === "number" ? pct(p.actuel) : "non re-profilé",
          p.nature,
        ]),
        { sortable: true, id: "t-profil" },
      ) +
      tableFilter("t-profil") +
      note(
        `<strong>Un profil désigne un poste, il ne le dimensionne pas.</strong> Trois fois sur ce chantier,
         un pourcentage de CPU occupé a surestimé un coût réel d'un <strong>facteur 25 à 30</strong> —
         557 ns mesurés là où le profil imputait 21,6 %. La conduite qui en sort : convertir tout pourcentage
         de profil en nanosecondes par un micro-banc <em>avant</em> d'ouvrir un chantier.`,
      ) +
      details(
        "Les comptes exacts par requête (sonde, 107 618 requêtes — aucune mesure de temps)",
        table(
          [
            { label: "Opération" },
            { label: "Par requête", align: "right", strong: true },
            { label: "Détail", dim: true },
          ],
          DATA.comptes.map((c) => [c.op, fmt.dec(c.n, 1), c.detail]),
          { id: "t-comptes" },
        ) +
          note(
            "Un compte ne dépend ni de la machine, ni de la charge, ni de l'instrument. C'est lui qui a rendu les corrections évidentes.",
          ),
      ),
  ),

  section(
    "3 · Le routeur — ce que coûte le scan quand la table grandit",
    lineChart(
      [
        {
          label: "Scan par requête",
          color: COLORS.green,
          points: DATA.routeur.map((r) => ({ x: r.routes, y: r.avecIndex })),
        },
      ],
      { xLabel: "routes déclarées", yLabel: "µs de scan par requête" },
    ) +
      table(
        [
          { label: "Routes", align: "right" },
          { label: "Dynamiques scannées", align: "right" },
          { label: "Scan par requête", align: "right", strong: true },
          { label: "Part d'un budget de 86 µs", align: "right" },
        ],
        DATA.routeur.map((r) => [
          fmt.int(r.routes),
          fmt.int(r.dyn),
          `${fmt.dec(r.avecIndex, 2)} µs`,
          `${fmt.dec(r.part, 1)} %`,
        ]),
        { sortable: true, id: "t-routeur" },
      ) +
      `<p>Sur la table de ce dépôt — 136 routes déclarées — <strong>${vir(DATA.routeurMotifs.apres, 1)} motifs
        sont exécutés par requête</strong> (pire cas ${DATA.routeurMotifs.pireApres}), soit ~0,54 µs sur 86 :
        <strong>0,6 % du budget</strong>.</p>` +
      note(
        `<strong>Ce qui compte ici est l'échelle, pas le débit.</strong> Le nombre de motifs exécutés ne suit
         pas le nombre de routes déclarées, mais celui des routes qui partagent le préfixe demandé — une
         application peut donc déclarer des centaines de routes sans que le scan devienne un poste.`,
      ) +
      etatDuCode("2026-08-07", "a42512e3"),
  ),

  /* 5 — ORM */
  section(
    "4 · L'accès aux données — le framework n'est pas le sujet",
    barChart(
      DATA.postesOrm.map((p, i) => ({
        label: p.poste,
        value: p.us,
        color: i === 0 ? COLORS.accent : series(i),
      })),
      {
        unit: "µs/req",
        title: "Coût par poste, obtenu par soustraction des marches",
      },
    ) +
      table(
        [
          { label: "Route" },
          { label: "Ce que la marche ajoute", dim: true },
          { label: "Débit", align: "right" },
          { label: "µs/req", align: "right", strong: true },
          { label: "Dispersion", align: "right" },
        ],
        DATA.escalier.map((e) => [
          e.route,
          e.ajout,
          fmt.int(e.rps),
          fmt.int(e.us),
          `${fmt.dec(e.disp, 1)} %`,
        ]),
        { sortable: true, id: "t-escalier" },
      ) +
      csvExport("t-escalier", "escalier-orm.csv") +
      note(
        `<strong>L'additivité a été vérifiée</strong> : 979 + 322 + ~90 de zone = 1 391 µs, ce que rend
         effectivement la marche complète. Un escalier dont les marches ne s'additionnent pas mesure autre
         chose que ce qu'il prétend.`,
      ) +
      `<h3>Le profilage innocente la couche du framework</h3>` +
      donut(
        [
          {
            label: "drizzle — construction",
            value: 39.0,
            color: COLORS.vermillion,
          },
          { label: "pilote + exécution", value: 27.0, color: COLORS.amber },
          { label: "Node + V8", value: 13.7, color: COLORS.grey },
          {
            label: "Nodefony (framework + http + cœur)",
            value: 11.3,
            color: COLORS.accent,
          },
          { label: "repos", value: 4.6, color: COLORS.skyblue },
          {
            label: "orm-core + sécurité + adaptateur",
            value: 1.7,
            color: COLORS.green,
          },
        ],
        { size: 190 },
      ) +
      table(
        [
          { label: "Couche" },
          { label: "% du CPU", align: "right", strong: true },
        ],
        DATA.couchesOrm.map((c) => [c.couche, `${fmt.dec(c.pct, 1)} %`]),
        { sortable: true, id: "t-couches" },
      ) +
      note(
        `<strong>La couche d'abstraction ORM de Nodefony pèse moins de 2,5 % du CPU.</strong> Ce n'est pas
         une bonne nouvelle qu'on s'accorde : c'est un résultat qui <em>ferme</em> une piste. Optimiser
         l'adaptateur n'aurait rien rendu. Le goulot est que l'ORM <strong>refabrique et re-prépare la
         requête à chaque requête HTTP</strong> — 39 % de construction contre 17 % d'exécution réelle.`,
      ) +
      etatDuCode(
        "2026-08-06",
        "profil pris avant la mise en cache des requêtes préparées",
      ),
  ),

  section(
    "5 · Les requêtes préparées — ce que rend chaque moteur",
    barChart(
      [
        { label: "SQLite — lecture", value: 2019, color: COLORS.green },
        {
          label: "SQLite — session + lecture",
          value: 1516,
          color: COLORS.green,
        },
        { label: "PostgreSQL — lecture", value: 1640, color: COLORS.blue },
        {
          label: "PostgreSQL — session + lecture",
          value: 1021,
          color: COLORS.blue,
        },
      ],
      { unit: "req/s", title: "Débit par moteur et par route" },
    ) +
      table(
        [
          { label: "Route" },
          { label: "SQLite", align: "right", strong: true },
          { label: "PostgreSQL", align: "right", strong: true },
        ],
        DATA.lotPrepared.map((l) => [
          l.route,
          fmt.int(l.sqliteApres),
          fmt.int(l.pgApres),
        ]),
        { id: "t-prepared" },
      ) +
      note(
        `<strong>Ce cache ne mémorise aucune donnée</strong> — il mémorise la <em>forme</em> de la requête.
         Les valeurs sont re-liées à chaque appel, la base est interrogée à chaque appel. Un test
         anti-obsolescence garde ce contrat et a été vu rouge en le débranchant.`,
      ) +
      table(
        [
          { label: "Moteur" },
          { label: "Ce qui se passe réellement" },
          { label: "D'où vient le gain", strong: true },
        ],
        DATA.dialectes.map((d) => [d.moteur, d.mecanisme, d.gain]),
        { id: "t-dialectes" },
      ) +
      warn(
        `<strong>Le gain est côté CLIENT, pas côté serveur de base.</strong> Il serait tentant de l'attribuer
         au planificateur de PostgreSQL : <code>pgbench</code> en mode simple contre le même en mode préparé
         ne rend que <strong>+3,3 %</strong>. Ce qui coûtait, c'était de refabriquer la requête à chaque appel.`,
      ) +
      etatDuCode("2026-08-07", "1f1926a7 — décor 8121bef1"),
  ),

  /* 7 — Boucle d'événements */
  section(
    "6 · Latence et blocage — une seule des deux plafonne un processus",
    `<p>Une base répond en 22 µs, l'autre en 1 232. C'est la <strong>première</strong> qui bloque le serveur.</p>` +
      schemaBoucle() +
      table(
        [
          { label: "Pilote" },
          { label: "Durée de la requête", align: "right" },
          { label: "Retard du rappel armé", align: "right", strong: true },
          { label: "Verdict" },
        ],
        DATA.boucle.preuve.map((p) => [
          p.pilote,
          `${fmt.dec(p.requete, 2)} ms`,
          `${fmt.dec(p.retard, 2)} ms`,
          p.verdict,
        ]),
        { id: "t-preuve" },
      ) +
      note(
        `<strong>La preuve tient à l'échelle de la centaine de millisecondes</strong>, donc insensible aux
         erreurs d'instrument fin. Quand plusieurs mesures fines se contredisent, il faut changer
         <em>d'ordre de grandeur</em>, pas d'instrument.`,
      ) +
      barChart(
        [
          { label: "SQLite — latence", value: 22, color: COLORS.grey },
          {
            label: "SQLite — CPU de boucle",
            value: 24,
            color: COLORS.vermillion,
          },
          { label: "PostgreSQL — latence", value: 1232, color: COLORS.grey },
          {
            label: "PostgreSQL — CPU de boucle",
            value: 194,
            color: COLORS.vermillion,
          },
        ],
        {
          unit: "µs/req",
          logScale: true,
          title: "Latence contre CPU de boucle (échelle logarithmique)",
          desc: "La latence PostgreSQL est 56× celle de SQLite ; son CPU de boucle, 8×",
        },
      ) +
      table(
        [
          { label: "Pilote" },
          { label: "Latence", align: "right" },
          { label: "CPU de boucle", align: "right", strong: true },
          { label: "Plafond théorique d'un processus", align: "right" },
        ],
        DATA.boucle.cout.map((c) => [
          c.pilote,
          `${fmt.int(c.latence)} µs`,
          `${fmt.int(c.cpu)} µs`,
          `~${fmt.int(c.plafond)} req/s`,
        ]),
        { id: "t-cout" },
      ) +
      details(
        "Les quatre instruments qui ont menti sur cette seule question",
        table(
          [
            { label: "Instrument" },
            { label: "Le vice" },
            { label: "Le dégât produit" },
          ],
          DATA.instruments.map((i) => [i.instrument, i.vice, i.degat]),
          { id: "t-instruments" },
        ) +
          warn(
            `<strong>Un banc qui n'a pas mesuré doit se taire, pas répondre « non ».</strong>`,
          ),
      ),
  ),

  /* 8 — Dimensionnement */
  section(
    "7 · Dimensionnement — ce que tient un pod",
    lineChart(
      [
        {
          label: "Lecture — débit",
          color: COLORS.accent,
          points: DATA.concurrence
            .filter((c) => c.route === "Lecture")
            .map((c) => ({ x: c.c, y: c.rps })),
        },
        {
          label: "Lecture connectée — débit",
          color: COLORS.green,
          points: DATA.concurrence
            .filter((c) => c.route === "Lecture connectée")
            .map((c) => ({ x: c.c, y: c.rps })),
        },
      ],
      { xLabel: "connexions simultanées", yLabel: "débit (req/s)" },
    ) +
      lineChart(
        [
          {
            label: "Lecture — p99",
            color: COLORS.vermillion,
            points: DATA.concurrence
              .filter((c) => c.route === "Lecture")
              .map((c) => ({ x: c.c, y: c.p99 })),
          },
          {
            label: "Lecture — p50",
            color: COLORS.amber,
            points: DATA.concurrence
              .filter((c) => c.route === "Lecture")
              .map((c) => ({ x: c.c, y: c.p50 })),
          },
        ],
        { xLabel: "connexions simultanées", yLabel: "latence (ms)" },
      ) +
      legend([
        { label: "Débit — lecture", color: COLORS.accent },
        { label: "Débit — lecture connectée", color: COLORS.green },
        { label: "Latence p99", color: COLORS.vermillion },
        { label: "Latence p50", color: COLORS.amber },
      ]) +
      table(
        [
          { label: "Route" },
          { label: "Connexions", align: "right" },
          { label: "Débit", align: "right", strong: true },
          { label: "p50", align: "right" },
          { label: "p99", align: "right" },
        ],
        DATA.concurrence.map((c) => [
          c.route,
          fmt.int(c.c),
          fmt.int(c.rps),
          `${fmt.dec(c.p50, 1)} ms`,
          `${fmt.dec(c.p99, 1)} ms`,
        ]),
        { sortable: true, id: "t-conc" },
      ) +
      warn(
        `<strong>Le débit est déjà à son plafond à 25 connexions.</strong> Doubler la concurrence ne rend
         rien de plus — cela double la latence médiane. La tripler dégrade le débit <em>et</em> multiplie le
         99ᵉ centile par six. Au-delà de la saturation, la concurrence ne produit pas du service : elle
         produit de la <strong>file d'attente</strong>.`,
      ),
    { break: "before" },
  ),

  section(
    "8 · Combien de pods ?",
    calculator({
      id: "pods",
      inputs: [
        {
          id: "trafic",
          label: "Trafic de pointe (req/s)",
          value: 3000,
          min: 1,
          step: 50,
        },
        {
          id: "debit",
          label: "Débit par pod (req/s)",
          value: DATA.pod.connectee,
          min: 1,
          step: 10,
        },
        {
          id: "occupation",
          label: "Taux d'occupation visé (%)",
          value: 50,
          min: 5,
          step: 5,
        },
        {
          id: "panne",
          label: "Tolérer la perte d'un pod",
          value: true,
          type: "checkbox",
        },
      ],
      constants: { lecture: DATA.pod.lecture, connectee: DATA.pod.connectee },
      compute: `(v, K) => {
        const util = Math.max(v.occupation, 1) / 100;
        const capacite = v.debit * util;
        let pods = Math.ceil(v.trafic / Math.max(capacite, 1));
        const base = pods;
        if (v.panne) pods += 1;
        const marge = (pods * v.debit) / Math.max(v.trafic, 1);
        const alerts = [];
        if (v.occupation > 85) alerts.push("Taux d'occupation supérieur à 85 % : la latence p99 devient sensible au moindre déséquilibre de répartition.");
        if (v.debit > K.lecture) alerts.push("Débit par pod supérieur à la constante mesurée sur la route de lecture publique (" + K.lecture + " req/s) : vérifiez que votre route est bien plus légère.");
        if (v.trafic / Math.max(v.debit,1) > 40) alerts.push("Plus de 40 pods : la base de données devient la ressource partagée à dimensionner, pas le nombre de processus Node.");
        return {
          html:
            '<div class="kpis"><div class="kpi"><b>' + pods + '</b><span>pods</span></div>' +
            '<div class="kpi"><b>' + base + '</b><span>sans marge de panne</span></div>' +
            '<div class="kpi"><b>' + (Math.round(capacite)) + '</b><span>req/s utiles par pod</span></div>' +
            '<div class="kpi"><b>×' + marge.toFixed(2) + '</b><span>capacité brute / trafic</span></div></div>' +
            '<p>Formule : <code>pods = trafic ÷ (débit par pod × taux d\\'occupation)</code>' +
            (v.panne ? ', plus un pod pour absorber la perte d\\'une instance' : '') + '.</p>',
          alerts,
        };
      }`,
    }) +
      cards([
        {
          k: "Route de lecture publique",
          v: `~${fmt.int(DATA.pod.lecture)}`,
          unit: "req/s / pod",
        },
        {
          k: "Route de lecture connectée",
          v: `~${fmt.int(DATA.pod.connectee)}`,
          unit: "req/s / pod",
        },
      ]) +
      note(
        `Trois précautions valent plus que la précision du calcul : <strong>mesurer sa propre route</strong>
         (les constantes valent pour ce corpus et cette base), <strong>compter la base comme une ressource
         partagée</strong> (multiplier les pods multiplie les connexions), et <strong>dimensionner sur le
         pic</strong>, en vérifiant que l'orchestrateur ajoute un pod plus vite que le pic ne monte.`,
      ) +
      etatDuCode(
        DATASET?.provenance?.measuredAt ?? "2026-08-23",
        DATASET?.provenance?.commit ?? "dfdada9e — état livré 10.0.0",
      ),
  ),

  /* 10 — Le décor */
  section(
    "9 · Comment lire ces chiffres — le décor ment plus souvent que le code",
    warn(
      `<strong>Aucun verdict faux de ce chantier ne venait d'une erreur de raisonnement sur le code.</strong>
       Tous venaient de l'instrument ou du décor. Pire : les fenêtres les plus <em>stables</em> ont produit
       les résultats les plus <em>faux</em> — un processeur bridé tient un plafond bas sans effort.`,
    ) +
      table(
        [
          { label: "Garde" },
          { label: "Ce qu'elle empêche" },
          { label: "L'ampleur constatée", align: "right", strong: true },
        ],
        DATA.gardes.map((g) => [g.garde, g.empeche, g.chiffre]),
        { sortable: true, id: "t-gardes" },
      ) +
      `<h3>Deux explications réfutées — dont notre propre correction</h3>
       <p>« Le round-trip réseau est incompressible » : faux, l'attente ne consomme pas la boucle.
       « C'est PostgreSQL qui sature » : faux aussi — coïncidence de deux erreurs (un plan de requête à
       froid lu comme un plan nominal, et 460 % de CPU lus comme une saturation alors que la machine
       virtuelle dispose de 8 processeurs virtuels sur 6 cœurs physiques).</p>` +
      table(
        [
          { label: "Élément mesuré pendant la charge" },
          { label: "Valeur", align: "right", strong: true },
        ],
        DATA.docker.map((d) => [d.element, d.valeur]),
        { id: "t-docker" },
      ) +
      gauge(685 / 800, {
        label: "Charge de la VM Docker (≈685 % sur ~800 % pratiques)",
        warn: 0.7,
        danger: 0.85,
      }) +
      note(
        `<strong>Le coupable est le chemin réseau virtualisé de Docker Desktop, pas la base.</strong>
         Trois réfutations indépendantes, et aucune n'est une mesure de plus : les connexions étaient
         <em>en attente du client</em> (40 sur 40), <code>pgbench</code> rendait 16 222 tps <em>dans</em> le
         conteneur contre ~4 400 depuis l'hôte, et le « plafond » variait de 4 400 à 6 500 selon le jour.`,
      ),
    { break: "before" },
  ),

  /* 11 — Ouvertures */
  section(
    "10 · Ce qui reste ouvert",
    `<p>Un dossier de performance qui ne dit pas ce qu'il n'a pas mesuré demande qu'on lui fasse confiance
      sur parole. La liste des trous est la seule partie <strong>vérifiable</strong> d'un dossier de mesure :
      elle dit où regarder pour le prendre en défaut.</p>` +
      table(
        [
          { label: "Sujet" },
          { label: "État", strong: true },
          { label: "Détail", dim: true },
        ],
        DATA.ouvertures.map((o) => [o.sujet, o.etat, o.detail]),
        { sortable: true, id: "t-ouvertures" },
      ) +
      tableFilter("t-ouvertures") +
      note(
        `<strong>Comment contester un chiffre.</strong> Tous les bancs cités sont versionnés dans
         <code>.claude/skills/nodefony-load-test/</code>, avec leur protocole et leurs gardes. La règle interne
         est explicite : quand une mesure est remise en question, <strong>c'est la mesure qu'on rejoue, pas
         l'argument qu'on renforce</strong>.`,
      ),
  ),

  /* 12 — Décor */
  section(
    "Décor et rejouabilité",
    table(
      [{ label: "Élément" }, { label: "Valeur" }],
      [
        ["Machine", DATA.decor.machine],
        ["Système", DATA.decor.systeme],
        ["Serveur", DATA.decor.serveur],
        ["Générateur de charge", DATA.decor.charge],
      ],
      { id: "t-decor" },
    ) +
      table(
        [
          { label: "Famille de bancs" },
          { label: "Node", align: "right" },
          { label: "Charge", align: "right" },
          { label: "Routes", align: "right" },
        ],
        DATA.decor.familles.map((f) => [
          f.nom,
          f.node,
          f.wrk,
          fmt.int(f.routes),
        ]),
        { id: "t-familles" },
      ) +
      `<pre><code># Nodefony, mono-processus production, cible de banc du framework
BENCH_DUR=10 BENCH_URL=http://127.0.0.1:5151/nodefony/kernel/bench \\
  bash .claude/skills/nodefony-load-test/scripts/bench-ab-mono.sh &lt;label&gt; NF_BENCH_ROUTE=1

# Points de comparaison (mêmes routes, même charge utile)
BENCH_DUR=10 bash .claude/skills/nodefony-load-test/bench-frameworks/bench.sh fastify 5163

# Ce qu'un pilote de base coûte à la boucle d'événements
node .claude/skills/nodefony-load-test/scripts/db-backend-cost.mjs --prove</code></pre>` +
      note(
        `La cible <code>/nodefony/kernel/bench</code> n'existe <strong>que</strong> sous
         <code>NF_BENCH_ROUTE=1</code> : aucune surface n'est ajoutée en production par défaut.
         Le dossier complet, en Markdown versionné, vit dans <code>docs/performance/</code>.`,
      ),
    { break: "before" },
  ),
];

const html = doc({
  style: STYLE_GRAPHES,
  title: "Nodefony — performance mesurée",
  subtitle:
    // Le bandeau se DÉRIVE : « BROUILLON » et « ce rattachement n'est pas encore
    // porté » sont restés en tête d'une page qu'on s'apprêtait à publier et à lier
    // depuis le README — un avertissement figé finit par décrire un état révolu, et
    // il décourage précisément le lecteur qu'on cherchait à convaincre.
    DATASET
      ? `Ce que le framework fait AUJOURD'HUI : où part le temps d'une requête, ce que coûte l'accès aux données, ce que tient un processus. Comparatif issu du jeu versionné de la ${DATASET.version} (mesuré le ${DATASET.provenance?.measuredAt ?? "?"}) ; chaque bloc porte l'état de code où il a été pris.`
      : "Ce que le framework fait AUJOURD'HUI : où part le temps d'une requête, ce que coûte l'accès aux données, ce que tient un processus. Chaque bloc porte l'état de code où il a été pris — le jeu versionné n'a pas été trouvé.",
  sections,
  data: DATA,
  footer:
    `${deckControls()} ${printButton()} — Généré par ` +
    `<code>node .claude/skills/nodefony-load-test/scripts/perf-dossier-report.mjs</code>. ` +
    `Données embarquées dans la page (<code>#report-data</code>) : le rapport se rejoue et se compare. ` +
    `Source versionnée : <code>docs/performance/</code>.`,
});

writeFileSync(OUT, html);
console.log(`✅ ${OUT} — ${(html.length / 1024).toFixed(0)} Ko`);
