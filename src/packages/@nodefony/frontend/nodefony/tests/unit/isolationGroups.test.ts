import { expect } from "chai";
import {
  isolationGroup,
  orderFamilies,
  familyPortPlan,
  familyPortBlocks,
  PRIMARY_FAMILY,
} from "../../src/isolationGroups.js";

describe("isolationGroups — isolationGroup()", () => {
  it("isole angular dans sa propre famille", () => {
    expect(isolationGroup("angular")).to.equal("angular");
  });

  it("isole vue dans sa propre famille", () => {
    // Constaté à l'écran, pas déduit : partagée avec React, la vitrine Vue ne se
    // montait pas du tout — le compilateur de composants monofichiers sert son
    // bloc script sous un identifiant qui FINIT par `.ts`, et le filtre de
    // `@vitejs/plugin-react` y injecte `$RefreshSig$()`. Un `exclude` passé à ce
    // plugin n'y change rien (mesuré jusqu'à `[/./]`) : seule l'isolation
    // arrête l'injection. Ramener vue3 dans `default` recasse la vitrine.
    expect(isolationGroup("vue3")).to.equal("vue");
    expect(isolationGroup("vue3")).to.not.equal(isolationGroup("angular"));
  });

  it("regroupe react/vanilla/svelte dans la famille default", () => {
    expect(isolationGroup("react19")).to.equal(PRIMARY_FAMILY);
    expect(isolationGroup("vanilla")).to.equal(PRIMARY_FAMILY);
    // Svelte cohabite : son bloc script n'est pas servi sous un identifiant
    // terminé par `.ts`, le filtre de React ne mord donc pas dessus.
    expect(isolationGroup("svelte5")).to.equal(PRIMARY_FAMILY);
  });

  it("type inconnu → famille default (cohabitation par défaut)", () => {
    // `isolationGroup` prend une `string` et non `FrontPresetType` : un preset
    // apporté par un module tiers doit cohabiter, pas casser l'allocation de
    // ports. Seul angular s'isole, et pour une raison nommée.
    expect(isolationGroup("preset-tiers-inconnu")).to.equal(PRIMARY_FAMILY);
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

describe("isolationGroups — familyPortBlocks()", () => {
  it("couvre TOUT le bloc d'une famille, port-retry compris", () => {
    // Le plan ne dit que le port ESPÉRÉ ; sur EADDRINUSE le superviseur glisse
    // dans son bloc. Un CSP construit sur le seul port espéré laisse la page
    // sans rechargement à chaud dès que 5173 est pris — et il l'est dès qu'un
    // second projet tourne sur la machine.
    const plan = familyPortPlan(5173, ["default"], 3);
    expect([...familyPortBlocks(plan, 3)]).to.deep.equal([
      ["default", [5173, 5174, 5175, 5176]],
    ]);
  });

  it("un bloc par famille, sans trou ni chevauchement", () => {
    const plan = familyPortPlan(5173, ["default", "angular", "vue"], 3);
    const blocks = familyPortBlocks(plan, 3);
    expect([...blocks.keys()]).to.deep.equal(["default", "angular", "vue"]);
    const flat = [...blocks.values()].flat();
    expect(flat).to.have.lengthOf(12);
    expect(Math.min(...flat)).to.equal(5173);
    expect(Math.max(...flat)).to.equal(5184);
    // Blocs DISJOINTS : le port-retry d'une famille n'entre jamais chez une autre.
    expect(new Set(flat).size).to.equal(flat.length);
    // Chaque port de base du plan ouvre le bloc de sa famille.
    for (const [family, base] of plan)
      expect(blocks.get(family)![0]).to.equal(base);
  });

  it("`portRetryAttempts: 0` → un port par famille (pas de plage élargie)", () => {
    // Sans port-retry, il n'y a rien à couvrir au-delà du port de base : le CSP
    // ne doit pas s'élargir « au cas où ».
    const plan = familyPortPlan(5173, ["default", "angular"], 0);
    expect([...familyPortBlocks(plan, 0)]).to.deep.equal([
      ["default", [5173]],
      ["angular", [5174]],
    ]);
  });

  it("plan vide → aucun bloc (aucun port inventé)", () => {
    expect(familyPortBlocks(new Map(), 3).size).to.equal(0);
  });
});
