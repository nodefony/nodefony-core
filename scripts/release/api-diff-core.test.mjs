/**
 * Le noyau de la mesure de surface publique, éprouvé sur des déclarations
 * écrites ici : chaque verdict qui ferait passer une rupture pour un ajout, ou
 * du bruit pour une rupture, a son cas.
 */
import { afterAll, describe, expect, it } from "vitest";
import {
  apiDiffChangelogEntries,
  EXPERIMENTAL_ENTRY_PREFIX,
  packageStability,
  readTypeSurface,
  classifyDeclaration,
  countTypeLooseness,
  diffNames,
  exportEntries,
  normalizeDeclaration,
  resolveExportTarget,
  TYPES_CONDITIONS,
} from "./api-diff-core.mjs";
import fs from "node:fs";
import os from "node:os";
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

describe("readTypeSurface — l'étiquette @experimental lue sur le .d.ts (ADR-0026 D11)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nf-api-diff-"));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(dir, "other.d.ts"),
    "/** Ailleurs. @experimental */\nexport declare class Moved {}\n",
  );
  fs.writeFileSync(
    path.join(dir, "index.d.ts"),
    [
      "/** Neuve. @experimental */",
      "export declare class Neuve { run(): void; }",
      "export interface ITrace {",
      "  id: string;",
      "  /** Champ neuf. @experimental */",
      "  rpc: string | null;",
      "}",
      "export declare class Stable {",
      "  /** @experimental */",
      "  static probe(): void;",
      "  /** @experimental */",
      "  private hidden;",
      "  keep(): void;",
      "}",
      "/** Constante. @experimental */",
      "export declare const flag: boolean;",
      "/** Sans étiquette. */",
      "export declare function plain(): void;",
      'export { Moved } from "./other";',
      "",
    ].join("\n"),
  );
  const surface = readTypeSurface(path.join(dir, "index.d.ts"));

  it("nomme le symbole, le membre (statique compris), la constante et l'alias suivi", () => {
    expect(surface.experimental).toEqual([
      "ITrace.rpc",
      "Moved",
      "Neuve",
      "Stable.static probe",
      "flag",
    ]);
  });

  it("ignore un membre privé et ce qui n'est pas étiqueté ; garde le texte des déclarations", () => {
    expect(surface.experimental).not.toContain("Stable.hidden");
    expect(surface.experimental).not.toContain("plain");
    expect(Object.keys(surface.declarations).sort()).toEqual([
      "ITrace",
      "Moved",
      "Neuve",
      "Stable",
      "flag",
      "plain",
    ]);
  });
});

describe("packageStability", () => {
  it("lit nodefony.stability ; l'absence vaut stable", () => {
    expect(packageStability({ nodefony: { stability: "experimental" } })).toBe(
      "experimental",
    );
    expect(packageStability({ name: "x" })).toBe("stable");
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

describe("apiDiffChangelogEntries — la stabilité décide de la rupture (ADR-0026 D11, point 5)", () => {
  const entry = (stability, experimental, declarations = []) => ({
    stability,
    subpaths: { removed: ["./old"], added: [] },
    entries: {
      ".": {
        runtime: { removed: ["a"], added: [] },
        types: { removed: ["a", "T"], added: [], experimental, declarations },
      },
    },
  });

  it("paquet expérimental : chaque retrait est annoncé, aucun n'est une rupture", () => {
    const { removed, changed } = apiDiffChangelogEntries({
      packages: {
        "@nodefony/ai": entry(
          "experimental",
          [],
          [
            {
              name: "IScope",
              removed: [],
              addedRequired: ["own"],
              changed: [],
            },
          ],
        ),
      },
    });
    const all = [...removed, ...changed];
    expect(all).toHaveLength(3);
    expect(all.every((e) => !e.rupture)).toBe(true);
    expect(
      all.every((e) => e.texte.startsWith(EXPERIMENTAL_ENTRY_PREFIX)),
    ).toBe(true);
  });

  it("paquet stable : un symbole étiqueté dans la référence n'est pas une rupture, son voisin l'est", () => {
    const { removed } = apiDiffChangelogEntries({
      packages: { "@nodefony/http": entry("stable", ["T"]) },
    });
    expect(removed.map((e) => [e.rupture, e.texte])).toEqual([
      [
        true,
        "retirer le sous-chemin d'import `@nodefony/http/old` (mesuré par release:api-diff)",
      ],
      [true, "retirer `a` de `@nodefony/http` (mesuré par release:api-diff)"],
      [
        false,
        "(expérimental) retirer `T` de `@nodefony/http` (mesuré par release:api-diff)",
      ],
    ]);
  });

  it("membre : étiqueté seul, ou par sa déclaration ; un membre stable reste une rupture", () => {
    const { removed, changed } = apiDiffChangelogEntries({
      packages: {
        "@nodefony/http": entry(
          "stable",
          ["ITrace.rpc", "IRpc"],
          [
            {
              name: "ITrace",
              removed: ["rpc", "id"],
              addedRequired: ["x"],
              changed: [],
            },
            {
              name: "IRpc",
              removed: ["code"],
              addedRequired: ["y"],
              changed: [],
            },
          ],
        ),
      },
    });
    const members = removed.filter((e) => e.texte.includes("."));
    expect(members.map((e) => [e.rupture, e.texte.split(" de ")[0]])).toEqual([
      [true, "retirer `ITrace.id`"],
      [false, "(expérimental) retirer `ITrace.rpc`"],
      [false, "(expérimental) retirer `IRpc.code`"],
    ]);
    expect(changed.map((e) => e.rupture)).toEqual([true, false]);
  });
});
