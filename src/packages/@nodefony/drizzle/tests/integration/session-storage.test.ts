import assert from "node:assert/strict";
import { RequestContext, type IProfilerQuery } from "nodefony";
import { SessionsService } from "@nodefony/http";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { IRepository } from "@nodefony/orm-core";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
// L'import du storage déclenche son auto-enregistrement dans le registre http (IoC).
import DrizzleSessionStorage from "../../nodefony/src/SessionStorage";
import {
  SESSION_ORM,
  type SessionRow,
} from "../../nodefony/entity/sessionEntity";

/** Manager minimal (le storage n'utilise que les timeouts session + `log`). */
const fakeManager = {
  options: { idleTimeoutS: 3600, absoluteTimeoutS: 0, handler: "drizzle" },
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
      await storage.write("sid1", {
        Attributes: { a: 1 },
        metaBag: { m: 2 },
        flashBag: { f: 3 },
        user: "bob",
      });
      const r = (await storage.read("sid1")) as Record<string, unknown>;
      assert.deepEqual(r.Attributes, { a: 1 });
      assert.deepEqual(r.metaBag, { m: 2 });
      assert.deepEqual(r.flashBag, { f: 3 });
      assert.equal(r.user, "bob");
      assert.ok(r.createdAt instanceof Date);
    });

    it("write sur le même id met à jour sans doublon (upsert)", async () => {
      await storage.write("sid1", {
        Attributes: { a: 9 },
        metaBag: {},
        flashBag: {},
        user: "bob2",
      });
      assert.equal(await storage.open(), 1); // toujours 1 ligne
      const r = (await storage.read("sid1")) as Record<string, unknown>;
      assert.deepEqual(r.Attributes, { a: 9 });
      assert.equal(r.user, "bob2");
    });

    it("destroy supprime ; read renvoie un objet vide", async () => {
      assert.equal(await storage.destroy("sid1"), true);
      const r = (await storage.read("sid1")) as Record<string, unknown>;
      assert.deepEqual(r, {});
      assert.equal(await storage.open(), 0);
    });
  });

  // ── GC : opérateur riche portable ($lt) sur updatedAt ──────────────────────
  describe("garbage collector", () => {
    it("gc supprime les sessions expirées et garde les fraîches", async () => {
      const repo = orm.getRepository<SessionRow>("session");
      const now = Date.now();
      await repo.create({
        session_id: "old",
        Attributes: {},
        flashBag: {},
        metaBag: {},
        user: null,
        createdAt: now - 10_000,
        updatedAt: now - 10_000,
      } as Partial<SessionRow>);
      await repo.create({
        session_id: "fresh",
        Attributes: {},
        flashBag: {},
        metaBag: {},
        user: null,
        createdAt: now,
        updatedAt: now,
      } as Partial<SessionRow>);

      await storage.gc(1); // cutoff = now - 1s → "old" (now-10s) supprimé

      const rows = await repo.find();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].session_id, "fresh");
    });
  });

  // ── Énumération admin : listAll + filtre WHERE SQL + redaction à la source ──
  describe("listAll (énumération admin)", () => {
    beforeAll(async () => {
      await storage.write("ls-1", {
        Attributes: { secret: "TOP" }, // doit rester en base
        metaBag: { ip: "1.1.1.1" },
        flashBag: {},
        user: "u-alice",
      });
      await storage.write("ls-2", {
        Attributes: {},
        metaBag: {},
        flashBag: {},
        user: "u-bob",
      });
      await storage.write("ls-3", {
        Attributes: {},
        metaBag: {},
        flashBag: {},
        user: "u-alice",
      });
    });

    it("énumère en { id, data } et NE sort PAS Attributes de la base", async () => {
      const mine = (await storage.listAll()).filter((r) =>
        r.id.startsWith("ls-"),
      );
      assert.equal(mine.length, 3);
      const a1 = mine.find((r) => r.id === "ls-1");
      assert.equal(a1?.data.user, "u-alice");
      assert.deepEqual(a1?.data.Attributes, {}); // secret jamais énuméré
      assert.deepEqual(a1?.data.metaBag, { ip: "1.1.1.1" });
    });

    it("filtre par user via WHERE SQL réel", async () => {
      const alice = await storage.listAll({ user: "u-alice" });
      assert.deepEqual(alice.map((r) => r.id).sort(), ["ls-1", "ls-3"]);
    });
  });

  // ── Compteur de queries : anti-« trou ORM » (read→write = 1 SELECT) ─────────
  // Détecte un SELECT redondant dans le cycle de requête. Le SQL paramétré de
  // chaque requête ORM est capturé via le buffer profiler de l'ALS (même seam
  // que la debug bar : `RequestContext.get().queries`). Régression : si `write`
  // refait un findOne d'existence (au lieu de l'UPSERT), le compteur repasse à 2.
  describe("compteur de queries (anti-trou ORM)", () => {
    async function capture(fn: () => Promise<void>): Promise<string[]> {
      const queries: IProfilerQuery[] = [];
      await RequestContext.run({ requestId: "qcount", queries }, fn);
      return queries.map((q) => q.sql);
    }
    const selects = (sqls: string[]): string[] =>
      sqls.filter((s) => /^\s*select/i.test(s));

    beforeAll(async () => {
      await storage.write("qc", {
        Attributes: { a: 1 },
        metaBag: {},
        flashBag: {},
        user: "qc-user",
      });
    });

    it("write seul = 1 requête (UPSERT), 0 SELECT", async () => {
      const sqls = await capture(async () => {
        await storage.write("qc", {
          Attributes: { a: 2 },
          metaBag: {},
          flashBag: {},
          user: "qc-user",
        });
      });
      assert.equal(selects(sqls).length, 0, JSON.stringify(sqls));
      assert.equal(
        sqls.length,
        1,
        `1 seule requête attendue (UPSERT) : ${JSON.stringify(sqls)}`,
      );
    });

    it("un cycle read→write ne fait qu'UN SELECT (pas de check d'existence redondant)", async () => {
      const sqls = await capture(async () => {
        await storage.read("qc"); // SELECT #1 — hydratation
        await storage.write("qc", {
          Attributes: { a: 3 },
          metaBag: {},
          flashBag: {},
          user: "qc-user",
        }); // UPSERT (0 SELECT) — plus le 2ᵉ SELECT du findOne d'existence
      });
      assert.equal(
        selects(sqls).length,
        1,
        `1 SELECT attendu (doublon de write éliminé) : ${JSON.stringify(sqls)}`,
      );
    });
  });

  // ── Verbes repository Tier 1+2 sur le repo générique (entité session) ───────
  describe("verbes repository (createMany / exists / deleteOne / findOneAndDelete / increment)", () => {
    const repo = (): IRepository<SessionRow> =>
      orm.getRepository<SessionRow>("session");
    const seed = (
      id: string,
      extra: Partial<SessionRow> = {},
    ): Partial<SessionRow> => {
      const now = Date.now();
      return {
        session_id: id,
        Attributes: {},
        flashBag: {},
        metaBag: {},
        user: null,
        createdAt: now,
        updatedAt: now,
        ...extra,
      } as Partial<SessionRow>;
    };

    it("createMany insère N en une requête (ordre préservé) ; [] = no-op", async () => {
      assert.deepEqual(await repo().createMany([]), []);
      const rows = await repo().createMany([seed("v-cm1"), seed("v-cm2")]);
      assert.deepEqual(
        rows.map((r) => r.session_id),
        ["v-cm1", "v-cm2"],
      );
      assert.equal(await repo().count({ session_id: "v-cm1" }), 1);
    });

    it("exists = true/false (sans charger la ligne)", async () => {
      await repo().create(seed("v-ex"));
      assert.equal(await repo().exists({ session_id: "v-ex" }), true);
      assert.equal(await repo().exists({ session_id: "v-nope" }), false);
    });

    it("deleteOne supprime AU PLUS une (true puis false)", async () => {
      await repo().create(seed("v-del"));
      assert.equal(await repo().deleteOne({ session_id: "v-del" }), true);
      assert.equal(await repo().exists({ session_id: "v-del" }), false);
      assert.equal(await repo().deleteOne({ session_id: "v-del" }), false);
    });

    it("findOneAndDelete retourne la ligne supprimée puis elle disparaît", async () => {
      await repo().create(seed("v-fad", { user: "popme" }));
      const row = await repo().findOneAndDelete({ session_id: "v-fad" });
      assert.equal(row?.session_id, "v-fad");
      assert.equal(row?.user, "popme");
      assert.equal(await repo().exists({ session_id: "v-fad" }), false);
      assert.equal(
        await repo().findOneAndDelete({ session_id: "v-fad" }),
        null,
      );
    });

    it("increment ajoute un delta atomique (et décrémente) ; null si absent", async () => {
      await repo().create(seed("v-inc", { updatedAt: 1000 }));
      const up = await repo().increment(
        { session_id: "v-inc" },
        { updatedAt: 5 },
      );
      assert.equal(up?.updatedAt, 1005);
      const down = await repo().increment(
        { session_id: "v-inc" },
        { updatedAt: -1000 },
      );
      assert.equal(down?.updatedAt, 5);
      assert.equal(
        await repo().increment({ session_id: "v-nope" }, { updatedAt: 1 }),
        null,
      );
    });
  });
});
