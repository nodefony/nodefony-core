/// <reference types="node" />
import { expect } from "chai";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveUiDelivery, PrebuiltUi } from "../../src/assets/prebuiltUi.js";

/** Fixture disque : dossier temporaire avec sources et/ou index pré-buildé. */
function makeFixture(opts: { sources?: boolean; prebuilt?: boolean }): {
  root: string;
  sourcesDir: string;
  distDir: string;
  distIndex: string;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prebuilt-ui-"));
  const sourcesDir = path.join(root, "frontend", "src");
  const distDir = path.join(root, "dist", "frontend");
  const distIndex = path.join(distDir, "index.html");
  if (opts.sources) fs.mkdirSync(sourcesDir, { recursive: true });
  if (opts.prebuilt) {
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(
      distIndex,
      `<!DOCTYPE html><html><head><script type="module" src="/_assets/x/assets/i.js"></script></head><body></body></html>`,
    );
  }
  return { root, sourcesDir, distDir, distIndex };
}

const cleanups: string[] = [];
afterEach(() => {
  for (const dir of cleanups.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveUiDelivery", () => {
  it("auto → vite en dev avec service frontend + sources", () => {
    const f = makeFixture({ sources: true, prebuilt: true });
    cleanups.push(f.root);
    const r = resolveUiDelivery({
      environment: "development",
      hasFrontendService: true,
      sourcesDir: f.sourcesDir,
      distIndex: f.distIndex,
    });
    expect(r.mode).to.equal("vite");
  });

  it("auto → static en dev SANS sources (paquet npm), prebuilt présent", () => {
    const f = makeFixture({ sources: false, prebuilt: true });
    cleanups.push(f.root);
    const r = resolveUiDelivery({
      environment: "development",
      hasFrontendService: true,
      sourcesDir: f.sourcesDir,
      distIndex: f.distIndex,
    });
    expect(r.mode).to.equal("static");
  });

  it("auto → static en production même avec sources + frontend (jamais Vite en prod)", () => {
    const f = makeFixture({ sources: true, prebuilt: true });
    cleanups.push(f.root);
    const r = resolveUiDelivery({
      environment: "production",
      hasFrontendService: true,
      sourcesDir: f.sourcesDir,
      distIndex: f.distIndex,
    });
    expect(r.mode).to.equal("static");
  });

  it("auto → none si ni chemin Vite ni prebuilt (raison actionnable)", () => {
    const f = makeFixture({});
    cleanups.push(f.root);
    const r = resolveUiDelivery({
      environment: "production",
      hasFrontendService: false,
      sourcesDir: f.sourcesDir,
      distIndex: f.distIndex,
    });
    expect(r.mode).to.equal("none");
    expect(r.reason).to.include("prepack");
  });

  it("vite forcé sans service frontend → none (fail-loud)", () => {
    const f = makeFixture({ sources: true });
    cleanups.push(f.root);
    const r = resolveUiDelivery({
      requested: "vite",
      environment: "development",
      hasFrontendService: false,
      sourcesDir: f.sourcesDir,
      distIndex: f.distIndex,
    });
    expect(r.mode).to.equal("none");
    expect(r.reason).to.include("@nodefony/frontend");
  });

  it("static forcé sans prebuilt → none (fail-loud)", () => {
    const f = makeFixture({ sources: true });
    cleanups.push(f.root);
    const r = resolveUiDelivery({
      requested: "static",
      environment: "production",
      hasFrontendService: true,
      sourcesDir: f.sourcesDir,
      distIndex: f.distIndex,
    });
    expect(r.mode).to.equal("none");
    expect(r.reason).to.include(f.distIndex);
  });
});

describe("PrebuiltUi", () => {
  it("normalise le publicPath (/x → /x/)", () => {
    const ui = new PrebuiltUi({ publicPath: "_assets/studio", distDir: "/d" });
    expect(ui.publicPath).to.equal("/_assets/studio/");
  });

  it("mount() appelle server-static.addMount avec le préfixe normalisé", () => {
    const calls: Array<[string, string]> = [];
    const container = {
      get: (name: string) =>
        name === "server-static"
          ? { addMount: (p: string, d: string) => calls.push([p, d]) }
          : null,
    };
    const ui = new PrebuiltUi({
      publicPath: "/_assets/studio/",
      distDir: "/abs/dist/frontend",
    });
    expect(ui.mount(container)).to.equal(true);
    expect(calls).to.deep.equal([["/_assets/studio/", "/abs/dist/frontend"]]);
  });

  it("mount() sans server-static → false + retry armé sur onReady", () => {
    const calls: Array<[string, string]> = [];
    let stat: { addMount: (p: string, d: string) => void } | null = null;
    const container = { get: () => stat };
    let readyCb: (() => void) | null = null;
    const kernel = {
      once: (_: "onReady", cb: () => void) => {
        readyCb = cb;
        return kernel;
      },
    };
    const ui = new PrebuiltUi({ publicPath: "/x/", distDir: "/d" });
    expect(ui.mount(container, kernel)).to.equal(false);
    // server-static apparaît (module http boote), onReady fire → mount différé.
    stat = { addMount: (p: string, d: string) => calls.push([p, d]) };
    readyCb!();
    expect(calls).to.deep.equal([["/x/", "/d"]]);
  });

  it("renderIndex() rend l'index caché et injecte le nonce sur chaque <script>", () => {
    const f = makeFixture({ prebuilt: true });
    cleanups.push(f.root);
    const ui = new PrebuiltUi({ publicPath: "/x/", distDir: f.distDir });
    const plain = ui.renderIndex();
    expect(plain).to.include(`<script type="module"`);
    const nonced = ui.renderIndex("abc123");
    expect(nonced).to.include(`<script nonce="abc123" type="module"`);
    // Le template caché n'est PAS pollué par l'injection précédente.
    expect(ui.renderIndex()).to.equal(plain);
  });

  it("renderIndex() index absent → commentaire HTML fail-loud, sans cacher l'erreur", () => {
    const f = makeFixture({});
    cleanups.push(f.root);
    const ui = new PrebuiltUi({ publicPath: "/x/", distDir: f.distDir });
    expect(ui.renderIndex()).to.include("prebuilt UI index missing");
    // Le build apparaît ensuite → repris au prochain rendu (pas de cache du miss).
    fs.mkdirSync(f.distDir, { recursive: true });
    fs.writeFileSync(f.distIndex, "<!DOCTYPE html><html></html>");
    expect(ui.renderIndex()).to.equal("<!DOCTYPE html><html></html>");
  });
});
