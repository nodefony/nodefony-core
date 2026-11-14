/**
 * `syncTree` — la régénération EN PLACE (`--write`) du gate protobuf.
 *
 * Le cas qui l'a fait naître : un `.proto.tpl` retouché, son `_pb.ts.tpl`
 * resté périmé, la forge rouge. La recopie doit écrire sous le nom SUFFIXÉ,
 * créer les dossiers neufs, et ne jamais supprimer un fichier en trop.
 */
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { compareTrees, syncTree } from "./check-generated-protobuf.mjs";

const root = fs.mkdtempSync(path.join(tmpdir(), "nf-protobuf-sync-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

/** Écrit un arbre `{ chemin POSIX: contenu }` sous `dir`. */
function tree(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, ...rel.split("/"));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  return dir;
}

describe("syncTree — régénération en place", () => {
  it("écrit le périmé et le manquant sous leur nom .tpl, garde l'en-trop, et l'arbre redevient identique", () => {
    const expected = tree(path.join(root, "a-expected"), {
      "demo/v1/telemetry_pb.ts": "// guide\nexport const a = 1;\n",
      "demo/v2/neuf_pb.ts": "export const b = 2;\n",
    });
    const actual = tree(path.join(root, "a-actual"), {
      "demo/v1/telemetry_pb.ts.tpl": "export const a = 1;\n",
      "demo/v0/ancien_pb.ts.tpl": "export const z = 0;\n",
    });

    const { written, extra } = syncTree(expected, actual, ".tpl");

    expect(written).toEqual(["demo/v1/telemetry_pb.ts", "demo/v2/neuf_pb.ts"]);
    expect(extra).toEqual(["demo/v0/ancien_pb.ts"]);
    expect(
      fs.readFileSync(
        path.join(actual, "demo", "v1", "telemetry_pb.ts.tpl"),
        "utf8",
      ),
    ).toBe("// guide\nexport const a = 1;\n");
    expect(
      fs.existsSync(path.join(actual, "demo", "v2", "neuf_pb.ts.tpl")),
    ).toBe(true);
    // Jamais de suppression : l'en-trop reste, à retirer par l'auteur.
    expect(
      fs.existsSync(path.join(actual, "demo", "v0", "ancien_pb.ts.tpl")),
    ).toBe(true);
    expect(compareTrees(expected, actual, ".tpl")).toEqual({
      missing: [],
      extra: ["demo/v0/ancien_pb.ts"],
      changed: [],
    });
  });

  it("sans suffixe (gabarit d'un module du dépôt), écrit sous le nom réel", () => {
    const expected = tree(path.join(root, "b-expected"), {
      "x_pb.ts": "neuf\n",
    });
    const actual = tree(path.join(root, "b-actual"), { "x_pb.ts": "vieux\n" });
    expect(syncTree(expected, actual)).toEqual({
      written: ["x_pb.ts"],
      extra: [],
    });
    expect(fs.readFileSync(path.join(actual, "x_pb.ts"), "utf8")).toBe(
      "neuf\n",
    );
  });

  it("arbre déjà à jour : rien n'est écrit", () => {
    const expected = tree(path.join(root, "c-expected"), {
      "y_pb.ts": "même\n",
    });
    const actual = tree(path.join(root, "c-actual"), {
      "y_pb.ts.tpl": "même\n",
    });
    expect(syncTree(expected, actual, ".tpl")).toEqual({
      written: [],
      extra: [],
    });
  });
});
