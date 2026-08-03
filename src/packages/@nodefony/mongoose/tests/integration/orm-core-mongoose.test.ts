import assert from "node:assert/strict";
import { mongoTestUri } from "../helpers/mongoTestUri";
import {
  entity,
  entityRegistry,
  ormRegistry,
  paginate,
  LIKE_ESCAPE_CHAR,
} from "@nodefony/orm-core";
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
  connector: ORM,
  name: "User",
  schema: {
    email: { type: String, required: true, unique: true },
    age: { type: Number },
  },
  relations: [{ type: "one-to-many", target: "Room", field: "rooms" }],
})
class UserEntity {}

@entity({
  connector: ORM,
  name: "Room",
  schema: { name: { type: String, required: true } },
})
class RoomEntity {}

void UserEntity;
void RoomEntity;

/**
 * Vide les documents de toutes les collections, **sans toucher aux index**.
 *
 * La base servie par docker PERSISTE d'un run à l'autre, contrairement au `mongod`
 * éphémère d'origine : sans ardoise propre, ces bancs ne sont jouables qu'une
 * fois (identifiants uniques → E11000 au second passage). Nettoyer en fin de banc
 * ne suffirait pas — un run interrompu laisse le terrain sale pour le suivant.
 *
 * ⚠️ `dropDatabase()` serait le réflexe, et c'est un piège : mongoose crée ses
 * index au `connect()`, or supprimer la base les emporte **sans les recréer**.
 * Les contraintes d'unicité disparaissent alors en silence, et un banc de
 * concurrence se met à compter des doublons qu'il aurait dû voir refusés.
 */
async function purgeDocuments(orm: MongooseOrm): Promise<void> {
  const connection = orm.getNativeConnection<{
    db?: {
      collections(): Promise<{ deleteMany(f: object): Promise<unknown> }[]>;
    };
  }>();
  const collections = (await connection.db?.collections()) ?? [];
  await Promise.all(collections.map((c) => c.deleteMany({})));
}

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
      await purgeDocuments(orm);
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

    it("paginate : page NATIVE (skip/limit + countDocuments) — offset-first, total, hasNext, Slice, criteria", async () => {
      await users.delete({}); // collection propre
      await users.createMany([
        { email: "p10@x.io", age: 10 },
        { email: "p20@x.io", age: 20 },
        { email: "p30@x.io", age: 30 },
        { email: "p40@x.io", age: 40 },
      ]);
      // Tri EXPLICITE : sans `sort`, l'ordre Mongo suit l'insertion/_id — jamais l'âge.

      // Page 1/2 (age ASC) : [10,20], il reste 30/40 → hasNext, total exact.
      const p1 = await paginate(users, {
        limit: 2,
        offset: 0,
        order: [["age", "ASC"]],
      });
      assert.deepEqual(
        p1.items.map((u) => u.age),
        [10, 20],
      );
      assert.equal(p1.hasNext, true);
      assert.equal(p1.total, 4, "countDocuments sur la collection entière");

      // Page 2/2 : [30,40], plus de suite (le limit+1 ne trouve pas de 5ᵉ).
      const p2 = await paginate(users, {
        limit: 2,
        offset: 2,
        order: [["age", "ASC"]],
      });
      assert.deepEqual(
        p2.items.map((u) => u.age),
        [30, 40],
      );
      assert.equal(p2.hasNext, false);

      // Slice (withTotal:false) : `total` omis, `hasNext` via le limit+1 (pas de count).
      const slice = await paginate(users, {
        limit: 2,
        order: [["age", "ASC"]],
        withTotal: false,
      });
      assert.equal(slice.total, undefined);
      assert.equal(slice.hasNext, true);

      // criteria : page ET total sur la collection FILTRÉE (age ≥ 30).
      const filtered = await paginate(users, {
        limit: 5,
        criteria: { age: { $gte: 30 } },
        order: [["age", "ASC"]],
      });
      assert.deepEqual(
        filtered.items.map((u) => u.age),
        [30, 40],
      );
      assert.equal(
        filtered.total,
        2,
        "countDocuments filtré, pas la collection",
      );
      assert.equal(filtered.hasNext, false);

      await users.delete({}); // cleanup — ne pas polluer les tests suivants
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

    it("$like : un joker ÉCHAPPÉ est littéral — même réponse que les moteurs SQL", async () => {
      // Le motif porte le MÊME échappement qu'en SQL (`\`), et l'adapter doit le
      // lire : un backend documentaire qui l'ignorerait rendrait un autre
      // ensemble de lignes pour le même critère portable — une divergence qui ne
      // se voit qu'en changeant de base de données.
      await users.delete({});
      await users.create({ email: "remise_50@x.c", age: 1 });
      await users.create({ email: "remiseX50@x.c", age: 1 });

      // TÉMOIN : non échappé, `_` reste un joker (sinon le cas suivant passerait
      // aussi sur un adapter qui ne traduit rien du tout).
      assert.equal(
        (await users.find({ email: { $like: "remise_50%" } })).length,
        2,
      );
      const litteral = await users.find({
        email: { $like: `remise${LIKE_ESCAPE_CHAR}_50%` },
      });
      assert.deepEqual(
        litteral.map((u) => u.email),
        ["remise_50@x.c"],
      );
    });

    it("$null / valeur nue null : « le champ est vide » (parité stricte avec Drizzle)", async () => {
      await users.delete({});
      await users.create({ email: "avec@x.c", age: 20 });
      await users.create({ email: "sans1@x.c" }); // age absent → NULL SQL
      await users.create({ email: "sans2@x.c" });

      // En Mongo, `null` matche la valeur null ET le champ ABSENT — c'est bien
      // l'équivalent du NULL SQL (une colonne sans valeur). Même contrat que
      // l'adapter Drizzle, où la valeur nue devient `IS NULL` (et non l'égalité
      // `col = NULL`, toujours fausse en SQL).
      //
      // `age` est déclaré `age?: number` : la VALEUR NUE `{ age: null }` est
      // refusée par le typage (`null` n'est pas dans le type du champ) — c'est
      // voulu, cf `FieldCriteria`. `$null` reste disponible sur tout champ, et
      // c'est lui qui exprime « absent » ici. La valeur nue est couverte par le
      // banc de contrat Drizzle, sur une colonne `string | null`.
      assert.equal((await users.find({ age: { $null: true } })).length, 2);
      const filled = await users.find({ age: { $null: false } });
      assert.deepEqual(
        filled.map((u) => u.email),
        ["avec@x.c"],
      );
      // Combinable en AND avec un autre opérateur — le cas des stores.
      assert.equal(
        (await users.find({ age: { $null: false }, email: { $like: "avec%" } }))
          .length,
        1,
      );
    });

    it("upsert : $max / $min — seuil monotone atomique (parité stricte avec Drizzle)", async () => {
      await users.delete({});
      // INSERT : rien à comparer → valeur posée telle quelle.
      const seeded = await users.upsert(
        { email: "seuil@x.c" },
        { age: { $max: 20 } },
      );
      assert.equal(seeded.age, 20);

      // CONFLIT + valeur INFÉRIEURE → ignorée (le seuil ne recule pas).
      await users.upsert({ email: "seuil@x.c" }, { age: { $max: 10 } });
      assert.equal((await users.findOne({ email: "seuil@x.c" }))?.age, 20);

      // CONFLIT + valeur SUPÉRIEURE → avance.
      const up = await users.upsert(
        { email: "seuil@x.c" },
        { age: { $max: 30 } },
      );
      assert.equal(up.age, 30);

      // $min : le miroir.
      await users.upsert({ email: "plancher@x.c" }, { age: { $min: 50 } });
      await users.upsert({ email: "plancher@x.c" }, { age: { $min: 80 } }); // ignoré
      assert.equal((await users.findOne({ email: "plancher@x.c" }))?.age, 50);
      await users.upsert({ email: "plancher@x.c" }, { age: { $min: 5 } });
      assert.equal((await users.findOne({ email: "plancher@x.c" }))?.age, 5);

      assert.equal(await users.count({}), 2, "aucun doublon");
    });

    it("upsert CONCURRENT : $max garde le maximum, quel que soit l'ordre d'arrivée", async () => {
      await users.delete({});
      // Le cas de `revokeAllForSubject` : N logouts simultanés. Un findOne +
      // `if (v > existant)` laisserait le DERNIER écrire → le seuil RECULE.
      const vals = [5, 90, 12, 40, 7, 100, 33, 2, 61, 8];
      const results = await Promise.allSettled(
        vals.map((v) =>
          users.upsert({ email: "race@x.c" }, { age: { $max: v } }),
        ),
      );
      assert.deepEqual(
        results
          .filter((r) => r.status === "rejected")
          .map((r) => (r as PromiseRejectedResult).reason?.message),
        [],
        "aucun upsert concurrent ne doit être rejeté",
      );
      assert.equal(
        (await users.findOne({ email: "race@x.c" }))?.age,
        100,
        "le maximum survit, jamais un écrivain arrivé plus tard avec moins",
      );
      assert.equal(await users.count({}), 1);
    });

    it("$null combiné à $eq/$ne sur le même champ : lève, n'écrase JAMAIS en silence", async () => {
      // Les deux visent la même clé Mongo ($eq/$ne) : sans garde, l'une
      // écraserait l'autre et le filtre partirait amputé (skip silencieux).
      // Le contrat les déclare exclusifs — l'adapter le fait respecter.
      await assert.rejects(
        () => users.find({ age: { $null: false, $ne: 30 } }),
        /\$null ne se combine pas avec \$ne/,
      );
      await assert.rejects(
        () => users.find({ age: { $null: true, $eq: 30 } }),
        /\$null ne se combine pas avec \$eq/,
      );
    });
  },
);
