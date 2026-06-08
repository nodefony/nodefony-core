import assert from "node:assert/strict";
import { UnknownCriteriaField } from "../../nodefony/src/errors";

describe("UnknownCriteriaField — erreur data-level portable", () => {
  it("est une Error nommée avec field/entity/known exposés", () => {
    const e = new UnknownCriteriaField("emial", "User", ["id", "email"]);
    assert.ok(e instanceof Error);
    assert.equal(e.name, "UnknownCriteriaField");
    assert.equal(e.field, "emial");
    assert.equal(e.entity, "User");
    assert.deepEqual(e.known, ["id", "email"]);
  });

  it("le message cite le champ fautif, l'entité, les champs connus et la trappe native", () => {
    const e = new UnknownCriteriaField("xyz", "Boat", ["id", "name"]);
    assert.match(e.message, /Unknown criteria field "xyz"/);
    assert.match(e.message, /entity "Boat"/);
    assert.match(e.message, /Known fields: id, name/);
    assert.match(e.message, /getNativeConnection\(\)/);
  });

  it("known vide → message cohérent (pas de crash sur join)", () => {
    const e = new UnknownCriteriaField("f", "E", []);
    assert.match(e.message, /Known fields: \./);
    assert.deepEqual(e.known, []);
  });

  it("est catchable comme une Error standard", () => {
    assert.throws(
      () => {
        throw new UnknownCriteriaField("f", "E", ["a"]);
      },
      (err: unknown) => err instanceof UnknownCriteriaField,
    );
  });
});
