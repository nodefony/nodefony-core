import assert from "node:assert/strict";
import { RequestContext, type IProfilerQuery } from "nodefony";
import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { IRepository } from "@nodefony/orm-core";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
import {
  buildFrameworkTable,
  type IFrameworkTableSpec,
} from "../../nodefony/entity/colKit";

/**
 * `#pickOne` — borne « au plus une ligne » des verbes updateOne / increment /
 * deleteOne / findOneAndDelete (G3 du comparatif ORM 2026-07).
 *
 * Avant S1 : `rowid IN (SELECT rowid … LIMIT 1)` — SQLite-only (PG/MySQL n'ont
 * pas `rowid`). Depuis S1 : sous-requête sur la PK découverte, en **table
 * dérivée** (`pk IN (SELECT pk FROM (SELECT pk … LIMIT 1) AS picked)`) — la
 * seule forme valide sur les trois dialectes. Ce banc prouve : la sémantique
 * (au plus 1 même quand N lignes matchent), la forme SQL émise (PK, plus de
 * rowid), le fallback rowid des tables sans PK, et la PK composite (row-values).
 */

const ORM = "pickone_test";

/** Table de référence (via colKit — double usage : le kit en situation réelle). */
const PROBE_SPEC = {
  name: "pickone_probe",
  columns: {
    id: { kind: "text", primaryKey: true },
    grp: { kind: "text", notNull: true },
    counter: { kind: "int", notNull: true },
    note: { kind: "text" },
  },
} satisfies IFrameworkTableSpec;

interface ProbeRow {
  id: string;
  grp: string;
  counter: number;
  note: string | null;
}

/** Table SANS PK déclarée → fallback rowid (SQLite-only, assumé). */
const noPkTable = sqliteTable("pickone_nopk", {
  label: text("label").notNull(),
  value: integer("value").notNull(),
});
interface NoPkRow {
  label: string;
  value: number;
}

/** Table à PK COMPOSITE (extraConfig `primaryKey`) → row-values `(a,b) IN …`. */
const compositeTable = sqliteTable(
  "pickone_composite",
  {
    tenant: text("tenant").notNull(),
    slot: integer("slot").notNull(),
    payload: text("payload"),
  },
  (t) => [primaryKey({ columns: [t.tenant, t.slot] })],
);
interface CompositeRow {
  tenant: string;
  slot: number;
  payload: string | null;
}

/** Capture le SQL paramétré émis pendant `fn` (même seam que la debug bar). */
async function captureSql(fn: () => Promise<void>): Promise<string[]> {
  const queries: IProfilerQuery[] = [];
  await RequestContext.run({ requestId: "pickone", queries }, fn);
  return queries.map((q) => q.sql);
}

describe("DrizzleRepository #pickOne — forme PK portable (S1 multi-dialecte)", () => {
  let orm: DrizzleOrm;
  const repo = (): IRepository<ProbeRow> =>
    orm.getRepository<ProbeRow>("pickone_probe");

  beforeAll(async () => {
    entityRegistry.register({
      connector: ORM,
      name: "pickone_probe",
      schema: buildFrameworkTable("sqlite", PROBE_SPEC),
    });
    entityRegistry.register({
      connector: ORM,
      name: "pickone_nopk",
      schema: noPkTable,
    });
    entityRegistry.register({
      connector: ORM,
      name: "pickone_composite",
      schema: compositeTable,
    });
    orm = new DrizzleOrm(ORM, { filename: ":memory:" });
    await orm.connect();
  });

  afterAll(async () => {
    await orm.disconnect();
    entityRegistry.unregister("pickone_probe", ORM);
    entityRegistry.unregister("pickone_nopk", ORM);
    entityRegistry.unregister("pickone_composite", ORM);
    ormRegistry.unregister(ORM);
  });

  /** Repeuple le groupe g avec 3 lignes identiques (hors PK). */
  async function seedGroup(g: string): Promise<void> {
    await repo().delete({ grp: g });
    await repo().createMany([
      { id: `${g}-1`, grp: g, counter: 0, note: null },
      { id: `${g}-2`, grp: g, counter: 0, note: null },
      { id: `${g}-3`, grp: g, counter: 0, note: null },
    ]);
  }

  describe("sémantique « au plus une » quand N lignes matchent le critère", () => {
    it("updateOne ne modifie qu'UNE des 3 lignes du groupe", async () => {
      await seedGroup("upd");
      const row = await repo().updateOne({ grp: "upd" }, { note: "touched" });
      assert.ok(row, "RETURNING doit rendre la ligne modifiée");
      assert.equal(row?.note, "touched");
      assert.equal(await repo().count({ grp: "upd", note: "touched" }), 1);
      assert.equal(
        await repo().count({ grp: "upd" }),
        3,
        "aucune ligne perdue",
      );
    });

    it("increment n'incrémente qu'UNE ligne (delta SQL atomique)", async () => {
      await seedGroup("inc");
      const row = await repo().increment({ grp: "inc" }, { counter: 5 });
      assert.equal(row?.counter, 5);
      const rows = await repo().find({ grp: "inc" });
      assert.deepEqual(
        rows.map((r) => r.counter).sort((a, b) => a - b),
        [0, 0, 5],
      );
    });

    it("deleteOne ne supprime qu'UNE ligne ; findOneAndDelete rend la supprimée", async () => {
      await seedGroup("del");
      assert.equal(await repo().deleteOne({ grp: "del" }), true);
      assert.equal(await repo().count({ grp: "del" }), 2);
      const popped = await repo().findOneAndDelete({ grp: "del" });
      assert.equal(popped?.grp, "del");
      assert.equal(await repo().count({ grp: "del" }), 1);
    });

    it("critère sans correspondance → null / false, rien touché", async () => {
      await seedGroup("none");
      assert.equal(
        await repo().updateOne({ grp: "ghost" }, { note: "x" }),
        null,
      );
      assert.equal(await repo().deleteOne({ grp: "ghost" }), false);
      assert.equal(await repo().count({ grp: "none" }), 3);
    });

    it("critère PK exact → cible LA ligne demandée", async () => {
      await seedGroup("pk");
      const row = await repo().updateOne({ id: "pk-2" }, { note: "précis" });
      assert.equal(row?.id, "pk-2");
      assert.equal((await repo().findOne({ id: "pk-1" }))?.note, null);
    });
  });

  describe("forme SQL émise (capture profiler)", () => {
    it("updateOne passe par la PK en table dérivée — plus AUCUN rowid", async () => {
      await seedGroup("sql");
      const sqls = await captureSql(async () => {
        await repo().updateOne({ grp: "sql" }, { note: "probe" });
      });
      const update = sqls.find((s) => /^\s*update/i.test(s));
      assert.ok(update, `UPDATE attendu : ${JSON.stringify(sqls)}`);
      assert.ok(
        !/rowid/i.test(update),
        `rowid banni des tables à PK : ${update}`,
      );
      assert.match(update, /"id" in \(select "id" from \(select/i);
      assert.match(update, /limit 1\) as picked/i);
    });

    it("deleteOne émet la même forme portable", async () => {
      await seedGroup("sqld");
      const sqls = await captureSql(async () => {
        await repo().deleteOne({ grp: "sqld" });
      });
      const del = sqls.find((s) => /^\s*delete/i.test(s));
      assert.ok(del);
      assert.ok(!/rowid/i.test(del));
      assert.match(del, /as picked/i);
    });
  });

  describe("court-circuit : critère qui FIXE la PK → WHERE nu, sans sous-requête (#510)", () => {
    /** Le seul UPDATE/DELETE émis pendant `fn`. */
    async function mutationSql(
      verb: "update" | "delete",
      fn: () => Promise<void>,
    ): Promise<string> {
      const sqls = await captureSql(fn);
      const found = sqls.find((s) => new RegExp(`^\\s*${verb}`, "i").test(s));
      assert.ok(found, `${verb} attendu : ${JSON.stringify(sqls)}`);
      return found;
    }

    it("updateOne / increment / deleteOne par PK exacte n'émettent plus « picked »", async () => {
      await seedGroup("short");
      const upd = await mutationSql("update", async () => {
        const row = await repo().updateOne({ id: "short-2" }, { note: "pk" });
        assert.equal(row?.id, "short-2");
      });
      assert.ok(!/picked/i.test(upd), `sous-requête superflue : ${upd}`);
      assert.match(upd, /where "pickone_probe"\."id" = \?/i);
      const inc = await mutationSql("update", async () => {
        assert.equal(
          (await repo().increment({ id: "short-1" }, { counter: 2 }))?.counter,
          2,
        );
      });
      assert.ok(!/picked/i.test(inc), inc);
      const del = await mutationSql("delete", async () => {
        assert.equal(await repo().deleteOne({ id: "short-3" }), true);
      });
      assert.ok(!/picked/i.test(del), del);
      assert.equal((await repo().findOne({ id: "short-1" }))?.note, null);
      assert.equal(await repo().count({ grp: "short" }), 2);
    });

    it("PK + champ supplémentaire : court-circuit, et un champ qui ne matche pas rend null", async () => {
      await seedGroup("extra");
      const upd = await mutationSql("update", async () => {
        assert.equal(
          await repo().updateOne(
            { id: "extra-1", grp: "autre" },
            { note: "x" },
          ),
          null,
        );
      });
      assert.ok(!/picked/i.test(upd), upd);
      assert.equal(await repo().count({ grp: "extra", note: "x" }), 0);
    });

    it("PK par opérateur, dans un $or, ou HÉRITÉE : la sous-requête reste", async () => {
      await seedGroup("keep");
      const viaOp = await mutationSql("update", async () => {
        await repo().updateOne(
          { id: { $in: ["keep-1", "keep-2"] } },
          { note: "op" },
        );
      });
      assert.match(viaOp, /as picked/i);
      const viaOr = await mutationSql("update", async () => {
        await repo().updateOne(
          { $or: [{ id: "keep-1" }, { id: "keep-2" }] },
          { note: "or" },
        );
      });
      assert.match(viaOr, /as picked/i);
      // Une clé de PK HÉRITÉE n'entre pas dans le WHERE (`Object.entries`) :
      // la compter comme fixée laisserait l'UPDATE toucher tout le groupe.
      const inherited = Object.assign(
        Object.create({ id: "keep-1" }) as Record<string, unknown>,
        { grp: "keep" },
      ) as Partial<ProbeRow>;
      const viaProto = await mutationSql("update", async () => {
        await repo().updateOne(inherited, { note: "proto" });
      });
      assert.match(viaProto, /as picked/i);
      assert.equal(await repo().count({ grp: "keep", note: "proto" }), 1);
    });

    it("PK composite : fixée en entier → court-circuit ; fixée à moitié → sous-requête", async () => {
      const compRepo = (): IRepository<CompositeRow> =>
        orm.getRepository<CompositeRow>("pickone_composite");
      await compRepo().createMany([
        { tenant: "c1", slot: 1, payload: null },
        { tenant: "c1", slot: 2, payload: null },
      ]);
      const full = await mutationSql("update", async () => {
        const row = await compRepo().updateOne(
          { tenant: "c1", slot: 2 },
          { payload: "full" },
        );
        assert.equal(row?.slot, 2);
      });
      assert.ok(!/picked/i.test(full), full);
      const half = await mutationSql("update", async () => {
        await compRepo().updateOne({ slot: 1 }, { payload: "half" });
      });
      assert.match(half, /as picked/i);
      assert.equal(
        await compRepo().count({ tenant: "c1", payload: "full" }),
        1,
      );
    });
  });

  describe("fallback sans PK déclarée (rowid, SQLite-only assumé)", () => {
    const noPkRepo = (): IRepository<NoPkRow> =>
      orm.getRepository<NoPkRow>("pickone_nopk");

    it("updateOne retombe sur rowid et garde « au plus une »", async () => {
      await noPkRepo().createMany([
        { label: "dup", value: 1 },
        { label: "dup", value: 1 },
      ]);
      const sqls = await captureSql(async () => {
        const row = await noPkRepo().updateOne({ label: "dup" }, { value: 9 });
        assert.equal(row?.value, 9);
      });
      const update = sqls.find((s) => /^\s*update/i.test(s));
      assert.ok(update);
      assert.match(update, /rowid in \(select rowid/i);
      const rows = await noPkRepo().find({ label: "dup" });
      assert.deepEqual(
        rows.map((r) => r.value).sort((a, b) => a - b),
        [1, 9],
      );
    });
  });

  describe("PK composite (row-values)", () => {
    const compRepo = (): IRepository<CompositeRow> =>
      orm.getRepository<CompositeRow>("pickone_composite");

    it("updateOne borne à une ligne via (a, b) IN (…)", async () => {
      await compRepo().createMany([
        { tenant: "t1", slot: 1, payload: null },
        { tenant: "t1", slot: 2, payload: null },
        { tenant: "t2", slot: 1, payload: null },
      ]);
      const sqls = await captureSql(async () => {
        const row = await compRepo().updateOne(
          { tenant: "t1" },
          { payload: "one" },
        );
        assert.equal(row?.tenant, "t1");
      });
      const update = sqls.find((s) => /^\s*update/i.test(s));
      assert.ok(update);
      assert.ok(!/rowid/i.test(update));
      // Cible qualifiée par la table : `("t"."tenant", "t"."slot") IN (SELECT "tenant", "slot" FROM (…))`.
      assert.match(update, /"slot"\) in \(select "tenant", "slot" from/i);
      assert.equal(
        await compRepo().count({ tenant: "t1", payload: "one" }),
        1,
        "une seule des deux lignes t1 modifiée",
      );
    });
  });
});
