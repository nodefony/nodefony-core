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
 * e2e **MySQL** du journal d'audit (S4 multi-dialecte) — miroir de l'e2e
 * Postgres : DDL dérivé (json/bigint/varchar), append + round-trip json,
 * filtres, pagination curseur composite `(ts, id)` avec collision à la
 * milliseconde, et le **gc normalisé `affectedRows`** (le compteur mysql2 —
 * `changes`/`rowCount` n'existent pas ; sans normalisation le gc rendrait 0).
 *
 * GATE : ne tourne que si `NF_MYSQL_URL` est posée (sinon skip silencieux) :
 *   docker compose -f docker/docker-compose.yml --profile mariadb up -d mariadb
 *   NF_MYSQL_URL=mysql://nodefony:nodefony-dev@127.0.0.1:3306/nodefony npm test
 */

const MYSQL_URL = process.env.NF_MYSQL_URL;
const ORM = "audit_mysql_e2e";

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

describe.skipIf(!MYSQL_URL)(
  "DrizzleAuditStore — e2e MySQL (S4 multi-dialecte)",
  () => {
    let orm: DrizzleOrm;
    let store: DrizzleAuditStore;

    beforeAll(async () => {
      CLOCK = 1_000_000;
      registerAuditEntities(ORM, "mysql"); // variante mysqlTable, AVANT connect
      orm = new DrizzleOrm(ORM, { dialect: "mysql", url: MYSQL_URL });
      await orm.connect(); // DDL dérivé : CREATE TABLE IF NOT EXISTS (json/bigint)
      store = DrizzleAuditStore.from(orm, now, RETENTION_MS);
      // Table persistante entre les runs (IF NOT EXISTS) → purge d'entrée.
      await orm.getRepository(AUDIT_ENTITY_NAMES.events).delete({});
    });

    afterAll(async () => {
      await orm.disconnect();
      entityRegistry.unregister(AUDIT_ENTITY_NAMES.events, ORM);
      ormRegistry.unregister(ORM);
    });

    it("append + query : round-trip json (flags/metadata) + bigint ts + ordre DESC", async () => {
      await store.append(makeEvent({ id: "my-a1", ts: 100 }));
      await store.append(
        makeEvent({
          id: "my-a2",
          ts: 200,
          flags: { hasCookie: true },
          metadata: { zone: "admin", n: 3 },
        }),
      );
      const page = await store.query();
      assert.equal(page.total, 2);
      assert.deepEqual(
        page.events.map((e) => e.id),
        ["my-a2", "my-a1"], // ts DESC
      );
      const rich = page.events[0]!;
      assert.deepEqual(rich.flags, { hasCookie: true });
      assert.deepEqual(rich.metadata, { zone: "admin", n: 3 });
      assert.equal(rich.ts, 200, "epoch ms exact via bigint mode number");
      const bare = page.events[1]!;
      assert.equal(bare.flags, undefined, "NULL MySQL → champ absent");
      assert.equal(bare.metadata, undefined);
    });

    it("filtres AND (category + since/until) + total sous filtre", async () => {
      await store.append(
        makeEvent({ id: "my-a3", ts: 300, category: "authz", actor: "bob" }),
      );
      const authz = await store.query({ category: "authz" });
      assert.equal(authz.total, 1);
      assert.equal(authz.events[0]?.id, "my-a3");
      const window = await store.query({ since: 150, until: 250 });
      assert.equal(window.total, 1);
      assert.equal(window.events[0]?.id, "my-a2");
    });

    it("pagination curseur composite (ts, id) : collision à la ms sans doublon ni trou", async () => {
      for (const id of ["my-c1", "my-c2", "my-c3"]) {
        await store.append(makeEvent({ id, ts: 500, category: "session" }));
      }
      const page1 = await store.query({ category: "session", limit: 2 });
      assert.deepEqual(
        page1.events.map((e) => e.id),
        ["my-c3", "my-c2"],
      );
      assert.equal(page1.nextBefore, "my-c2", "ligne de garde limit+1");
      const page2 = await store.query({
        category: "session",
        limit: 2,
        before: page1.nextBefore!,
      });
      assert.deepEqual(
        page2.events.map((e) => e.id),
        ["my-c1"],
        "page 2 = le reste exact (pas de doublon, pas de trou)",
      );
      assert.equal(page2.nextBefore, null);
    });

    it("gc : purge par rétention avec compteur mysql `affectedRows` (≠ 0)", async () => {
      // Rétention 1000 ms : à CLOCK=2000, tout ts < 1000 est purgé
      // (my-a1 ts=100 · my-a2 ts=200 · my-a3 ts=300 · burst ×3 ts=500).
      CLOCK = 2_000;
      const purged = await store.gc();
      assert.equal(
        purged,
        6,
        "compteur normalisé affectedRows (tuple mysql2 — sinon 0)",
      );
      const rest = await store.query();
      assert.equal(rest.total, 0);
    });
  },
);
