import { expect } from "chai";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ViteBuilder from "../../src/builders/ViteBuilder.js";
import TemplateHelper from "../../src/template/TemplateHelper.js";
import type { IResolvedFrontendEntry } from "../../interfaces/IFrontBuilder.js";

/**
 * P14.5 — build production + `renderProdTags`.
 *
 * Couvre : (1) un VRAI `vite.build` écrit un manifest fingerprinté dans
 * `outDir/.vite/`, avec `base = publicPath` ; (2) `renderProdTags` lit ce
 * manifest et injecte `<script>`/`<link>` préfixés — fin de la PAGE BLANCHE en
 * prod ; (3) manifest absent → commentaire (pas de crash) ; (4) CSS + preload.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(__dirname, "../fixtures/minimal-frontend");
const OUT_DIR = path.resolve(FIXTURE_ROOT, "build-test-dist");
const PUBLIC_PATH = "/_assets/fixture/";

function makeEntry(
  overrides: Partial<IResolvedFrontendEntry> = {},
): IResolvedFrontendEntry {
  return {
    moduleName: "fixture",
    entryName: "fixture",
    type: "vanilla",
    root: FIXTURE_ROOT,
    entryFile: "src/main.ts",
    outDir: OUT_DIR,
    publicPath: PUBLIC_PATH,
    apiProxyPaths: [],
    ...overrides,
  };
}

describe("@nodefony/frontend — prod build + renderProdTags (P14.5)", () => {
  afterAll(() => {
    try {
      fs.rmSync(OUT_DIR, { recursive: true, force: true });
    } catch {
      /* déjà nettoyé */
    }
  });

  it("vite build écrit un manifest fingerprinté dans outDir/.vite/ (base = publicPath)", async () => {
    const entry = makeEntry();
    const cfg = await new ViteBuilder().buildViteConfig([entry], "production");
    expect((cfg as { base?: string }).base).to.equal(PUBLIC_PATH);

    const vite = (await import("vite")) as {
      build: (c: Record<string, unknown>) => Promise<unknown>;
    };
    await vite.build(cfg);

    const manifestPath = path.join(OUT_DIR, ".vite", "manifest.json");
    expect(fs.existsSync(manifestPath), "manifest généré").to.equal(true);
    const manifest = JSON.parse(
      fs.readFileSync(manifestPath, "utf8"),
    ) as Record<string, { file: string; isEntry?: boolean }>;
    const chunk = Object.values(manifest).find((c) => c.isEntry);
    expect(chunk, "chunk d'entrée présent").to.exist;
    expect(chunk!.file).to.match(/\.js$/);
  });

  it("renderProdTags injecte le script fingerprinté préfixé par publicPath (≠ page blanche)", () => {
    const helper = new TemplateHelper(null, "production", [makeEntry()]);
    const tags = helper.renderTags("fixture");
    expect(tags).to.include(
      '<script type="module" crossorigin src="/_assets/fixture/',
    );
    expect(tags).to.match(/src="\/_assets\/fixture\/[^"]+\.js"/);
    expect(tags).to.not.include("not yet implemented");
    expect(tags).to.not.include("manifest missing");
  });

  it("renderProdTags retourne un commentaire si le manifest est absent (pas de crash)", () => {
    const helper = new TemplateHelper(null, "production", [
      makeEntry({ outDir: path.join(OUT_DIR, "no-build-here") }),
    ]);
    const tags = helper.renderTags("fixture");
    expect(tags).to.include("manifest missing");
  });

  it("renderProdTags émet les <link> CSS + modulepreload depuis le manifest", () => {
    // Manifest synthétique → assertions déterministes (indépendant du hash Vite).
    const dir = path.join(OUT_DIR, "synthetic");
    fs.mkdirSync(path.join(dir, ".vite"), { recursive: true });
    const manifest = {
      "src/main.ts": {
        file: "assets/main-abc.js",
        isEntry: true,
        css: ["assets/main-xyz.css"],
        imports: ["_vendor-123.js"],
      },
      "_vendor-123.js": { file: "assets/vendor-123.js" },
    };
    fs.writeFileSync(
      path.join(dir, ".vite", "manifest.json"),
      JSON.stringify(manifest),
    );
    const helper = new TemplateHelper(null, "production", [
      makeEntry({ outDir: dir }),
    ]);
    const tags = helper.renderTags("fixture");
    expect(tags).to.include(
      '<link rel="stylesheet" href="/_assets/fixture/assets/main-xyz.css">',
    );
    expect(tags).to.include(
      '<link rel="modulepreload" href="/_assets/fixture/assets/vendor-123.js">',
    );
    expect(tags).to.include(
      '<script type="module" crossorigin src="/_assets/fixture/assets/main-abc.js"></script>',
    );
  });

  it("renderProdTags signale une entrée inconnue", () => {
    const helper = new TemplateHelper(null, "production", [makeEntry()]);
    expect(helper.renderTags("nope")).to.include('unknown entry "nope"');
  });

  it("renderDocument injecte dans l'index.html du module + retire le script source", () => {
    const root = path.join(OUT_DIR, "doc-root");
    fs.mkdirSync(path.join(root, ".vite"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "index.html"),
      `<!doctype html><html><head><title>Mon App</title><link rel="icon" href="/fav.ico"></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>`,
    );
    fs.writeFileSync(
      path.join(root, ".vite", "manifest.json"),
      JSON.stringify({
        "src/main.tsx": {
          file: "assets/app-h.js",
          isEntry: true,
          css: ["assets/app-h.css"],
        },
      }),
    );
    const entry = makeEntry({ root, outDir: root, entryFile: "src/main.tsx" });
    const doc = new TemplateHelper(null, "production", [entry]).renderDocument(
      "fixture",
    );
    expect(doc).to.include("<title>Mon App</title>"); // head du dev préservé
    expect(doc).to.include('href="/fav.ico"'); // externe du dev préservé
    expect(doc).to.include('src="/_assets/fixture/assets/app-h.js"'); // tags injectés
    expect(doc).to.include('href="/_assets/fixture/assets/app-h.css"');
    expect(doc).to.not.include('src="/src/main.tsx"'); // script source retiré
  });

  it("renderDocument respecte le marqueur <!--nodefony:frontend-->", () => {
    const root = path.join(OUT_DIR, "doc-marker");
    fs.mkdirSync(path.join(root, ".vite"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "index.html"),
      `<!doctype html><html><head><!--nodefony:frontend--></head><body></body></html>`,
    );
    fs.writeFileSync(
      path.join(root, ".vite", "manifest.json"),
      JSON.stringify({
        "src/main.tsx": { file: "assets/m.js", isEntry: true },
      }),
    );
    const entry = makeEntry({ root, outDir: root, entryFile: "src/main.tsx" });
    const doc = new TemplateHelper(null, "production", [entry]).renderDocument(
      "fixture",
    );
    expect(doc).to.include('src="/_assets/fixture/assets/m.js"');
    expect(doc).to.not.include("nodefony:frontend"); // marqueur remplacé
  });

  it("renderDocument génère une coquille minimale sans index.html", () => {
    const root = path.join(OUT_DIR, "no-index");
    fs.mkdirSync(path.join(root, ".vite"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".vite", "manifest.json"),
      JSON.stringify({
        "src/main.tsx": { file: "assets/x.js", isEntry: true },
      }),
    );
    const entry = makeEntry({ root, outDir: root, entryFile: "src/main.tsx" });
    const doc = new TemplateHelper(null, "production", [entry]).renderDocument(
      "fixture",
    );
    expect(doc).to.include("<!DOCTYPE html>");
    expect(doc).to.include('<div id="root">');
    expect(doc).to.include('src="/_assets/fixture/assets/x.js"');
  });
});
