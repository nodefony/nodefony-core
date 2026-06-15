import assert from "node:assert/strict";
import { mongoTestUri } from "../helpers/mongoTestUri";
import { entity, entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { IRepository } from "@nodefony/orm-core";
import { MongooseOrm } from "../../nodefony/src/orm-core/index";

const ORM = "mongo_test";
// Serveur Mongo PARTAGÉ (globalSetup, ReplSet pour les transactions) scopé sur
// la base `mongo_test`. `null` → infra absente → suite skippée.
const URI = mongoTestUri(ORM);

/** Formes plates renvoyées par les repositories (id = virtuel hex de l'ObjectId). */
interface User {
  id: string;
  email: string;
  age?: number;
  rooms?: Room[]; // peuplé par eager-load (populate)
}
interface Room {
  id: string;
  name: string;
}

// ── Entités logiques du banc ORM, store hétérogène ─────────────────────────
@entity({
  orm: ORM,
  name: "User",
  schema: {
    email: { type: String, required: true, unique: true },
    age: { type: Number },
  },
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

describe.skipIf(!URI)(
  "orm-core ↔ Mongoose adapter (P5.4, store hétérogène)",
  () => {
    let orm: MongooseOrm;
    let users: IRepository<User>;
    let rooms: IRepository<Room>;

    beforeAll(async () => {
      orm = new MongooseOrm(ORM, URI!);
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

      const updated = await users.updateOne(
        { id: created.id },
        { email: "x@y.z" },
      );
      assert.equal(updated?.email, "x@y.z");

      assert.equal(await users.delete({ id: created.id }), 1);
      assert.equal(await users.count(), 0);
    });

    it("relation one-to-many : ref ObjectId + écriture/lecture portable", async () => {
      const owner = await users.create({ email: "owner@b.c" });
      await rooms.create({
        name: "general",
        userId: owner.id,
      } as Partial<Room>);
      await rooms.create({ name: "random", userId: owner.id } as Partial<Room>);

      const ownerRooms = await rooms.find({
        userId: owner.id,
      } as Partial<Room>);
      assert.equal(ownerRooms.length, 2);
    });

    // ── Graphe canonique : describeEntity (schema.paths) ──────────────────────
    it("describeEntity : colonnes normalisées (_id pk, types Mongoose)", () => {
      const cols = orm.describeEntity("User");
      const byName = new Map(cols.map((c) => [c.name, c]));

      const id = byName.get("_id");
      assert.ok(id, "_id absent");
      assert.equal(id.primaryKey, true);
      assert.equal(id.nullable, false);
      assert.match(id.type, /objectid/i); // "ObjectID"/"ObjectId" selon version

      const email = byName.get("email");
      assert.ok(email);
      assert.equal(email.type, "String");
      assert.equal(email.unique, true);
      assert.equal(email.nullable, false); // required: true

      const age = byName.get("age");
      assert.ok(age);
      assert.equal(age.type, "Number");
      assert.equal(age.nullable, true); // pas de required

      assert.deepEqual(orm.describeEntity("Inconnu"), []); // entité inconnue → []
    });

    it("eager-load PORTABLE : findOne(criteria, { relations }) → populate", async () => {
      const owner = await users.findOne(
        { email: "owner@b.c" },
        { relations: ["rooms"] },
      );
      assert.ok(owner);
      assert.equal(owner.rooms?.length, 2); // virtual populate, API portable
    });

    it("transaction (session/replset) : commit persiste (repo tx-aware)", async () => {
      const before = await rooms.count();
      await orm.transaction(async (tx) => {
        const owner = await users
          .withTransaction(tx)
          .create({ email: "tx@b.c" });
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

    // ── ADR-0003 risque #3 résolu : opérateurs riches portables ($like→$regex) ─
    it("opérateurs riches : $gt / $gte / $lt / $in / $nin / $ne / $like", async () => {
      await users.delete({});
      await rooms.delete({});
      await users.create({ email: "u20@x.c", age: 20 });
      await users.create({ email: "u30@x.c", age: 30 });
      await users.create({ email: "u40@x.c", age: 40 });

      assert.equal((await users.find({ age: { $gt: 25 } })).length, 2);
      assert.equal((await users.find({ age: { $gte: 30 } })).length, 2);
      assert.equal((await users.find({ age: { $lt: 30 } })).length, 1);
      assert.equal(
        (await users.find({ age: { $gte: 20, $lte: 30 } })).length,
        2,
      );
      assert.equal((await users.find({ age: { $in: [20, 40] } })).length, 2);
      assert.equal((await users.find({ age: { $nin: [20, 40] } })).length, 1);
      assert.equal((await users.find({ age: { $ne: 30 } })).length, 2);
      // $like SQL (`%`) traduit en RegExp ancrée côté adapter Mongo.
      assert.equal((await users.find({ email: { $like: "u2%" } })).length, 1);
    });
  },
);
