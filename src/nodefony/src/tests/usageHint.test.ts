import { describe, it } from "vitest";
import assert from "node:assert";
import { USAGE_ERROR_CODES, usageHint } from "../cli/usageHint";

describe("usageHint — l'extrait de doc écrit après un refus d'usage", () => {
  const generate = {
    name: "orm:generate",
    usage: "[options]",
    flags: ["--name <nom>", "--apply", "--connector <nom>"],
    examples: [
      "nodefony orm:generate --name ajout_du_titre",
      "nodefony orm:generate --name ajout_du_titre --apply",
      "nodefony orm:generate --connector analytics --name init",
    ],
  };

  it("🔴 `-y` refusé : dit qu'il n'est pas universel, puis l'extrait", () => {
    // Vécu (banc devkit, tâche 0) : `orm:generate --apply -y` ne rendait que
    // « unknown option '-y' », et l'agent devinait la suite à l'aveugle.
    const hint = usageHint(
      "commander.unknownOption",
      "error: unknown option '-y'",
      generate,
    );
    assert.ok(hint);
    assert.match(hint, /-y n'est pas une option universelle/u);
    assert.match(hint, /options : --name <nom> · --apply · --connector <nom>/u);
    assert.match(hint, /détail {2}: nodefony orm:generate --help/u);
  });

  it("une autre option inconnue : l'extrait, sans la phrase sur `-y`", () => {
    const hint = usageHint(
      "commander.unknownOption",
      "error: unknown option '--nom'",
      generate,
    );
    assert.ok(hint);
    assert.doesNotMatch(hint, /universelle/u);
    assert.match(hint, /usage {3}: nodefony orm:generate \[options\]/u);
  });

  it("argument manquant ou en trop : la ligne d'usage et un exemple qui marche", () => {
    const create = {
      name: "create",
      usage: "[options] <type> [name]",
      flags: ["--dir <path>"],
      examples: ["nodefony create app mon-app"],
    };
    for (const code of [
      "commander.missingArgument",
      "commander.excessArguments",
    ]) {
      const hint = usageHint(code, "error: …", create);
      assert.ok(hint, code);
      assert.match(
        hint,
        /usage {3}: nodefony create \[options\] <type> \[name\]/u,
      );
      assert.match(hint, /exemple : nodefony create app mon-app/u);
    }
  });

  it("deux exemples au plus : au-delà, c'est l'aide complète", () => {
    const hint = usageHint("commander.missingArgument", "", generate) ?? "";
    assert.match(hint, /--apply$/mu);
    assert.doesNotMatch(hint, /analytics/u);
  });

  it("une commande sans option le DIT, plutôt qu'une liste vide", () => {
    const hint = usageHint(
      "commander.unknownOption",
      "error: unknown option '-y'",
      {
        name: "status",
        usage: "",
        flags: [],
        examples: ["nodefony status"],
      },
    );
    assert.match(hint ?? "", /n'en accepte pas/u);
    assert.match(hint ?? "", /usage {3}: nodefony status$/mu);
  });

  it("rien sans commande connue, ni sur une erreur qui n'est pas un mauvais usage", () => {
    assert.strictEqual(
      usageHint("commander.unknownOption", "error: unknown option '-y'", null),
      null,
    );
    assert.strictEqual(
      usageHint("commander.unknownCommand", "", generate),
      null,
    );
    assert.strictEqual(usageHint("commander.help", "", generate), null);
  });

  it("tous les codes de mauvais usage de Commander sont couverts", () => {
    for (const code of [
      "commander.unknownOption",
      "commander.missingArgument",
      "commander.excessArguments",
      "commander.optionMissingArgument",
      "commander.missingMandatoryOptionValue",
      "commander.invalidArgument",
      "commander.conflictingOption",
    ]) {
      assert.ok(USAGE_ERROR_CODES.has(code), code);
    }
  });
});
