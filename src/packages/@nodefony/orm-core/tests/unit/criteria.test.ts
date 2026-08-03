import assert from "node:assert/strict";
import {
  OPERATOR_KEYS,
  UPDATE_OPERATOR_KEYS,
  isFieldOperators,
  isUpdateOperators,
  LIKE_ESCAPE_CHAR,
  escapeLikeTerm,
  likePatternToRegExp,
  searchCriteria,
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

// ── La grammaire des motifs `$like` ──────────────────────────────────────────
// Elle n'existait pas : sans clause `ESCAPE`, PostgreSQL et MySQL appliquaient
// déjà l'antislash, SQLite le cherchait littéralement, et Mongo traduisait un
// motif en regex sans le lire. Trois sémantiques pour un opérateur portable.

describe("criteria — motifs $like : échapper un littéral", () => {
  it("neutralise les métacaractères ET l'échappement lui-même", () => {
    assert.equal(escapeLikeTerm("50%"), "50\\%");
    assert.equal(escapeLikeTerm("a_b"), "a\\_b");
    // L'antislash d'abord : l'oublier ferait d'un `\` saisi le début d'une
    // séquence d'échappement, donc un motif qui ne veut plus rien dire.
    assert.equal(escapeLikeTerm("c:\\tmp"), "c:\\\\tmp");
    assert.equal(escapeLikeTerm("rien"), "rien");
  });

  it("le caractère d'échappement est celui que PG et MySQL appliquent déjà", () => {
    // Le fixer ailleurs (`!`, `#`) obligerait à réécrire les motifs existants,
    // pour aligner les moteurs sur un comportement qu'AUCUN n'avait.
    assert.equal(LIKE_ESCAPE_CHAR, "\\");
  });
});

describe("criteria — motifs $like : les lire sans SQL (Mongo, mémoire)", () => {
  /** Le motif matche-t-il ce sujet ? (contrepartie de `LIKE … ESCAPE '\'`) */
  const matche = (pattern: string, sujet: string): boolean =>
    likePatternToRegExp(pattern).test(sujet);

  it("les jokers gardent leur sens : `%` = une suite, `_` = un caractère", () => {
    assert.equal(matche("ali%", "alice"), true);
    assert.equal(matche("ali%", "bob"), false);
    assert.equal(matche("a_c", "abc"), true);
    assert.equal(matche("a_c", "ac"), false, "`_` exige UN caractère");
  });

  it("ancré aux DEUX bouts — un motif n'est pas une sous-chaîne", () => {
    assert.equal(matche("lic", "alice"), false);
    assert.equal(matche("%lic%", "alice"), true);
  });

  it("un joker ÉCHAPPÉ redevient un caractère ordinaire", () => {
    // Le défaut mesuré sur trois moteurs : `a\_c` rendait la bonne ligne en
    // PG/MySQL et RIEN en SQLite. Ici, une seule réponse.
    assert.equal(matche("a\\_c", "a_c"), true);
    assert.equal(matche("a\\_c", "abc"), false);
    assert.equal(matche("50\\%", "50%"), true);
    assert.equal(matche("50\\%", "5012"), false);
  });

  it("un antislash échappé est un antislash", () => {
    assert.equal(matche("c:\\\\tmp", "c:\\tmp"), true);
  });

  it("les métacaractères d'EXPRESSION RÉGULIÈRE sont inertes", () => {
    // Le motif vient du contrat, pas d'un moteur de regex : `.` ne vaut que
    // lui-même, sinon un terme saisi deviendrait un joker par accident.
    assert.equal(matche("a.c", "abc"), false);
    assert.equal(matche("a.c", "a.c"), true);
    assert.equal(matche("(x)", "(x)"), true);
  });

  it("un terme ÉCHAPPÉ puis lu se retrouve à l'identique", () => {
    // La propriété qui relie les deux fonctions : ce qu'on neutralise pour
    // écrire un motif, la lecture doit le rendre littéral. C'est elle qui
    // garantit qu'un backend documentaire répond comme un backend SQL.
    for (const terme of ["50%", "a_b", "c:\\tmp", "100%_sûr", "simple"]) {
      assert.equal(
        matche(escapeLikeTerm(terme), terme),
        true,
        `« ${terme} » doit se retrouver lui-même`,
      );
      assert.equal(
        matche(escapeLikeTerm(terme), `${terme}x`),
        false,
        `« ${terme} » ne doit pas matcher plus long (motif non ancré ?)`,
      );
    }
  });
});

describe("criteria — searchCriteria échappe le terme saisi", () => {
  it("un `%` saisi est cherché LITTÉRALEMENT, pas comme un joker", () => {
    // Avant la clause `ESCAPE`, le terme partait brut : chercher « 50% »
    // demandait « 50 suivi de n'importe quoi » — l'utilisateur lit ce résultat
    // comme la réponse à sa question, pas comme une approximation.
    const criteria = searchCriteria<{ label: string }>("50%", ["label"]);
    assert.deepEqual(criteria, { label: { $like: "50\\%%" } });
  });

  it("le motif reste ancré à GAUCHE (indexable) sur plusieurs champs", () => {
    const criteria = searchCriteria<{ a: string; b: string }>("x_y", [
      "a",
      "b",
    ]);
    assert.deepEqual(criteria, {
      $or: [{ a: { $like: "x\\_y%" } }, { b: { $like: "x\\_y%" } }],
    });
  });
});
