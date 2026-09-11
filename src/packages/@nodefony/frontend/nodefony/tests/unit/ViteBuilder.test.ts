import { readFileSync } from "node:fs";
import { expect } from "chai";
import ViteBuilder, { resolveDedupe } from "../../src/builders/ViteBuilder.js";
import type { IResolvedFrontendEntry } from "../../interfaces/IFrontBuilder.js";

const entry: IResolvedFrontendEntry = {
  moduleName: "test-mod",
  entryName: "test-mod",
  type: "vanilla",
  root: "/abs/path/to/frontend",
  entryFile: "src/main.ts",
  outDir: "/abs/path/to/public/dist",
  publicPath: "/_assets/test-mod/",
  apiProxyPaths: [],
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

  // La règle se lit sur `resolveDedupe`, PAS à travers `buildViteConfig` : ce
  // dernier charge réellement les chaînes d'outils Vite des préréglages employés,
  // et sous la contention d'une passe complète ce chargement a dépassé le budget
  // de temps par défaut (vécu : `svelte5` tombé sur 5 s alors qu'il prend 200 ms
  // à froid). Un rouge qui ne disait RIEN de la règle qu'il prétendait garder.
  // Ces cas sont donc instantanés et ne dépendent d'aucun paquet tiers ; le
  // BRANCHEMENT de la liste dans la configuration garde son propre cas.
  const dedupeDe = (...types: Array<IResolvedFrontendEntry["type"]>) =>
    resolveDedupe(new Set(types));

  it("react19 : dedupe react + react-dom (app --link = 2 runtimes sinon, hooks null en prod)", () => {
    expect(dedupeDe("react19")).to.deep.equal(["react", "react-dom"]);
  });

  it("vue3 : dedupe vue", () => {
    expect(dedupeDe("vue3")).to.deep.equal(["vue"]);
  });

  // Svelte manquait ICI et nulle part ailleurs : la liste du DÉVELOPPEMENT
  // (`ViteConfigGenerator`) le portait, celle du build de PRODUCTION non — deux
  // copies qui se déclarent « la MÊME règle » et qui avaient divergé.
  //
  // ⚠️ Ce que ce cas garde n'est PAS un double runtime Svelte : mesuré sur une
  // application générée en `--link`, avec deux `node_modules/svelte` réellement
  // présents, le bundle est identique à l'octet près avec et sans cette ligne.
  // `@sveltejs/vite-plugin-svelte` pose son propre `resolve.dedupe`. Ce qui est
  // gardé, c'est la SYMÉTRIE des deux listes et notre indépendance vis-à-vis
  // d'un détail de plugin tiers — pas un défaut observable aujourd'hui.
  it("svelte5 : dedupe svelte (le dev le faisait, le build de prod l'oubliait)", () => {
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

  // Une application multi-bundle mêle les préréglages : la liste les CUMULE, et
  // l'ordre reste celui de la règle, jamais celui des entrées.
  it("plusieurs préréglages : les listes se cumulent dans l'ordre de la règle", () => {
    expect(dedupeDe("svelte5", "react19")).to.deep.equal([
      "react",
      "react-dom",
      "svelte",
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
    expect(avec.resolve).to.deep.equal({
      dedupe: resolveDedupe(new Set(["react19"])),
    });
    const sans = await builder.buildViteConfig([entry], "production");
    expect(sans.resolve).to.be.undefined;
  }, 30_000);

  // La duplication est GARDÉE, pas seulement corrigée : deux listes qui se
  // déclarent identiques ont déjà divergé une fois. Ce cas compare les deux
  // sources, préréglage par préréglage — il tombe au prochain écart, quel qu'il
  // soit, sans qu'il faille penser à ajouter un cas.
  it("les deux listes — développement et production — disent la MÊME chose", () => {
    const source = readFileSync(
      new URL("../../service/ViteConfigGenerator.ts", import.meta.url),
      "utf8",
    );
    for (const preset of ["react19", "vue3", "svelte5", "angular"] as const) {
      const prod = dedupeDe(preset);
      // Ce que la configuration de DÉVELOPPEMENT pousse pour ce préréglage,
      // lu au source : la seule façon de comparer sans recopier la liste ici —
      // une troisième copie serait le défaut qu'on ferme.
      const ligne = new RegExp(
        `usedTypes\\.has\\("${preset}"\\)\\)?\\s*\\n?\\s*dedupe\\.push\\(([^)]*)\\)`,
        "u",
      ).exec(source);
      const dev = (ligne?.[1] ?? "")
        .split(",")
        .map((m) => m.trim().replace(/^"|"$/gu, ""))
        .filter(Boolean);
      expect(prod, `dedupe divergent pour ${preset}`).to.deep.equal(dev);
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
