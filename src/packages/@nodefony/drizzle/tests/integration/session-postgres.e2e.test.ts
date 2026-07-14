import assert from "node:assert/strict";
import { SessionsService } from "@nodefony/http";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { IRepository } from "@nodefony/orm-core";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
import DrizzleSessionStorage from "../../nodefony/src/SessionStorage";
import {
  registerSessionEntity,
  SESSION_CONNECTOR,
  type SessionRow,
} from "../../nodefony/entity/sessionEntity";

/**
 * e2e **Postgres** de l'entité session (S1 multi-dialecte) — la preuve que
 * SQLite ne peut pas donner : le `SessionStorage` complet (donc le
 * `DrizzleRepository` GÉNÉRIQUE — première sortie hors SQLite) tourne sur un
 * PG réel : DDL dérivé (`jsonb`/`bigint`), UPSERT `ON CONFLICT`, `touch` via
 * `updateOne` (forme PK en table dérivée), GC (`delete` compté via `rowCount`
 * pg — pas `changes` better-sqlite3), énumération admin.
 *
 * GATE : ne tourne que si `NF_PG_URL` est posée (sinon skip silencieux) :
 *   docker compose -f docker/docker-compose.yml --profile postgres up -d postgres
 *   NF_PG_URL=postgres://nodefony:nodefony-dev@127.0.0.1:5432/nodefony npm test
 */

const PG_URL = process.env.NF_PG_URL;

/** Manager minimal (le storage n'utilise que les timeouts session + `log`). */
const fakeManager = {
  options: { idleTimeoutS: 3600, absoluteTimeoutS: 0, store: "drizzle" },
  log: () => {},
} as unknown as SessionsService;

describe.skipIf(!PG_URL)(
  "Drizzle SessionStorage — e2e Postgres (S1 multi-dialecte)",
  () => {
    let orm: DrizzleOrm;
    let storage: DrizzleSessionStorage;
    const repo = (): IRepository<SessionRow> =>
      orm.getRepository<SessionRow>("session");

    beforeAll(async () => {
      registerSessionEntity(SESSION_CONNECTOR, "postgres"); // variante pgTable, AVANT connect
      orm = new DrizzleOrm(SESSION_CONNECTOR, {
        dialect: "postgres",
        url: PG_URL,
      });
      await orm.connect(); // DDL dérivé : CREATE TABLE IF NOT EXISTS "session" (jsonb/bigint)
      storage = new DrizzleSessionStorage(fakeManager);
      // Table persistante entre les runs (IF NOT EXISTS) → purge d'entrée.
      await repo().delete({});
    });

    afterAll(async () => {
      await orm.disconnect();
      entityRegistry.unregister("session", SESSION_CONNECTOR);
      ormRegistry.unregister(SESSION_CONNECTOR);
    });

    it("write → read : round-trip complet des sacs JSON (jsonb) + user + dates", async () => {
      await storage.write("pg-1", {
        Attributes: { cart: ["a", "b"], depth: { n: 1 } },
        metaBag: { ip: "10.0.0.1" },
        flashBag: { notice: "hello" },
        user: "alice",
      });
      const r = await storage.read("pg-1");
      assert.deepEqual(r.Attributes, { cart: ["a", "b"], depth: { n: 1 } });
      assert.deepEqual(r.metaBag, { ip: "10.0.0.1" });
      assert.deepEqual(r.flashBag, { notice: "hello" });
      assert.equal(r.user, "alice");
      assert.ok(r.createdAt instanceof Date);
    });

    it("write rejoué sur le même id = UPSERT ON CONFLICT (1 ligne, createdAt préservé)", async () => {
      const before = (await storage.read("pg-1")) as { createdAt: Date };
      await storage.write("pg-1", {
        Attributes: { cart: [] },
        metaBag: {},
        flashBag: {},
        user: "alice2",
      });
      assert.equal(await repo().count({ session_id: "pg-1" }), 1);
      const after = (await storage.read("pg-1")) as {
        user: string;
        createdAt: Date;
      };
      assert.equal(after.user, "alice2");
      assert.equal(
        after.createdAt.getTime(),
        before.createdAt.getTime(),
        "createdAt = insert-only, jamais écrasé par l'upsert",
      );
    });

    it("touch (updateOne) : forme PK en table dérivée VALIDE sur PG, au plus 1 ligne", async () => {
      await storage.write("pg-t1", {
        Attributes: {},
        metaBag: {},
        flashBag: {},
        user: "touchme",
      });
      await storage.write("pg-t2", {
        Attributes: {},
        metaBag: {},
        flashBag: {},
        user: "touchme",
      });
      const t1 = await repo().findOne({ session_id: "pg-t1" });
      await new Promise((r) => setTimeout(r, 5));
      await storage.touch("pg-t1");
      const t1b = await repo().findOne({ session_id: "pg-t1" });
      const t2 = await repo().findOne({ session_id: "pg-t2" });
      assert.ok(
        (t1b?.updatedAt ?? 0) > (t1?.updatedAt ?? 0),
        "updatedAt prolongé",
      );
      assert.equal(
        t1b?.createdAt,
        t1?.createdAt,
        "createdAt intact (borne absolute)",
      );
      // « au plus une » : updateOne sur un critère multi-lignes (user partagé)
      const one = await repo().updateOne(
        { user: "touchme" },
        { user: "touched-one" },
      );
      assert.ok(one);
      assert.equal(await repo().count({ user: "touched-one" }), 1);
      assert.equal(await repo().count({ user: "touchme" }), 1);
      assert.ok(t2, "l'autre session existe toujours");
    });

    it("increment / deleteOne / findOneAndDelete sur PG (verbes bornés)", async () => {
      const now = Date.now();
      await repo().createMany([
        {
          session_id: "pg-v1",
          Attributes: {},
          flashBag: {},
          metaBag: {},
          user: "verbs",
          createdAt: now,
          updatedAt: 1000,
        },
        {
          session_id: "pg-v2",
          Attributes: {},
          flashBag: {},
          metaBag: {},
          user: "verbs",
          createdAt: now,
          updatedAt: 1000,
        },
      ]);
      const inc = await repo().increment({ user: "verbs" }, { updatedAt: 7 });
      assert.equal(inc?.updatedAt, 1007, "delta SQL atomique sur bigint PG");
      assert.equal(await repo().deleteOne({ user: "verbs" }), true);
      const rest = await repo().findOneAndDelete({ user: "verbs" });
      assert.ok(rest);
      assert.equal(await repo().count({ user: "verbs" }), 0);
      assert.equal(await repo().findOneAndDelete({ user: "verbs" }), null);
    });

    it("gc : DELETE compté via rowCount pg (fix #affected) — le log ne ment plus", async () => {
      const now = Date.now();
      await repo().createMany([
        {
          session_id: "pg-old",
          Attributes: {},
          flashBag: {},
          metaBag: {},
          user: null,
          createdAt: now - 60_000,
          updatedAt: now - 60_000,
        },
        {
          session_id: "pg-fresh",
          Attributes: {},
          flashBag: {},
          metaBag: {},
          user: null,
          createdAt: now,
          updatedAt: now,
        },
      ]);
      // Vérité bas niveau d'abord : delete() doit REMONTER le compte (rowCount).
      const deleted = await repo().delete({
        updatedAt: { $lt: now - 30_000 },
      } as never);
      assert.equal(deleted, 1, "delete() doit compter via rowCount sur PG");
      assert.ok(await repo().exists({ session_id: "pg-fresh" }));
      assert.equal(await repo().exists({ session_id: "pg-old" }), false);
    });

    it("listAll (énumération admin) : filtre WHERE + redaction par construction", async () => {
      await storage.write("pg-ls1", {
        Attributes: { secret: "TOP" },
        metaBag: { ip: "1.1.1.1" },
        flashBag: {},
        user: "u-pg",
      });
      const mine = await storage.listAll({ user: "u-pg" });
      assert.equal(mine.length, 1);
      assert.deepEqual(
        mine[0]?.data.Attributes,
        {},
        "Attributes reste en base",
      );
      assert.deepEqual(mine[0]?.data.metaBag, { ip: "1.1.1.1" });
    });

    it("destroy : la session disparaît", async () => {
      assert.equal(await storage.destroy("pg-ls1"), true);
      const r = await storage.read("pg-ls1");
      assert.deepEqual(r, {});
    });
  },
);
