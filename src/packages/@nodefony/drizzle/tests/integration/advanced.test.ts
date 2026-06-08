import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { entity, entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { IRepository, ITransaction } from "@nodefony/orm-core";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";

// Tests AVANCÉS = invariants NÔTRES (pas la lib) : contrat updateMany, savepoints
// SQL réels + anti-injection, cardinalités d'eager-load, garde-fou many-to-many.

// ───────────────────────── updateMany + savepoints ─────────────────────────
const ORM_A = "db_adv_a";
const advUserTable = sqliteTable("AdvUser", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  email: text("email").notNull(),
  age: integer("age").notNull(),
  active: integer("active", { mode: "boolean" }).notNull(),
});
@entity({ orm: ORM_A, name: "AdvUser", schema: advUserTable })
class AdvUserEntity {}
void AdvUserEntity;

interface AdvUser {
  id: string;
  email: string;
  age: number;
  active: boolean;
}

describe("Drizzle avancé — updateMany + savepoints", () => {
  let orm: DrizzleOrm;
  let users: IRepository<AdvUser>;

  beforeAll(async () => {
    orm = new DrizzleOrm(ORM_A, { filename: ":memory:" });
    await orm.connect();
    users = orm.getRepository<AdvUser>("AdvUser");
  });
  afterAll(async () => {
    await orm.disconnect();
    entityRegistry.unregister("AdvUser");
    ormRegistry.unregister(ORM_A);
  });

  it("updateMany : modifie TOUTES les lignes du critère et retourne le count", async () => {
    await users.delete({});
    await users.create({ email: "a", age: 20, active: true });
    await users.create({ email: "b", age: 30, active: true });
    await users.create({ email: "c", age: 40, active: true });

    const n = await users.updateMany({ age: { $gte: 30 } }, { active: false });
    assert.equal(n, 2); // un NOMBRE, pas l'entité (≠ updateOne)
    assert.equal((await users.find({ active: false })).length, 2);
    assert.equal((await users.find({ active: true })).length, 1);
  });

  it("updateMany : aucun match → retourne 0", async () => {
    const n = await users.updateMany({ age: { $gt: 1000 } }, { active: false });
    assert.equal(n, 0);
  });

  it("savepoint + rollbackTo : rollback PARTIEL sans terminer la transaction", async () => {
    await users.delete({});
    await orm.transaction(async (tx: ITransaction) => {
      const r = users.withTransaction(tx);
      await r.create({ email: "keep", age: 1, active: true });
      await tx.savepoint("sp1");
      await r.create({ email: "drop", age: 2, active: true });
      await tx.rollbackTo("sp1"); // annule "drop", conserve "keep"
    });
    // La transaction globale a commité : "keep" persiste, "drop" est annulé.
    assert.ok(await users.findOne({ email: "keep" }));
    assert.equal(await users.findOne({ email: "drop" }), null);
  });

  it("savepoint : nom non alphanumérique REJETÉ (anti-injection — identifiant SQL)", async () => {
    await assert.rejects(
      orm.transaction(async (tx) => {
        await tx.savepoint('sp"; DROP TABLE "AdvUser');
      }),
      /invalid savepoint name/,
    );
  });

  it("API transaction : getNative + isDone + commit manuel idempotent", async () => {
    await users.delete({});
    await orm.transaction(async (tx) => {
      assert.ok(tx.getNative()); // expose le db Drizzle (trappe bas niveau)
      await users
        .withTransaction(tx)
        .create({ email: "idem", age: 1, active: true });
      await tx.commit(); // commit explicite → marque terminée
      assert.equal((tx as unknown as { isDone(): boolean }).isDone(), true);
      // Le wrapper managé rappellera commit() → no-op (idempotent), pas de double COMMIT.
    });
    assert.ok(await users.findOne({ email: "idem" }));
  });

  it("rollback manuel puis throw → rollback managé idempotent (rien persisté)", async () => {
    const before = await users.count();
    await assert.rejects(
      orm.transaction(async (tx) => {
        await users
          .withTransaction(tx)
          .create({ email: "rb", age: 9, active: true });
        await tx.rollback(); // rollback explicite → marque terminée
        throw new Error("boom"); // wrapper rappelle rollback() → no-op
      }),
      /boom/,
    );
    assert.equal(await users.count(), before);
  });
});

// ─────────────── eager-load many-to-one / one-to-one (FK source) ────────────
const ORM_B = "db_adv_b";
const authorTable = sqliteTable("Author", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  name: text("name").notNull(),
});
const bookTable = sqliteTable("Book", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  title: text("title").notNull(),
  authorId: text("authorId").notNull(), // FK dérivée `<target>Id`
});
const passportTable = sqliteTable("Passport", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  code: text("code").notNull(),
  authorId: text("authorId").notNull(),
});
@entity({ orm: ORM_B, name: "Author", schema: authorTable })
class AuthorEntity {}
@entity({
  orm: ORM_B,
  name: "Book",
  schema: bookTable,
  relations: [{ type: "many-to-one", target: "Author", field: "author" }],
})
class BookEntity {}
@entity({
  orm: ORM_B,
  name: "Passport",
  schema: passportTable,
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
  authorId: string;
  author?: Author | null;
}
interface Passport {
  id: string;
  code: string;
  authorId: string;
  author?: Author | null;
}

describe("Drizzle avancé — eager-load many-to-one / one-to-one", () => {
  let orm: DrizzleOrm;
  let authors: IRepository<Author>;
  let books: IRepository<Book>;
  let passports: IRepository<Passport>;

  beforeAll(async () => {
    orm = new DrizzleOrm(ORM_B, { filename: ":memory:" });
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
    ormRegistry.unregister(ORM_B);
  });

  it("many-to-one : eager-load charge le parent en OBJET (pas un tableau)", async () => {
    const a = await authors.create({ name: "Hugo" });
    await books.create({ title: "Les Misérables", authorId: a.id });

    const book = await books.findOne(
      { title: "Les Misérables" },
      { relations: ["author"] },
    );
    assert.ok(book);
    assert.equal(book.author?.name, "Hugo"); // objet unique
    assert.ok(!Array.isArray(book.author));
  });

  it("many-to-one : FK orpheline → author = null (pas de crash)", async () => {
    await books.create({ title: "Orphan", authorId: "missing-id" });
    const book = await books.findOne(
      { title: "Orphan" },
      { relations: ["author"] },
    );
    assert.equal(book?.author, null);
  });

  it("one-to-one : eager-load charge l'unique associé", async () => {
    const a = await authors.create({ name: "Verne" });
    await passports.create({ code: "FR-42", authorId: a.id });

    const p = await passports.findOne(
      { code: "FR-42" },
      { relations: ["author"] },
    );
    assert.ok(p);
    assert.equal(p.author?.name, "Verne");
  });
});

// ──────────────── garde-fou many-to-many : non portable → throw ─────────────
describe("Drizzle avancé — many-to-many = garde-fou (non portable)", () => {
  it("une relation many-to-many fait ÉCHOUER la connexion (→ getNativeConnection)", async () => {
    const ORM_C = "db_adv_m2m";
    const tagTable = sqliteTable("Tag", {
      id: text("id")
        .primaryKey()
        .$defaultFn(() => randomUUID()),
      label: text("label").notNull(),
    });
    const articleTable = sqliteTable("Article", {
      id: text("id")
        .primaryKey()
        .$defaultFn(() => randomUUID()),
      title: text("title").notNull(),
    });
    @entity({ orm: ORM_C, name: "Tag", schema: tagTable })
    class TagEntity {}
    @entity({
      orm: ORM_C,
      name: "Article",
      schema: articleTable,
      relations: [{ type: "many-to-many", target: "Tag", field: "tags" }],
    })
    class ArticleEntity {}
    void TagEntity;
    void ArticleEntity;

    const orm = new DrizzleOrm(ORM_C, { filename: ":memory:" });
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
