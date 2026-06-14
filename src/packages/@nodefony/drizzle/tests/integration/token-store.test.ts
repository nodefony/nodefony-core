import assert from "node:assert/strict";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { IAccessTokenRecord } from "@nodefony/security";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
import { DrizzleTokenStore } from "../../nodefony/src/DrizzleTokenStore";
import {
  registerTokenEntities,
  TOKEN_ENTITY_NAMES,
} from "../../nodefony/entity/tokenEntity";

const ORM = "tokens_test";

/** Horloge contrôlée (epoch ms) → tests déterministes (rétention, expiration). */
let CLOCK = 1_000_000;
const now = () => CLOCK;

/** Construit un `IAccessTokenRecord` complet (24 champs) avec surcharges. */
function makeRecord(
  over: Partial<IAccessTokenRecord> & Pick<IAccessTokenRecord, "id">,
): IAccessTokenRecord {
  return {
    kind: "pat",
    name: "test",
    prefix: null,
    subjectId: "u1",
    subjectType: "user",
    tenantId: null,
    scopes: [],
    audience: [],
    resources: null,
    secretHash: `hash-${over.id}`,
    hashAlg: "sha256",
    clientId: null,
    cnf: null,
    family: null,
    replacedBy: null,
    createdAt: CLOCK,
    expiresAt: null,
    lastUsedAt: null,
    lastUsedIp: null,
    lastUsedUserAgent: null,
    revokedAt: null,
    revokedReason: null,
    metadata: {},
    ...over,
  };
}

describe("Drizzle DrizzleTokenStore — ITokenStore portable (J4b)", () => {
  let orm: DrizzleOrm;
  let store: DrizzleTokenStore;

  beforeAll(async () => {
    registerTokenEntities(ORM); // AVANT connect (création des 3 tables au boot)
    orm = new DrizzleOrm(ORM, { filename: ":memory:" });
    await orm.connect();
    store = DrizzleTokenStore.from(orm, now, 30 * 24 * 3_600_000);
  });

  afterAll(async () => {
    await orm.disconnect();
    entityRegistry.unregister(TOKEN_ENTITY_NAMES.records);
    entityRegistry.unregister(TOKEN_ENTITY_NAMES.denied);
    entityRegistry.unregister(TOKEN_ENTITY_NAMES.revocations);
    ormRegistry.unregister(ORM);
  });

  // ── Records : put / lookups ─────────────────────────────────────────────────
  describe("records (put / find)", () => {
    it("put + findById restitue le record (JSON désérialisé)", async () => {
      await store.put(
        makeRecord({
          id: "t1",
          scopes: ["orders:read", "orders:write"],
          audience: ["api"],
          metadata: { ci: true },
        }),
      );
      const r = await store.findById("t1");
      assert.ok(r);
      assert.deepEqual(r.scopes, ["orders:read", "orders:write"]);
      assert.deepEqual(r.audience, ["api"]);
      assert.deepEqual(r.metadata, { ci: true });
      assert.equal(r.kind, "pat");
      assert.equal(r.expiresAt, null);
    });

    it("findByHash retrouve par hash de secret", async () => {
      const r = await store.findByHash("hash-t1");
      assert.equal(r?.id, "t1");
      assert.equal(await store.findByHash("inconnu"), null);
    });

    it("put sur le même id met à jour sans doublon (upsert)", async () => {
      await store.put(makeRecord({ id: "t1", name: "renommé" }));
      const all = await store.findBySubject("u1");
      assert.equal(all.length, 1);
      assert.equal(all[0].name, "renommé");
    });

    it("findById renvoie null pour un id inconnu", async () => {
      assert.equal(await store.findById("nope"), null);
    });

    it("markUsed pose lastUsedAt/ip/ua ; no-op si id inconnu", async () => {
      await store.markUsed("t1", { at: 1234, ip: "10.0.0.1", userAgent: "ua" });
      const r = await store.findById("t1");
      assert.equal(r?.lastUsedAt, 1234);
      assert.equal(r?.lastUsedIp, "10.0.0.1");
      assert.equal(r?.lastUsedUserAgent, "ua");
      await store.markUsed("nope", { at: 1 }); // ne jette pas
    });
  });

  // ── Révocation ──────────────────────────────────────────────────────────────
  describe("révocation", () => {
    it("revoke est idempotent et conserve la 1ʳᵉ date/raison", async () => {
      await store.put(makeRecord({ id: "rev1" }));
      CLOCK = 2_000_000;
      await store.revoke("rev1", "logout");
      const first = await store.findById("rev1");
      assert.equal(first?.revokedAt, 2_000_000);
      assert.equal(first?.revokedReason, "logout");

      CLOCK = 3_000_000;
      await store.revoke("rev1", "manual"); // 2ᵉ appel : ne doit RIEN changer
      const second = await store.findById("rev1");
      assert.equal(second?.revokedAt, 2_000_000);
      assert.equal(second?.revokedReason, "logout");
    });

    it("revokeFamily coupe les membres actifs et préserve les déjà-révoqués", async () => {
      await store.put(
        makeRecord({
          id: "f1",
          kind: "refresh",
          family: "fam",
          revokedAt: 500,
          revokedReason: "rotated",
        }),
      );
      await store.put(makeRecord({ id: "f2", kind: "refresh", family: "fam" }));
      CLOCK = 4_000_000;
      await store.revokeFamily("fam", "reuse_detected");

      const rotated = await store.findById("f1");
      assert.equal(rotated?.revokedAt, 500); // inchangé
      assert.equal(rotated?.revokedReason, "rotated");
      const cut = await store.findById("f2");
      assert.equal(cut?.revokedAt, 4_000_000);
      assert.equal(cut?.revokedReason, "reuse_detected");
    });
  });

  // ── Denylist jti ────────────────────────────────────────────────────────────
  describe("denylist jti", () => {
    it("denyJti puis isJtiDenied = true tant que non expiré", async () => {
      CLOCK = 5_000_000;
      await store.denyJti("jti-a", 5_500_000);
      assert.equal(await store.isJtiDenied("jti-a"), true);
    });

    it("une entrée expirée n'est plus dénoncée", async () => {
      CLOCK = 6_000_000; // > 5_500_000
      assert.equal(await store.isJtiDenied("jti-a"), false);
    });

    it("denyJti écrase l'expiration (upsert)", async () => {
      CLOCK = 6_000_000;
      await store.denyJti("jti-a", 7_000_000);
      assert.equal(await store.isJtiDenied("jti-a"), true);
    });

    it("isJtiDenied = false pour un jti inconnu", async () => {
      assert.equal(await store.isJtiDenied("jamais"), false);
    });
  });

  // ── Révocation en masse par porteur ─────────────────────────────────────────
  describe("revokeAllForSubject (seuil monotone)", () => {
    it("pose puis renvoie le seuil ; monotone (ne recule pas)", async () => {
      assert.equal(await store.getInvalidBefore("u9"), null);
      await store.revokeAllForSubject("u9", 1000);
      assert.equal(await store.getInvalidBefore("u9"), 1000);
      await store.revokeAllForSubject("u9", 500); // recul ignoré
      assert.equal(await store.getInvalidBefore("u9"), 1000);
      await store.revokeAllForSubject("u9", 2000); // avance acceptée
      assert.equal(await store.getInvalidBefore("u9"), 2000);
    });
  });

  // ── Garbage collector ───────────────────────────────────────────────────────
  describe("gc (purge portable, sans IS NULL natif)", () => {
    it("purge expirés/denylist/PAT révoqués anciens, garde le reste", async () => {
      CLOCK = 10_000_000;
      const NOW = CLOCK;
      const RET = 30 * 24 * 3_600_000;

      // Pré-purge : vide les résidus expirés des describe précédents (store
      // partagé) pour mesurer le DELTA exact du scénario ci-dessous.
      await store.gc(NOW);

      // (a) refresh expiré → purgé
      await store.put(
        makeRecord({
          id: "gc-exp",
          kind: "refresh",
          expiresAt: NOW - 1,
        }),
      );
      // (b) refresh frais → gardé
      await store.put(
        makeRecord({ id: "gc-fresh", kind: "refresh", expiresAt: NOW + 1_000 }),
      );
      // (c) PAT révoqué sans exp, AU-DELÀ rétention → purgé
      await store.put(
        makeRecord({
          id: "gc-old-revoked",
          expiresAt: null,
          revokedAt: NOW - RET - 1,
          revokedReason: "manual",
        }),
      );
      // (d) PAT révoqué sans exp, DANS la rétention → gardé (audit)
      await store.put(
        makeRecord({
          id: "gc-recent-revoked",
          expiresAt: null,
          revokedAt: NOW - 1_000,
          revokedReason: "manual",
        }),
      );
      // (e) denylist jti expirée → purgée ; (f) denylist active → gardée
      await store.denyJti("gc-jti-old", NOW - 1);
      await store.denyJti("gc-jti-live", NOW + 10_000);

      const purged = await store.gc(NOW);
      assert.equal(purged, 3); // (a) + (c) + (e)

      assert.equal(await store.findById("gc-exp"), null);
      assert.ok(await store.findById("gc-fresh"));
      assert.equal(await store.findById("gc-old-revoked"), null);
      assert.ok(await store.findById("gc-recent-revoked"));
      assert.equal(await store.isJtiDenied("gc-jti-live"), true);
    });
  });
});
