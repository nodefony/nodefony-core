import { expect } from "chai";
import {
  isolationGroup,
  orderFamilies,
  familyPortPlan,
  PRIMARY_FAMILY,
} from "../../src/isolationGroups.js";

describe("isolationGroups — isolationGroup()", () => {
  it("isole angular dans sa propre famille", () => {
    expect(isolationGroup("angular")).to.equal("angular");
  });

  it("regroupe react/vue/vanilla dans la famille default", () => {
    expect(isolationGroup("react19")).to.equal(PRIMARY_FAMILY);
    expect(isolationGroup("vue3")).to.equal(PRIMARY_FAMILY);
    expect(isolationGroup("vanilla")).to.equal(PRIMARY_FAMILY);
  });

  it("type inconnu → famille default (cohabitation par défaut)", () => {
    expect(isolationGroup("svelte5")).to.equal(PRIMARY_FAMILY);
    expect(isolationGroup("solid")).to.equal(PRIMARY_FAMILY);
  });
});

describe("isolationGroups — orderFamilies()", () => {
  it("met la famille primaire en tête (port de base)", () => {
    expect(orderFamilies(["angular", "default"])).to.deep.equal([
      "default",
      "angular",
    ]);
  });

  it("trie les familles secondaires pour un ordre déterministe", () => {
    expect(orderFamilies(["zeta", "default", "angular"])).to.deep.equal([
      "default",
      "angular",
      "zeta",
    ]);
  });

  it("sans famille primaire → secondaires triées seules", () => {
    expect(orderFamilies(["zeta", "angular"])).to.deep.equal([
      "angular",
      "zeta",
    ]);
  });
});

describe("isolationGroups — familyPortPlan()", () => {
  it("default reste sur le port de base, angular sur le bloc suivant", () => {
    const plan = familyPortPlan(5173, ["angular", "default"], 3);
    expect(plan.get("default")).to.equal(5173);
    expect(plan.get("angular")).to.equal(5177); // 5173 + 1*(3+1)
  });

  it("blocs disjoints : pas de chevauchement entre familles", () => {
    const retry = 3;
    const plan = familyPortPlan(5173, ["default", "angular", "zeta"], retry);
    const bases = [...plan.values()].sort((a, b) => a - b);
    for (let i = 1; i < bases.length; i++) {
      // l'écart entre deux bases ≥ taille de bloc (retry + 1) → aucun port partagé
      expect(bases[i]! - bases[i - 1]!).to.be.greaterThanOrEqual(retry + 1);
    }
  });

  it("la taille du bloc suit portRetryAttempts", () => {
    const plan = familyPortPlan(5173, ["default", "angular"], 0);
    expect(plan.get("angular")).to.equal(5174); // bloc = 0+1 = 1
  });

  it("famille unique → port de base", () => {
    const plan = familyPortPlan(5173, ["default"], 3);
    expect(plan.get("default")).to.equal(5173);
    expect(plan.size).to.equal(1);
  });
});
