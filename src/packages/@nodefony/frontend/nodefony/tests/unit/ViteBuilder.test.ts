import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect } from "vitest";
import ViteBuilder from "../../src/builders/ViteBuilder.js";
import ViteConfigGenerator from "../../service/ViteConfigGenerator.js";
import { getBuiltinPreset } from "../../src/presets/index.js";
import { composePresets, definePreset } from "../../src/presets/compose.js";
import type { IResolvedFrontendEntry } from "../../interfaces/IFrontBuilder.js";
import type { IFrontPreset } from "../../interfaces/IFrontPreset.js";

const entry: IResolvedFrontendEntry = {
  moduleName: "test-mod",
  entryName: "test-mod",
  type: "vanilla",
  root: "/abs/path/to/frontend",
  entryFile: "src/main.ts",
  outDir: "/abs/path/to/public/dist",
  publicPath: "/_assets/test-mod/",
};

describe("ViteBuilder — base CDN (assetBaseUrl)", () => {
  const builder = new ViteBuilder();

  it("prod : base = publicPath quand assetBaseUrl vide", async () => {
    const cfg = await builder.buildViteConfig([entry], "production", "");
    expect(cfg.base).to.equal("/_assets/test-mod/");
  });

  it("prod : base = assetBaseUrl + publicPath quand CDN fourni", async () => {
    const cfg = await builder.buildViteConfig(
      [entry],
      "production",
      "https://cdn.example.com",
    );
    expect(cfg.base).to.equal("https://cdn.example.com/_assets/test-mod/");
  });

  it("prod : assetBaseUrl par défaut (omis) = origine relative", async () => {
    const cfg = await builder.buildViteConfig([entry], "production");
    expect(cfg.base).to.equal("/_assets/test-mod/");
  });

  it("dev : aucun base (l'origine est le port Vite, CDN ignoré)", async () => {
    const cfg = await builder.buildViteConfig(
      [entry],
      "development",
      "https://cdn.example.com",
    );
    expect(cfg.base).to.be.undefined;
  });
});

describe("ViteBuilder — resolve.dedupe (un seul runtime par framework)", () => {
  const builder = new ViteBuilder();

  // La règle se lit sur `composePresets`, PAS à travers `buildViteConfig` : ce
  // dernier charge réellement les chaînes d'outils Vite des préréglages employés,
  // et sous la contention d'une passe complète ce chargement a dépassé le budget
  // de temps par défaut (vécu : `svelte5` tombé sur 5 s alors qu'il prend 200 ms
  // à froid). Un rouge qui ne disait RIEN de la règle qu'il prétendait garder.
  // Ces cas sont donc instantanés et ne dépendent d'aucun paquet tiers ; le
  // BRANCHEMENT de la liste dans la configuration garde son propre cas.
  const dedupeDe = (...types: Array<IResolvedFrontendEntry["type"]>) => {
    const entries: IResolvedFrontendEntry[] = [];
    for (const type of types) entries.push({ ...entry, type });
    return composePresets(entries, getBuiltinPreset).dedupe;
  };

  it("react19 : dedupe react + react-dom (app --link = 2 runtimes sinon, hooks null en prod)", () => {
    expect(dedupeDe("react19")).to.deep.equal(["react", "react-dom"]);
  });

  it("vue3 : dedupe vue", () => {
    expect(dedupeDe("vue3")).to.deep.equal(["vue"]);
  });

  // ⚠️ Ce que ce cas garde n'est PAS un double runtime Svelte : mesuré sur une
  // application générée en `--link`, avec deux `node_modules/svelte` réellement
  // présents, le bundle est identique à l'octet près avec et sans cette ligne.
  // `@sveltejs/vite-plugin-svelte` pose son propre `resolve.dedupe`. Ce qui est
  // gardé, c'est notre indépendance vis-à-vis d'un détail de plugin tiers.
  it("svelte5 : dedupe svelte", () => {
    expect(dedupeDe("svelte5")).to.deep.equal(["svelte"]);
  });

  it("angular : dedupe les trois paquets du runtime", () => {
    expect(dedupeDe("angular")).to.deep.equal([
      "@angular/core",
      "@angular/common",
      "@angular/platform-browser",
    ]);
  });

  it("vanilla : rien à dédupliquer", () => {
    expect(dedupeDe("vanilla")).to.deep.equal([]);
  });

  // Une application multi-bundle mêle les préréglages : la liste les CUMULE,
  // dans l'ordre de première apparition des préréglages parmi les entrées —
  // le même pour les plugins, `optimizeDeps` et `resolve.dedupe`.
  it("plusieurs préréglages : les listes se cumulent dans l'ordre des entrées", () => {
    expect(dedupeDe("svelte5", "react19", "svelte5")).to.deep.equal([
      "svelte",
      "react",
      "react-dom",
    ]);
  });

  // Le seul cas qui traverse `buildViteConfig` : il ne garde pas la RÈGLE mais
  // son BRANCHEMENT — une liste non vide doit ressortir sous `resolve.dedupe`,
  // et une liste vide ne doit poser aucune clef `resolve`. C'est lui, et lui
  // seul, qui paie le chargement d'un plugin : d'où le budget explicite.
  it("la liste est BRANCHÉE dans la configuration, et absente quand elle est vide", async () => {
    const avec = await builder.buildViteConfig(
      [{ ...entry, type: "react19", entryFile: "src/main.tsx" }],
      "production",
    );
    expect(avec.resolve).to.deep.equal({ dedupe: dedupeDe("react19") });
    const sans = await builder.buildViteConfig([entry], "production");
    expect(sans.resolve).to.be.undefined;
  }, 30_000);
});

// #131 — la décision « quels plugins, avec quelles options » n'existe plus
// qu'à UN endroit : le preset, en données. Ce bloc le prouve sur les deux
// sorties RÉELLES — les instances que le build reçoit, et celles que le fichier
// du serveur de développement fabrique quand on l'importe.
describe("ViteBuilder ⇄ ViteConfigGenerator — une seule source pour les plugins", () => {
  const fakeUrl = new URL(
    "../fixtures/fake-vite-plugin/index.mjs",
    import.meta.url,
  ).href;

  // Options volontairement variées : imbrication, tableau, null, booléen, et
  // une valeur tirée des entrées — tout ce qu'un preset réel peut porter.
  const fakePreset: IFrontPreset = definePreset({
    type: "vanilla",
    extensions: [".ts"],
    optimizeDepsInclude: ["fake-dep"],
    dedupe: ["fake-runtime"],
    vitePlugins: (entries) => [
      {
        specifier: fakeUrl,
        exportName: "default",
        options: {
          root: entries[0]?.root ?? null,
          nested: { list: [1, true, null] },
        },
      },
      { specifier: fakeUrl, exportName: "named" },
    ],
  });

  let dir = "";
  afterAll(() => {
    if (dir !== "") rmSync(dir, { recursive: true, force: true });
  });

  it("le build charge EXACTEMENT les plugins que le serveur de développement écrit", async () => {
    const builder = new ViteBuilder();
    builder.registerPreset(fakePreset);
    const built = await builder.buildViteConfig([entry], "production");

    // Le fichier généré, importé pour de vrai. Seule retouche : `defineConfig`
    // (identité chez Vite) est posé localement, le dossier temporaire ne voyant
    // pas le paquet `vite`.
    const mjs = new ViteConfigGenerator((type) => builder.getPreset(type))
      .toMjs([entry], "development")
      .replace(
        'import { defineConfig } from "vite";',
        "const defineConfig = (config) => config;",
      );
    dir = mkdtempSync(path.join(os.tmpdir(), "nf-vite-parity-"));
    const file = path.join(dir, "vite.config.generated.mjs");
    writeFileSync(file, mjs);
    const generated: unknown = await import(pathToFileURL(file).href);
    const dev: unknown = Reflect.get(Object(generated), "default");

    expect(Reflect.get(Object(dev), "plugins")).to.deep.equal(built.plugins);
    expect(built.plugins).to.deep.equal([
      {
        name: "nf-fake-default",
        args: [{ root: entry.root, nested: { list: [1, true, null] } }],
      },
      // Sans options : la fabrique est appelée SANS argument, des deux côtés.
      { name: "nf-fake-named", args: [] },
    ]);
    expect(Reflect.get(Object(dev), "optimizeDeps")).to.deep.equal(
      built.optimizeDeps,
    );
    expect(Reflect.get(Object(dev), "resolve")).to.deep.equal(built.resolve);
  });

  // Le correctif porté par #131 : le build de production recevait le plugin
  // Angular SANS options — ni `tsconfig`, ni contrôle des templates
  // (`strictTemplates` ne mordait qu'en développement).
  it("angular : le build reçoit le tsconfig ET le contrôle des templates", () => {
    const [spec] = composePresets(
      [{ ...entry, type: "angular", root: "/app/front" }],
      getBuiltinPreset,
    ).plugins;
    expect(spec?.options).to.deep.equal({
      disableTypeChecking: false,
      liveReload: true,
      tsconfig: path
        .resolve("/app/front", "tsconfig.app.json")
        .replace(/\\/g, "/"),
    });
  });

  // Plus AUCUNE décision de plugin hors des presets : ni nom de paquet de
  // plugin, ni liste de dépendances. Une copie réintroduite dans l'un des deux
  // consommateurs fait tomber ce cas.
  it("ni le builder ni le générateur ne nomment un plugin ou un runtime", () => {
    for (const rel of [
      "../../src/builders/ViteBuilder.ts",
      "../../service/ViteConfigGenerator.ts",
    ]) {
      const source = readFileSync(new URL(rel, import.meta.url), "utf8")
        .split("\n")
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/u.test(line))
        .join("\n");
      expect(source, rel).to.not.match(
        /@vitejs\/|@analogjs\/|@sveltejs\/|"react-dom"|"@angular\/core"/u,
      );
    }
  });
});

describe("ViteBuilder — resolve absent", () => {
  const builder = new ViteBuilder();

  it("vanilla : aucun resolve (rien à dédupliquer)", async () => {
    const cfg = await builder.buildViteConfig([entry], "production");
    expect(cfg.resolve).to.be.undefined;
  });
});

describe("ViteBuilder — rapport de build de rolldown", () => {
  const builder = new ViteBuilder();

  it("le build pose le rapport par `rolldownOptions` (nom Vite 8), plus aucun `rollupOptions`", async () => {
    const cfg = await builder.buildViteConfig([entry], "production", "");
    const build = cfg.build as Record<string, unknown>;
    expect(build.rollupOptions).to.equal(undefined);
    const rolldownOptions = build.rolldownOptions as Record<string, unknown>;
    expect(rolldownOptions.devtools).to.deep.equal({ mode: "report" });
    expect(rolldownOptions.input).to.have.property("test-mod");
  });
});
