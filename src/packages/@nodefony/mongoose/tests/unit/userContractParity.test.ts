import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { USER_COLUMNS } from "@nodefony/user";
import { createUserEntity, userSchema } from "../../nodefony/entity/userEntity";

/**
 * Le schéma document `User` doit RENDRE le contrat de colonnes de
 * `@nodefony/user` — soit en le déclarant, soit en le déléguant au moteur.
 *
 * Ce banc existe parce que le schéma est désormais DÉRIVÉ du contrat : la
 * dérivation peut perdre une colonne sans que rien ne le dise. Et il vérifie ce
 * que le pendant SQL n'a pas à vérifier : que les deux colonnes NON déclarées
 * ici (la clé primaire et les horodatages) sont bien FOURNIES par le moteur —
 * `timestamps: true` sur le descripteur, virtuel `id` sur `_id`. Sans ce
 * contrôle, « absente du schéma » et « absente tout court » se ressemblent.
 */

const schema = userSchema as Record<string, Record<string, unknown>>;

describe("contrat utilisateur — le schéma document le rend en entier", () => {
  it("toute colonne ordinaire du contrat est déclarée", () => {
    const expected = USER_COLUMNS.filter((c) => c.origin === "column")
      .map((c) => c.name)
      .sort();
    assert.deepEqual(Object.keys(schema).sort(), expected);
  });

  it("la clé primaire et les horodatages sont délégués au moteur", () => {
    for (const column of USER_COLUMNS.filter((c) => c.origin !== "column")) {
      assert.equal(
        column.name in schema,
        false,
        `${column.name} ne doit pas être déclarée : le moteur la fournit`,
      );
    }
    // Ce qui rend les horodatages : l'option du descripteur, pas le schéma.
    assert.equal(createUserEntity("nodefony").timestamps, true);
  });

  it("les contraintes du contrat sont portées", () => {
    for (const column of USER_COLUMNS.filter((c) => c.origin === "column")) {
      const field = schema[column.name];
      assert.ok(field, `${column.name} absente du schéma`);
      assert.equal(
        field.unique === true,
        column.unique === true,
        `${column.name} : contrainte d'unicité divergente`,
      );
      assert.equal(
        field.required === true,
        !column.nullable && !column.makeDefault,
        `${column.name} : obligation divergente`,
      );
    }
  });

  it("un défaut structuré est une FABRIQUE, jamais une valeur partagée", () => {
    for (const column of USER_COLUMNS.filter((c) => c.makeDefault)) {
      const produced = schema[column.name].default;
      assert.equal(
        typeof produced,
        "function",
        `${column.name} : le défaut doit être une fabrique`,
      );
      const first = (produced as () => unknown)();
      const second = (produced as () => unknown)();
      if (typeof first === "object" && first !== null) {
        assert.notEqual(
          first,
          second,
          `${column.name} : deux documents partageraient le même objet`,
        );
      }
    }
  });
});
