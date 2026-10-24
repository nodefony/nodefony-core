/// <reference types="node" />
/**
 * `resolveTimingMode` — la seule règle qui dit ce que le chronométrage mesure
 * sur une requête : la durée (horloge début/fin) et, ou non, les phases.
 */
import { expect } from "vitest";
import { resolveTimingMode } from "../../src/context/timingMode";

describe("resolveTimingMode — durée partout, phases hors production", () => {
  it("🔴 production, sans avis : la DURÉE seule — la ligne d'accès n'est plus vide", () => {
    expect(resolveTimingMode(null, "production")).to.equal("clock");
    expect(resolveTimingMode(undefined, "production")).to.equal("clock");
  });

  it("développement et test, sans avis : durée ET phases (waterfall, profileur)", () => {
    expect(resolveTimingMode(null, "development")).to.equal("phases");
    expect(resolveTimingMode(null, "test")).to.equal("phases");
  });

  it("`true` allume les phases partout, production comprise (diagnostic à chaud)", () => {
    expect(resolveTimingMode(true, "production")).to.equal("phases");
    expect(resolveTimingMode(true, "development")).to.equal("phases");
  });

  it("`false` coupe TOUT, durée comprise, dans tous les environnements", () => {
    expect(resolveTimingMode(false, "production")).to.equal("off");
    expect(resolveTimingMode(false, "development")).to.equal("off");
  });

  it("une valeur qui n'est pas un booléen vaut « pas d'avis », jamais « coupé »", () => {
    expect(resolveTimingMode("false", "production")).to.equal("clock");
    expect(resolveTimingMode(0, "development")).to.equal("phases");
  });

  it("sans noyau (environnement inconnu) : la règle du développement", () => {
    expect(resolveTimingMode(null, undefined)).to.equal("phases");
  });
});
