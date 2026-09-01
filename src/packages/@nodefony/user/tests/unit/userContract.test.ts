import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  USER_COLUMNS,
  attachExtraColumns,
} from "../../nodefony/src/userContract";
import { BaseUser } from "../../nodefony/src/BaseUser";

/**
 * Le contrat de colonnes et son corollaire de lecture.
 *
 * Deux choses s'y prouvent, que rien d'autre ne peut voir : que la
 * correspondance « colonne du contrat ↔ propriété de `BaseUser` » tient
 * toujours — c'est elle qui décide ce qui est « en plus » —, et que le report
 * des colonnes hors contrat n'ouvre pas une porte par où empoisonner un
 * prototype.
 */
describe("USER_COLUMNS — le contrat", () => {
  it("chaque colonne se décrit entièrement", () => {
    for (const column of USER_COLUMNS) {
      assert.ok(column.name.length > 0);
      assert.ok(column.description.length > 0, `${column.name} sans rôle`);
      assert.ok(
        column.readers.length > 0,
        `${column.name} : aucun lecteur nommé — un refus ne pourrait pas dire qui casse`,
      );
    }
  });

  it("les noms sont uniques", () => {
    const names = USER_COLUMNS.map((c) => c.name);
    assert.equal(new Set(names).size, names.length);
  });

  it("toute colonne NON-audit est reconstruite par BaseUser", () => {
    // C'est l'invariant dont dépend `attachExtraColumns` : ce que `BaseUser`
    // porte déjà ne se reporte pas. Le jour où une colonne change de statut
    // sans que `BaseUser` suive, elle serait reportée deux fois — ou perdue.
    const user = new BaseUser({
      id: "u1",
      identifier: "a@b.c",
    }) as unknown as Record<string, unknown>;
    for (const column of USER_COLUMNS.filter((c) => c.origin !== "audit")) {
      assert.ok(
        column.name in user,
        `${column.name} : le contrat la dit reconstruite, BaseUser ne la porte pas`,
      );
    }
    for (const column of USER_COLUMNS.filter((c) => c.origin === "audit")) {
      assert.equal(
        column.name in user,
        false,
        `${column.name} : BaseUser la porte, elle ne serait plus reportée`,
      );
    }
  });
});

describe("attachExtraColumns — ce que BaseUser ne porte pas", () => {
  const build = (): BaseUser =>
    new BaseUser({ id: "u1", identifier: "a@b.c", roles: ["ROLE_USER"] });

  it("reporte un champ métier de l'application", () => {
    const user = attachExtraColumns(build(), { firstName: "Carol", age: 42 });
    assert.equal((user as unknown as { firstName: string }).firstName, "Carol");
    assert.equal((user as unknown as { age: number }).age, 42);
  });

  it("reporte les horodatages de la ligne", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const user = attachExtraColumns(build(), {
      createdAt: now,
      updatedAt: now,
    });
    assert.equal((user as unknown as { createdAt: Date }).createdAt, now);
  });

  it("n'écrase JAMAIS ce que BaseUser a reconstruit", () => {
    const user = attachExtraColumns(build(), {
      identifier: "usurpateur@x.y",
      roles: ["ROLE_ADMIN"],
      password: "AUTRE_HASH",
    });
    assert.equal(user.identifier, "a@b.c");
    assert.deepEqual(user.roles, ["ROLE_USER"]);
  });

  it("tait les clés de plomberie que le dépôt lui désigne", () => {
    const user = attachExtraColumns(
      build(),
      { _id: "507f1f77bcf86cd799439011", __v: 0, firstName: "Carol" },
      new Set(["_id", "__v"]),
    );
    assert.ok(!("_id" in user));
    assert.ok(!("__v" in user));
    assert.equal((user as unknown as { firstName: string }).firstName, "Carol");
  });

  it("refuse d'empoisonner un prototype", () => {
    // Un document Mongo peut porter la clé `__proto__` : l'assigner
    // contaminerait tout objet du process. Le refus est une garde, pas un
    // effet de bord de la façon dont l'objet est construit.
    const row = JSON.parse(
      '{"__proto__": {"pollue": true}, "ok": 1}',
    ) as Record<string, unknown>;
    const user = attachExtraColumns(build(), row);
    assert.equal((user as unknown as { ok: number }).ok, 1);
    assert.equal(
      ({} as Record<string, unknown>).pollue,
      undefined,
      "le prototype d'Object a été pollué",
    );
  });
});
