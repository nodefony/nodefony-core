import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { entity } from "@nodefony/orm-core";
import type { Kernel } from "nodefony";
import { drizzleConfigSchema } from "../../nodefony/config/config";
import type { IDrizzleConfig } from "../../nodefony/interfaces/IDrizzleConfig";
import { defaultMigrationSources } from "../../nodefony/src/migrator/paths";
import { DrizzleMigrator } from "../../nodefony/src/migrator/index";
import { DrizzleOrm } from "../../index";
import { writeSource } from "./migrator-fixtures";

/**
 * Les DEUX chemins qui fabriquent un schéma doivent fabriquer le MÊME.
 *
 * Une application peut refuser les entités du framework (`frameworkEntities:
 * false`) quand elle ne veut que ses propres tables. Deux mécanismes
 * indépendants honorent — ou non — ce refus : le **démarrage en mode dérivé**,
 * qui n'enregistre alors aucune entité du framework, et les **migrations**, dont
 * le registre de sources écarte alors celle du framework.
 *
 * Rien ne garantissait qu'ils disent la même chose. Ils ne la disaient pas : les
 * sources de migration ignoraient la configuration, si bien que la même
 * application fabriquait deux bases DIFFÉRENTES selon qu'on la démarrait en
 * développement ou qu'on la migrait en production — session, jetons, audit et
 * webhooks d'un côté, absents de l'autre. Et rien ne le signalait : le verdict
 * de divergence ignore par construction ce que la base a en TROP.
 *
 * Ce banc ne contrôle donc pas un mécanisme, il contrôle leur ACCORD — c'est ce
 * qui attrape une divergence future, quel que soit celui des deux qui dérive.
 *
 * ⚠️ Sans entité d'application, les deux chemins rendraient deux ensembles VIDES
 * et le contrôle serait vert quoi qu'il arrive. C'est l'entité ci-dessous qui
 * lui donne de quoi mesurer.
 */

const CONNECTEUR = "deux-chemins";

const noteTable = sqliteTable("AppNote", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  titre: text("titre").notNull(),
});

@entity({ connector: CONNECTEUR, name: "AppNote", schema: noteTable })
class NoteEntity {}
void NoteEntity;

/** Le DDL que la migration de l'application porte — celui de l'entité ci-dessus. */
const CREATE_APP_NOTE =
  "CREATE TABLE `AppNote` (`id` text PRIMARY KEY NOT NULL, `titre` text NOT NULL);";

/** Tables que le moteur ou l'applicateur se donnent — hors comparaison. */
const INTERNES = new Set(["sqlite_sequence", "nodefony_migrations"]);

/**
 * Les tables que porte RÉELLEMENT une base — c'est elle qui tranche, jamais un
 * fichier de l'agent ni une liste d'entités.
 *
 * @param fichier - chemin de la base sqlite.
 * @returns les noms de tables, triés, tables internes écartées.
 */
function tablesDe(fichier: string): string[] {
  const db = new DatabaseSync(fichier);
  try {
    return (
      db
        .prepare("select name from sqlite_master where type = 'table'")
        .all() as { name: string }[]
    )
      .map((r) => r.name)
      .filter((n) => !INTERNES.has(n) && !n.startsWith("sqlite_"))
      .sort();
  } finally {
    db.close();
  }
}

function fauxKernel(root: string): Kernel {
  return { path: root } as unknown as Kernel;
}

function config(frameworkEntities: boolean): IDrizzleConfig {
  return drizzleConfigSchema.parse({
    frameworkEntities,
    connectors: { [CONNECTEUR]: { dialect: "sqlite" } },
  }) as IDrizzleConfig;
}

describe("migrations — les deux chemins fabriquent le même schéma (#109)", () => {
  let racine: string;
  let sourceApp: string;
  /**
   * Le schéma du démarrage, calculé UNE fois.
   *
   * Le registre des ORM est à l'échelle du processus et refuse un second
   * connecteur du même nom : instancier l'adaptateur dans chaque cas ferait
   * échouer le deuxième sur une collision qui n'apprend rien. Aucun des deux
   * cas ne le modifie — ils le LISENT.
   */
  let demarrage: string[];

  beforeAll(async () => {
    racine = await fs.mkdtemp(path.join(os.tmpdir(), "nf-deux-chemins-"));
    // La migration de l'APPLICATION : le pendant, côté fichiers, de l'entité
    // enregistrée plus haut. Les deux chemins partent donc du même modèle.
    sourceApp = await writeSource("sqlite", [
      { tag: "0000_app_note", statements: [CREATE_APP_NOTE] },
    ]);
    demarrage = await parLeDemarrage();
  });

  afterAll(async () => {
    await fs.rm(racine, { recursive: true, force: true });
    await fs.rm(sourceApp, { recursive: true, force: true });
  });

  /**
   * Le schéma qu'obtient un DÉMARRAGE en mode dérivé.
   *
   * Le geste est celui du module (`index.ts`) : les entités du framework ne sont
   * enregistrées que si la configuration ne les refuse pas. Ici elles le sont —
   * donc seules les entités de l'application arrivent, et `connect()` crée leurs
   * tables.
   *
   * @returns les tables de la base obtenue.
   */
  async function parLeDemarrage(): Promise<string[]> {
    const fichier = path.join(racine, "demarrage.sqlite");
    const orm = new DrizzleOrm(CONNECTEUR, { filename: fichier });
    await orm.connect();
    await orm.disconnect();
    return tablesDe(fichier);
  }

  /**
   * Le schéma qu'obtient la MIGRATION, pour une valeur donnée du refus.
   *
   * @param framework - la source du framework entre-t-elle dans le registre ?
   * @returns les tables de la base obtenue.
   */
  async function parLaMigration(framework: boolean): Promise<string[]> {
    const fichier = path.join(racine, `migration-${framework}.sqlite`);
    const sources = await defaultMigrationSources(sourceApp, { framework });
    const migrator = new DrizzleMigrator({
      connector: CONNECTEUR,
      dialect: "sqlite",
      filename: fichier,
      sources,
    });
    await migrator.migrate();
    return tablesDe(fichier);
  }

  it("🔴 `frameworkEntities: false` — démarrage et migration rendent le MÊME ensemble", async () => {
    assert.equal(config(false).frameworkEntities, false);
    const migration = await parLaMigration(false);

    // La garde d'abord : sans elle, deux ensembles vides passeraient.
    assert.ok(
      demarrage.includes("AppNote"),
      "le démarrage doit avoir créé la table de l'application — sinon ce banc " +
        "compare deux ensembles vides et serait vert quoi qu'il arrive",
    );
    assert.deepEqual(
      migration,
      demarrage,
      "les deux chemins doivent fabriquer le même schéma pour une même configuration",
    );
  });

  /**
   * ⚠️ Le contrôle NÉGATIF, et il est la moitié du banc.
   *
   * Rétablir la source du framework dans le cas refusé, c'est exactement le
   * défaut d'origine. Si les deux ensembles restaient égaux ici, l'assertion
   * ci-dessus ne mesurerait rien — elle serait vraie pour une raison qui n'a
   * rien à voir avec ce qu'elle prétend garder.
   */
  it("la comparaison MORD : rétablir la source framework fait diverger les deux chemins", async () => {
    const avecFramework = await parLaMigration(true);

    assert.notDeepEqual(
      avecFramework,
      demarrage,
      "avec la source framework rétablie, la migration doit fabriquer PLUS de " +
        "tables que le démarrage dérivé — sinon le banc ci-dessus ne discrimine rien",
    );
    const enTrop = avecFramework.filter((t) => !demarrage.includes(t));
    assert.ok(
      enTrop.length > 0,
      `la migration devrait porter des tables du framework en trop (${enTrop.join(", ")})`,
    );
  });
});
