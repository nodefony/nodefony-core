/**
 * readme-html.mjs — Nodefony, matrice de présentation (10 minutes).
 *
 * Elle se lit d'un trait, et se PRÉSENTE aussi : bouton « Mode présentation », puis ← →.
 * Page d'accueil du site publié, et support de présentation (une section ≈ 1 minute).
 * Public : ingénieur, décideur technique, contributeur.
 *
 * Principe : rien n'est affirmé ici qui ne soit CALCULÉ depuis le dépôt au moment
 * de la génération (paquets, docs, tests, symboles) ou cité avec sa source datée.
 * Les manques sont dits AVANT qu'on les demande — c'est ce qui rend le reste crédible.
 *
 *   node scripts/site/readme-html.mjs           # → tmp/reports/readme.html
 *   node scripts/site/readme-html.mjs out.html
 *   node scripts/site/readme-html.mjs out.html --channel next   # accueil de /next/, avec bandeau
 *
 * @usage node scripts/site/readme-html.mjs [fichier-de-sortie.html] [--channel published|next]
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
  esc,
} from "../../.claude/skills/nodefony-html-report/lib/report.mjs";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  mkdirSync,
  copyFileSync,
} from "node:fs";
import MarkdownIt from "markdown-it";
import { highlight, STYLE_CODE } from "./markdown-highlight.mjs";
import { sansBalises } from "./lib/html-text.mjs";
import { ADMONITION_CSS, decorateAdmonitions } from "./lib/admonitions.mjs";
import { join, resolve, dirname } from "node:path";
import { REPO_ROOT as ROOT } from "../lib/repo-root.mjs";
import { versionSwitchScript } from "./lib/site-versions.mjs";
import { seoHead, brandTitle, CODE_REPOSITORY } from "./lib/seo-head.mjs";
import { canalDeVersion } from "../release/release-core.mjs";

const ARGS = process.argv.slice(2);
const channelAt = ARGS.indexOf("--channel");
const CHANNEL = channelAt === -1 ? "published" : ARGS[channelAt + 1];
if (CHANNEL !== "published" && CHANNEL !== "next") {
  console.error(`✗ --channel ${CHANNEL} : attendu « published » ou « next ».`);
  process.exit(1);
}
// La valeur de `--channel` n'est pas une sortie — mais SEULEMENT quand l'option
// est là : sans elle, `channelAt + 1` vaut 0 et écartait le premier argument,
// donc le fichier demandé, au profit du défaut.
// Même règle pour la valeur de `--site-url` : une adresse n'est pas un fichier.
const siteUrlAt = ARGS.indexOf("--site-url");
/** Adresse publique du site, sans `/` final : base de l'adresse canonique de l'accueil. */
const SITE_URL = (
  siteUrlAt === -1 ? "https://nodefony.net" : (ARGS[siteUrlAt + 1] ?? "")
).replace(/\/+$/, "");
const OUT =
  ARGS.find(
    (a, i) =>
      !a.startsWith("--") &&
      (channelAt === -1 || i !== channelAt + 1) &&
      (siteUrlAt === -1 || i !== siteUrlAt + 1),
  ) ?? join(ROOT, "tmp", "reports", "readme.html");

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

/**
 * Recense les suites de tests : leur NOMBRE DE CAS, et leur nature.
 *
 * Compter des fichiers ne dit rien à un lecteur — et peint en rouge un module
 * dont les cas vivent dans la suite d'intégration d'un autre. Ce qui se raconte,
 * c'est le nombre de cas exécutés et la DIVERSITÉ des angles : unitaire,
 * intégration, bout-en-bout, attaque, charge, mémoire. Tout est compté ici, au
 * moment de la génération de la page.
 */
const inventaireTests = () => {
  const fichiers = fichiersSous(join(ROOT, "src"), (n) =>
    FICHIER_DE_TEST.test(n),
  );
  const CAS = CAS_DE_TEST;
  const natures = {
    attaque: { fichiers: 0, cas: 0, re: /\.attack\.|red-?team/i },
    integration: {
      fichiers: 0,
      cas: 0,
      re: /[/\\]integration[/\\]|\.integration\./i,
    },
    e2e: { fichiers: 0, cas: 0, re: /[/\\]e2e[/\\]|\.e2e\./i },
    charge: { fichiers: 0, cas: 0, re: /[/\\]load[/\\]/i },
    memoire: { fichiers: 0, cas: 0, re: /memory\.test\.ts$/i },
  };
  let cas = 0;
  for (const f of fichiers) {
    const src = readFileSync(f, "utf8");
    const n = (src.match(CAS) ?? []).length;
    cas += n;
    for (const k of Object.keys(natures))
      if (natures[k].re.test(f)) {
        natures[k].fichiers++;
        natures[k].cas += n;
      }
  }
  return { fichiers: fichiers.length, cas, natures };
};

/**
 * Les fichiers d'un arbre que `garder(nom, cheminRelatif)` retient — hors
 * dépendances, sorties de build et dossiers cachés.
 */
const fichiersSous = (dir, garder) => {
  const out = [];
  if (!existsSync(dir)) return out;
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
      else if (garder(e.name, p.slice(dir.length))) out.push(p);
    }
  };
  walk(dir);
  return out;
};

const countFiles = (dir, re) => fichiersSous(dir, (nom) => re.test(nom)).length;

/** Un fichier de suite vitest. */
const FICHIER_DE_TEST = /\.(test|spec)\.tsx?$/;

/** Une déclaration de cas — la MÊME règle pour l'inventaire et la matrice. */
const CAS_DE_TEST = /^[ \t]*(it|test)(\.\w+)?\s*\(/gm;

/**
 * Cas de test ÉCRITS sous un dossier : les déclarations `it`/`test` de ses
 * suites, où qu'elles soient rangées (`tests/`, `nodefony/tests/`, `src/tests/`).
 * Ce n'est pas ce qui s'EXÉCUTE — un cas paramétré en joue plusieurs, un cas
 * privé de son infrastructure aucun : le compte exécuté se LIT dans la campagne.
 */
const casEcrits = (dir) =>
  fichiersSous(dir, (nom) => FICHIER_DE_TEST.test(nom)).reduce(
    (n, f) => n + (readFileSync(f, "utf8").match(CAS_DE_TEST) ?? []).length,
    0,
  );

/** Un fichier de SOURCE : du TypeScript qui n'est ni une suite, ni un utilitaire de test, ni une déclaration. */
const estSource = (nom, relatif) =>
  /\.tsx?$/.test(nom) &&
  !nom.endsWith(".d.ts") &&
  !FICHIER_DE_TEST.test(nom) &&
  !/[/\\](?:tests?|__tests__)[/\\]/.test(relatif);

/**
 * Une capture servie en FICHIER, à côté de la page, en deux largeurs WebP.
 *
 * Embarquées en base64, les deux captures pesaient 879 Ko sur un document de
 * 1 Mo : tout le texte attendait des images situées 20 000 px plus bas, et
 * Lighthouse mesurait un premier affichage à 4,4 s. Copiées dans `assets/`,
 * déclarées avec leurs dimensions (aucun décalage de mise en page) et chargées
 * à l'approche (`loading="lazy"`), elles ne coûtent plus rien au premier écran.
 * `srcset` laisse le navigateur prendre 800 px sur un téléphone, 1 600 ailleurs.
 *
 * Rend une chaîne vide si une variante manque : une présentation sans capture
 * reste lisible, une présentation avec une image cassée ne l'est pas.
 */
const SHOT = { w: 1600, h: 905 };
const figureShot = (name, alt) => {
  const variants = [800, 1600].map((w) => ({
    w,
    file: `${name}-${w}.webp`,
    src: join(ROOT, "docs", "assets", `${name}-${w}.webp`),
  }));
  const missing = variants.find((v) => !existsSync(v.src));
  if (missing) {
    console.warn(
      `⚠️  capture absente, section rendue sans image : ${missing.file}`,
    );
    return "";
  }
  const dir = join(dirname(resolve(OUT)), "assets");
  mkdirSync(dir, { recursive: true });
  for (const v of variants) copyFileSync(v.src, join(dir, v.file));
  const srcset = variants.map((v) => `./assets/${v.file} ${v.w}w`).join(", ");
  return (
    `<figure class="shot"><img src="./assets/${variants[1].file}" srcset="${srcset}" ` +
    `sizes="(max-width: 1240px) 100vw, 1168px" width="${SHOT.w}" height="${SHOT.h}" ` +
    `loading="lazy" decoding="async" alt="${alt}"><figcaption>${alt}</figcaption></figure>`
  );
};

// Le paquet PUBLIÉ : sa version porte le canal (`10.0.0-beta.7` → `@beta`),
// que la racine du monodépôt (`10.0.0`) n'a pas. Lire la racine faisait
// écrire `npm create nodefony@latest` — qui installait alors l'ancienne 7.
const pkgCore = readJson(join(ROOT, "src", "nodefony", "package.json")) ?? {};

// Le canal d'une préversion — règle de `canalDeVersion`, jamais une regex recopiée.
const CANAL = canalDeVersion(pkgCore.version ?? "");
const PRERELEASE = CANAL === null || CANAL === "latest" ? undefined : CANAL;

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
    tests: casEcrits(dir),
    // `frontend/` : l'interface d'un paquet (Studio) est du code qu'il publie.
    sources: ["nodefony", "src", "frontend"].reduce(
      (n, sous) => n + fichiersSous(join(dir, sous), estSource).length,
      0,
    ),
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
const suites = inventaireTests();

/**
 * Le README du dépôt, rendu en HTML — c'est le texte de présentation du projet,
 * et la page d'accueil doit le MONTRER, pas le paraphraser. Trois traitements,
 * chacun pour une raison :
 *
 *   - l'en-tête centré (logo, titre, badges d'images distantes) est retiré : le
 *     chrome de la page porte déjà la marque, et ces badges sont des images
 *     servies par un tiers — une page publiée n'a pas à dépendre d'un service
 *     extérieur pour afficher « licence Apache 2.0 » ;
 *   - les images du dépôt sont servies depuis GitHub, faute d'être copiées dans
 *     le site ;
 *   - les liens relatifs mènent au dépôt, ou à la documentation quand la cible y
 *     est publiée.
 */
function readmeEnHtml() {
  const brut = readFileSync(join(ROOT, "README.md"), "utf8");
  // Le README est GÉNÉRÉ et s'ouvre sur un commentaire « ne pas éditer ici » :
  // ancrée en tête de fichier, l'expression de l'en-tête ne mordait plus, et la
  // page portait un second `h1`, le logo servi par GitHub et quatre badges tiers.
  const sansEntete = brut
    .replace(/^(\s*<!--[\s\S]*?-->)+\s*/, "")
    .replace(/^<div align="center">[\s\S]*?<\/div>\s*\n(-{3,}\s*\n)?/, "")
    .trim();
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
    highlight,
  });
  // Les encarts `> [!IMPORTANT]` du README se lisent ici comme sur GitHub — même
  // règle que la documentation.
  let html = decorateAdmonitions(md.render(sansEntete));
  if (/<h1[\s>]/.test(html))
    throw new Error(
      "README : l'en-tête centré (logo, titre, badges) n'a pas été retiré — la page aurait deux h1.",
    );
  const BLOB = "https://github.com/nodefony/nodefony-core/blob/main/";
  const RAW = "https://raw.githubusercontent.com/nodefony/nodefony-core/main/";
  html = html
    .replace(/src="(?!https?:|data:)([^"]+)"/g, (_, p) => `src="${RAW}${p}"`)
    .replace(/href="(?!https?:|#|mailto:)([^"]+)"/g, (_, p) =>
      p.startsWith("docs/") && !p.includes("session-retros")
        ? `href="./docs/"`
        : `href="${BLOB}${p}"`,
    );
  // Un tableau dont TOUS les en-têtes sont vides n'est pas un tableau à en-tête :
  // c'est une grille de définition, une mise en page courante en Markdown. Lui
  // laisser un `thead` vide fait annoncer deux colonnes sans nom par un lecteur
  // d'écran ; en inventer les titres serait pire, car ce serait faux.
  // Un tableau large défile dans son enveloppe ; elle doit être atteignable au
  // clavier, sinon son contenu masqué l'est aussi (axe : scrollable-region-focusable).
  html = html.replace(
    /<table>[\s\S]*?<\/table>/g,
    (t) => `<div class="scroll" tabindex="0">${t}</div>`,
  );
  html = html.replace(
    /<thead>\s*<tr>(?:\s*<th[^>]*>\s*<\/th>)+\s*<\/tr>\s*<\/thead>/g,
    "",
  );
  return html;
}

/**
 * 🔴 CETTE PAGE DISAIT PRESQUE TOUT DEUX FOIS.
 *
 * Elle injecte le README ENTIER, et écrit par ailleurs quinze sections
 * CALCULÉES depuis le dépôt. Sept sujets s'y retrouvaient donc en double, dans
 * deux voix différentes — et l'un d'eux portait le même titre des deux côtés,
 * captures comprises : « Le framework se regarde tourner », deux fois, images
 * répétées. Constaté par un lecteur, pas par un contrôle.
 *
 * On garde du README ce que la page ne calcule PAS — le démarrage, l'inventaire,
 * l'état du projet — et on retire ce qu'une section calculée dit déjà mieux,
 * puisqu'elle le dit avec les chiffres du dépôt au moment de la génération.
 *
 * 🔴 Un titre de README INCONNU de ces deux listes fait ÉCHOUER la génération.
 * C'est voulu : filtrer par liste blanche laisserait disparaître en silence une
 * section nouvellement écrite, et filtrer par liste noire la laisserait
 * réapparaître en double. Le jour où le README bouge, cette page doit choisir —
 * pas deviner.
 */
const README_DOUBLONS = new Set([
  "D'où ça vient",
  "Une action, deux transports",
  "Un seul langage, du serveur au navigateur",
  "Prêt pour les agents — ce que ça veut dire ici",
  "Le framework se regarde tourner",
  "La sécurité, fermée par défaut",
  "Où aller ensuite",
]);
const README_GARDES = new Set([
  "Nodefony en bref",
  // Aucune section calculée ne les dit : `pari` ne montre que le transport,
  // `direction` ne parle que de la suite.
  "Le temps réel, de bout en bout",
  "L'IA : ton application, ouverte aux agents",
  "Démarrage",
  // Ni le déploiement ni le travail sur le framework ne sont calculés ici.
  "L'application générée, de la machine à la production",
  "Ce qu'il y a dans la boîte",
  "Développer le framework lui-même",
  "État du projet",
]);

/** Gardées, mais REPLIÉES : c'est de la documentation, pas de la présentation. */
const README_REPLIES = new Set([
  "L'application générée, de la machine à la production",
  "Développer le framework lui-même",
]);

/** Découpe le README rendu sur ses `h2`, et ne garde que ce qui n'est pas dit ailleurs. */
function readmeSansDoublons() {
  const html = readmeEnHtml();
  const morceaux = html.split(/(?=<h2)/);
  // `typographer` remplace l'apostrophe droite par la courbe : comparer les
  // titres bruts ferait rater « D'où ça vient » et personne ne saurait pourquoi.
  const norme = (t) =>
    t
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  const titre = (bloc) => {
    const m = /<h2[^>]*>([\s\S]*?)<\/h2>/.exec(bloc);
    return m ? norme(sansBalises(m[1])) : null;
  };
  const inconnus = [];
  const gardes = morceaux.filter((bloc) => {
    const t = titre(bloc);
    if (t === null) return true; // le préambule, avant le premier h2
    if (README_DOUBLONS.has(t)) return false;
    if (README_GARDES.has(t)) return true;
    inconnus.push(t);
    return true;
  });
  if (inconnus.length)
    throw new Error(
      `README : section(s) non arbitrée(s) — ${inconnus.map((t) => `« ${t} »`).join(", ")}.\n` +
        `  Cette page écrit ses propres sections calculées : dire si chacune fait DOUBLON\n` +
        `  (README_DOUBLONS) ou doit être GARDÉE (README_GARDES) dans scripts/site/readme-html.mjs.`,
    );
  // Le README vit SOUS la section « Ce qu'est Nodefony » (un `h2`) : ses `##`
  // en étaient les frères, et la hiérarchie annoncée aux lecteurs d'écran comme
  // aux yeux mettait « Démarrage » au rang de la page entière. Un niveau de moins,
  // de h4 vers h5 d'abord pour ne jamais rétrograder deux fois le même titre.
  let kept = gardes.join("");
  for (const n of [4, 3, 2])
    kept = kept
      .replace(new RegExp(`<h${n}(\\s|>)`, "g"), `<h${n + 1}$1`)
      .replace(new RegExp(`</h${n}>`, "g"), `</h${n + 1}>`);
  // Les parties qui relèvent de la DOCUMENTATION restent dans la page, repliées
  // sous leur titre : un lecteur qui découvre le projet n'a pas à défiler 15 000 px
  // de déploiement et de poste de travail pour atteindre la suite. Un bloc fermé
  // n'est pas mis en page — c'était l'essentiel du travail du premier affichage
  // sur téléphone. Le titre reste un vrai `h3`, dans le `summary`.
  const replies = [];
  kept = kept
    .split(/(?=<h3)/)
    .map((bloc) => {
      const m = /^<h3[^>]*>([\s\S]*?)<\/h3>/.exec(bloc);
      if (!m || !README_REPLIES.has(norme(sansBalises(m[1])))) return bloc;
      replies.push(norme(sansBalises(m[1])));
      return `<details class="det fold"><summary>${m[0]}</summary><div class="det-body">${bloc.slice(m[0].length)}</div></details>`;
    })
    .join("");
  const absents = [...README_REPLIES].filter((t) => !replies.includes(t));
  if (absents.length)
    throw new Error(
      `README : section(s) à replier introuvable(s) — ${absents.map((t) => `« ${t} »`).join(", ")}.\n` +
        `  Retirer le titre de README_REPLIES, ou le rétablir dans le README.`,
    );
  return kept;
}

const readme = section("Ce qu'est Nodefony", readmeSansDoublons());
const flux = existsSync(join(ROOT, ".github", "workflows"))
  ? readdirSync(join(ROOT, ".github", "workflows")).filter((f) =>
      /\.ya?ml$/.test(f),
    ).length
  : 0;

// PAS `COLORS.green` : la palette du moteur est faite pour REMPLIR des formes
// (barres, secteurs), où un aplat de 3,4:1 se voit très bien. En TEXTE, la même
// teinte passe sous le seuil de lisibilité — mesuré à 3,42:1 sur cinq nombres de
// cette page par axe-core. Une couleur de série et une couleur de texte ne se
// choisissent pas de la même façon.
const OK = "var(--ok)";
const MID = "var(--mid)";
const KO = "var(--ko)";
const B = (t, c) => `<span style="color:${c};font-weight:650">${t}</span>`;
const mark = (v) => (v ? B("✓", OK) : B("—", KO));

/* ── 1 · Ce que c'est ─────────────────────────────────────────────────────── */

/**
 * Le dernier jeu de données publié dans un dossier de `<version>.json` —
 * `docs/performance/data`, `docs/qualite/data`. La page LIT les mesures, elle
 * n'en recopie aucune : elle change avec la mesure, ou se tait si la pièce manque.
 *
 * @returns `{ version, data }`, ou `null` si le dossier est vide
 */
const dernierJeu = (relatif) => {
  const dir = join(ROOT, relatif);
  const files = existsSync(dir)
    ? readdirSync(dir)
        .filter((n) => /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\.json$/.test(n))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    : [];
  if (!files.length) return null;
  const data = readJson(join(dir, files.at(-1)));
  return data ? { version: files.at(-1).replace(/\.json$/, ""), data } : null;
};

/**
 * Ce que la dernière campagne de test publiée a MESURÉ : le passage le plus
 * large (jamais une somme d'étages — ils se recouvrent) et la couverture par
 * module (`npm run coverage -- --publish <version>`).
 */
const campagne = (() => {
  const jeu = dernierJeu("docs/qualite/data");
  const etages = Array.isArray(jeu?.data?.etages) ? jeu.data.etages : [];
  const large = etages.reduce(
    (m, e) =>
      typeof e?.passes === "number" && e.passes > (m?.passes ?? -1) ? e : m,
    null,
  );
  const couverture = jeu?.data?.couverture ?? null;
  return {
    version: jeu?.version ?? null,
    date: jeu?.data?.campagne ?? null,
    large,
    couverture,
    parModule: new Map((couverture?.modules ?? []).map((m) => [m.module, m])),
  };
})();

/** Taux de couverture d'un module, ou ce qui manque à sa place. */
const tauxDe = (nom, cle) => {
  const m = campagne.parModule.get(nom);
  if (!m) return B("non mesuré", MID);
  if (m.statut !== "mesure" || typeof m[cle] !== "number")
    return B(m.statut === "echec" ? "échec" : "sans rapport", KO);
  return fmt.pct(m[cle] / 100);
};

/**
 * Le coût d'un petit message sur la socket binaire face à gRPC, LU dans le
 * dernier jeu de performance publié — jamais recopié : la vitrine change avec
 * la mesure, ou se tait si la pièce manque.
 */
// Une stable s'installe par la forme NUE (`npm create nodefony`) : npm revérifie
// le registre pour un nom seul ; `@latest` ne sert qu'au dépannage d'un
// create-nodefony installé en global. Une préversion nomme son canal.
const CANAL_SUFFIXE = PRERELEASE ? `@${PRERELEASE}` : "";

/**
 * Les constantes d'un exemplaire, LUES dans la mesure de capacité publiée —
 * jamais recopiées : écrites en dur, elles sont restées quatre mois sur une
 * mesure périmée. Le coût d'une unité est l'inverse de son plafond (µs de
 * boucle d'événements à 100 %). La section se tait si une pièce manque.
 */
const capacite = (() => {
  const jeu = dernierJeu("docs/performance/data");
  const c = jeu?.data?.capacity ?? null;
  const plafond = (liste, label) =>
    liste?.find((m) => m.label === label && m.valid)?.ceiling ?? null;
  const us = (parSeconde) => (parSeconde ? 1e6 / parSeconde : null);
  const ws = us(plafond(c?.ws, "ws (echo 1:1)"));
  const h1 = us(plafond(c?.http, "http/1.1 (clair)"));
  const h2 = us(plafond(c?.http, "h2 (multiplexé, 1 connexion)"));
  const livraison = c?.fanout?.valid ? us(c.fanout.ceiling) : null;
  const tas = (c?.ram ?? []).map((r) => r.heapKB).filter(Number.isFinite);
  if (!ws || !h1 || !h2 || !livraison || tas.length === 0) return null;
  return {
    ws,
    h1,
    h2,
    livraison,
    tasMin: Math.min(...tas),
    tasMax: Math.max(...tas),
    measuredAt: c.measuredAt ?? null,
    route: c.route ?? null,
    version: jeu.version,
  };
})();

const binaryRatio = (() => {
  const data = dernierJeu("docs/performance/data")?.data ?? null;
  const at16 = (camp) =>
    data?.binary?.results?.find((r) => r.camp === camp && r.bytes === 16)
      ?.usPerMsg;
  const grpc = at16("grpc");
  const socket = at16("socket");
  return grpc && socket ? grpc / socket : null;
})();

const intro = section(
  "Un événement, livré partout",
  `
<p class="lead">Le même événement arrive au navigateur par WebSocket, à un client
léger en SSE, à un système tiers par webhook, et aux autres exemplaires de l'application par un
bus. Nodefony est un framework Node.js <strong>fullstack</strong>, en TypeScript, construit pour ce
<strong>temps réel</strong> : le contrôleur qui sert vos routes HTTP sert aussi vos canaux, sous la
même sécurité.</p>

${cards([
  ...(binaryRatio
    ? [
        {
          k: "Socket binaire",
          v: `≈ ${fmt.dec(binaryRatio, 1)} fois`,
          sub: "moins coûteuse que gRPC par message de 16 octets, même serveur",
          href: "./performance/analyses/#le-binaire-temps-réel",
        },
      ]
    : []),
  {
    k: "Plusieurs pods",
    v: "un seul canal",
    sub: "présence comprise, relayée par un bus Redis",
    href: "./docs/modules/realtime/",
  },
  {
    k: "À travail égal",
    v: "même zone",
    sub: "de performance que NestJS et Express équipés",
    href: "./performance/",
  },
])}

<p>Le même serveur sert aussi des services gRPC, encore expérimentaux en 10.0. Pour essayer, comptez
deux minutes : <code>npm create nodefony${CANAL_SUFFIXE} mon-app</code> pose une application complète — comptes, sécurité, temps réel, console
d'administration — sur SQLite. Ensuite, <a href="./docs/demarrer/">Par où commencer</a> vous
guide.</p>
<p class="dim">Version ${esc(pkgCore.version ?? "—")} · Node ${esc(
    (pkgCore.engines?.node ?? "—").replace(">=", "≥ ").replace("||", "ou"),
  )} · ESM, TypeScript strict</p>`,
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

<p>Pourquoi tout réécrire ? Parce que ton code s'appuie sur le framework : si ses types sont
justes, le compilateur trouve tes erreurs avant l'exécution. Ajouter des types à du vieux
JavaScript ne les rend pas justes. Chaque choix de cette réécriture supprime donc une source
d'erreur :</p>

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

<pre tabindex="0"><code>@controller("/api/blog")
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

const couverture = section(
  "Ce que les suites éprouvent — les angles, pas seulement le nombre",
  `
<p>Un compte de tests ne dit rien de ce qu'ils regardent. Ces chiffres sont comptés dans le dépôt au
moment de la génération de cette page, fichier par fichier.</p>

${cards([
  {
    k: "Cas d'attaque",
    v: fmt.int(suites.natures.attaque.cas),
    sub: `${fmt.int(suites.natures.attaque.fichiers)} suites offensives : on essaie de casser ses propres garanties`,
  },
  {
    k: "Intégration",
    v: fmt.int(suites.natures.integration.cas),
    sub: `${fmt.int(suites.natures.integration.fichiers)} suites contre un serveur qui tourne pour de vrai`,
  },
  {
    k: "Bout en bout",
    v: fmt.int(suites.natures.e2e.cas),
    sub: `${fmt.int(suites.natures.e2e.fichiers)} suites contre de vrais PostgreSQL et MySQL, et un vrai serveur temps réel`,
  },
  {
    k: "Charge & mémoire",
    v: fmt.int(suites.natures.charge.cas + suites.natures.memoire.cas),
    sub: "seuils de fuite et de débit, tenus par un gate séparé",
  },
])}

<p>S'y ajoutent <strong>${fmt.int(flux)} flux d'intégration continue</strong> — analyse statique de
sécurité, gate mémoire, suites ORM sur plusieurs moteurs, bout-en-bout autonomes, contrôle avant
publication et installation à blanc des paquets depuis leurs archives.</p>

${note(
  `<strong>Ce que ces chiffres ne prouvent pas.</strong> Un test vert ne vaut que pour ce qu'il
exerce : une suite qui se passe de son infrastructure se SKIPPE, et un skip compte comme un vert.
C'est pourquoi le dépôt fait échouer une passe d'intégration continue dont une cible déclarée n'a
pas été exercée — une absence voulue s'énonce, elle ne s'oublie pas.`,
)}
`,
);

const matrice = section(
  "La matrice — ce qui est couvert, domaine par domaine",
  `
<p>Pour chaque domaine : le code, les cas de test, la couverture, la documentation destinée aux
humains et la fiche d'entrée du paquet. Sources, cas écrits et pages sont comptés dans le dépôt à la
génération de cette page ; ce qui s'EXÉCUTE et ce qui est COUVERT ne se compte pas, il se mesure —
ces chiffres sont lus dans la campagne de test publiée${campagne.version ? ` (<a href="./qualite/">${campagne.version}</a>)` : ""}.</p>

${cards([
  campagne.large
    ? {
        k: "Cas de test exécutés",
        v: fmt.int(campagne.large.passes),
        sub: `« ${campagne.large.nom} », campagne du ${campagne.date ?? "?"} — ${fmt.int(campagne.large.sautes ?? 0)} sautés, ${fmt.int(suites.cas)} écrits`,
      }
    : {
        k: "Cas de test écrits",
        v: fmt.int(suites.cas),
        sub: `dans ${fmt.int(suites.fichiers)} fichiers — aucune campagne publiée ne dit combien s'exécutent`,
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
    { label: "Cas écrits", align: "right" },
    { label: "Couverture", align: "right" },
    { label: "Branches", align: "right" },
    { label: "Doc", align: "right" },
    { label: "Fiche", align: "center" },
  ],
  modules.map((m) => [
    DOMAINS[m.key] ?? m.key,
    `<code>${m.name}</code>`,
    fmt.int(m.sources),
    fmt.int(m.tests),
    tauxDe(m.name, "lignes"),
    tauxDe(m.name, "branches"),
    m.docs ? fmt.int(m.docs) : "—",
    mark(m.readme),
  ]),
  { sortable: true, id: "matrice" },
)}

${note(`<em>Couverture</em> = lignes exécutées par les suites du paquet${campagne.couverture ? `, mesurées le ${campagne.couverture.date} sur ${campagne.couverture.commit}` : ""}
(${campagne.couverture?.commande ? `<code>${campagne.couverture.commande}</code>, ` : ""}v8, avec l'infrastructure de test). Un taux
dit ce qui a été EXÉCUTÉ, pas ce qui a été vérifié : les suites d'attaque le font monter sans éprouver
le chemin nominal, et les bancs de charge, multi-pods et du code généré éprouvent le produit sans y
compter. <em>Cas écrits</em> = déclarations lues dans les sources, pas exécutions. La colonne se trie :
c'est fait pour être regardé, pas pour être cru.`)}`,
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

${figureShot("studio-supervision", "Supervision du runtime — topologie, ressources, journaux en direct")}

<p>Chaque requête porte un identifiant propagé dans tout le pipeline : la console rejoue son trajet
complet — phases, requêtes de base de données, décisions du pare-feu.</p>

${figureShot("studio-request", "Suivi d'une requête de bout en bout par son identifiant")}

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

${
  capacite
    ? `${barChart(
        [
          {
            label: "1 message WebSocket (écho)",
            value: Math.round(capacite.ws),
          },
          {
            label: "1 requête HTTP/2 (multiplexée)",
            value: Math.round(capacite.h2),
          },
          { label: "1 requête HTTP/1.1", value: Math.round(capacite.h1) },
        ],
        { unit: "µs de boucle d'événements" },
      )}

${cards([
  {
    k: "Coût d'une socket",
    v: `${fmt.int(capacite.tasMin)} à ${fmt.int(capacite.tasMax)}`,
    unit: "Ko",
    sub: "de tas par connexion, selon que TLS est terminé par Node ou par le répartiteur",
  },
  {
    k: "Message WS",
    v: `≈ ${fmt.dec(capacite.h1 / capacite.ws, 1)}×`,
    sub: "moins cher qu'une requête HTTP/1.1",
  },
  {
    k: "Diffusion",
    v: `≈ ${fmt.int(capacite.h1 / capacite.livraison)}×`,
    sub: "moins chère, par abonné livré, qu'une requête HTTP/1.1",
  },
])}

<p class="dim">Mesuré${capacite.measuredAt ? ` le ${esc(capacite.measuredAt)}` : ""}, en production, sur un exemplaire saturé${capacite.route ? ` (route de banc <code>${esc(capacite.route)}</code>, dans la zone de la console d’administration)` : ""} — lu dans <a href="./performance/">la campagne ${esc(capacite.version)}</a>, avec sa machine et son protocole.</p>`
    : `<p>Les constantes d'un exemplaire sont publiées avec leur décor dans <a href="./performance/">la campagne de performance</a>.</p>`
}

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

// Le canal de préversion se CALCULE depuis la version du dépôt : écrit en dur, il
// mentirait le jour de la version stable — comme la ligne « pas de migration de
// schéma » l'a fait des mois après la livraison de `orm:migrate`.
const REPO = "https://github.com/nodefony/nodefony-core";

const manques = section(
  "Ce qui manque — dit avant qu'on le demande",
  `
${
  PRERELEASE
    ? warn(`<strong>Une préversion, pas une version stable.</strong> La ${pkgCore.version.split(".")[0]}
est publiée sur npm sous le canal <code>${PRERELEASE}</code> seulement : sans canal,
<code>npm install nodefony</code> sert encore l'ancienne génération. La
<a href="./docs/guides/compatibilite/">politique de compatibilité</a> s'applique à partir de la
version stable.`)
    : ""
}

${table(
  [{ label: "Manque" }, { label: "Portée réelle" }],
  [
    [
      "Couche d'agents IA",
      "seule la porte MCP est livrée (<code>@nodefony/ai</code> : exposer les outils de l'application à un agent) ; modèle, mémoire, recherche augmentée et boucle d'agent restent une vision — rien dans la version courante n'en dépend",
    ],
    [
      "Console d'administration sans tests de composants",
      "ses écrans sont couverts par le typage, des tests unitaires de leur logique et une sonde navigateur sur deux pages en intégration continue — aucun composant n'est éprouvé en rendu",
    ],
    [
      "Projet à un seul contributeur",
      `bénévole ; les délais sont dits, pas promis (<a href="${REPO}/blob/main/SECURITY.md">politique de sécurité</a>), et seule la dernière version majeure reçoit des correctifs (<a href="./docs/guides/compatibilite/#combien-de-temps-une-version-est-maintenue">compatibilité</a>)`,
    ],
  ],
)}

<p>Dire les manques n'est pas une précaution rhétorique : c'est ce qui rend le reste vérifiable.
Un dossier sans zone d'ombre décrit rarement un vrai logiciel.</p>`,
  { id: "ce-qui-manque" },
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

/* ── 0 · Vous êtes… ───────────────────────────────────────────────────────── */

// Cinq lecteurs arrivent avec cinq questions ; la page entière ne répond à aucun
// en particulier. Ce bloc vient donc AVANT tout le reste, et chaque carte mène
// au parcours du même profil dans `docs/demarrer.md` — qui porte le détail. Deux
// listes de liens qui divergent, c'est le défaut qu'on corrige : la carte n'en
// garde que trois ou quatre, la page de parcours fait foi pour le reste.
const PROFILS = [
  {
    titre: "Directeur technique",
    question: "Mon équipe pourra-t-elle reprendre le code seule ?",
    contexte:
      "Libre, une seule personne, bénévole : seule la dernière majeure reçoit des correctifs.",
    liens: [
      { label: "Licence Apache 2.0", href: `${REPO}/blob/main/LICENSE.txt` },
      {
        label: "Versions et support",
        href: "./docs/guides/compatibilite/#combien-de-temps-une-version-est-maintenue",
      },
      { label: "Ce que les tests éprouvent", href: "./qualite/" },
      { label: "Ce qui manque", href: "#ce-qui-manque" },
    ],
    parcours: "./docs/demarrer/#-directeur-technique",
  },
  {
    titre: "Exploitation",
    question: "Comment ça se déploie en conteneur et s'orchestre ?",
    liens: [
      {
        label: "Docker et cloud-native",
        href: "./docs/guides/docker-cloud-native/",
      },
      { label: "Kubernetes", href: "./docs/guides/kubernetes/" },
      {
        label: "Variables d'environnement",
        href: "./docs/guides/variables-environnement/",
      },
      { label: "Dimensionner un pod", href: "./performance/" },
    ],
    parcours: "./docs/demarrer/#-exploitation",
  },
  {
    titre: "Développeur front",
    question: "Comment l'interface se bâtit et se recharge à chaud ?",
    liens: [
      { label: "Le module frontend", href: "./docs/modules/frontend/" },
      { label: "Une interface React", href: "./docs/guides/frontend-react/" },
      {
        label: "Le superviseur Vite",
        href: "./docs/modules/frontend/#résilience--ce-qui-se-passe-quand-vite-tombe",
      },
      {
        label: "Livrer en production",
        href: "./docs/modules/frontend/#-les-deux-modes-de-livraison-de-linterface",
      },
    ],
    parcours: "./docs/demarrer/#-développeur-front",
  },
  {
    titre: "Développeur back",
    question: "Comment je persiste mes données, sur quelle base ?",
    liens: [
      { label: "Choisir sa base", href: "./docs/guides/persistence/" },
      { label: "Drizzle, l'ORM par défaut", href: "./docs/modules/drizzle/" },
      {
        label: "Migrations de schéma",
        href: "./docs/modules/drizzle/migrations/",
      },
      { label: "MongoDB avec Mongoose", href: "./docs/modules/mongoose/" },
    ],
    parcours: "./docs/demarrer/#-développeur-back",
  },
  {
    titre: "Architecte",
    question: "Quels choix ont été faits, et pourquoi ?",
    liens: [
      { label: "Vue d'ensemble", href: "./docs/architecture/vue-ensemble/" },
      {
        label: "Pipeline de requête",
        href: "./docs/architecture/pipeline-requete/",
      },
      {
        label: "Injection et portées",
        href: "./docs/architecture/injection-portees/",
      },
      { label: "Décisions d'architecture", href: `${REPO}/tree/main/docs/adr` },
    ],
    parcours: "./docs/demarrer/#-architecte",
  },
];

// Chaque carte est un <details> : sur téléphone, les cinq tiennent fermées dans
// le premier écran — titre et question suffisent à se reconnaître ; sur un écran
// large, le script qui suit les ouvre toutes. Sans script, elles restent fermées
// et lisibles : rien n'est perdu, il faut un toucher de plus.
const profils = section(
  "Vous êtes…",
  `
<div class="profils">
${PROFILS.map(
  (p) => `<details class="profil">
  <summary><span class="profil-t">${p.titre}</span><span class="profil-q">${p.question.replace(/ \?$/, "\u202f?")}</span></summary>
  <div class="profil-b">
    ${p.contexte ? `<p class="profil-c">${p.contexte}</p>` : ""}
    <ul>${p.liens.map((l) => `<li><a href="${l.href}">${l.label}</a></li>`).join("")}</ul>
    <a class="profil-p" href="${p.parcours}">Le parcours complet →</a>
  </div>
</details>`,
).join("\n")}
</div>
<p class="profils-plus">Ou directement : <a href="./docs/">la documentation</a> ·
<a href="./performance/">les mesures</a> · <a href="${REPO}">le dépôt</a>, sous licence Apache 2.0.</p>
<script>
if (matchMedia("(min-width:761px)").matches)
  for (const d of document.querySelectorAll("details.profil")) d.open = true;
</script>`,
  { id: "vous-etes" },
);

/* ── Assemblage ───────────────────────────────────────────────────────────── */

const HOME_TITLE = "Nodefony — le framework Node.js fullstack";
// Ce qu'un moteur affiche de l'accueil : 160 caractères au plus, sinon il coupe lui-même.
const HOME_DESCRIPTION =
  "Nodefony, framework Node.js fullstack en TypeScript : HTTP et WebSocket partagent le même contexte de contrôleur, avec injection de dépendances et sécurité.";
// L'archive `/next/` a sa propre adresse (et reste `noindex`).
const HOME_URL = `${SITE_URL}/${CHANNEL === "next" ? "next/" : ""}`;
const html = doc({
  title: HOME_TITLE,
  documentTitle: brandTitle(HOME_TITLE),
  // L'icône est écrite à la racine du site par le générateur de documentation,
  // qui tourne juste après : à la fin du flux, le fichier est là. La description
  // est ce qu'un moteur de recherche affichera de la page d'accueil du projet —
  // sans elle, il en invente une, et sans l'icône chaque visiteur récolte un 404.
  head:
    seoHead({
      title: HOME_TITLE,
      description: HOME_DESCRIPTION,
      url: HOME_URL,
      type: "website",
      jsonLd: [
        { "@type": "WebSite", name: "Nodefony", url: `${SITE_URL}/` },
        {
          "@type": "SoftwareSourceCode",
          name: "Nodefony",
          description: HOME_DESCRIPTION,
          codeRepository: CODE_REPOSITORY,
          programmingLanguage: "TypeScript",
          runtimePlatform: "Node.js",
          license: "https://www.apache.org/licenses/LICENSE-2.0",
          ...(pkgCore.version ? { version: pkgCore.version } : {}),
        },
      ],
    }) +
    `\n<link rel="icon" href="./favicon.svg" type="image/svg+xml">\n` +
    (CHANNEL === "next" ? `<meta name="robots" content="noindex">\n` : "") +
    versionSwitchScript("./"),
  // 🔴 NI une colonne étroite, NI toute la largeur — les deux sont faux ici.
  //
  // Cette page a d'abord été publiée en pleine largeur, au motif qu'une porte
  // d'entrée n'est pas un document qu'on lit d'un trait. Mesuré au navigateur :
  // le `h1` faisait 1372 px sur une fenêtre de 1440, soit des lignes de ~170
  // caractères — deux fois et demie ce que l'œil suit sans se perdre (45 à 75,
  // la mesure typographique classique). Et la page fait 16 500 px de haut :
  // c'est de la PROSE longue, quoi qu'on veuille en faire.
  //
  // La réponse n'est pas de tout rétrécir : les cartes, les tableaux et les
  // figures, eux, gagnent à respirer. D'où deux largeurs — une PAGE bornée et
  // centrée, et dedans une COLONNE DE LECTURE plus étroite dont seul le texte
  // courant hérite. Tout ce qui n'est pas de la prose s'en échappe de lui-même.
  style: `
/* ══ PROPRE À L'ACCUEIL — tout le reste vient du socle de doc() ══════════════
   Une page bornée et centrée ; dedans, la prose tient la mesure du socle et
   seuls les cartes, les images et les grands tableaux prennent la largeur. */
:root { --gap:clamp(18px, 4vw, 36px); --ok:#0a7a52; --mid:#8a6200; --ko:#c0322a; }
:root[data-theme="dark"] { --ok:#4fc07d; --mid:#e0ab3a; --ko:#ff8a80; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { --ok:#4fc07d; --mid:#e0ab3a; --ko:#ff8a80; }
}
.wrap { max-width:calc(68rem + 2 * var(--gap)); margin-inline:auto; padding:0 var(--gap) 96px; }

/* ── L'entrée : un titre d'affiche, la promesse, puis l'action ────────────── */
.rep-head { margin-bottom:0; }
/* L'accroche de la marque redit le h1 situé 40 px plus bas. */
.rep-head .brand-tag { display:none; }
main > h1 { font-size:clamp(2rem, 1.15rem + 3.4vw, 3.25rem); line-height:1.08; letter-spacing:-.032em;
  max-width:17ch; margin:clamp(28px, 6vw, 64px) 0 .9rem; }
main > p.sub { font-size:clamp(1.0625rem, .98rem + .5vw, 1.3rem); max-width:50ch; margin-bottom:1.5rem; }
.hero-cta { display:flex; flex-wrap:wrap; align-items:center; gap:.75rem 1.25rem; margin:0 0 .5rem; }
code.hero-cmd { font-size:.9375rem; padding:.6rem .9rem; border-radius:8px; white-space:nowrap;
  max-width:100%; overflow-x:auto; }
.hero-cmd::before { content:"$ "; color:var(--dim); }
.hero-link { font-weight:650; display:inline-block; padding:.35rem 0; }
/* Présentation / impression : des outils, rangés en fin de page. */
.page-actions { margin:3rem 0 0 !important; }

/* ── Les sections se séparent d'un filet et d'un vrai blanc ───────────────── */
main > section.sec { margin:0; padding-top:clamp(2.5rem, 6vw, 4rem); }
/* Une section hors de l’écran n’est ni mise en page ni peinte avant d’en approcher :
   sur 30 000 px de page, c’était l’essentiel du travail du premier affichage. La
   taille réservée évite que la barre de défilement ne saute. */
main > section.sec:nth-of-type(n+3) { content-visibility:auto; contain-intrinsic-size:auto 1200px; }
main > section.sec + section.sec { margin-top:clamp(2.5rem, 6vw, 4rem); border-top:1px solid var(--line); }
/* Le README centre des blocs pour GitHub : ici tout part du même bord gauche. */
main div[align="center"] { text-align:left; }

/* ── « Vous êtes… » — cinq cartes 16:9, 3 + 2 centrées ────────────────────
   À cinq de front une carte fait 200 px de large : haute et étroite, quoi
   qu'on y mette. Trois colonnes, les mêmes que les cartes de chiffres : les
   deux grilles tombent sur les mêmes verticales. Même plancher 16:9 que le
   socle (cqi), même hauteur par rangée, « Le parcours complet » calé en bas. */
/* Cartes de VERRE : la translucidité n'existe que s'il y a quelque chose
   derrière — un halo diffus aux deux teintes du logo, posé SOUS la grille
   (isolation : il ne passe jamais devant le texte). Chaque carte garde son fond
   propre, assez opaque pour que le contraste ne dépende pas du halo ; un filet de
   lumière en haut, une ombre qui monte au survol. Repli : sans color-mix ni
   backdrop-filter, la carte reprend le fond plein d'avant. */
:root { --glass:color-mix(in oklab, var(--bg) 72%, transparent);
  --glass-hi:rgb(255 255 255 / .75); --glass-shadow:rgb(16 24 40 / .10); --halo-2:#0f9f8f; }
:root[data-theme="dark"] { --glass:color-mix(in oklab, var(--bg) 58%, transparent);
  --glass-hi:rgb(255 255 255 / .07); --glass-shadow:rgb(0 0 0 / .45); --halo-2:#2dd4bf; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { --glass:color-mix(in oklab, var(--bg) 58%, transparent);
    --glass-hi:rgb(255 255 255 / .07); --glass-shadow:rgb(0 0 0 / .45); --halo-2:#2dd4bf; }
}
.profils { --cols:3; container-type:inline-size; display:grid; gap:16px; margin:1.25rem 0;
  grid-template-columns:repeat(6, minmax(0, 1fr)); grid-auto-rows:1fr;
  position:relative; isolation:isolate; }
.profils::before { content:""; position:absolute; inset:-6% -3%; z-index:-1; pointer-events:none;
  background:
    radial-gradient(38% 60% at 18% 28%, color-mix(in oklab, var(--accent) 26%, transparent), transparent 72%),
    radial-gradient(34% 55% at 82% 72%, color-mix(in oklab, var(--halo-2) 22%, transparent), transparent 72%);
  filter:blur(28px); }
.profil { grid-column:span 2; min-width:0; display:flex; flex-direction:column; position:relative;
  background:var(--card); background:var(--glass);
  -webkit-backdrop-filter:blur(16px) saturate(1.6); backdrop-filter:blur(16px) saturate(1.6);
  border:1px solid color-mix(in oklab, var(--line) 80%, transparent); border-radius:14px; padding:18px 20px;
  box-shadow:inset 0 1px 0 var(--glass-hi), 0 1px 2px var(--glass-shadow), 0 10px 28px -18px var(--glass-shadow);
  transition:transform .22s cubic-bezier(.2,.7,.2,1), box-shadow .22s ease, border-color .22s ease;
  min-height:calc((100cqi - (var(--cols) - 1) * 16px) / var(--cols) * 9 / 16); }
/* Le filet d'accent du haut ne s'allume qu'au survol : au repos, cinq cartes
   identiques et calmes ; la carte visée se détache sans changer de couleur. */
.profil::before { content:""; position:absolute; inset:-1px -1px auto; height:2px; border-radius:14px 14px 0 0;
  background:linear-gradient(90deg, transparent, var(--accent), var(--halo-2), transparent);
  opacity:0; transition:opacity .22s ease; pointer-events:none; }
@media (hover:hover) {
  .profil:hover { transform:translateY(-3px);
    border-color:color-mix(in oklab, var(--accent) 40%, var(--line));
    box-shadow:inset 0 1px 0 var(--glass-hi), 0 2px 4px var(--glass-shadow), 0 22px 40px -20px var(--glass-shadow); }
  .profil:hover::before { opacity:1; }
}
@media (prefers-reduced-motion: reduce) {
  .profil, .profil::before { transition:none; }
  .profil:hover { transform:none; }
}
.profil::details-content { flex:1; display:flex; flex-direction:column; }
.profil-b { flex:1; display:flex; flex-direction:column; }
.profil summary { list-style:none; display:flex; flex-direction:column; gap:2px; }
.profil summary::-webkit-details-marker { display:none; }
.profil-t { font-size:1.0625rem; font-weight:680; letter-spacing:-.01em; }
.profil-q { color:var(--dim); font-size:.875rem; line-height:1.4; }
.profil p.profil-c { color:var(--dim); font-size:.8125rem; line-height:1.4; margin:.5rem 0 0; max-width:none; }
/* Les liens sur deux colonnes : c'est ce qui rend le 16:9 tenable. */
.profil ul { list-style:none; margin:.7rem 0 .6rem; padding:0; max-width:none; font-size:.875rem; line-height:1.35;
  display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:0 14px; }
.profil li { margin:0; max-width:none; }
/* Cible de 24 px au moins (WCAG 2.5.8). */
.profil li a { display:block; padding:4px 0; text-decoration:none; }
.profil li a:hover, .profil-p:hover { text-decoration:underline; }
.profil-p { margin-top:auto; padding-top:.5rem; border-top:1px solid var(--line);
  font-size:.875rem; font-weight:650; text-decoration:none; display:block; min-height:24px; }
main p.profils-plus { color:var(--dim); font-size:.9375rem; margin:0; max-width:none; }
@media (min-width:761px) { .profil summary { pointer-events:none; } }
@media (min-width:1041px) { .profil:nth-child(4):nth-last-child(2) { grid-column:2 / span 2; } }
@media (max-width:1040px) and (min-width:761px) {
  /* 768 : deux de front, la cinquième centrée. */
  .profils { --cols:2; grid-template-columns:repeat(4, minmax(0, 1fr)); }
  .profil:nth-child(5):last-child { grid-column:2 / span 2; }
}
@media (max-width:760px) {
  .page-actions { display:none !important; }
  /* Le critère tient : les cinq profils se voient sans défiler (375 × 812). */
  main > h1 { font-size:1.75rem; max-width:none; margin:18px 0 .5rem; }
  main > p.sub { font-size:1rem; margin-bottom:.6rem; }
  code.hero-cmd { display:none; }
  .hero-cta { margin:0; }
  main > section#vous-etes { padding-top:1.1rem; }
  main > section#vous-etes > h2 { font-size:1.25rem; margin-bottom:.5rem; }
  /* Une liste de lignes fermées ; le toucher déplie. */
  .profils { grid-template-columns:1fr; grid-auto-rows:auto; gap:8px; }
  .profil { grid-column:auto; min-height:0; padding:9px 14px; }
  .profil summary { cursor:pointer; position:relative; padding-right:1.6rem; min-height:24px; }
  .profil summary::after { content:"▸"; position:absolute; right:0; top:.1rem; color:var(--dim); }
  .profil[open] summary::after { content:"▾"; }
  .profil-q { font-size:.8125rem; line-height:1.3; }
  .profil ul { grid-template-columns:1fr; }
  .profil-p { margin-top:.2rem; }
  /* Le code va d'un bord à l'autre de l'écran : 36 px de colonnes gagnées. */
  main pre, main pre.shiki { margin-inline:calc(-1 * var(--gap)); padding-inline:var(--gap);
    width:auto; min-width:0; max-width:none; border-inline:0; border-radius:0; }
  main blockquote pre { margin-inline:0; }
}
/* Les parties de documentation du README, repliées sous leur titre. */
main details.fold { max-width:none; margin:2.5rem 0 1rem; padding:0; }
.fold > summary { list-style:none; cursor:pointer; display:flex; align-items:center;
  justify-content:space-between; gap:1rem; padding:14px 18px; min-height:24px; }
.fold > summary::-webkit-details-marker { display:none; }
.fold > summary h3 { margin:0; }
.fold > summary::after { content:"Afficher"; color:var(--accent); font-size:.875rem; font-weight:650; white-space:nowrap; }
.fold[open] > summary::after { content:"Masquer"; }
.fold > .det-body { margin:0; padding:0 18px 6px; }
@media print { .fold::details-content { content-visibility:visible; display:block; } .fold > summary::after { content:none; } }
.shot { margin:1.5rem 0; }
.shot img { display:block; width:100%; height:auto; border-radius:10px; border:1px solid var(--line); }
.shot figcaption { margin-top:.5rem; color:var(--dim); font-size:.875rem; }
${STYLE_CODE}
${ADMONITION_CSS}
@media print { pre { width:auto; white-space:pre-wrap; word-break:break-word; } }`,
  subtitle:
    "Publiez un événement une fois : Nodefony le livre au navigateur, au client léger, au système tiers et aux autres pods.",
  sections: [
    // `/next/` décrit la branche de développement : le dire AVANT tout le reste,
    // le lecteur venu d'un moteur de recherche croirait lire la version installable.
    CHANNEL === "next"
      ? warn(
          `<strong>En développement — pas encore publié.</strong> Cet accueil décrit la branche ` +
            `<code>dev</code>. <a href="../">Lire le site de la version publiée</a>.`,
        )
      : "",
    // L'ACTION d'entrée vient sous la promesse : installer, ou se laisser guider.
    // Les outils de lecture (présentation, impression) sont rangés en fin de page.
    `<div class="hero-cta"><code class="hero-cmd">npm create nodefony${CANAL_SUFFIXE} mon-app</code><a class="hero-link" href="./docs/demarrer/">Par où commencer →</a></div>`,
    // Cette page est la PORTE D'ENTRÉE du site publié : le lecteur doit y trouver
    // SA question avant la nôtre. Les cibles sont relatives — une archive vit dans un
    // sous-chemin (`next/`, `<version>/`) — et restent justes quand la page est aussi
    // ouverte depuis le disque, la doc étant alors simplement absente à côté.
    profils,
    // Le reste du README (démarrage, inventaire, état) vient APRÈS l'accroche :
    // un lecteur qui arrive veut d'abord savoir de quoi il s'agit, pas comment
    // l'installer. L'ordre inverse le faisait tomber sur les restes d'un fichier
    // écrit pour GitHub avant d'avoir lu une seule phrase de cette page.
    intro,
    readme,
    cheminement,
    pari,
    isomorphisme,
    agentReady,
    couverture,
    matrice,
    securite,
    studio,
    perf,
    garanties,
    preuves,
    manques,
    direction,
    `<div class="noprint page-actions" style="display:flex;gap:.5rem;flex-wrap:wrap">${deckControls()}${printButton()}</div>`,
  ],
  footer: `Généré par <code>node scripts/site/readme-html.mjs</code> — ${new Date().toISOString().slice(0, 10)} · dépôt <code>nodefony-core</code> ${pkgCore.version ?? ""} · les mesures de dimensionnement proviennent des rapports de capacité du dépôt.`,
});

// Le dossier de sortie peut ne pas exister : cette page est la PREMIÈRE écrite
// du site publié, avant que le générateur de documentation ne crée quoi que ce
// soit. En local l'ordre était inverse, le dossier préexistait, et le défaut ne
// s'est vu qu'en intégration continue — sur l'artefact réellement produit.
mkdirSync(dirname(resolve(OUT)), { recursive: true });
writeFileSync(OUT, html);
console.log(
  `readme.html écrit : ${OUT} (${fmt.int(Math.round(html.length / 1024))} Ko)`,
);
