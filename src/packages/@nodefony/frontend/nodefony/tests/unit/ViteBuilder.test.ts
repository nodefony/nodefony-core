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
