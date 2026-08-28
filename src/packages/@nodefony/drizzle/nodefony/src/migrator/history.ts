import type { SqlDialect } from "../../config/config";
import {
  HISTORY_TABLE,
  type IAppliedMigration,
  type IMigrationDriver,
} from "./types";

/**
 * Table d'historique : sa création, son amorçage, et sa lecture.
 *
 * 🔴 **La table qui sert à migrer doit savoir se migrer ELLE-MÊME.** Un
 * `CREATE TABLE IF NOT EXISTS` seul ne fait pas évoluer un schéma, et le jour
 * où une version ultérieure veut une colonne de plus, elle ne peut pas passer
 * par une migration ordinaire : l'applicateur LIT cette table avant d'appliquer
 * quoi que ce soit — il planterait sur une base ancienne avant d'avoir pu se
 * réparer. Œuf et poule.
 *
 * D'où un amorçage interne versionné, HORS du flux des migrations : la table
 * est créée au format d'origine, puis une liste d'`ALTER` ordonnés est
 * appliquée selon ce que l'introspection trouve. **Pas de colonne de version** :
 * la PRÉSENCE des colonnes EST la version — deux mécanismes pour une seule
 * question, ce serait zéro mécanisme.
 */

/**
 * Étape d'amorçage : une colonne ajoutée après le format d'origine.
 *
 * L'ordre du tableau fait foi et ne se réarrange pas : c'est lui qui garantit
 * qu'une base restée trois versions en arrière rattrape le même état qu'une
 * base neuve.
 */
export interface IHistoryStep {
  /** Colonne dont la présence atteste que l'étape est faite. */
  column: string;
  /** DDL à exécuter, par dialecte. */
  ddl: Record<SqlDialect, string>;
}

/**
 * Étapes d'amorçage postérieures au format d'origine.
 *
 * **Vide dans cette version** — l'étape 0 est le `CREATE` lui-même. Ce tableau
 * est le point d'extension : ajouter une colonne à l'historique, aujourd'hui ou
 * dans cinq versions, se fait ICI et nulle part ailleurs.
 */
export const HISTORY_STEPS: readonly IHistoryStep[] = [];

/** Colonnes du format d'origine, dans l'ordre du `CREATE`. */
const BASE_COLUMNS = [
  "source",
  "tag",
  "hash",
  "run_id",
  "started_at",
  "finished_at",
  "execution_ms",
  "success",
  "error",
  "applied_by",
] as const;

/** DDL de création par dialecte, au format d'origine. */
const CREATE_SQL: Record<SqlDialect, string> = {
  sqlite:
    `CREATE TABLE IF NOT EXISTS ${HISTORY_TABLE} (\n` +
    `  id INTEGER PRIMARY KEY AUTOINCREMENT,\n` +
    `  source TEXT NOT NULL,\n` +
    `  tag TEXT NOT NULL,\n` +
    `  hash TEXT NOT NULL,\n` +
    `  run_id TEXT NOT NULL,\n` +
    `  started_at INTEGER NOT NULL,\n` +
    `  finished_at INTEGER,\n` +
    `  execution_ms INTEGER,\n` +
    `  success INTEGER NOT NULL DEFAULT 0,\n` +
    `  error TEXT,\n` +
    `  applied_by TEXT,\n` +
    `  UNIQUE (source, tag)\n` +
    `)`,
  postgres:
    `CREATE TABLE IF NOT EXISTS ${HISTORY_TABLE} (\n` +
    `  id BIGSERIAL PRIMARY KEY,\n` +
    `  source TEXT NOT NULL,\n` +
    `  tag TEXT NOT NULL,\n` +
    `  hash TEXT NOT NULL,\n` +
    `  run_id TEXT NOT NULL,\n` +
    `  started_at BIGINT NOT NULL,\n` +
    `  finished_at BIGINT,\n` +
    `  execution_ms INTEGER,\n` +
    `  success BOOLEAN NOT NULL DEFAULT FALSE,\n` +
    `  error TEXT,\n` +
    `  applied_by TEXT,\n` +
    `  UNIQUE (source, tag)\n` +
    `)`,
  // `VARCHAR(190)` et non `TEXT` : une clé UNIQUE MySQL est bornée à 3072
  // octets, soit 768 caractères en utf8mb4 — deux colonnes TEXT n'y entrent
  // pas, et l'échec ne se voit qu'à la création de la table.
  mysql:
    `CREATE TABLE IF NOT EXISTS ${HISTORY_TABLE} (\n` +
    `  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,\n` +
    `  source VARCHAR(190) NOT NULL,\n` +
    `  tag VARCHAR(190) NOT NULL,\n` +
    `  hash VARCHAR(255) NOT NULL,\n` +
    `  run_id VARCHAR(64) NOT NULL,\n` +
    `  started_at BIGINT NOT NULL,\n` +
    `  finished_at BIGINT NULL,\n` +
    `  execution_ms INT NULL,\n` +
    `  success TINYINT(1) NOT NULL DEFAULT 0,\n` +
    `  error TEXT NULL,\n` +
    `  applied_by VARCHAR(255) NULL,\n` +
    `  UNIQUE KEY uq_${HISTORY_TABLE} (source, tag)\n` +
    `)`,
};

/**
 * Crée la table d'historique si besoin, puis l'amène au format courant.
 *
 * À appeler **juste après le verrou et AVANT la moindre lecture** : c'est
 * l'ordre qui rend l'évolution de la table possible sans outil de conversion
 * chez l'utilisateur.
 *
 * @param driver - pilote à connexion unique, verrou déjà tenu.
 * @returns les colonnes ajoutées par l'amorçage (vide dans le cas courant).
 */
export async function ensureHistorySchema(
  driver: IMigrationDriver,
): Promise<string[]> {
  await driver.exec(CREATE_SQL[driver.dialect]);
  const present = new Set(
    (await driver.columnsOf(HISTORY_TABLE)).map((c) => c.toLowerCase()),
  );
  const added: string[] = [];
  for (const step of HISTORY_STEPS) {
    if (present.has(step.column.toLowerCase())) {
      continue;
    }
    await driver.exec(step.ddl[driver.dialect]);
    added.push(step.column);
  }
  return added;
}

/**
 * Lit l'historique complet, **colonnes nommées une par une**.
 *
 * Jamais `SELECT *` : c'est ce qui rend l'ajout d'une colonne inoffensif pour
 * un applicateur plus ancien, qui continue de lire exactement ce qu'il connaît.
 *
 * @param driver - pilote à connexion unique.
 * @returns les lignes, dans leur ordre d'insertion.
 */
export async function readHistory(
  driver: IMigrationDriver,
): Promise<IAppliedMigration[]> {
  const rows = await driver.query<Record<string, unknown>>(
    `SELECT ${BASE_COLUMNS.join(", ")} FROM ${HISTORY_TABLE} ORDER BY id`,
  );
  return rows.map((row) => ({
    source: String(row.source),
    tag: String(row.tag),
    hash: String(row.hash),
    runId: String(row.run_id),
    startedAt: Number(row.started_at),
    finishedAt: row.finished_at === null ? null : Number(row.finished_at),
    executionMs: row.execution_ms === null ? null : Number(row.execution_ms),
    success: toBoolean(row.success),
    error: row.error === null ? null : String(row.error),
    appliedBy: row.applied_by === null ? null : String(row.applied_by),
  }));
}

/**
 * `INSERT` d'une ligne d'historique — **jamais positionnel**.
 *
 * @param driver - pilote à connexion unique.
 * @param row - ligne à écrire.
 */
export async function insertHistory(
  driver: IMigrationDriver,
  row: IAppliedMigration,
): Promise<void> {
  await driver.query(
    `INSERT INTO ${HISTORY_TABLE} (${BASE_COLUMNS.join(", ")}) ` +
      `VALUES (${BASE_COLUMNS.map(() => "?").join(", ")})`,
    [
      row.source,
      row.tag,
      row.hash,
      row.runId,
      row.startedAt,
      row.finishedAt,
      row.executionMs,
      fromBoolean(row.success, driver.dialect),
      row.error,
      row.appliedBy,
    ],
  );
}

/**
 * Marque une ligne d'historique terminée (chemin MySQL, DDL non transactionnel).
 *
 * @param driver - pilote à connexion unique.
 * @param row - ligne dont le résultat est connu.
 */
export async function finishHistory(
  driver: IMigrationDriver,
  row: IAppliedMigration,
): Promise<void> {
  await driver.query(
    `UPDATE ${HISTORY_TABLE} SET finished_at = ?, execution_ms = ?, ` +
      `success = ?, error = ?, hash = ? WHERE source = ? AND tag = ?`,
    [
      row.finishedAt,
      row.executionMs,
      fromBoolean(row.success, driver.dialect),
      row.error,
      row.hash,
      row.source,
      row.tag,
    ],
  );
}

/**
 * Supprime les marqueurs d'échec d'une source, ou de toutes.
 *
 * @param driver - pilote à connexion unique.
 * @param source - source à réparer ; toutes si omise.
 * @returns les migrations dont le marqueur a été levé.
 */
export async function deleteFailed(
  driver: IMigrationDriver,
  source?: string,
): Promise<{ source: string; tag: string }[]> {
  const failed = (await readHistory(driver)).filter(
    (row) =>
      (!row.success || row.finishedAt === null) &&
      (source === undefined || row.source === source),
  );
  for (const row of failed) {
    await driver.query(
      `DELETE FROM ${HISTORY_TABLE} WHERE source = ? AND tag = ?`,
      [row.source, row.tag],
    );
  }
  return failed.map(({ source: s, tag }) => ({ source: s, tag }));
}

/**
 * Normalise un booléen tel que le rend la base.
 *
 * PostgreSQL rend `true`, SQLite et MySQL rendent `1` — et un `1` textuel
 * traverse certains pilotes. Les trois se lisent ici, une fois.
 *
 * @param value - valeur brute lue en base.
 * @returns le booléen correspondant.
 */
function toBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

/**
 * Encode un booléen pour la base.
 *
 * @param value - booléen applicatif.
 * @param dialect - dialecte cible.
 * @returns la valeur à binder.
 */
function fromBoolean(value: boolean, dialect: SqlDialect): boolean | number {
  return dialect === "postgres" ? value : value ? 1 : 0;
}
