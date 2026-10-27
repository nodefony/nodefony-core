import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { SqlDialect } from "../../nodefony/interfaces/IDrizzleConfig";
import type { DrizzleOrm } from "../../nodefony/src/orm-core/DrizzleOrm";
import {
  importSpecifier,
  writeKitConfig,
} from "../../nodefony/src/migrator/appSchema";
import { runGenerate, sealGeneratedSql } from "../../nodefony/src/migrator/kit";

/**
 * Outils partagés des bancs qui créent des tables du kit de colonnes par la
 * migration `drizzle-kit` (plutôt que par le DDL dérivé) : génération de la
 * migration initiale d'une fixture, et exécution SQL brute par dialecte.
 */

/** SQL brut sur la connexion native (`run` better-sqlite3, `execute` pg/mysql2). */
interface ISqliteExecutor {
  run(query: SQL): unknown;
}
interface IServerExecutor {
  execute(query: SQL): Promise<unknown>;
}

/** Exécute une instruction SQL brute sur la connexion native de l'ORM. */
export async function execRaw(
  orm: DrizzleOrm,
  dialect: SqlDialect,
  statement: string,
): Promise<void> {
  if (dialect === "sqlite") {
    orm.getNativeConnection<ISqliteExecutor>().run(sql.raw(statement));
  } else {
    await orm
      .getNativeConnection<IServerExecutor>()
      .execute(sql.raw(statement));
  }
}

export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "..",
);

/** Ce que la migration doit couvrir. */
export interface IKitMigrationOptions {
  dialect: SqlDialect;
  /** Fichier (TypeScript) de la fixture qui déclare les tables portables. */
  fixtureFile: string;
  /**
   * Corps du schéma lu par `drizzle-kit`, une ligne par table EXPORTÉE À PLAT
   * (`drizzle-kit` ne collecte rien d'autre) ; `fixture` est le spécificateur
   * d'import de la fixture, `dialect` le dialecte visé.
   */
  schemaLines: (fixture: string, dialect: SqlDialect) => string[];
  /** Nom de la migration (et du dossier de décor). */
  name: string;
}

/**
 * Génère la migration initiale d'une fixture avec `drizzle-kit`, comme
 * `orm:generate` le fait pour une application, et rend ses instructions.
 *
 * Le décor vit sous `tmp/scratch/` du DÉPÔT : la résolution de `drizzle-kit`
 * et de `drizzle-orm` remonte jusqu'à ses `node_modules`. Il est supprimé
 * après lecture.
 */
export async function generateKitMigration(
  opts: IKitMigrationOptions,
): Promise<string[]> {
  const { dialect, name } = opts;
  const decor = path.join(
    REPO_ROOT,
    "tmp",
    "scratch",
    `${name}-migration-${dialect}-${process.pid}`,
  );
  try {
    const schemaFile = path.join(decor, "schema.ts");
    const configFile = path.join(decor, "drizzle.config.ts");
    const outDir = path.join(decor, "migrations");
    const fixture = importSpecifier(schemaFile, opts.fixtureFile);
    await fs.mkdir(decor, { recursive: true });
    await fs.writeFile(
      schemaFile,
      [...opts.schemaLines(fixture, dialect), ""].join("\n"),
      "utf8",
    );
    await writeKitConfig({
      file: configFile,
      projectRoot: decor,
      schemaFile,
      outDir,
      dialect,
      excludedTables: [],
    });
    runGenerate({
      cwd: decor,
      configRel: path.relative(decor, configFile).split(path.sep).join("/"),
      name,
      label: `le banc ${name}`,
    });
    // Le banc applique ce que l'application appliquerait : le fichier SCELLÉ
    // par la génération, pas la sortie brute de l'outil.
    sealGeneratedSql(outDir);
    const body = await fs.readFile(
      path.join(outDir, `0000_${name}.sql`),
      "utf8",
    );
    return body
      .split("--> statement-breakpoint")
      .map((chunk) => chunk.trim())
      .filter((chunk) => chunk.length > 0);
  } finally {
    await fs.rm(decor, { recursive: true, force: true });
  }
}
