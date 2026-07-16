import assert from "node:assert/strict";
import { mongoTestUri } from "../helpers/mongoTestUri";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { IAccessTokenRecord } from "@nodefony/security";
import { MongooseOrm } from "../../nodefony/src/orm-core/index";
import { MongooseTokenStore } from "../../nodefony/src/MongooseTokenStore";
import {
  registerTokenEntities,
  TOKEN_ENTITY_NAMES,
} from "../../nodefony/entity/tokenEntity";

const ORM = "tokens_test";
// Serveur Mongo partagé (globalSetup) scopé sur la base `tokens_test` ; `null`
// → infra indisponible → suite skippée.
const URI = mongoTestUri(ORM);

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

describe.skipIf(!URI)(
  "Mongoose MongooseTokenStore — ITokenStore portable (J4b)",
  () => {
    let orm: MongooseOrm;
    let store: MongooseTokenStore;

    beforeAll(async () => {
      registerTokenEntities(ORM); // AVANT connect (compilation des 3 modèles)
      orm = new MongooseOrm(ORM, URI!);
      await orm.connect();
      // Ardoise propre (Mongo externe partagé).
      await orm.getRepository(TOKEN_ENTITY_NAMES.records).delete({});
      await orm.getRepository(TOKEN_ENTITY_NAMES.denied).delete({});
      await orm.getRepository(TOKEN_ENTITY_NAMES.revocations).delete({});
      store = MongooseTokenStore.from(orm, now, 30 * 24 * 3_600_000);
    });

    afterAll(async () => {
      await orm?.disconnect();
      entityRegistry.unregister(TOKEN_ENTITY_NAMES.records);
      entityRegistry.unregister(TOKEN_ENTITY_NAMES.denied);
      entityRegistry.unregister(TOKEN_ENTITY_NAMES.revocations);
      ormRegistry.unregister(ORM);
    });

    // ── Records : put / lookups (id = jti porté par _id) ────────────────────────
    describe("records (put / find)", () => {
      it("put + findById restitue le record (id = jti, JSON inclus)", async () => {
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
        assert.equal(r.id, "t1");
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
        assert.equal(all[0].id, "t1");
      });

      it("put CONCURRENT du même id : aucun rejet, une seule ligne (réservation atomique)", async () => {
        // Un `findOne` + `create` laisse deux appels concurrents lire « absent »
        // (l'`await` du find cède la main) puis insérer tous les deux → le
        // perdant se prend un E11000 duplicate key sur `_id`. Le remède est
        // l'instruction atomique unique (`upsert` = findOneAndUpdate upsert:true),
        // pas une transaction. Parité stricte avec l'adapter Drizzle.
        const base = makeRecord({ id: "conc-1", subjectId: "u-conc" });
        const results = await Promise.allSettled([
          store.put({ ...base, name: "A" }),
          store.put({ ...base, name: "B" }),
        ]);
        assert.deepEqual(
          results
            .filter((r) => r.status === "rejected")
            .map((r) => (r as PromiseRejectedResult).reason?.message),
          [],
          "aucun put concurrent ne doit être rejeté",
        );
        const all = await store.findBySubject("u-conc");
        assert.equal(all.length, 1, "une seule ligne pour la PK");
        assert.ok(["A", "B"].includes(all[0].name));
      });

      it("findById renvoie null pour un id inconnu", async () => {
        assert.equal(await store.findById("nope"), null);
      });

      it("markUsed pose lastUsedAt/ip/ua ; no-op si id inconnu", async () => {
        await store.markUsed("t1", {
          at: 1234,
          ip: "10.0.0.1",
          userAgent: "ua",
        });
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
        await store.put(
          makeRecord({ id: "f2", kind: "refresh", family: "fam" }),
        );
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

      it("denyJti CONCURRENT du même jti : aucun rejet (réservation atomique)", async () => {
        // Un jeton rejoué dénoncé deux fois en parallèle ne doit pas faire
        // remonter un E11000 — donc pas de 500 sur un chemin de sécurité.
        CLOCK = 6_000_000;
        const results = await Promise.allSettled([
          store.denyJti("jti-conc", 7_000_000),
          store.denyJti("jti-conc", 8_000_000),
        ]);
        assert.deepEqual(
          results
            .filter((r) => r.status === "rejected")
            .map((r) => (r as PromiseRejectedResult).reason?.message),
          [],
          "aucun denyJti concurrent ne doit être rejeté",
        );
        assert.equal(await store.isJtiDenied("jti-conc"), true);
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

      it("CONCURRENT : le seuil ne RECULE pas (sinon des jetons révoqués redeviennent valides)", async () => {
        // Séquentiel (test précédent), la monotonie tient ; c'est ICI qu'elle
        // casse. Un `findOne` + `if (v > existant)` laisse deux logouts
        // simultanés lire le MÊME état puis écrire tous les deux → le DERNIER
        // reste, même porteur d'un seuil plus ancien → les jetons que le logout
        // le plus récent venait d'invalider redeviennent valides.
        const results = await Promise.allSettled([
          store.revokeAllForSubject("u-race", 9_000),
          store.revokeAllForSubject("u-race", 1_000), // retardataire, plus ancien
        ]);
        assert.deepEqual(
          results
            .filter((r) => r.status === "rejected")
            .map((r) => (r as PromiseRejectedResult).reason?.message),
          [],
          "aucun logout concurrent ne doit être rejeté",
        );
        assert.equal(
          await store.getInvalidBefore("u-race"),
          9_000,
          "le seuil le plus RÉCENT survit",
        );
      });

      it("CONCURRENT × 10 en ordre dispersé : le maximum survit", async () => {
        const seuils = [
          500, 9_000, 1_200, 4_000, 700, 10_000, 3_300, 200, 6_100, 800,
        ];
        await Promise.all(
          seuils.map((s) => store.revokeAllForSubject("u-race10", s)),
        );
        assert.equal(await store.getInvalidBefore("u-race10"), 10_000);
      });
    });

    // ── Garbage collector ───────────────────────────────────────────────────────
    describe("gc (purge portable, type bracketing Mongo)", () => {
      it("purge expirés/denylist/PAT révoqués anciens, garde le reste", async () => {
        CLOCK = 10_000_000;
        const NOW = CLOCK;
        const RET = 30 * 24 * 3_600_000;

        // Pré-purge : vide les résidus expirés des describe précédents (store
        // partagé) pour mesurer le DELTA exact du scénario ci-dessous.
        await store.gc(NOW);

        await store.put(
          makeRecord({ id: "gc-exp", kind: "refresh", expiresAt: NOW - 1 }),
        );
        await store.put(
          makeRecord({
            id: "gc-fresh",
            kind: "refresh",
            expiresAt: NOW + 1_000,
          }),
        );
        await store.put(
          makeRecord({
            id: "gc-old-revoked",
            expiresAt: null,
            revokedAt: NOW - RET - 1,
            revokedReason: "manual",
          }),
        );
        await store.put(
          makeRecord({
            id: "gc-recent-revoked",
            expiresAt: null,
            revokedAt: NOW - 1_000,
            revokedReason: "manual",
          }),
        );
        await store.denyJti("gc-jti-old", NOW - 1);
        await store.denyJti("gc-jti-live", NOW + 10_000);

        const purged = await store.gc(NOW);
        assert.equal(purged, 3); // gc-exp + gc-old-revoked + gc-jti-old

        assert.equal(await store.findById("gc-exp"), null);
        assert.ok(await store.findById("gc-fresh"));
        assert.equal(await store.findById("gc-old-revoked"), null);
        assert.ok(await store.findById("gc-recent-revoked"));
        assert.equal(await store.isJtiDenied("gc-jti-live"), true);
      });
    });
  },
);
