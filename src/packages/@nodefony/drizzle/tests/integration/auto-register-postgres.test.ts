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
  FRAMEWORK_CONNECTOR,
  DrizzleOrm,
} from "../../index";

/**
 * Auto-enregistrement des stores framework, scénario **postgres** (S2
 * multi-dialecte) — fichier séparé du scénario sqlite : l'isolation par
 * fichier vitest garantit un registre vierge = un seul dialecte de wire par
 * process, comme un boot réel. AUCUNE connexion PG requise ici (pur registre) —
 * la preuve runtime PG vit dans les e2e `*-postgres.e2e.test.ts`.
 *
 * Contrat de portage : session (S1), User + access_token + webauthn_credential
 * + totp_secret (S2), audit_event + webhook_endpoint (S3), idempotency_key
 * (Slice 0) — les 8 briques framework portées sqlite+postgres.
 */

const nullContainer = { get: () => null } as unknown as Container;
const minimalConfig = {
  tokenStore: { retentionRevokedDays: 30 },
} as unknown as ISecurityConfig;

describe("registerDrizzleFrameworkStores — auto-register postgres (S2)", () => {
  it("report : les 8 briques framework registered, plus AUCUNE unported", () => {
    const report = registerDrizzleFrameworkStores("postgres");
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

  it("fail-loud : la fabrique déclarée pour postgres REFUSE un ORM connecté d'un autre dialecte", async () => {
    // Schéma framework déclaré en pgTable (run postgres ci-dessus) : monter le
    // store sur un ORM sqlite serait une incohérence de config → erreur franche
    // nommant les deux dialectes (défense en profondeur, en plus du check des
    // tables au connect). Purger d'abord les entités pgTable du registre : le
    // connect sqlite les refuserait AVANT d'atteindre le check visé (on veut un
    // ORM vivant, base vide).
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
      entityRegistry.unregister(name, FRAMEWORK_CONNECTOR);
    }
    const orm = new DrizzleOrm(FRAMEWORK_CONNECTOR, { filename: ":memory:" });
    await orm.connect();
    const factory = getTokenStoreFactory("drizzle");
    assert.ok(factory, "fabrique drizzle absente du registre token");
    try {
      assert.throws(
        () => factory({ container: nullContainer, config: minimalConfig }),
        /en "sqlite" mais le schéma framework a été déclaré en "postgres"/,
      );
    } finally {
      await orm.disconnect();
      ormRegistry.unregister?.(FRAMEWORK_CONNECTOR);
    }
  });
});
