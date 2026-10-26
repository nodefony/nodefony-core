import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { BootConfigurationError } from "nodefony";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { IRepository } from "@nodefony/orm-core";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
import { registerUserEntity } from "../../nodefony/entity/userTable";

/**
 * Un champ privé ne sort JAMAIS par une relation.
 *
 * Vécu au banc de portabilité : `GET /api/reviews/:id?include=owner` rendait la
 * ligne `User` entière, empreinte argon2 comprise, sur les quatre moteurs.
 */
const ORM = "db_private_fields";

const reviewTable = sqliteTable("Review", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  comment: text("comment").notNull(),
  ownerId: text("ownerId").notNull(),
});
const shelfTable = sqliteTable("Shelf", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  label: text("label").notNull(),
});
const itemTable = sqliteTable("Item", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  title: text("title").notNull(),
  cost: text("cost").notNull(),
  shelfId: text("shelfId").notNull(),
});

interface IOwner {
  id: string;
  identifier: string;
  password?: string;
}
interface IReview {
  id: string;
  comment: string;
  ownerId: string;
  owner?: Record<string, unknown> | null;
}
interface IShelf {
  id: string;
  label: string;
  items?: Record<string, unknown>[];
}

describe("Drizzle — un champ privé ne sort pas par une relation", () => {
  let orm: DrizzleOrm;
  let users: IRepository<IOwner>;
  let reviews: IRepository<IReview>;
  let shelves: IRepository<IShelf>;
  let items: IRepository<Record<string, unknown>>;

  beforeAll(async () => {
    registerUserEntity(ORM);
    entityRegistry.register({
      connector: ORM,
      name: "Review",
      schema: reviewTable,
      relations: [
        {
          type: "many-to-one",
          target: "User",
          field: "owner",
          foreignKey: "ownerId",
        },
      ],
    });
    entityRegistry.register({
      connector: ORM,
      name: "Shelf",
      schema: shelfTable,
      relations: [
        {
          type: "one-to-many",
          target: "Item",
          field: "items",
          foreignKey: "shelfId",
        },
      ],
    });
    entityRegistry.register({
      connector: ORM,
      name: "Item",
      schema: itemTable,
      privateFields: ["cost"],
    });
    orm = new DrizzleOrm(ORM, { filename: ":memory:" });
    await orm.connect();
    users = orm.getRepository<IOwner>("User");
    reviews = orm.getRepository<IReview>("Review");
    shelves = orm.getRepository<IShelf>("Shelf");
    items = orm.getRepository("Item");
  });

  afterAll(async () => {
    await orm.disconnect();
    for (const name of ["User", "Review", "Shelf", "Item"]) {
      entityRegistry.unregister(name, ORM);
    }
    ormRegistry.unregister(ORM);
  });

  it("many-to-one vers User : l'identifiant sort, l'empreinte et l'état d'autorisation non", async () => {
    const owner = await users.create({
      identifier: "owner@nodefony.dev",
      password: "$argon2id$secret",
    });
    const review = await reviews.create({
      comment: "bien",
      ownerId: owner.id,
    });
    const [loaded] = await reviews.find(
      { id: review.id },
      { relations: ["owner"] },
    );
    assert.equal(loaded?.owner?.["identifier"], "owner@nodefony.dev");
    for (const hidden of ["password", "roles", "credentialsVersion"]) {
      assert.ok(!(hidden in (loaded?.owner ?? {})), hidden);
    }
    // La porte de l'entité elle-même rend toujours l'empreinte : l'authentification la lit là.
    const direct = await users.findOne({ id: owner.id });
    assert.equal(direct?.password, "$argon2id$secret");
  });

  it("one-to-many : un champ déclaré privé par l'enfant ne sort pas", async () => {
    const shelf = await shelves.create({ label: "A" });
    await items.create({ title: "lampe", cost: "12.50", shelfId: shelf.id });
    const [loaded] = await shelves.find(
      { id: shelf.id },
      { relations: ["items"] },
    );
    assert.equal(loaded?.items?.length, 1);
    assert.equal(loaded?.items?.[0]?.["title"], "lampe");
    assert.ok(!("cost" in (loaded?.items?.[0] ?? {})));
  });

  it("un champ privé mal orthographié refuse la connexion en le nommant", async () => {
    const name = "db_private_fields_typo";
    entityRegistry.register({
      connector: name,
      name: "Item",
      schema: itemTable,
      privateFields: ["cots"],
    });
    entityRegistry.register({
      connector: name,
      name: "Shelf",
      schema: shelfTable,
      relations: [
        {
          type: "one-to-many",
          target: "Item",
          field: "items",
          foreignKey: "shelfId",
        },
      ],
    });
    const typo = new DrizzleOrm(name, { filename: ":memory:" });
    try {
      await assert.rejects(
        typo.connect(),
        (error: unknown) =>
          error instanceof BootConfigurationError &&
          error.message.includes("« cots »"),
      );
    } finally {
      await typo.disconnect().catch(() => undefined);
      entityRegistry.unregister("Item", name);
      entityRegistry.unregister("Shelf", name);
      ormRegistry.unregister(name);
    }
  });
});
