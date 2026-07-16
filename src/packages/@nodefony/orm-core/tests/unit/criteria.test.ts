import assert from "node:assert/strict";
import {
  OPERATOR_KEYS,
  UPDATE_OPERATOR_KEYS,
  isFieldOperators,
  isUpdateOperators,
} from "../../index";

describe("criteria — isFieldOperators (opérateurs riches P7.4)", () => {
  it("expose les 10 opérateurs portables figés", () => {
    assert.deepEqual(
      [...OPERATOR_KEYS],
      [
        "$eq",
        "$ne",
        "$gt",
        "$gte",
        "$lt",
        "$lte",
        "$in",
        "$nin",
        "$like",
        "$null",
      ],
    );
  });

  it("true : objet dont toutes les clés sont des opérateurs", () => {
    assert.equal(isFieldOperators({ $gt: 1 }), true);
    assert.equal(isFieldOperators({ $gte: 1, $lte: 5 }), true);
    assert.equal(isFieldOperators({ $in: [1, 2] }), true);
    assert.equal(isFieldOperators({ $like: "a%" }), true);
    // `$null: false` reste un objet d'opérateurs (la VALEUR est fausse, pas la
    // clé) — sinon il serait pris pour une égalité et le filtre partirait faux.
    assert.equal(isFieldOperators({ $null: true }), true);
    assert.equal(isFieldOperators({ $null: false }), true);
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

describe("criteria — isUpdateOperators (opérateurs d'écriture d'un upsert)", () => {
  it("expose les 2 opérateurs d'écriture figés", () => {
    assert.deepEqual([...UPDATE_OPERATOR_KEYS], ["$max", "$min"]);
  });

  it("true : objet dont toutes les clés sont des opérateurs d'écriture", () => {
    assert.equal(isUpdateOperators({ $max: 1 }), true);
    assert.equal(isUpdateOperators({ $min: 1 }), true);
    assert.equal(isUpdateOperators({ $max: 0 }), true); // valeur falsy ≠ absente
  });

  it("false : opérateur de CRITÈRE — les deux familles sont disjointes", () => {
    // `{ $gt: 1 }` en écriture n'a pas de sens : ce serait écrit tel quel (donc
    // en base) si on le confondait avec un opérateur d'update.
    assert.equal(isUpdateOperators({ $gt: 1 }), false);
    assert.equal(isUpdateOperators({ $null: true }), false);
  });

  it("false : valeur ordinaire (colonne JSON, sous-document) → écrite telle quelle", () => {
    assert.equal(isUpdateOperators({ foo: 1 }), false);
    assert.equal(isUpdateOperators({ $max: 1, foo: 2 }), false); // mélange
    assert.equal(isUpdateOperators({}), false);
    assert.equal(isUpdateOperators(null), false);
    assert.equal(isUpdateOperators(undefined), false);
    assert.equal(isUpdateOperators(42), false);
    assert.equal(isUpdateOperators("x"), false);
    assert.equal(isUpdateOperators([1, 2]), false);
    assert.equal(isUpdateOperators(new Date()), false);
  });
});
