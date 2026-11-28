import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import { defineTable } from "../../nodefony/entity/colKit";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";

/**
 * En PostgreSQL, un `SELECT` préparé du dépôt est une requête NOMMÉE : le
 * serveur l'analyse et la planifie une fois par connexion, et la liste dans
 * `pg_prepared_statements`. Sans nom, il la réanalyserait à chaque exécution —
 * même résultat, donc aucun test fonctionnel ne le verrait.
 *
 * GATE : ne tourne que si `NF_PG_URL` est posée.
 */
const PG_URL = process.env.NF_PG_URL;
const CONNECTOR = "prepared_pg";
const NAME = "nf_prepared_probe";
const probe = defineTable({
  name: NAME,
  columns: {
    id: { kind: "text", primaryKey: true },
    label: { kind: "text" },
  },
}).table;

describe.skipIf(!PG_URL)("SELECT préparé du dépôt — postgres", () => {
  let orm: DrizzleOrm;

  beforeAll(async () => {
    entityRegistry.register({
      connector: CONNECTOR,
      name: NAME,
      schema: probe("postgres"),
    });
    orm = new DrizzleOrm(CONNECTOR, { dialect: "postgres", url: PG_URL });
    await orm.connect();
  });

  afterAll(async () => {
    await orm.disconnect();
    entityRegistry.unregister(NAME, CONNECTOR);
    ormRegistry.unregister(CONNECTOR);
  });

  it("est préparé SOUS UN NOM par le serveur", async () => {
    const repo = orm.getRepository<{ id: string; label: string | null }>(NAME);
    const id = randomUUID();
    await repo.create({ id, label: "x" });
    assert.equal((await repo.findOne({ id }))?.label, "x");
    // Appels SÉQUENTIELS : le pool de `pg` rend la connexion libre la plus
    // récente, celle qui vient d'exécuter la requête préparée.
    const result = await orm
      .getNativeConnection<{
        execute(query: SQL): Promise<{ rows: unknown[] }>;
      }>()
      .execute(
        sql`SELECT name FROM pg_prepared_statements WHERE name LIKE 'nf_ps_%'`,
      );
    assert.ok(result.rows.length > 0, JSON.stringify(result.rows));
  });

  it("survit à une migration qui CHANGE LE TYPE d'une colonne lue — sans redémarrage", async () => {
    const repo = orm.getRepository<{ id: string; label: string | null }>(NAME);
    const db = orm.getNativeConnection<{
      execute(query: SQL): Promise<{ rows: unknown[] }>;
    }>();
    const id = randomUUID();
    await repo.create({ id, label: "avant" });
    // La connexion du pool apprend la requête sous son nom.
    assert.equal((await repo.findOne({ id }))?.label, "avant");
    // Ce que fait une migration lancée à côté du serveur : la colonne lue
    // change de type. Le plan appris rendrait un autre type de ligne, et
    // PostgreSQL le refuse (« cached plan must not change result type »).
    await db.execute(
      sql.raw(`ALTER TABLE ${NAME} ALTER COLUMN label TYPE varchar(64)`),
    );
    try {
      assert.equal((await repo.findOne({ id }))?.label, "avant");
    } finally {
      await db.execute(
        sql.raw(`ALTER TABLE ${NAME} ALTER COLUMN label TYPE text`),
      );
    }
  });
});
