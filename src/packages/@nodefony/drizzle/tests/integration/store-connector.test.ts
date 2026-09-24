import assert from "node:assert/strict";
import { ormRegistry } from "@nodefony/orm-core";
import { readStoreConnector } from "nodefony";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
import { DrizzleTokenStore } from "../../nodefony/src/DrizzleTokenStore";
import { DrizzleAuditStore } from "../../nodefony/src/DrizzleAuditStore";
import { DrizzleTotpSecretStore } from "../../nodefony/src/DrizzleTotpSecretStore";
import { DrizzleWebAuthnCredentialStore } from "../../nodefony/src/DrizzleWebAuthnCredentialStore";
import { DrizzleWebhookStore } from "../../nodefony/src/DrizzleWebhookStore";
import { DrizzleIdempotencyStore } from "../../nodefony/src/DrizzleIdempotencyStore";
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
describe("stores Drizzle — le connecteur publié est celui de l'ORM", () => {
  const CONNECTOR = "banc_connecteur";
  let orm: DrizzleOrm;

  beforeAll(async () => {
    ormRegistry.unregister(CONNECTOR);
    registerTokenEntities(CONNECTOR);
    registerAuditEntities(CONNECTOR);
    registerTotpSecretEntity(CONNECTOR);
    registerWebAuthnCredentialEntity(CONNECTOR);
    registerWebhookEndpointEntity(CONNECTOR);
    registerIdempotencyEntities(CONNECTOR);
    orm = new DrizzleOrm(CONNECTOR, { filename: ":memory:" });
    await orm.connect();
  });
  afterAll(async () => {
    await orm.disconnect();
    ormRegistry.unregister(CONNECTOR);
  });

  it("les six stores construits par `from(orm)` publient le connecteur de l'ORM", () => {
    const stores = {
      tokens: DrizzleTokenStore.from(orm),
      audit: DrizzleAuditStore.from(orm),
      totp: DrizzleTotpSecretStore.from(orm),
      webauthn: DrizzleWebAuthnCredentialStore.from(orm),
      webhooks: DrizzleWebhookStore.from(orm),
      idempotency: DrizzleIdempotencyStore.from(orm),
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
    const orphan = new DrizzleIdempotencyStore(() => null);
    assert.equal(readStoreConnector(orphan), undefined);
  });
});
