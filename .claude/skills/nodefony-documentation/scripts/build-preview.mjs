import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import MarkdownIt from "markdown-it";

// Tout est relatif au dossier de CE script (tmp/doc-corpus/_tools/) — plus aucun
// chemin cloud codé en dur. coverage/ = compteurs générés par gen-counters.mjs ;
// mmd/ = rendu Mermaid intermédiaire.
const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const REPO = execSync("git rev-parse --show-toplevel", {
  encoding: "utf8",
}).trim();
const WORK = path.join(REPO, "tmp/doc-work");
const COVERAGE_DIR = path.join(WORK, "coverage");
const MMD_DIR = path.join(WORK, "mmd");

const SRC = process.argv[2];
const OUT = process.argv[3];
if (!SRC || !OUT) {
  console.error("usage: node build-preview.mjs <src.md> <out.html>");
  process.exit(2);
}
// Provenance RÉELLE (on est en local) — plus de constantes photo.
const git = (cmd) => {
  try {
    return execSync(cmd, { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    return "?";
  }
};
const NF_VERSION = JSON.parse(
  readFileSync(path.join(REPO, "package.json"), "utf8"),
).version;
const NF_BRANCH = git("git branch --show-current"); // {{ branch }} — provider GitService
const NF_COMMIT = git("git rev-parse --short HEAD"); // {{ commit }} — provider GitService
const GEN_DATE = new Date().toISOString().slice(0, 10);
const raw = readFileSync(SRC, "utf8");

const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
const fm = {};
if (m)
  for (const line of m[1].split("\n")) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (kv) fm[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
// Le chrome fournit le titre (H1) + badges ; on retire le `# …` de tête du corps
// pour ne pas doubler le titre (Studio fait pareil via DocPageHeader).
const body = (m ? m[2] : raw).replace(/^\s*#\s+.*\r?\n/, "");

// Fidélité Studio : react-markdown SANS rehype-raw → html:false.
// Coloration syntaxique : highlight.js (déjà dans node_modules), CSS inline
// dual-thème → « le code doit être VISUEL » (standard §6-ergo).
const { default: hljs } = await import("highlight.js/lib/core");
const { default: hlTs } = await import("highlight.js/lib/languages/typescript");
const { default: hlBash } = await import("highlight.js/lib/languages/bash");
const { default: hlYaml } = await import("highlight.js/lib/languages/yaml");
const { default: hlJson } = await import("highlight.js/lib/languages/json");
hljs.registerLanguage("typescript", hlTs);
hljs.registerLanguage("bash", hlBash);
hljs.registerLanguage("yaml", hlYaml);
hljs.registerLanguage("json", hlJson);
const HL_ALIAS = {
  ts: "typescript",
  tsx: "typescript",
  sh: "bash",
  shell: "bash",
  http: "bash",
};
const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  highlight(str, lang) {
    const l = HL_ALIAS[lang] ?? lang;
    if (l && hljs.getLanguage(l)) {
      return hljs.highlight(str, { language: l, ignoreIllegals: true }).value;
    }
    return ""; // fallback markdown-it (échappement standard)
  },
});

// Diagrammes Mermaid → SVG inline, thème NEUTRAL (net, texte sombre) posé sur une
// carte claire dans les DEUX thèmes de page → jamais de texte invisible.
// mmdc (@mermaid-js/mermaid-cli + Chromium) peut être ABSENT en local → mode
// dégradé : le source mermaid est affiché en bloc code avec un avertissement.
mkdirSync(MMD_DIR, { recursive: true });
const MMDC = path.join(REPO, "node_modules/.bin/mmdc");
const HAS_MMDC = existsSync(MMDC);
let mermaidCount = 0;
const render = (n, variant, theme) => {
  const outFile = path.join(MMD_DIR, `d${n}.${variant}.svg`);
  execSync(
    `${MMDC} -i ${path.join(MMD_DIR, `d${n}.mmd`)} -o ${outFile} -b transparent -t ${theme} -p ${path.join(TOOLS, "puppeteer.json")}`,
    { cwd: TOOLS, stdio: "pipe" },
  );
  // Chaque SVG mermaid porte l'id interne "my-svg" (id + sélecteurs <style> + refs
  // gradient/markers). Deux SVG sur la même page → collision de styles (le thème
  // clair repeint les nœuds du sombre). On rend l'id UNIQUE par diagramme+variante.
  const uid = `mmd${n}${variant}`;
  return readFileSync(outFile, "utf8")
    .replace(/<\?xml[^>]*\?>/, "")
    .replace(/<!DOCTYPE[^>]*>/, "")
    .replace(/my-svg/g, uid);
};
const defaultFence = md.renderer.rules.fence.bind(md.renderer.rules);
md.renderer.rules.fence = (tokens, idx, opts, env, self) => {
  const t = tokens[idx];
  if ((t.info || "").trim() === "mermaid") {
    const n = mermaidCount++;
    if (!HAS_MMDC) {
      return `<figure class="diagram"><p style="color:var(--muted);font-size:12px;margin:0 0 8px">⚠️ diagramme non rendu — <code>npm i --no-save @mermaid-js/mermaid-cli</code></p><pre><code>${t.content.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</code></pre></figure>`;
    }
    writeFileSync(path.join(MMD_DIR, `d${n}.mmd`), t.content);
    // dark = thème mermaid `dark` (boîtes sombres, texte clair) ; light = `neutral`.
    const dark = render(n, "dark", "dark");
    const light = render(n, "light", "neutral");
    return `<figure class="diagram" role="img" aria-label="Diagramme"><div class="d d-dark">${dark}</div><div class="d d-light">${light}</div></figure>`;
  }
  return defaultFence(tokens, idx, opts, env, self);
};

let html = md.render(body);

// Tests — compteur + répertoire + couverture (PHOTO, non commitée). Le MD reste
// durable (types + commande) ; les chiffres/listes vivent ici, régénérables.
let metricsHtml = "";
// 1) Compteur + répertoire des tests (tests.<topic>.json)
try {
  const td = JSON.parse(
    readFileSync(path.join(COVERAGE_DIR, `tests.${fm.topic}.json`), "utf8"),
  );
  const cards = (td.counts || [])
    .map(
      (c) =>
        `<div class="mcard"><div class="mv">${c.value}</div><div class="mk">${c.label}</div></div>`,
    )
    .join("");
  const groups = (td.groups || [])
    .map(
      (g) =>
        `<details><summary>${g.type} <span class="gc">(${g.files.length})</span></summary><ul>${g.files.map((f) => `<li><code>${f}</code></li>`).join("")}</ul></details>`,
    )
    .join("");
  metricsHtml += `<h2>Tests — compteur, répertoire &amp; couverture</h2>
<p style="color:var(--muted);font-size:13px">Photo régénérable (cas <code>it()/test()</code> comptés statiquement ; <code>npm run coverage</code>). Non commité — le Markdown reste sans chiffre.</p>
<div class="mrow">${cards}</div>
<p style="margin:.6em 0 .2em;font-weight:600">Répertoire des fichiers de test</p>${groups}`;
} catch {
  /* pas de compteur */
}
// 2) Couverture vitest (json-summary)
let coverageHtml = "";
if (fm.coverageModule) {
  try {
    const cov = JSON.parse(
      readFileSync(
        path.join(COVERAGE_DIR, `${fm.coverageModule}.json`),
        "utf8",
      ),
    );
    const subs = (fm.coverageFiles || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const bar = (p) => {
      const c = p >= 90 ? "#3fb950" : p >= 70 ? "#d29922" : "#f85149";
      return `<span style="display:inline-block;width:70px;height:8px;background:var(--border);border-radius:4px;vertical-align:middle;overflow:hidden"><span style="display:block;width:${p}%;height:100%;background:${c}"></span></span>`;
    };
    const rows = Object.entries(cov)
      .filter(([k]) => k !== "total" && subs.some((s) => k.includes(s)))
      .map(
        ([k, v]) =>
          `<tr><td><code>${k.split("/").pop()}</code></td><td>${bar(v.lines.pct)} ${v.lines.pct}%</td><td>${v.branches.pct}%</td><td>${v.functions.pct}%</td></tr>`,
      )
      .join("");
    const t = cov.total;
    coverageHtml = `<p style="margin:1em 0 .2em;font-weight:600">Couverture (vitest, <code>${fm.coveragePackage || "@nodefony/" + fm.coverageModule}</code>)</p>
<table><thead><tr><th>Fichier</th><th>Lignes</th><th>Branches</th><th>Fonctions</th></tr></thead><tbody>${rows}
<tr><td><strong>module (total)</strong></td><td>${bar(t.lines.pct)} <strong>${t.lines.pct}%</strong></td><td>${t.branches.pct}%</td><td>${t.functions.pct}%</td></tr></tbody></table>`;
  } catch {
    /* pas de rapport dispo → carte omise */
  }
}
html += metricsHtml + coverageHtml;

// Ancres de preuve `fichier.ts:NNN` → références DISCRÈTES (standard §6-ergo) :
// le lecteur voit un texte propre, la preuve reste dans la source MD (gates).
// Ne touche que le code inline des paragraphes (les <pre> ont leur propre balisage).
html = html.replace(
  /<code>([A-Za-z0-9_.\-]+(?:\/[A-Za-z0-9_.\-]+)*\.(?:ts|mjs|tsx):\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)<\/code>/g,
  '<sup class="srcref"><code>$1</code></sup>',
);
// Une parenthèse qui n'enrobe QUE des références devient discrète elle aussi.
html = html.replace(
  /\((<sup class="srcref">.*?<\/sup>(?:(?:,|\s|·)*<sup class="srcref">.*?<\/sup>)*)\)/g,
  '<span class="srcref-group">($1)</span>',
);

const ADM = {
  NOTE: ["note", "Note"],
  TIP: ["tip", "Astuce"],
  IMPORTANT: ["important", "Important"],
  WARNING: ["warning", "Attention"],
  CAUTION: ["caution", "Prudence"],
};
html = html.replace(
  /<blockquote>\s*<p>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/g,
  (_, type) =>
    `<blockquote class="adm adm-${ADM[type][0]}"><p class="adm-title">${ADM[type][1]}</p><p>`,
);

const toc = [];
html = html.replace(/<h2>(.*?)<\/h2>/g, (_, txt) => {
  const id = txt
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\w]+/g, "-")
    .replace(/^-|-$/g, "");
  toc.push({ id, txt: txt.replace(/<[^>]+>/g, "") });
  return `<h2 id="${id}">${txt}</h2>`;
});
const tocHtml = toc.map((t) => `<a href="#${t.id}">${t.txt}</a>`).join("");

// Logo Nodefony (wordmark SVG sobre, inline → autonome).
const LOGO = `<svg width="26" height="26" viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect x="1.5" y="1.5" width="29" height="29" rx="7" stroke="currentColor" stroke-width="2"/><path d="M9 23V9l14 14V9" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const page = `<!doctype html>
<html lang="fr" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${fm.title || "Doc"} — Nodefony</title>
<style>
:root,[data-theme="dark"]{--bg:#0d1117;--panel:#161b22;--border:#30363d;--fg:#e6edf3;--muted:#9198a1;--accent:#58a6ff;--code:#1f2630;--codefg:#ffa657;--th:#161b22;--brand:#161b22}
[data-theme="light"]{--bg:#ffffff;--panel:#f6f8fa;--border:#d0d7de;--fg:#1f2328;--muted:#636c76;--accent:#0969da;--code:#f6f8fa;--codefg:#953800;--th:#eaeef2;--brand:#f6f8fa}
*{box-sizing:border-box}
html{color-scheme:dark light}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.65 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
/* En-tête marque (skill html-report : marque en tête) */
.brand{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:12px;padding:12px 22px;background:var(--brand);border-bottom:1px solid var(--border)}
.brand .logo{display:flex;align-items:center;gap:9px;color:var(--fg);font-weight:700;letter-spacing:.02em}
.brand .tag{color:var(--muted);font-size:13px;border-left:1px solid var(--border);padding-left:12px}
.brand .hchip{font-size:12px;color:var(--muted);background:var(--panel);border:1px solid var(--border);border-radius:20px;padding:2px 10px}
.brand .hchip.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.brand .spacer{flex:1}
@media(max-width:760px){.brand .tag,.brand .hchip{display:none}}
.theme-btn{cursor:pointer;font:inherit;font-size:13px;color:var(--fg);background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:6px 12px}
.theme-btn:hover{border-color:var(--accent);color:var(--accent)}
.theme-btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.wrap{display:grid;grid-template-columns:1fr 230px;gap:40px;max-width:1080px;margin:0 auto;padding:32px 28px 20px}
main{min-width:0}
aside{position:sticky;top:74px;align-self:start;font-size:13px}
aside .lbl{color:var(--muted);text-transform:uppercase;letter-spacing:.06em;font-size:11px;margin-bottom:8px}
aside a{display:block;color:var(--muted);text-decoration:none;padding:4px 0;border-left:2px solid transparent;padding-left:10px}
aside a:hover{color:var(--accent);border-left-color:var(--accent)}
.badges{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 26px}
.badge{font-size:12px;padding:2px 10px;border-radius:20px;border:1px solid var(--border);color:var(--muted)}
.badge.status{color:#3fb950;border-color:#3fb950}
h1{font-size:30px;line-height:1.2;margin:.2em 0 .1em}
h2{font-size:22px;margin:1.8em 0 .6em;padding-bottom:.3em;border-bottom:1px solid var(--border);scroll-margin-top:74px}
h3{font-size:17px;margin:1.4em 0 .4em}
a{color:var(--accent)}
p>code,li>code,td>code{background:var(--code);padding:.15em .4em;border-radius:6px;font-size:.87em;color:var(--codefg);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
pre{background:var(--code);border:1px solid var(--border);border-radius:10px;padding:16px;overflow:auto}
pre code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;color:var(--fg)}
/* Références de preuve (fichier.ts:ligne) — discrètes : la preuve sans le bruit */
.srcref{font-size:0.72em;opacity:.55;vertical-align:super;line-height:0}
.srcref code{background:transparent;padding:0;color:var(--muted);font-size:inherit}
.srcref-group{opacity:.75;font-size:.9em}
.srcref:hover,.srcref-group:hover .srcref{opacity:1}
/* Coloration syntaxique (highlight.js) — palette GitHub, dual-thème */
.hljs-keyword,.hljs-literal,.hljs-type{color:#ff7b72}
.hljs-string,.hljs-regexp{color:#a5d6ff}
.hljs-title,.hljs-title.class_,.hljs-title.function_{color:#d2a8ff}
.hljs-attr,.hljs-attribute,.hljs-variable,.hljs-property{color:#79c0ff}
.hljs-comment,.hljs-quote{color:#8b949e;font-style:italic}
.hljs-number,.hljs-symbol{color:#79c0ff}
.hljs-built_in,.hljs-meta{color:#ffa657}
[data-theme="light"] .hljs-keyword,[data-theme="light"] .hljs-literal,[data-theme="light"] .hljs-type{color:#cf222e}
[data-theme="light"] .hljs-string,[data-theme="light"] .hljs-regexp{color:#0a3069}
[data-theme="light"] .hljs-title,[data-theme="light"] .hljs-title.class_,[data-theme="light"] .hljs-title.function_{color:#8250df}
[data-theme="light"] .hljs-attr,[data-theme="light"] .hljs-attribute,[data-theme="light"] .hljs-variable,[data-theme="light"] .hljs-property{color:#0550ae}
[data-theme="light"] .hljs-comment,[data-theme="light"] .hljs-quote{color:#57606a}
[data-theme="light"] .hljs-number,[data-theme="light"] .hljs-symbol{color:#0550ae}
[data-theme="light"] .hljs-built_in,[data-theme="light"] .hljs-meta{color:#953800}
blockquote{margin:1.2em 0;padding:.6em 1em;border-left:4px solid var(--border);color:var(--muted);background:var(--panel);border-radius:0 8px 8px 0}
.adm .adm-title{margin:0 0 .3em;font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:.04em}
.adm p:not(.adm-title){margin:.2em 0;color:var(--fg)}
.adm-note{border-left-color:#58a6ff}.adm-note .adm-title{color:#58a6ff}
.adm-tip{border-left-color:#3fb950}.adm-tip .adm-title{color:#2da44e}
.adm-important{border-left-color:#a371f7}.adm-important .adm-title{color:#8250df}
.adm-warning{border-left-color:#d29922}.adm-warning .adm-title{color:#bf8700}
.adm-caution{border-left-color:#f85149}.adm-caution .adm-title{color:#cf222e}
table{border-collapse:collapse;width:100%;margin:1.2em 0;font-size:14px}
th,td{border:1px solid var(--border);padding:8px 12px;text-align:left}
th{background:var(--th)}
/* Diagrammes : chaque thème montre SON svg sur une carte de SA couleur */
.diagram{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:18px;margin:1.4em 0;text-align:center;overflow:auto}
.diagram svg{max-width:100%;height:auto}
[data-theme="dark"] .d-light{display:none}
[data-theme="light"] .d-dark{display:none}
.mrow{display:flex;flex-wrap:wrap;gap:12px;margin:1em 0}
.mcard{flex:1 1 140px;background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:12px 14px}
.mcard .mv{font-size:22px;font-weight:700;color:var(--accent)}
.mcard .mk{font-size:12px;color:var(--muted);margin-top:2px}
details{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:8px 12px;margin:6px 0}
details summary{cursor:pointer;font-weight:600;font-size:14px}
details .gc{color:var(--muted);font-weight:400}
details ul{margin:.5em 0 .2em;padding-left:1.2em}
details li{font-size:13px;margin:2px 0}
footer.prov{max-width:1080px;margin:0 auto;padding:18px 28px 44px;color:var(--muted);font-size:12.5px;border-top:1px solid var(--border);display:flex;align-items:center;gap:10px;flex-wrap:wrap}
footer.prov .logo{display:flex;align-items:center;gap:7px;color:var(--muted);font-weight:600}
@media(max-width:860px){.wrap{grid-template-columns:1fr}aside{display:none}}
</style></head>
<body>
<header class="brand">
  <span class="logo">${LOGO} Nodefony</span>
  <span class="tag">Documentation</span>
  <span class="hchip" title="Version du framework ({{ version }})">v${NF_VERSION}</span>
  <span class="hchip" title="Branche git ({{ branch }})">⎇ ${NF_BRANCH}</span>
  <span class="hchip mono" title="Commit git ({{ commit }})">${NF_COMMIT}</span>
  <span class="spacer"></span>
  <button class="theme-btn" id="tt" aria-label="Basculer le thème clair/sombre">Thème : sombre</button>
</header>
<div class="wrap">
<main>
<h1>${fm.title || ""}</h1>
<div class="badges"><span class="badge status">${fm.status || ""}</span><span class="badge">${fm.module || ""}</span><span class="badge">mis à jour ${fm.updated || ""}</span><span class="badge">audience: ${fm.audience || ""}</span></div>
${html}
</main>
<aside><div class="lbl">Sur cette page</div>${tocHtml}</aside>
</div>
<footer class="prov">
  <span class="logo">${LOGO} Nodefony ${NF_VERSION}</span>
  <span>·</span>
  <span>Aperçu généré depuis <code>${fm.source || SRC}</code></span>
  <span>·</span>
  <span>rendu fidèle au portail Studio (react-markdown + remark-gfm + Mermaid 11)</span>
  <span>·</span>
  <span>${GEN_DATE}</span>
</footer>
<script>
(function(){
  var root=document.documentElement, btn=document.getElementById("tt");
  var mq=window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)");
  function set(t){root.setAttribute("data-theme",t);btn.textContent="Thème : "+(t==="dark"?"sombre":"clair");}
  set(mq&&mq.matches?"light":"dark");
  btn.addEventListener("click",function(){set(root.getAttribute("data-theme")==="dark"?"light":"dark");});
})();
</script>
</body></html>`;

writeFileSync(OUT, page);
console.log(
  "OK:",
  OUT,
  page.length,
  "bytes,",
  mermaidCount,
  "diagrammes,",
  toc.length,
  "TOC",
);
