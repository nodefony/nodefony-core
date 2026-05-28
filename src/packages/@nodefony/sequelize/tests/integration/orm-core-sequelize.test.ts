import assert from "node:assert/strict";
import { DataTypes } from "sequelize";
import type { Sequelize } from "sequelize";
import { RequestContext } from "nodefony";
import type { IProfilerQuery } from "nodefony";
import { entity, entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { IRepository } from "@nodefony/orm-core";
import { SequelizeOrm } from "../../nodefony/src/orm-core/index";

const ORM = "db_test";

/** Formes plates renvoyées par les repositories (jamais des instances Model). */
interface User {
  id: string;
  email: string;
  age?: number;
  rooms?: Room[]; // peuplé par eager-load (options.relations)
}
interface Room {
  id: string;
  name: string;
  userId: string;
}

// ── Entités du banc d'essai (ADR-0002, UUID-first) ──────────────────────────
// Enregistrées dans entityRegistry au chargement du module via @entity.
@entity({
  orm: ORM,
  name: "User",
  schema: {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    email: { type: DataTypes.STRING, allowNull: false, unique: true },
    age: { type: DataTypes.INTEGER, allowNull: true },
  },
  relations: [{ type: "one-to-many", target: "Room", field: "rooms" }],
})
class UserEntity {}

@entity({
  orm: ORM,
  name: "Room",
  schema: {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: { type: DataTypes.STRING, allowNull: false },
  },
})
class RoomEntity {}

void UserEntity;
void RoomEntity;

describe("orm-core ↔ Sequelize adapter (P5.4)", () => {
  let orm: SequelizeOrm;
  let users: IRepository<User>;
  let rooms: IRepository<Room>;

  beforeAll(async () => {
    orm = new SequelizeOrm(ORM, {
      dialect: "sqlite",
      storage: ":memory:",
      logging: false,
    });
    await orm.connect();
    users = orm.getRepository<User>("User");
    rooms = orm.getRepository<Room>("Room");
  });

  afterAll(async () => {
    await orm.disconnect();
    entityRegistry.unregister("User");
    entityRegistry.unregister("Room");
    ormRegistry.unregister(ORM);
  });

  it("s'auto-enregistre dans ormRegistry + se connecte (onOrmReady)", () => {
    assert.equal(ormRegistry.has(ORM), true);
    assert.equal(ormRegistry.get(ORM), orm);
    assert.equal(orm.isConnected(), true);
  });

  it("CRUD portable : create / findOne / find / count / update / delete", async () => {
    const created = await users.create({ email: "a@b.c" });
    assert.match(created.id, /[0-9a-f-]{36}/); // UUIDV4 auto-généré
    assert.equal(created.email, "a@b.c");

    const found = await users.findOne({ email: "a@b.c" });
    assert.equal(found?.id, created.id);

    assert.equal((await users.find()).length, 1);
    assert.equal(await users.count(), 1);

    const updated = await users.update({ id: created.id }, { email: "x@y.z" });
    assert.equal(updated?.email, "x@y.z");

    assert.equal(await users.delete({ id: created.id }), 1);
    assert.equal(await users.count(), 0);
  });

  it("relation one-to-many : FK userId créée + écriture/lecture portable", async () => {
    const owner = await users.create({ email: "owner@b.c" });
    await rooms.create({ name: "general", userId: owner.id });
    await rooms.create({ name: "random", userId: owner.id });

    // Lecture des rooms d'un user = critère simple → 100 % portable.
    const ownerRooms = await rooms.find({ userId: owner.id });
    assert.equal(ownerRooms.length, 2);
    assert.equal(ownerRooms[0].userId, owner.id);
  });

  // ── Graphe canonique : describeEntity (getAttributes) ─────────────────────
  it("describeEntity : colonnes normalisées (pk/nullable/unique/type)", () => {
    const cols = orm.describeEntity("User");
    const byName = new Map(cols.map((c) => [c.name, c]));

    const id = byName.get("id");
    assert.ok(id, "colonne id absente");
    assert.equal(id.primaryKey, true);
    assert.equal(id.nullable, false); // PK jamais nullable

    const email = byName.get("email");
    assert.ok(email);
    assert.equal(email.unique, true);
    assert.equal(email.nullable, false);
    assert.match(email.type, /char|text|string/i); // VARCHAR(255) / STRING

    const age = byName.get("age");
    assert.ok(age);
    assert.equal(age.primaryKey, false);
    assert.equal(age.nullable, true);

    assert.deepEqual(orm.describeEntity("Inconnu"), []); // entité inconnue → []
  });

  // ── Fuite #1 résolue : eager-load PORTABLE via options.relations ──────────
  it("eager-load PORTABLE : findOne(criteria, { relations }) charge l'association", async () => {
    const owner = await users.findOne(
      { email: "owner@b.c" },
      { relations: ["rooms"] },
    );
    assert.ok(owner);
    assert.equal(owner.rooms?.length, 2); // 1 requête (JOIN), sans trappe native
  });

  it("trappe native toujours dispo pour jointures arbitraires (ADR-0003 risque #1)", async () => {
    const owner = await users.findOne({ email: "owner@b.c" });
    assert.ok(owner);
    const native = orm.getNativeConnection<Sequelize>();
    const row = await native.models.User.findOne({
      where: { id: owner.id },
      include: [{ model: native.models.Room, as: "rooms" }],
    });
    const plain = row?.get({ plain: true }) as
      | (User & { rooms: Room[] })
      | undefined;
    assert.equal(plain?.rooms.length, 2);
  });

  // ── Fuite #4 résolue : repository tx-aware via withTransaction ─────────────
  it("transaction : commit persiste (repo tx-aware, sans trappe native)", async () => {
    const before = await rooms.count();
    await orm.transaction(async (tx) => {
      const owner = await users.withTransaction(tx).create({ email: "tx@b.c" });
      await rooms
        .withTransaction(tx)
        .create({ name: "tx-room", userId: owner.id });
    });
    assert.equal(await rooms.count(), before + 1);
    assert.ok(await users.findOne({ email: "tx@b.c" })); // user aussi committé
  });

  it("transaction : rollback annule TOUT (user + room dans la même tx)", async () => {
    const beforeRooms = await rooms.count();
    const beforeUsers = await users.count();
    await assert.rejects(
      orm.transaction(async (tx) => {
        const u = await users
          .withTransaction(tx)
          .create({ email: "doomed@b.c" });
        await rooms
          .withTransaction(tx)
          .create({ name: "doomed", userId: u.id });
        throw new Error("boom");
      }),
      /boom/,
    );
    assert.equal(await rooms.count(), beforeRooms);
    assert.equal(await users.count(), beforeUsers); // user AUSSI rollback
    assert.equal(await users.findOne({ email: "doomed@b.c" }), null);
  });

  // ── ADR-0003 risque #3 résolu : opérateurs riches typés et portables ──────
  it("opérateurs riches : $gt / $gte / $lt / $in / $nin / $ne / $like", async () => {
    await rooms.delete({});
    await users.delete({});
    await users.create({ email: "u20@x.c", age: 20 });
    await users.create({ email: "u30@x.c", age: 30 });
    await users.create({ email: "u40@x.c", age: 40 });

    assert.equal((await users.find({ age: { $gt: 25 } })).length, 2);
    assert.equal((await users.find({ age: { $gte: 30 } })).length, 2);
    assert.equal((await users.find({ age: { $lt: 30 } })).length, 1);
    assert.equal((await users.find({ age: { $gte: 20, $lte: 30 } })).length, 2);
    assert.equal((await users.find({ age: { $in: [20, 40] } })).length, 2);
    assert.equal((await users.find({ age: { $nin: [20, 40] } })).length, 1);
    assert.equal((await users.find({ age: { $ne: 30 } })).length, 2);
    assert.equal((await users.find({ email: { $like: "u2%" } })).length, 1);
  });

  // ── Profiler seam : tap logging+benchmark → RequestContext.pushQuery ──────
  it("profiler : pousse les requêtes SQL dans le buffer ALS (dev)", async () => {
    const queries: IProfilerQuery[] = [];
    await RequestContext.run({ requestId: "prof-1", queries }, async () => {
      await users.create({ email: "prof@b.c" });
      await users.findOne({ email: "prof@b.c" });
    });
    assert.ok(
      queries.length >= 2,
      `attendu >= 2 requêtes, eu ${queries.length}`,
    );
    assert.equal(queries[0].connector, "sequelize");
    assert.equal(typeof queries[0].durationMs, "number");
    assert.ok(queries.some((q) => /insert/i.test(q.sql)));
    assert.ok(queries.some((q) => /select/i.test(q.sql)));
  });

  it("profiler : coût nul hors profiling (pas de buffer → pas de push)", async () => {
    // Scope SANS queries (= prod) : isProfiling() false, rien ne fuit.
    await RequestContext.run({ requestId: "prof-off" }, async () => {
      assert.equal(RequestContext.isProfiling(), false);
      await users.count();
    });
    assert.equal(RequestContext.get(), undefined); // scope refermé
  });

  // ── describeConnection : data plane Dashboard ORM ─────────────────────────
  it("describeConnection : SQLite :memory: (driver/cible/versions)", () => {
    const info = orm.describeConnection();
    assert.equal(info.driver, "sqlite");
    assert.equal(info.target, ":memory:");
    assert.match(info.version ?? "", /^\d+\.\d+/); // version moteur SQLite captée au connect
    assert.match(info.ormVersion ?? "", /^\d+\.\d+/); // version lib sequelize
  });

  it("describeConnection : SQLite chemin absolu → relatif au cwd (anti info-leak)", () => {
    const abs = `${process.cwd()}/tmp/leak.db`;
    const probe = new SequelizeOrm("db_target", {
      dialect: "sqlite",
      storage: abs,
      logging: false,
    });
    const { target } = probe.describeConnection();
    assert.equal(target, "tmp/leak.db"); // jamais d'absolu
    assert.ok(!target?.startsWith("/"), "ne doit jamais commencer par /");
    ormRegistry.unregister("db_target");
  });

  it("describeConnection : dialecte serveur → host:port/base SANS credential", () => {
    const probe = new SequelizeOrm("db_pg", {
      dialect: "postgres",
      host: "db.internal",
      port: 5432,
      database: "nodefony",
      username: "postgres",
      password: "s3cr3t",
      logging: false,
    });
    const { driver, target } = probe.describeConnection();
    assert.equal(driver, "postgres");
    assert.equal(target, "db.internal:5432/nodefony");
    assert.ok(!target?.includes("s3cr3t"), "le password ne doit JAMAIS fuiter");
    assert.ok(!target?.includes("postgres@"), "le username ne doit pas fuiter");
    ormRegistry.unregister("db_pg");
  });
});
