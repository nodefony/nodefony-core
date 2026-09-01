import assert from "node:assert/strict";
import {
  FRAMEWORK_TABLES,
  assertSchemasMatch,
  buildDerivedDatabase,
  groupIndexes,
  readInitialMigration,
  releaseDerivedDatabase,
  type IObservedSchema,
} from "./migrations-parity";
import type { DrizzleOrm } from "../../nodefony/src/orm-core/index";

/**
 * Parité migrations ↔ DDL dérivé — **MySQL / MariaDB**.
 *
 * GATE : ne tourne qu'avec `NF_MYSQL_URL` :
 *   docker compose -f docker/docker-compose.yml --profile mariadb up -d mariadb
 *   NF_MYSQL_URL=mysql://nodefony:nodefony-dev@127.0.0.1:3306/nodefony npm test
 *
 * ⚠️ **Les deux chemins se succèdent dans la MÊME base, et c'est voulu.**
 * L'utilisateur applicatif n'a que `GRANT ALL ON nodefony.*` : il ne peut pas
 * créer de base (`ERROR 1044`) — le module le sait déjà, c'est la raison de son
 * `fileParallelism: false`. Aucune autre suite ne tourne donc en même temps que
 * celle-ci, et les tables du framework se recréent seules au `connect` suivant
 * (`CREATE TABLE IF NOT EXISTS`).
 */
const MYSQL_URL = process.env.NF_MYSQL_URL;

describe.skipIf(!MYSQL_URL)("Migrations ↔ DDL dérivé — parité (mysql)", () => {
  const CONNECTOR = "parity_mysql";
  let orm: DrizzleOrm | undefined;
  let admin:
    | {
        query: (sql: string) => Promise<[unknown, unknown]>;
        end: () => Promise<void>;
      }
    | undefined;
  let database: string;
  let migrated: IObservedSchema;
  let derived: IObservedSchema;

  const rows = async (sql: string): Promise<Record<string, unknown>[]> =>
    (await admin!.query(sql))[0] as Record<string, unknown>[];

  /** Efface les tables du framework pour partir d'une base vierge. */
  const dropFrameworkTables = async (): Promise<void> => {
    for (const table of FRAMEWORK_TABLES) {
      await admin!.query(`DROP TABLE IF EXISTS \`${table}\``);
    }
  };

  /**
   * Lit l'état observable de la base courante, tables du framework seulement.
   *
   * @returns colonnes et index, sous la forme comparable du harness.
   */
  const introspect = async (): Promise<IObservedSchema> => {
    const inList = FRAMEWORK_TABLES.map((t) => `'${t}'`).join(", ");
    const tables = (
      await rows(
        `SELECT TABLE_NAME FROM information_schema.TABLES ` +
          `WHERE TABLE_SCHEMA = '${database}' AND TABLE_TYPE = 'BASE TABLE' ` +
          `AND TABLE_NAME IN (${inList}) ORDER BY TABLE_NAME`,
      )
    ).map((r) => String(r.TABLE_NAME));

    const columns: IObservedSchema["columns"] = {};
    // `COLUMN_TYPE` porte la largeur (`varchar(512)`, `datetime(3)`) — c'est
    // exactement ce qui doit être identique : `varchar(512)` contre `text` change
    // la capacité d'indexer sous InnoDB, et `datetime(3)` contre `timestamp`
    // change la borne haute des dates (2038).
    for (const row of await rows(
      `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY ` +
        `FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = '${database}' ` +
        `AND TABLE_NAME IN (${inList})`,
    )) {
      const table = String(row.TABLE_NAME);
      const name = String(row.COLUMN_NAME);
      (columns[table] ??= {})[name] = {
        name,
        type: String(row.COLUMN_TYPE),
        notNull: String(row.IS_NULLABLE) === "NO",
        primaryKey: String(row.COLUMN_KEY) === "PRI",
      };
    }

    // Une ligne par COLONNE d'index : on regroupe par (table, nom d'index) avant
    // de ne garder que les colonnes couvertes — les noms diffèrent d'un chemin à
    // l'autre, les colonnes non.
    const byIndex = new Map<
      string,
      { table: string; unique: boolean; columns: string[] }
    >();
    for (const row of await rows(
      `SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME ` +
        `FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = '${database}' ` +
        `AND TABLE_NAME IN (${inList}) ` +
        `ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
    )) {
      const key = `${row.TABLE_NAME} ${row.INDEX_NAME}`;
      const entry = byIndex.get(key) ?? {
        table: String(row.TABLE_NAME),
        unique: Number(row.NON_UNIQUE) === 0,
        columns: [],
      };
      entry.columns.push(String(row.COLUMN_NAME));
      byIndex.set(key, entry);
    }
    return { tables, columns, indexes: groupIndexes([...byIndex.values()]) };
  };

  beforeAll(async () => {
    const mysql = await import("mysql2/promise");
    const url = new URL(MYSQL_URL as string);
    database = url.pathname.replace(/^\//, "");
    admin = (await mysql.createConnection({
      host: url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database,
      multipleStatements: false,
    })) as unknown as typeof admin;

    // Phase A — la PRODUCTION : le fichier de migration, appliqué tel quel sur
    // un vrai serveur. C'est aussi la seule preuve que ce SQL s'exécute.
    await dropFrameworkTables();
    for (const statement of readInitialMigration("mysql")) {
      await admin!.query(statement);
    }
    migrated = await introspect();

    // Phase B — le DÉVELOPPEMENT : l'adapter dérive le DDL des mêmes entités.
    await dropFrameworkTables();
    orm = await buildDerivedDatabase(CONNECTOR, "mysql", {
      url: MYSQL_URL as string,
    });
    derived = await introspect();
  });

  afterAll(async () => {
    // Chaque libération est indépendante : un `beforeAll` interrompu laisse des
    // références vides, et une cascade d'erreurs ici MASQUERAIT la vraie cause.
    if (orm) {
      await releaseDerivedDatabase(orm, CONNECTOR);
    }
    if (admin) {
      await admin.end();
    }
  });

  it("les deux chemins construisent les MÊMES tables", () => {
    assert.equal(
      derived.tables.length,
      FRAMEWORK_TABLES.length,
      "le schéma du framework compte neuf tables",
    );
    assert.deepEqual(migrated.tables, derived.tables);
  });

  it("colonnes, types, nullabilité, clé primaire et index : identiques", () => {
    assertSchemasMatch(migrated, derived, "mysql");
  });

  it("les types que MySQL sanctionne sont ceux attendus, des DEUX côtés", () => {
    for (const [label, schema] of [
      ["migré", migrated],
      ["dérivé", derived],
    ] as const) {
      for (const table of schema.tables) {
        for (const column of Object.values(schema.columns[table] ?? {})) {
          // 2038 : `timestamp` est borné, `datetime(3)` ne l'est pas. Une date
          // d'expiration au-delà de la borne se replierait silencieusement.
          assert.ok(
            !/^timestamp/i.test(column.type),
            `${label} : ${table}.${column.name} est « ${column.type} » — ` +
              `timestamp est borné à 2038, datetime(3) ne l'est pas`,
          );
          // InnoDB n'indexe pas une colonne TEXT sans longueur de préfixe : une
          // clé primaire sur du texte exige varchar.
          //
          // ⚠️ Le motif doit couvrir les PRÉFIXES de taille (`tinytext`,
          // `mediumtext`, `longtext`, `longblob`) : ancré au début, il laissait
          // passer `longtext` — or c'est précisément le type que MariaDB donne à
          // une colonne JSON, qu'il implémente en alias de `LONGTEXT`. La garde
          // aurait donc été aveugle sur le serveur par défaut du décor.
          if (column.primaryKey) {
            assert.ok(
              !/(text|blob|json)/i.test(column.type),
              `${label} : ${table}.${column.name} est clé primaire en ` +
                `« ${column.type} » — InnoDB ne sait pas l'indexer sans ` +
                `longueur de préfixe`,
            );
          }
        }
      }
    }
  });

  it("un horodatage est en bigint — un entier 32 bits déborderait", () => {
    // MariaDB écrit `bigint(20)`, MySQL 8 écrit `bigint` : la largeur
    // d'affichage a été retirée de MySQL en 8.0.19, MariaDB la conserve. Même
    // type, même capacité 64 bits — l'ancrage au début suffit et n'impose pas
    // une écriture.
    assert.match(
      migrated.columns["audit_event"]?.ts?.type ?? "",
      /^bigint/,
      "audit_event.ts porte un epoch en millisecondes",
    );
  });

  it("MariaDB ET MySQL : le serveur derrière l'URL est nommé dans le verdict", async () => {
    // Ce banc tourne sur DEUX serveurs différents selon l'URL fournie — MariaDB
    // (décor quotidien) et MySQL Community (preuve de compatibilité), qui ne
    // sont pas le même produit. Sans cette trace, un run vert ne dit pas LEQUEL
    // a été exercé, et « mysql testé » recouvrirait un seul des deux.
    const [row] = await rows("SELECT VERSION() AS v");
    const version = String(row?.v ?? "");
    assert.ok(version.length > 0, "le serveur doit annoncer sa version");
    process.stdout.write(`\n    ↳ parité mysql vérifiée sur : ${version}\n`);

    // Le type JSON diffère par CONSTRUCTION entre les deux — MariaDB
    // l'implémente en alias de LONGTEXT. Les deux écritures sont donc admises,
    // mais une TROISIÈME serait une surprise à examiner.
    const json = migrated.columns["session"]?.Attributes?.type ?? "";
    assert.ok(
      /^(json|longtext)$/i.test(json),
      `session.Attributes est « ${json} » : attendu « json » (MySQL) ou ` +
        `« longtext » (MariaDB, qui implémente JSON en alias de LONGTEXT)`,
    );
  });
});
