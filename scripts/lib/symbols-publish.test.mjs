/**
 * Copie publiée du graphe symbolique — module d'un fichier, modules publiés,
 * filtrage sans relation orpheline.
 */
import { describe, it, expect } from "vitest";
import {
  filterGraphToModules,
  foreignModules,
  moduleOf,
  publishedModules,
} from "./symbols-publish.mjs";

/** Un graphe minimal : un module publié, un module de banc, un paquet privé. */
function graph() {
  return {
    version: "2.0.0",
    stats: { files: 3, symbols: 4 },
    symbols: {
      Kernel: { name: "Kernel", module: "@nodefony/core", kind: "class" },
      IKernel: { name: "IKernel", module: "@nodefony/core", kind: "interface" },
      TestController: {
        name: "TestController",
        module: "modules/test",
        kind: "class",
      },
      Agent: { name: "Agent", module: "@nodefony/agent", kind: "class" },
    },
    relations: {
      extendedBy: {
        EventEmitter: ["Kernel", "TestController"],
        Service: ["TestController"],
      },
      implementedBy: { IKernel: ["Kernel", "Agent"] },
      decoratedBy: { injectable: ["Kernel", "Agent"] },
      usedBy: {
        Kernel: [
          "src/nodefony/src/index.ts",
          "src/modules/test/controller/x.ts",
        ],
      },
    },
  };
}

describe("symbols-publish", () => {
  it("rattache un fichier à son module", () => {
    expect(moduleOf("src/packages/@nodefony/http/index.ts")).toBe(
      "@nodefony/http",
    );
    expect(moduleOf("src/modules/test/index.ts")).toBe("modules/test");
    expect(moduleOf("src/nodefony/src/Kernel.ts")).toBe("@nodefony/core");
    expect(moduleOf("scripts/x.ts")).toBe("unknown");
  });

  it("nomme les modules publiés, séparateur Windows compris", () => {
    const set = publishedModules([
      { location: "src/nodefony" },
      { location: "src\\packages\\@nodefony\\http" },
    ]);
    expect([...set].sort()).toEqual(["@nodefony/core", "@nodefony/http"]);
  });

  it("ne garde que les modules publiés, symboles ET relations", () => {
    const out = filterGraphToModules(graph(), new Set(["@nodefony/core"]));
    expect(Object.keys(out.symbols).sort()).toEqual(["IKernel", "Kernel"]);
    expect(out.relations.extendedBy).toEqual({ EventEmitter: ["Kernel"] });
    expect(out.relations.implementedBy).toEqual({ IKernel: ["Kernel"] });
    expect(out.relations.decoratedBy).toEqual({ injectable: ["Kernel"] });
    expect(out.relations.usedBy).toEqual({
      Kernel: ["src/nodefony/src/index.ts"],
    });
    expect(out.stats).toMatchObject({ symbols: 2, classes: 1, interfaces: 1 });
  });

  it("dénonce les modules étrangers d'une copie non filtrée", () => {
    const allowed = new Set(["@nodefony/core"]);
    expect(foreignModules(graph(), allowed)).toEqual([
      "@nodefony/agent",
      "modules/test",
    ]);
    expect(
      foreignModules(filterGraphToModules(graph(), allowed), allowed),
    ).toEqual([]);
  });
});
