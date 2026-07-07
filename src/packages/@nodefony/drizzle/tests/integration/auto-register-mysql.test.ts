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
 * Auto-enregistrement des stores framework, scénario **mysql** (S4
 * multi-dialecte) — fichier séparé des scénarios sqlite/postgres : l'isolation
 * par fichier vitest garantit un registre vierge = un seul dialecte de wire
 * par process, comme un boot réel. AUCUNE connexion MySQL requise ici (pur
 * registre) — la preuve runtime vit dans les e2e `*-mysql.e2e.test.ts`.
 *
 * Ce test GRAVE la matrice de portage courante : les 8 briques framework
 * portées sqlite+postgres+mysql — il casse PAR DESIGN si une brique régresse.
 */

const nullContainer = { get: () => null } as unknown as Container;
const minimalConfig = {
  tokenStore: { retentionRevokedDays: 30 },
} as unknown as ISecurityConfig;

describe("registerDrizzleFrameworkStores — auto-register mysql (S4)", () => {
  it("report : les 8 briques framework registered, plus AUCUNE unported", () => {
    const report = registerDrizzleFrameworkStores("mysql");
    assert.deepStrictEqual(report.registered, [
      "session",
      "User",
      "access_token",
      "audit_event",
      "webauthn_credential",
      "totp_secret",
      "webhook_endpoint",
      "idempotency_key",
    ]);
    assert.strictEqual(report.appOwned.length, 0);
    assert.deepStrictEqual([...report.unported], []);
  });

  it("les registres reflètent le RÉEL : fabriques présentes pour les 8 briques portées", () => {
    assert.ok(listTokenStores().includes("drizzle"));
    assert.ok(listWebAuthnStores().includes("drizzle"));
    assert.ok(listTotpStores().includes("drizzle"));
    assert.ok(listIdempotencyStores().includes("drizzle"));
    assert.ok(listAuditStores().includes("drizzle"));
    assert.ok(listWebhookStores().includes("drizzle"));
  });

  it("fail-loud : la fabrique déclarée pour mysql REFUSE un ORM connecté d'un autre dialecte", async () => {
    for (const name of [
      "session",
      "User",
      "access_token",
      "denied_jti",
      "subject_revocation",
      "audit_event",
      "webauthn_credential",
      "totp_secret",
      "webhook_endpoint",
      "idempotency_key",
    ]) {
      entityRegistry.unregister(name, FRAMEWORK_ORM);
    }
    const orm = new DrizzleOrm(FRAMEWORK_ORM, { filename: ":memory:" });
    await orm.connect();
    const factory = getTokenStoreFactory("drizzle");
    assert.ok(factory, "fabrique drizzle absente du registre token");
    try {
      assert.throws(
        () => factory({ container: nullContainer, config: minimalConfig }),
        /en "sqlite" mais le schéma framework a été déclaré en "mysql"/,
      );
    } finally {
      await orm.disconnect();
      ormRegistry.unregister?.(FRAMEWORK_ORM);
    }
  });
});
