import { expect } from "chai";
import ViteConfigGenerator from "../../service/ViteConfigGenerator.js";
import type { IResolvedFrontendEntry } from "../../interfaces/IFrontBuilder.js";

const baseEntry: IResolvedFrontendEntry = {
  moduleName: "test-mod",
  entryName: "test-mod",
  type: "react19",
  root: "/abs/path/to/frontend",
  entryFile: "src/main.tsx",
  outDir: "/abs/path/to/public/dist",
  publicPath: "/_assets/test-mod/",
  apiProxyPaths: [],
};

describe("ViteConfigGenerator — toMjs()", () => {
  const gen = new ViteConfigGenerator();

  it("throws on empty entries", () => {
    expect(() => gen.toMjs([], "development")).to.throw(/empty entries/);
  });

  it("emits defineConfig + react plugin for react19 preset", () => {
    const out = gen.toMjs([baseEntry], "development");
    expect(out).to.include('import { defineConfig } from "vite"');
    expect(out).to.include('import react from "@vitejs/plugin-react"');
    expect(out).to.include('react({ jsxRuntime: "automatic" })');
  });

  it("does NOT emit react import for vanilla preset", () => {
    const out = gen.toMjs([{ ...baseEntry, type: "vanilla" }], "development");
    expect(out).to.not.include("@vitejs/plugin-react");
  });

  it("emits defineConfig + vue plugin for vue3 preset", () => {
    const out = gen.toMjs(
      [{ ...baseEntry, type: "vue3", entryFile: "src/main.ts" }],
      "development",
    );
    expect(out).to.include('import { defineConfig } from "vite"');
    expect(out).to.include('import vue from "@vitejs/plugin-vue"');
    expect(out).to.include("vue()");
    expect(out).to.include('"vue",');
  });

  it("does NOT emit react import for vue3 preset", () => {
    const out = gen.toMjs(
      [{ ...baseEntry, type: "vue3", entryFile: "src/main.ts" }],
      "development",
    );
    expect(out).to.not.include("@vitejs/plugin-react");
  });

  it("emits defineConfig + angular plugin (tsconfig absolu) for angular preset", () => {
    const out = gen.toMjs(
      [{ ...baseEntry, type: "angular", entryFile: "src/main.ts" }],
      "development",
    );
    expect(out).to.include('import { defineConfig } from "vite"');
    expect(out).to.include(
      'import angular from "@analogjs/vite-plugin-angular"',
    );
    // tsconfig résolu en absolu depuis le root de l'entry (≠ relatif).
    expect(out).to.include("angular({ tsconfig:");
    expect(out).to.include("/abs/path/to/frontend/tsconfig.app.json");
    expect(out).to.include('"@angular/core",');
  });

  it("does NOT emit react/vue imports for angular preset", () => {
    const out = gen.toMjs(
      [{ ...baseEntry, type: "angular", entryFile: "src/main.ts" }],
      "development",
    );
    expect(out).to.not.include("@vitejs/plugin-react");
    expect(out).to.not.include("@vitejs/plugin-vue");
  });

  it("includes mode in defineConfig", () => {
    const out = gen.toMjs([baseEntry], "development");
    expect(out).to.include('mode: "development"');
  });

  it("uses entry root as Vite root", () => {
    const out = gen.toMjs([baseEntry], "development");
    expect(out).to.include('root: "/abs/path/to/frontend"');
  });

  it("uses entry outDir for build", () => {
    const out = gen.toMjs([baseEntry], "production");
    expect(out).to.include('outDir: "/abs/path/to/public/dist"');
  });

  it("aggregates input entries", () => {
    const out = gen.toMjs(
      [
        baseEntry,
        { ...baseEntry, entryName: "admin", entryFile: "src/admin.tsx" },
      ],
      "development",
    );
    expect(out).to.include('"test-mod":');
    expect(out).to.include('"admin":');
  });

  it("emits server.proxy when backendOrigin + apiProxyPaths fournis (dev)", () => {
    const out = gen.toMjs(
      [{ ...baseEntry, apiProxyPaths: ["/api", "/poc"] }],
      "development",
      { backendOrigin: "http://127.0.0.1:5151" },
    );
    expect(out).to.include("proxy: {");
    expect(out).to.include('"/api":');
    expect(out).to.include('"/poc":');
    expect(out).to.include('"http://127.0.0.1:5151"');
  });

  it("ne génère PAS de proxy en mode production même avec apiProxyPaths", () => {
    const out = gen.toMjs(
      [{ ...baseEntry, apiProxyPaths: ["/api"] }],
      "production",
      { backendOrigin: "http://127.0.0.1:5151" },
    );
    expect(out).to.not.include("proxy: {");
  });

  it("emits base + strictPort quand viteOrigin fourni (dev)", () => {
    const out = gen.toMjs([baseEntry], "development", {
      viteOrigin: "https://127.0.0.1:5173",
    });
    expect(out).to.include('base: "https://127.0.0.1:5173/"');
    expect(out).to.include("strictPort: true");
  });

  it("emits server.https + import fs quand https fourni (dev)", () => {
    const out = gen.toMjs([baseEntry], "development", {
      https: { keyPath: "/keys/key.pem", certPath: "/keys/cert.pem" },
    });
    expect(out).to.include('import fs from "node:fs"');
    expect(out).to.include("https: {");
    expect(out).to.include('fs.readFileSync("/keys/key.pem")');
    expect(out).to.include('fs.readFileSync("/keys/cert.pem")');
  });

  it("ne génère PAS de https en mode production", () => {
    const out = gen.toMjs([baseEntry], "production", {
      https: { keyPath: "/k.pem", certPath: "/c.pem" },
    });
    expect(out).to.not.include('import fs from "node:fs"');
    expect(out).to.not.include("https: {");
  });

  it("déduplique les apiProxyPaths d'entries multiples", () => {
    const out = gen.toMjs(
      [
        { ...baseEntry, apiProxyPaths: ["/api"] },
        { ...baseEntry, entryName: "b", apiProxyPaths: ["/api", "/poc"] },
      ],
      "development",
      { backendOrigin: "http://127.0.0.1:5151" },
    );
    const apiOccurrences = (out.match(/"\/api":/g) || []).length;
    expect(apiOccurrences).to.equal(1);
  });

  it("throws on unknown preset type", () => {
    expect(() =>
      gen.toMjs([{ ...baseEntry, type: "unknown" as any }], "development"),
    ).to.throw();
  });

  // --- Multi-bundle fix (P14.6) -------------------------------------------

  it("emits server.fs.allow with all entry roots + cwd", () => {
    const out = gen.toMjs(
      [
        { ...baseEntry, root: "/abs/path/to/a/frontend" },
        { ...baseEntry, entryName: "b", root: "/abs/path/to/b/frontend" },
      ],
      "development",
    );
    expect(out).to.include("fs: {");
    expect(out).to.include("allow: [");
    expect(out).to.include('"/abs/path/to/a/frontend"');
    expect(out).to.include('"/abs/path/to/b/frontend"');
    expect(out).to.include(JSON.stringify(process.cwd()));
  });

  it("déduplique les roots identiques dans fs.allow", () => {
    const out = gen.toMjs(
      [
        baseEntry,
        { ...baseEntry, entryName: "admin", entryFile: "src/admin.tsx" },
      ],
      "development",
    );
    const rootOccurrences = (out.match(/"\/abs\/path\/to\/frontend"/g) || [])
      .length;
    // 1× pour `root:`, 1× dans `fs.allow` → 2 max
    expect(rootOccurrences).to.equal(2);
  });

  it("garde fs.allow présent même en production", () => {
    const out = gen.toMjs([baseEntry], "production");
    expect(out).to.include("fs: {");
    expect(out).to.include("allow: [");
  });
});
