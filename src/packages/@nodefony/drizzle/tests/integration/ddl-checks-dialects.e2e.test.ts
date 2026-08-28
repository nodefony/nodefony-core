import assert from "node:assert/strict";
import { defineEntity, entityRegistry, ormRegistry } from "@nodefony/orm-core";
import { sql } from "drizzle-orm";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
import {
  createFrameworkTableFactory,
  type IFrameworkTableSpec,
} from "../../nodefony/entity/colKit";

/**
 * Une colonne énumérée est-elle bornée **sur un vrai serveur**, et pas
 * seulement sur SQLite ?
 *
 * Le contrôle SQLite (`ddl-checks.test.ts`) prouve la mécanique ; il ne prouve
 * pas que PostgreSQL et MySQL/MariaDB **acceptent** la clause telle que le
 * colKit la compose, ni qu'ils la font respecter. Les trois grammaires diffèrent
 * (citation des identifiants, support des contraintes de table), et MySQL a
 * longtemps ANALYSÉ les `CHECK` sans jamais les appliquer — jusqu'à 8.0.16.
 * Un DDL gravé dans la migration `0000` doit tenir sur les trois, ou sur aucun.
 *
 * La sonde a sa propre table : les entités du framework vivent dans une base de
 * développement partagée, créée par des exécutions antérieures — et
 * `CREATE TABLE IF NOT EXISTS` n'ajoute rien à une table qui existe déjà. Elle
 * est donc supprimée avant chaque passe, sinon le contrôle porterait sur un
 * schéma d'hier.
 *
 * GATES : `NF_PG_URL` / `NF_MYSQL_URL` (sinon skip) :
 *   docker compose -f docker/docker-compose.yml --profile postgres up -d postgres
 *   docker compose -f docker/docker-compose.yml --profile mariadb up -d mariadb
 */

const PG_URL = process.env.NF_PG_URL;
const MYSQL_URL = process.env.NF_MYSQL_URL;

const PROBE_TABLE = "ddl_check_probe";
const PROBE_ENTITY = "DdlCheckProbe";

const PROBE_SPEC = {
  name: PROBE_TABLE,
  columns: {
    id: { kind: "text", primaryKey: true },
    phase: { kind: "enum", values: ["draft", "live"], notNull: true },
  },
} satisfies IFrameworkTableSpec;

const createProbeTable = createFrameworkTableFactory(PROBE_SPEC);

/** Surface native commune à `pg` et `mysql2` pour du SQL brut. */
interface Executor {
  execute(query: unknown): Promise<unknown>;
}

/**
 * Le refus vient-il bien de NOTRE contrainte ?
 *
 * Les trois serveurs ne disent pas la même chose — PostgreSQL « violates check
 * constraint », MySQL « Check constraint … is violated », MariaDB « CONSTRAINT
 * … failed ». Chercher une formule commune reviendrait à accepter n'importe
 * quel refus ; on exige donc le NOM déclaré, seul élément que les trois
 * énoncent, et le seul qui distingue cette contrainte d'une autre.
 */
const violatesProbeCheck = (error: unknown): true => {
  const text = [error, (error as { cause?: unknown })?.cause]
    .map((err) => String((err as Error)?.message ?? err ?? ""))
    .join(" ");
  assert.match(text, new RegExp(`${PROBE_TABLE}_phase_check`));
  return true;
};

/**
 * Ouvre un connecteur sur une table de sonde NEUVE.
 *
 * L'ordre compte : un premier connecteur, sans entité, sert uniquement à
 * supprimer la table héritée d'une passe précédente — l'adapter crée le schéma
 * au `connect()`, il est donc trop tard pour nettoyer après coup.
 */
async function connectFresh(
  ormName: string,
  dialect: "postgres" | "mysql",
  url: string,
): Promise<DrizzleOrm> {
  const cleaner = new DrizzleOrm(`${ormName}_cleaner`, { dialect, url });
  await cleaner.connect();
  await (cleaner.getNativeConnection() as Executor).execute(
    sql.raw(
      `DROP TABLE IF EXISTS ${dialect === "mysql" ? "`" : '"'}${PROBE_TABLE}${dialect === "mysql" ? "`" : '"'}`,
    ),
  );
  await cleaner.disconnect();
  ormRegistry.unregister(`${ormName}_cleaner`);

  entityRegistry.register({
    ...defineEntity({
      name: PROBE_ENTITY,
      module: "test",
      schema: createProbeTable(dialect),
    }),
    connector: ormName,
  });
  const orm = new DrizzleOrm(ormName, { dialect, url });
  await orm.connect();
  return orm;
}

/**
 * Ferme le connecteur de sonde, retire sa table et rend le registre à son état
 * initial — la base de développement est partagée, une sonde n'y laisse rien.
 */
async function closeProbe(
  orm: DrizzleOrm,
  ormName: string,
  quote: string,
): Promise<void> {
  await (orm.getNativeConnection() as Executor).execute(
    sql.raw(`DROP TABLE IF EXISTS ${quote}${PROBE_TABLE}${quote}`),
  );
  await orm.disconnect();
  entityRegistry.unregister(PROBE_ENTITY, ormName);
  ormRegistry.unregister(ormName);
}

describe.skipIf(!PG_URL)("CHECK énuméré — e2e PostgreSQL", () => {
  const ORM = "ddl_checks_pg_e2e";
  let orm: DrizzleOrm;

  beforeAll(async () => {
    orm = await connectFresh(ORM, "postgres", PG_URL as string);
  });

  afterAll(async () => {
    await closeProbe(orm, ORM, '"');
  });

  it("le serveur connaît la contrainte, sous le nom déclaré", async () => {
    const result = (await (orm.getNativeConnection() as Executor).execute(
      sql`SELECT conname FROM pg_constraint
          WHERE conrelid = ${PROBE_TABLE}::regclass AND contype = 'c'`,
    )) as { rows: { conname: string }[] };
    assert.deepEqual(
      result.rows.map((row) => row.conname),
      [`${PROBE_TABLE}_phase_check`],
    );
  });

  it("une valeur hors énumération est refusée par PostgreSQL", async () => {
    await assert.rejects(
      async () =>
        (orm.getNativeConnection() as Executor).execute(
          sql.raw(
            `INSERT INTO "${PROBE_TABLE}" ("id", "phase") VALUES ('x', 'zombie')`,
          ),
        ),
      violatesProbeCheck,
    );
  });

  it("les valeurs déclarées passent", async () => {
    await (orm.getNativeConnection() as Executor).execute(
      sql.raw(
        `INSERT INTO "${PROBE_TABLE}" ("id", "phase") VALUES ('ok', 'live')`,
      ),
    );
  });
});

describe.skipIf(!MYSQL_URL)("CHECK énuméré — e2e MySQL / MariaDB", () => {
  const ORM = "ddl_checks_mysql_e2e";
  let orm: DrizzleOrm;

  beforeAll(async () => {
    orm = await connectFresh(ORM, "mysql", MYSQL_URL as string);
  });

  afterAll(async () => {
    await closeProbe(orm, ORM, "`");
  });

  it("le serveur connaît la contrainte (elle n'est pas seulement ANALYSÉE)", async () => {
    const [rows] = (await (orm.getNativeConnection() as Executor).execute(
      sql`SELECT CONSTRAINT_NAME AS name FROM information_schema.TABLE_CONSTRAINTS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${PROBE_TABLE}
            AND CONSTRAINT_TYPE = 'CHECK'`,
    )) as [{ name: string }[], unknown];
    assert.deepEqual(
      rows.map((row) => row.name),
      [`${PROBE_TABLE}_phase_check`],
    );
  });

  it("une valeur hors énumération est refusée par le serveur", async () => {
    await assert.rejects(
      async () =>
        (orm.getNativeConnection() as Executor).execute(
          sql.raw(
            "INSERT INTO `" +
              PROBE_TABLE +
              "` (`id`, `phase`) VALUES ('x', 'zombie')",
          ),
        ),
      violatesProbeCheck,
    );
  });

  it("les valeurs déclarées passent", async () => {
    await (orm.getNativeConnection() as Executor).execute(
      sql.raw(
        "INSERT INTO `" +
          PROBE_TABLE +
          "` (`id`, `phase`) VALUES ('ok', 'live')",
      ),
    );
  });
});
