/**
 * readme-html.mjs — Nodefony, matrice de présentation (10 minutes).
 *
 * Support DESTINÉ À ÊTRE PRÉSENTÉ : bouton « Mode présentation », puis ← →.
 * Une slide ≈ 1 minute. Public : ingénieur, décideur technique, contributeur.
 *
 * Principe : rien n'est affirmé ici qui ne soit CALCULÉ depuis le dépôt au moment
 * de la génération (paquets, docs, tests, symboles) ou cité avec sa source datée.
 * Les manques sont dits AVANT qu'on les demande — c'est ce qui rend le reste crédible.
 *
 *   node scripts/readme-html.mjs           # → readme.html
 *   node scripts/readme-html.mjs out.html
 */
import {
  doc,
  section,
  cards,
  table,
  barChart,
  details,
  warn,
  note,
  printButton,
  deckControls,
  fmt,
  COLORS,
} from "../.claude/skills/nodefony-html-report/lib/report.mjs";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.argv[2] ?? join(ROOT, "readme.html");

/* ── Collecte : le dépôt se décrit lui-même ───────────────────────────────── */

/** Modules de la couche IA — chantier en cours, hors périmètre de ce support. */
const IA_WIP = new Set([
  "agent",
  "agent-guard",
  "llm",
  "mcp",
  "memory",
  "rag",
  "vector",
]);

const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
};

const countFiles = (dir, re) => {
  if (!existsSync(dir)) return 0;
  let n = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (
        e.name === "node_modules" ||
        e.name === "dist" ||
        e.name.startsWith(".")
      )
        continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (re.test(e.name)) n++;
    }
  };
  walk(dir);
  return n;
};

/**
 * Une capture EMBARQUÉE en data-URI — le rapport doit survivre à une clé USB et
 * à un mode avion. Rend une chaîne vide si le fichier manque : une présentation
 * sans capture reste lisible, une présentation avec une image cassée ne l'est
 * pas.
 */
const embedPng = (name, alt) => {
  const p = join(ROOT, "docs", "assets", name);
  if (!existsSync(p)) {
    console.warn(`⚠️  capture absente, slide rendue sans image : ${name}`);
    return "";
  }
  const b64 = readFileSync(p).toString("base64");
  return `<figure style="margin:1.2rem 0"><img src="data:image/png;base64,${b64}" alt="${alt}" style="width:100%;height:auto;border-radius:8px;border:1px solid rgba(128,128,128,.35)"><figcaption class="u" style="margin-top:.4rem">${alt}</figcaption></figure>`;
};

const pkgRoot = readJson(join(ROOT, "package.json")) ?? {};
const symbols = readJson(join(ROOT, ".ai", "symbols.json"));

/** Un paquet publiable = un domaine du framework. */
const collect = (dir, key) => {
  const pj = readJson(join(dir, "package.json"));
  if (!pj) return null;
  return {
    key,
    name: pj.name ?? key,
    version: pj.version ?? "—",
    readme: existsSync(join(dir, "README.md")),
    docs: countFiles(join(dir, "docs"), /\.md$/),
    tests: countFiles(join(dir, "tests"), /\.(test|spec)\.ts$/),
    sources:
      countFiles(join(dir, "nodefony"), /\.ts$/) +
      countFiles(join(dir, "src"), /\.ts$/),
  };
};

const packagesDir = join(ROOT, "src", "packages", "@nodefony");
const modules = [
  collect(join(ROOT, "src", "nodefony"), "core"),
  ...readdirSync(packagesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !IA_WIP.has(e.name))
    .map((e) => collect(join(packagesDir, e.name), e.name)),
]
  .filter(Boolean)
  .sort((a, b) => b.sources - a.sources);

const totals = modules.reduce(
  (t, m) => ({
    docs: t.docs + m.docs,
    tests: t.tests + m.tests,
    sources: t.sources + m.sources,
    readme: t.readme + (m.readme ? 1 : 0),
  }),
  { docs: 0, tests: 0, sources: 0, readme: 0 },
);

/**
 * Documentation transverse destinée aux lecteurs — `session-retros/`, `archives/`
 * et `skills/` sont des artefacts internes : les compter gonflerait le chiffre
 * d'un ordre de grandeur pour rien.
 */
const DOC_PUBLIC = [
  "adr",
  "api",
  "architecture",
  "guides",
  "performance",
  "tutoriels",
];
const guides =
  DOC_PUBLIC.reduce(
    (n, d) => n + countFiles(join(ROOT, "docs", d), /\.md$/),
    0,
  ) +
  readdirSync(join(ROOT, "docs"), { withFileTypes: true }).filter(
    (e) => e.isFile() && e.name.endsWith(".md"),
  ).length;
const adr = countFiles(join(ROOT, "docs", "adr"), /\.md$/);

const OK = COLORS.green;
const MID = COLORS.amber;
const KO = COLORS.red;
const B = (t, c) => `<span style="color:${c};font-weight:650">${t}</span>`;
const mark = (v) => (v ? B("✓", OK) : B("—", KO));

/* ── 1 · Ce que c'est ─────────────────────────────────────────────────────── */

const intro = section(
  "Nodefony, en une slide",
  `
<p class="lead">Un framework Node.js <strong>fullstack</strong>, en TypeScript strict, bâti
directement sur les modules natifs de la plateforme. Pensé pour le <strong>temps réel</strong> :
le serveur HTTP et le serveur WebSocket partagent le même contexte de contrôleur.</p>

${cards([
  {
    k: "Version",
    v: pkgRoot.version ?? "—",
    sub: "monodépôt, paquets verrouillés",
  },
  {
    k: "Node",
    v: (pkgRoot.engines?.node ?? "—").replace(">=", "≥ "),
    sub: "ESM uniquement",
  },
  {
    k: "Domaines",
    v: fmt.int(modules.length),
    sub: "cœur + paquets publiables",
  },
  {
    k: "Symboles",
    v: symbols ? fmt.int(Object.keys(symbols.symbols).length) : "—",
    sub: "graphe relationnel indexé",
  },
])}

<p>Trois propriétés le définissent, et chacune se vérifie dans le code plutôt qu'elle ne se
raconte : le <strong>temps réel de première classe</strong>, l'<strong>isomorphisme</strong>
serveur/navigateur, et une application qui <strong>sait se décrire</strong> à un outil comme à
une personne.</p>`,
  { break: "avoid" },
);

/* ── 1bis · Le cheminement ────────────────────────────────────────────────── */

const cheminement = section(
  "D'où ça vient — de 2017 à la réécriture",
  `
<p>Nodefony est publié depuis <strong>2017</strong>, en JavaScript, et a mûri jusqu'à sa version 7 :
des applications réelles tournent encore dessus. Fin 2023, plutôt qu'une migration par petits pas,
le choix a été fait d'une <strong>réécriture complète en TypeScript</strong> — en gardant les
concepts, en jetant tout le reste.</p>

<p>Pourquoi ? Parce qu'un framework ne se contente pas d'exécuter du code : il <strong>contraint</strong>
celui qu'on écrit contre lui. Une couche de types posée après coup décrit ce que le code fait ; elle
ne garantit rien. Chaque parti pris de la réécriture ferme une porte :</p>

${table(
  [{ label: "Décision" }, { label: "Ce qu'elle rend impossible" }],
  [
    [
      "TypeScript <strong>strict</strong>, zéro <code>any</code>",
      "qu'un contrat se dégrade en silence entre deux modules",
    ],
    [
      "<strong>ESM</strong> exclusivement",
      "la double résolution CommonJS/ESM et ses pièges de chargement",
    ],
    [
      "Décorateurs plutôt que convention",
      "qu'une route existe sans être déclarée là où on la lit",
    ],
    [
      "Configuration <strong>validée</strong> au démarrage",
      "qu'une clé mal orthographiée soit ignorée sans un mot",
    ],
    [
      "Un processus = une instance",
      "la supervision maison ; l'échelle revient à l'orchestrateur",
    ],
  ],
)}

${note(`La version 10 est l'aboutissement de cette réécriture. Ce n'est pas un portage : c'est le
même projet, repensé pour ce que Node.js et TypeScript sont devenus.`)}`,
);

/* ── 2 · Le pari ──────────────────────────────────────────────────────────── */

const pari = section(
  "Le pari : un transport n'est pas une architecture",
  `
<p>La plupart des piles traitent le WebSocket comme une annexe : une seconde table de routes, une
seconde pile d'authentification, une passerelle entre les deux. Nodefony refuse cette séparation.
La pseudo-méthode <code>WEBSOCKET</code> est un verbe comme <code>GET</code> :</p>

<pre><code>@controller("/api/blog")
class BlogController extends Controller {
  @route("blog-index", { path: "", method: "GET" })
  async index(@CurrentUser() user?: { identifier?: string }) {
    return this.renderJson({ hello: "blog", who: user?.identifier ?? "anonyme" });
  }

  // Même classe, même décorateur : seul le transport déclaré change.
  @route("blog-echo", { path: "/echo", requirements: { methods: ["WEBSOCKET"] } })
  async echo(message: string | Buffer | null) {
    return this.renderJson({ echo: message?.toString() ?? null });
  }
}</code></pre>

${note(`<strong>Ce que ça change.</strong> Une règle d'autorisation protège l'action quel que soit le
transport ; la session ouverte en HTTP est celle que voit la socket ; le contexte asynchrone —
identifiant de requête, utilisateur — reste stable du handshake à la fermeture. Pas de passerelle,
pas de logique dupliquée, pas de seconde surface à sécuriser.`)}`,
);

/* ── 3 · Isomorphisme ─────────────────────────────────────────────────────── */

const isomorphisme = section(
  "L'isomorphisme — et pourquoi le cœur reste en TypeScript",
  `
<p>Le client n'est pas une bibliothèque à part, publiée séparément et rattrapée à chaque version :
il vit <strong>dans le même paquet que le serveur</strong> et partage ses types. Le contrat d'un
canal, la forme d'un message, la hiérarchie des rôles s'écrivent une fois.</p>

${table(
  [{ label: "Sous-chemin" }, { label: "Ce qu'il donne au navigateur" }],
  [
    [
      "<code>nodefony/client</code>",
      "socket temps réel : canaux, appels de service, reconnexion",
    ],
    [
      "<code>nodefony/react</code>",
      "hooks (<code>useNodefony</code>, état de connexion, identité)",
    ],
    [
      "<code>nodefony/roles</code>",
      "évaluation d'autorisation avec <em>la règle exacte du serveur</em>",
    ],
    [
      "<code>nodefony/debugbar</code>",
      "barre de diagnostic branchée sur le contexte de la requête",
    ],
  ],
)}

<p>Un bouton masqué faute de rôle l'est par la même logique que celle qui refusera l'appel. Il n'y
a pas deux vérités à synchroniser.</p>

${warn(`<strong>Pourquoi ne pas réécrire le cœur dans un langage plus rapide ?</strong> Parce que
l'isomorphisme se paierait exactement là. Un portage ferait gagner des microsecondes et perdrait la
seule chose qu'un framework fullstack peut vraiment offrir : un contrat unique, vérifié par le
compilateur, du contrôleur jusqu'au composant. Ce qui coûte cher dans une application temps réel,
ce n'est pas le langage — c'est la frontière entre deux mondes qui doivent se redire la même chose,
et qui finissent toujours par diverger. Nodefony supprime la frontière au lieu d'optimiser le
passage.`)}`,
);

/* ── 3bis · Prêt pour les agents ──────────────────────────────────────────── */

const agentReady = section(
  "Prêt pour les agents — ce qui tranche pour la suite",
  `
<p>Une application est aujourd'hui écrite à deux mains : la personne, et l'agent qu'elle pilote. Un
agent lâché dans un projet bâti sur un framework qu'il connaît mal <strong>invente</strong> — et il
invente du <em>plausible</em> : un CRUD écrit à la main là où un générateur existait, un import
direct du driver de base qui contourne la façade, une socket bas niveau là où le framework offre un
canal. Ce code compile. Il passe même les tests. Il a vieilli avant d'être relu.</p>

<p>La réponse n'est pas un assistant intégré, c'est de rendre <strong>l'application capable de se
décrire</strong> :</p>

${table(
  [{ label: "Ce qui est posé" }, { label: "Ce que ça évite" }],
  [
    [
      "Un <strong><code>AGENTS.md</code> généré</strong> à la racine",
      "la convention périmée : le fichier est dérivé du projet réel, il ne peut pas mentir",
    ],
    [
      "La <strong>documentation voyage dans les paquets</strong>",
      "l'agent qui cherche sur le web une version qui n'est pas la vôtre",
    ],
    [
      "Un <strong>catalogue des briques</strong> publié",
      "le choix de module fait au jugé, sans savoir ce qu'un adaptateur ne couvre pas",
    ],
    [
      "<code>inspect</code> · <code>check</code> · <code>env</code>",
      "la déduction depuis le code : routes, services, configuration effective et sa provenance",
    ],
    [
      "Des générateurs <strong>pilotables en JSON</strong>",
      "l'imitation d'un fichier d'exemple au lieu de l'appel à l'outil qui produit le vrai code",
    ],
    [
      "Un <strong>graphe symbolique</strong> du code",
      "la fouille par recherche textuelle : qui étend quoi, qui implémente quoi, en une lecture",
    ],
  ],
)}

${note(`Le standard retenu — <code>AGENTS.md</code> — est celui que lisent la plupart des outils de
codage, avec la règle « le plus proche gagne ». Rien de propriétaire : c'est un index court qui
<strong>pointe</strong> vers la documentation installée au lieu de la recopier. Une règle recopiée
dérive ; une règle pointée reste vraie.`)}

${warn(`<strong>Et surtout : c'est MESURÉ.</strong> Une application témoin est générée, puis un agent
y reçoit des tâches réelles — ajouter un CRUD, protéger une route, écrire une commande, configurer
par l'environnement, choisir la bonne brique. Le harnais lit le transcript <em>et</em> le code
produit pour répondre à une seule question : <strong>a-t-il lu, ou deviné ?</strong> La métrique
n'est pas « le code marche » — il marche souvent, c'est tout le piège. Le banc n'est pas entièrement
vert aujourd'hui, et chaque échec désigne un endroit précis où l'application ne se rend pas assez
évidente. C'est à ça qu'il sert.`)}

<p>Aucun framework backend Node n'offre aujourd'hui d'équivalent officiel. C'est un espace vide, et
c'est délibérément là que Nodefony se place.</p>`,
);

/* ── 4 · La matrice — rien n'est laissé de côté ───────────────────────────── */

const DOMAINS = {
  core: "Noyau, injection, configuration, journalisation, CLI",
  http: "Transports HTTP · HTTPS · HTTP/2 · WebSocket, sessions",
  framework: "Routage, contrôleurs, décorateurs, vues",
  security: "Pare-feu, authentification, autorisation, audit",
  user: "Socle utilisateur, encodeurs, service de comptes",
  realtime: "Canaux, appels bidirectionnels, diffusion multi-instances",
  "orm-core": "Contrat de dépôt de données, transactions, critères",
  drizzle: "Moteur SQL — SQLite, PostgreSQL, MySQL",
  mongoose: "Moteur documentaire — MongoDB",
  redis: "Cache, sessions, diffusion entre instances",
  frontend: "Construction des frontends, rechargement à chaud",
  studio: "Console d'administration",
  documentation: "Portail de documentation",
};

const matrice = section(
  "La matrice — ce qui est couvert, domaine par domaine",
  `
<p>Calculé depuis le dépôt au moment de la génération de cette page : pour chaque domaine, le code,
les suites de tests, la documentation destinée aux humains, et la fiche d'entrée du paquet.</p>

${cards([
  {
    k: "Fichiers de test",
    v: fmt.int(totals.tests),
    sub: "suites versionnées, hors bancs de charge",
  },
  {
    k: "Pages de doc",
    v: fmt.int(totals.docs + guides),
    sub: `dont ${fmt.int(guides)} transverses et ${fmt.int(adr)} décisions d'architecture`,
  },
  {
    k: "Fiches de paquet",
    v: `${totals.readme}/${modules.length}`,
    sub: "README à jour",
  },
  {
    k: "Modules de code",
    v: fmt.int(totals.sources),
    sub: "fichiers TypeScript de source",
  },
])}

${table(
  [
    { label: "Domaine" },
    { label: "Paquet" },
    { label: "Sources", align: "right" },
    { label: "Tests", align: "right" },
    { label: "Doc", align: "right" },
    { label: "Fiche", align: "center" },
  ],
  modules.map((m) => [
    DOMAINS[m.key] ?? m.key,
    `<code>${m.name}</code>`,
    fmt.int(m.sources),
    m.tests ? B(fmt.int(m.tests), m.tests >= 5 ? OK : MID) : B("0", KO),
    m.docs ? fmt.int(m.docs) : "—",
    mark(m.readme),
  ]),
  { sortable: true, id: "matrice" },
)}

${note(`Un zéro dans la colonne <em>Tests</em> désigne un paquet dont la couverture vient d'ailleurs
(ses consommateurs, ou les suites d'intégration à la racine) — pas une zone non éprouvée. La colonne
se trie : c'est fait pour être regardé, pas pour être cru.`)}`,
);

/* ── 5 · Sécurité ─────────────────────────────────────────────────────────── */

const securite = section(
  "La sécurité s'éprouve par l'attaque, pas par la lecture",
  `
<p>Le pare-feu découpe l'application en <strong>zones</strong>, chacune avec sa chaîne
d'authentification, et il refuse plutôt que d'ouvrir : une configuration invalide capture le trafic
et répond 401.</p>

${table(
  [{ label: "Surface" }, { label: "Ce qui est en place" }],
  [
    [
      "Identités",
      "session serveur pour le web · jetons et clés d'API pour les machines · OAuth2/OIDC · WebAuthn · TOTP",
    ],
    [
      "Cryptographie",
      "Argon2id pour les mots de passe · signatures Ed25519 · secrets chiffrés au repos",
    ],
    [
      "Défenses",
      "CSRF par métadonnées de requête · en-têtes de sécurité · limitation de débit · journal d'audit persistant",
    ],
    [
      "Autorisation",
      "hiérarchie de rôles vérifiée au démarrage, refus par défaut, isomorphe côté navigateur",
    ],
  ],
)}

<h3>Équipe rouge, équipe bleue</h3>

<p>« Le login fonctionne » ne prouve rien. Les campagnes se mènent en <strong>deux passes, et
l'ordre est le cœur du dispositif</strong> :</p>

<ol>
<li><strong>Passe rouge — la menace d'abord.</strong> La matrice d'attaque est construite depuis les
standards et les faiblesses connues <em>avant d'avoir lu le code</em>. C'est un garde-fou contre son
propre biais : qui lit l'implémentation en premier ne teste que ce qu'elle prévoit, et rate
précisément ce qu'elle a oublié.</li>
<li><strong>Passe bleue — le code ensuite.</strong> On lit l'implémentation, on couvre les branches
restantes, on regarde les chemins que la passe rouge n'imaginait pas.</li>
<li><strong>Le cycle.</strong> Faille trouvée → corrigée → <strong>re-prouvée par un test qui
échouait avant elle</strong>. Un correctif sans son test de non-retour ne compte pas comme corrigé.</li>
</ol>

<p>Ce qui distingue ces attaques d'un scan générique : beaucoup visent des surfaces <strong>propres à
cette architecture</strong> — les portées de l'injection de dépendances, les messages du pipeline
WebSocket partagé, le jeton porté par le contexte asynchrone, les zones du pare-feu et leurs
contournements. Aucun outil sur étagère ne connaît ces surfaces : il faut concevoir les attaques.</p>

${warn(`<strong>À savoir avant de concevoir une application.</strong> Le refus par défaut opère
<strong>par zone du pare-feu</strong>, pas route par route : une route hors de toute zone déclarée
est publique. Déclarez vos zones.`)}

${details(
  "Deux disciplines qui vont plus loin que l'usage",
  `<ul>
<li><strong>Un test qu'on n'a jamais vu échouer ne prouve rien.</strong> Un test neuf est débranché
volontairement une fois, pour vérifier qu'il tombe. Sinon il est complaisant par construction.</li>
<li><strong>L'historique du dépôt est scanné</strong> à la recherche de secrets — pas seulement
l'état courant : passer un dépôt en public expose chaque révision.</li>
</ul>`,
)}`,
);

/* ── 6 · Studio ───────────────────────────────────────────────────────────── */

const studio = section(
  "Le framework se regarde tourner",
  `
<p>Une console d'administration est livrée avec le framework : topologie du runtime, journaux en
direct avec rejeu, suivi d'une requête de bout en bout par son identifiant, schéma de la base,
graphe des classes par module, gouvernance de la sécurité, et les générateurs de code pilotables à
la souris — la sortie diffusée comme un terminal.</p>

${embedPng("studio-supervision.png", "Supervision du runtime — topologie, ressources, journaux en direct")}

<p>Chaque requête porte un identifiant propagé dans tout le pipeline : la console rejoue son trajet
complet — phases, requêtes de base de données, décisions du pare-feu.</p>

${embedPng("studio-request.png", "Suivi d'une requête de bout en bout par son identifiant")}

${note(`<strong>Sa force est en dessous.</strong> Elle ne consomme aucune API privée : tout vient
d'un plan de données JSON protégé par les mêmes règles d'accès que le reste, <strong>auto-décrit</strong>
— un appel en renvoie le catalogue — et <strong>duplex</strong> : le même point d'accès répond en
HTTP et par la socket. Ce qu'affiche la console, un script ou un outil peut le lire tel quel. C'est
la même porte, pas une porte de service.`)}

<p>Même principe pour les générateurs de code : ils publient leur catalogue, montrent le plan et le
diff <strong>avant</strong> d'écrire quoi que ce soit, et acceptent leurs réponses par fichier. Un
refus ne laisse rien derrière lui.</p>`,
);

/* ── 7 · Performance ──────────────────────────────────────────────────────── */

const perf = section(
  "Performance : la question honnête",
  `
<p>Le framework fait à chaque requête ce qu'une pile minimale ne fait pas : contexte asynchrone
corrélé, identifiant de requête, en-têtes de sécurité, contrôle CSRF, résolution de zone de
pare-feu. Comparer sans ce travail ne compare rien. Les constantes ci-dessous servent à
<strong>dimensionner</strong>, pas à gagner un concours.</p>

${barChart(
  [
    { label: "1 message WebSocket", value: 70 },
    { label: "1 requête HTTP/2 (multiplexée)", value: 154 },
    { label: "1 requête HTTP/1.1", value: 207 },
  ],
  { unit: "µs de boucle d'événements" },
)}

${cards([
  {
    k: "Coût d'une socket",
    v: "17,5",
    unit: "Ko",
    sub: "empreinte mémoire par connexion",
  },
  { k: "Message WS", v: "3×", sub: "moins cher qu'une requête HTTP" },
  { k: "Diffusion", v: "≈100×", sub: "moins chère qu'un aller-retour" },
])}

${warn(`Ces constantes valent pour le pipeline nu, <strong>sans session ni base de données</strong>.
Une route authentifiée paie en plus son magasin de sessions, qui domine tout le reste. La règle :
un canal se dimensionne sur les <em>livraisons</em> (publications × abonnés), jamais sur les
publications. Rejouez la mesure sur vos propres routes — l'outillage de banc est dans le dépôt.`)}`,
);

/* ── 8 · Garanties ────────────────────────────────────────────────────────── */

const garanties = section(
  "Ce que le dépôt garantit à chaque commit",
  `
${table(
  [{ label: "Barrière" }, { label: "Ce qu'elle empêche" }],
  [
    [
      "Typage strict, sur tous les espaces de travail",
      "aucun avertissement du compilateur mis sous le tapis ; les exceptions de type ne vivent que dans les tests, où elles servent d'assertions",
    ],
    [
      "Seuils de mémoire et de charge versionnés",
      "une fuite ou une régression de latence passe en échec, pas en discussion",
    ],
    [
      "Suites exécutables sur infrastructure réelle",
      "un test sauté faute de base compte comme vert : le lanceur dit ce qu'il n'a <em>pas</em> exercé",
    ],
    [
      "Graphe symbolique régénéré à chaque commit",
      "un renommage silencieux, une relation cassée entre modules",
    ],
    [
      "Intégration continue multi-systèmes",
      "le « ça marche chez moi » sur une seule plateforme",
    ],
  ],
)}

${note(`La discipline la plus utile n'est pas dans cette liste : <strong>avant de dire « c'est
fait », nommer ce qui n'a pas été lancé.</strong> Une phrase suffit. C'est ce qui distingue un vert
qui prouve d'un vert qui rassure.`)}`,
);

/* ── 9 · Les preuves ──────────────────────────────────────────────────────── */

const preuves = section(
  "Les preuves existent, et elles sont rejouables",
  `
<p>Chaque affirmation de ce support s'adosse à un artefact produit par le dépôt lui-même, pas à une
déclaration d'intention. Ces rapports se régénèrent par une commande :</p>

${table(
  [{ label: "Artefact" }, { label: "Ce qu'il établit" }],
  [
    [
      "Rapport de capacité",
      "les constantes de dimensionnement d'une instance, et le nombre d'instances pour une charge donnée",
    ],
    [
      "Banc de charge HTTP et WebSocket",
      "le débit soutenable, les percentiles, le point de rupture",
    ],
    [
      "Audit du pipeline de requête",
      "où passe le temps, phase par phase, profileur éteint",
    ],
    [
      "Scan de l'historique",
      "aucun secret dans les révisions du dépôt, pas seulement dans l'état courant",
    ],
    [
      "Banc du générateur de code",
      "le code produit compile, ses tests passent, sa ressource répond réellement en HTTP",
    ],
    [
      "Registre des écarts documentation ↔ code",
      "chaque page de référence est confrontée au code qu'elle décrit",
    ],
  ],
)}

${note(`Le format n'est pas neutre : un rapport destiné à un humain est <strong>manipulable</strong>
— tableaux triables, calculateurs, graphes — parce qu'un tableau de 200 lignes en texte se fait
approuver sans être lu. Ce que vous lisez est produit par ce principe.`)}`,
);

/* ── 10 · Ce qui manque ───────────────────────────────────────────────────── */

const manques = section(
  "Ce qui manque — dit avant qu'on le demande",
  `
${warn(`<strong>Pas de système de migration de schéma.</strong> La base est dérivée au démarrage :
confortable en développement, insuffisant en production. C'est le manque le plus structurant, et il
est connu.`)}

${table(
  [{ label: "Manque" }, { label: "Portée réelle" }],
  [
    [
      "Paquets non publiés sur npm",
      "le framework s'installe depuis le dépôt ; la publication est la prochaine étape",
    ],
    [
      "Couche d'agents IA",
      "chantier ouvert, hors périmètre de cette présentation — rien n'en dépend aujourd'hui",
    ],
    [
      "Console d'administration sans tests de composants",
      "ses écrans ne sont couverts que par le typage",
    ],
    [
      "Projet à un seul contributeur",
      "bénévole ; les délais de réponse s'en ressentent, c'est écrit noir sur blanc dans la politique de sécurité",
    ],
  ],
)}

<p>Dire les manques n'est pas une précaution rhétorique : c'est ce qui rend le reste vérifiable.
Un dossier sans zone d'ombre décrit rarement un vrai logiciel.</p>`,
);

/* ── 11 · Direction ───────────────────────────────────────────────────────── */

const direction = section(
  "La direction",
  `
<p class="lead">La suite est une couche d'agents construite sur ce socle : le même pipeline, la même
sécurité, le même temps réel — et une application qui sait déjà se décrire à une machine.</p>

<p>Rien de cette couche n'est promis dans la version courante. Ce qui est acquis, en revanche, c'est
le terrain sur lequel elle se posera : un plan de données auto-décrit, un graphe symbolique du code,
un générateur pilotable par fichier, et un transport duplex qui fait du flux un cas ordinaire plutôt
qu'un montage.</p>`,
  { break: "avoid" },
);

/* ── Assemblage ───────────────────────────────────────────────────────────── */

const html = doc({
  title: "Nodefony — matrice de présentation",
  subtitle:
    "Dix minutes pour comprendre ce que le framework est, ce qu'il couvre, ce qu'il coûte et ce qui lui manque.",
  sections: [
    `<div class="noprint" style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:1rem">${deckControls()}${printButton()}</div>`,
    // Cette page est la PORTE D'ENTRÉE du site publié : sans ces deux liens, un
    // lecteur y arrive et n'a nulle part où aller. Les cibles sont relatives —
    // le site vit dans un sous-chemin (`/nodefony-core/`) — et restent justes
    // quand la page est aussi ouverte depuis le disque, la doc étant alors
    // simplement absente à côté.
    section(
      "Où aller ensuite",
      cards([
        {
          k: "Documentation",
          v: '<a href="./docs/">Lire la documentation</a>',
          sub: "86 pages : le cœur, les modules, l'architecture, les guides",
        },
        {
          k: "Performance",
          v: '<a href="./performance/">Voir les mesures</a>',
          sub: "une page par version, la méthode et ce qu'elle interdit de conclure",
        },
        {
          k: "Code",
          v: '<a href="https://github.com/nodefony/nodefony-core">Le dépôt</a>',
          sub: "sources, suivi, licence CeCILL-B",
        },
      ]),
    ),
    intro,
    cheminement,
    pari,
    isomorphisme,
    agentReady,
    matrice,
    securite,
    studio,
    perf,
    garanties,
    preuves,
    manques,
    direction,
  ],
  footer: `Généré par <code>node scripts/readme-html.mjs</code> — ${new Date().toISOString().slice(0, 10)} · dépôt <code>nodefony-core</code> ${pkgRoot.version ?? ""} · les mesures de dimensionnement proviennent des rapports de capacité du dépôt.`,
});

writeFileSync(OUT, html);
console.log(
  `readme.html écrit : ${OUT} (${fmt.int(Math.round(html.length / 1024))} Ko)`,
);
