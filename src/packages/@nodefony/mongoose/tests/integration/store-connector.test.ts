import assert from "node:assert/strict";
import { ormRegistry } from "@nodefony/orm-core";
import { readStoreConnector } from "nodefony";
import { MongooseOrm } from "../../nodefony/src/orm-core/index";
import { mongoTestUri } from "../helpers/mongoTestUri";
import { MongooseTokenStore } from "../../nodefony/src/MongooseTokenStore";
import { MongooseAuditStore } from "../../nodefony/src/MongooseAuditStore";
import { MongooseTotpSecretStore } from "../../nodefony/src/MongooseTotpSecretStore";
import { MongooseWebAuthnCredentialStore } from "../../nodefony/src/MongooseWebAuthnCredentialStore";
import { MongooseWebhookStore } from "../../nodefony/src/MongooseWebhookStore";
import { MongooseIdempotencyStore } from "../../nodefony/src/MongooseIdempotencyStore";
import { registerTokenEntities } from "../../nodefony/entity/tokenEntity";
import { registerAuditEntities } from "../../nodefony/entity/auditEventEntity";
import { registerTotpSecretEntity } from "../../nodefony/entity/totpSecretEntity";
import { registerWebAuthnCredentialEntity } from "../../nodefony/entity/webAuthnCredentialEntity";
import { registerWebhookEndpointEntity } from "../../nodefony/entity/webhookEndpointEntity";
import { registerIdempotencyEntities } from "../../nodefony/entity/idempotencyEntity";

/**
 * **Chaque store durable publie le CONNECTEUR qui le porte.**
 *
 * Le registre des stores disait sur quel ORM une brique était résolue, pas sur
 * quel connecteur : la console le devinait par `location`, absente pour une
 * base réseau — et rangeait alors tout sur le connecteur par défaut. Constaté
 * sur l'application du dépôt démarrée sur PostgreSQL. Le serveur, lui, SAIT :
 * c'est l'ORM passé à `from()`.
 *
 * Le connecteur est volontairement ≠ `default` : un store qui rendrait le
 * connecteur par défaut en dur passerait sinon pour juste.
 */
const CONNECTOR = "banc_connecteur";
const URI = mongoTestUri(CONNECTOR);

describe.skipIf(!URI)(
  "stores Mongoose — le connecteur publié est celui de l'ORM",
  () => {
    let orm: MongooseOrm;

    beforeAll(async () => {
      ormRegistry.unregister(CONNECTOR);
      registerTokenEntities(CONNECTOR);
      registerAuditEntities(CONNECTOR);
      registerTotpSecretEntity(CONNECTOR);
      registerWebAuthnCredentialEntity(CONNECTOR);
      registerWebhookEndpointEntity(CONNECTOR);
      registerIdempotencyEntities(CONNECTOR);
      orm = new MongooseOrm(CONNECTOR, URI as string);
      await orm.connect();
    });
    afterAll(async () => {
      await orm.disconnect();
      ormRegistry.unregister(CONNECTOR);
    });

    it("les six stores construits par `from(orm)` publient le connecteur de l'ORM", () => {
      const stores = {
        tokens: MongooseTokenStore.from(orm),
        audit: MongooseAuditStore.from(orm),
        totp: MongooseTotpSecretStore.from(orm),
        webauthn: MongooseWebAuthnCredentialStore.from(orm),
        webhooks: MongooseWebhookStore.from(orm),
        idempotency: MongooseIdempotencyStore.from(orm),
      };
      for (const [brick, store] of Object.entries(stores)) {
        assert.equal(
          readStoreConnector(store),
          CONNECTOR,
          `la brique « ${brick} » ne publie pas son connecteur`,
        );
      }
    });

    it("un store construit sans ORM (banc) ne publie AUCUN connecteur", () => {
      const orphan = new MongooseIdempotencyStore(() => null);
      assert.equal(readStoreConnector(orphan), undefined);
    });
  },
);
