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

/**
 * Le moteur se plaint-il d'une COLONNE d'historique qu'il ne trouve pas ?
 *
 * Reconnaît la table d'historique d'une AUTRE provenance : la table porte le
 * bon nom, elle n'a pas les bonnes colonnes. `CREATE TABLE IF NOT EXISTS` ne
 * la répare pas — elle existe —, et la première lecture échoue sur un message
 * de moteur brut, que le fourre-tout des pannes habille alors de deux causes
 * FAUSSES : « la base n'a pas répondu » et « les droits manquent ». Mesuré au
 * banc : c'est ce message qui a renvoyé un agent détruire une base de
 * production après qu'il eut pourtant suivi le conseil de travailler sur une
 * copie — copie qu'il avait dû fabriquer à la main, avec un historique inventé.
 *
 * PURE, et une grammaire par moteur : les trois formulent la même panne dans
 * trois langues, et un motif écrit pour l'une est muet pour les deux autres.
 * Bornée aux colonnes que ce fichier déclare : une colonne APPLICATIVE
 * manquante est un tout autre incident, qui a déjà sa voie.
 *
 * @param message - message d'erreur rendu par le pilote.
 * @returns la colonne d'historique introuvable, ou `null`.
 */
export function colonneHistoriqueAbsente(message: string): string | null {
  const motifs = [
    /no such column:\s*(?:[\w."`]*\.)?[`"']?(\w+)[`"']?/i, // sqlite
    /column\s+[`"']?(?:[\w.]*\.)?[`"']?(\w+)[`"']?\s+does not exist/i, // postgres
    /unknown column\s+[`"']?(?:[\w.]*\.)?[`"']?(\w+)[`"']?/i, // mysql
  ];
  for (const motif of motifs) {
    const trouve = motif.exec(message);
    const nom = trouve?.[1]?.toLowerCase();
    if (
      nom !== undefined &&
      (BASE_COLUMNS as readonly string[]).includes(nom)
    ) {
      return nom;
    }
  }
  return null;
}

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
 * Désinscrit UNE entrée nommée de l'historique, quel que soit son état.
 *
 * ## Pourquoi ce geste existe, alors qu'un interdit dit de ne pas y toucher
 *
 * L'interdit porte sur la modification À LA MAIN, dans un client SQL, sans
 * trace. Il existait pourtant un état dont AUCUNE commande ne sortait : une
 * migration inscrite `success` que personne n'a jamais exécutée — une adoption
 * mal bornée, une base héritée d'une version antérieure aux gardes. Le
 * générateur disait « c'est l'historique qu'il faut reprendre » et renvoyait
 * vers la réparation, qui ne sait lever que des marqueurs d'ÉCHEC : elle
 * répondait « rien à réparer », et l'on revenait au point de départ. Trois
 * messages vrais, aucun geste — et le seul chemin restant était de détruire la
 * base.
 *
 * Le geste est donc rendu au produit, où il laisse une trace et où il est
 * BORNÉ : une entrée précisément nommée, jamais un lot, jamais un motif.
 *
 * ⚠️ Ne touche pas la base : après cet oubli, la migration sera REJOUÉE au
 * prochain passage. Si elle avait réellement été appliquée, ce rejeu échouera
 * — bruyamment, ce qui est le comportement voulu.
 *
 * @param driver - pilote sous verrou.
 * @param entries - entrées à désinscrire, chacune nommée `source` et `tag`.
 * @returns celles qui existaient et ont été retirées.
 */
export async function forgetEntries(
  driver: IMigrationDriver,
  entries: readonly { source: string; tag: string }[],
): Promise<{ source: string; tag: string }[]> {
  const presentes = await readHistory(driver);
  const retirees: { source: string; tag: string }[] = [];
  for (const cible of entries) {
    const existe = presentes.some(
      (row) => row.source === cible.source && row.tag === cible.tag,
    );
    if (!existe) {
      continue;
    }
    await driver.query(
      `DELETE FROM ${HISTORY_TABLE} WHERE source = ? AND tag = ?`,
      [cible.source, cible.tag],
    );
    retirees.push({ source: cible.source, tag: cible.tag });
  }
  return retirees;
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
