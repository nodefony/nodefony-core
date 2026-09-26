import assert from "node:assert/strict";
import { defineEntity, entityRegistry, ormRegistry } from "@nodefony/orm-core";
import { sql } from "drizzle-orm";
import { pgTable, text as pgText } from "drizzle-orm/pg-core";
import { mysqlTable, varchar } from "drizzle-orm/mysql-core";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";

/**
 * L'intégrité référentielle tient-elle **sur un vrai serveur** ?
 *
 * Le banc SQLite prouve que la contrainte est émise et qu'elle mord ; il ne peut
 * PAS prouver l'ORDRE de création, et c'est justement là que les serveurs
 * diffèrent. SQLite résout ses clés étrangères tardivement : il accepte sans
 * broncher une table qui en désigne une inexistante. PostgreSQL et MySQL
 * REFUSENT — « relation does not exist », « Failed to open the referenced
 * table ». Une application dont les entités sont déclarées dans le mauvais ordre
 * démarre donc en développement et meurt au premier démarrage réel.
 *
 * Les entités sont volontairement enregistrées enfant AVANT parent : sans tri
 * topologique, le `connect()` échoue ici, et nulle part ailleurs.
 *
 * GATES : `NF_PG_URL` / `NF_MYSQL_URL` (sinon skip) :
 *   docker compose -f docker/docker-compose.yml --profile postgres up -d postgres
 *   docker compose -f docker/docker-compose.yml --profile mariadb up -d mariadb
 */

const PG_URL = process.env.NF_PG_URL;
const MYSQL_URL = process.env.NF_MYSQL_URL;

const PARENT_TABLE = "fk_e2e_authors";
const CHILD_TABLE = "fk_e2e_posts";
const PARENT_ENTITY = "FkE2eAuthor";
const CHILD_ENTITY = "FkE2ePost";

/** Surface native commune à `pg` et `mysql2` pour du SQL brut. */
interface Executor {
  execute(query: unknown): Promise<unknown>;
}

const pgParent = pgTable(PARENT_TABLE, {
  id: pgText("id").primaryKey(),
  name: pgText("name").notNull(),
});
const pgChild = pgTable(CHILD_TABLE, {
  id: pgText("id").primaryKey(),
  author: pgText("author")
    .references(() => pgParent.id, { onDelete: "restrict" })
    .notNull(),
});

// MySQL n'indexe pas un `TEXT` sans longueur, et une clé étrangère exige un
// index des deux côtés — d'où `varchar`, comme le fait déjà le colKit.
const mysqlParent = mysqlTable(PARENT_TABLE, {
  id: varchar("id", { length: 191 }).primaryKey(),
  name: varchar("name", { length: 191 }).notNull(),
});
const mysqlChild = mysqlTable(CHILD_TABLE, {
  id: varchar("id", { length: 191 }).primaryKey(),
  author: varchar("author", { length: 191 })
    .references(() => mysqlParent.id, { onDelete: "restrict" })
    .notNull(),
});

/** Retire les tables de sonde — l'enfant d'abord, il tient la contrainte. */
async function dropProbes(orm: DrizzleOrm, quote: string): Promise<void> {
  const executor = orm.getNativeConnection() as Executor;
  for (const table of [CHILD_TABLE, PARENT_TABLE]) {
    await executor.execute(
      sql.raw(`DROP TABLE IF EXISTS ${quote}${table}${quote}`),
    );
  }
}

/**
 * Ouvre un connecteur sur des tables NEUVES, entité ENFANT enregistrée en
 * premier.
 *
 * L'ordre d'enregistrement est le sujet du banc : `CREATE TABLE IF NOT EXISTS`
 * n'ajoute rien à une table qui existe déjà, donc les restes d'une passe
 * précédente masqueraient l'échec qu'on cherche à provoquer.
 */
async function connectFresh(
  ormName: string,
  dialect: "postgres" | "mysql",
  url: string,
): Promise<DrizzleOrm> {
  const quote = dialect === "mysql" ? "`" : '"';
  const cleaner = new DrizzleOrm(`${ormName}_cleaner`, { dialect, url });
  await cleaner.connect();
  await dropProbes(cleaner, quote);
  await cleaner.disconnect();
  ormRegistry.unregister(`${ormName}_cleaner`);

  const parent = dialect === "mysql" ? mysqlParent : pgParent;
  const child = dialect === "mysql" ? mysqlChild : pgChild;
  entityRegistry.register({
    ...defineEntity({ name: CHILD_ENTITY, module: "test", schema: child }),
    connector: ormName,
  });
  entityRegistry.register({
    ...defineEntity({ name: PARENT_ENTITY, module: "test", schema: parent }),
    connector: ormName,
  });
  const orm = new DrizzleOrm(ormName, { dialect, url });
  await orm.connect();
  return orm;
}

/** Ferme la sonde et rend le registre à son état initial. */
async function closeProbe(
  orm: DrizzleOrm,
  ormName: string,
  quote: string,
): Promise<void> {
  await dropProbes(orm, quote);
  await orm.disconnect();
  entityRegistry.unregister(CHILD_ENTITY, ormName);
  entityRegistry.unregister(PARENT_ENTITY, ormName);
  ormRegistry.unregister(ormName);
}

/** Le serveur refuse-t-il vraiment, et pour la raison attendue ? */
async function assertRefuses(
  action: () => Promise<unknown>,
  motif: RegExp,
  quoi: string,
): Promise<void> {
  let message = "";
  try {
    await action();
  } catch (error) {
    message = [error, (error as { cause?: unknown })?.cause]
      .map((err) =>
        err instanceof Error ? err.message : typeof err === "string" ? err : "",
      )
      .join(" ");
  }
  assert.notEqual(message, "", `${quoi} : le serveur a ACCEPTÉ`);
  assert.match(message, motif, `${quoi} : refus pour un autre motif`);
}

describe.skipIf(!PG_URL)("clés étrangères (postgres) — e2e", () => {
  const ORM = "fk_pg_e2e";
  let orm: DrizzleOrm;

  beforeAll(async () => {
    orm = await connectFresh(ORM, "postgres", PG_URL as string);
  });

  afterAll(async () => {
    await closeProbe(orm, ORM, '"');
  });

  // Que le `connect()` ait abouti EST le premier résultat : l'enfant a été
  // déclaré avant le parent, et le serveur aurait refusé sa table sans le tri.
  it("le serveur connaît la contrainte sur la table enfant", async () => {
    const result = (await (orm.getNativeConnection() as Executor).execute(
      sql`SELECT conname FROM pg_constraint
          WHERE conrelid = ${CHILD_TABLE}::regclass AND contype = 'f'`,
    )) as { rows: { conname: string }[] };
    assert.equal(
      result.rows.length,
      1,
      `contrainte absente : ${JSON.stringify(result.rows)}`,
    );
  });

  it("une ligne orpheline est refusée", async () => {
    const posts = orm.getRepository<{ id: string; author: string }>(
      CHILD_ENTITY,
    );
    await assertRefuses(
      () => posts.create({ id: "p1", author: "inconnu" }),
      /foreign key|violates/iu,
      "ligne orpheline",
    );
  });

  it("effacer un parent encore désigné est refusé", async () => {
    const authors = orm.getRepository<{ id: string; name: string }>(
      PARENT_ENTITY,
    );
    const posts = orm.getRepository<{ id: string; author: string }>(
      CHILD_ENTITY,
    );
    await authors.create({ id: "a1", name: "Camus" });
    await posts.create({ id: "p2", author: "a1" });
    await assertRefuses(
      () => authors.deleteOne({ id: "a1" }),
      /foreign key|violates/iu,
      "effacement du parent",
    );
  });
});

describe.skipIf(!MYSQL_URL)(
  "clés étrangères (mysql) — e2e MySQL / MariaDB",
  () => {
    const ORM = "fk_mysql_e2e";
    let orm: DrizzleOrm;

    beforeAll(async () => {
      orm = await connectFresh(ORM, "mysql", MYSQL_URL as string);
    });

    afterAll(async () => {
      await closeProbe(orm, ORM, "`");
    });

    it("le serveur connaît la contrainte sur la table enfant", async () => {
      const result = (await (orm.getNativeConnection() as Executor).execute(
        sql`SELECT CONSTRAINT_NAME AS name FROM information_schema.TABLE_CONSTRAINTS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${CHILD_TABLE}
            AND CONSTRAINT_TYPE = 'FOREIGN KEY'`,
      )) as [{ name: string }[], unknown];
      const rows = Array.isArray(result) ? result[0] : [];
      assert.equal(
        rows.length,
        1,
        `contrainte absente : ${JSON.stringify(rows)}`,
      );
    });

    it("une ligne orpheline est refusée", async () => {
      const posts = orm.getRepository<{ id: string; author: string }>(
        CHILD_ENTITY,
      );
      await assertRefuses(
        () => posts.create({ id: "p1", author: "inconnu" }),
        /foreign key/iu,
        "ligne orpheline",
      );
    });

    it("effacer un parent encore désigné est refusé", async () => {
      const authors = orm.getRepository<{ id: string; name: string }>(
        PARENT_ENTITY,
      );
      const posts = orm.getRepository<{ id: string; author: string }>(
        CHILD_ENTITY,
      );
      await authors.create({ id: "a1", name: "Camus" });
      await posts.create({ id: "p2", author: "a1" });
      await assertRefuses(
        () => authors.deleteOne({ id: "a1" }),
        /foreign key/iu,
        "effacement du parent",
      );
    });
  },
);
