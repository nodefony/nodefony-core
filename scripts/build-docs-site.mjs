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
 *      `publish: false` retire une page publiable, `publish: true` publie une
 *      page qui ne le serait pas. Le contrôle reste là où vit l'auteur.
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
 *   node scripts/build-docs-site.mjs [--out dist-site] [--base ""] [--quiet]
 *
 * Sortie 1 si aucune page n'a pu être rendue, ou si le hub d'accueil manque —
 * un site vide se publierait en silence.
 */
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import MarkdownIt from "markdown-it";

// Le module est consommé par sa SURFACE PUBLIÉE, pas par ses sources : ce
// générateur voit exactement ce que voit une application qui l'installe. En
// échange, il exige que le paquet soit bâti — et le dit, plutôt que de laisser
// un « module introuvable » qu'on impute au mauvais endroit.
const DOC_MODULE = "../src/packages/@nodefony/documentation/dist/index.js";
const docModule = await import(DOC_MODULE).catch(() => {
  console.error(
    "✗ @nodefony/documentation n'est pas bâti — le générateur consomme sa surface publiée.\n" +
      "  npx turbo run build --filter=@nodefony/documentation",
  );
  process.exit(1);
});
const { scanDocsDir, rewriteInternalLinks, metaString } = docModule;
import {
  doc,
  esc,
} from "../.claude/skills/nodefony-html-report/lib/report.mjs";
import { schema } from "../.claude/skills/nodefony-html-report/lib/schemas.mjs";
import { NODEFONY_BRAND } from "../.claude/skills/nodefony-html-report/lib/brand.mjs";
import { slugifyHeading } from "../.claude/skills/nodefony-documentation/lib/slug-heading.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const OUT = path.resolve(ROOT, arg("out", "dist-site"));
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
const SITE_URL = arg("site-url", "https://nodefony.github.io/nodefony-core");

const git = (...a) => {
  try {
    return execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
};
const BRANCH = git("branch", "--show-current") || "main";
const COMMIT = git("rev-parse", "--short", "HEAD") || "?";
const VERSION = JSON.parse(
  readFileSync(path.join(ROOT, "package.json"), "utf8"),
).version;
const BUILT_AT = new Date().toISOString().slice(0, 10);

/* ════════════════════════════════════════════════════════════════════════════
   1. QUI EST PUBLIC — la décision, avant toute lecture
   ════════════════════════════════════════════════════════════════════════════ */

/**
 * Dossiers de `docs/` publiés, dans l'ordre où ils apparaissent dans la
 * navigation. Cet ordre est PÉDAGOGIQUE, pas alphabétique : on découvre, puis
 * on comprend, puis on fait, puis on cherche une décision passée.
 */
const PUBLIC_DIRS = [
  { dir: "architecture", label: "Architecture", icon: "🏛️" },
  { dir: "guides", label: "Guides", icon: "🧭" },
  { dir: "tutoriels", label: "Tutoriels", icon: "🎓" },
];

/** Pages de la racine de `docs/` publiées, dans l'ordre de la navigation. */
const PUBLIC_ROOT_PAGES = new Set(["index.md", "demarrer.md", "lexique.md"]);

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
    match: (p) => p === "MIGRATION_STATUS.md",
    why: "tableau de bord de migration (interne)",
  },
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
    match: (p) => p.startsWith("api/"),
    why: "brouillon d'API souveraine (interne)",
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
 * Tranche le sort d'une page.
 *
 * @param {{source: string, relPath: string, meta: Record<string, unknown>}} d
 * @returns {{ok: boolean, why: string}}
 */
/**
 * Statuts qu'une page doit porter pour être publiée. Un brouillon ou une vision
 * ENGAGE le projet dès qu'il est en ligne : un lecteur ne distingue pas un texte
 * de travail d'une promesse, et le badge ne suffit pas à l'en avertir. Une page
 * SANS statut reste publiée — retirer cinq guides utiles pour un frontmatter
 * incomplet serait une punition, pas une règle — mais elle est signalée.
 */
const PUBLIC_STATUS = new Set(["stable", "accepted"]);

function decide(d) {
  // Le frontmatter a le dernier mot, dans les deux sens.
  const explicit = d.meta?.publish;
  if (explicit === false || explicit === "false")
    return { ok: false, why: "publish: false (décision de la page)" };
  const forced = explicit === true || explicit === "true";

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

/** Modules du dépôt qui portent un dossier `docs/`, avec leur clé courte. */
function moduleDirs() {
  const out = [
    {
      key: "core",
      npm: "nodefony",
      dir: path.join(ROOT, "src/nodefony/docs"),
      label: "nodefony (cœur)",
    },
  ];
  const base = path.join(ROOT, "src/packages/@nodefony");
  for (const name of readdirSync(base).sort()) {
    const dir = path.join(base, name, "docs");
    if (existsSync(dir))
      out.push({
        key: name,
        npm: `@nodefony/${name}`,
        dir,
        label: `@nodefony/${name}`,
      });
  }
  return out;
}

/**
 * Traduit une URL de site (`/adr/`) en chemin RELATIF depuis la page courante
 * (`../../adr/`).
 *
 * Pourquoi ne pas publier des chemins absolus : GitHub Pages sert ce dépôt sous
 * `/nodefony-core/`, et un `/adr/` y désignerait la racine du domaine — donc
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
    : `${d.moduleDir.replace(`${ROOT}/`, "")}/${d.relPath}`;

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
  for (const d of docs) {
    d.repoRel = repoRelOf(d);
    d.verdict = decide(d);
    d.url = urlOf(d);
  }
  return docs;
}

/* ════════════════════════════════════════════════════════════════════════════
   3. RENDU D'UNE PAGE
   ════════════════════════════════════════════════════════════════════════════ */

const md = new MarkdownIt({ html: false, linkify: true, typographer: true });

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
      ${c.desc ? `<span class="card-d">${esc(c.desc)}</span>` : ""}
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
function renderMermaid(source) {
  try {
    const clair = schema({ source, theme: "clair" });
    const sombre = schema({ source, theme: "sombre" });
    return `<figure class="schema-zone" tabindex="0" role="img" aria-label="Diagramme">
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

/**
 * Rend son texte à un fragment de HTML : balises retirées, entités décodées.
 *
 * Les deux sont nécessaires, et l'oubli du second coûtait double. Un titre
 * `mode: "first"` arrive ici en `mode: &quot;first&quot;` : le slug en tirait
 * `mode-quotfirstquot` — une ancre que le sommaire suivait, mais qu'aucun autre
 * outil ne produit — et le sommaire réaffichait `&amp;quot;` en clair, ayant
 * échappé une seconde fois ce qui l'était déjà. 123 titres du corpus étaient
 * dans ce cas.
 */
const ENTITIES = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};
const textOf = (html) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (e) => ENTITIES[e])
    .trim();

/** Titres : `id` posé par la règle de slug commune, et collecté pour le sommaire. */
function withHeadings(html, toc) {
  return html.replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (_, lvl, inner) => {
    const text = textOf(inner);
    const id = slugifyHeading(text);
    toc.push({ lvl: Number(lvl), id, text });
    return `<h${lvl} id="${id}">${inner}<a class="h-anchor" href="#${id}" aria-label="Lien vers cette section">#</a></h${lvl}>`;
  });
}

const ADM = {
  NOTE: ["note", "ℹ️ Note"],
  TIP: ["tip", "💡 Astuce"],
  IMPORTANT: ["important", "❗ Important"],
  WARNING: ["warning", "⚠️ Attention"],
  CAUTION: ["caution", "🛑 Prudence"],
};

/** Enrichissements que markdown-it ne fait pas — tous purement visuels. */
function decorate(html) {
  // Admonitions GitHub (`> [!NOTE]`).
  let out = html.replace(
    /<blockquote>\s*<p>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/g,
    (_, t) =>
      `<blockquote class="adm adm-${ADM[t][0]}"><p class="adm-title">${ADM[t][1]}</p><p>`,
  );
  // Cards de catalogue : `### \`nom\` — titre` devient une brique visuelle.
  out = out.replace(
    /<h3([^>]*)><code>([^<]+)<\/code>\s*(?:—|–|-)?\s*([^<]*)(<a class="h-anchor"[^>]*>#<\/a>)?<\/h3>([\s\S]*?)(?=<h3|<h2|$)/g,
    (_, attrs, name, title, anchor, body) =>
      `<section class="brick"><header class="brick-h"><code class="brick-name">${name}</code><span class="brick-t">${title}</span>${anchor ?? ""}</header><div class="brick-b">${body}</div></section>`,
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
  // Deux syntaxes portent une cible : le lien markdown, et le `"href"` d'un bloc
  // déclaratif (`nodefony-cards`). N'en traiter qu'une laissait les catalogues
  // des hubs pointer vers des `.md` retirés du site — un cul-de-sac par card.
  const out = markdown
    .replace(
      /\]\((?!https?:|mailto:|#)([^)\s]+?)(#[^)\s]*)?\)/g,
      (whole, target, hash = "") => {
        const r = rewrite(whole, target, hash);
        return typeof r === "string" ? r : `](${r.url})`;
      },
    )
    .replace(
      /"href"\s*:\s*"(?!https?:|mailto:|#)([^"\s]+?)"/g,
      (whole, target) => {
        const r = rewrite(whole, target, "");
        return typeof r === "string" ? r : `"href": "${r.url}"`;
      },
    );
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

  const li = (p) =>
    p
      ? `<li data-t="${esc4(p.title.toLowerCase())}"><a href="${rel(current.url, p.url)}"${
          p.url === current.url ? ' aria-current="page"' : ""
        }>${esc4(p.title)}</a></li>`
      : "";

  const group = (label, icon, items, open, cls = "") =>
    items.length
      ? `<details${open ? " open" : ""}${cls ? ` class="${cls}"` : ""}>` +
        `<summary><span aria-hidden="true">${icon}</span> ${esc4(label)} ` +
        `<span class="n">${items.length}</span></summary>` +
        `<ul>${items.map(li).join("")}</ul></details>`
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
    `<div class="nav-find"><input type="search" id="nav-q" placeholder="Filtrer les pages…" ` +
      `aria-label="Filtrer les pages de la documentation" autocomplete="off"></div>` +
      `<p class="nav-empty" hidden>Aucune page ne correspond.</p>`,
  );

  const flat = ["demarrer.md", "lexique.md"].map(rootPage).filter(Boolean);
  if (flat.length)
    parts.push(`<ul class="nav-flat">${flat.map(li).join("")}</ul>`);

  for (const sec of PUBLIC_DIRS) {
    const items = pages.filter(
      (p) => p.source.kind === "root" && p.relPath.startsWith(`${sec.dir}/`),
    );
    const open =
      current.source.kind === "root" &&
      current.relPath.startsWith(`${sec.dir}/`);
    parts.push(group(sec.label, sec.icon, items, open));
  }

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
  parts.push(NAV_FILTER_JS);
  return parts.join("");
}

/**
 * Filtre de la navigation. Il n'indexe rien : chaque `li` porte son titre en
 * minuscules, on compare, on masque. Vider le champ rend l'arbre à son état de
 * départ — et notamment referme ce que la recherche avait ouvert.
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
  q.addEventListener("input",apply);
  q.addEventListener("keydown",function(e){ if(e.key==="Escape"){q.value="";apply();} });
})();
</script>`;

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
.site-nav a { display:block; color:var(--fg); text-decoration:none; padding:3px 8px;
  border-radius:5px; line-height:1.4; }
.site-nav a:hover { background:var(--card); color:var(--accent); }
.site-nav a[aria-current="page"] { background:var(--card); color:var(--accent); font-weight:650; }
.site-nav ul { list-style:none; margin:2px 0 8px; padding-left:10px;
  border-left:1px solid var(--line); }
.site-nav .nav-up { color:var(--dim); font-size:12.5px; padding-left:0; margin-bottom:10px; }
.site-nav .nav-up:hover { color:var(--accent); background:none; }
.site-nav .nav-home { font-weight:700; margin-bottom:8px; padding-left:0; }
.site-nav .nav-home.on { color:var(--accent); }
.site-nav .nav-flat { border:0; padding-left:0; margin-bottom:12px; }
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
.site-toc .toc-l { text-transform:uppercase; letter-spacing:.07em; font-size:10.5px;
  color:var(--dim); margin:0 0 6px; }
.site-toc ul { list-style:none; margin:0; padding:0; }
.site-toc a { color:var(--dim); text-decoration:none; display:block; padding:3px 0 3px 9px;
  border-left:2px solid transparent; }
.site-toc a:hover { color:var(--accent); border-left-color:var(--accent); }
.site-toc .l3 a { padding-left:20px; font-size:12px; }
h2, h3 { scroll-margin-top:72px; }
.h-anchor { opacity:0; margin-left:8px; color:var(--dim); text-decoration:none; font-weight:400; }
h2:hover .h-anchor, h3:hover .h-anchor { opacity:.6; }
.h-anchor:focus { opacity:1; }
/* Une page de documentation n'est pas un rapport : elle se PARCOURT. Sans
   repères colorés, 300 lignes de gris se ressemblent toutes et le lecteur perd
   sa place. Les titres portent donc une barre d'accent, et les repères de
   lecture (code, tableaux, citations) se détachent du fond. */
main :is(h2,h3) { margin-top:38px; }
main h2 { font-size:21px; border-bottom:1px solid var(--line); padding:0 0 8px 12px;
  border-left:4px solid var(--accent); border-radius:2px 0 0 2px; }
main h3 { font-size:16px; padding-left:12px; border-left:3px solid var(--line); }
main h3:hover { border-left-color:var(--accent); }
main > p:first-of-type { font-size:15.5px; color:var(--fg); }
main blockquote { margin:18px 0; padding:10px 16px; border-left:4px solid var(--accent);
  background:var(--card); border-radius:0 8px 8px 0; }
main blockquote p { margin:4px 0; }
main thead th { background:var(--card); font-weight:650; }
main tbody tr:nth-child(even) { background:color-mix(in srgb, var(--card) 55%, transparent); }
main :not(pre) > code { color:var(--accent); }
main strong { font-weight:650; }
main hr { border:0; border-top:1px solid var(--line); margin:34px 0; }
main p, main li { font-size:14.5px; }
/* Sans cette règle, les liens du corps gardent le bleu par défaut du navigateur
   (#0000ee) : correct sur blanc, à 1,98:1 sur fond sombre — mesuré sur 16 liens
   d'une seule page. Un lien du contenu porte la couleur d'accent, comme partout. */
main a, .foot a { color:var(--accent); }
main a:hover { text-decoration:underline; }
main a.ext::after { content:"↗"; font-size:.8em; margin-left:2px; opacity:.7; }
main pre { background:var(--card); border:1px solid var(--line); border-radius:8px;
  padding:14px; overflow-x:auto; }
main pre code { font:12.7px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace; }
main :not(pre) > code { background:var(--card); border:1px solid var(--line);
  border-radius:4px; padding:.08em .34em; font-size:.88em; }
main table { border-collapse:collapse; width:100%; margin:16px 0; font-size:13.5px; }
/* Le défilement est porté par l'enveloppe, pas par la table : une zone qui
   défile doit pouvoir être atteinte au clavier (axe : scrollable-region-focusable),
   ce qu'une balise table nue ne permet pas. */
.table-zone { overflow-x:auto; margin:16px 0; }
.table-zone:focus-visible, .schema-zone:focus-visible { outline:2px solid var(--accent);
  outline-offset:2px; }
main th, main td { border:1px solid var(--line); padding:7px 11px; text-align:left; }
main th { background:var(--card); }
main img { max-width:100%; height:auto; }
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
.brick-h { display:flex; align-items:baseline; gap:11px; flex-wrap:wrap; padding:10px 15px;
  border-bottom:1px solid var(--line); }
.brick-name { font:650 13px ui-monospace,SFMono-Regular,Menlo,monospace; color:var(--accent); }
.brick-t { font-weight:600; }
.brick-b { padding:2px 15px 10px; }
/* Admonitions. Les couleurs sont des VARIABLES parce qu'elles doivent tenir
   4,5:1 dans les DEUX thèmes : la teinte qui porte un titre sur blanc est trop
   sombre sur fond noir, et l'inverse. Chaque valeur ci-dessous a été mesurée par
   axe-core, jamais choisie à l'œil. */
:root { --adm-note:#1c62c4; --adm-tip:#1a7040; --adm-important:#6a3bbf;
  --adm-warning:#7a5800; --adm-caution:#c0322a; }
:root[data-theme="dark"] { --adm-note:#78b6ff; --adm-tip:#4fc07d; --adm-important:#c7a4ff;
  --adm-warning:#e0ab3a; --adm-caution:#ff8a80; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { --adm-note:#78b6ff; --adm-tip:#4fc07d;
    --adm-important:#c7a4ff; --adm-warning:#e0ab3a; --adm-caution:#ff8a80; }
}
.adm { border-left:4px solid var(--line); background:var(--card); border-radius:0 8px 8px 0;
  padding:9px 14px; margin:16px 0; }
.adm .adm-title { margin:0 0 3px; font-weight:700; font-size:12px; text-transform:uppercase;
  letter-spacing:.04em; }
.adm-note { border-left-color:var(--adm-note); } .adm-note .adm-title { color:var(--adm-note); }
.adm-tip { border-left-color:var(--adm-tip); } .adm-tip .adm-title { color:var(--adm-tip); }
.adm-important { border-left-color:var(--adm-important); }
.adm-important .adm-title { color:var(--adm-important); }
.adm-warning { border-left-color:var(--adm-warning); }
.adm-warning .adm-title { color:var(--adm-warning); }
.adm-caution { border-left-color:var(--adm-caution); }
.adm-caution .adm-title { color:var(--adm-caution); }
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
.schema-zone { margin:18px 0; padding:12px; border:1px solid var(--line); border-radius:9px;
  background:var(--card); overflow-x:auto; }
/* Le SVG occupe toute la largeur de son cadre. Il porte une zone de vue, donc il
   s'échelonne sans se déformer — traits et libellés grandissent ensemble. Sans
   cette règle il gardait sa largeur naturelle, calculée par le moteur, et
   flottait dans un cadre bien plus large que lui. */
.schema-zone svg { display:block; width:100%; height:auto; }
pre.raw { white-space:pre-wrap; }
.livegraph { border:1px dashed var(--line); border-left:3px solid var(--accent);
  border-radius:9px; padding:12px 16px; margin:18px 0; background:var(--card); }
.livegraph .lg-t { margin:0 0 4px; font-weight:650; }
.livegraph .lg-hint { margin:0 0 6px; font-size:13.5px; }
.livegraph .lg-note { margin:0; color:var(--dim); font-size:12.5px; }
`;

/* ════════════════════════════════════════════════════════════════════════════
   6. ASSEMBLAGE
   ════════════════════════════════════════════════════════════════════════════ */

function renderPage(d, published, index, publishedPaths) {
  const raw = readFileSync(d.absPath, "utf8");
  const bodyRaw = raw.replace(/^---\n[\s\S]*?\n---\n/, "");
  // Le titre vient du chrome : on retire le `# …` de tête pour ne pas le doubler.
  const body = bodyRaw.replace(/^\s*#\s+.*\r?\n/, "");

  const fromDir = path.posix.dirname(d.repoRel);
  // 1. ce qui n'aura pas d'URL de site part vers GitHub, tant que c'est un chemin
  const ext = externalizeLinks(body, fromDir, publishedPaths);
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
  const html = decorate(withHeadings(md.render(linked), toc));

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

  // Première phrase de la page, ou son titre — c'est l'extrait qu'un moteur de
  // recherche montrera. Sans elle, il en invente un, souvent une ligne de code.
  // L'extrait qu'un moteur de recherche montrera. À défaut, il en invente un —
  // souvent le fil d'Ariane ou une ligne de code, ce qui ne dit rien de la page.
  // L'intro d'une page de ce corpus est fréquemment une CITATION (le résumé en
  // tête), d'où le `>` retiré plutôt que la ligne écartée.
  const prose = body
    .replace(/```[\s\S]*?```/g, "") // un bloc de code n'est pas une phrase
    .replace(/^\s*>\s?\[!.*$/gm, "") // ni le marqueur d'une admonition
    .replace(/^\s*>\s?/gm, ""); // une citation, si : c'est souvent le résumé
  const firstText = (
    metaString(d.meta, "description") ??
    prose
      .split("\n")
      .map((l) => l.trim())
      .find(
        (l) =>
          l.length > 30 &&
          !/^[#|\-*[\d]/.test(l) &&
          !l.includes("›") && // fil d'Ariane
          !l.startsWith("!["), // image seule
      ) ??
    d.title
  )
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // les liens gardent leur texte
    .replace(/[*`_]/g, "")
    .trim()
    .slice(0, 180);

  const page = doc({
    title: d.title,
    // La marque en tête ramène à l'accueil du site — le premier geste d'un
    // lecteur perdu, avant même de chercher un menu.
    brand: { ...NODEFONY_BRAND, href: rel(d.url, "/") },
    head:
      `<meta name="description" content="${esc(firstText)}">\n` +
      (FAVICON
        ? `<link rel="icon" href="${rel(d.url, "/")}${FAVICON.slice(1)}">\n`
        : "") +
      `<link rel="canonical" href="${SITE_URL}${esc(d.url)}">`,
    subtitle: badges ? `<span class="badges">${badges}</span>` : "",
    sections: [html],
    nav: buildNav(published, d),
    aside: buildToc(toc),
    style: SITE_CSS,
    footer:
      `Documentation de <strong>Nodefony ${esc(VERSION)}</strong> — page générée depuis ` +
      `<a href="${REPO_URL}/blob/${BRANCH}/${esc(d.repoRel)}"><code>${esc(d.repoRel)}</code></a> ` +
      `(<code>${esc(COMMIT)}</code>, ${BUILT_AT}).`,
  });

  const dir = path.join(OUT, d.url.replace(/^\//, ""));
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "index.html"), page);
  return {
    bytes: page.length,
    dead: ext.dead,
    diagrams: (body.match(/```mermaid/g) || []).length,
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
    subtitle: "Cette adresse ne correspond à aucune page de la documentation.",
    head: FAVICON ? `<link rel="icon" href="${SITE_URL}${FAVICON}">` : "",
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

// Un dossier de sortie réutilisé conserve les pages retirées du périmètre : en
// local, elles restent servies et donnent l'illusion qu'un retrait n'a pas pris.
// On ne supprime rien — le chemin vient de l'appelant — mais on le DIT.
const written = new Set(
  published.map((p) => path.join(OUT, p.url.replace(/^\//, ""), "index.html")),
);
written.add(path.join(OUT, "404.html"));
const stale = [];
const sweep = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) sweep(full);
    else if (e.name.endsWith(".html") && !written.has(full))
      stale.push(path.relative(OUT, full));
  }
};
sweep(OUT);

if (!QUIET) {
  const byWhy = new Map();
  for (const r of rejected)
    byWhy.set(r.verdict.why, (byWhy.get(r.verdict.why) ?? 0) + 1);
  console.log(`\n📕 Site de documentation — Nodefony ${VERSION} (${COMMIT})`);
  console.log(`   sortie   : ${OUT}`);
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
  if (stale.length) {
    console.log(
      `\n   ⚠️ ${stale.length} page(s) d'une génération PRÉCÉDENTE encore dans ${path.relative(ROOT, OUT)} —`,
    );
    console.log(
      "      elles seraient servies alors qu'elles ne sont plus publiées :",
    );
    for (const f of stale.slice(0, 8)) console.log(`      ${f}`);
    if (stale.length > 8)
      console.log(`      … et ${stale.length - 8} autre(s)`);
  }
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
