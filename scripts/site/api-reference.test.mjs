import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  code,
  firstSentence,
  locationOf,
  readPackagesApi,
  renderApiPages,
  tsdocToMarkdown,
} from "./lib/api-reference.mjs";

/** Un paquet de décor, BÂTI : un `.d.ts` publié, et une bibliothèque tierce qu'il réexporte. */
function writeFixture(dir) {
  const put = (rel, text) => {
    const file = path.join(dir, ...rel.split("/"));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  put(
    "package.json",
    JSON.stringify({
      name: "@nodefony/decor",
      version: "1.2.3",
      exports: {
        ".": { types: "./dist/types/index.d.ts", default: "./dist/index.js" },
      },
    }),
  );
  put(
    "node_modules/fake-lib/package.json",
    JSON.stringify({ name: "fake-lib", types: "index.d.ts" }),
  );
  put(
    "node_modules/fake-lib/index.d.ts",
    "export declare const fakeLib: { a: number };\n",
  );
  put(
    "dist/types/index.d.ts",
    [
      'export { Foo } from "./src/kernel/Foo";',
      'export { helper } from "./src/util/helper";',
      'export type { IBar } from "./src/kernel/IBar";',
      'export { fakeLib } from "fake-lib";',
      "/**",
      " * Ancien nom.",
      " * @deprecated Utiliser `helper`.",
      " */",
      "export declare function oldHelper(): void;",
      "",
    ].join("\n"),
  );
  put(
    "dist/types/src/kernel/Foo.d.ts",
    [
      "/** Une classe de décor. Deuxième phrase. */",
      "export declare class Foo {",
      "    #private;",
      "    /** Le nom. Détail qui ne passe pas. */",
      "    name: string;",
      "    private secret;",
      "    protected guard(): boolean;",
      "    /** Lance {@link Foo}. */",
      "    run(a: string, b?: number | undefined): Promise<void>;",
      "}",
      "",
    ].join("\n"),
  );
  put(
    "dist/types/src/kernel/IBar.d.ts",
    "export interface IBar {\n    /** Champ. */\n    a: string;\n}\n",
  );
  put(
    "dist/types/src/util/helper.d.ts",
    "/** Aide, voir {@link Foo | la classe}. */\nexport declare function helper(x: number): string;\n",
  );
}

describe("readPackagesApi — la surface PUBLIÉE d'un paquet", () => {
  let dir;
  let pkg;
  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "nf-api-ref-"));
    writeFixture(dir);
    [pkg] = readPackagesApi([dir], dir);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const symbol = (name) => pkg.subpaths[0].symbols.find((s) => s.name === name);

  it("liste exactement ce que l'entrée exporte, triée", () => {
    expect(pkg.name).toBe("@nodefony/decor");
    expect(pkg.subpaths[0].specifier).toBe("@nodefony/decor");
    expect(pkg.subpaths[0].symbols.map((s) => s.name)).toEqual([
      "Foo",
      "IBar",
      "fakeLib",
      "helper",
      "oldHelper",
    ]);
  });

  it("écarte les membres privés, garde les protégés, et range par dossier source", () => {
    const foo = symbol("Foo");
    expect(foo.kind).toBe("class");
    expect(foo.location).toEqual(["kernel", "Foo"]);
    expect(foo.members.map((m) => m.name)).toEqual(["name", "guard", "run"]);
  });

  it("rend la signature sans le bruit d'émission, et la première phrase du TSDoc des membres", () => {
    const foo = symbol("Foo");
    expect(foo.signatures).toEqual(["class Foo"]);
    expect(foo.summary).toBe("Une classe de décor. Deuxième phrase.");
    const run = foo.members.find((m) => m.name === "run");
    expect(run.signature).toBe("run(a: string, b?: number): Promise<void>");
    expect(run.summary).toBe("Lance `Foo`.");
    expect(foo.members.find((m) => m.name === "name").summary).toBe("Le nom.");
  });

  it("nomme une bibliothèque tierce réexportée sans la développer", () => {
    expect(symbol("fakeLib")).toMatchObject({
      kind: "reexport",
      library: "fake-lib",
    });
  });

  it("traduit les liens TSDoc et porte la dépréciation", () => {
    expect(symbol("helper").summary).toBe("Aide, voir la classe.");
    expect(symbol("oldHelper").deprecated).toBe("Utiliser `helper`.");
  });

  it("refuse un paquet non bâti en nommant le fichier absent", () => {
    rmSync(path.join(dir, "dist", "types", "index.d.ts"));
    expect(() => readPackagesApi([dir], dir)).toThrow(
      /dist\/types\/index\.d\.ts/,
    );
  });
});

/** Un modèle synthétique : deux dossiers, et un sous-chemin qui porte le nom de l'un d'eux. */
function bigModel() {
  const sym = (name, location) => ({
    name,
    kind: "function",
    location,
    summary: "Une fonction de décor dont la phrase occupe de la place. ".repeat(
      3,
    ),
    deprecated: null,
    signatures: [`function ${name}(value: string): void`],
    members: [],
  });
  const many = (dir, n) =>
    Array.from({ length: n }, (_, i) => sym(`${dir}Fn${i}`, [dir, "file"]));
  return [
    {
      name: "nodefony",
      version: "9.9.9",
      subpaths: [
        {
          subpath: ".",
          specifier: "nodefony",
          symbols: [...many("kernel", 20), ...many("syslog", 20)],
        },
        {
          subpath: "./syslog",
          specifier: "nodefony/syslog",
          symbols: many("syslog", 2),
        },
      ],
    },
  ];
}

describe("renderApiPages — pages et découpe", () => {
  it("rend un index et une page par paquet qui tient", () => {
    const pages = renderApiPages(bigModel());
    expect(pages.map((p) => p.relPath)).toEqual([
      "api/index.md",
      "api/core.md",
    ]);
    expect(pages[0].markdown).toContain(
      "| [`nodefony`](core.md) | 9.9.9 | 42 | 1 |",
    );
    expect(pages[1].markdown).toContain("#### `kernelFn0`");
    expect(pages[1].markdown).toContain(
      "[← Toutes les références d'API](index.md)",
    );
  });

  it("découpe un paquet trop lourd par sous-chemin puis par dossier, sous le plafond", () => {
    const maxBytes = 8 * 1024;
    const pages = renderApiPages(bigModel(), { maxBytes });
    expect(pages.map((p) => p.relPath)).toEqual([
      "api/index.md",
      "api/core/kernel.md",
      "api/core/syslog.md",
      // le sous-chemin `nodefony/syslog` ne prend pas l'adresse du dossier `syslog`
      "api/core/sous-chemin-syslog.md",
      "api/core/index.md",
    ]);
    for (const p of pages)
      expect(Buffer.byteLength(p.markdown)).toBeLessThanOrEqual(maxBytes);
    const hub = pages.find((p) => p.relPath === "api/core/index.md").markdown;
    expect(hub).toContain("(kernel.md)");
    expect(hub).toContain("(sous-chemin-syslog.md)");
  });

  it("tranche un fichier trop lourd à lui seul", () => {
    const pages = renderApiPages(bigModel(), { maxBytes: 3 * 1024 });
    const kernel = pages.filter((p) => p.relPath.startsWith("api/core/kernel"));
    expect(kernel.length).toBeGreaterThan(1);
    expect(kernel[0].relPath).toBe("api/core/kernel-file-1.md");
  });

  it("signale une dépréciation en tête du symbole", () => {
    const model = bigModel();
    model[0].subpaths[0].symbols[0].deprecated = "Utiliser `autre`.";
    expect(renderApiPages(model)[1].markdown).toContain(
      "> ⚠️ **Déprécié** — Utiliser `autre`.",
    );
  });
});

describe("briques de rendu", () => {
  it("locationOf : même emplacement sous la grammaire Windows, quel que soit le séparateur", () => {
    const expected = ["kernel", "Foo"];
    expect(
      locationOf(
        "C:\\p\\dist\\types\\src\\kernel\\Foo.d.ts",
        "C:\\p",
        path.win32,
      ),
    ).toEqual(expected);
    expect(
      locationOf("C:/p/dist/types/src/kernel/Foo.d.ts", "C:\\p", path.win32),
    ).toEqual(expected);
    // `types` n'est retiré qu'en préfixe de build : c'est aussi un vrai dossier
    expect(
      locationOf("/p/dist/types/src/types/x.d.ts", "/p", path.posix),
    ).toEqual(["types", "x"]);
    expect(
      locationOf("/p/dist/client/types/src/client/i.d.ts", "/p", path.posix),
    ).toEqual(["client", "i"]);
    expect(locationOf("/q/dist/types/a.d.ts", "/p", path.posix)).toEqual([]);
  });

  it("firstSentence ignore le point d'un code inline", () => {
    expect(firstSentence("Lit `a.b` puis rend. Suite.")).toBe(
      "Lit `a.b` puis rend.",
    );
  });

  it("code allonge la clôture quand le texte porte un accent grave", () => {
    expect(code("a`b")).toBe("``a`b``");
    expect(code("x")).toBe("`x`");
  });

  it("tsdocToMarkdown traduit les trois formes de lien", () => {
    expect(tsdocToMarkdown("voir {@link Foo.bar}")).toBe("voir `Foo.bar`");
    expect(tsdocToMarkdown("voir {@link Foo | la doc}")).toBe("voir la doc");
    expect(tsdocToMarkdown("{@link https://x.y/z | RFC}")).toBe(
      "[RFC](https://x.y/z)",
    );
  });
});
