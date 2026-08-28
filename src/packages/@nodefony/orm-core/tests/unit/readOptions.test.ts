import assert from "node:assert/strict";
import { assertOrderOption } from "../../nodefony/src/readOptions";
import { InvalidOrderOption } from "../../nodefony/src/errors";

/**
 * Ce que cette suite protège : une option de tri mal formée doit LEVER, jamais
 * disparaître. Le test historique des adapters (`options?.order?.length`) est faux
 * pour un objet — `{ age: "asc" }` valait « pas de tri », et l'appelant recevait des
 * lignes non triées qu'il croyait triées.
 */
describe("assertOrderOption — le tri mal formé est refusé, jamais ignoré", () => {
  it("accepte l'absence de tri (undefined, null, tableau vide)", () => {
    assert.doesNotThrow(() => assertOrderOption(undefined, "User"));
    assert.doesNotThrow(() => assertOrderOption(null, "User"));
    assert.doesNotThrow(() => assertOrderOption([], "User"));
  });

  it("accepte un ou plusieurs couples conformes", () => {
    assert.doesNotThrow(() => assertOrderOption([["age", "ASC"]], "User"));
    assert.doesNotThrow(() =>
      assertOrderOption(
        [
          ["age", "DESC"],
          ["name", "ASC"],
        ],
        "User",
      ),
    );
  });

  it("refuse la forme objet — le cas qui partait sans ORDER BY", () => {
    assert.throws(
      () => assertOrderOption({ age: "asc" }, "User"),
      (err: unknown) => {
        assert.ok(err instanceof InvalidOrderOption);
        assert.equal(err.name, "InvalidOrderOption");
        assert.equal(err.entity, "User");
        assert.equal(err.received, "an object");
        assert.match(err.message, /\[field, "ASC" \| "DESC"\] pairs/);
        return true;
      },
    );
  });

  it("refuse un tri passé en chaîne", () => {
    assert.throws(
      () => assertOrderOption("age ASC", "User"),
      (err: unknown) =>
        err instanceof InvalidOrderOption && err.received === "a string",
    );
  });

  it("refuse un élément qui n'est pas un couple", () => {
    assert.throws(
      () => assertOrderOption(["age"], "User"),
      (err: unknown) =>
        err instanceof InvalidOrderOption &&
        err.received === "pair #0 = a string",
    );
    assert.throws(
      () => assertOrderOption([["age", "ASC", "extra"]], "User"),
      (err: unknown) =>
        err instanceof InvalidOrderOption &&
        err.received === "pair #0 = an array of length 3",
    );
  });

  it("refuse un champ qui n'est pas une chaîne", () => {
    assert.throws(
      () => assertOrderOption([[1, "ASC"]], "User"),
      (err: unknown) =>
        err instanceof InvalidOrderOption &&
        err.received === "pair #0 field = a number",
    );
  });

  it("refuse un sens en casse basse — il aurait trié à l'ENVERS", () => {
    // `dir === "DESC" ? desc : asc` : un "desc" minuscule produisait un tri ASC,
    // soit l'inverse exact de l'intention, sans un mot.
    assert.throws(
      () => assertOrderOption([["age", "desc"]], "User"),
      (err: unknown) => {
        assert.ok(err instanceof InvalidOrderOption);
        assert.match(err.message, /direction = "desc"/);
        return true;
      },
    );
  });

  it("nomme le rang du couple fautif quand les premiers sont bons", () => {
    assert.throws(
      () =>
        assertOrderOption(
          [
            ["age", "ASC"],
            ["name", 1],
          ],
          "User",
        ),
      (err: unknown) =>
        err instanceof InvalidOrderOption &&
        err.received.startsWith("pair #1 direction ="),
    );
  });

  it("ne recopie jamais la valeur reçue dans le message (pas de fuite)", () => {
    const secret = { token: "s3cr3t-value" };
    assert.throws(
      () => assertOrderOption(secret, "User"),
      (err: unknown) =>
        err instanceof InvalidOrderOption && !err.message.includes("s3cr3t"),
    );
  });
});
