import { getTableColumns, type Column, type Table } from "drizzle-orm";
import type { IEntity } from "@nodefony/orm-core";
import type { DrizzleOrm } from "./DrizzleOrm";

/**
 * Compteur de semis — il rend chaque ligne semée DISTINCTE.
 *
 * Une entité cible porte souvent une colonne unique (un courriel, une
 * référence). Semer deux fois la même valeur violerait sa contrainte, et le test
 * échouerait sur son propre décor plutôt que sur ce qu'il éprouve.
 */
let seedCounter = 0;

/**
 * Valeur plausible pour une colonne, dérivée de ce que Drizzle en dit.
 *
 * On lit `dataType`, la classification **générique** de Drizzle (commune aux
 * trois dialectes), et non `columnType`, qui nomme l'implémentation (`SQLiteText`,
 * `PgVarchar`) et obligerait à connaître chaque moteur.
 */
function sampleForColumn(column: Column, n: number): unknown {
  if (column.enumValues?.length) return column.enumValues[0];
  switch (column.dataType) {
    case "number":
      return n;
    case "bigint":
      return BigInt(n);
    case "boolean":
      return true;
    case "date":
      return new Date();
    case "json":
      return {};
    case "buffer":
      return Buffer.from(`seed-${n}`);
    default:
      return `seed-${n}`;
  }
}

/**
 * Insère une ligne minimale dans la table d'une entité, et rend son identifiant.
 *
 * Destiné aux **tests** : dès qu'une entité porte une relation (`author:ref:Author`),
 * sa colonne est une vraie clé étrangère, et la base REFUSE un identifiant
 * inventé. La ligne parente doit donc exister avant toute insertion — et c'est
 * la seule façon d'éprouver la contrainte au lieu de la contourner (débrancher
 * `foreign_keys` rendrait le test vert sans rien prouver).
 *
 * Ce qui est rempli : les colonnes **obligatoires sans valeur par défaut**, avec
 * une valeur du type que Drizzle déclare. Le reste est laissé au schéma — une
 * clé primaire auto-générée, un horodatage, un défaut applicatif se posent seuls.
 *
 * @param orm - la connexion sur laquelle semer.
 * @param entity - l'entité cible ; son `schema` est la table Drizzle.
 * @returns l'identifiant de la ligne créée, à poser dans la colonne qui la désigne.
 * @throws Si la cible porte elle-même une clé étrangère obligatoire — le semis à
 *   un seul étage ne sait pas la satisfaire, et le message le dit plutôt que de
 *   laisser remonter un « FOREIGN KEY constraint failed » sans contexte.
 */
export async function seedEntityRow(
  orm: DrizzleOrm,
  entity: IEntity,
): Promise<string | number> {
  const n = ++seedCounter;
  const columns = getTableColumns(entity.schema as Table);
  const row: Record<string, unknown> = {};
  for (const [name, column] of Object.entries(columns)) {
    if (!column.notNull || column.hasDefault || column.primary) continue;
    row[name] = sampleForColumn(column, n);
  }
  try {
    const created = await orm
      .getRepository<Record<string, unknown>>(entity.name)
      .create(row);
    return created.id as string | number;
  } catch (cause) {
    throw new Error(
      `seedEntityRow : impossible de semer une ligne de « ${entity.name} ». ` +
        `Si cette entité porte elle-même une relation obligatoire, sème d'abord sa cible. ` +
        `Cause : ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}
