import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { IEntity } from "@nodefony/orm-core";
import { DrizzleOrm, seedEntityRow } from "../../nodefony/src/orm-core/index";
import { defineTable } from "../../nodefony/entity/colKit";

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

// La même ligne parente, déclarée en description PORTABLE : le semis lit la
// table que l'ORM en décline pour son dialecte.
const portableEntity: IEntity = {
  name: "SeedPortable",
  connector: ORM,
  schema: defineTable({
    name: "SeedPortable",
    columns: {
      id: { kind: "uuid", primaryKey: true, defaultFn: () => randomUUID() },
      email: { kind: "string", length: 120, notNull: true, unique: true },
      hits: { kind: "int", notNull: true },
      rank: { kind: "int", notNull: true, default: 3 },
    },
  }),
};

// Une cible aux types BORNÉS — ceux que `seed-1` violait : un décimal (codec),
// une longueur exacte et une longueur courte (CHECK), un uuid, un jour, une
// énumération. Vécu : le test généré d'un `Book` ne semait pas son `Author`
// (« "seed-1" is not a decimal number »).
const boundedTable = defineTable({
  name: "SeedBounded",
  columns: {
    id: { kind: "serial", primaryKey: true },
    balance: { kind: "decimal", precision: 12, scale: 2, notNull: true },
    country: { kind: "char", length: 3, notNull: true },
    code: { kind: "string", length: 4, notNull: true },
    token: { kind: "uuid", notNull: true },
    day: { kind: "date", notNull: true },
    level: { kind: "enum", values: ["junior", "senior"], notNull: true },
  },
});
const boundedEntity: IEntity = {
  name: "SeedBounded",
  connector: ORM,
  schema: boundedTable,
};
// Une cible qui porte ELLE-MÊME une référence obligatoire : semée en deux temps.
const nestedEntity: IEntity = {
  name: "SeedNested",
  connector: ORM,
  schema: defineTable({
    name: "SeedNested",
    columns: {
      id: { kind: "uuid", primaryKey: true, defaultFn: () => randomUUID() },
      label: { kind: "string", notNull: true },
      bounded: { kind: "ref", target: () => boundedTable, notNull: true },
    },
  }),
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
    entityRegistry.register(portableEntity);
    entityRegistry.register(boundedEntity);
    entityRegistry.register(nestedEntity);
    orm = new DrizzleOrm(ORM, { filename: ":memory:" });
    await orm.connect();
  });

  afterAll(async () => {
    await orm.disconnect();
    entityRegistry.unregister("SeedParent", ORM);
    entityRegistry.unregister("SeedChild", ORM);
    entityRegistry.unregister("SeedPortable", ORM);
    entityRegistry.unregister("SeedBounded", ORM);
    entityRegistry.unregister("SeedNested", ORM);
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

  it("sème une entité PORTABLE — défaut littéral laissé au schéma", async () => {
    const id = await seedEntityRow(orm, portableEntity);
    const found = await orm
      .getRepository<{ id: string; hits: number; rank: number }>("SeedPortable")
      .findOne({ id: String(id) });
    assert.ok(found, "la ligne semée doit être relisible");
    assert.equal(typeof found.hits, "number");
    assert.equal(found.rank, 3);
  });

  it("sème une cible PORTABLE aux types bornés — décimal, char(n), uuid, jour", async () => {
    const id = await seedEntityRow(orm, boundedEntity);
    const found = await orm
      .getRepository<{
        id: number;
        balance: string;
        country: string;
        code: string;
        token: string;
      }>("SeedBounded")
      .findOne({ id: Number(id) });
    assert.ok(found, "la ligne semée doit être relisible");
    assert.equal(found.country.length, 3);
    assert.ok(found.code.length <= 4);
    assert.match(found.token, /^[0-9a-f-]{36}$/u);
    assert.match(found.balance, /^\d+\.00$/u);
  });

  it("une cible à référence obligatoire se sème en deux temps (values)", async () => {
    await assert.rejects(
      () => seedEntityRow(orm, nestedEntity),
      /sème d'abord sa cible/u,
      "sans sa cible, le refus doit dire le geste",
    );
    const bounded = await seedEntityRow(orm, boundedEntity);
    const id = await seedEntityRow(orm, nestedEntity, { bounded });
    assert.equal(typeof id, "string");
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
