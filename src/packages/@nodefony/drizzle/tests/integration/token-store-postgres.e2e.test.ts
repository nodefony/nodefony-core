import assert from "node:assert/strict";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { IAccessTokenRecord } from "@nodefony/security";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
import { DrizzleTokenStore } from "../../nodefony/src/DrizzleTokenStore";
import {
  registerTokenEntities,
  TOKEN_ENTITY_NAMES,
} from "../../nodefony/entity/tokenEntity";

/**
 * e2e **Postgres** du store de jetons (S2 multi-dialecte) — le
 * `DrizzleTokenStore` complet (3 tables : records / denylist / seuils) sur un
 * PG réel : DDL dérivé (jsonb/bigint), lookups uniques (`secretHash` UNIQUE),
 * révocation idempotente (read-then-write, `revokedAt` NULL PG), gc 3 branches
 * dont le filtre JS `expiresAt === null` (le `IS NULL` non exprimable en
 * critère portable) et les compteurs `rowCount` pg.
 *
 * GATE : ne tourne que si `NF_PG_URL` est posée (sinon skip silencieux) :
 *   docker compose -f docker/docker-compose.yml --profile postgres up -d postgres
 *   NF_PG_URL=postgres://nodefony:nodefony-dev@127.0.0.1:5432/nodefony npm test
 */

const PG_URL = process.env.NF_PG_URL;
const ORM = "tokens_pg_e2e";

let CLOCK = 1_000_000;
const now = () => CLOCK;
const RETENTION_MS = 30 * 24 * 3_600_000;

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

describe.skipIf(!PG_URL)(
  "DrizzleTokenStore — e2e Postgres (S2 multi-dialecte)",
  () => {
    let orm: DrizzleOrm;
    let store: DrizzleTokenStore;

    beforeAll(async () => {
      CLOCK = 1_000_000;
      registerTokenEntities(ORM, "postgres"); // variantes pgTable, AVANT connect
      orm = new DrizzleOrm(ORM, { dialect: "postgres", url: PG_URL });
      await orm.connect(); // DDL dérivé : 3 CREATE TABLE IF NOT EXISTS (jsonb/bigint)
      store = DrizzleTokenStore.from(orm, now, RETENTION_MS);
      // Tables persistantes entre les runs (IF NOT EXISTS) → purge d'entrée.
      await orm.getRepository(TOKEN_ENTITY_NAMES.records).delete({});
      await orm.getRepository(TOKEN_ENTITY_NAMES.denied).delete({});
      await orm.getRepository(TOKEN_ENTITY_NAMES.revocations).delete({});
    });

    afterAll(async () => {
      await orm.disconnect();
      entityRegistry.unregister(TOKEN_ENTITY_NAMES.records, ORM);
      entityRegistry.unregister(TOKEN_ENTITY_NAMES.denied, ORM);
      entityRegistry.unregister(TOKEN_ENTITY_NAMES.revocations, ORM);
      ormRegistry.unregister(ORM);
    });

    it("put + findById : round-trip jsonb (scopes/audience/metadata) + bigint epoch ms", async () => {
      await store.put(
        makeRecord({
          id: "pg-t1",
          scopes: ["orders:read", "orders:write"],
          audience: ["api"],
          metadata: { pod: "A", n: 1 },
          expiresAt: CLOCK + 60_000,
        }),
      );
      const r = await store.findById("pg-t1");
      assert.ok(r);
      assert.deepEqual(r.scopes, ["orders:read", "orders:write"]);
      assert.deepEqual(r.audience, ["api"]);
      assert.deepEqual(r.metadata, { pod: "A", n: 1 });
      assert.equal(r.createdAt, CLOCK, "epoch ms exact via bigint mode number");
      assert.equal(r.expiresAt, CLOCK + 60_000);
      assert.equal(r.revokedAt, null, "NULL PG → null JS");
    });

    it("put rejoué = UPDATE (1 ligne, secretHash UNIQUE respecté) + findByHash", async () => {
      await store.put(makeRecord({ id: "pg-t1", name: "renamed" }));
      const byHash = await store.findByHash("hash-pg-t1");
      assert.equal(byHash?.id, "pg-t1");
      assert.equal(byHash?.name, "renamed");
      const all = await store.findBySubject("u1");
      assert.equal(
        all.filter((r) => r.id === "pg-t1").length,
        1,
        "toujours 1 seule ligne",
      );
    });

    it("put CONCURRENT × 10 d'un record EXISTANT (rotation rejouée) : 0 rejet", async () => {
      // Le cas RÉEL de `put` concurrent sur un même id : la rotation d'un refresh
      // (`tokenService`) réécrit l'ANCIEN record (`replacedBy`/`revokedAt`) — un
      // client qui rejoue son refresh en déclenche plusieurs à la fois. Le record
      // est donc DÉJÀ en base ; l'upsert tombe sur son chemin DO UPDATE.
      //
      // ⚠️ Le cas « ligne absente » n'est PAS testé ici, et c'est délibéré : il
      // n'est pas atteignable (les 3 appelants de `put` posent un id `randomUUID`
      // / `#randomId`, donc jamais deux `put` du même id neuf) — et il divergerait
      // entre dialectes, cf la limite documentée sur `DrizzleTokenStore.put`.
      //
      // CHAUFFER LE POOL, sinon faux négatif : les connexions pg s'ouvrent à la
      // demande, donc le 1ᵉʳ écrivain (seul à tenir une connexion chaude) boucle
      // son aller-retour pendant que les 9 autres attendent leur TCP+auth — la
      // course ne se produit jamais. En prod le pool est chaud.
      const records = orm.getRepository(TOKEN_ENTITY_NAMES.records);
      await Promise.all(Array.from({ length: 10 }, () => records.count({})));

      const base = makeRecord({ id: "pg-conc", subjectId: "u-pg-conc" });
      await store.put(base); // la ligne préexiste (comme l'ancien refresh)
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, (_, i) =>
          store.put({ ...base, name: `writer-${i}` }),
        ),
      );
      const rejected = results.filter((r) => r.status === "rejected");
      assert.deepEqual(
        rejected.map((r) => (r as PromiseRejectedResult).reason?.message),
        [],
        "aucun put concurrent ne doit être rejeté",
      );
      const all = await store.findBySubject("u-pg-conc");
      assert.equal(all.length, 1, "toujours une seule ligne");
      assert.ok(
        /^writer-\d$/.test(all[0].name),
        "la ligne porte l'écrit d'un des 10 (dernier arrivé gagne)",
      );
    });

    it("denyJti CONCURRENT × 10 du même jti : 0 rejet (atomicité RÉELLE, pool PG)", async () => {
      CLOCK = 1_000_000;
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, (_, i) =>
          store.denyJti("jti-pg-conc", CLOCK + 60_000 + i),
        ),
      );
      const rejected = results.filter((r) => r.status === "rejected");
      assert.deepEqual(
        rejected.map((r) => (r as PromiseRejectedResult).reason?.message),
        [],
        "aucun denyJti concurrent ne doit être rejeté",
      );
      assert.equal(await store.isJtiDenied("jti-pg-conc"), true);
    });

    it("markUsed : trace d'usage posée (updateOne borné #pickOne sur PG)", async () => {
      await store.markUsed("pg-t1", {
        at: CLOCK + 5,
        ip: "10.0.0.9",
        userAgent: "vitest",
      });
      const r = await store.findById("pg-t1");
      assert.equal(r?.lastUsedAt, CLOCK + 5);
      assert.equal(r?.lastUsedIp, "10.0.0.9");
      assert.equal(r?.lastUsedUserAgent, "vitest");
    });

    it("revoke idempotent : la 1ʳᵉ date/raison de révocation est conservée", async () => {
      await store.put(makeRecord({ id: "pg-rv" }));
      CLOCK += 10;
      await store.revoke("pg-rv", "manual");
      const first = await store.findById("pg-rv");
      assert.equal(first?.revokedAt, CLOCK);
      assert.equal(first?.revokedReason, "manual");
      CLOCK += 10;
      await store.revoke("pg-rv", "expired_cleanup"); // rejoué → no-op
      const second = await store.findById("pg-rv");
      assert.equal(
        second?.revokedAt,
        first?.revokedAt,
        "date d'origine intacte",
      );
      assert.equal(second?.revokedReason, "manual", "raison d'origine intacte");
    });

    it("revokeFamily : coupe toute la famille SAUF les membres déjà révoqués", async () => {
      await store.put(
        makeRecord({ id: "pg-f1", family: "fam", kind: "refresh" }),
      );
      await store.put(
        makeRecord({
          id: "pg-f2",
          family: "fam",
          kind: "refresh",
          revokedAt: 111,
          revokedReason: "rotated",
        }),
      );
      CLOCK += 10;
      await store.revokeFamily("fam", "reuse_detected");
      const f1 = await store.findById("pg-f1");
      const f2 = await store.findById("pg-f2");
      assert.equal(f1?.revokedReason, "reuse_detected");
      assert.equal(f2?.revokedAt, 111, "membre déjà révoqué intact");
      assert.equal(f2?.revokedReason, "rotated");
    });

    it("denylist jti : upsert + fenêtre de validité ($gt now sur bigint PG)", async () => {
      await store.denyJti("pg-jti", CLOCK + 1_000);
      assert.equal(await store.isJtiDenied("pg-jti"), true);
      await store.denyJti("pg-jti", CLOCK + 2_000); // rejoué = UPDATE, pas d'erreur PK
      assert.equal(await store.isJtiDenied("pg-jti"), true);
      CLOCK += 3_000; // au-delà de l'exp → l'entrée ne matche plus (sans lazy-delete)
      assert.equal(await store.isJtiDenied("pg-jti"), false);
    });

    it("revokeAllForSubject : seuil monotone (jamais reculé)", async () => {
      await store.revokeAllForSubject("pg-sub", 5_000);
      assert.equal(await store.getInvalidBefore("pg-sub"), 5_000);
      await store.revokeAllForSubject("pg-sub", 9_000);
      assert.equal(await store.getInvalidBefore("pg-sub"), 9_000);
      await store.revokeAllForSubject("pg-sub", 7_000); // recul → ignoré
      assert.equal(await store.getInvalidBefore("pg-sub"), 9_000);
      assert.equal(await store.getInvalidBefore("pg-ghost"), null);
    });

    it("gc 3 branches : denylist expirée + records expirés + PAT révoqués sans exp (filtre JS IS NULL)", async () => {
      CLOCK = 10_000_000;
      // Repart d'un état CONNU : les tests précédents du fichier laissent des
      // records/jti qui seraient aussi purgés → le compte deviendrait ambigu.
      await orm.getRepository(TOKEN_ENTITY_NAMES.records).delete({});
      await orm.getRepository(TOKEN_ENTITY_NAMES.denied).delete({});
      // 1. denylist : une expirée, une vivante.
      await store.denyJti("pg-gc-dead", CLOCK - 1);
      await store.denyJti("pg-gc-alive", CLOCK + 60_000);
      // 2. record expiré (refresh en fin de fenêtre de rejeu).
      await store.put(
        makeRecord({ id: "pg-gc-exp", expiresAt: CLOCK - 1, kind: "refresh" }),
      );
      // 3a. PAT révoqué SANS exp, au-delà de la rétention → purgé.
      await store.put(
        makeRecord({
          id: "pg-gc-stale",
          expiresAt: null,
          revokedAt: CLOCK - RETENTION_MS - 1,
          revokedReason: "manual",
        }),
      );
      // 3b. PAT révoqué AVEC exp future : PAS purgé par la branche 3 (filtre
      //     `expiresAt === null`) ni par la 2 (pas expiré) — le piège NULL PG.
      await store.put(
        makeRecord({
          id: "pg-gc-revoked-with-exp",
          expiresAt: CLOCK + 60_000,
          revokedAt: CLOCK - RETENTION_MS - 1,
          revokedReason: "manual",
        }),
      );
      // 3c. PAT vivant sans exp : intact.
      await store.put(makeRecord({ id: "pg-gc-live", expiresAt: null }));

      const purged = await store.gc(CLOCK);
      assert.equal(
        purged,
        3,
        "1 jti + 1 record expiré + 1 PAT stale (rowCount)",
      );
      assert.equal(
        await store.isJtiDenied("pg-gc-alive"),
        true,
        "l'entrée denylist vivante survit au gc",
      );
      assert.equal(await store.findById("pg-gc-exp"), null);
      assert.equal(await store.findById("pg-gc-stale"), null);
      assert.ok(
        await store.findById("pg-gc-revoked-with-exp"),
        "conservé jusqu'à son exp",
      );
      assert.ok(await store.findById("pg-gc-live"), "PAT vivant intact");
    });
  },
);
