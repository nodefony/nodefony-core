import assert from "node:assert/strict";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { entity, entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { IRepository, ITransaction } from "@nodefony/orm-core";
import { MongooseOrm } from "../../nodefony/src/orm-core/index";

// Tests AVANCÉS = invariants NÔTRES (pas la lib) : contrat updateMany, savepoints
// = NO-OP documenté (Mongo n'en a pas), cardinalités d'eager-load (ref source),
// garde-fou many-to-many. Backend = mongodb-memory-server (local, hermétique).

// Replica set partagé par le fichier (les transactions Mongo l'exigent).
let replset: MongoMemoryReplSet;
beforeAll(async () => {
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
}, 60_000);
afterAll(async () => {
  await replset.stop();
});

// ─────────────── updateMany + savepoints (no-op Mongo) ──────────────────────
@entity({
  orm: "mongo_adv_a",
  name: "AdvUser",
  schema: {
    email: { type: String, required: true },
    age: { type: Number, required: true },
    active: { type: Boolean, required: true },
  },
})
class AdvUserEntity {}
void AdvUserEntity;

interface AdvUser {
  id: string;
  email: string;
  age: number;
  active: boolean;
}

describe("Mongoose avancé — updateMany + savepoints (no-op)", () => {
  let orm: MongooseOrm;
  let users: IRepository<AdvUser>;

  beforeAll(async () => {
    orm = new MongooseOrm("mongo_adv_a", replset.getUri());
    await orm.connect();
    users = orm.getRepository<AdvUser>("AdvUser");
  });
  afterAll(async () => {
    await orm.disconnect();
    entityRegistry.unregister("AdvUser");
    ormRegistry.unregister("mongo_adv_a");
  });

  it("updateMany : modifie TOUTES les lignes du critère et retourne le count", async () => {
    await users.delete({});
    await users.create({ email: "a", age: 20, active: true });
    await users.create({ email: "b", age: 30, active: true });
    await users.create({ email: "c", age: 40, active: true });

    const n = await users.updateMany({ age: { $gte: 30 } }, { active: false });
    assert.equal(n, 2); // un NOMBRE (modifiedCount), pas l'entité
    assert.equal((await users.find({ active: false })).length, 2);
    assert.equal((await users.find({ active: true })).length, 1);
  });

  it("updateMany : aucun match → retourne 0", async () => {
    const n = await users.updateMany({ age: { $gt: 1000 } }, { active: false });
    assert.equal(n, 0);
  });

  it("savepoint / rollbackTo : NO-OP documenté (Mongo n'a pas de savepoints) — ne throw pas, n'annule rien", async () => {
    await users.delete({});
    await orm.transaction(async (tx: ITransaction) => {
      const r = users.withTransaction(tx);
      await r.create({ email: "keep", age: 1, active: true });
      await tx.savepoint("sp1"); // no-op
      await r.create({ email: "drop", age: 2, active: true });
      await tx.rollbackTo("sp1"); // no-op → ne rollback PAS "drop"
    });
    // Contrat porté : le savepoint étant un no-op, les DEUX docs persistent.
    assert.ok(await users.findOne({ email: "keep" }));
    assert.ok(await users.findOne({ email: "drop" }));
  });
});

// ─────────────── eager-load many-to-one / one-to-one (ref source) ───────────
@entity({
  orm: "mongo_adv_b",
  name: "Author",
  schema: { name: { type: String, required: true } },
})
class AuthorEntity {}
@entity({
  orm: "mongo_adv_b",
  name: "Book",
  schema: { title: { type: String, required: true } },
  // L'adapter ajoute le champ ref `author` (ObjectId) sur la SOURCE.
  relations: [{ type: "many-to-one", target: "Author", field: "author" }],
})
class BookEntity {}
@entity({
  orm: "mongo_adv_b",
  name: "Passport",
  schema: { code: { type: String, required: true } },
  relations: [{ type: "one-to-one", target: "Author", field: "author" }],
})
class PassportEntity {}
void AuthorEntity;
void BookEntity;
void PassportEntity;

interface Author {
  id: string;
  name: string;
}
interface Book {
  id: string;
  title: string;
  author?: Author | string;
}
interface Passport {
  id: string;
  code: string;
  author?: Author | string;
}

describe("Mongoose avancé — eager-load many-to-one / one-to-one", () => {
  let orm: MongooseOrm;
  let authors: IRepository<Author>;
  let books: IRepository<Book>;
  let passports: IRepository<Passport>;

  beforeAll(async () => {
    orm = new MongooseOrm("mongo_adv_b", replset.getUri());
    await orm.connect();
    authors = orm.getRepository<Author>("Author");
    books = orm.getRepository<Book>("Book");
    passports = orm.getRepository<Passport>("Passport");
  });
  afterAll(async () => {
    await orm.disconnect();
    entityRegistry.unregister("Author");
    entityRegistry.unregister("Book");
    entityRegistry.unregister("Passport");
    ormRegistry.unregister("mongo_adv_b");
  });

  it("many-to-one : eager-load (populate) charge le parent en OBJET", async () => {
    const a = await authors.create({ name: "Hugo" });
    await books.create({
      title: "Les Misérables",
      author: a.id,
    } as Partial<Book>);

    const book = await books.findOne(
      { title: "Les Misérables" },
      { relations: ["author"] },
    );
    assert.ok(book);
    assert.equal((book.author as Author)?.name, "Hugo");
  });

  it("one-to-one : eager-load charge l'unique associé", async () => {
    const a = await authors.create({ name: "Verne" });
    await passports.create({
      code: "FR-42",
      author: a.id,
    } as Partial<Passport>);

    const p = await passports.findOne(
      { code: "FR-42" },
      { relations: ["author"] },
    );
    assert.ok(p);
    assert.equal((p.author as Author)?.name, "Verne");
  });
});

// ──────────────── garde-fou many-to-many : non portable → throw ─────────────
describe("Mongoose avancé — many-to-many = garde-fou (non portable)", () => {
  it("une relation many-to-many fait ÉCHOUER la connexion (→ getNativeConnection)", async () => {
    const ORM_C = "mongo_adv_m2m";
    @entity({
      orm: ORM_C,
      name: "Tag",
      schema: { label: { type: String, required: true } },
    })
    class TagEntity {}
    @entity({
      orm: ORM_C,
      name: "Article",
      schema: { title: { type: String, required: true } },
      relations: [{ type: "many-to-many", target: "Tag", field: "tags" }],
    })
    class ArticleEntity {}
    void TagEntity;
    void ArticleEntity;

    const orm = new MongooseOrm(ORM_C, replset.getUri());
    try {
      await assert.rejects(() => orm.connect(), /many-to-many/);
    } finally {
      await orm.disconnect();
      entityRegistry.unregister("Tag");
      entityRegistry.unregister("Article");
      ormRegistry.unregister(ORM_C);
    }
  });
});
