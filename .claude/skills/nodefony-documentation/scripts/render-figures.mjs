#!/usr/bin/env node
/**
 * Rend les figures mermaid d'une page COMME LE LECTEUR LES VOIT, dans les deux
 * moteurs, et les dépose en images — pour les REGARDER avant de dire « fait ».
 *
 * Pourquoi : une figure se juge à l'image, jamais à sa source. Une page a été
 * livrée avec des courbes presque invisibles dans la console, des organigrammes
 * réduits à un texte illisible et des échelles fausses — tous ses contrôles
 * étaient verts, parce qu'aucun ne regardait le rendu.
 *
 * Les deux moteurs ne dessinent pas pareil, d'où deux rendus :
 * - **console** (Studio) : mermaid 11 dans Chrome sans interface, colonne de
 *   860 px, et la même règle d'échelle que `MarkdownDoc.tsx` (`.nf-mermaid >
 *   svg` : largeur de la colonne, hauteur plafonnée à 60 % de l'écran) ;
 * - **site** : la page rendue par `scripts/site/build-docs-site.mjs --only`,
 *   photographiée figure par figure dans un écran de 1440 px.
 *
 * Limite : la console est REPRODUITE (même mermaid, même règle CSS, thème
 * clair), pas lancée. Le thème sombre et le reste de l'application n'y sont pas.
 *
 * Usage : node render-figures.mjs <page.md> [--console-seulement]
 * Sortie : tmp/reports/figures-<page>/console-N.png et site-N.png, et pour
 *          chaque figure sa taille affichée — à ouvrir et à REGARDER.
 * Prérequis : `playwright` (dépendance du dépôt) et Chrome installé.
 */
import { mkdirSync, readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync, execSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** Le `index.html` rendu pour la page : un dossier nommé d'après elle, sous l'artefact du site. */
function chercherPage(racine, nom) {
  if (!existsSync(racine)) return null;
  for (const e of readdirSync(racine, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const dossier = path.join(racine, e.name);
    if (e.name === nom && existsSync(path.join(dossier, "index.html")))
      return path.join(dossier, "index.html");
    const plus = chercherPage(dossier, nom);
    if (plus) return plus;
  }
  return null;
}

const REPO = execSync("git rev-parse --show-toplevel", {
  encoding: "utf8",
}).trim();
const [pageArg, ...flags] = process.argv.slice(2);
if (!pageArg) {
  console.error(
    "usage : node render-figures.mjs <page.md> [--console-seulement]",
  );
  process.exit(64);
}
const page = path.resolve(pageArg);
const rel = path.relative(REPO, page).split(path.sep).join("/");
const slug = path.basename(page, ".md");
const out = path.join(REPO, "tmp", "reports", `figures-${slug}`);
mkdirSync(out, { recursive: true });

const require = createRequire(path.join(REPO, "package.json"));
const pw = await import(pathToFileURL(require.resolve("playwright")).href);
const chromium = pw.chromium ?? pw.default.chromium;
const mermaidJs = require.resolve("mermaid/dist/mermaid.min.js");

const md = readFileSync(page, "utf8");
const blocs = [...md.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1]);
const browser = await chromium.launch({ channel: "chrome", headless: true });

try {
  // ── La console : mermaid + la règle d'échelle de MarkdownDoc ──────────────
  const vue = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await vue.setContent(
    `<html><body style="font-family:system-ui;background:#fff;margin:16px">` +
      `<div id="col" style="max-width:860px;font-size:15px"></div>` +
      `<style>.nf-mermaid>svg{max-width:100%!important;max-height:60dvh;width:auto;height:auto}</style>` +
      `</body></html>`,
  );
  await vue.addScriptTag({ path: mermaidJs });
  console.log(`console (Studio reproduit) — ${blocs.length} figure(s)`);
  for (const [i, code] of blocs.entries()) {
    const erreur = await vue.evaluate(
      async ({ code, i }) => {
        const m = window.mermaid;
        m.initialize({
          startOnLoad: false,
          theme: "default",
          securityLevel: "strict",
          fontFamily: "inherit",
        });
        try {
          const { svg } = await m.render(`m${i}`, code);
          document.getElementById("col").innerHTML =
            `<div class="nf-mermaid" id="d${i}">${svg}</div>`;
          return null;
        } catch (e) {
          return String(e?.message ?? e).split("\n")[0];
        }
      },
      { code, i },
    );
    if (erreur) {
      console.log(`  ❌ ${i + 1} — mermaid refuse : ${erreur}`);
      continue;
    }
    const el = await vue.$(`#d${i}`);
    const fichier = path.join(out, `console-${i + 1}.png`);
    await el.screenshot({ path: fichier });
    const b = await el.boundingBox();
    console.log(
      `  ${i + 1}  ${Math.round(b.width)} × ${Math.round(b.height)}  ${path.relative(REPO, fichier)}`,
    );
  }

  // ── Le site : la page réellement rendue par le générateur ─────────────────
  if (!flags.includes("--console-seulement")) {
    execFileSync(
      process.execPath,
      ["scripts/site/build-docs-site.mjs", "--only", rel],
      {
        cwd: REPO,
        stdio: "ignore",
      },
    );
    const trouve = chercherPage(path.join(REPO, "tmp", "sites", "docs"), slug);
    if (!trouve) throw new Error(`page rendue introuvable pour ${slug}`);
    const site = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    await site.goto(pathToFileURL(trouve).href);
    const figures = await site.$$("figure.schema-zone");
    const brutes = await site.$$("pre.raw");
    console.log(
      `site — ${figures.length} figure(s) dessinée(s), ${brutes.length} en source brute`,
    );
    for (const [i, f] of figures.entries()) {
      const fichier = path.join(out, `site-${i + 1}.png`);
      await f.screenshot({ path: fichier });
      const b = await f.boundingBox();
      console.log(
        `  ${i + 1}  ${Math.round(b.width)} × ${Math.round(b.height)}  ${path.relative(REPO, fichier)}`,
      );
    }
  }
} finally {
  await browser.close();
}
console.log(
  "\n→ OUVRIR et REGARDER chaque image : un contrôle vert ne dit rien de ce que voit le lecteur.",
);
