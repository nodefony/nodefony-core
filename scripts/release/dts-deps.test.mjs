// Les types publiés n'importent-ils que ce que l'installeur reçoit ?
// Branches pures d'abord (disque injecté), puis le contrôle RÉEL des `dist` du
// dépôt — c'est lui qui a rendu les 14 `TS7016` de `@nodefony/http` et du cœur
// visibles sans réseau (cf `dts-deps.mjs`).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  bareImports,
  checkRepository,
  entryPoints,
  mainTypeEntries,
  optionalPeersInMainTypes,
  reachableTypeImports,
  typesPackageName,
  unprovidedTypeImports,
} from "./dts-deps.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const imports = (...mods) => new Map(mods.map((m) => [m, "dist/types/x.d.ts"]));
const noOwnTypes = () => false;

describe("dts-deps — ce que les types publiés exigent de l'installeur", () => {
  it("lit les imports réels, ignore commentaires, relatifs et modules natifs", () => {
    const src = [
      'import type { WebSocket } from "ws";',
      "import {",
      "  a,",
      '} from "@scope/pkg/sub";',
      'export type { X } from "./local.js";',
      'type T = import("qs").ParsedQs;',
      'import fs from "node:fs";',
      'import path from "path";',
      ' * import React from "react";',
      '// import x from "xml2js";',
      'export declare const CHOICES: readonly ["react", "vue"];',
    ].join("\n");
    expect([...bareImports(src)].sort()).toEqual(["@scope/pkg", "qs", "ws"]);
  });

  it("nomme le paquet @types d'un module, scope compris", () => {
    expect(typesPackageName("ws")).toBe("@types/ws");
    expect(typesPackageName("@scope/x")).toBe("@types/scope__x");
  });

  it("trouve les `.js` d'entrée d'un manifeste (main, module, exports)", () => {
    const entries = entryPoints({
      main: "./script/index.js",
      exports: {
        ".": { import: "./esm/index.mjs", require: "./cjs/index.cjs" },
      },
    });
    expect(entries).toEqual(
      expect.arrayContaining([
        "./script/index.js",
        "./esm/index.mjs",
        "./cjs/index.cjs",
      ]),
    );
  });

  it("REFUSE une dépendance sans types dont le @types reste en devDependencies", () => {
    const problems = unprovidedTypeImports({
      manifest: {
        name: "@nodefony/http",
        dependencies: { ws: "8" },
        devDependencies: { "@types/ws": "8" },
      },
      imports: imports("ws"),
      hasOwnTypes: noOwnTypes,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ module: "ws" });
    expect(problems[0].reason).toContain("@types/ws");
  });

  it("accepte le @types livré, les types embarqués et les pairs", () => {
    const ok = unprovidedTypeImports({
      manifest: {
        name: "p",
        dependencies: { ws: "8", "@types/ws": "8", cookie: "2" },
        peerDependencies: { react: ">=18" },
      },
      imports: imports("ws", "cookie", "react"),
      hasOwnTypes: (m) => m === "cookie",
    });
    expect(ok).toEqual([]);
  });

  it("prend les types du point d'entrée PRINCIPAL, variantes navigateur et Node comprises", () => {
    expect(
      mainTypeEntries({
        exports: {
          ".": {
            browser: { import: { types: "./dist/client/index.d.ts" } },
            import: { types: "./dist/types/index.d.ts", default: "./x.js" },
          },
          "./react": { types: "./dist/react.d.ts" },
        },
      }),
    ).toEqual(["dist/client/index.d.ts", "dist/types/index.d.ts"]);
    expect(mainTypeEntries({ types: "./dist/index.d.ts" })).toEqual([
      "dist/index.d.ts",
    ]);
  });

  it("suit les imports RELATIFS depuis le point d'entrée, jamais un fichier qu'il n'atteint pas", () => {
    const disk = {
      "dist/index.d.ts":
        'export * from "./a";\nexport type { X } from "./b.js";',
      "dist/a.d.ts":
        'import type { WebSocket } from "ws";\nexport * from "./deep";',
      "dist/deep/index.d.ts": 'type M = import("@bufbuild/protobuf").Message;',
      "dist/b.d.ts": 'export type X = import("zod").ZodType;',
      "dist/grpc.d.ts": 'import type { Code } from "@connectrpc/connect";',
    };
    const reached = reachableTypeImports({
      entries: ["dist/index.d.ts"],
      readDeclaration: (file) => disk[file] ?? null,
    });
    expect(Object.fromEntries(reached)).toEqual({
      ws: "dist/a.d.ts",
      "@bufbuild/protobuf": "dist/deep/index.d.ts",
      zod: "dist/b.d.ts",
    });
  });

  it("REFUSE un pair FACULTATIF atteint depuis le point d'entrée principal, accepte un pair requis", () => {
    const manifest = {
      peerDependencies: { "@bufbuild/protobuf": "^2.7.0", zod: "^4" },
      peerDependenciesMeta: { "@bufbuild/protobuf": { optional: true } },
    };
    expect(
      optionalPeersInMainTypes({
        manifest,
        imports: imports("@bufbuild/protobuf", "zod"),
      }).map((p) => p.module),
    ).toEqual(["@bufbuild/protobuf"]);
    expect(
      optionalPeersInMainTypes({ manifest, imports: imports("zod") }),
    ).toEqual([]);
  });

  it("REFUSE un module déclaré nulle part, sauf la liste volontaire", () => {
    const problems = unprovidedTypeImports({
      manifest: {
        name: "nodefony",
        devDependencies: { rolldown: "1", leftpad: "1" },
      },
      imports: imports("rolldown", "typescript", "leftpad"),
      hasOwnTypes: () => true,
    });
    expect(problems.map((p) => p.module)).toEqual(["leftpad"]);
  });

  it("chaque paquet publiable du dépôt fournit ce que ses types publiés importent", () => {
    // Pas de saut : un vert sans `.d.ts` bâtis ne prouverait rien. La forge
    // bâtit avant `test:release`.
    const dts = path.join(
      ROOT,
      "src",
      "packages",
      "@nodefony",
      "http",
      "dist",
      "types",
      "index.d.ts",
    );
    expect(
      fs.existsSync(dts),
      `${dts} absent — lancer \`npm run build\` d'abord`,
    ).toBe(true);
    const problems = checkRepository(ROOT);
    expect(
      problems.map(
        (p) => `${p.package} : ${p.module} — ${p.reason} [${p.file}]`,
      ),
    ).toEqual([]);
    // 70 s sur la forge Windows (runner chargé, en parallèle de release-core) :
    // 60 s y ont rougi un commit sain. La borne n'arrête qu'une panne.
  }, 180_000);
});
