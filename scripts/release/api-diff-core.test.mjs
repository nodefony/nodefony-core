/**
 * Le noyau de la mesure de surface publique, éprouvé sur des déclarations
 * écrites ici : chaque verdict qui ferait passer une rupture pour un ajout, ou
 * du bruit pour une rupture, a son cas.
 */
import { describe, expect, it } from "vitest";
import {
  apiDiffChangelogEntries,
  classifyDeclaration,
  countTypeLooseness,
  diffNames,
  exportEntries,
  normalizeDeclaration,
  resolveExportTarget,
  TYPES_CONDITIONS,
} from "./api-diff-core.mjs";
import path from "node:path";

describe("resolveExportTarget", () => {
  it("descend dans les conditions imbriquées pour trouver les types", () => {
    const target = {
      browser: { import: { types: "./c.d.ts" } },
      import: { types: "./n.d.ts", default: "./n.js" },
    };
    expect(resolveExportTarget(target, TYPES_CONDITIONS)).toBe("./n.d.ts");
  });
});

describe("exportEntries", () => {
  it("rend des chemins composés par la plateforme, et aucune cible pour un motif", () => {
    const entries = exportEntries(
      {
        exports: {
          ".": { types: "./t/i.d.ts", import: "./d/i.js" },
          "./x/*": "./d/*.js",
        },
      },
      "/p",
    );
    expect(entries["."]).toEqual({
      js: path.join("/p", "d/i.js"),
      dts: path.join("/p", "t/i.d.ts"),
    });
    expect(entries["./x/*"]).toEqual({ js: null, dts: null });
  });
});

describe("diffNames", () => {
  it("sépare retirés et ajoutés", () => {
    expect(diffNames(["a", "b"], ["b", "c"])).toEqual({
      removed: ["a"],
      added: ["c"],
    });
  });
});

describe("normalizeDeclaration", () => {
  it("efface le `| undefined` d'un facultatif et l'extension d'un import()", () => {
    expect(
      normalizeDeclaration('a?: string | undefined; b: import("./x.js").T'),
    ).toBe('a?: string; b: import("./x").T');
  });
});

describe("classifyDeclaration", () => {
  it("un membre retiré est à relire", () => {
    const c = classifyDeclaration(
      "class A { get(): void; set(): void; }",
      "class A { get(): void; }",
    );
    expect(c.category).toBe("review");
    expect(c.removed).toEqual(["set"]);
  });

  it("un membre requis ajouté à une interface casse ses implémenteurs", () => {
    const c = classifyDeclaration(
      "interface I { a: string; }",
      "interface I { a: string; b: number; }",
    );
    expect(c.category).toBe("review");
    expect(c.addedRequired).toEqual(["b"]);
  });

  it("un membre facultatif ajouté à une interface est un ajout", () => {
    const c = classifyDeclaration(
      "interface I { a: string; }",
      "interface I { a: string; b?: number; }",
    );
    expect(c.category).toBe("additive");
  });

  it("le seul `| undefined` d'émission n'est pas un changement", () => {
    const c = classifyDeclaration(
      "interface I { a?: string; }",
      "interface I { a?: string | undefined; }",
    );
    expect(c.category).toBe("unchanged");
  });

  it("un membre nommé comme une clé du prototype ne fait pas planter", () => {
    const c = classifyDeclaration(
      "class A { constructor(a: string); toString(): string; }",
      "class A { constructor(a: number); toString(): string; }",
    );
    expect(c.changed).toEqual(["constructor"]);
  });

  it("un membre privé ne compte pas", () => {
    const c = classifyDeclaration(
      "class A { private x; #private; }",
      "class A { private y; }",
    );
    expect(c.category).toBe("unchanged");
  });

  it("un type retouché est à relire", () => {
    expect(
      classifyDeclaration('type S = "a";', 'type S = "a" | "b";').category,
    ).toBe("review");
  });
});

describe("countTypeLooseness", () => {
  it("compte les any de l'arbre, pas ceux d'un commentaire", () => {
    const c = countTypeLooseness(
      "/** any any */\nexport declare function f(a: any): unknown;\nexport interface I { x: string; }\n",
    );
    expect(c).toMatchObject({
      any: 1,
      unknown: 1,
      declarations: 2,
      declarationsWithAny: 1,
    });
  });
});

describe("apiDiffChangelogEntries", () => {
  const report = {
    packages: {
      nodefony: {
        subpaths: { removed: ["./old"], added: [] },
        entries: {
          ".": {
            runtime: { removed: ["a"], added: [] },
            types: {
              removed: ["a", "T"],
              added: [],
              declarations: [
                {
                  name: "Service",
                  removed: ["getParameters"],
                  addedRequired: [],
                  changed: ["set"],
                },
                {
                  name: "IScope",
                  removed: [],
                  addedRequired: ["own"],
                  changed: [],
                },
              ],
            },
          },
        },
      },
      "@nodefony/redis": { absentFromReference: true },
    },
  };

  it("un retrait devient une entrée Removed marquée rupture, sans doublon exécution/types", () => {
    const { removed } = apiDiffChangelogEntries(report);
    expect(removed.map((e) => e.texte)).toEqual([
      "retirer le sous-chemin d'import `nodefony/old` (mesuré par release:api-diff)",
      "retirer `T`, `a` de `nodefony` (mesuré par release:api-diff)",
      "retirer `Service.getParameters` de `nodefony` (mesuré par release:api-diff)",
    ]);
    expect(removed.every((e) => e.rupture && e.portee === "nodefony")).toBe(
      true,
    );
  });

  it("un membre requis ajouté devient une entrée Changed ; un membre modifié n'en devient pas une", () => {
    const { changed } = apiDiffChangelogEntries(report);
    expect(changed).toHaveLength(1);
    expect(changed[0].texte).toContain(
      "`IScope` (`nodefony`) exige désormais `own`",
    );
  });
});
