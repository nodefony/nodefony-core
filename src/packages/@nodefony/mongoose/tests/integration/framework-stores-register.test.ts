import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import {
  listAuditStores,
  listTokenStores,
  listTotpStores,
  listWebAuthnStores,
  listWebhookStores,
  getAuditStoreFactory,
  getTotpStoreFactory,
} from "@nodefony/security";
import {
  listIdempotencyStores,
  getIdempotencyStoreFactory,
} from "@nodefony/framework";
import { listUserStores, registerUserStore } from "@nodefony/user";
import { mongoTestUri } from "../helpers/mongoTestUri";
import { MongooseOrm } from "../../nodefony/src/orm-core/index";
import {
  registerMongooseFrameworkStores,
  FRAMEWORK_CONNECTOR,
} from "../../nodefony/registerStores";
import { AUDIT_ENTITY_NAMES } from "../../nodefony/entity/auditEventEntity";
import { TOTP_SECRET_ENTITY } from "../../nodefony/entity/totpSecretEntity";
import { IDEMPOTENCY_ENTITY_NAME } from "../../nodefony/entity/idempotencyEntity";
import { TOKEN_ENTITY_NAMES } from "../../nodefony/entity/tokenEntity";
import { WEBAUTHN_CREDENTIAL_ENTITY } from "../../nodefony/entity/webAuthnCredentialEntity";
import { WEBHOOK_ENDPOINT_ENTITY } from "../../nodefony/entity/webhookEndpointEntity";
import {
  runStoreManifestContract,
  type StoreManifestBrick,
} from "../../../security/tests/support/storeManifestContract";
import { DURABLE_BRICKS } from "../../../security/tests/support/durableBricks";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Les entités du schéma framework portées par cet adaptateur. */
const has = (entity: string) => () =>
  entityRegistry.has(entity, FRAMEWORK_CONNECTOR);

const BRICKS: readonly StoreManifestBrick[] = [
  // La session n'a pas de fabrique par brique : le STORAGE s'enregistre auprès
  // du `SessionsService` à l'import du module, et son entité est posée par son
  // propre `@entity` — d'où l'absence des deux lecteurs ici.
  { brick: "session" },
  { brick: "user", backends: listUserStores },
  {
    brick: "tokens",
    backends: listTokenStores,
    entityPresent: has(TOKEN_ENTITY_NAMES.records),
  },
  {
    brick: "passkeys",
    backends: listWebAuthnStores,
    entityPresent: has(WEBAUTHN_CREDENTIAL_ENTITY),
  },
  {
    brick: "totp",
    backends: listTotpStores,
    entityPresent: has(TOTP_SECRET_ENTITY),
  },
  {
    brick: "audit",
    backends: listAuditStores,
    entityPresent: has(AUDIT_ENTITY_NAMES.events),
  },
  {
    brick: "webhooks",
    backends: listWebhookStores,
    entityPresent: has(WEBHOOK_ENDPOINT_ENTITY),
  },
  {
    brick: "idempotency",
    backends: listIdempotencyStores,
    entityPresent: has(IDEMPOTENCY_ENTITY_NAME),
  },
];

describe("Mongoose — couverture des briques framework", () => {
  beforeAll(() => {
    // L'auto-register est idempotent (guards) : le rejouer ici est sans effet
    // s'il a déjà eu lieu, et suffisant s'il est le premier.
    registerUserStore("mongoose");
    registerMongooseFrameworkStores();
  });

  afterAll(() => {
    for (const { brick } of BRICKS) {
      void brick;
    }
    for (const entity of [
      TOKEN_ENTITY_NAMES.records,
      WEBAUTHN_CREDENTIAL_ENTITY,
      TOTP_SECRET_ENTITY,
      AUDIT_ENTITY_NAMES.events,
      WEBHOOK_ENDPOINT_ENTITY,
      IDEMPOTENCY_ENTITY_NAME,
    ]) {
      entityRegistry.unregister(entity, FRAMEWORK_CONNECTOR);
    }
  });

  runStoreManifestContract({
    packageJsonPath: join(HERE, "..", "..", "package.json"),
    engine: "mongoose",
    storeKind: "durable",
    bricks: BRICKS,
    durableBricks: DURABLE_BRICKS,
  });

  // ── Un nom au registre ne prouve rien : la fabrique doit RENDRE un store ────
  describe("les fabriques rendent un store VIVANT", () => {
    const ORM = "register_test";
    const URI = mongoTestUri(ORM);
    let orm: MongooseOrm;

    beforeAll(async () => {
      if (!URI) return;
      // Le connecteur du framework est le nom que les fabriques résolvent :
      // sans lui, la résolution lèverait — c'est justement ce qu'on veut
      // exercer pour de vrai, pas simuler.
      orm = new MongooseOrm(FRAMEWORK_CONNECTOR, URI);
      await orm.connect();
    });

    afterAll(async () => {
      if (!URI) return;
      await orm?.disconnect();
      ormRegistry.unregister(FRAMEWORK_CONNECTOR);
    });

    it.skipIf(!URI)(
      "audit / totp / idempotence se fabriquent et répondent",
      async () => {
        // C'est l'appel de la fabrique qui dit si l'entité, le connecteur et le
        // modèle s'accordent vraiment — un nom au registre ne le dit pas.
        const audit = getAuditStoreFactory("mongoose")!({} as never);
        assert.ok((await audit.listPage({ limit: 1 })).items.length >= 0);

        const totp = getTotpStoreFactory("mongoose")!({} as never);
        assert.equal(await totp.findByUser("personne"), null);

        const idem = getIdempotencyStoreFactory("mongoose")!({} as never);
        assert.deepEqual(await idem.begin("register-probe", "fp"), {
          state: "fresh",
        });
        await idem.abort("register-probe");
      },
    );
  });
});
