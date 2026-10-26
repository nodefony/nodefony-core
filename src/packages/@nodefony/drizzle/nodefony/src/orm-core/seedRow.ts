import { randomUUID } from "node:crypto";
import { getTableColumns, type Column } from "drizzle-orm";
import type { IEntity } from "@nodefony/orm-core";
import type { ColumnSpec } from "../../entity/colKit.spec";
import { isPortableSchema } from "../../entity/colKit.shared";
import type { DrizzleOrm } from "./DrizzleOrm";
import { dialectTableOf } from "./entityTable";

/**
 * Compteur de semis — il rend chaque ligne semée DISTINCTE.
 *
 * Une entité cible porte souvent une colonne unique (un courriel, une
 * référence). Semer deux fois la même valeur violerait sa contrainte, et le test
 * échouerait sur son propre décor plutôt que sur ce qu'il éprouve.
 */
let seedCounter = 0;

/** Une chaîne distincte qui tient dans `length` caractères. */
function fitted(n: number, length: number | undefined): string {
  const value = `seed-${n}`;
  return length === undefined || value.length <= length
    ? value
    : String(n).padStart(length, "0").slice(-length);
}

/**
 * Valeur valide pour une colonne d'une description PORTABLE — lue sur la
 * grammaire du kit, qui dit ce que la base acceptera : une longueur, une
 * longueur exacte, un décimal, un uuid, un jour. Le type Drizzle de la table
 * déclinée ne le dit pas : en SQLite, un `decimal` et un `char(3)` y sont tous
 * deux un `text`, et `seed-1` y est refusé par le codec ou la contrainte.
 *
 * @returns la valeur, ou `undefined` pour une colonne que le semis ne remplit
 *   pas (une référence : sa cible est fournie par l'appelant).
 */
function sampleForSpec(spec: ColumnSpec, n: number): unknown {
  switch (spec.kind) {
    case "string":
      return fitted(n, spec.length ?? 255);
    case "char":
      return String(n).padStart(spec.length, "0").slice(-spec.length);
    case "text":
      return `seed-${n}`;
    case "int":
    case "int64":
    case "serial":
    case "float":
      return n;
    case "decimal":
      return String(n);
    case "bool":
      return true;
    case "json":
      return {};
    case "date":
      return "2024-01-01";
    case "datetime":
      return new Date();
    case "uuid":
      return randomUUID();
    case "enum":
      return spec.values[0];
    case "vector":
      return Array.from({ length: spec.dimensions }, () => 0);
    case "ref":
      return undefined;
  }
}

/**
 * Valeur plausible pour une colonne d'une table NATIVE, dérivée de ce que
 * Drizzle en dit.
 *
 * On lit d'abord le type SQL (`getSQLType()` : `uuid`, `char(3)`,
 * `varchar(40)`, `numeric(12, 2)` — les mêmes mots sur les trois dialectes),
 * qui porte les bornes, puis `dataType`, la classification **générique** de
 * Drizzle. `columnType`, qui nomme l'implémentation (`SQLiteText`, `PgVarchar`),
 * obligerait à connaître chaque moteur.
 */
function sampleForColumn(
  column: Pick<Column, "enumValues" | "dataType" | "getSQLType">,
  n: number,
): unknown {
  if (column.enumValues?.length) return column.enumValues[0];
  const sqlType = column.getSQLType().toLowerCase();
  if (sqlType === "uuid") return randomUUID();
  const sized = /^(var)?char\((\d+)\)/u.exec(sqlType);
  if (sized) {
    const length = Number(sized[2]);
    return sized[1] === undefined
      ? String(n).padStart(length, "0").slice(-length)
      : fitted(n, length);
  }
  if (/^(numeric|decimal)\b/u.test(sqlType)) return String(n);
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
    // Tout le reste reçoit une chaîne — nommés un à un pour qu'un type ajouté
    // par Drizzle soit signalé ici plutôt qu'absorbé en silence.
    case "string":
    case "array":
    case "custom":
    case "duration":
    case "dateDuration":
    case "relDuration":
    case "localDate":
    case "localDateTime":
    case "localTime":
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
 * une valeur que la base acceptera — lue sur la description portable quand
 * l'entité en a une, sur le type SQL de la table sinon. Le reste est laissé au
 * schéma — une clé primaire auto-générée, un horodatage, un défaut applicatif
 * se posent seuls.
 *
 * Une cible qui porte ELLE-MÊME une référence obligatoire se sème en deux
 * temps : sa propre cible d'abord, puis elle, en passant l'identifiant obtenu
 * dans `values` (`seedEntityRow(orm, Book, { author: authorId })`).
 *
 * @param orm - la connexion sur laquelle semer.
 * @param entity - l'entité cible ; son `schema` est la table Drizzle.
 * @param values - colonnes imposées (les références de la cible, surtout) ;
 *   elles priment sur toute valeur semée.
 * @returns l'identifiant de la ligne créée, à poser dans la colonne qui la désigne.
 * @throws Si la cible porte une clé étrangère obligatoire que `values` ne
 *   fournit pas — le message le dit plutôt que de laisser remonter un
 *   « FOREIGN KEY constraint failed » sans contexte.
 */
export async function seedEntityRow(
  orm: DrizzleOrm,
  entity: IEntity,
  values: Readonly<Record<string, unknown>> = {},
): Promise<string | number> {
  const n = ++seedCounter;
  const table = dialectTableOf(entity.schema, orm.dialect);
  if (table === null) {
    throw new Error(
      `seedEntityRow: entity "${entity.name}" has no ${orm.dialect} table to seed.`,
    );
  }
  const row: Record<string, unknown> = {};
  if (isPortableSchema(entity.schema)) {
    for (const [name, spec] of Object.entries(entity.schema.spec.columns)) {
      // Un `serial` est posé par la base ; il n'a d'ailleurs pas de `notNull`.
      if (spec.kind === "serial") continue;
      // Une clé primaire, un défaut littéral ou calculé : le schéma s'en charge.
      const filled =
        spec.notNull === true &&
        !("primaryKey" in spec) &&
        !("default" in spec) &&
        !("defaultFn" in spec);
      if (!filled) continue;
      const value = sampleForSpec(spec, n);
      if (value !== undefined) row[name] = value;
    }
  } else {
    for (const [name, column] of Object.entries(getTableColumns(table))) {
      if (!column.notNull || column.hasDefault || column.primary) continue;
      row[name] = sampleForColumn(column, n);
    }
  }
  Object.assign(row, values);
  try {
    const created = await orm
      .getRepository<Record<string, unknown>>(entity.name)
      .create(row);
    const id = created["id"];
    if (typeof id !== "string" && typeof id !== "number") {
      throw new Error(
        `la ligne créée n'a pas d'identifiant lisible (${String(id)})`,
      );
    }
    return id;
  } catch (cause) {
    throw new Error(
      `seedEntityRow : impossible de semer une ligne de « ${entity.name} ». ` +
        `Si cette entité porte elle-même une relation obligatoire, sème d'abord sa cible ` +
        `et passe son identifiant : seedEntityRow(orm, ${entity.name}Entity, { <colonne>: id }). ` +
        `Cause : ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}
