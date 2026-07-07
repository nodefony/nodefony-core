import assert from "node:assert/strict";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { IAuditEvent } from "@nodefony/security";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
import { DrizzleAuditStore } from "../../nodefony/src/DrizzleAuditStore";
import {
  registerAuditEntities,
  AUDIT_ENTITY_NAMES,
} from "../../nodefony/entity/auditEventEntity";

/**
 * e2e **Postgres** du journal d'audit (S3 multi-dialecte) — le
 * `DrizzleAuditStore` complet sur un PG réel : DDL dérivé (jsonb/bigint),
 * append + round-trip jsonb, filtres, **pagination curseur composite**
 * `(ts, id)` avec collision à la milliseconde, et le **gc normalisé
 * `rowCount`** (le compteur pg — `changes` n'existe pas ; avant S3 le gc
 * rendait 0 sur PG).
 *
 * GATE : ne tourne que si `NF_PG_URL` est posée (sinon skip silencieux) :
 *   docker compose -f docker/docker-compose.yml --profile postgres up -d postgres
 *   NF_PG_URL=postgres://nodefony:nodefony-dev@127.0.0.1:5432/nodefony npm test
 */

const PG_URL = process.env.NF_PG_URL;
const ORM = "audit_pg_e2e";

let CLOCK = 1_000_000;
const now = () => CLOCK;
const RETENTION_MS = 1_000;

/** Construit un `IAuditEvent` complet avec surcharges. */
function makeEvent(
  over: Partial<IAuditEvent> & Pick<IAuditEvent, "id">,
): IAuditEvent {
  return {
    ts: CLOCK,
    category: "auth",
    action: "login.success",
    outcome: "success",
    actor: "alice",
    ...over,
  };
}

describe.skipIf(!PG_URL)(
  "DrizzleAuditStore — e2e Postgres (S3 multi-dialecte)",
  () => {
    let orm: DrizzleOrm;
    let store: DrizzleAuditStore;

    beforeAll(async () => {
      CLOCK = 1_000_000;
      registerAuditEntities(ORM, "postgres"); // variante pgTable, AVANT connect
      orm = new DrizzleOrm(ORM, { dialect: "postgres", url: PG_URL });
      await orm.connect(); // DDL dérivé : CREATE TABLE IF NOT EXISTS (jsonb/bigint)
      store = DrizzleAuditStore.from(orm, now, RETENTION_MS);
      // Table persistante entre les runs (IF NOT EXISTS) → purge d'entrée.
      await orm.getRepository(AUDIT_ENTITY_NAMES.events).delete({});
    });

    afterAll(async () => {
      await orm.disconnect();
      entityRegistry.unregister(AUDIT_ENTITY_NAMES.events, ORM);
      ormRegistry.unregister(ORM);
    });

    it("append + query : round-trip jsonb (flags/metadata) + bigint ts + ordre DESC", async () => {
      await store.append(makeEvent({ id: "pg-a1", ts: 100 }));
      await store.append(
        makeEvent({
          id: "pg-a2",
          ts: 200,
          flags: { hasCookie: true },
          metadata: { zone: "admin", n: 3 },
        }),
      );
      const page = await store.query();
      assert.equal(page.total, 2);
      assert.deepEqual(
        page.events.map((e) => e.id),
        ["pg-a2", "pg-a1"], // ts DESC
      );
      const rich = page.events[0]!;
      assert.deepEqual(rich.flags, { hasCookie: true });
      assert.deepEqual(rich.metadata, { zone: "admin", n: 3 });
      assert.equal(rich.ts, 200, "epoch ms exact via bigint mode number");
      const bare = page.events[1]!;
      assert.equal(bare.flags, undefined, "NULL PG → champ absent");
      assert.equal(bare.metadata, undefined);
    });

    it("filtres AND (category + since/until) + total sous filtre", async () => {
      await store.append(
        makeEvent({ id: "pg-a3", ts: 300, category: "admin", actor: "bob" }),
      );
      const admin = await store.query({ category: "admin" });
      assert.equal(admin.total, 1);
      assert.equal(admin.events[0]?.id, "pg-a3");
      const window = await store.query({ since: 150, until: 250 });
      assert.equal(window.total, 1);
      assert.equal(window.events[0]?.id, "pg-a2");
    });

    it("pagination curseur composite (ts, id) : collision à la ms sans doublon ni trou", async () => {
      // 3 événements au MÊME ts → seul `id DESC` départage.
      for (const id of ["pg-c1", "pg-c2", "pg-c3"]) {
        await store.append(makeEvent({ id, ts: 500, category: "burst" }));
      }
      const page1 = await store.query({ category: "burst", limit: 2 });
      assert.deepEqual(
        page1.events.map((e) => e.id),
        ["pg-c3", "pg-c2"],
      );
      assert.equal(page1.nextBefore, "pg-c2", "ligne de garde limit+1");
      const page2 = await store.query({
        category: "burst",
        limit: 2,
        before: page1.nextBefore!,
      });
      assert.deepEqual(
        page2.events.map((e) => e.id),
        ["pg-c1"],
        "page 2 = le reste exact (pas de doublon, pas de trou)",
      );
      assert.equal(page2.nextBefore, null);
    });

    it("gc : purge par rétention avec compteur pg `rowCount` (≠ 0)", async () => {
      // Rétention 1000 ms : à CLOCK=2000, tout ts < 1000 est purgé
      // (pg-a1 ts=100 · pg-a2 ts=200 · pg-a3 ts=300 · burst ×3 ts=500).
      CLOCK = 2_000;
      const purged = await store.gc();
      assert.equal(
        purged,
        6,
        "compteur normalisé rowCount (avant S3 : 0 sur PG)",
      );
      const rest = await store.query();
      assert.equal(rest.total, 0);
    });
  },
);
