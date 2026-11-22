/**
 * Rend l'IMAGE D'APERÇU du site — celle qu'affiche un lien partagé (Open Graph,
 * cartes) : 1200 × 630, PNG (les aperçus refusent le SVG).
 *
 * Elle se rend UNE fois, sur le poste, et se commite (`docs/assets/og-image.png`) :
 * la publication tourne sur une machine sans navigateur, et une image qui
 * change à chaque build ferait recharger l'aperçu partout pour rien. Elle part
 * de la marque (`NODEFONY_BRAND` : logo, couleur, nom) — jamais d'une copie.
 * Le texte se limite à des noms propres et techniques (Node.js, HTTP,
 * WebSocket, CBOR, gRPC, MCP) : il se lit dans toutes les langues du site.
 *
 * Relancer après un changement de marque, puis REGARDER l'image avant de commiter.
 *
 * @usage node scripts/site/render-og-image.mjs [--out docs/assets/og-image.png]
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { NODEFONY_BRAND } from "../../.claude/skills/nodefony-html-report/lib/brand.mjs";
import { REPO_ROOT } from "../lib/repo-root.mjs";

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(
    "usage : node scripts/site/render-og-image.mjs [--out docs/assets/og-image.png]",
  );
  process.exit(0);
}
const i = args.indexOf("--out");
const OUT = path.resolve(
  REPO_ROOT,
  i >= 0 ? args[i + 1] : path.join("docs", "assets", "og-image.png"),
);

/** Dimensions recommandées par Open Graph pour un aperçu large. */
export const OG_IMAGE_SIZE = { width: 1200, height: 630 };

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const { name, logo, accent } = NODEFONY_BRAND;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  body { width: ${OG_IMAGE_SIZE.width}px; height: ${OG_IMAGE_SIZE.height}px; overflow: hidden;
    font-family: "Inter", "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    background: linear-gradient(135deg, #0b1220 0%, #10213d 60%, #0b1220 100%); color: #f1f5f9;
    display: flex; align-items: center; padding: 0 96px; gap: 72px; }
  .logo { width: 190px; height: 302px; flex: none;
    filter: drop-shadow(0 0 40px ${accent}66); }
  h1 { font-size: 104px; font-weight: 800; letter-spacing: -2px; line-height: 1; }
  .what { margin-top: 22px; font-size: 38px; font-weight: 500; color: #cbd5e1; }
  .chips { margin-top: 44px; display: flex; flex-wrap: wrap; gap: 14px; }
  .chip { font-size: 28px; font-weight: 600; padding: 10px 22px; border-radius: 999px;
    background: ${accent}33; border: 2px solid ${accent}; color: #e0f2fe; }
  .url { margin-top: 44px; font-size: 26px; color: #94a3b8; letter-spacing: 0.5px; }
</style></head><body>
  <img class="logo" src="${logo}" alt="">
  <div>
    <h1>${esc(name)}</h1>
    <p class="what">Node.js framework — HTTP &amp; WebSocket</p>
    <div class="chips"><span class="chip">TypeScript</span><span class="chip">CBOR realtime</span><span class="chip">gRPC</span><span class="chip">MCP</span></div>
    <p class="url">nodefony.net</p>
  </div>
</body></html>`;

let playwright;
try {
  playwright = await import("playwright");
} catch {
  console.error(
    "✗ playwright absent — npm i -D playwright (le rendu de l'image en a besoin, la publication non).",
  );
  process.exit(1);
}
const browser = await playwright.chromium
  .launch()
  .catch(() => playwright.chromium.launch({ channel: "chrome" }));
try {
  const page = await browser.newPage({
    viewport: OG_IMAGE_SIZE,
    deviceScaleFactor: 1,
  });
  await page.setContent(html, { waitUntil: "load" });
  mkdirSync(path.dirname(OUT), { recursive: true });
  await page.screenshot({ path: OUT, type: "png" });
  console.log(
    `✓ ${path.relative(REPO_ROOT, OUT)} — ${OG_IMAGE_SIZE.width}×${OG_IMAGE_SIZE.height}`,
  );
} finally {
  await browser.close();
}
