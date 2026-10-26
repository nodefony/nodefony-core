import { defineTable } from "../../nodefony/entity/colKit";
import type { IPortableTable } from "../../nodefony/entity/colKit";
import type {
  ColumnSpec,
  ITableDescription,
  ITableSpec,
  OnDeleteAction,
} from "../../nodefony/entity/colKit.spec";
import { SPECS } from "../fixtures/erp-lite/specs";

/**
 * Le corpus synthétique `erp-lite` — 14 tables écrites dans le style d'un
 * progiciel de gestion né sur MySQL, converties en descriptions NEUTRES par
 * `mysql-ddl-to-specs.mjs` (`../fixtures/erp-lite/specs.ts`, généré), puis
 * déclarées ici par le kit de colonnes.
 *
 * La description sérialisée diffère de `ITableSpec` sur deux points, imposés
 * par JSON : une référence nomme sa cible (`target: "erp_user"`), et le seul
 * défaut calculé s'écrit `"now"`. Ce fichier les rend à la forme du kit — rien
 * d'autre : aucun genre n'est réinterprété.
 *
 * `drizzle-kit` relit ce fichier pour générer la migration du banc : aucun
 * `await` de premier niveau, aucun effet de bord.
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

/** Les descriptions sérialisées du corpus. */
export const ERP_LITE_SPECS: readonly ISerializedSpec[] = SPECS;

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
  if (value === undefined) throw new Error(`erp-lite : ${what} absent`);
  return value;
}

/** Tables déclarées, par nom — lue par les thunks des références, après coup. */
const declared = new Map<string, IPortableTable<ITableSpec>>();

function lookup(name: string): ITableDescription {
  const table = declared.get(name);
  if (!table) throw new Error(`erp-lite : table visée inconnue ${name}`);
  return table;
}

/** Rend une colonne sérialisée à la grammaire du kit. */
function toColumn(
  table: string,
  key: string,
  c: ISerializedColumn,
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
      if (target === undefined)
        throw new Error(`erp-lite : ${where} sans cible`);
      return {
        kind: "ref",
        target: target === "self" ? "self" : () => lookup(target),
        ...flags(c),
        ...(c.onDelete ? { onDelete: c.onDelete } : {}),
      };
    }
    default:
      throw new Error(
        `erp-lite : genre ${c.kind} non pris en charge (${where})`,
      );
  }
}

function toSpec(s: ISerializedSpec): ITableSpec {
  const columns: Record<string, ColumnSpec> = {};
  for (const [key, c] of Object.entries(s.columns)) {
    columns[key] = toColumn(s.name, key, c);
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

for (const s of ERP_LITE_SPECS) {
  declared.set(s.name, defineTable(toSpec(s)));
}

/** Les tables portables du corpus, par nom. */
export const ERP_LITE: ReadonlyMap<
  string,
  IPortableTable<ITableSpec>
> = declared;

/** Nom de la clé primaire d'une description sérialisée. */
export function primaryKeyOf(s: ISerializedSpec): string {
  const entry = Object.entries(s.columns).find(([, c]) => c.primaryKey);
  if (!entry) throw new Error(`erp-lite : ${s.name} sans clé primaire`);
  return entry[0];
}

/**
 * Ordre de création : une table après celles qu'elle référence (hors
 * référence vers soi). C'est l'ordre d'insertion des lignes témoins, et
 * l'inverse de celui des suppressions.
 */
export function creationOrder(): ISerializedSpec[] {
  const byName = new Map(ERP_LITE_SPECS.map((s) => [s.name, s]));
  const done = new Set<string>();
  const out: ISerializedSpec[] = [];
  const visit = (s: ISerializedSpec, path: string[]): void => {
    if (done.has(s.name)) return;
    if (path.includes(s.name)) {
      throw new Error(`erp-lite : cycle ${[...path, s.name].join(" → ")}`);
    }
    for (const c of Object.values(s.columns)) {
      if (c.kind === "ref" && c.target && c.target !== "self") {
        const target = byName.get(c.target);
        if (target) visit(target, [...path, s.name]);
      }
    }
    done.add(s.name);
    out.push(s);
  };
  for (const s of ERP_LITE_SPECS) visit(s, []);
  return out;
}
