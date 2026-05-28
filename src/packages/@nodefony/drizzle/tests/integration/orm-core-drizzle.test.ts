import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { entity, entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { IRepository } from "@nodefony/orm-core";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
import type { DrizzleDb } from "../../nodefony/src/orm-core/index";

const ORM = "db_test";

/** Formes plates renvoyées par les repositories. */
interface User {
  id: string;
  email: string;
  age: number;
  rooms?: Room[]; // peuplé par eager-load (options.relations)
}
interface Room {
  id: string;
  name: string;
  userId: string;
}

// ── Tables Drizzle = schéma (schema-as-code) ────────────────────────────────
// `schema` d'@entity EST déjà une table Drizzle (pas de compilation de modèle).
const usersTable = sqliteTable("User", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  email: text("email").notNull().unique(),
  age: integer("age").notNull(),
});

const roomsTable = sqliteTable("Room", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  name: text("name").notNull(),
  userId: text("userId").notNull(),
});

@entity({
  orm: ORM,
  name: "User",
  schema: usersTable,
  relations: [{ type: "one-to-many", target: "Room", field: "rooms" }],
})
class UserEntity {}

@entity({ orm: ORM, name: "Room", schema: roomsTable })
class RoomEntity {}

void UserEntity;
void RoomEntity;

describe("orm-core ↔ Drizzle adapter (P7.4)", () => {
  let orm: DrizzleOrm;
  let users: IRepository<User>;
  let rooms: IRepository<Room>;

  beforeAll(async () => {
    orm = new DrizzleOrm(ORM, { filename: ":memory:" });
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

  it("describeConnection : driver sqlite + cible :memory: + version (data plane)", () => {
    const c = orm.describeConnection();
    assert.equal(c.driver, "sqlite");
    assert.equal(c.target, ":memory:");
    assert.match(c.version ?? "", /^\d+\.\d+/); // ex. "3.45.1"
  });

  it("CRUD portable : create / findOne / find / count / update / delete", async () => {
    const created = await users.create({ email: "a@b.c", age: 30 });
    assert.match(created.id, /[0-9a-f-]{36}/); // UUID auto-généré ($defaultFn)
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

  it("relation one-to-many : FK userId + écriture/lecture portable", async () => {
    const owner = await users.create({ email: "owner@b.c", age: 40 });
    await rooms.create({ name: "general", userId: owner.id });
    await rooms.create({ name: "random", userId: owner.id });

    const ownerRooms = await rooms.find({ userId: owner.id });
    assert.equal(ownerRooms.length, 2);
    assert.equal(ownerRooms[0].userId, owner.id);
  });

  // ── Fuite #1 résolue : eager-load PORTABLE via options.relations ──────────
  it("eager-load PORTABLE : findOne(criteria, { relations }) charge l'association", async () => {
    const owner = await users.findOne(
      { email: "owner@b.c" },
      { relations: ["rooms"] },
    );
    assert.ok(owner);
    assert.equal(owner.rooms?.length, 2);
  });

  // ── ADR-0003 risque #3 résolu : opérateurs riches typés et portables ──────
  it("opérateurs riches : $gt / $gte / $lt / $in / $nin / $ne / $like", async () => {
    await users.delete({}); // reset
    await rooms.delete({});
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

    const young = await users.findOne({ age: { $lt: 25 } });
    assert.equal(young?.email, "u20@x.c");
  });

  it("trappe native toujours dispo (jointure brute SQL, ADR-0003 risque #1)", async () => {
    await users.delete({});
    await rooms.delete({});
    const owner = await users.create({ email: "join@b.c", age: 50 });
    await rooms.create({ name: "r1", userId: owner.id });
    await rooms.create({ name: "r2", userId: owner.id });

    const native = orm.getNativeConnection<DrizzleDb>();
    const result = native.all(
      sql`SELECT u.id AS uid, COUNT(r.id) AS cnt
          FROM "User" u LEFT JOIN "Room" r ON r."userId" = u.id
          WHERE u.id = ${owner.id} GROUP BY u.id`,
    ) as Array<{ uid: string; cnt: number }>;
    assert.equal(result[0]?.cnt, 2);
  });

  // ── Fuite #4 résolue : repository tx-aware via withTransaction ─────────────
  it("transaction : commit persiste (repo tx-aware, sans trappe native)", async () => {
    await users.delete({});
    await rooms.delete({});
    const before = await rooms.count();
    await orm.transaction(async (tx) => {
      const owner = await users
        .withTransaction(tx)
        .create({ email: "tx@b.c", age: 33 });
      await rooms
        .withTransaction(tx)
        .create({ name: "tx-room", userId: owner.id });
    });
    assert.equal(await rooms.count(), before + 1);
    assert.ok(await users.findOne({ email: "tx@b.c" }));
  });

  it("transaction : rollback annule TOUT (user + room dans la même tx)", async () => {
    const beforeRooms = await rooms.count();
    const beforeUsers = await users.count();
    await assert.rejects(
      orm.transaction(async (tx) => {
        const u = await users
          .withTransaction(tx)
          .create({ email: "doomed@b.c", age: 99 });
        await rooms
          .withTransaction(tx)
          .create({ name: "doomed", userId: u.id });
        throw new Error("boom");
      }),
      /boom/,
    );
    assert.equal(await rooms.count(), beforeRooms);
    assert.equal(await users.count(), beforeUsers);
    assert.equal(await users.findOne({ email: "doomed@b.c" }), null);
  });
});
