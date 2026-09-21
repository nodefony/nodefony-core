import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { entityRegistry } from "@nodefony/orm-core";
import {
  listAuditStores,
  listTokenStores,
  listTotpStores,
  listWebAuthnStores,
  listWebhookStores,
} from "@nodefony/security";
import { listIdempotencyStores } from "@nodefony/framework";
import { listUserStores, registerUserStore } from "@nodefony/user";
import {
  registerDrizzleFrameworkStores,
  FRAMEWORK_CONNECTOR,
} from "../../nodefony/registerStores";
import { AUDIT_ENTITY_NAMES } from "../../nodefony/entity/auditEventEntity";
import { TOTP_SECRET_ENTITY } from "../../nodefony/entity/totpSecretEntity";
import { IDEMPOTENCY_ENTITY_NAME } from "../../nodefony/entity/idempotencyEntity";
import { TOKEN_ENTITY_NAMES } from "../../nodefony/entity/tokenEntity";
import { WEBAUTHN_CREDENTIAL_ENTITY } from "../../nodefony/entity/webAuthnCredentialEntity";
import { WEBHOOK_ENDPOINT_ENTITY } from "../../nodefony/entity/webhookEndpointEntity";
import { SESSION_ENTITY_NAME } from "../../nodefony/entity/sessionEntity";
import {
  runStoreManifestContract,
  type StoreManifestBrick,
} from "../../../security/tests/support/storeManifestContract";
import { DURABLE_BRICKS } from "../../../security/tests/support/durableBricks";

/**
 * Enveloppe Drizzle du contrat de manifeste — le banc vit chez
 * `@nodefony/security`, et `@nodefony/mongoose` branche EXACTEMENT le même.
 *
 * Rien n'appariait jusqu'ici `nodefony.stores` du `package.json` (ce que lit
 * `readAdapterManifest` de `KernelAdminApi`, qui alimente l'écran « Stores »)
 * aux registres réels — pour AUCUN adaptateur. Une brique retirée du code
 * serait restée annoncée par la console, et sa sélection aurait échoué au boot.
 */
const HERE = dirname(fileURLToPath(import.meta.url));

/** Les entités du schéma framework portées par cet adaptateur. */
const has = (entity: string) => () =>
  entityRegistry.has(entity, FRAMEWORK_CONNECTOR);

const BRICKS: readonly StoreManifestBrick[] = [
  // Le STORAGE de session s'enregistre auprès du `SessionsService` à l'import
  // du module (pas de registre par backend) ; seule son ENTITÉ est posée ici.
  { brick: "session", entityPresent: has(SESSION_ENTITY_NAME) },
  { brick: "user", backends: listUserStores, entityPresent: has("User") },
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

describe("Drizzle — couverture des briques framework", () => {
  beforeAll(() => {
    // Idempotent (guards) : sans effet si un autre banc l'a déjà appelé. Le
    // dialecte importe peu ici — on vérifie la DÉCLARATION, pas l'exécution ;
    // sqlite porte les huit briques comme les deux autres.
    registerUserStore("drizzle");
    registerDrizzleFrameworkStores("sqlite");
  });

  afterAll(() => {
    for (const entity of [
      SESSION_ENTITY_NAME,
      "User",
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
    engine: "drizzle",
    storeKind: "durable",
    bricks: BRICKS,
    durableBricks: DURABLE_BRICKS,
  });
});
