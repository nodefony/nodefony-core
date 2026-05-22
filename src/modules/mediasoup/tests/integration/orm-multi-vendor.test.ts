import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { DataTypes } from "sequelize";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { IRepository } from "@nodefony/orm-core";
import { DrizzleOrm } from "@nodefony/drizzle";
import { SequelizeOrm } from "@nodefony/sequelize";

/**
 * Coexistence **multi-vendor** : un ORM **Drizzle** ET un ORM **Sequelize** connectés
 * dans le MÊME process (même `ormRegistry`), chacun propriétaire de son domaine sur
 * sa propre base `:memory:`.
 *
 * Vérifie le scénario réel de l'app dev (Drizzle `default` + Sequelize `sequelize`) :
 * chaque vendor **écrit et relit** dans son store, **sans contamination croisée**
 * (ségrégation ADR-0003). C'est le test « les deux ORM écrivent bien ensemble ».
 */
const DRZ = "mv_drizzle";
const SEQ = "mv_sequelize";

interface Book {
  id: string;
  title: string;
}
interface Audit {
  id: string;
  action: string;
}

// Schéma Drizzle (sqliteTable) — store du vendor Drizzle.
const bookTable = sqliteTable("MvBook", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  title: text("title").notNull(),
});

describe("ORM multi-vendor — Drizzle + Sequelize écrivent isolément", () => {
  let drizzle: DrizzleOrm;
  let sequelize: SequelizeOrm;
  let books: IRepository<Book>;
  let audits: IRepository<Audit>;

  before(async () => {
    // Entités enregistrées AVANT connect (compilées au onConnect, filtrées par `orm`).
    entityRegistry.register({ orm: DRZ, name: "MvBook", schema: bookTable });
    entityRegistry.register({
      orm: SEQ,
      name: "MvAudit",
      schema: {
        id: {
          type: DataTypes.UUID,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true,
        },
        action: { type: DataTypes.STRING, allowNull: false },
      },
    });

    drizzle = new DrizzleOrm(DRZ, { filename: ":memory:" });
    await drizzle.connect();
    sequelize = new SequelizeOrm(SEQ, {
      dialect: "sqlite",
      storage: ":memory:",
      logging: false,
    });
    await sequelize.connect();

    books = drizzle.getRepository<Book>("MvBook");
    audits = sequelize.getRepository<Audit>("MvAudit");
  });

  after(async () => {
    await drizzle.disconnect();
    await sequelize.disconnect();
    entityRegistry.unregister("MvBook", DRZ);
    entityRegistry.unregister("MvAudit", SEQ);
    ormRegistry.unregister(DRZ);
    ormRegistry.unregister(SEQ);
  });

  it("les deux vendors cohabitent dans le même ormRegistry", () => {
    assert.equal(ormRegistry.has(DRZ), true);
    assert.equal(ormRegistry.has(SEQ), true);
    assert.equal(drizzle.isConnected(), true);
    assert.equal(sequelize.isConnected(), true);
    // Vendors réellement distincts (pas deux fois le même driver).
    assert.equal(drizzle.constructor.name, "DrizzleOrm");
    assert.equal(sequelize.constructor.name, "SequelizeOrm");
  });

  it("chaque vendor ÉCRIT puis RELIT dans son propre store", async () => {
    const b = await books.create({ title: "Clean Code" });
    assert.match(b.id, /[0-9a-f-]{36}/); // UUID auto
    const a = await audits.create({ action: "user.login" });
    assert.match(a.id, /[0-9a-f-]{36}/);

    assert.equal((await books.findOne({ id: b.id }))?.title, "Clean Code");
    assert.equal((await audits.findOne({ id: a.id }))?.action, "user.login");
  });

  it("queryAll par ORM : chacun ne voit QUE ses lignes (0 contamination)", async () => {
    const allBooks = await books.find();
    const allAudits = await audits.find();
    assert.equal(allBooks.length, 1);
    assert.equal(allAudits.length, 1);
    assert.equal(allBooks[0].title, "Clean Code");
    assert.equal(allAudits[0].action, "user.login");
    // L'écriture côté Drizzle n'a pas créé de ligne côté Sequelize, et inversement.
    assert.equal(await books.count(), 1);
    assert.equal(await audits.count(), 1);
  });

  it("isolation des schémas : un ORM ignore l'entité de l'autre", () => {
    // Drizzle ne compile pas MvAudit (orm SEQ), Sequelize ne compile pas MvBook (orm DRZ).
    assert.throws(() => drizzle.getRepository("MvAudit"), /MvAudit/);
    assert.throws(() => sequelize.getRepository("MvBook"), /MvBook/);
    // describeEntity « étranger » = [] (aucune colonne fuitée d'un vendor à l'autre).
    assert.deepEqual(drizzle.describeEntity("MvAudit"), []);
    assert.deepEqual(sequelize.describeEntity("MvBook"), []);
  });

  it("update/delete restent confinés au bon store", async () => {
    const b = (await books.find())[0];
    await books.update({ id: b.id }, { title: "Refactoring" });
    assert.equal((await books.findOne({ id: b.id }))?.title, "Refactoring");
    assert.equal(await audits.count(), 1); // Sequelize intact

    const a = (await audits.find())[0];
    assert.equal(await audits.delete({ id: a.id }), 1);
    assert.equal(await audits.count(), 0);
    assert.equal(await books.count(), 1); // Drizzle intact
  });
});
