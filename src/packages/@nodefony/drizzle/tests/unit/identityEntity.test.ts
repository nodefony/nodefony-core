import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import {
  USER_PRIVATE_FIELDS,
  USER_TABLE_NAME,
  entityPrivateFields,
  isIdentityEntity,
} from "@nodefony/user";
import {
  createUserEntity,
  createUserTable,
} from "../../nodefony/entity/userTable";
import {
  createAccessTokenTable,
  createTokenEntities,
  TOKEN_ENTITY_NAMES,
} from "../../nodefony/entity/tokenEntity";
import {
  createTotpSecretEntity,
  createTotpSecretTable,
} from "../../nodefony/entity/totpSecretEntity";
import {
  createWebhookEndpointEntity,
  createWebhookEndpointTable,
} from "../../nodefony/entity/webhookEndpointEntity";
import { IDENTITY_TABLES } from "../../nodefony/src/migrator/identityTables";
import { IDENTITY_ENTITY } from "../../../../../nodefony/src/cli/scaffold/entityFields";

/**
 * L'entité d'identité se DÉSIGNE en un endroit — `isIdentityEntity`, au contrat
 * de `@nodefony/user` — et l'adaptateur ne la nomme jamais lui-même.
 *
 * Pourquoi : le défaut fermé des champs privés (l'empreinte du mot de passe ne
 * sort pas par une relation) s'accroche au NOM de l'entité. Le jour où ce nom
 * cessera d'être `User`, chaque `"User"` écrit en clair ici désignerait une
 * entité qui n'existe plus, et le défaut fermé tomberait sans un mot. Ce banc
 * refuse donc la copie, et vérifie que le descripteur livré est reconnu.
 */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SOURCES = path.join(ICI, "..", "..", "nodefony");

/** Colonnes d'une table Drizzle, sous le `has` que l'ORM passe au contrat. */
const colonnes =
  (table: Parameters<typeof getTableColumns>[0]) =>
  (field: string): boolean =>
    Object.hasOwn(getTableColumns(table), field);

/** Lignes de code d'un fichier source, numérotées : commentaires vidés. */
function lignesDeCode(fichier: string): Array<[number, string]> {
  return readFileSync(fichier, "utf8")
    .split("\n")
    .map((ligne, index): [number, string] => [
      index + 1,
      /^\s*(\*|\/\*|\/\/)/u.test(ligne) ? "" : ligne.replace(/\s\/\/.*$/u, ""),
    ]);
}

describe("entité d'identité — une désignation, aucun nom recopié", () => {
  it("le descripteur livré est reconnu comme l'entité d'identité", () => {
    const entity = createUserEntity("default");
    assert.equal(isIdentityEntity(entity), true);
    assert.equal(entity.name, USER_TABLE_NAME);
  });

  it("il reçoit le défaut fermé sans rien déclarer", () => {
    const entity = createUserEntity("default");
    const hidden = entityPrivateFields(
      entity,
      colonnes(createUserTable("sqlite")),
    );
    for (const field of USER_PRIVATE_FIELDS) {
      assert.ok(hidden?.includes(field), field);
    }
  });

  it("le générateur du cœur, qui ne peut pas importer le contrat, désigne la même entité", () => {
    assert.equal(IDENTITY_ENTITY, USER_TABLE_NAME);
  });

  it("la garde d'orm:reset protège la table de l'entité d'identité", () => {
    assert.ok(IDENTITY_TABLES.some((table) => table.name === USER_TABLE_NAME));
  });

  it("aucune source de l'adaptateur n'écrit le nom de l'entité d'identité en clair", () => {
    const fautifs: string[] = [];
    for (const relatif of readdirSync(SOURCES, {
      recursive: true,
      encoding: "utf8",
    })) {
      if (!relatif.endsWith(".ts")) continue;
      const fichier = path.join(SOURCES, relatif);
      lignesDeCode(fichier).forEach(([numero, ligne]) => {
        if (/["'`]User["'`]/u.test(ligne)) {
          fautifs.push(`${relatif}:${numero} ${ligne.trim()}`);
        }
      });
    }
    assert.deepEqual(
      fautifs,
      [],
      "l'entité d'identité se désigne par USER_TABLE_NAME / isIdentityEntity " +
        "(@nodefony/user), jamais par un littéral : le jour où son nom change, " +
        "la copie viserait une entité absente et le défaut fermé tomberait en silence",
    );
  });
});

describe("entités du framework à secret — le secret ne sort pas par une relation", () => {
  const cas = [
    {
      entity: createTotpSecretEntity("default"),
      has: colonnes(createTotpSecretTable("sqlite")),
      secret: "secretEnc",
    },
    {
      entity: createWebhookEndpointEntity("default"),
      has: colonnes(createWebhookEndpointTable("sqlite")),
      secret: "secretEnc",
    },
    {
      entity: createTokenEntities("default").find(
        (e) => e.name === TOKEN_ENTITY_NAMES.records,
      ),
      has: colonnes(createAccessTokenTable("sqlite")),
      secret: "secretHash",
    },
  ];

  for (const { entity, has, secret } of cas) {
    it(`${entity?.name ?? "?"} tait ${secret}`, () => {
      assert.ok(entity, "descripteur introuvable");
      assert.equal(isIdentityEntity(entity), false);
      // `entityPrivateFields` lève si un nom déclaré n'est pas une colonne :
      // ce cas prouve donc aussi que la déclaration démarre.
      assert.ok(entityPrivateFields(entity, has)?.includes(secret));
    });
  }
});
