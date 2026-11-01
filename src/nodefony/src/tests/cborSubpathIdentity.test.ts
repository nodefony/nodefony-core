/**
 * Un process Node ne charge qu'UN exemplaire des modules temps réel, que le code
 * entre par `nodefony` ou par `nodefony/cbor`.
 *
 * Le défaut gardé : `exports["./cbor"]` sans condition Node menait au build
 * client, qui tirait sa PROPRE copie de `jsonFrameCodec` — deux
 * `JSON_BYTES_FRAME_CODEC` dans le même serveur, une comparaison par identité
 * fausse sans un mot, deux états de module.
 *
 * La preuve passe par un `node` NU sur le `dist` : c'est la résolution de Node
 * (auto-référence par le nom du paquet) qui fait foi, pas celle de Vite, que la
 * suite traverse et qui suit ses propres conditions.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const probe = `
const core = await import("nodefony");
const cbor = await import("nodefony/cbor");
process.stdout.write(JSON.stringify({
  sameTextCodec: cbor.CBOR_FRAME_CODEC.textCodec === core.JSON_BYTES_FRAME_CODEC,
  cborUrl: import.meta.resolve("nodefony/cbor"),
}));
`;

describe("nodefony/cbor sous Node", () => {
  it("partage le codec JSON du barrel principal — un seul exemplaire par process", () => {
    const out = execFileSync(
      process.execPath,
      ["--input-type=module", "--eval", probe],
      { cwd: packageRoot, encoding: "utf8" },
    );
    const result: unknown = JSON.parse(out);
    // Une URL voyage : `/` sur les trois plateformes.
    expect(result).toMatchObject({
      sameTextCodec: true,
      cborUrl: expect.stringContaining("/dist/node/"),
    });
  });
});
