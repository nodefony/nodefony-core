/**
 * Le plan de lecture du site au format llms.txt (https://llmstxt.org) — en
 * ANGLAIS, et COURT.
 *
 * En anglais : un agent qui cherche un framework formule sa requête en anglais,
 * et un plan en français se laisse mal trouver comme mal résumer. La
 * documentation elle-même reste en français : le plan le DIT, et cite les titres
 * et les résumés tels que les pages les publient.
 *
 * Court : le format veut un INDEX, que l'agent lit en entier avant de choisir où
 * descendre. La première version listait les 288 pages (60 Ko) : un lecteur la
 * tronque, et lit alors un tiers arbitraire du plan en croyant l'avoir lu. On
 * garde les points d'entrée, les rubriques et un hub par paquet — tout le reste
 * s'atteint depuis eux, et `sitemap.xml` liste l'intégralité. Pas de
 * `llms-full.txt` pour la même raison, en pire : 3 Mo de corpus concaténé. Le
 * bon grain est la page, dont chacune publie son markdown à côté d'elle.
 *
 * Module PUR : ni disque, ni réseau, ni environnement — les faits arrivent en
 * argument, ce qui le rend testable sans site rendu (`llms-plan.test.mjs`).
 *
 * @usage import { llmsPlan } from "./lib/llms-plan.mjs"
 */
import { canalDeVersion } from "../../release/release-core.mjs";
import { APP_TEMPLATE_HREF } from "./app-template-deps.mjs";

/**
 * Les pages d'ENTRÉE, dans l'ordre où on veut qu'elles soient lues.
 *
 * C'est la seule liste de PAGES écrite à la main, et elle est VÉRIFIÉE : une
 * entrée qui ne correspond à aucune page rendue fait échouer le plan. Sans ce
 * contrôle, renommer une page de départ la ferait disparaître en silence —
 * l'agent tomberait alors dans le catalogue, c'est-à-dire nulle part.
 */
export const ENTRY_POINTS = ["", "docs/", "docs/demarrer/"];

/**
 * Profondeur maximale d'une page de documentation dans le plan.
 *
 * `docs/guides/` vaut 2, `docs/guides/kubernetes/` et `docs/modules/http/` 3 :
 * jusque-là, ce sont des rubriques, des guides et les hubs des paquets. Au-delà
 * — une page d'un module, une page de la référence d'API —, c'est le hub qui y
 * mène.
 */
export const MAX_DOCS_DEPTH = 3;

/**
 * Les groupes du plan, dans l'ordre de lecture : une page va au PREMIER préfixe
 * qui la couvre. `Optional` est le titre que le format réserve à ce qu'un agent
 * peut sauter.
 */
const GROUPS = [
  { prefix: "docs/tutoriels/", heading: "Tutorials" },
  { prefix: "docs/guides/", heading: "Guides" },
  { prefix: "docs/architecture/", heading: "Architecture" },
  { prefix: "docs/modules/", heading: "Packages" },
  { prefix: "docs/api/", heading: "API reference" },
  { prefix: "docs/", heading: "More documentation" },
  { prefix: "performance/", heading: "Optional" },
  { prefix: "qualite/", heading: "Optional" },
];

/** Un dossier nommé d'après une version (`10.0.0/`) : une archive, pas une entrée. */
const VERSION_SEGMENT = /^\d+\.\d+\.\d+/;

/**
 * La page figure-t-elle dans le plan ?
 *
 * @param page - la page rendue.
 * @returns vrai pour une page de documentation peu profonde, ou une page de
 *   mesures non versionnée.
 */
export function isPlanned(page) {
  if (page.segment === "docs") return page.depth <= MAX_DOCS_DEPTH;
  if (page.segment === "performance" || page.segment === "qualite") {
    const second = page.urlPath.split("/")[1] ?? "";
    return page.depth === 2 && !VERSION_SEGMENT.test(second);
  }
  return false;
}

/**
 * Raccourcit une description sur une frontière de mot.
 *
 * @param text - description complète.
 * @param max - longueur maximale rendue.
 * @returns la description, éventuellement suivie d'une ellipse.
 */
export function shorten(text, max = 120) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:.]$/, "")}…`;
}

/**
 * Replie un paragraphe à 80 colonnes, sur des frontières de mot.
 *
 * @param text - le paragraphe, en une seule ligne.
 * @param width - largeur maximale d'une ligne.
 * @returns les lignes repliées.
 */
export function wrap(text, width = 80) {
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && `${line} ${word}`.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Écrit un petit nombre en toutes lettres : « five dependencies » se retient,
 * « 5 dependencies » se survole.
 *
 * @param n - le nombre.
 * @returns le mot, ou le chiffre au-delà de dix.
 */
export function numberWord(n) {
  const words = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
  ];
  return words[n] ?? String(n);
}

/**
 * L'URL qu'on donne à lire pour une page : son markdown quand elle en publie un.
 *
 * @param page - la page rendue.
 * @param base - racine d'URL du site.
 * @returns l'URL.
 */
function readUrl(page, base) {
  const html = page.canonical || `${base}/${page.urlPath}`;
  return page.markdown ? `${html}index.md` : html;
}

/**
 * Une ligne de lien du plan.
 *
 * @param page - la page rendue.
 * @param base - racine d'URL du site.
 * @returns la ligne markdown, description comprise quand la page en déclare une.
 */
export function entryLine(page, base) {
  const description = shorten(page.description);
  return `- [${page.title}](${readUrl(page, base)})${description ? `: ${description}` : ""}`;
}

/**
 * L'URL d'une page que la PROSE du plan cite nommément.
 *
 * Elle lève si la page n'est pas publiée : une phrase qui promet un lien et
 * n'en donne aucun est ce qui a fait conclure à un agent qu'aucun calendrier
 * n'existait — alors qu'il existe. Une promesse non tenue coûte plus qu'un
 * silence.
 *
 * @param pages - les pages rendues.
 * @param urlPath - le chemin de la page dans le site.
 * @param base - racine d'URL du site.
 * @returns l'URL à citer, markdown si la page en publie un.
 */
export function citedUrl(pages, urlPath, base) {
  const page = pages.find((p) => p.urlPath === urlPath);
  if (!page)
    throw new Error(`page citée par le plan mais non publiée : « ${urlPath} »`);
  return readUrl(page, base);
}

/**
 * Le paragraphe d'état, CALCULÉ depuis la version publiée — jamais écrit en dur.
 * La version précédente annonçait encore une préversion `alpha` une fois la
 * 10.0.0 publiée : une phrase d'état écrite à la main ment dès la publication
 * suivante, et rien ne la relit.
 *
 * @param version - la version du paquet `nodefony` publiée par ce site.
 * @returns la commande de création et la phrase d'état.
 * @throws Si la version n'est pas un semver valide.
 */
export function releaseStatus(version) {
  const channel = canalDeVersion(version);
  if (channel === null)
    throw new Error(`version invalide pour le plan du site : « ${version} »`);
  if (channel === "latest") {
    return {
      createCommand: "npm create nodefony my-app",
      sentence:
        `**Status.** Version ${version} is the current stable release, published ` +
        "on npm under the `latest` tag.",
    };
  }
  return {
    createCommand: `npm create nodefony@${channel} my-app`,
    sentence:
      `**Status.** Version ${version} is a pre-release, published on the npm ` +
      `\`${channel}\` channel — \`npm install nodefony\` still serves the previous ` +
      "stable line.",
  };
}

/**
 * Le plan de lecture complet.
 *
 * L'en-tête porte les faits qu'un agent ne peut pas déduire du site : la langue
 * de la documentation, ce qu'une application installe, et ce que le dépôt de
 * développement n'est pas.
 *
 * @param pages - les pages rendues (`urlPath`, `segment`, `depth`, `title`,
 *   `description`, `canonical`, `markdown`).
 * @param base - racine d'URL du site publié.
 * @param facts - `deps` (dépendances d'une application minimale),
 *   `packageCount` (paquets du dépôt), `version` (version publiée).
 * @returns le contenu du fichier.
 * @throws Si une page d'entrée ou une page citée n'est pas publiée.
 */
export function llmsPlan(pages, base, { deps, packageCount, version }) {
  const status = releaseStatus(version);
  const lines = [
    "# Nodefony",
    "",
    "> Full-stack Node.js framework in strict TypeScript, ESM only, where HTTP and",
    "> WebSocket share the same route, the same session and the same firewall: one",
    "> controller answers both, with no bridge and no second server.",
    "",
    ...wrap(
      "This site documents the framework for people who build an application with " +
        "it. **The documentation is written in French**: page titles and summaries " +
        "below are quoted as published. Every link points to the page's raw " +
        "Markdown (`index.md`, served next to its HTML), and `sitemap.xml` lists " +
        "every published page.",
    ),
    "",
    ...wrap(
      `**What an application declares.** \`${status.createCommand}\` creates an ` +
        `application; in its minimal form it declares ${numberWord(deps.length)} ` +
        `dependencies: ${deps.map((d) => `\`${d}\``).join(", ")}. That is what it ` +
        "WRITES in its `package.json`; the tree npm installs counts about a hundred " +
        "packages, like any Node project — what can be checked is that none is an " +
        "in-house package duplicating the ecosystem: the servers are Node's own " +
        "(`node:http`, `node:http2`), the ORM is Drizzle, the front end is Vite, " +
        "validation is Zod. The framework's development repository is a monorepo of " +
        `${packageCount} packages that also carries its benchmarks, templates and ` +
        "agent tooling: none of it enters an application, and reading it says " +
        `nothing about the cost of adoption. See: \`${APP_TEMPLATE_HREF}\`.`,
    ),
    "",
    ...wrap(
      `${status.sentence} Open source under the Apache 2.0 license, developed by a ` +
        "single volunteer maintainer.",
    ),
    "",
    ...wrap(
      "**What remains, and what may break.** The repository milestones carry the " +
        "exact count of open tickets per version, and a due date that SLIPS — the " +
        "count is authoritative, not the date: " +
        "https://github.com/nodefony/nodefony-core/milestones. The compatibility " +
        "commitment is written down — what breaks, what gets deprecated, what " +
        `receives fixes: ${citedUrl(pages, "docs/guides/compatibilite/", base)}.`,
    ),
    "",
    ...wrap(
      "**The documentation ships with the packages.** Each package publishes its " +
        "`docs/` folder on npm: once the application is installed, everything reads " +
        "offline from `node_modules/@nodefony/<package>/docs/`, for the INSTALLED " +
        "version.",
    ),
    "",
    ...wrap(
      "**Sources are Markdown** and read raw: " +
        "`https://raw.githubusercontent.com/nodefony/nodefony-core/dev/<path>`.",
    ),
    "",
  ];

  // Les points d'entrée d'abord, et chacun doit exister.
  const entries = ENTRY_POINTS.map((urlPath) => {
    const page = pages.find((p) => p.urlPath === urlPath);
    if (!page)
      throw new Error(
        `page d'entrée absente du site rendu : « ${urlPath || "/"} » — ` +
          `corriger ENTRY_POINTS ou la page`,
      );
    return page;
  });
  lines.push("## Start here", "");
  for (const page of entries) lines.push(entryLine(page, base));
  lines.push("");

  // Un titre par groupe, dans l'ordre de première apparition ; chaque page au
  // PREMIER groupe dont le préfixe la couvre.
  const byHeading = new Map();
  for (const group of GROUPS)
    if (!byHeading.has(group.heading)) byHeading.set(group.heading, []);
  for (const page of pages) {
    if (entries.includes(page) || !isPlanned(page)) continue;
    const group = GROUPS.find((g) => page.urlPath.startsWith(g.prefix));
    if (group) byHeading.get(group.heading).push(page);
  }
  for (const [heading, members] of byHeading) {
    if (!members.length) continue;
    lines.push(`## ${heading}`, "");
    for (const page of members) lines.push(entryLine(page, base));
    lines.push("");
  }
  return lines.join("\n");
}
