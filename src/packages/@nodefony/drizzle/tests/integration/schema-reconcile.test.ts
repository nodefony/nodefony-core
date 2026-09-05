import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DrizzleOrm } from "../../index";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import {
  IDEMPOTENCY_ENTITY_NAME,
  registerIdempotencyEntities,
} from "../../nodefony/entity/idempotencyEntity";
import { SqliteMigrationDriver } from "../../nodefony/src/migrator/index";

/**
 * Le schéma dérivé face à une base qui existe DÉJÀ.
 *
 * C'est la situation de tous les jours d'une équipe : le back ajoute un champ,
 * le front tire la branche, et sa base locale date d'avant. `CREATE TABLE IF
 * NOT EXISTS` ne fait évoluer aucune table existante — il ne peut donc rien
 * pour lui.
 *
 * Ce que ce banc verrouille, et qui n'avait rien d'acquis : **le démarrage
 * survit**. Avant le découpage tables → rattrapage → index, une colonne
 * manquante ne donnait pas une erreur à la requête : elle tuait la connexion,
 * parce que le `CREATE INDEX` qui la référence échouait. Le développeur
 * recevait `no such column: "expiresAt"` — sans le nom du connecteur, sans le
 * geste, et sans serveur pour aller voir.
 */
const ORM = "test-schema-reconcile";

/** Colonnes réellement portées par la table, lues dans le catalogue. */
async function colonnes(db: string, table: string): Promise<string[]> {
  const driver = new SqliteMigrationDriver(db);
  await driver.connect();
  try {
    return await driver.columnsOf(table);
  } finally {
    await driver.close();
  }
}

/** Index réellement posés sur la base. */
async function index(db: string): Promise<string[]> {
  const driver = new SqliteMigrationDriver(db);
  await driver.connect();
  try {
    const rows = await driver.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL`,
    );
    return rows.map((row) => row.name);
  } finally {
    await driver.close();
  }
}

describe("Schéma dérivé — réconciliation avec une base préexistante", () => {
  let root: string;
  let dbFile: string;
  let orm: DrizzleOrm | null = null;

  /**
   * Pose une table `idempotency_key` telle que l'énonce le SQL donné, puis
   * connecte un ORM dessus en mode dérivé.
   *
   * @param ddl - le `CREATE TABLE` de la base préexistante.
   * @returns l'ORM connecté.
   */
  const surBaseExistante = async (ddl: string): Promise<DrizzleOrm> => {
    const seed = new SqliteMigrationDriver(dbFile);
    await seed.connect();
    await seed.exec(ddl);
    await seed.close();
    return connecter();
  };

  /** Connecte un ORM en mode dérivé sur la base du banc. */
  const connecter = async (): Promise<DrizzleOrm> => {
    const instance = new DrizzleOrm(ORM, { filename: dbFile });
    registerIdempotencyEntities(ORM, "sqlite");
    await instance.connect();
    orm = instance;
    return instance;
  };

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "nf-reconcile-"));
    dbFile = path.join(root, "banc.db");
  });

  afterEach(async () => {
    await orm?.disconnect();
    orm = null;
    entityRegistry.unregister(IDEMPOTENCY_ENTITY_NAME, ORM);
    ormRegistry.unregister(ORM);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("une base neuve est conforme — aucun écart n'est retenu en mémoire", async () => {
    const instance = await connecter();
    assert.equal(
      instance.schemaDrift,
      null,
      "une base dérivée du code à l'instant ne peut pas diverger de lui",
    );
    assert.ok(
      (await index(dbFile)).length > 0,
      "les index déclarés doivent être posés — ils le sont dans une passe " +
        "distincte de la création des tables, et ce banc est ce qui l'atteste",
    );
  });

  it("une colonne manquante qui accepte le vide est AJOUTÉE, sans rien demander", async () => {
    await surBaseExistante(
      `CREATE TABLE "idempotency_key" (
         "key" text PRIMARY KEY NOT NULL,
         "fingerprint" text NOT NULL,
         "state" text NOT NULL,
         "expiresAt" integer NOT NULL
       )`,
    );
    assert.ok(
      (await colonnes(dbFile, "idempotency_key")).includes("response"),
      "la colonne nullable déclarée par le code doit avoir été posée",
    );
    assert.equal(
      orm?.schemaDrift,
      null,
      "une fois le rattrapage fait, il ne reste aucun écart à signaler",
    );
  });

  it("une colonne manquante et OBLIGATOIRE n'est pas inventée — mais le démarrage SURVIT", async () => {
    // La table d'avant n'a ni `fingerprint` ni `expiresAt`, et un index porte
    // sur la seconde : c'est exactement ce qui tuait la connexion.
    const instance = await surBaseExistante(
      `CREATE TABLE "idempotency_key" (
         "key" text PRIMARY KEY NOT NULL,
         "state" text NOT NULL
       )`,
    );
    assert.ok(instance.isConnected(), "le connecteur doit être établi");
    const drift = instance.schemaDrift;
    assert.ok(drift, "l'écart doit être publié, pas tu");
    assert.deepEqual(
      drift.blocking.map((gap) => gap.column).sort(),
      ["expiresAt", "fingerprint"],
      "les deux colonnes obligatoires manquantes sont nommées",
    );
    assert.deepEqual(
      drift.additive,
      [],
      "ce qui se rattrapait a été rattrapé avant d'être publié",
    );
    assert.ok(
      !(await colonnes(dbFile, "idempotency_key")).includes("fingerprint"),
      "une colonne obligatoire ne s'ajoute JAMAIS toute seule : il faudrait " +
        "inventer sa valeur pour les lignes déjà là",
    );
  });

  it("une colonne EN PLUS dans la base est ignorée — sinon le voyant serait allumé à vie", async () => {
    // Toute application qui écrit des migrations libres (vue, déclencheur,
    // colonne ajoutée à une table d'entité) a une base légitimement différente
    // du schéma déclaré. Signaler le surplus rendrait le verdict inutilisable.
    const instance = await surBaseExistante(
      `CREATE TABLE "idempotency_key" (
         "key" text PRIMARY KEY NOT NULL,
         "fingerprint" text NOT NULL,
         "state" text NOT NULL,
         "response" text,
         "expiresAt" integer NOT NULL,
         "ajoutee_par_une_migration_libre" text
       )`,
    );
    assert.equal(
      instance.schemaDrift,
      null,
      "le diff signale ce qui MANQUE, jamais ce qu'il trouve en trop",
    );
  });

  it("une table absente est signalée, jamais dérivée en douce sur un schéma en retard", async () => {
    const instance = await surBaseExistante(
      `CREATE TABLE "autre_chose" ("x" text)`,
    );
    // Le DDL dérivé a créé la table manquante : c'est le mode `auto`, et c'est
    // son travail. L'écart porte donc sur ce qu'il ne SAIT pas faire.
    assert.equal(
      instance.schemaDrift,
      null,
      "en mode dérivé, une table absente est créée — pas signalée",
    );
    assert.ok(
      (await colonnes(dbFile, "idempotency_key")).includes("expiresAt"),
      "la table déclarée par le code doit exister après connexion",
    );
  });

  it("la comparaison est disponible SANS rien modifier — c'est la troisième source", async () => {
    const instance = await connecter();
    const comparaison = await instance.compareToDeclared();
    assert.deepEqual(
      comparaison,
      { additive: [], blocking: [], missingTables: [] },
      "une base conforme ne rend aucun écart",
    );
  });
});
