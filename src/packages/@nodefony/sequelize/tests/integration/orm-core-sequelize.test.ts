import assert from "node:assert/strict";
import { DataTypes } from "sequelize";
import type { Sequelize } from "sequelize";
import { entity, entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { IRepository } from "@nodefony/orm-core";
import { SequelizeOrm } from "../../nodefony/src/orm-core/index";

const ORM = "db_test";

/** Formes plates renvoyées par les repositories (jamais des instances Model). */
interface User {
  id: string;
  email: string;
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
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    email: { type: DataTypes.STRING, allowNull: false, unique: true },
  },
  relations: [{ type: "one-to-many", target: "Room", field: "rooms" }],
})
class UserEntity {}

@entity({
  orm: ORM,
  name: "Room",
  schema: {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
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

  before(async () => {
    orm = new SequelizeOrm(ORM, {
      dialect: "sqlite",
      storage: ":memory:",
      logging: false,
    });
    await orm.connect();
    users = orm.getRepository<User>("User");
    rooms = orm.getRepository<Room>("Room");
  });

  after(async () => {
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

  // ── CAS DUR (ADR-0003 risque #1 « abstraction qui fuit ») ─────────────────
  it("jointure/eager-load : IMPOSSIBLE via le repo portable → trappe native", async () => {
    const owner = await users.findOne({ email: "owner@b.c" });
    assert.ok(owner);

    // Le contrat IRepository (find/findOne + OrmCriteria) n'exprime PAS d'include.
    // → on doit descendre à la connexion native (limite documentée).
    const native = orm.getNativeConnection<Sequelize>();
    const row = await native.models.User.findOne({
      where: { id: owner.id },
      include: [{ model: native.models.Room, as: "rooms" }],
    });
    const plain = row?.get({ plain: true }) as
      | (User & { rooms: Room[] })
      | undefined;
    assert.equal(plain?.rooms.length, 2); // 1 seule requête (JOIN)

    // Alternative 100 % portable mais N+1 (2 requêtes séquentielles).
    const ownerAgain = await users.findOne({ id: owner.id });
    const ownerRooms = await rooms.find({ userId: ownerAgain?.id });
    assert.equal(ownerRooms.length, 2);
  });

  it("transaction managée : commit persiste", async () => {
    const before = await rooms.count();
    await orm.transaction(async (tx) => {
      const native = orm.getNativeConnection<Sequelize>();
      const owner = await users.create({ email: "tx@b.c" });
      await native.models.Room.create(
        { name: "tx-room", userId: owner.id },
        { transaction: tx.getNative() },
      );
    });
    assert.equal(await rooms.count(), before + 1);
  });

  it("transaction managée : rollback annule (closure qui rejette)", async () => {
    const owner = await users.findOne({ email: "owner@b.c" });
    assert.ok(owner);
    const before = await rooms.count();
    await assert.rejects(
      orm.transaction(async (tx) => {
        const native = orm.getNativeConnection<Sequelize>();
        // Insert valide DANS la tx, puis on jette → la tx doit tout annuler.
        await native.models.Room.create(
          { name: "doomed", userId: owner.id },
          { transaction: tx.getNative() },
        );
        throw new Error("boom");
      }),
      /boom/,
    );
    assert.equal(await rooms.count(), before); // rien persisté (rollback)
  });
});
