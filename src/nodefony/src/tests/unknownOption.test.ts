import { describe, it } from "vitest";
import assert from "node:assert";
import { unknownOptionHint } from "../cli/unknownOption";

describe("unknownOptionHint — ce qu'on dit après une option refusée", () => {
  const generate = {
    name: "orm:generate",
    flags: ["--name <nom>", "--apply", "--connector <nom>"],
  };

  it("🔴 `-y` refusé : dit qu'il n'est pas universel, puis les options RÉELLES", () => {
    // Vécu (banc devkit, tâche 0) : `orm:generate --apply -y` ne rendait que
    // « unknown option '-y' », et l'agent devinait la suite à l'aveugle.
    const hint = unknownOptionHint("error: unknown option '-y'", generate);
    assert.ok(hint);
    assert.match(hint, /-y n'est pas une option universelle/u);
    assert.match(hint, /--name <nom> · --apply · --connector <nom>/u);
    assert.match(hint, /nodefony orm:generate --help/u);
  });

  it("une autre option inconnue : les options réelles, sans la phrase sur `-y`", () => {
    const hint = unknownOptionHint("error: unknown option '--nom'", generate);
    assert.ok(hint);
    assert.doesNotMatch(hint, /universelle/u);
    assert.match(hint, /options de « orm:generate »/u);
  });

  it("une commande sans option le DIT, plutôt qu'une liste vide", () => {
    const hint = unknownOptionHint("error: unknown option '-y'", {
      name: "status",
      flags: [],
    });
    assert.match(hint ?? "", /n'accepte aucune option/u);
  });

  it("rien à ajouter sans commande connue, ou sur une autre erreur", () => {
    assert.strictEqual(
      unknownOptionHint("error: unknown option '-y'", null),
      null,
    );
    assert.strictEqual(
      unknownOptionHint("error: missing required argument 'x'", generate),
      null,
    );
  });
});
