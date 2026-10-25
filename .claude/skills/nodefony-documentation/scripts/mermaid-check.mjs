#!/usr/bin/env node
/**
 * mermaid-check.mjs — chaque schéma du corpus passe-t-il le mermaid de la CONSOLE ?
 *
 * Le site publié rend ses schémas avec son propre moteur (`lib/schemas.mjs`),
 * sans mermaid : une syntaxe que le mermaid de Studio refuse y passe, et ne casse que
 * dans Studio. Vécu : `-->|@services|` — un `@` en tête d'étiquette est lu par
 * mermaid comme un identifiant d'arête, « Parse error » dans la console
 * pendant que le site affichait le schéma. Ce script parse les blocs de toutes
 * les pages suivies par git (archives et retex exclus) avec le mermaid du
 * dépôt, dans Chrome sans interface — le même moteur que `render-figures.mjs`.
 *
 * Code de sortie : 0 si tout passe, 1 sinon (chaque refus nommé avec sa page).
 *
 * @usage node .claude/skills/nodefony-documentation/scripts/mermaid-check.mjs
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { REPO_ROOT } from "../../../../scripts/lib/repo-root.mjs";

const require = createRequire(path.join(REPO_ROOT, "package.json"));
const { chromium } = require("playwright");

const pages = execFileSync("git", ["ls-files", "*.md"], {
  cwd: REPO_ROOT,
  encoding: "utf8",
})
  .split("\n")
  .filter(
    (f) =>
      /(^docs\/|\/docs\/)/.test(f) &&
      !f.includes("archives") &&
      !f.includes("session-retros"),
  );
const blocks = [];
for (const f of pages)
  for (const m of readFileSync(path.join(REPO_ROOT, f), "utf8").matchAll(
    /```mermaid\n([\s\S]*?)```/g,
  ))
    blocks.push({ file: f, source: m[1] });

// Le navigateur du pilote d'abord, sinon celui posé sur le poste.
let browser;
for (const channel of [undefined, "chrome", "msedge"]) {
  try {
    browser = await chromium.launch(channel ? { channel } : {});
    break;
  } catch {
    // moteur absent : essayer le suivant
  }
}
if (browser === undefined) {
  console.error(
    "✗ aucun navigateur — npx playwright install chromium, ou Chrome/Edge installé.",
  );
  process.exit(2);
}
const page = await browser.newPage();
await page.setContent("<html><body></body></html>");
await page.addScriptTag({
  path: require.resolve("mermaid/dist/mermaid.min.js"),
});
const refused = await page.evaluate(async (list) => {
  window.mermaid.initialize({ startOnLoad: false });
  const out = [];
  for (const b of list) {
    try {
      await window.mermaid.parse(b.source);
    } catch (e) {
      const msg = String(e?.message ?? e);
      out.push({
        file: b.file,
        error: msg.split("\n").slice(0, 3).join(" ⏎ "),
      });
    }
  }
  return out;
}, blocks);
await browser.close();

console.log(
  `${blocks.length} schémas dans ${pages.length} pages — ${refused.length} refusé(s) par mermaid`,
);
for (const r of refused) console.log(`❌ ${r.file}\n   ${r.error}`);
process.exit(refused.length === 0 ? 0 : 1);
