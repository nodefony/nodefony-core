import assert from "node:assert/strict";
import {
  canonicalIntegerKey,
  canonicalUuid,
  ColumnValueError,
} from "../../nodefony/entity/colKit.codecs";
// Le rendu d'erreur HTTP ne dépend d'aucun ORM : il reconnaît le refus du kit à
// sa FORME. Ce test confronte la VRAIE erreur à son lecteur — une forme qui
// changerait d'un côté rendrait 500 au lieu de 404, sans un mot.
import { malformedIdentifierOf } from "../../../http/nodefony/service/error-renderer";

describe("colKit ↔ rendu HTTP — l'uuid refusé est lu comme un identifiant mal formé", () => {
  it("le refus du codec uuid est reconnu, et rend la valeur fautive", () => {
    let thrown: unknown = null;
    try {
      canonicalUuid("pas-un-uuid", "posts.id");
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown instanceof ColumnValueError);
    assert.equal(malformedIdentifierOf(thrown), "pas-un-uuid");
    // Enveloppé par l'ORM (`cause`), il l'est encore.
    assert.equal(
      malformedIdentifierOf(new Error("Failed query", { cause: thrown })),
      "pas-un-uuid",
    );
  });

  it("la clé entière refusée l'est aussi — `/books/1abc` rend 404 sur les quatre moteurs", () => {
    let thrown: unknown = null;
    try {
      canonicalIntegerKey("1abc", "books.id");
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown instanceof ColumnValueError);
    assert.equal(
      malformedIdentifierOf(new Error("Failed query", { cause: thrown })),
      "1abc",
    );
  });

  it("un autre genre refusé n'est pas un identifiant", () => {
    assert.equal(
      malformedIdentifierOf(
        new ColumnValueError("decimal", "x", "t.c", "is not a decimal number."),
      ),
      null,
    );
  });
});
