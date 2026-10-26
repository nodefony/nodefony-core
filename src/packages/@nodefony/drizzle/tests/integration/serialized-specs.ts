import { defineTable } from "../../nodefony/entity/colKit";
import type { IPortableTable } from "../../nodefony/entity/colKit";
import type {
  ColumnSpec,
  ITableDescription,
  ITableSpec,
  OnDeleteAction,
} from "../../nodefony/entity/colKit.spec";

/**
 * Matérialiseur des descriptions SÉRIALISÉES — la sortie JSON de
 * `mysql-ddl-to-specs.mjs` rendue à la grammaire du kit de colonnes.
 *
 * La description sérialisée diffère de `ITableSpec` sur deux points, imposés
 * par JSON : une référence nomme sa cible (`target: "erp_user"`), et le seul
 * défaut calculé s'écrit `"now"`. Ce fichier les rend à la forme du kit — rien
 * d'autre : aucun genre n'est réinterprété.
 *
 * SEULE implémentation : le corpus `erp-lite` de la CI l'appelle, et le banc de
 * schéma réel (`bench-real-schema.mjs`) en recopie la source dans son
 * application isolée, ses deux imports relus vers `@nodefony/drizzle`. Ses
 * imports restent donc ceux-là, et seulement ceux-là.
 *
 * `drizzle-kit` relit ce fichier (en CommonJS) pour générer une migration :
 * aucun `await` de premier niveau, aucun effet de bord.
 */

/** Une colonne telle que la conversion l'écrit. */
export interface ISerializedColumn {
  readonly kind: string;
  readonly primaryKey?: boolean;
  readonly notNull?: boolean;
  readonly unique?: boolean;
  readonly length?: number;
  readonly precision?: number;
  readonly scale?: number;
  readonly default?: string | number | boolean;
  readonly defaultFn?: "now";
  readonly onUpdateFn?: "now";
  readonly target?: string;
  readonly onDelete?: OnDeleteAction;
}

/** Une table telle que la conversion l'écrit. */
export interface ISerializedSpec {
  readonly name: string;
  readonly columns: Readonly<Record<string, ISerializedColumn>>;
  readonly indexes?: readonly {
    readonly name: string;
    readonly on: readonly [string, ...string[]];
    readonly unique?: boolean;
  }[];
}

const now = (): Date => new Date();

/** Modificateurs communs, recopiés seulement quand ils sont posés. */
function flags(c: ISerializedColumn): { notNull?: true; unique?: true } {
  const out: { notNull?: true; unique?: true } = {};
  if (c.notNull) out.notNull = true;
  if (c.unique) out.unique = true;
  return out;
}

function numberDefault(c: ISerializedColumn): { default?: number } {
  return typeof c.default === "number" ? { default: c.default } : {};
}

function stringDefault(c: ISerializedColumn): { default?: string } {
  return typeof c.default === "string" ? { default: c.default } : {};
}

function required(value: number | undefined, what: string): number {
  if (value === undefined) throw new Error(`specs : ${what} absent`);
  return value;
}

/** Rend une colonne sérialisée à la grammaire du kit. */
function toColumn(
  table: string,
  key: string,
  c: ISerializedColumn,
  lookup: (name: string) => ITableDescription,
): ColumnSpec {
  const where = `${table}.${key}`;
  switch (c.kind) {
    case "serial":
      return { kind: "serial", primaryKey: true };
    case "int":
      return { kind: "int", ...flags(c), ...numberDefault(c) };
    case "int64":
      return { kind: "int64", ...flags(c), ...numberDefault(c) };
    case "float":
      return { kind: "float", ...flags(c), ...numberDefault(c) };
    case "string":
      return {
        kind: "string",
        length: required(c.length, `${where} length`),
        ...(c.primaryKey ? { primaryKey: true } : {}),
        ...flags(c),
        ...stringDefault(c),
      };
    case "char":
      return {
        kind: "char",
        length: required(c.length, `${where} length`),
        ...flags(c),
        ...stringDefault(c),
      };
    case "text":
      return { kind: "text", ...flags(c), ...stringDefault(c) };
    case "date":
      return { kind: "date", ...flags(c), ...stringDefault(c) };
    case "decimal":
      return {
        kind: "decimal",
        precision: required(c.precision, `${where} precision`),
        scale: required(c.scale, `${where} scale`),
        ...flags(c),
        ...stringDefault(c),
      };
    case "bool":
      return {
        kind: "bool",
        ...flags(c),
        ...(typeof c.default === "boolean" ? { default: c.default } : {}),
      };
    case "json":
      return { kind: "json", ...flags(c) };
    case "datetime":
      return {
        kind: "datetime",
        ...flags(c),
        ...(c.defaultFn === "now" ? { defaultFn: now } : {}),
        ...(c.onUpdateFn === "now" ? { onUpdateFn: now } : {}),
      };
    case "ref": {
      const target = c.target;
      if (target === undefined) throw new Error(`specs : ${where} sans cible`);
      return {
        kind: "ref",
        target: target === "self" ? "self" : () => lookup(target),
        ...flags(c),
        ...(c.onDelete ? { onDelete: c.onDelete } : {}),
      };
    }
    default:
      throw new Error(`specs : genre ${c.kind} non pris en charge (${where})`);
  }
}

function toSpec(
  s: ISerializedSpec,
  lookup: (name: string) => ITableDescription,
): ITableSpec {
  const columns: Record<string, ColumnSpec> = {};
  for (const [key, c] of Object.entries(s.columns)) {
    columns[key] = toColumn(s.name, key, c, lookup);
  }
  return {
    name: s.name,
    columns,
    ...(s.indexes
      ? {
          indexes: s.indexes.map((ix) => ({
            name: ix.name,
            on: ix.on,
            ...(ix.unique ? { unique: true as const } : {}),
          })),
        }
      : {}),
  };
}

/**
 * Déclare chaque description par le kit, et rend les tables portables par nom.
 *
 * @param specs - descriptions sérialisées (sortie de la conversion).
 * @returns les tables portables, par nom de table.
 * @throws Quand un genre est inconnu, ou qu'une référence vise une table absente.
 */
export function materializeSpecs(
  specs: readonly ISerializedSpec[],
): ReadonlyMap<string, IPortableTable<ITableSpec>> {
  // Lue par les thunks des références, APRÈS coup : l'ordre des specs est libre.
  const declared = new Map<string, IPortableTable<ITableSpec>>();
  const lookup = (name: string): ITableDescription => {
    const table = declared.get(name);
    if (!table) throw new Error(`specs : table visée inconnue ${name}`);
    return table;
  };
  for (const s of specs) declared.set(s.name, defineTable(toSpec(s, lookup)));
  return declared;
}

/**
 * Nom de la clé primaire d'une description sérialisée.
 *
 * @throws Quand la table n'en déclare aucune.
 */
export function primaryKeyOf(s: ISerializedSpec): string {
  const entry = Object.entries(s.columns).find(([, c]) => c.primaryKey);
  if (!entry) throw new Error(`specs : ${s.name} sans clé primaire`);
  return entry[0];
}

/**
 * Ordre de création : une table après celles qu'elle référence (hors
 * référence vers soi). C'est l'ordre d'insertion des lignes témoins, et
 * l'inverse de celui des suppressions.
 *
 * @throws Quand les références forment un cycle.
 */
export function creationOrder(
  specs: readonly ISerializedSpec[],
): ISerializedSpec[] {
  const byName = new Map(specs.map((s) => [s.name, s]));
  const done = new Set<string>();
  const out: ISerializedSpec[] = [];
  const visit = (s: ISerializedSpec, trail: string[]): void => {
    if (done.has(s.name)) return;
    if (trail.includes(s.name)) {
      throw new Error(`specs : cycle ${[...trail, s.name].join(" → ")}`);
    }
    for (const c of Object.values(s.columns)) {
      if (c.kind === "ref" && c.target && c.target !== "self") {
        const target = byName.get(c.target);
        if (target) visit(target, [...trail, s.name]);
      }
    }
    done.add(s.name);
    out.push(s);
  };
  for (const s of specs) visit(s, []);
  return out;
}
