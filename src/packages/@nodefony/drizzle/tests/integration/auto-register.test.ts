import assert from "node:assert";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import {
  listTokenStores,
  listAuditStores,
  listWebAuthnStores,
  listTotpStores,
  listWebhookStores,
  getTokenStoreFactory,
} from "@nodefony/security";
import type { ISecurityConfig } from "@nodefony/security";
import { listIdempotencyStores } from "@nodefony/framework";
import type { Container } from "nodefony";
import {
  registerDrizzleFrameworkStores,
  FRAMEWORK_ORM,
  DrizzleOrm,
} from "../../index";

/**
 * Auto-enregistrement des stores framework (lot 0.8) — « charger le module =
 * backends sélectionnables par nom ». Registres process-wide → tests ordonnés
 * dans CE fichier (isolation par fichier vitest).
 */

const FRAMEWORK_ENTITIES = [
  "session",
  "access_token",
  "audit_event",
  "webauthn_credential",
  "totp_secret",
  "webhook_endpoint",
  "idempotency_key",
] as const;

const nullContainer = { get: () => null } as unknown as Container;
const minimalConfig = {
  tokenStore: { retentionRevokedDays: 30 },
} as unknown as ISecurityConfig;

describe("registerDrizzleFrameworkStores — auto-register (lot 0.8)", () => {
  it("dialecte postgres : session + idempotence portées (S1/Slice 0), le reste annoncé unported", () => {
    const report = registerDrizzleFrameworkStores("postgres");
    assert.deepStrictEqual(report.registered, ["session", "idempotency_key"]);
    assert.strictEqual(report.appOwned.length, 0);
    assert.deepStrictEqual(
      [...report.unported].sort(),
      [
        "access_token",
        "audit_event",
        "webauthn_credential",
        "totp_secret",
        "webhook_endpoint",
      ].sort(),
    );
    // Les registres reflètent le RÉEL : pas de fabrique pour un backend non porté.
    assert.ok(!listTokenStores().includes("drizzle"));
    assert.ok(!listAuditStores().includes("drizzle"));
    assert.ok(!listTotpStores().includes("drizzle"));
    assert.ok(listIdempotencyStores().includes("drizzle"));
  });

  it("dialecte sqlite : les 5 entités restantes sont déclarées + fabriques enregistrées", () => {
    const report = registerDrizzleFrameworkStores("sqlite");
    // session + idempotency_key déjà déclarées par le run postgres → respectées.
    assert.deepStrictEqual(report.appOwned, ["session", "idempotency_key"]);
    assert.strictEqual(report.unported.length, 0);
    assert.deepStrictEqual(
      [...report.registered].sort(),
      [
        "access_token",
        "audit_event",
        "webauthn_credential",
        "totp_secret",
        "webhook_endpoint",
      ].sort(),
    );
    for (const name of FRAMEWORK_ENTITIES) {
      assert.ok(
        entityRegistry.has(name, FRAMEWORK_ORM),
        `entité ${name} absente du registre`,
      );
    }
    assert.ok(listTokenStores().includes("drizzle"));
    assert.ok(listAuditStores().includes("drizzle"));
    assert.ok(listWebAuthnStores().includes("drizzle"));
    assert.ok(listTotpStores().includes("drizzle"));
    assert.ok(listWebhookStores().includes("drizzle"));
    assert.ok(listIdempotencyStores().includes("drizzle"));
  });

  it("rejouable : un nouvel appel ne double-déclare rien (guards idempotents)", () => {
    const report = registerDrizzleFrameworkStores("sqlite");
    assert.strictEqual(report.registered.length, 0);
    assert.strictEqual(report.appOwned.length, FRAMEWORK_ENTITIES.length);
    assert.strictEqual(report.unported.length, 0);
  });

  it("fail-loud : fabrique token sans ORM connecté = erreur franche nommant la cause", () => {
    const factory = getTokenStoreFactory("drizzle");
    assert.ok(factory, "fabrique drizzle absente du registre token");
    assert.throws(
      () => factory({ container: nullContainer, config: minimalConfig }),
      /introuvable|non connecté/,
    );
  });

  it("bout-en-bout : ORM connecté (:memory:) → la fabrique token rend un store opérationnel", async () => {
    // Le 1ᵉʳ test (postgres) a laissé les VARIANTES pgTable (idempotency_key,
    // session) dans le registre process-wide → re-déclarer les variantes sqlite
    // avant le connect (en réel, un seul dialecte par boot — artefact d'ordre).
    entityRegistry.unregister("idempotency_key", FRAMEWORK_ORM);
    entityRegistry.unregister("session", FRAMEWORK_ORM);
    registerDrizzleFrameworkStores("sqlite");
    const orm = new DrizzleOrm(FRAMEWORK_ORM, { filename: ":memory:" });
    await orm.connect(); // compile les entités du registre → tables créées
    try {
      const factory = getTokenStoreFactory("drizzle");
      assert.ok(factory);
      const store = factory({
        container: nullContainer,
        config: minimalConfig,
      });
      assert.strictEqual(typeof store.put, "function");
      assert.strictEqual(typeof store.findById, "function");
      // Round-trip réel sur la table créée par le connect (preuve opérationnelle).
      assert.strictEqual(await store.findById("lot08-absent"), null);
    } finally {
      await orm.disconnect();
      ormRegistry.unregister?.(FRAMEWORK_ORM);
    }
  });
});
