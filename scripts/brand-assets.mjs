/**
 * brand-assets.mjs — dérive le PNG et le favicon du logo depuis sa source SVG.
 *
 * Le logo n'existe qu'à UN endroit sous forme éditable :
 * `src/nodefony/assets/nodefony-logo.svg`. Ce script le rastérise par Chromium
 * (Playwright, dépendance de développement du dépôt) et écrit, à côté :
 *
 *   - `nodefony-logo.png` — 256 pixels de haut, fond transparent ;
 *   - `favicon.ico`       — trois images carrées de 16, 32 et 48 pixels ;
 *   - `brand-assets.json` — l'empreinte SHA-256 de la source et de chaque dérivé.
 *
 * Le manifeste est ce que vérifie `src/nodefony/src/tests/brandAssets.test.ts` :
 * un SVG modifié sans relancer ce script, ou un dérivé retouché à la main, y
 * tombe. La rastérisation, elle, n'est pas reproductible octet pour octet d'une
 * version de Chromium à l'autre — c'est pourquoi le test compare des empreintes
 * ENREGISTRÉES au lieu de rastériser à son tour.
 *
 *   node scripts/brand-assets.mjs
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { pngToIco } from "../src/nodefony/src/cli/scaffold/brandAssets.ts";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const assetsDir = path.join(repoRoot, "src", "nodefony", "assets");
const SVG = "nodefony-logo.svg";
const LOGO_HEIGHT = 256;
const FAVICON_SIZES = [16, 32, 48];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const svg = readFileSync(path.join(assetsDir, SVG), "utf8");
const viewBox = /viewBox="([^"]+)"/u.exec(svg)?.[1].split(/\s+/u).map(Number);
if (viewBox?.length !== 4 || viewBox.some(Number.isNaN)) {
  throw new Error(`${SVG} : viewBox absent ou illisible`);
}
const ratio = viewBox[2] / viewBox[3];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

/**
 * Rastérise le SVG dans un cadre `width`×`height`, logo centré à la hauteur
 * du cadre, fond transparent.
 */
async function rasterize(width, height) {
  const sized = svg.replace(
    "<svg ",
    `<svg width="${String(width)}" height="${String(height)}" preserveAspectRatio="xMidYMid meet" style="display:block" `,
  );
  await page.setViewportSize({ width, height });
  await page.setContent(
    `<!doctype html><html><body style="margin:0;background:transparent">${sized}</body></html>`,
  );
  return page.screenshot({
    omitBackground: true,
    clip: { x: 0, y: 0, width, height },
  });
}

const logo = await rasterize(Math.round(LOGO_HEIGHT * ratio), LOGO_HEIGHT);
const favicons = [];
for (const size of FAVICON_SIZES) favicons.push(await rasterize(size, size));
const renderer = `${browser.browserType().name()} ${browser.version()}`;
await browser.close();

const ico = Buffer.from(pngToIco(...favicons));
const derived = {
  "nodefony-logo.png": logo,
  "favicon.ico": ico,
};
for (const [name, bytes] of Object.entries(derived)) {
  writeFileSync(path.join(assetsDir, name), bytes);
}
const manifest = {
  source: { file: SVG, sha256: sha256(svg) },
  derived: Object.fromEntries(
    Object.entries(derived).map(([name, bytes]) => [
      name,
      { sha256: sha256(bytes), bytes: bytes.length },
    ]),
  ),
  logoHeight: LOGO_HEIGHT,
  faviconSizes: FAVICON_SIZES,
  renderer,
  command: "node scripts/brand-assets.mjs",
};
writeFileSync(
  path.join(assetsDir, "brand-assets.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(
  `✓ ${SVG} → nodefony-logo.png (${String(Math.round(LOGO_HEIGHT * ratio))}×${String(LOGO_HEIGHT)}, ${String(logo.length)} o) · favicon.ico (${FAVICON_SIZES.join("/")} px, ${String(ico.length)} o) · ${renderer}`,
);
