import fs from "node:fs/promises";
import path from "node:path";
import type { SqlDialect } from "../../interfaces/IDrizzleConfig";
import { readSnapshot } from "./adopt";
import { auditMigrationSql, type IAuditRule } from "./kit";
import { repairRebuildCopy } from "./rebuildCopy";
import { columnFactsByTable, columnsByTable } from "./snapshotColumns";
import type { IMigrationFile } from "./types";

/** Un fichier de migration tel que la relecture l'a laissé. */
export interface IReviewedMigration {
  /** Identité du fichier dans le journal (`0001_evolve`). */
  readonly tag: string;
  /** Chemin du `.sql`. */
  readonly file: string;
  /** Le SQL qui sera VRAIMENT joué — recopie réparée comprise. */
  readonly sql: string;
  /** Colonnes retirées d'une recopie parce que la table de départ ne les porte pas. */
  readonly repaired: readonly string[];
}

/** Ce que la relecture des fichiers d'une génération a fait et trouvé. */
export interface IGenerationReview {
  readonly files: readonly IReviewedMigration[];
  /** Ce qui détruit des données — refusé sans `--allow-destructive`. */
  readonly destructive: IAuditRule[];
  /** Ce qui mérite un regard sans refus (verrou long, index bloquant). */
  readonly warnings: IAuditRule[];
}

/**
 * L'instantané qui PRÉCÈDE un fichier généré — l'état de départ de sa
 * différence. `null` pour le premier fichier, ou quand l'instantané manque ou
 * ne se lit pas : on ne sait pas, donc on ne répare rien.
 *
 * @param outDir - dossier des migrations du dialecte.
 * @param tag - identité du fichier (`NNNN_nom`).
 * @returns l'instantané brut, ou `null`.
 */
export async function snapshotBefore(
  outDir: string,
  tag: string,
): Promise<unknown> {
  const index = Number.parseInt(tag.slice(0, 4), 10);
  if (!Number.isFinite(index) || index <= 0) {
    return null;
  }
  const file = path.join(
    outDir,
    "meta",
    `${String(index - 1).padStart(4, "0")}_snapshot.json`,
  );
  return readSnapshot(file).catch(() => null);
}

/**
 * Les colonnes de DÉPART de chaque migration en attente, lues dans l'instantané
 * qui la précède — ce que `scanDestructive` exige pour voir une recréation
 * SQLite qui ne recopie pas une colonne.
 *
 * @param files - migrations en attente (`DrizzleMigrator.status().pending`).
 * @returns le lecteur de colonnes d'un fichier ; `null` sans instantané lisible.
 */
export async function columnsBeforeFiles(
  files: readonly IMigrationFile[],
): Promise<
  (file: IMigrationFile) => ((table: string) => readonly string[] | null) | null
> {
  const byPath = new Map<string, (table: string) => readonly string[] | null>();
  for (const file of files) {
    const doc = await snapshotBefore(path.dirname(file.path), file.tag);
    if (doc !== null) byPath.set(file.path, columnsByTable(doc));
  }
  return (file) => byPath.get(file.path) ?? null;
}

/**
 * Relit les fichiers qu'une génération vient d'écrire : répare la recopie d'une
 * recréation de table, puis audite le SQL qui sera réellement joué.
 *
 * 🔴 Réparer AVANT d'auditer : une recréation de table dont la recopie lit une
 * colonne encore absente de la table de départ échoue à l'application, pose un
 * marqueur, et bloque tous les passages suivants. L'audit doit voir le SQL qui
 * sera VRAIMENT joué, pas celui que l'outil a écrit.
 *
 * C'est la relecture de `orm:generate` ; un banc qui génère une évolution
 * l'appelle au lieu de la recopier — sinon il prouverait SA relecture.
 *
 * @param opts.outDir - dossier des migrations du dialecte.
 * @param opts.tags - fichiers écrits par la génération, dans l'ordre.
 * @param opts.dialect - dialecte de ces fichiers.
 * @param opts.startState - état de départ IMPOSÉ. Après un renommage, c'est
 *   l'instantané RÉÉCRIT, celui que l'outil a lu : l'original porte les
 *   anciens noms, la recopie y perdrait la colonne renommée et l'audit n'y
 *   trouverait pas son type. Absent : l'instantané qui précède chaque fichier.
 * @returns les fichiers relus, les destructions et les avertissements.
 */
export async function reviewGenerated(opts: {
  outDir: string;
  tags: readonly string[];
  dialect: SqlDialect;
  startState?: unknown;
}): Promise<IGenerationReview> {
  const files: IReviewedMigration[] = [];
  const destructive: IAuditRule[] = [];
  const warnings: IAuditRule[] = [];
  for (const tag of opts.tags) {
    const file = path.join(opts.outDir, `${tag}.sql`);
    let sql = await fs.readFile(file, "utf8");
    const startState =
      opts.startState ?? (await snapshotBefore(opts.outDir, tag));
    const repair = repairRebuildCopy(sql, columnsByTable(startState));
    if (repair.dropped.length > 0) {
      await fs.writeFile(file, repair.sql, "utf8");
      sql = repair.sql;
    }
    const audit = auditMigrationSql(
      sql,
      opts.dialect,
      columnFactsByTable(startState),
      columnsByTable(startState),
    );
    destructive.push(...audit.destructive);
    warnings.push(...audit.blocking);
    files.push({ tag, file, sql, repaired: repair.dropped });
  }
  return { files, destructive, warnings };
}
