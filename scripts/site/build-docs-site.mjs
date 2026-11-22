#!/usr/bin/env node
/**
 * Construit le SITE de documentation publié — toute la doc Nodefony en HTML
 * autonome, régénérée à chaque release.
 *
 * CE QUE CE SCRIPT NE FAIT PAS : rédiger. La source reste le Markdown, aux
 * vrais chemins (`docs/` et `<module>/docs/`, cf ADR-0001) — lisible sur
 * GitHub, dans un éditeur, dans le portail Studio, et dans le paquet npm
 * installé. Le site est un TROISIÈME consommateur de cette source, jamais une
 * transformation qui la remplace : rien ici n'écrit dans `docs/`.
 *
 * CE QU'IL FAIT, et qui n'existait nulle part : décider ce qui devient PUBLIC,
 * puis rendre. Un dépôt ouvert contient des pages qui n'ont rien à faire sur un
 * site — journal de sessions, archives, plan de version. La décision se prend à
 * deux niveaux, dans cet ordre :
 *
 *   1. un DOSSIER est publiable ou non (`PUBLIC_DIRS` / `PRIVATE`) — c'est le
 *      gros du tri, et il ne se périme pas : une page neuve dans `docs/guides/`
 *      est publique d'office, sans toucher à ce fichier ;
 *   2. une PAGE peut trancher pour elle-même, via son frontmatter `publish` —
 *      `core` (interne au dépôt) ou `none` (nulle part) la retire, `user` publie
 *      une page qui ne le serait pas ; `false`/`true` restent compris. Le
 *      contrôle reste là où vit l'auteur.
 *
 * Le compte rendu final NOMME ce qui a été écarté et pourquoi. Publier à
 * l'aveugle serait le seul vrai risque de cet outil.
 *
 * Rien n'est réimplémenté ici de ce que `@nodefony/documentation` porte déjà :
 * le scan, les slugs et la réécriture des liens internes viennent du module —
 * son `MEMORY.md` annonce ce générateur comme consommateur. Le chrome (thèmes,
 * impression, marque) vient du moteur `nodefony-html-report`, et les diagrammes
 * de `lib/schemas.mjs`, qui les rend SANS navigateur : la publication tourne
 * sur une machine sans Chromium.
 *
 * Usage :
 *   node scripts/site/build-docs-site.mjs [--out tmp/sites/docs] [--mount /docs]
 *        [--channel published|next] [--site-url <url>] [--quiet]
 *
 * Le dossier de la documentation (`<out>/<mount>`) est VIDÉ avant le rendu s'il
 * porte un rendu précédent, refusé s'il porte autre chose (`lib/out-dir.mjs`).
 *
 * Sortie 1 si aucune page n'a pu être rendue, ou si le hub d'accueil manque —
 * un site vide se publierait en silence.
 *
 * @usage node scripts/site/build-docs-site.mjs [--out tmp/sites/docs] [--mount /docs] [--channel published|next] [--quiet]
 * @usage node scripts/site/build-docs-site.mjs --list
 */
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import MarkdownIt from "markdown-it";
import { readDocScope } from "nodefony";
import { highlight, STYLE_CODE } from "./markdown-highlight.mjs";
import { pathToFileURL } from "node:url";
import { REPO_ROOT as ROOT } from "../lib/repo-root.mjs";

// Le module est consommé par sa SURFACE PUBLIÉE, pas par ses sources : ce
// générateur voit exactement ce que voit une application qui l'installe. En
// échange, il exige que le paquet soit bâti — et le dit, plutôt que de laisser
// un « module introuvable » qu'on impute au mauvais endroit.
// Composé depuis la racine, jamais relatif à ce fichier : relatif, il cassait au
// premier déplacement du script — en annonçant un paquet « non bâti ».
const DOC_MODULE = pathToFileURL(
  path.join(
    ROOT,
    "src",
    "packages",
    "@nodefony",
    "documentation",
    "dist",
    "index.js",
  ),
).href;
let docModule;
try {
  docModule = await import(DOC_MODULE);
} catch (err) {
  // L'erreur réelle est NOMMÉE : un chemin faux, un export manquant ou un
  // dist absent ne se soignent pas pareil, et un seul message les confondait.
  console.error(
    "✗ @nodefony/documentation ne se charge pas — le générateur consomme sa surface publiée.\n" +
      `  ${err instanceof Error ? err.message : String(err)}\n` +
      "  Paquet non bâti ? npx turbo run build --filter=@nodefony/documentation",
  );
  process.exit(1);
}
const {
  scanDocsDir,
  pathToSlug,
  rewriteInternalLinks,
  metaString,
  parseFrontmatter,
  extractSearchText,
  searchDocs,
  ROOT_GROUPS,
  ROOT_PAGES,
} = docModule;
import {
  doc,
  esc,
} from "../../.claude/skills/nodefony-html-report/lib/report.mjs";
import { schema } from "../../.claude/skills/nodefony-html-report/lib/schemas.mjs";
import { NODEFONY_BRAND } from "../../.claude/skills/nodefony-html-report/lib/brand.mjs";
import { anchorHeadings } from "./lib/html-text.mjs";
import { sansCommentaires, stripLeadingTitle } from "./lib/markdown-source.mjs";
import { prepareOutDir } from "./lib/out-dir.mjs";
import { versionSwitchScript } from "./lib/site-versions.mjs";
import { ADMONITION_CSS, decorateAdmonitions } from "./lib/admonitions.mjs";
import { extractApiModel, renderApiPages } from "./lib/api-reference.mjs";
import { adrPublicationDefects } from "./lib/adr-publication.mjs";
import { moduleDocsDirs } from "./lib/module-docs.mjs";
import {
  SOURCE_LANGUAGE,
  pageLanguage,
  sourceOfTranslation,
  staleTranslations,
  translationGroups,
  translationPath,
} from "./lib/translations.mjs";
import { pageSummary } from "./lib/page-summary.mjs";
import {
  breadcrumbList,
  brandTitle,
  seoHead,
  tabTitle,
  techArticle,
  webPage,
} from "./lib/seo-head.mjs";

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const OUT = path.resolve(ROOT, arg("out", "tmp/sites/docs"));
/**
 * Sous-dossier du site où vit la documentation (`/docs`), vide si elle occupe
 * la racine. Il entre dans les URL avant tout calcul de chemin relatif : c'est
 * ce qui permet à un lien vers un VOISIN du site (les mesures, l'accueil) de
 * remonter du bon nombre de niveaux. Le déduire après coup revenait à corriger
 * des `../` à la main, et à se tromper d'un cran sans que rien ne le dise.
 */
const MOUNT = arg("mount", "").replace(/\/+$/, "");
/**
 * Chemin d'UNE page à rendre seule (aperçu d'un brouillon), relatif au dépôt.
 *
 * C'est le service que rendait un second script, avec son propre moteur de
 * rendu — donc deux rendus qui divergeaient, et un aperçu qui ne montrait pas
 * ce qui serait publié. Une option vaut mieux qu'un jumeau.
 */
const ONLY = arg("only", "");
const QUIET = process.argv.includes("--quiet");
const REPO_URL = "https://github.com/nodefony/nodefony-core";
const SITE_URL = arg("site-url", "https://nodefony.net");

const git = (...a) => {
  try {
    return execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
};
/**
 * La référence git d'où viennent les pages — elle entre dans le lien « page
 * générée depuis ». Un tag (archive de release) se bâtit en HEAD détaché, sans
 * branche : c'est alors le tag qui désigne la bonne révision du fichier.
 */
const BRANCH =
  git("branch", "--show-current") ||
  git("describe", "--tags", "--exact-match") ||
  "main";
const COMMIT = git("rev-parse", "--short", "HEAD") || "?";
/**
 * Ce que le rendu décrit : `published` (la version servie par npm — la racine du
 * site, et chaque archive de release) ou `next` (la branche `dev`, servie sous
 * `/next/`). Déduit de la branche à défaut : `main` n'avance qu'aux releases.
 * Le flux de publication le DIT toujours — un tag se bâtit en HEAD détaché, sans
 * branche à lire.
 */
const CHANNEL = arg("channel", BRANCH === "main" ? "published" : "next");
if (CHANNEL !== "published" && CHANNEL !== "next") {
  console.error(`✗ --channel ${CHANNEL} : attendu « published » ou « next ».`);
  process.exit(1);
}
const IS_NEXT = CHANNEL === "next";
/**
 * La version que le site AFFICHE : celle du paquet publié (`nodefony`), jamais
 * celle de la racine — l'application de développement, figée à `10.0.0`, faisait
 * annoncer « Nodefony 10.0.0 » pendant que npm servait une beta. Sur `next`, la
 * page décrit ce qui VIENT après cette version, et le dit.
 */
const PUBLISHED = JSON.parse(
  readFileSync(path.join(ROOT, "src", "nodefony", "package.json"), "utf8"),
).version;
const VERSION = IS_NEXT ? `en développement, après ${PUBLISHED}` : PUBLISHED;
/** La pastille de l'en-tête, à côté du nom : courte, lisible d'un coup d'œil. */
const BADGE = IS_NEXT ? `${PUBLISHED} + dev` : PUBLISHED;

/**
 * Bandeau de `/next/` : ce que la page décrit n'est pas installable. Le lien
 * remonte d'un cran — `next/` vit sous la racine, qui porte la version publiée.
 *
 * @param {string} rootRel - chemin relatif de la page vers la racine de SA version.
 * @returns {string} le bandeau, vide hors de `next`.
 */
function nextBanner(rootRel) {
  if (!IS_NEXT) return "";
  return (
    `<div class="nf-next-banner" role="note"><strong>En développement — pas encore publié.</strong> ` +
    `Cette page décrit la branche <code>dev</code> (<a href="${REPO_URL}/commit/${esc(COMMIT)}"><code>${esc(COMMIT)}</code></a>) : ` +
    `ce qu'elle annonce n'est pas encore dans <code>nodefony@${esc(PUBLISHED)}</code>. ` +
    `<a href="${rootRel}../">Lire la documentation de la version publiée</a>.</div>`
  );
}
const BUILT_AT = new Date().toISOString().slice(0, 10);

/* ════════════════════════════════════════════════════════════════════════════
   1. QUI EST PUBLIC — la décision, avant toute lecture
   ════════════════════════════════════════════════════════════════════════════ */

/**
 * Dossiers de `docs/` publiés, dans l'ordre où ils apparaissent dans la
 * navigation. Cet ordre est PÉDAGOGIQUE, pas alphabétique, et il part du
 * GESTE : on fait une première fois en étant guidé (tutoriels), puis on refait
 * seul sur un besoin précis (guides), puis on comprend ce qui se passait
 * dessous (architecture). L'inverse — la philosophie avant le premier geste —
 * fait fuir qui arrive avec « je veux une API avec authentification ».
 */
/**
 * Icône de chaque section — la seule chose que le site ajoute au périmètre.
 * Le portail d'administration n'en met pas ; c'est de la présentation, pas de la
 * règle, et c'est pour ça qu'elle vit ici et non dans le module.
 */
const DIR_ICONS = {
  tutoriels: "🎓",
  guides: "🧭",
  architecture: "🏛️",
};

/**
 * Ce qui est publié vient du MODULE (`ROOT_GROUPS`), pas d'une liste tenue ici.
 *
 * Cette liste a été dupliquée, et elle avait commencé à diverger : le portail
 * d'administration et le site public montraient des sections différentes du même
 * corpus. Le générateur importe déjà le `dist` du module pour scanner les
 * pages — il n'y avait aucune raison d'en recopier le périmètre.
 */
const PUBLIC_DIRS = ROOT_GROUPS.map(({ group, label }) => ({
  dir: group,
  label,
  icon: DIR_ICONS[group] ?? "📄",
}));

/**
 * La référence d'API — section propre au SITE, hors `ROOT_GROUPS` : ses pages
 * naissent au rendu (`lib/api-reference.mjs`), aucun `docs/api/` ne les porte.
 * Le portail d'administration a son propre onglet API, lu dans le graphe symbolique.
 */
const API_SECTION = { label: "Référence d'API", icon: "🔎" };

/** Pages de la racine de `docs/` publiées — même source que le portail. */
const PUBLIC_ROOT_PAGES = new Set(ROOT_PAGES.map((p) => `${p}.md`));

/**
 * Ce qui ne part JAMAIS sur le site, avec le motif — le motif est affiché dans
 * le compte rendu, pour qu'une exclusion reste une décision lisible et non un
 * oubli.
 */
const PRIVATE = [
  {
    match: (p) => p.startsWith("session-retros/"),
    why: "journal de sessions (interne)",
  },
  {
    match: (p) => p.startsWith("archives/"),
    why: "archive (périmé par nature)",
  },
  {
    match: (p) => p.startsWith("performance/"),
    why: "publié par son propre site (/performance/)",
  },
  { match: (p) => p.startsWith("release/"), why: "plan de version (interne)" },
  {
    match: (p) => p === "README.md",
    why: "conventions d'écriture de la doc (interne)",
  },
  {
    // Une décision d'architecture documente un CHOIX fait par le projet, pas un
    // usage : elle intéresse qui développe le cœur, pas qui s'en sert.
    match: (p) => p.startsWith("adr/"),
    why: "décision d'architecture (interne)",
  },
  {
    // L'outillage d'agent sert à DÉVELOPPER le cœur : ces fiches n'ont pas de
    // lecteur hors du dépôt.
    match: (p) => p.startsWith("skills/") || p === "outillage-agents.md",
    why: "outillage de développement du cœur (interne)",
  },
  {
    // Les adresses `api/` appartiennent à la référence GÉNÉRÉE : une page écrite
    // à la main y entrerait en concurrence avec elle.
    match: (p) => p.startsWith("api/"),
    why: "réservé à la référence d'API générée",
  },
  {
    // La couche IA est une VISION : rien n'est développé. Publier la promesse
    // d'une capacité inexistante est le plus sûr moyen de perdre la confiance
    // de qui vient l'essayer.
    match: (p) => p.startsWith("ia/"),
    why: "vision non développée (interne)",
  },
];

/**
 * Statuts qu'une page doit porter pour être publiée. Un brouillon ou une vision
 * ENGAGE le projet dès qu'il est en ligne : un lecteur ne distingue pas un texte
 * de travail d'une promesse, et le badge ne suffit pas à l'en avertir. Une page
 * SANS statut reste publiée — retirer cinq guides utiles pour un frontmatter
 * incomplet serait une punition, pas une règle — mais elle est signalée.
 * `experimental` est publiée : c'est la page d'un paquet LIVRÉ dont l'API peut
 * encore changer en mineure (politique de compatibilité, § « Surfaces
 * expérimentales ») — la retirer cacherait un paquet installable, et son badge
 * (`warn`) porte l'avertissement.
 */
const PUBLIC_STATUS = new Set(["stable", "accepted", "experimental"]);

/**
 * Tranche le sort d'une page.
 *
 * @param {{source: string, relPath: string, meta: Record<string, unknown>}} d
 * @returns {{ok: boolean, why: string}}
 */
function decide(d) {
  // Le frontmatter a le dernier mot, dans les deux sens — lu par la règle du
  // cœur, la MÊME que le portail de Studio et l'onglet Docs d'un module.
  const scope = readDocScope(d.meta?.publish);
  if (scope === "core" || scope === "none")
    return { ok: false, why: `publish: ${scope} (décision de la page)` };
  const forced = scope === "user";
  if (d.generated) return { ok: true, why: "référence d'API générée" };

  const status = metaString(d.meta, "status");
  if (!forced && status && !PUBLIC_STATUS.has(status))
    return { ok: false, why: `statut « ${status} » — non publiable` };

  if (d.source.kind !== "root")
    return { ok: true, why: "documentation d'un module" };

  const relPath = d.relPath;
  const priv = PRIVATE.find((r) => r.match(relPath));
  if (priv && !forced) return { ok: false, why: priv.why };
  if (forced) return { ok: true, why: "publish: true (décision de la page)" };

  const top = relPath.includes("/")
    ? relPath.slice(0, relPath.indexOf("/"))
    : null;
  if (top === null)
    return PUBLIC_ROOT_PAGES.has(relPath)
      ? { ok: true, why: "page d'accueil du site" }
      : {
          ok: false,
          why: "page de racine hors sommaire (ajouter à PUBLIC_ROOT_PAGES ou publish: true)",
        };
  return PUBLIC_DIRS.some((s) => s.dir === top)
    ? { ok: true, why: `dossier public « ${top} »` }
    : { ok: false, why: `dossier « ${top} » hors périmètre public` };
}

/* ════════════════════════════════════════════════════════════════════════════
   2. COLLECTE — le module fait le scan, on ne le refait pas
   ════════════════════════════════════════════════════════════════════════════ */

/** Modules du dépôt qui portent un dossier `docs/` — règle partagée avec les README. */
const moduleDirs = () => moduleDocsDirs(ROOT);

/**
 * Traduit une URL de site (`/adr/`) en chemin RELATIF depuis la page courante
 * (`../../adr/`).
 *
 * Pourquoi ne pas publier des chemins absolus : une archive est servie sous
 * `next/` ou `<version>/`, et un `/adr/` y désignerait la racine du domaine — donc
 * 122 pages de liens morts, invisibles en local et découverts en ligne. Un site
 * à liens relatifs marche partout, sans réglage : sous un sous-chemin, sur un
 * domaine propre, ouvert depuis le disque. C'est déjà le choix du site de
 * performance voisin. Une variable de préfixe aurait ajouté un réglage dont
 * l'oubli casse tout, en silence.
 *
 * @param {string} fromUrl - URL de la page qui porte le lien (dossier).
 * @param {string} toUrl - URL visée.
 * @returns {string} chemin relatif, avec sa barre finale.
 */
/**
 * Chemin relatif vers un FICHIER — pas vers une page.
 *
 * {@link rel} termine toujours par une barre : ses cibles sont des pages servies
 * comme des dossiers (`guides/routage/`). Appliqué à un fichier, il produit
 * `search-index.json/`, que le serveur rend en 404 — et la recherche annonce
 * alors « indisponible » sans que rien d'autre ne le signale.
 */
function relFile(fromUrl, toUrl) {
  return rel(fromUrl, toUrl).replace(/\/$/, "");
}

function rel(fromUrl, toUrl) {
  const [target, hash = ""] = toUrl.split(/(#.*)$/);
  const from = fromUrl.replace(/\/$/, "") || "/";
  const to = target.replace(/\/$/, "") || "/";
  let out = path.posix.relative(from, to);
  if (out === "") out = "./";
  else if (!out.endsWith("/")) out += "/";
  return out + hash;
}

/**
 * Chemin d'un doc relatif à la RACINE DU DÉPÔT — c'est la clé que les liens
 * internes résolvent, et celle des URL GitHub.
 */
const repoRelOf = (d) =>
  d.source.kind === "root"
    ? `docs/${d.relPath}`
    : // La clé VOYAGE (liens, URL GitHub) : en `/`, quel que soit le séparateur du disque.
      `${path.relative(ROOT, d.moduleDir).split(path.sep).join("/")}/${d.relPath}`;

/**
 * URL publique d'une page.
 *
 * `index.md` ET `README.md` deviennent le dossier lui-même : ce sont les deux
 * noms qu'un dossier donne à sa page d'accueil, et `/adr/README/` serait une
 * URL que personne n'écrirait à la main. Aucun dossier du corpus ne porte les
 * deux à la fois — si cela arrivait, `assertNoIndexClash` le dirait avant de
 * publier deux pages sur la même adresse.
 */
function urlOf(d) {
  const noExt = d.relPath.replace(/\.md$/i, "");
  const parts = noExt.split("/");
  const last = parts[parts.length - 1];
  const isIndex = last === "index" || last === "README";
  if (isIndex) parts.pop();
  const tail = parts.length ? `${parts.join("/")}/` : "";
  return d.source.kind === "root"
    ? `${MOUNT}/${tail}`
    : `${MOUNT}/modules/${d.moduleKey}/${tail}`;
}

async function collect() {
  const docs = [];
  for (const d of await scanDocsDir(path.join(ROOT, "docs"), { kind: "root" }, [
    "node_modules",
    "dist",
  ])) {
    docs.push({ ...d, moduleKey: null, moduleLabel: null, moduleDir: null });
  }
  for (const m of moduleDirs()) {
    const source = { kind: "module", module: m.npm };
    for (const d of await scanDocsDir(m.dir, source, [
      "node_modules",
      "dist",
    ])) {
      docs.push({
        ...d,
        moduleKey: m.key,
        moduleLabel: m.label,
        moduleDir: m.dir,
      });
    }
  }
  docs.push(...apiReferenceDocs());
  for (const d of docs) {
    d.repoRel = repoRelOf(d);
    d.verdict = decide(d);
    d.url = urlOf(d);
  }
  // Une TRADUCTION est publiée à l'adresse de sa source, préfixée par sa langue
  // (`lib/translations.mjs#translationPath`) — jamais à celle de son fichier :
  // une adresse publiée ne se change plus.
  const byRepo = new Map(docs.map((d) => [d.repoRel, d]));
  for (const d of docs) {
    const src = sourceOfTranslation(d);
    const source = src === null ? undefined : byRepo.get(src);
    if (source !== undefined)
      d.url = translationPath(source.url, pageLanguage(d.meta));
  }
  return docs;
}

/**
 * Les pages de la référence d'API, nées ICI du code du moment — aucune n'existe
 * dans le dépôt (`lib/api-reference.mjs`). Elles entrent dans le corpus comme
 * des pages de `docs/api/`, donc avec ses liens, sa recherche et son plan.
 *
 * Un aperçu d'une page écrite à la main s'en passe : il ne doit pas exiger que
 * tous les paquets soient bâtis.
 */
function apiReferenceDocs() {
  if (ONLY && !ONLY.replace(/\\/g, "/").startsWith("docs/api/")) return [];
  let pages;
  try {
    pages = renderApiPages(extractApiModel(ROOT));
  } catch (err) {
    console.error(
      `✗ référence d'API : ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }
  const source = { kind: "root" };
  return pages.map((p) => ({
    slug: pathToSlug(source, p.relPath),
    relPath: p.relPath,
    absPath: null,
    raw: p.markdown,
    generated: true,
    source,
    group: path.posix.dirname(p.relPath),
    meta: parseFrontmatter(p.markdown).meta,
    title: p.title,
    navTitle: p.navTitle,
    moduleKey: null,
    moduleLabel: null,
    moduleDir: null,
  }));
}

/** Le Markdown d'une page : son fichier, ou le texte généré pour la référence d'API. */
const sourceOf = (d) => d.raw ?? readFileSync(d.absPath, "utf8");

/* ════════════════════════════════════════════════════════════════════════════
   3. RENDU D'UNE PAGE
   ════════════════════════════════════════════════════════════════════════════ */

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  highlight,
});

/**
 * Code inline d'une description de card : le JSON d'un bloc n'est pas du
 * markdown, et les accents graves s'affichaient bruts. Appliqué APRÈS `esc` —
 * le contenu reste échappé. Même règle que `withInlineCode` de la console
 * (`MarkdownDoc.tsx`).
 */
const inlineCode = (escaped) =>
  escaped.replace(/`([^`]+)`/g, "<code>$1</code>");

/** Rendu des cards déclaratives (`nodefony-cards`) — le catalogue d'un hub. */
function renderCards(json) {
  let items;
  try {
    items = JSON.parse(json);
  } catch {
    return `<pre class="raw">${esc(json)}</pre>`;
  }
  if (!Array.isArray(items) || items.length === 0) return "";
  const card = (c) => {
    const inner = `${c.icon ? `<span class="card-i" aria-hidden="true">${esc(c.icon)}</span>` : ""}
      <span class="card-t">${esc(c.title ?? "")}</span>
      ${c.desc ? `<span class="card-d">${inlineCode(esc(c.desc))}</span>` : ""}
      ${c.meta ? `<span class="card-m">${esc(c.meta)}</span>` : ""}`;
    const cls = `nf-card${c.featured ? " featured" : ""}`;
    return c.href
      ? `<a class="${cls}" href="${esc(c.href)}">${inner}</a>`
      : `<div class="${cls}">${inner}</div>`;
  };
  return `<div class="nf-cards">${items.map(card).join("")}</div>`;
}

/**
 * Diagrammes : rendus en SVG côté serveur, en clair ET en sombre, la bascule
 * étant faite en CSS pur. Un SVG porte ses couleurs en dur — il ne peut pas
 * suivre le thème du lecteur, d'où les deux rendus.
 */
/** Largeur naturelle, en pixels, d'un SVG rendu — depuis son attribut `width`. */
function largeurSvg(svg) {
  const m = /<svg[^>]*\swidth="(\d+(?:\.\d+)?)"/.exec(svg);
  return m ? Number(m[1]) : 0;
}

/**
 * Au-delà de cette largeur naturelle, un schéma est traité comme LARGE : il
 * déborde sur les marges et défile plutôt que de rétrécir.
 *
 * La colonne de contenu fait environ 580 px. Un ruban de pipeline en fait 1 758 :
 * ramené à 100 % de la colonne, il se rend à 33 % de sa taille, et ses libellés
 * deviennent illisibles. Le seuil est posé là où la réduction commence à coûter
 * plus que le confort de rester dans la colonne.
 */
const SCHEMA_LARGE_PX = 900;

function renderMermaid(source) {
  try {
    const clair = schema({ source, theme: "clair" });
    const sombre = schema({ source, theme: "sombre" });
    // Un schéma LARGE déborde sur les gouttières (nav à gauche, sommaire à
    // droite) puis, si cela ne suffit toujours pas, défile horizontalement —
    // au lieu d'être réduit jusqu'à l'illisible. La zone porte déjà `tabindex`,
    // donc son défilement est atteignable au clavier.
    const w = largeurSvg(clair);
    const large = w > SCHEMA_LARGE_PX;
    // La largeur naturelle est posée sur TOUTE figure : c'est elle qui borne
    // l'agrandissement d'un petit schéma (cf `.schema-zone svg`).
    return `<figure class="schema-zone${large ? " large" : ""}"${
      w > 0 ? ` style="--schema-w:${Math.round(w)}px"` : ""
    } tabindex="0" role="img" aria-label="Diagramme">
<div class="d d-light">${clair}</div><div class="d d-dark">${sombre}</div></figure>`;
  } catch {
    return `<pre class="raw">${esc(source)}</pre>`;
  }
}

/**
 * Bloc « graphe vivant » : une DIRECTIVE adressée à la console d'administration,
 * qui sait l'animer avec les données du serveur en marche. Un site statique n'a
 * ni serveur ni socket — le rendre tel quel affichait sa configuration JSON en
 * clair au milieu du texte, ce qui se lit comme une page cassée. On rend donc ce
 * qu'il ANNONCE, et on dit où le voir vivant.
 */
function renderLiveGraph(json) {
  let cfg;
  try {
    cfg = JSON.parse(json);
  } catch {
    return "";
  }
  const titre = cfg.title ? esc(cfg.title) : "Graphe interactif";
  const hint = cfg.hint ? `<p class="lg-hint">${esc(cfg.hint)}</p>` : "";
  return `<aside class="livegraph"><p class="lg-t"><span aria-hidden="true">📡</span> ${titre}</p>${hint}
<p class="lg-note">Cette figure se dessine avec les données du serveur en marche : elle est
vivante dans la console d'administration de votre application (<code>/nodefony</code>),
pas sur une page publiée.</p></aside>`;
}

const baseFence = md.renderer.rules.fence.bind(md.renderer.rules);
md.renderer.rules.fence = (tokens, idx, opts, env, self) => {
  const info = (tokens[idx].info || "").trim();
  if (info === "mermaid") return renderMermaid(tokens[idx].content);
  if (info === "nodefony-cards") return renderCards(tokens[idx].content);
  if (info === "nodefony-livegraph")
    return renderLiveGraph(tokens[idx].content);
  return baseFence(tokens, idx, opts, env, self);
};

/** Enrichissements que markdown-it ne fait pas — tous purement visuels. */
function decorate(html) {
  // Admonitions GitHub (`> [!NOTE]`) — règle partagée avec l'accueil.
  let out = decorateAdmonitions(html);
  // Cards de catalogue : `### \`nom\` — titre` devient une brique visuelle. L'`id`
  // du titre passe à la brique : le jeter rendait mortes toutes les ancres qui
  // visaient ces sections — sommaire de la page compris.
  out = out.replace(
    /<h3([^>]*)><code>([^<]+)<\/code>\s*(?:—|–|-)?\s*([^<]*)(<a class="h-anchor"[^>]*>#<\/a>)?<\/h3>([\s\S]*?)(?=<h3|<h2|$)/g,
    (_, attrs, name, title, anchor, body) =>
      `<section class="brick"${attrs}><header class="brick-h"><code class="brick-name">${name}</code><span class="brick-t">${title}</span>${anchor ?? ""}</header><div class="brick-b">${body}</div></section>`,
  );
  // Marque visuelle des liens qui QUITTENT le site (une flèche, via `.ext`).
  out = out.replace(
    new RegExp(`<a href="(${REPO_URL}[^"]*)"`, "g"),
    '<a class="ext" href="$1"',
  );
  // Un bloc de code assez large pour défiler doit être atteignable au clavier —
  // sinon son contenu est inaccessible à qui ne se sert pas d'une souris
  // (axe : scrollable-region-focusable). Le poser sur TOUS les `pre` est sans
  // effet visuel et couvre les blocs qui déborderont un jour.
  out = out.replace(/<pre>/g, '<pre tabindex="0">');
  // Enveloppe défilante des tableaux — voir `.table-zone` : sans elle, un
  // tableau large défile sans qu'aucune touche ne puisse l'atteindre.
  out = out.replace(
    /<table>([\s\S]*?)<\/table>/g,
    '<div class="table-zone" tabindex="0"><table>$1</table></div>',
  );
  // Ancres de preuve `fichier.ts:123` — la preuve reste, le bruit s'efface.
  out = out.replace(
    /<code>([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\.(?:ts|tsx|mjs|js):\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)<\/code>/g,
    '<sup class="srcref"><code>$1</code></sup>',
  );
  return out;
}

/**
 * Réécrit vers GitHub les liens qui ne mèneront nulle part sur le site.
 *
 * Une page publiée cite des voisines non publiées (un retex, une archive), des
 * DOSSIERS, et du CODE. Ces cibles existent et sont publiques — sur le dépôt,
 * pas sur le site. Les laisser en relatif produirait des culs-de-sac.
 *
 * Cela se fait sur le MARKDOWN, avant que les liens internes ne deviennent des
 * chemins de site : c'est le seul moment où une cible est encore un chemin du
 * dépôt. L'avoir tenté ensuite, sur le HTML, revenait à distinguer `../../adr/`
 * (une page) de `../../drizzle/docs/` (un dossier) — deux formes identiques,
 * qu'aucune règle ne sépare.
 *
 * @param {string} markdown - corps de la page, frontmatter retiré.
 * @param {string} fromRepoDir - dossier de la page, relatif au dépôt.
 * @param {Set<string>} publishedPaths - chemins des pages qui, elles, auront une URL.
 * @returns {{markdown: string, dead: string[]}} liens restés sans cible.
 */
function externalizeLinks(markdown, fromRepoDir, publishedPaths) {
  const dead = [];
  const rewrite = (whole, target, hash = "") => {
    const abs = path.posix
      .normalize(path.posix.join(fromRepoDir, target))
      .replace(/^\/+/, "");
    const clean = abs.replace(/\/$/, "");
    if (publishedPaths.has(clean)) return whole; // aura son URL de site
    // Le dossier de performance a son propre site, publié à côté.
    if (clean.startsWith("docs/performance")) return whole;
    const full = path.join(ROOT, clean);
    if (!existsSync(full)) {
      dead.push(target);
      return whole;
    }
    const kind = statSync(full).isDirectory() ? "tree" : "blob";
    return { url: `${REPO_URL}/${kind}/${BRANCH}/${clean}${hash}` };
  };
  // Le CODE INLINE est neutralisé d'abord : une page qui ENSEIGNE la syntaxe des
  // liens cite ses exemples entre accents graves (`"href": "cors.md"`), et sans
  // cette précaution ils sont traités comme de vraies cibles — signalés morts
  // s'ils n'existent pas, et RÉÉCRITS en URL absolue s'ils existent, ce qui
  // détruirait l'exemple. Les fences, elles, ne sont PAS masquées : les
  // catalogues `nodefony-cards` en sont, et leurs cibles doivent bien être
  // traduites. Même règle que le `doc-lint` du dépôt, qui neutralise déjà le code
  // avant de juger un lien.
  const inline = [];
  const masked = markdown.replace(/`[^`\n]*`/g, (m) => {
    inline.push(m);
    return `\u0000INLINE${inline.length - 1}\u0000`;
  });
  const out = masked
    .replace(
      /\]\((?!https?:|mailto:|#)([^)\s]+?)(#[^)\s]*)?\)/g,
      (whole, target, hash = "") => {
        const r = rewrite(whole, target, hash);
        return typeof r === "string" ? r : `](${r.url})`;
      },
    )
    .replace(
      // L'ancre se sépare de la cible, comme pour un lien markdown : collée,
      // `index.md#section` n'était reconnue ni publiée ni présente sur le disque.
      /"href"\s*:\s*"(?!https?:|mailto:|#)([^"\s#]+?)(#[^"\s]*)?"/g,
      (whole, target, hash = "") => {
        const r = rewrite(whole, target, hash);
        return typeof r === "string" ? r : `"href": "${r.url}"`;
      },
    )
    .replace(/\u0000INLINE(\d+)\u0000/g, (_, i) => inline[Number(i)]);
  return { markdown: out, dead };
}

/* ════════════════════════════════════════════════════════════════════════════
   4. NAVIGATION — un arbre replié, sans une ligne de JavaScript
   ════════════════════════════════════════════════════════════════════════════ */

/**
 * Familles de modules — la navigation les groupe par RÔLE, pas par ordre
 * alphabétique. Quatorze entrées à plat n'enseignent rien : un lecteur qui
 * cherche « comment je stocke » ne sait pas que la réponse s'appelle `drizzle`.
 * Un module absent de cette table atterrit dans « Autres » : la liste se périme
 * en douceur, elle ne casse jamais.
 */
const MODULE_FAMILIES = [
  { key: "coeur", label: "Le cœur", icon: "🧱", modules: ["core"] },
  {
    key: "web",
    label: "Web & routage",
    icon: "🔌",
    modules: ["http", "framework", "frontend"],
  },
  {
    key: "donnees",
    label: "Données",
    icon: "🗄️",
    modules: ["orm-core", "drizzle", "mongoose", "redis"],
  },
  {
    key: "securite",
    label: "Sécurité & identité",
    icon: "🔐",
    modules: ["security", "user"],
  },
  { key: "temps-reel", label: "Temps réel", icon: "📡", modules: ["realtime"] },
  {
    key: "outils",
    label: "Outils",
    icon: "🧰",
    modules: ["studio", "devkit", "documentation"],
  },
];

const esc4 = (s) => esc(String(s));

/**
 * Navigation latérale : un champ de filtre, les sections transverses, puis les
 * modules groupés par famille.
 *
 * Le filtre est le raccourci de qui sait déjà ce qu'il cherche — et sur 86
 * pages, l'arbre seul ne suffit plus. Il tient en quelques lignes de script
 * inline : chaque entrée porte son texte en attribut, on masque ce qui ne
 * correspond pas, et l'on ouvre les groupes qui gardent au moins un résultat.
 * Aucune dépendance, aucun index à charger — donc rien à maintenir en parallèle
 * du contenu.
 */
function buildNav(pages, current) {
  const home = pages.find((p) => p.url === `${MOUNT}/`);
  const rootPage = (file) =>
    pages.find((p) => p.source.kind === "root" && p.relPath === file);

  // Le MENU rend `navTitle`, la PAGE rend `title` : une colonne de quelques
  // centimètres ne tronque rien, un titre d'article s'y replie sur trois lignes
  // et le balayage visuel meurt. Le filtre, lui, cherche dans les DEUX — taper
  // un mot du titre long doit continuer de trouver la page.
  const li = (p) =>
    p
      ? `<li data-t="${esc4(`${p.navTitle} ${p.title}`.toLowerCase())}"><a href="${rel(current.url, p.url)}"${
          p.url === current.url ? ' aria-current="page"' : ""
        }${p.navTitle !== p.title ? ` title="${esc4(p.title)}"` : ""}>${esc4(p.navTitle)}</a></li>`
      : "";

  /**
   * Le HUB d'une section passe DEVANT ses pages.
   *
   * Un accueil de section s'appelle `index.md` ou `README.md`, et son URL est
   * celle du dossier lui-même. Trié comme les autres — sur son titre — il
   * atterrit au milieu de ses propres pages : « Tous les guides » tombait entre
   * « Publier une release » et « Session storage ». La porte d'entrée d'une
   * section devenait invisible, alors que c'est la page à lire en premier.
   *
   * Le portail d'administration applique déjà cette règle
   * (`DocumentationService.#orderPages`) ; le site ne l'appliquait pas, et les
   * deux ne montraient donc pas la même chose du même corpus.
   */
  const hubDevant = (items) => {
    const estHub = (p) =>
      /(^|\/)(index|README)$/.test(p.relPath.replace(/\.md$/i, ""));
    return [...items].sort((a, b) => (estHub(b) ? 1 : 0) - (estHub(a) ? 1 : 0));
  };

  const group = (label, icon, items, open, cls = "", ordered = false) =>
    items.length
      ? `<details${open ? " open" : ""}${cls ? ` class="${cls}"` : ""}>` +
        `<summary><span aria-hidden="true">${icon}</span> ${esc4(label)} ` +
        `<span class="n">${items.length}</span></summary>` +
        `<ul>${(ordered ? items : hubDevant(items)).map(li).join("")}</ul></details>`
      : "";

  const parts = [];
  if (MOUNT)
    parts.push(
      `<a class="nav-up" href="${rel(current.url, "/")}">← Accueil Nodefony</a>`,
    );
  parts.push(
    `<a class="nav-home${current.url === `${MOUNT}/` ? " on" : ""}" href="${rel(
      current.url,
      `${MOUNT}/`,
    )}">${esc4(home?.title ?? "Documentation")}</a>`,
  );
  parts.push(
    `<div class="nav-find"><input type="search" id="nav-q" placeholder="Rechercher dans la doc…" ` +
      `aria-label="Rechercher dans la documentation" autocomplete="off" ` +
      `aria-controls="nav-res">` +
      `<div id="nav-res" class="nav-res" role="region" aria-label="Résultats de recherche" ` +
      `data-index="${relFile(current.url, `${MOUNT}/search-index.json`)}" ` +
      `data-base="${rel(current.url, `${MOUNT}/`)}" hidden>` +
      `<p class="nav-res-h" role="status" aria-live="polite"></p><div class="nav-res-l"></div></div></div>` +
      `<p class="nav-empty" hidden>Aucune page ne correspond.</p>`,
  );

  const flat = ["demarrer.md", "lexique.md"].map(rootPage).filter(Boolean);
  // Les mesures et les campagnes de test sont publiées par leurs propres
  // générateurs, à côté de la documentation : sans entrée ici, le lecteur de
  // la doc n'a aucun chemin vers elles (le dossier `performance/` est écarté
  // du corpus, donc d'aucun groupe).
  const siblings = [
    ["/performance/", "📊 Performance"],
    ["/qualite/", "🧪 Qualité"],
  ]
    .map(
      ([url, label]) =>
        `<li data-t="${esc4(label.toLowerCase())}"><a href="${rel(current.url, url)}">${esc4(label)}</a></li>`,
    )
    .join("");
  parts.push(`<ul class="nav-flat">${flat.map(li).join("")}${siblings}</ul>`);

  for (const sec of PUBLIC_DIRS) {
    const items = pages.filter(
      (p) => p.source.kind === "root" && p.relPath.startsWith(`${sec.dir}/`),
    );
    const open =
      current.source.kind === "root" &&
      current.relPath.startsWith(`${sec.dir}/`);
    parts.push(group(sec.label, sec.icon, items, open));
  }
  // La référence d'API : l'index et une entrée par paquet. Les parts d'un paquet
  // découpé se rejoignent par son sommaire — cent entrées n'enseigneraient rien.
  // Ordre ÉCRIT ici : le sommaire d'un paquet découpé est un `index.md`, que la
  // règle du hub ferait passer devant les paquets d'une seule page.
  const apiRank = (p) =>
    p.relPath === "api/index.md"
      ? "0"
      : p.navTitle === "nodefony"
        ? "1"
        : `2${p.navTitle}`;
  const api = pages
    .filter(
      (p) =>
        p.generated && /^api\/([^/]+\.md|[^/]+\/index\.md)$/.test(p.relPath),
    )
    .sort((a, b) => (apiRank(a) < apiRank(b) ? -1 : 1));
  parts.push(
    group(
      API_SECTION.label,
      API_SECTION.icon,
      api,
      Boolean(current.generated),
      "",
      true,
    ),
  );

  // Les modules, par famille. Chaque module reste un sous-groupe : ses pages
  // sont nombreuses, et les mêler noierait le module dans sa famille.
  const byModule = new Map();
  for (const p of pages.filter((x) => x.moduleKey)) {
    if (!byModule.has(p.moduleKey)) byModule.set(p.moduleKey, []);
    byModule.get(p.moduleKey).push(p);
  }
  const placed = new Set();
  const familyBlocks = [];
  for (const fam of MODULE_FAMILIES) {
    const blocks = [];
    let count = 0;
    let openFam = false;
    for (const key of fam.modules) {
      const items = byModule.get(key);
      if (!items) continue;
      placed.add(key);
      count += items.length;
      const openMod = current.moduleKey === key;
      if (openMod) openFam = true;
      blocks.push(group(items[0].moduleLabel, "📦", items, openMod, "nav-mod"));
    }
    if (blocks.length)
      familyBlocks.push(
        `<details${openFam ? " open" : ""} class="nav-fam"><summary>` +
          `<span aria-hidden="true">${fam.icon}</span> ${esc4(fam.label)} ` +
          `<span class="n">${count}</span></summary><div>${blocks.join("")}</div></details>`,
      );
  }
  const others = [...byModule.keys()].filter((k) => !placed.has(k));
  if (others.length) {
    const blocks = others.map((k) =>
      group(
        byModule.get(k)[0].moduleLabel,
        "📦",
        byModule.get(k),
        current.moduleKey === k,
        "nav-mod",
      ),
    );
    familyBlocks.push(
      `<details${others.includes(current.moduleKey) ? " open" : ""} class="nav-fam">` +
        `<summary><span aria-hidden="true">📦</span> Autres <span class="n">${others.length}</span>` +
        `</summary><div>${blocks.join("")}</div></details>`,
    );
  }
  parts.push(`<div class="nav-mods">${familyBlocks.join("")}</div>`);
  parts.push(SEARCH_ENGINE_JS);
  parts.push(NAV_FILTER_JS);
  return parts.join("");
}

/**
 * Recherche du site, à DEUX étages, et c'est délibéré.
 *
 * 1. Le **filtre du menu** répond à la frappe, sans rien charger : chaque `li`
 *    porte son titre en minuscules. C'est ce qui sert à retrouver une page dont
 *    on connaît déjà le nom, et ça doit rester instantané.
 * 2. La **recherche plein texte** cherche dans le CORPS des pages, et rend des
 *    extraits — le portail d'administration en fait autant, un lecteur du site
 *    public ne doit pas être moins bien servi. Elle a besoin d'un index, donc
 *    elle le charge : UNE fois, au premier caractère tapé, jamais au chargement
 *    de la page. Personne ne paie pour une recherche qu'il ne fait pas.
 *
 * Le classement n'est pas réécrit ici : `searchDocs` est SÉRIALISÉE depuis le
 * module `@nodefony/documentation` et injectée telle quelle (cf `SEARCH_ENGINE_JS`).
 * Le portail et le site partagent donc la fonction, pas seulement l'intention —
 * deux copies auraient fini par classer différemment sans que rien ne le dise.
 */
const NAV_FILTER_JS = `<script>
(function(){
  var q=document.getElementById("nav-q"); if(!q) return;
  var nav=q.closest(".site-nav"), empty=nav.querySelector(".nav-empty");
  var items=[].slice.call(nav.querySelectorAll("li[data-t]"));
  var groups=[].slice.call(nav.querySelectorAll("details"));
  var initial=groups.map(function(g){return g.open;});
  function apply(){
    var v=q.value.trim().toLowerCase();
    if(!v){
      items.forEach(function(li){li.hidden=false;});
      groups.forEach(function(g,i){g.hidden=false;g.open=initial[i];});
      empty.hidden=true; return;
    }
    var n=0;
    items.forEach(function(li){
      var hit=li.getAttribute("data-t").indexOf(v)>=0;
      li.hidden=!hit; if(hit) n++;
    });
    groups.forEach(function(g){
      var hit=g.querySelector("li[data-t]:not([hidden])");
      g.hidden=!hit; if(hit) g.open=true;
    });
    empty.hidden=n>0;
  }
  var res=document.getElementById("nav-res");
  var head=res.querySelector(".nav-res-h"), list=res.querySelector(".nav-res-l");
  var idx=null, parSlug=null, chargement=null, jeton=0;
  var INDEX_URL=res.getAttribute("data-index"), BASE=res.getAttribute("data-base");

  function esc(s){var d=document.createElement("span");d.textContent=s;return d.innerHTML;}

  // Le terme est mis en évidence sur le texte ÉCHAPPÉ : surligner avant
  // d'échapper rendrait le balisage inerte, et surligner après aurait coupé les
  // entités (« &amp; ») en deux.
  function marque(texte,termes){
    var out=esc(texte);
    termes.forEach(function(t){
      var motif=t.replace(/[^0-9A-Za-z\\u00c0-\\u024f]/g,function(c){return "\\\\"+c;});
      out=out.replace(new RegExp("("+motif+")","gi"),"<mark>$1</mark>");
    });
    return out;
  }

  function rendre(r){
    if(!r.hits.length){
      head.textContent="Aucune page ne contient « "+r.query+" ».";
      list.innerHTML=""; return;
    }
    head.textContent=r.matched+" page"+(r.matched>1?"s":"")+
      " sur "+r.scanned+(r.matched>r.hits.length?" — "+r.hits.length+" affichées":"");
    list.innerHTML=r.hits.map(function(h){
      var ex=h.excerpts.map(function(e){
        return "<p class='res-x'>"+(e.section?"<span class='res-s'>"+esc(e.section)+"</span> ":"")+
          marque(e.text,r.terms)+"</p>";
      }).join("");
      return "<a class='res-c' href='"+esc(BASE+(parSlug[h.slug]||""))+"'>"+
        "<span class='res-t'>"+marque(h.title,r.terms)+"</span>"+
        "<span class='res-g'>"+esc(h.sectionLabel)+"</span>"+ex+"</a>";
    }).join("");
  }

  function chercher(v){
    var mien=++jeton;
    if(!idx){
      head.textContent="Chargement de l'index…"; list.innerHTML="";
      ouvrir();
      chargement=chargement||fetch(INDEX_URL).then(function(r){return r.json();});
      chargement.then(function(data){
        idx=data.docs;
        parSlug={}; idx.forEach(function(d){parSlug[d.slug]=d.path;});
        if(mien===jeton){ rendre(window.__nfSearch(idx,v,20)); placer(); }
      }).catch(function(){
        // Un index injoignable ne doit pas laisser croire que la doc est vide :
        // le filtre du menu, lui, fonctionne toujours.
        if(mien===jeton){ head.textContent="Recherche indisponible — le filtre du menu reste actif."; list.innerHTML=""; }
      });
      return;
    }
    ouvrir();
    rendre(window.__nfSearch(idx,v,20));
  }

  // Un panneau fixe ne suit pas son ancre : on la lui donne, à l'ouverture puis
  // à chaque fois que la page bouge sous lui.
  function placer(){
    var r=q.getBoundingClientRect();
    res.style.top=(r.bottom+6)+"px";
    res.style.left=Math.max(8,Math.min(r.left,window.innerWidth-res.offsetWidth-8))+"px";
  }
  function ouvrir(){ res.hidden=false; placer(); }
  function fermer(){ res.hidden=true; }
  window.addEventListener("resize",function(){ if(!res.hidden) placer(); });
  window.addEventListener("scroll",function(){ if(!res.hidden) placer(); },{passive:true});

  q.addEventListener("input",function(){
    apply();
    var v=q.value.trim();
    if(v.length<2){ fermer(); return; }
    chercher(v);
  });
  q.addEventListener("keydown",function(e){
    if(e.key==="Escape"){q.value="";apply();fermer();q.blur();}
  });
  document.addEventListener("click",function(e){
    if(!res.hidden && !res.contains(e.target) && e.target!==q) fermer();
  });
  // « / » ouvre la recherche — le raccourci que tout site de documentation
  // partage ; sans lui, on prend la souris pour chaque question.
  document.addEventListener("keydown",function(e){
    if(e.key==="/" && !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)){
      e.preventDefault(); q.focus();
    }
  });
})();
</script>`;

/**
 * Le moteur de recherche, SÉRIALISÉ depuis `@nodefony/documentation`.
 *
 * C'est le point qui fait tenir la promesse « le site et le portail cherchent
 * pareil » : on n'écrit pas ici une seconde implémentation qui finirait par
 * classer autrement, on injecte la FONCTION du module. Elle est écrite pour
 * supporter ce voyage — auto-suffisante, sans import ni capture — et un test de
 * parité l'exécute sous cette forme sérialisée, pas sous sa forme importée
 * (`search-parity.test.ts`) : autrement, le jour où quelqu'un lui ajoute une
 * dépendance, le site se construirait sans broncher et la recherche mourrait
 * chez le lecteur.
 */
const SEARCH_ENGINE_JS = `<script>window.__nfSearch=${searchDocs.toString()};</script>`;

const buildToc = (toc) =>
  toc.length
    ? `<p class="toc-l">Sur cette page</p><ul>${toc
        .map(
          (t) =>
            `<li class="l${t.lvl}"><a href="#${t.id}">${esc(t.text)}</a></li>`,
        )
        .join("")}</ul>`
    : "";

/* ════════════════════════════════════════════════════════════════════════════
   5. STYLE PROPRE AU SITE (le reste vient du moteur)
   ════════════════════════════════════════════════════════════════════════════ */

const SITE_CSS = `
.nf-next-banner { margin:0 0 22px; padding:10px 14px; border:1px solid var(--warn-fg);
  border-left-width:4px; border-radius:6px; background:var(--warn-bg); color:var(--warn-fg); font-size:14px; }
.nf-next-banner a { color:inherit; text-decoration:underline; }
.site-nav summary { cursor:pointer; padding:4px 0; font-weight:600; color:var(--fg);
  list-style:none; }
.site-nav summary::-webkit-details-marker { display:none; }
.site-nav summary::before { content:"▸"; display:inline-block; width:1em; color:var(--dim); }
.site-nav details[open] > summary::before { content:"▾"; }
.site-nav .n { color:var(--dim); font-weight:400; font-size:11px; }
.site-nav .nav-mods > .nav-fam > div { padding-left:11px; border-left:1px solid var(--line); }
.site-nav .nav-fam > summary { margin-top:2px; }
.site-nav .nav-mod > summary { font-weight:500; font-size:13px; color:var(--dim); }
.site-nav .nav-mod > summary:hover { color:var(--accent); }
.site-nav .nav-find { margin:10px 0 6px; }
.site-nav .nav-find input { width:100%; font:inherit; font-size:13px; padding:6px 10px;
  border:1px solid var(--line); border-radius:7px; background:var(--card); color:var(--fg); }
.site-nav .nav-find input:focus-visible { outline:2px solid var(--accent); outline-offset:1px;
  border-color:var(--accent); }
.site-nav .nav-empty { color:var(--dim); font-size:12.5px; margin:4px 0 0; }
/* Panneau de résultats — PLUS LARGE que la colonne de navigation : un extrait de
   deux lignes dans 220 px n'apprend rien. Il se superpose au contenu au lieu de
   le pousser, pour que la page ne saute pas sous la frappe.

   Position FIXE, et pas absolue : la colonne de navigation défile toute seule
   (overflow-y:auto), et un enfant positionné y est CLIPPÉ. Le panneau
   existait alors dans le document — on pouvait le mesurer — mais on ne voyait
   que sa première ligne. Un élément fixe échappe au découpage de ses ancêtres ;
   ses coordonnées sont posées à l'ouverture, depuis celles du champ. */
.site-nav .nav-res { position:fixed; z-index:30;
  width:min(460px, 78vw); max-height:min(70vh, 560px); overflow-y:auto;
  background:var(--bg); border:1px solid var(--line); border-radius:10px;
  box-shadow:0 12px 32px rgba(0,0,0,.22); padding:8px; }
.site-nav .nav-res-h { margin:2px 6px 8px; font-size:12px; color:var(--dim); }
.site-nav .res-c { display:block; padding:9px 10px; border-radius:8px; text-decoration:none;
  color:inherit; border:1px solid transparent; }
.site-nav .res-c + .res-c { margin-top:2px; }
.site-nav .res-c:hover, .site-nav .res-c:focus-visible { background:var(--card);
  border-color:var(--line); outline:none; }
.site-nav .res-c:focus-visible { border-color:var(--accent); }
.site-nav .res-t { display:block; font-weight:650; font-size:13.5px; color:var(--accent); }
.site-nav .res-g { display:block; font-size:11.5px; color:var(--dim); margin-top:1px; }
.site-nav .res-x { margin:5px 0 0; font-size:12.5px; line-height:1.5; color:var(--fg); }
.site-nav .res-s { color:var(--dim); }
.site-nav .res-s::after { content:" ›"; }
/* Le surlignage doit rester lisible dans les DEUX thèmes : la balise mark, par
   défaut, pose du jaune vif et garde la couleur de texte héritée — illisible en
   thème sombre. */
.site-nav mark { background:color-mix(in srgb, var(--accent) 26%, transparent);
  color:inherit; border-radius:3px; padding:0 1px; }
/* Dans le TITRE, le texte porte DÉJÀ la couleur d'accent : y peindre un fond
   d'accent donne de l'accent sur de l'accent — mesuré à 4,29:1 en thème sombre,
   sous le seuil AA. Le terme s'y distingue par le trait, pas par la couleur. */
.site-nav .res-t mark { background:none; text-decoration:underline;
  text-underline-offset:2px; font-weight:800; }
@media (max-width:900px) { .site-nav .nav-res { width:min(460px, 92vw); } }
.site-toc .toc-l { text-transform:uppercase; letter-spacing:.07em; font-size:10.5px;
  color:var(--dim); margin:0 0 6px; }
.site-toc ul { list-style:none; margin:0; padding:0; }
.site-toc a { color:var(--dim); text-decoration:none; display:block; padding:3px 0 3px 9px;
  border-left:2px solid transparent; }
.site-toc a:hover { color:var(--accent); border-left-color:var(--accent); }
.site-toc .l3 a { padding-left:20px; font-size:12px; }
.h-anchor { opacity:0; margin-left:8px; color:var(--dim); text-decoration:none; font-weight:400; }
:is(h2,h3,h4,h5,h6):hover .h-anchor { opacity:.6; }
.h-anchor:focus { opacity:1; }
/* Typographie, code, citations et rythme viennent du SOCLE du moteur
   (report.mjs#CSS), comme pour l'accueil et les mesures. Une page de
   documentation s'en écarte sur trois points, parce qu'elle se PARCOURT :
   - le h2 souligné, repère de section quand on fait défiler 300 lignes ;
   - les tableaux bordés, zébrés et pleine largeur (souvent trois colonnes de
     phrases, denses) ;
   - le code en ligne teinté d'accent.
   Les titres partent du même bord que le texte : l'ancienne barre gauche les
   décalait de 16 px par rapport au paragraphe qu'ils coiffent. */
main :is(h2,h3) { margin-top:38px; }
main h1, main h2 { max-width:none; }
main h2 { border-bottom:1px solid var(--line); padding-bottom:.45rem; }
main table { width:100%; max-width:none; }
.nf-card .card-d { font-size:.8125rem; }
main thead th { background:var(--card); font-weight:650; }
main tbody tr:nth-child(even) { background:color-mix(in srgb, var(--card) 55%, transparent); }
main :not(pre) > code { color:var(--accent); }
/* Sans cette règle, les liens du corps gardent le bleu par défaut du navigateur
   (#0000ee) : correct sur blanc, à 1,98:1 sur fond sombre — mesuré sur 16 liens
   d'une seule page. Un lien du contenu porte la couleur d'accent, comme partout. */
main a, .foot a { color:var(--accent); }
main a:hover { text-decoration:underline; }
main a.ext::after { content:"↗"; font-size:.8em; margin-left:2px; opacity:.7; }
main table { border-collapse:collapse; width:100%; margin:16px 0; font-size:13.5px; }
/* Le défilement est porté par l'enveloppe, pas par la table : une zone qui
   défile doit pouvoir être atteinte au clavier (axe : scrollable-region-focusable),
   ce qu'une balise table nue ne permet pas. */
.table-zone { overflow-x:auto; margin:16px 0; }
.table-zone:focus-visible, .schema-zone:focus-visible { outline:2px solid var(--accent);
  outline-offset:2px; }
main th, main td { border:1px solid var(--line); padding:7px 11px; text-align:left; }
main th { background:var(--card); }
.badges { display:flex; gap:7px; flex-wrap:wrap; margin:0 0 22px; }
.badge { font-size:11.5px; padding:3px 10px; border-radius:20px; border:1px solid var(--line);
  color:var(--dim); background:var(--card); }
/* Assombris pour tenir 4,5:1 sur fond clair — les valeurs précédentes
   (#2e9e5b, #b58100) sortaient à 3,41 et 3,9, mesurées par axe-core. */
.badge.ok { color:#1a7040; border-color:#1a7040; }
.badge.warn { color:#8a6200; border-color:#8a6200; }
.nf-cards { display:grid; gap:12px; grid-template-columns:repeat(auto-fill,minmax(250px,1fr));
  margin:18px 0; }
.nf-card { display:flex; flex-direction:column; gap:4px; padding:13px 15px; border-radius:9px;
  border:1px solid var(--line); background:var(--card); text-decoration:none; color:var(--fg); }
a.nf-card:hover { border-color:var(--accent); }
.nf-card.featured { border-left:3px solid var(--accent); }
.nf-card .card-i { font-size:19px; }
.nf-card .card-t { font-weight:650; font-size:14.5px; }
a.nf-card:hover .card-t { color:var(--accent); }
.nf-card .card-d { color:var(--dim); font-size:12.7px; line-height:1.5; }
.nf-card .card-m { color:var(--dim); font-size:11px; font-style:italic; }
.brick { border:1px solid var(--line); border-left:3px solid var(--accent); border-radius:9px;
  margin:16px 0; background:var(--card); }
.brick[id] { scroll-margin-top:76px; }
.brick-h { display:flex; align-items:baseline; gap:11px; flex-wrap:wrap; padding:10px 15px;
  border-bottom:1px solid var(--line); }
.brick-name { font:650 13px ui-monospace,SFMono-Regular,Menlo,monospace; color:var(--accent); }
.brick-t { font-weight:600; }
.brick-b { padding:2px 15px 10px; }
${ADMONITION_CSS}
.srcref { font-size:.8em; vertical-align:super; line-height:0; }
.srcref code { background:transparent; border:0; padding:0; color:var(--dim); }
.d-dark { display:none; }
.badge.ok, .badge.warn { }
:root[data-theme="dark"] .badge.ok { color:#4fc07d; border-color:#4fc07d; }
:root[data-theme="dark"] .badge.warn { color:#e0ab3a; border-color:#e0ab3a; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .badge.ok { color:#4fc07d; border-color:#4fc07d; }
  :root:not([data-theme="light"]) .badge.warn { color:#e0ab3a; border-color:#e0ab3a; }
}
:root[data-theme="dark"] .d-dark { display:block; }
:root[data-theme="dark"] .d-light { display:none; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .d-dark { display:block; }
  :root:not([data-theme="light"]) .d-light { display:none; }
}
/* Le CADRE épouse le schéma, et non l'inverse. Étiré à toute la colonne, un
   schéma de quatre boîtes doublait de taille et ses libellés passaient de
   12,5 px à plus de 20 — des boîtes énormes pour trois mots, vu sur la carte des
   modules. Bridé à sa taille sans toucher au cadre, il flottait au milieu d'un
   cadre à moitié vide. Le cadre prend donc la largeur naturelle du schéma
   (\`--schema-w\`), centré dans la colonne, et ne la dépasse jamais : plus étroite
   que le schéma, la colonne le réduit, cadre compris. Aucune marge intérieure :
   le SVG porte déjà les siennes, et une marge de plus laissait voir son fond
   blanc inscrit dans le cadre gris, comme un second cadre. */
.schema-zone { width:fit-content; max-width:100%; box-sizing:border-box;
  margin:18px auto; padding:0; border:1px solid var(--line); border-radius:9px;
  background:var(--card); overflow-x:auto; }
.schema-zone svg { display:block; height:auto; width:var(--schema-w, 100%); max-width:100%; }
/* Un schéma LARGE (ruban de pipeline, frise) ne se laisse pas réduire jusqu'à
   l'illisible : la colonne de contenu fait ~580 px, et un ruban de 1 758 px y
   tombe à 33 %, où les libellés ne se lisent plus — le lecteur doit alors cliquer
   pour agrandir, ce qui n'est pas lire.

   Plancher de LISIBILITÉ : jamais sous 90 % de la taille naturelle. En deçà, la
   figure DÉFILE — sa zone est focusable, le défilement est donc atteignable au
   clavier. Défiler pour lire vaut mieux que regarder sans lire. Le plancher se
   déduit des polices du moteur (« schemas.mjs ») : 12,5 px pour un nœud, 10,5 px
   pour une étiquette de flèche. À 60 %, ancien plancher, elles tombaient à 7,5 et
   6,3 px — mesuré à l'écran, illisible ; à 90 %, 11,3 et 9,5 px.

   ⚠️ Ne PAS déborder sur les gouttières : la colonne de droite porte le sommaire
   sur toute la hauteur de la page. Une marge négative faisait passer le ruban
   PAR-DESSUS ses entrees — mesure a l'ecran, deux textes superposes. La place
   semblait libre ; elle ne l'etait pas. */
.schema-zone.large { width:100%; }
.schema-zone.large svg { width:100%;
  min-width:calc(var(--schema-w) * 0.9);
  max-width:var(--schema-w); }
pre.raw { white-space:pre-wrap; }
.livegraph { border:1px dashed var(--line); border-left:3px solid var(--accent);
  border-radius:9px; padding:12px 16px; margin:18px 0; background:var(--card); }
.livegraph .lg-t { margin:0 0 4px; font-weight:650; }
.livegraph .lg-hint { margin:0 0 6px; font-size:13.5px; }
.livegraph .lg-note { margin:0; color:var(--dim); font-size:12.5px; }

${STYLE_CODE}`;

/* ════════════════════════════════════════════════════════════════════════════
   6. ASSEMBLAGE
   ════════════════════════════════════════════════════════════════════════════ */

/**
 * Libellé de la section qui porte une page — LE MÊME que celui du menu.
 *
 * Un résultat de recherche doit se situer là où le lecteur ira ensuite : dire
 * « Guides » quand le menu écrit « Guides ». Deux vocabulaires pour un seul
 * endroit, et le lecteur cherche dans le menu une section qui n'y figure pas.
 */
function sectionLabelOf(d) {
  if (d.generated) return API_SECTION.label;
  if (d.source.kind === "module") return d.moduleLabel ?? d.moduleKey ?? "";
  const dir = PUBLIC_DIRS.find((s) => d.relPath.startsWith(`${s.dir}/`));
  return dir ? dir.label : "Pour commencer";
}

/** Le texte cherchable d'une page d'API : les noms de ses symboles. */
const apiSearchText = (body) =>
  [...body.matchAll(/^#### `+([^`]+)`+/gm)].map((m) => m[1]).join(" ");

/**
 * Index de recherche du site — écrit UNE fois, chargé à la demande.
 *
 * Il ne porte que ce que la recherche exploite : l'URL où aller, de quoi
 * afficher un résultat, et la PROSE de la page (`extractSearchText` retire le
 * code, les images et le fil d'Ariane — cf sa documentation). Le corps complet
 * ferait un fichier deux fois plus lourd pour des résultats moins pertinents.
 *
 * @returns la taille écrite, en octets — le compte rendu la dit, parce qu'un
 *   index qui grossit sans qu'on le voie finit par se charger trop lentement.
 */
function writeSearchIndex(published) {
  const docs = published.map((d) => {
    const raw = sourceOf(d);
    const { body } = parseFrontmatter(raw);
    return {
      slug: d.slug,
      // Chemin RELATIF au montage (`guides/x/`), jamais une URL absolue : le
      // site est servi sous un préfixe de dépôt, où un `/guides/` désignerait la
      // racine du domaine. La page qui affiche un résultat y recolle sa propre
      // base (`data-base`) — c'est la même règle que pour tous les liens du site.
      path: d.url.startsWith(`${MOUNT}/`)
        ? d.url.slice(MOUNT.length + 1)
        : d.url,
      lang: pageLanguage(d.meta),
      title: d.title,
      navTitle: d.navTitle ?? d.title,
      sectionLabel: sectionLabelOf(d),
      // Une page d'API se cherche par le NOM de ses symboles : sa prose, déjà
      // portée par le TSDoc, aurait gonflé l'index de 40 % pour un résultat
      // qu'on obtient en tapant le nom.
      body: d.generated ? apiSearchText(body) : extractSearchText(body),
    };
  });
  const json = JSON.stringify({ generatedAt: new Date().toISOString(), docs });
  // Sous le MONTAGE, comme les pages : les URL du site portent ce préfixe, et
  // l'index posé à la racine se cherchait un dossier trop haut — 404, donc
  // « recherche indisponible », sans autre symptôme. Invisible en local, où le
  // site se construit sans montage : la garde de publication l'a trouvé.
  const dossier = path.join(OUT, MOUNT.replace(/^\//, ""));
  mkdirSync(dossier, { recursive: true });
  writeFileSync(path.join(dossier, "search-index.json"), json);
  return Buffer.byteLength(json);
}

/** Auteur du projet, lu au manifeste du cœur — le nom seul, jamais l'adresse. */
const AUTHOR = (() => {
  try {
    const a = JSON.parse(
      readFileSync(path.join(ROOT, "src", "nodefony", "package.json"), "utf8"),
    ).author;
    const name = typeof a === "string" ? a : a?.name;
    return typeof name === "string"
      ? name.replace(/\s*<[^>]*>\s*/, "").trim()
      : undefined;
  } catch {
    return undefined;
  }
})();

/** Titre de chaque page publiée, par adresse — le fil d'Ariane s'y lit. */
let TITLE_BY_URL = null;

/**
 * Le fil d'Ariane d'une page : l'accueil, puis chaque page PUBLIÉE dont
 * l'adresse est un préfixe de la sienne, puis elle-même. Recopié de la
 * hiérarchie réelle, jamais inventé — un niveau sans page est sauté.
 */
function breadcrumbOf(d) {
  if (TITLE_BY_URL === null)
    TITLE_BY_URL = new Map(
      sourcePages.map((p) => [p.url, p.navTitle ?? p.title]),
    );
  const items = [{ name: "Nodefony", url: `${SITE_URL}/` }];
  const parts = d.url.split("/").filter(Boolean);
  for (let k = 1; k < parts.length; k++) {
    const u = `/${parts.slice(0, k).join("/")}/`;
    const t = TITLE_BY_URL.get(u);
    if (t !== undefined) items.push({ name: t, url: `${SITE_URL}${u}` });
  }
  items.push({ name: d.navTitle ?? d.title, url: `${SITE_URL}${d.url}` });
  return items;
}

function renderPage(d, published, index, publishedPaths) {
  const raw = sourceOf(d);
  const bodyRaw = raw.replace(/^---\n[\s\S]*?\n---\n/, "");
  // Le titre vient du chrome : on retire le `# …` de tête pour ne pas le doubler.
  const body = stripLeadingTitle(bodyRaw);

  const fromDir = path.posix.dirname(d.repoRel);
  // 1. ce qui n'aura pas d'URL de site part vers GitHub, tant que c'est un chemin
  const ext = externalizeLinks(sansCommentaires(body), fromDir, publishedPaths);
  // 2. ce qui en aura une devient un chemin relatif vers elle
  const linked = rewriteInternalLinks(ext.markdown, {
    fromDir,
    toSlug: (p) => {
      // Le dossier de performance est publié à côté, par son propre générateur.
      if (p.startsWith("docs/performance/")) return rel(d.url, "/performance/");
      const target = index.get(p);
      return target === undefined ? undefined : rel(d.url, target);
    },
    suffix: "",
  });

  const toc = [];
  const html = decorate(
    anchorHeadings(md.render(linked), { toc, selfLink: true }),
  );

  const meta = d.meta ?? {};
  const badges = [
    meta.status
      ? `<span class="badge ${meta.status === "stable" ? "ok" : "warn"}">${esc(String(meta.status))}</span>`
      : "",
    d.moduleLabel ? `<span class="badge">${esc(d.moduleLabel)}</span>` : "",
    meta.updated
      ? `<span class="badge">mis à jour ${esc(String(meta.updated))}</span>`
      : "",
  ]
    .filter(Boolean)
    .join("");

  // Le résumé de la page — `<meta name="description">`, et l'extrait que cite `llms.txt`.
  const firstText = pageSummary(
    body,
    metaString(d.meta, "description"),
    d.title,
  );

  const canonical = `${SITE_URL}${d.url}`;
  const updated = metaString(d.meta, "updated");
  const lang = pageLanguage(d.meta);
  const page = doc({
    title: d.title,
    lang,
    // L'onglet — et le lien bleu d'un résultat de recherche — porte la marque ;
    // le h1 reste le titre éditorial de la page.
    documentTitle: tabTitle(d.title),
    // La marque en tête ramène à l'accueil du site — le premier geste d'un
    // lecteur perdu, avant même de chercher un menu.
    brand: { ...NODEFONY_BRAND, href: rel(d.url, "/"), version: BADGE },
    head:
      // Description, canonique, aperçu de partage et données structurées :
      // une seule brique pour toutes les pages du site (`lib/seo-head.mjs`),
      // jugée par `check-site-seo.mjs`.
      seoHead({
        title: d.title,
        description: firstText,
        url: canonical,
        lang,
        alternates: d.alternates ?? [],
        noindex: IS_NEXT,
        jsonLd: [
          techArticle({
            title: d.title,
            description: firstText,
            url: canonical,
            siteUrl: SITE_URL,
            lang,
            author: AUTHOR,
            dateModified:
              updated && /^\d{4}-\d{2}-\d{2}$/.test(updated)
                ? updated
                : undefined,
          }),
          breadcrumbList(breadcrumbOf(d)),
        ].filter(Boolean),
      }) +
      "\n" +
      (FAVICON
        ? `<link rel="icon" href="${rel(d.url, "/")}${FAVICON.slice(1)}">\n`
        : "") +
      versionSwitchScript(rel(d.url, "/")) +
      "\n" +
      // Le markdown de la page, servi à côté d'elle : un agent l'obtient sans
      // HTML, en un seul appel, au bon grain. C'est ce qui remplace un
      // `llms-full.txt` de trois mégaoctets — qu'un lecteur tronquerait par le
      // haut, lisant un tiers arbitraire du corpus en croyant l'avoir lu entier.
      `<link rel="alternate" type="text/markdown" href="index.md">`,
    subtitle: badges ? `<span class="badges">${badges}</span>` : "",
    sections: [nextBanner(rel(d.url, "/")), html],
    nav: buildNav(sourcePages, d),
    aside: buildToc(toc),
    style: SITE_CSS,
    footer:
      `Documentation de <strong>Nodefony ${esc(VERSION)}</strong> — page générée depuis ` +
      // Une page de la référence d'API n'a pas de fichier : la lier vers GitHub
      // serait un lien mort. Elle dit d'où elle vient.
      (d.generated
        ? "les déclarations de types publiées "
        : `<a href="${REPO_URL}/blob/${BRANCH}/${esc(d.repoRel)}"><code>${esc(d.repoRel)}</code></a> `) +
      `(<code>${esc(COMMIT)}</code>, ${BUILT_AT}).`,
  });

  const dir = path.join(OUT, d.url.replace(/^\//, ""));
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "index.html"), page);
  // Le markdown porte un en-tête minimal : un agent qui ne reçoit que ce fichier
  // doit savoir de quelle page il s'agit et d'où elle vient. Ses liens sont ceux
  // de la page HTML voisine — même dossier, donc même base relative.
  writeFileSync(
    path.join(dir, "index.md"),
    `---\ntitle: ${JSON.stringify(d.title)}\nsource: ${d.repoRel}\n` +
      `url: ${SITE_URL}${d.url}\n---\n\n${linked}`,
  );
  return {
    bytes: page.length,
    dead: ext.dead,
    diagrams: (body.match(/```mermaid/g) ?? []).length,
  };
}

const docs = await collect();
// En mode aperçu, la page demandée est publiée d'office : on relit justement des
// brouillons, et l'aperçu doit fonctionner AVANT que la page ne soit publiable.
if (ONLY) {
  const target = path.posix.normalize(ONLY.replace(/\\/g, "/"));
  const one = docs.find((d) => d.repoRel === target);
  if (!one) {
    console.error(`✗ page introuvable dans le corpus : ${target}`);
    console.error(
      "  (chemin relatif au dépôt, ex. docs/guides/configuration.md)",
    );
    process.exit(1);
  }
  one.verdict = { ok: true, why: "aperçu (--only)" };
  for (const d of docs)
    if (d !== one) d.verdict = { ok: false, why: "hors aperçu" };
}
const published = docs.filter((d) => d.verdict.ok);
// Les pages dans la langue du corpus : elles font le menu et l'index de
// recherche. Une traduction est publiée (adresse, hreflang) sans apparaître
// dans le menu français — le menu par langue viendra avec la première langue.
const sourcePages = published.filter(
  (d) => pageLanguage(d.meta) === SOURCE_LANGUAGE,
);

// Un ADR ne part qu'une fois marqué (`publish: true`) — et marqué, il doit dire
// son statut et renvoyer au guide du même sujet (`lib/adr-publication.mjs`).
const publishedRepo = new Set(published.map((d) => d.repoRel));
const adrDefects = published
  .filter((d) => d.source.kind === "root" && !d.generated)
  .flatMap((d) =>
    adrPublicationDefects({
      isPublished: (repoRel) => publishedRepo.has(repoRel),
      relPath: d.relPath,
      meta: d.meta,
      body: sourceOf(d).replace(/^---\n[\s\S]*?\n---\n/, ""),
    }).map((defect) => `${d.repoRel} — ${defect}`),
  );
if (adrDefects.length > 0) {
  for (const line of adrDefects) console.error(`✗ ADR publié : ${line}`);
  process.exit(1);
}

// Les pages TRADUITES (`translationOf` au frontmatter, `lib/translations.mjs`) :
// chaque version déclare toutes les autres aux moteurs (`hreflang`), et une
// traduction en retard sur sa source refuse le build.
{
  const authored = published
    .filter((d) => !d.generated)
    .map((d) => ({
      repoRel: d.repoRel,
      url: `${SITE_URL}${d.url}`,
      meta: d.meta,
      d,
    }));
  const stale = staleTranslations(authored, (repoRel) =>
    readFileSync(path.join(ROOT, repoRel), "utf8"),
  );
  if (stale.length > 0) {
    for (const line of stale) console.error(`✗ traduction périmée : ${line}`);
    process.exit(1);
  }
  const groups = translationGroups(authored, { siteUrl: SITE_URL });
  for (const a of authored) a.d.alternates = groups.get(a.url) ?? [];
}

// `--list` : rendre les chemins PUBLIÉS, un par ligne, et s'arrêter là.
//
// Les gates de rédaction (`doc-lint`, `anchor-inpage`) doivent porter sur ce qui
// part chez le lecteur, ni plus ni moins : sur tout le dépôt ils échouent sur des
// documents de pilotage et des fiches générées, qui ne suivent pas le standard ;
// sur une liste écrite à la main, ils dérivent. Cette option évite la troisième
// copie du périmètre en le faisant DIRE par celui qui l'applique.
if (process.argv.includes("--list")) {
  // Une page générée n'a pas de source à relire : les gates la chercheraient
  // sur le disque, où elle n'existe pas.
  for (const d of published) if (!d.generated) console.log(d.repoRel);
  process.exit(0);
}
const rejected = docs.filter((d) => !d.verdict.ok);

if (published.length === 0) {
  console.error(
    "✗ aucune page publiable — rien à publier, on ne rend pas un site vide.",
  );
  process.exit(1);
}
const home = published.find((p) => p.url === `${MOUNT}/`);
if (!home && !ONLY) {
  console.error(
    "✗ le hub d'accueil (docs/index.md) manque — le site n'aurait pas de porte d'entrée.",
  );
  process.exit(1);
}

// Deux pages sur une même adresse : la seconde écraserait la première EN
// SILENCE, et personne ne verrait la page disparue. On refuse de publier.
const seen = new Map();
for (const p of published) {
  const other = seen.get(p.url);
  if (other) {
    console.error(
      `✗ deux pages visent la même adresse ${p.url} :\n    ${other}\n    ${p.repoRel}`,
    );
    process.exit(1);
  }
  seen.set(p.url, p.repoRel);
}

// Index chemin-dépôt → URL : c'est lui qui rend les liens internes navigables.
const index = new Map(published.map((p) => [p.repoRel, p.url]));
const publishedPaths = new Set(index.keys());

// Un dossier réutilisé garde les pages retirées du périmètre — servies, elles
// donnent l'illusion qu'un retrait n'a pas pris. On repart d'un dossier neuf,
// mais on ne vide que ce qu'on reconnaît comme un rendu précédent.
try {
  prepareOutDir(path.join(OUT, MOUNT.replace(/^\//, "")), "search-index.json", {
    protect: ROOT,
  });
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

// L'icône du site — le logo de la marque, extrait de son data-URI. Sans elle,
// chaque visiteur récolte un 404 dans sa console, sur chaque page.
const logo = NODEFONY_BRAND?.logo ?? "";
const m =
  /^data:image\/(png|svg\+xml)(?:;charset=[^,;]+)?(;base64)?,(.*)$/s.exec(logo);
let FAVICON = "";
if (m) {
  const [, kind, b64, payload] = m;
  FAVICON = kind === "png" ? "/favicon.png" : "/favicon.svg";
  writeFileSync(
    path.join(OUT, FAVICON.slice(1)),
    b64 ? Buffer.from(payload, "base64") : decodeURIComponent(payload),
  );
} else {
  console.warn(
    "   ⚠️ logo de marque illisible — pas d'icône de site (404 console sur chaque page).",
  );
}

const searchBytes = writeSearchIndex(sourcePages);

let bytes = 0;
let diagrams = 0;
const dead = [];
for (const d of published) {
  const r = renderPage(d, published, index, publishedPaths);
  bytes += r.bytes;
  diagrams += r.diagrams;
  for (const h of r.dead) dead.push(`${d.repoRel} → ${h}`);
}

// 404 : une URL fautive doit ramener à la porte d'entrée, pas dans le vide.
writeFileSync(
  path.join(OUT, "404.html"),
  doc({
    title: "Page introuvable",
    documentTitle: brandTitle("Page introuvable"),
    subtitle: "Cette adresse ne correspond à aucune page de la documentation.",
    // Servie à la place de n'importe quelle URL fautive : jamais indexée, mais
    // complète comme toute page — un lien mort partagé montre quand même un aperçu.
    head:
      seoHead({
        title: "Page introuvable",
        description:
          "Cette adresse ne correspond à aucune page de la documentation de Nodefony : retour à l'accueil ou au dépôt.",
        url: `${SITE_URL}/404.html`,
        noindex: true,
        jsonLd: webPage({
          title: "Page introuvable",
          description: "Adresse sans page dans la documentation de Nodefony.",
          url: `${SITE_URL}/404.html`,
          siteUrl: SITE_URL,
        }),
      }) + (FAVICON ? `\n<link rel="icon" href="${SITE_URL}${FAVICON}">` : ""),
    sections: [
      // Servie à la place d'une URL quelconque, cette page ne connaît pas sa
      // profondeur : ses liens sont les seuls du site à devoir rester absolus.
      `<p><a href="${SITE_URL}/">Revenir à l'accueil de la documentation</a> — ou consulter ` +
        `<a href="${REPO_URL}">le dépôt sur GitHub</a>.</p>`,
    ],
    style: SITE_CSS,
    footer: `Nodefony ${esc(VERSION)} — ${BUILT_AT}`,
  }),
);

if (!QUIET) {
  const byWhy = new Map();
  for (const r of rejected)
    byWhy.set(r.verdict.why, (byWhy.get(r.verdict.why) ?? 0) + 1);
  console.log(`\n📕 Site de documentation — Nodefony ${VERSION} (${COMMIT})`);
  console.log(`   sortie   : ${OUT}`);
  // L'index de recherche est le seul fichier que le lecteur télécharge en plus
  // des pages : son poids se dit, sinon il grossit sans que personne ne le voie.
  console.log(
    `   recherche: index de ${Math.round(searchBytes / 1024)} Ko (chargé à la première frappe)`,
  );
  console.log(
    `   publiées : ${published.length} pages, ${diagrams} diagrammes, ${Math.round(bytes / 1024)} Ko`,
  );
  const mods = new Set(
    published.filter((p) => p.moduleKey).map((p) => p.moduleKey),
  );
  console.log(
    `              dont ${published.filter((p) => p.moduleKey).length} de ${mods.size} modules`,
  );
  console.log(`   écartées : ${rejected.length} pages`);
  for (const [why, n] of [...byWhy].sort((a, b) => b[1] - a[1]))
    console.log(`              ${String(n).padStart(4)}  ${why}`);
  if (dead.length) {
    console.log(
      `\n   ⚠️ ${dead.length} lien(s) sans cible (ni page publiée, ni fichier du dépôt) :`,
    );
    for (const d of dead.slice(0, 12)) console.log(`      ${d}`);
    if (dead.length > 12)
      console.log(`      … et ${dead.length - 12} autre(s)`);
  }
  console.log("");
}
