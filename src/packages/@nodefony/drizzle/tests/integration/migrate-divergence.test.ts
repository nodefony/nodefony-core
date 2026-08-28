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
import {
  DrizzleMigrator,
  isDivergent,
  type IMigrationSource,
} from "../../nodefony/src/migrator/index";
import { buildReport } from "../../nodefony/src/migrator/explain";
import { writeSource } from "./migrator-fixtures";

/**
 * Le verdict `divergent` — la TROISIÈME source.
 *
 * Un outil de migration croise deux choses : les fichiers et l'historique. Les
 * deux peuvent être parfaits — tout appliqué, rien en attente, aucune empreinte
 * modifiée — pendant que la base, elle, ne correspond plus au code. C'est le
 * cas de figure de cet incident-là : un `ALTER` passé à la main un soir
 * d'astreinte, un correctif d'urgence jamais reporté, deux environnements qui
 * ont divergé.
 *
 * Le banc le PROVOQUE au lieu de le simuler : la migration crée la table telle
 * qu'elle était, le code en déclare une de plus, et l'historique reste complet.
 */
const ORM = "banc-divergence";

/** La table telle que la migration l'a créée — sans la colonne `response`. */
const TABLE_D_EPOQUE =
  `CREATE TABLE "idempotency_key" (\n` +
  `  "key" text PRIMARY KEY NOT NULL,\n` +
  `  "fingerprint" text NOT NULL,\n` +
  `  "state" text NOT NULL,\n` +
  `  "expiresAt" integer NOT NULL\n` +
  `)`;

describe("Verdict divergent — l'historique est complet, la base est fausse", () => {
  let root: string;
  let dbFile: string;
  let sources: IMigrationSource[];
  let orm: DrizzleOrm | null = null;

  /**
   * Applique une source de migrations dont le SQL est donné, puis connecte un
   * ORM en lecture de schéma (jamais dérivé — c'est le mode d'exploitation).
   *
   * @param ddl - le `CREATE TABLE` que porte la migration.
   */
  const poser = async (ddl: string): Promise<void> => {
    const dir = await writeSource("sqlite", [
      { tag: "0000_init", statements: [ddl] },
    ]);
    sources = [{ name: "framework", dir, rank: 0 }];
    await new DrizzleMigrator({
      connector: ORM,
      dialect: "sqlite",
      filename: dbFile,
      sources,
    }).migrate();
    const instance = new DrizzleOrm(ORM, {
      filename: dbFile,
      deriveSchema: false,
    });
    registerIdempotencyEntities(ORM, "sqlite");
    await instance.connect();
    orm = instance;
  };

  /** Le plan de l'applicateur sur la base du banc. */
  const plan = (): Promise<Awaited<ReturnType<DrizzleMigrator["status"]>>> =>
    new DrizzleMigrator({
      connector: ORM,
      dialect: "sqlite",
      filename: dbFile,
      sources,
    }).status();

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "nf-divergence-"));
    dbFile = path.join(root, "banc.db");
  });

  afterEach(async () => {
    await orm?.disconnect();
    orm = null;
    entityRegistry.unregister(IDEMPOTENCY_ENTITY_NAME, ORM);
    ormRegistry.unregister(ORM);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("l'historique dit « à jour » — et la base a pourtant une colonne de moins", async () => {
    await poser(TABLE_D_EPOQUE);
    const etat = await plan();
    // Les deux premières sources sont formelles, et elles ont raison.
    assert.equal(etat.pending.length, 0, "rien n'est en attente");
    assert.equal(etat.drifted.length, 0, "aucune empreinte n'a bougé");
    assert.equal(etat.failed.length, 0, "aucun échec");

    assert.equal(
      await isDivergent(etat),
      true,
      "la troisième source doit voir ce que les deux autres ne peuvent pas voir",
    );
    const report = buildReport(etat, {
      ddl: "none",
      divergent: await isDivergent(etat),
    });
    assert.equal(report.verdict, "divergent");
  });

  it("superviser ne fait pas tomber un déploiement — le code de sortie reste 0", async () => {
    await poser(TABLE_D_EPOQUE);
    const etat = await plan();
    const observation = buildReport(etat, {
      ddl: "none",
      divergent: true,
      divergenceBlocks: false,
    });
    assert.equal(
      observation.exitCode,
      0,
      "en observation (défaut), la divergence s'affiche et ne bloque rien : " +
        "une application qui écrit des migrations libres en a une en permanence",
    );
    const barriere = buildReport(etat, {
      ddl: "none",
      divergent: true,
      divergenceBlocks: true,
    });
    assert.equal(
      barriere.exitCode,
      1,
      'migrations.divergence: "fail" est le seul moyen d\'en faire une barrière',
    );
  });

  it("une base CONFORME ne déclenche rien — sinon le verdict serait du bruit", async () => {
    await poser(
      `CREATE TABLE "idempotency_key" (\n` +
        `  "key" text PRIMARY KEY NOT NULL,\n` +
        `  "fingerprint" text NOT NULL,\n` +
        `  "state" text NOT NULL,\n` +
        `  "response" text,\n` +
        `  "expiresAt" integer NOT NULL\n` +
        `)`,
    );
    const etat = await plan();
    assert.equal(await isDivergent(etat), false);
    assert.equal(buildReport(etat, { ddl: "none" }).verdict, "up-to-date");
  });

  it("une colonne EN PLUS en base ne diverge pas — les migrations libres sont légitimes", async () => {
    await poser(
      `CREATE TABLE "idempotency_key" (\n` +
        `  "key" text PRIMARY KEY NOT NULL,\n` +
        `  "fingerprint" text NOT NULL,\n` +
        `  "state" text NOT NULL,\n` +
        `  "response" text,\n` +
        `  "expiresAt" integer NOT NULL,\n` +
        `  "colonne_d_une_migration_libre" text\n` +
        `)`,
    );
    assert.equal(await isDivergent(await plan()), false);
  });

  it("la divergence ne se calcule PAS quand une migration est en attente", async () => {
    await poser(TABLE_D_EPOQUE);
    // Une seconde migration jamais appliquée : le verdict est déjà décidé, et
    // interroger la base n'apprendrait rien tout en coûtant une requête par
    // table. Le calcul doit s'abstenir.
    const dir = await writeSource(
      "sqlite",
      [
        { tag: "0000_init", statements: [TABLE_D_EPOQUE] },
        {
          tag: "0001_suite",
          statements: [`CREATE TABLE "plus_tard" ("x" text)`],
        },
      ],
      path.join(root, "sources-2"),
    );
    sources = [{ name: "framework", dir, rank: 0 }];
    const etat = await plan();
    assert.equal(etat.pending.length, 1, "une migration attend");
    assert.equal(
      await isDivergent(etat),
      false,
      "tant qu'un geste est déjà dû, la troisième source ne se paie pas",
    );
  });
});
