import assert from "node:assert/strict";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { entity, entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { IRepository } from "@nodefony/orm-core";
import { MongooseOrm } from "../../nodefony/src/orm-core/index";

const ORM = "mongo_test";

/** Formes plates renvoyées par les repositories (id = virtuel hex de l'ObjectId). */
interface User {
  id: string;
  email: string;
  rooms?: Room[]; // peuplé par eager-load (populate)
}
interface Room {
  id: string;
  name: string;
}

// ── Mêmes entités logiques que le banc Sequelize, store hétérogène ──────────
@entity({
  orm: ORM,
  name: "User",
  schema: { email: { type: String, required: true, unique: true } },
  relations: [{ type: "one-to-many", target: "Room", field: "rooms" }],
})
class UserEntity {}

@entity({
  orm: ORM,
  name: "Room",
  schema: { name: { type: String, required: true } },
})
class RoomEntity {}

void UserEntity;
void RoomEntity;

describe("orm-core ↔ Mongoose adapter (P5.4, store hétérogène)", () => {
  let replset: MongoMemoryReplSet;
  let orm: MongooseOrm;
  let users: IRepository<User>;
  let rooms: IRepository<Room>;

  before(async () => {
    // Replica set en mémoire : indispensable pour les transactions MongoDB.
    replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    orm = new MongooseOrm(ORM, replset.getUri());
    await orm.connect();
    users = orm.getRepository<User>("User");
    rooms = orm.getRepository<Room>("Room");
  });

  after(async () => {
    await orm.disconnect();
    await replset.stop();
    entityRegistry.unregister("User");
    entityRegistry.unregister("Room");
    ormRegistry.unregister(ORM);
  });

  it("s'auto-enregistre dans ormRegistry + se connecte", () => {
    assert.equal(ormRegistry.has(ORM), true);
    assert.equal(orm.isConnected(), true);
  });

  it("CRUD portable + PK _id↔id : create / findOne(id) / count / update / delete", async () => {
    const created = await users.create({ email: "a@b.c" });
    assert.match(created.id, /^[0-9a-f]{24}$/); // ObjectId hex via virtuel `id`

    // findOne par { id } → traduit en { _id } par l'adapter (portable).
    const byId = await users.findOne({ id: created.id });
    assert.equal(byId?.email, "a@b.c");

    assert.equal(await users.count(), 1);

    const updated = await users.update({ id: created.id }, { email: "x@y.z" });
    assert.equal(updated?.email, "x@y.z");

    assert.equal(await users.delete({ id: created.id }), 1);
    assert.equal(await users.count(), 0);
  });

  it("relation one-to-many : ref ObjectId + écriture/lecture portable", async () => {
    const owner = await users.create({ email: "owner@b.c" });
    await rooms.create({ name: "general", userId: owner.id } as Partial<Room>);
    await rooms.create({ name: "random", userId: owner.id } as Partial<Room>);

    const ownerRooms = await rooms.find({ userId: owner.id } as Partial<Room>);
    assert.equal(ownerRooms.length, 2);
  });

  it("eager-load PORTABLE : findOne(criteria, { relations }) → populate", async () => {
    const owner = await users.findOne(
      { email: "owner@b.c" },
      { relations: ["rooms"] },
    );
    assert.ok(owner);
    assert.equal(owner.rooms?.length, 2); // virtual populate, même API que Sequelize
  });

  it("transaction (session/replset) : commit persiste (repo tx-aware)", async () => {
    const before = await rooms.count();
    await orm.transaction(async (tx) => {
      const owner = await users.withTransaction(tx).create({ email: "tx@b.c" });
      await rooms
        .withTransaction(tx)
        .create({ name: "tx-room", userId: owner.id } as Partial<Room>);
    });
    assert.equal(await rooms.count(), before + 1);
    assert.ok(await users.findOne({ email: "tx@b.c" }));
  });

  it("transaction : rollback annule TOUT (closure qui rejette)", async () => {
    const beforeRooms = await rooms.count();
    const beforeUsers = await users.count();
    await assert.rejects(
      orm.transaction(async (tx) => {
        const u = await users
          .withTransaction(tx)
          .create({ email: "doomed@b.c" });
        await rooms
          .withTransaction(tx)
          .create({ name: "doomed", userId: u.id } as Partial<Room>);
        throw new Error("boom");
      }),
      /boom/,
    );
    assert.equal(await rooms.count(), beforeRooms);
    assert.equal(await users.count(), beforeUsers);
  });
});
