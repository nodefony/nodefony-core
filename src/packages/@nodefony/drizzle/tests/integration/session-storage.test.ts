import assert from "node:assert/strict";
import { SessionsService } from "@nodefony/http";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
// L'import du storage déclenche son auto-enregistrement dans le registre http (IoC).
import DrizzleSessionStorage from "../../nodefony/src/SessionStorage";
import {
  SESSION_ORM,
  type SessionRow,
} from "../../nodefony/entity/sessionEntity";

/** Manager minimal (le storage n'utilise que `options.gc_maxlifetime` + `log`). */
const fakeManager = {
  options: { gc_maxlifetime: 3600, handler: "drizzle" },
  log: () => {},
} as unknown as SessionsService;

describe("Drizzle SessionStorage — mécanisme IoC + CRUD (P7.4)", () => {
  let orm: DrizzleOrm;
  let storage: DrizzleSessionStorage;

  beforeAll(async () => {
    orm = new DrizzleOrm(SESSION_ORM, { filename: ":memory:" });
    await orm.connect(); // crée la table `session` (entité @entity auto-enregistrée)
    storage = new DrizzleSessionStorage(fakeManager);
  });

  afterAll(async () => {
    await orm.disconnect();
    entityRegistry.unregister("session");
    ormRegistry.unregister(SESSION_ORM);
  });

  // ── Inversion de contrôle : le storage s'est auto-enregistré dans http ─────
  describe("registre (IoC)", () => {
    it("le storage Drizzle s'auto-enregistre sous 'drizzle'", () => {
      assert.equal(
        SessionsService.getStorage("drizzle"),
        DrizzleSessionStorage,
      );
    });

    it("la résolution du handler est insensible à la casse", () => {
      assert.equal(
        SessionsService.getStorage("DRIZZLE"),
        DrizzleSessionStorage,
      );
    });

    it("le built-in 'files' de http est aussi enregistré", () => {
      assert.ok(SessionsService.storageHandlers().includes("files"));
      assert.ok(SessionsService.storageHandlers().includes("drizzle"));
    });

    it("un handler inconnu renvoie undefined (pas d'import en dur)", () => {
      assert.equal(SessionsService.getStorage("inexistant"), undefined);
    });
  });

  // ── CRUD du storage backé par le repository orm-core Drizzle ───────────────
  describe("CRUD", () => {
    it("write puis read restitue Attributes/metaBag/flashBag/user", async () => {
      await storage.write(
        "sid1",
        {
          Attributes: { a: 1 },
          metaBag: { m: 2 },
          flashBag: { f: 3 },
          user: "bob",
        },
        "default",
      );
      const r = (await storage.read("sid1", "default")) as Record<
        string,
        unknown
      >;
      assert.deepEqual(r.Attributes, { a: 1 });
      assert.deepEqual(r.metaBag, { m: 2 });
      assert.deepEqual(r.flashBag, { f: 3 });
      assert.equal(r.user, "bob");
      assert.ok(r.createdAt instanceof Date);
    });

    it("write sur le même id met à jour sans doublon (upsert)", async () => {
      await storage.write(
        "sid1",
        { Attributes: { a: 9 }, metaBag: {}, flashBag: {}, user: "bob2" },
        "default",
      );
      assert.equal(await storage.open("default"), 1); // toujours 1 ligne
      const r = (await storage.read("sid1", "default")) as Record<
        string,
        unknown
      >;
      assert.deepEqual(r.Attributes, { a: 9 });
      assert.equal(r.user, "bob2");
    });

    it("destroy supprime ; read renvoie un objet vide", async () => {
      assert.equal(await storage.destroy("sid1", "default"), true);
      const r = (await storage.read("sid1", "default")) as Record<
        string,
        unknown
      >;
      assert.deepEqual(r, {});
      assert.equal(await storage.open("default"), 0);
    });
  });

  // ── GC : opérateur riche portable ($lt) sur updatedAt ──────────────────────
  describe("garbage collector", () => {
    it("gc supprime les sessions expirées et garde les fraîches", async () => {
      const repo = orm.getRepository<SessionRow>("session");
      const now = Date.now();
      await repo.create({
        session_id: "old",
        context: "default",
        Attributes: {},
        flashBag: {},
        metaBag: {},
        user: null,
        createdAt: now - 10_000,
        updatedAt: now - 10_000,
      } as Partial<SessionRow>);
      await repo.create({
        session_id: "fresh",
        context: "default",
        Attributes: {},
        flashBag: {},
        metaBag: {},
        user: null,
        createdAt: now,
        updatedAt: now,
      } as Partial<SessionRow>);

      await storage.gc(1, "default"); // cutoff = now - 1s → "old" (now-10s) supprimé

      const rows = await repo.find({ context: "default" });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].session_id, "fresh");
    });
  });
});
