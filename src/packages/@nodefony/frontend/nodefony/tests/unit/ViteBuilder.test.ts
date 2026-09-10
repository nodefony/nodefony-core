import { readFileSync } from "node:fs";
import { expect } from "chai";
import ViteBuilder from "../../src/builders/ViteBuilder.js";
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

  it("react19 : dedupe react + react-dom (app --link = 2 runtimes sinon, hooks null en prod)", async () => {
    const cfg = await builder.buildViteConfig(
      [{ ...entry, type: "react19", entryFile: "src/main.tsx" }],
      "production",
    );
    expect(cfg.resolve).to.deep.equal({ dedupe: ["react", "react-dom"] });
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
  it("svelte5 : dedupe svelte (le dev le faisait, le build de prod l'oubliait)", async () => {
    const cfg = await builder.buildViteConfig(
      [{ ...entry, type: "svelte5", entryFile: "src/main.ts" }],
      "production",
    );
    expect(cfg.resolve).to.deep.equal({ dedupe: ["svelte"] });
  });

  // La duplication est GARDÉE, pas seulement corrigée : deux listes qui se
  // déclarent identiques ont déjà divergé une fois. Ce cas compare les deux
  // sources, préréglage par préréglage — il tombe au prochain écart, quel qu'il
  // soit, sans qu'il faille penser à ajouter un cas.
  it("les deux listes — développement et production — disent la MÊME chose", async () => {
    const source = readFileSync(
      new URL("../../service/ViteConfigGenerator.ts", import.meta.url),
      "utf8",
    );
    for (const preset of ["react19", "vue3", "svelte5", "angular"] as const) {
      const cfg = await builder.buildViteConfig(
        [{ ...entry, type: preset, entryFile: "src/main.ts" }],
        "production",
      );
      const prod =
        (cfg.resolve as { dedupe?: string[] } | undefined)?.dedupe ?? [];
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
    // Budget de temps EXPLICITE : ce cas construit la configuration des QUATRE
    // préréglages, donc charge quatre chaînes d'outils Vite — celle d'Angular
    // pèse à elle seule plus que les trois autres. 1,2 s ici, 7,5 s sur un
    // exécuteur macOS de la forge, où le défaut de 5 s le faisait tomber. Ce
    // n'est PAS un seuil de performance qu'on relâche : rien n'est mesuré ici,
    // c'est le coût d'import de dépendances tierces.
  }, 30_000);

  it("vanilla : aucun resolve (rien à dédupliquer)", async () => {
    const cfg = await builder.buildViteConfig([entry], "production");
    expect(cfg.resolve).to.be.undefined;
  });
});
