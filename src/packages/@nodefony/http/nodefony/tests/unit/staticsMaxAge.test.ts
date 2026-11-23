/// <reference types="node" />
import { expect } from "vitest";
import { serveStaticDefaults } from "../../service/servers/server-static";

/**
 * `statics.defaultOptions.maxAge` est en SECONDES (schéma de config) ;
 * serve-static lit des MILLISECONDES. Sans conversion, le défaut de quatre
 * jours donnait `max-age=345` (constaté sur une application réelle, #890).
 */
describe("Statics — maxAge des options par défaut, en secondes", () => {
  it("🔴 le défaut (4 jours) part en millisecondes vers serve-static", () => {
    expect(serveStaticDefaults(undefined).maxAge).to.equal(96 * 60 * 60 * 1000);
  });

  it("🔴 une valeur configurée en secondes est convertie", () => {
    const opts = serveStaticDefaults({ maxAge: 31_536_000 });
    expect(opts.maxAge).to.equal(31_536_000_000);
    expect(opts.cacheControl).to.equal(true);
  });

  it("une chaîne (« 1d ») est laissée à serve-static", () => {
    expect(serveStaticDefaults({ maxAge: "1d" }).maxAge).to.equal("1d");
  });

  it("deux appels ne se contaminent pas (la constante du module reste intacte)", () => {
    serveStaticDefaults({ maxAge: 10 });
    expect(serveStaticDefaults(undefined).maxAge).to.equal(96 * 60 * 60 * 1000);
  });
});
