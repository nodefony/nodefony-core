import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { IEntity } from "@nodefony/orm-core";
import { DrizzleOrm, seedEntityRow } from "../../nodefony/src/orm-core/index";

// `seedEntityRow` existe pour UNE raison : depuis que les relations posent une
// contrainte d'intégrité, un test qui invente une clé étrangère est refusé par la
// base. Ces tests éprouvent donc les deux faces — que la contrainte MORD (sinon
// le helper ne servirait à rien), et que le semis la satisfait.

const ORM = "db_seed_row";

const parentTable = sqliteTable("SeedParent", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  // Unique : deux semis du même échantillon violeraient la contrainte. C'est
  // exactement le piège que le compteur interne du helper évite.
  email: text("email").notNull().unique(),
  label: text("label").notNull(),
  hits: integer("hits").notNull(),
  active: integer("active", { mode: "boolean" }).notNull(),
  // Défaut applicatif : le helper doit la LAISSER au schéma, pas la remplir.
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

const childTable = sqliteTable("SeedChild", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  title: text("title").notNull(),
  parent: text("parent")
    .notNull()
    .references(() => parentTable.id, { onDelete: "restrict" }),
});

const parentEntity: IEntity = {
  name: "SeedParent",
  connector: ORM,
  schema: parentTable,
};
const childEntity: IEntity = {
  name: "SeedChild",
  connector: ORM,
  schema: childTable,
};

interface ParentRow {
  id: string;
  email: string;
  label: string;
  hits: number;
  active: boolean;
  createdAt: Date;
}
interface ChildRow {
  id: string;
  title: string;
  parent: string;
}

describe("seedEntityRow — semer la ligne parente d'une relation", () => {
  let orm: DrizzleOrm;

  beforeAll(async () => {
    entityRegistry.register(parentEntity);
    entityRegistry.register(childEntity);
    orm = new DrizzleOrm(ORM, { filename: ":memory:" });
    await orm.connect();
  });

  afterAll(async () => {
    await orm.disconnect();
    entityRegistry.unregister("SeedParent", ORM);
    entityRegistry.unregister("SeedChild", ORM);
    ormRegistry.unregister(ORM);
  });

  it("la contrainte MORD — une clé étrangère inventée est refusée", async () => {
    const children = orm.getRepository<ChildRow>("SeedChild");
    await assert.rejects(
      () =>
        children.create({
          title: "orphelin",
          parent: "00000000-0000-4000-8000-000000000001",
        }),
      /FOREIGN KEY constraint failed/,
      "sans cette garantie, le helper ne servirait à rien",
    );
  });

  it("sème une ligne valide et rend son identifiant", async () => {
    const id = await seedEntityRow(orm, parentEntity);
    assert.equal(typeof id, "string");

    const parents = orm.getRepository<ParentRow>("SeedParent");
    const found = await parents.findOne({ id: id as string });
    assert.ok(found, "la ligne semée doit être relisible");
    assert.equal(typeof found.label, "string");
    assert.equal(typeof found.hits, "number");
    assert.equal(found.active, true);
    // Laissée au schéma : le helper ne remplit pas ce qui a un défaut.
    assert.ok(found.createdAt instanceof Date);
  });

  it("deux semis ne se marchent pas dessus malgré une colonne unique", async () => {
    const first = await seedEntityRow(orm, parentEntity);
    const second = await seedEntityRow(orm, parentEntity);
    assert.notEqual(first, second);

    const parents = orm.getRepository<ParentRow>("SeedParent");
    const a = await parents.findOne({ id: first as string });
    const b = await parents.findOne({ id: second as string });
    assert.ok(a && b);
    assert.notEqual(a.email, b.email, "l'unicité exige des valeurs distinctes");
  });

  it("l'identifiant semé satisfait la clé étrangère", async () => {
    const parentId = (await seedEntityRow(orm, parentEntity)) as string;
    const children = orm.getRepository<ChildRow>("SeedChild");
    const created = await children.create({
      title: "rattaché",
      parent: parentId,
    });
    assert.equal(created.parent, parentId);
  });
});
