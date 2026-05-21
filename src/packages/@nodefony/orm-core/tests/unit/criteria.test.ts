import assert from "node:assert/strict";
import { OPERATOR_KEYS, isFieldOperators } from "../../index";

describe("criteria — isFieldOperators (opérateurs riches P7.4)", () => {
  it("expose les 9 opérateurs portables figés", () => {
    assert.deepEqual(
      [...OPERATOR_KEYS],
      ["$eq", "$ne", "$gt", "$gte", "$lt", "$lte", "$in", "$nin", "$like"],
    );
  });

  it("true : objet dont toutes les clés sont des opérateurs", () => {
    assert.equal(isFieldOperators({ $gt: 1 }), true);
    assert.equal(isFieldOperators({ $gte: 1, $lte: 5 }), true);
    assert.equal(isFieldOperators({ $in: [1, 2] }), true);
    assert.equal(isFieldOperators({ $like: "a%" }), true);
  });

  it("false : clé non-opérateur (égalité sur un objet ordinaire / colonne JSON)", () => {
    assert.equal(isFieldOperators({ foo: 1 }), false);
    assert.equal(isFieldOperators({ $gt: 1, foo: 2 }), false); // mélange
  });

  it("false : objet vide, null, scalaire, tableau, Date", () => {
    assert.equal(isFieldOperators({}), false);
    assert.equal(isFieldOperators(null), false);
    assert.equal(isFieldOperators(undefined), false);
    assert.equal(isFieldOperators(42), false);
    assert.equal(isFieldOperators("x"), false);
    assert.equal(isFieldOperators([1, 2]), false);
    assert.equal(isFieldOperators(new Date()), false); // valeur = égalité
  });
});
