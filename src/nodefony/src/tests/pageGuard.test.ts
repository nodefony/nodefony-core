/*
 *   NODEFONY FRAMEWORK UNIT TEST
 *   assertPageQuery — la garde de mode d'un listPage (offset ⊕ curseur)
 */

import { expect } from "chai";
import {
  assertPageQuery,
  CursorOrderError,
  PaginationModeError,
} from "../runtime/pageGuard";
import type { IPageQuery } from "../types/IPage";

const q = (partial: Partial<IPageQuery>): IPageQuery =>
  ({ limit: 10, ...partial }) as IPageQuery;

describe("assertPageQuery — mode de pagination", () => {
  it("laisse passer une requête du bon mode", () => {
    expect(() => assertPageQuery(q({ offset: 20 }), "offset")).to.not.throw();
    expect(() =>
      assertPageQuery(q({ cursor: "42:x" }), "cursor"),
    ).to.not.throw();
  });

  it("refuse le champ du mode adverse", () => {
    expect(() => assertPageQuery(q({ cursor: "42:x" }), "offset")).to.throw(
      PaginationModeError,
    );
    expect(() => assertPageQuery(q({ offset: 20 }), "cursor")).to.throw(
      PaginationModeError,
    );
  });

  it("tolère les valeurs NEUTRES du mode adverse (début de collection)", () => {
    expect(() => assertPageQuery(q({ cursor: "" }), "offset")).to.not.throw();
    expect(() => assertPageQuery(q({ offset: 0 }), "cursor")).to.not.throw();
  });
});

describe("assertPageQuery — un store CURSEUR ne trie pas", () => {
  it("refuse un `order` en mode curseur", () => {
    const error = (() => {
      try {
        assertPageQuery(q({ order: [["ts", "ASC"]] }), "cursor");
        return null;
      } catch (e) {
        return e as CursorOrderError;
      }
    })();
    expect(error, "aucune erreur levée").to.be.instanceOf(CursorOrderError);
    expect(error?.code).to.equal(400);
    // Le message nomme le champ demandé : sinon l'appelant ne sait pas lequel
    // de ses couples a été refusé.
    expect(error?.message).to.contain("ts");
  });

  it("refuse dès le PREMIER couple, quel que soit le sens", () => {
    expect(() =>
      assertPageQuery(q({ order: [["ts", "DESC"]] }), "cursor"),
    ).to.throw(CursorOrderError);
  });

  it("laisse passer un `order` VIDE ou absent (aucune intention de tri)", () => {
    expect(() => assertPageQuery(q({ order: [] }), "cursor")).to.not.throw();
    expect(() => assertPageQuery(q({}), "cursor")).to.not.throw();
  });

  it("n'impose RIEN au mode offset — c'est là que le tri se paramètre", () => {
    expect(() =>
      assertPageQuery(q({ order: [["ts", "ASC"]] }), "offset"),
    ).to.not.throw();
  });
});
