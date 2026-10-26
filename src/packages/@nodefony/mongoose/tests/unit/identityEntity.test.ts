import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import { Schema } from "mongoose";
import type { SchemaDefinition } from "mongoose";
import {
  USER_PRIVATE_FIELDS,
  USER_TABLE_NAME,
  entityPrivateFields,
  isIdentityEntity,
} from "@nodefony/user";
import { createUserEntity, userSchema } from "../../nodefony/entity/userEntity";
import {
  accessTokenSchema,
  createTokenEntities,
  TOKEN_ENTITY_NAMES,
} from "../../nodefony/entity/tokenEntity";
import {
  createTotpSecretEntity,
  totpSecretSchema,
} from "../../nodefony/entity/totpSecretEntity";
import {
  createWebhookEndpointEntity,
  webhookEndpointSchema,
} from "../../nodefony/entity/webhookEndpointEntity";

/**
 * Pendant document de `drizzle/tests/unit/identityEntity.test.ts` : l'entité
 * d'identité se désigne au contrat (`isIdentityEntity`), jamais par un `"User"`
 * recopié — sinon le défaut fermé des champs privés tomberait sans un mot le
 * jour où son nom change.
 */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SOURCES = path.join(ICI, "..", "..", "nodefony");

/** Chemins d'un schéma, sous le `has` que l'ORM passe au contrat. */
const chemins = (definition: SchemaDefinition) => {
  const schema = new Schema(definition);
  return (field: string): boolean => schema.pathType(field) === "real";
};

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
  it("le descripteur livré est reconnu et reçoit le défaut fermé", () => {
    const entity = createUserEntity("default");
    assert.equal(isIdentityEntity(entity), true);
    assert.equal(entity.name, USER_TABLE_NAME);
    const hidden = entityPrivateFields(entity, chemins(userSchema));
    for (const field of USER_PRIVATE_FIELDS) {
      assert.ok(hidden?.includes(field), field);
    }
  });

  it("aucune source de l'adaptateur n'écrit le nom de l'entité d'identité en clair", () => {
    const fautifs: string[] = [];
    for (const relatif of readdirSync(SOURCES, {
      recursive: true,
      encoding: "utf8",
    })) {
      if (!relatif.endsWith(".ts")) continue;
      lignesDeCode(path.join(SOURCES, relatif)).forEach(([numero, ligne]) => {
        if (/["'`]User["'`]/u.test(ligne)) {
          fautifs.push(`${relatif}:${numero} ${ligne.trim()}`);
        }
      });
    }
    assert.deepEqual(fautifs, []);
  });
});

describe("entités du framework à secret — le secret ne sort pas par un peuplement", () => {
  const cas = [
    {
      entity: createTotpSecretEntity("default"),
      has: chemins(totpSecretSchema),
      secret: "secretEnc",
    },
    {
      entity: createWebhookEndpointEntity("default"),
      has: chemins(webhookEndpointSchema),
      secret: "secretEnc",
    },
    {
      entity: createTokenEntities("default").find(
        (e) => e.name === TOKEN_ENTITY_NAMES.records,
      ),
      has: chemins(accessTokenSchema),
      secret: "secretHash",
    },
  ];

  for (const { entity, has, secret } of cas) {
    it(`${entity?.name ?? "?"} tait ${secret}`, () => {
      assert.ok(entity, "descripteur introuvable");
      assert.equal(isIdentityEntity(entity), false);
      assert.ok(entityPrivateFields(entity, has)?.includes(secret));
    });
  }
});
