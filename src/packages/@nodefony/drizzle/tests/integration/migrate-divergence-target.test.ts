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
  describeDivergence,
  type IMigrationSource,
} from "../../nodefony/src/migrator/index";
import { composeReport } from "../../nodefony/src/migrator/status";
import type { IDivergenceTarget } from "../../nodefony/src/migrator/divergence";
import type { IConnectorResolution } from "../../nodefony/src/migrator/resolve";
import type { IDrizzleConfig } from "../../nodefony/interfaces/IDrizzleConfig";
import { writeSource } from "./migrator-fixtures";

/**
 * La divergence se mesure sur la base que VISE l'applicateur — pas sur celle de
 * l'ORM — quand `NF_MIGRATE_DATABASE_URL` la détourne.
 *
 * Le défaut corrigé : sous la variable, l'historique se lisait sur la base
 * d'essai (l'applicateur) et le schéma sur la base de la configuration (l'ORM
 * enregistré, qui ne lit jamais la variable). Deux bases, un verdict. Il
 * mentait dans les DEUX sens, et le banc les éprouve tous les deux :
 *
 * - **faux `divergent`** : base d'essai conforme, base de configuration en
 *   retard → « colonne manquante » sur une base qui la porte (constaté en
 *   éprouvant une migration sur une copie, comme le recommande le guide) ;
 * - **vraie divergence CACHÉE** : base de configuration conforme, base visée
 *   fausse → « à jour ». C'est le pire des deux — en production, la variable
 *   désigne la base servie, et un `ALTER` passé à la main y devenait invisible
 *   dès que l'ORM de la commande voyait une autre base.
 *
 * Deux vraies bases sqlite par cas, rien de simulé : la table d'époque (sans
 * `response`) face à la table que le code déclare.
 */
const ORM = "banc-divergence-cible";

/** La table telle qu'une ancienne migration l'a créée — sans `response`. */
const OLD_TABLE =
  `CREATE TABLE "idempotency_key" (\n` +
  `  "key" text PRIMARY KEY NOT NULL,\n` +
  `  "fingerprint" text NOT NULL,\n` +
  `  "state" text NOT NULL,\n` +
  `  "expiresAt" integer NOT NULL\n` +
  `)`;

/** La table que le code déclare aujourd'hui. */
const CURRENT_TABLE =
  `CREATE TABLE "idempotency_key" (\n` +
  `  "key" text PRIMARY KEY NOT NULL,\n` +
  `  "fingerprint" text NOT NULL,\n` +
  `  "state" text NOT NULL,\n` +
  `  "expiresAt" integer NOT NULL,\n` +
  `  "response" text\n` +
  `)`;

describe("Divergence — la base VISÉE fait foi sous NF_MIGRATE_DATABASE_URL", () => {
  let root: string;
  let orm: DrizzleOrm | null = null;

  /**
   * Une base sqlite migrée avec la table donnée — historique complet.
   *
   * @returns l'applicateur qui la vise (c'est lui qu'on passe en cible).
   */
  const migrated = async (
    name: string,
    ddl: string,
  ): Promise<DrizzleMigrator> => {
    const dir = await writeSource(
      "sqlite",
      [{ tag: "0000_init", statements: [ddl] }],
      path.join(root, `src-${name}`),
    );
    const sources: IMigrationSource[] = [{ name: "framework", dir, rank: 0 }];
    const migrator = new DrizzleMigrator({
      connector: ORM,
      dialect: "sqlite",
      filename: path.join(root, `${name}.db`),
      sources,
    });
    await migrator.migrate();
    return migrator;
  };

  /** L'ORM enregistré, sur la base de la CONFIGURATION. */
  const configOrm = async (
    file: string,
    connect = true,
  ): Promise<DrizzleOrm> => {
    const instance = new DrizzleOrm(ORM, {
      filename: path.join(root, `${file}.db`),
      deriveSchema: false,
    });
    registerIdempotencyEntities(ORM, "sqlite");
    if (connect) await instance.connect();
    orm = instance;
    return instance;
  };

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "nf-divergence-cible-"));
  });

  afterEach(async () => {
    if (orm?.isConnected()) await orm.disconnect();
    orm = null;
    entityRegistry.unregister(IDEMPOTENCY_ENTITY_NAME, ORM);
    ormRegistry.unregister(ORM);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("🔴 base visée CONFORME, base de configuration en retard → aucune divergence", async () => {
    await migrated("config", OLD_TABLE);
    await configOrm("config");
    const essai = await migrated("essai", CURRENT_TABLE);
    const plan = await essai.status();
    assert.equal(plan.pending.length, 0, "l'historique de l'essai est complet");

    assert.equal(
      await describeDivergence(plan, essai),
      null,
      "la base visée porte la colonne : rien ne diverge",
    );
    // Le décor mord : sans cible, la comparaison passe par l'ORM et lit la
    // base de configuration — c'est exactement le faux verdict d'avant.
    const viaOrm = await describeDivergence(plan);
    assert.ok(viaOrm, "sans cible, la base de configuration est lue");
    assert.deepEqual(
      viaOrm.additive.map((g) => g.column),
      ["response"],
    );
  });

  it("🔴 base visée FAUSSE, base de configuration conforme → la divergence est VUE", async () => {
    await migrated("config", CURRENT_TABLE);
    await configOrm("config");
    const essai = await migrated("essai", OLD_TABLE);
    const plan = await essai.status();

    const ecart = await describeDivergence(plan, essai);
    assert.ok(ecart, "un écart de la base visée ne doit pas être caché");
    assert.deepEqual(
      ecart.additive.map((g) => [g.table, g.column]),
      [["idempotency_key", "response"]],
    );
    assert.equal(
      await describeDivergence(plan),
      null,
      "sans cible, l'écart est caché — le défaut que la cible ferme",
    );
  });

  it("🔴 ORM non connecté → `null` (rien d'interrogé), jamais une conformité sur zéro table", async () => {
    // Les tables déclarées se lient à la connexion : non connecté, l'ORM n'en
    // déclare aucune. Comparer la cible à ce vide rendrait « conforme » une
    // base qui ne l'est pas — `null` dit « je n'ai rien regardé ».
    await configOrm("config", false);
    const essai = await migrated("essai", OLD_TABLE);
    let consulted = false;
    const spy: IDivergenceTarget = {
      compareToDeclared: async (expected) => {
        consulted = true;
        assert.fail(`comparée à ${expected.length} table(s) déclarée(s)`);
      },
    };
    assert.equal(await describeDivergence(await essai.status(), spy), null);
    assert.equal(consulted, false, "la cible n'est pas interrogée à vide");
  });

  it("une cible qui ne répond pas n'est pas une divergence — `null`, jamais une levée", async () => {
    await configOrm("config");
    const essai = await migrated("essai", CURRENT_TABLE);
    const plan = await essai.status();
    const muette = {
      compareToDeclared: () => Promise.reject(new Error("base injoignable")),
    };
    assert.equal(await describeDivergence(plan, muette), null);
  });

  describe("composeReport — la décision vit dans le SEUL assembleur du rapport", () => {
    const config = {
      migrations: { divergence: "report" },
    } as unknown as IDrizzleConfig;

    const resolution = (
      fromMigrateUrl: boolean,
    ): Extract<IConnectorResolution, { kind: "ready" }> => ({
      kind: "ready",
      connector: ORM,
      dialect: "sqlite",
      target: { dialect: "sqlite", filename: path.join(root, "essai.db") },
      fromMigrateUrl,
      ddl: "migrate",
    });

    it("🔴 cible détournée : le verdict suit la base VISÉE (faux `divergent` disparu)", async () => {
      await migrated("config", OLD_TABLE);
      await configOrm("config");
      const essai = await migrated("essai", CURRENT_TABLE);
      const report = await composeReport(
        await essai.status(),
        resolution(true),
        config,
        null,
        essai,
      );
      assert.equal(report.verdict, "up-to-date", report.summary);
      assert.equal(report.exitCode, 0);
    });

    it("🔴 cible détournée : une base visée fausse rend `divergent`", async () => {
      await migrated("config", CURRENT_TABLE);
      await configOrm("config");
      const essai = await migrated("essai", OLD_TABLE);
      const report = await composeReport(
        await essai.status(),
        resolution(true),
        config,
        null,
        essai,
      );
      assert.equal(report.verdict, "divergent", report.summary);
      assert.match(report.summary, /idempotency_key\.response/u);
    });

    it("sans détournement, l'ORM reste le lecteur — l'applicateur n'est PAS consulté", async () => {
      // Sans variable, l'ORM et l'applicateur visent la même base, et seule la
      // connexion déjà ouverte voit une base `:memory:`. Un applicateur qui
      // lèverait s'il était appelé le prouve.
      await migrated("config", CURRENT_TABLE);
      await configOrm("config");
      const plan = await (await migrated("essai", CURRENT_TABLE)).status();
      let consulted = false;
      const spy = {
        compareToDeclared: () => {
          consulted = true;
          return Promise.reject(new Error("ne doit pas être appelé"));
        },
      };
      const report = await composeReport(
        plan,
        resolution(false),
        config,
        null,
        spy,
      );
      assert.equal(consulted, false);
      assert.equal(report.verdict, "up-to-date", report.summary);
    });
  });
});
