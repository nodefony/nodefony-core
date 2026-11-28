import assert from "node:assert/strict";
import { DrizzleQueryError } from "drizzle-orm";
import { isStalePlanError } from "../../nodefony/src/orm-core/stalePlan";

/** L'erreur que rend `pg` : champs du protocole recopiés sur une `Error`. */
function pgError(code: string, routine: string): Error {
  return Object.assign(
    new Error("le plan en cache ne doit pas modifier le type de résultat"),
    {
      code,
      routine,
    },
  );
}

describe("isStalePlanError — le refus d'un plan périmé, et lui seul", () => {
  it("reconnaît le refus, quelle que soit la langue du message", () => {
    assert.equal(
      isStalePlanError(pgError("0A000", "RevalidateCachedQuery")),
      true,
    );
  });

  it("le reconnaît sous l'enveloppe de Drizzle", () => {
    const wrapped = new DrizzleQueryError(
      "select 1",
      [],
      pgError("0A000", "RevalidateCachedQuery"),
    );
    assert.equal(isStalePlanError(wrapped), true);
  });

  it("ignore un autre `feature_not_supported`, une autre erreur, une non-erreur", () => {
    assert.equal(isStalePlanError(pgError("0A000", "transformAExprIn")), false);
    assert.equal(
      isStalePlanError(pgError("42P01", "RevalidateCachedQuery")),
      false,
    );
    assert.equal(isStalePlanError(new Error("x")), false);
    assert.equal(
      isStalePlanError({ code: "0A000", routine: "RevalidateCachedQuery" }),
      false,
    );
    assert.equal(isStalePlanError(null), false);
  });
});
