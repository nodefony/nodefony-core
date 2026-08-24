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

import {
  scanDocsDir,
  rewriteInternalLinks,
  metaString,
} from "../src/packages/@nodefony/documentation/dist/index.js";
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
  { dir: "adr", label: "Décisions (ADR)", icon: "⚖️" },
  { dir: "ia", label: "Couche IA", icon: "🤖" },
  { dir: "api", label: "API", icon: "🔌" },
  { dir: "skills", label: "Outillage agent", icon: "🛠️" },
];

/** Pages de la racine de `docs/` publiées, dans l'ordre de la navigation. */
const PUBLIC_ROOT_PAGES = [
  "index.md",
  "demarrer.md",
  "outillage-agents.md",
  "lexique.md",
];

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
];

/**
 * Tranche le sort d'une page.
 *
 * @param {{source: string, relPath: string, meta: Record<string, unknown>}} d
 * @returns {{ok: boolean, why: string}}
 */
function decide(d) {
  // Le frontmatter a le dernier mot, dans les deux sens.
  const explicit = d.meta?.publish;
  if (explicit === false || explicit === "false")
    return { ok: false, why: "publish: false (décision de la page)" };
  const forced = explicit === true || explicit === "true";

  if (d.source.kind !== "root")
    return { ok: true, why: "documentation d'un module" };

  const rel = d.relPath;
  const priv = PRIVATE.find((r) => r.match(rel));
  if (priv && !forced) return { ok: false, why: priv.why };
  if (forced) return { ok: true, why: "publish: true (décision de la page)" };

  const top = rel.includes("/") ? rel.slice(0, rel.indexOf("/")) : null;
  if (top === null)
    return PUBLIC_ROOT_PAGES.includes(rel)
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
    ? `/${tail}`
    : `/modules/${d.moduleKey}/${tail}`;
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

const baseFence = md.renderer.rules.fence.bind(md.renderer.rules);
md.renderer.rules.fence = (tokens, idx, opts, env, self) => {
  const info = (tokens[idx].info || "").trim();
  if (info === "mermaid") return renderMermaid(tokens[idx].content);
  if (info === "nodefony-cards") return renderCards(tokens[idx].content);
  return baseFence(tokens, idx, opts, env, self);
};

/** Titres : `id` posé par la règle de slug commune, et collecté pour le sommaire. */
function withHeadings(html, toc) {
  return html.replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (_, lvl, inner) => {
    const text = inner.replace(/<[^>]+>/g, "").trim();
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
  const out = markdown.replace(
    /\]\((?!https?:|mailto:|#)([^)\s]+?)(#[^)\s]*)?\)/g,
    (whole, target, hash = "") => {
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
      return `](${REPO_URL}/${kind}/${BRANCH}/${clean}${hash})`;
    },
  );
  return { markdown: out, dead };
}

/* ════════════════════════════════════════════════════════════════════════════
   4. NAVIGATION — un arbre replié, sans une ligne de JavaScript
   ════════════════════════════════════════════════════════════════════════════ */

function buildNav(pages, current) {
  const home = pages.find((p) => p.url === "/");
  const rootPage = (file) =>
    pages.find((p) => p.source.kind === "root" && p.relPath === file);
  const li = (p) =>
    p
      ? `<li><a href="${rel(current.url, p.url)}"${p.url === current.url ? ' aria-current="page"' : ""}>${esc(p.title)}</a></li>`
      : "";

  const group = (label, icon, items, open) =>
    items.length
      ? `<details${open ? " open" : ""}><summary><span aria-hidden="true">${icon}</span> ${esc(label)} <span class="n">${items.length}</span></summary><ul>${items.map(li).join("")}</ul></details>`
      : "";

  const parts = [];
  parts.push(
    `<a class="nav-home${current.url === "/" ? " on" : ""}" href="${rel(current.url, "/")}">${esc(home?.title ?? "Documentation")}</a>`,
  );
  const flat = ["demarrer.md", "outillage-agents.md", "lexique.md"]
    .map(rootPage)
    .filter(Boolean);
  if (flat.length)
    parts.push(`<ul class="nav-flat">${flat.map(li).join("")}</ul>`);

  for (const s of PUBLIC_DIRS) {
    const items = pages.filter(
      (p) => p.source.kind === "root" && p.relPath.startsWith(`${s.dir}/`),
    );
    const open =
      current.source.kind === "root" && current.relPath.startsWith(`${s.dir}/`);
    parts.push(group(s.label, s.icon, items, open));
  }

  const mods = [
    ...new Set(pages.filter((p) => p.moduleKey).map((p) => p.moduleKey)),
  ];
  const modItems = mods.map((key) => {
    const items = pages.filter((p) => p.moduleKey === key);
    const label = items[0].moduleLabel;
    const open = current.moduleKey === key;
    return group(label, "📦", items, open);
  });
  parts.push(
    `<details class="nav-mods"${current.moduleKey ? " open" : ""}><summary><span aria-hidden="true">🧱</span> Modules <span class="n">${mods.length}</span></summary><div>${modItems.join("")}</div></details>`,
  );
  return parts.join("");
}

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
.site-nav .nav-home { font-weight:700; margin-bottom:8px; padding-left:0; }
.site-nav .nav-home.on { color:var(--accent); }
.site-nav .nav-flat { border:0; padding-left:0; margin-bottom:12px; }
.site-nav summary { cursor:pointer; padding:4px 0; font-weight:600; color:var(--fg);
  list-style:none; }
.site-nav summary::-webkit-details-marker { display:none; }
.site-nav summary::before { content:"▸"; display:inline-block; width:1em; color:var(--dim); }
.site-nav details[open] > summary::before { content:"▾"; }
.site-nav .n { color:var(--dim); font-weight:400; font-size:11px; }
.site-nav .nav-mods > div { padding-left:12px; border-left:1px solid var(--line); }
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
main :is(h2,h3) { margin-top:34px; }
main h2 { border-bottom:1px solid var(--line); padding-bottom:6px; }
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
.badge { font-size:11.5px; padding:2px 9px; border-radius:20px; border:1px solid var(--line);
  color:var(--dim); }
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
pre.raw { white-space:pre-wrap; }
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
          !/^!\[/.test(l), // image seule
      ) ??
    d.title
  )
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // les liens gardent leur texte
    .replace(/[*`_]/g, "")
    .trim()
    .slice(0, 180);

  const page = doc({
    title: d.title,
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
      `(<code>${esc(COMMIT)}</code>, ${BUILT_AT}). ` +
      `<a href="${REPO_URL}/edit/${BRANCH}/${esc(d.repoRel)}">Corriger cette page</a>.`,
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
const published = docs.filter((d) => d.verdict.ok);
const rejected = docs.filter((d) => !d.verdict.ok);

if (published.length === 0) {
  console.error(
    "✗ aucune page publiable — rien à publier, on ne rend pas un site vide.",
  );
  process.exit(1);
}
const home = published.find((p) => p.url === "/");
if (!home) {
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
