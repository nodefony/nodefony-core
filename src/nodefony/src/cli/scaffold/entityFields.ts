/**
 * Champs d'entité : de la syntaxe `title:string` au code Drizzle du dialecte visé.
 *
 * Module **pur** (aucune I/O, aucun template) : c'est lui qui porte la traduction
 * « vocabulaire Nodefony → colonne Drizzle native », donc c'est lui qu'on teste.
 *
 * Vocabulaire volontairement restreint — le scaffold doit produire du code qu'un
 * humain relit et étend, pas couvrir toute la surface SQL. Un besoin exotique
 * (`numeric(12,4)`, `citext`, tableau PG…) s'écrit à la main dans la table générée :
 * c'est du Drizzle natif, il n'y a rien à contourner.
 */

/** Dialectes SQL supportés par le scaffold (ceux de `@nodefony/drizzle`). */
export const ENTITY_DIALECTS = ["sqlite", "postgres", "mysql"] as const;
export type TEntityDialect = (typeof ENTITY_DIALECTS)[number];

/** Stratégies de clé primaire. */
export const ENTITY_ID_KINDS = ["uuid7", "uuid4", "serial"] as const;
export type TEntityIdKind = (typeof ENTITY_ID_KINDS)[number];

/** Types de champ du vocabulaire Nodefony (jamais le vocabulaire Drizzle). */
export const ENTITY_FIELD_TYPES = [
  "string",
  "text",
  "int",
  "float",
  "bool",
  "json",
  "date",
  "uuid",
] as const;
export type TEntityFieldType = (typeof ENTITY_FIELD_TYPES)[number];

/** Un champ déclaré, après analyse de `title:string!` ou `author:ref:User`. */
export interface IEntityField {
  /** Nom de la propriété (camelCase). */
  name: string;
  /** Type Nodefony, ou `ref` pour une clé étrangère. */
  type: TEntityFieldType | "ref";
  /** Entité cible quand `type === "ref"`. */
  target?: string;
  /** `true` si `?` — la colonne accepte `NULL`. Non-null par DÉFAUT. */
  nullable: boolean;
  /** `true` si `!` — contrainte d'unicité. */
  unique: boolean;
  /** `true` si `:index`. */
  indexed: boolean;
}

/** Erreur de syntaxe dans la déclaration d'un champ — message actionnable. */
export class EntityFieldError extends Error {}

const NAME_RE = /^[a-z][a-zA-Z0-9]*$/u;
const ENTITY_RE = /^[A-Z][A-Za-z0-9]*$/u;

/**
 * Analyse la déclaration textuelle des champs.
 *
 * Grammaire : `nom:type[?][!][:index]` · `nom:ref:Entité[?][!]`
 * - `?` → nullable (sinon **NOT NULL** : une colonne nullable est une décision, pas un oubli) ;
 * - `!` → unique ;
 * - `:index` → index simple.
 *
 * @param input - `"title:string! content:text? views:int author:ref:User"`.
 * @returns les champs, dans l'ordre de déclaration.
 * @throws EntityFieldError si un champ est mal formé (le mot « invalide » est attendu
 *   par le routeur d'erreurs du CLI pour sortir en `EX_USAGE`).
 */
export function parseEntityFields(input: string): IEntityField[] {
  const fields: IEntityField[] = [];
  const seen = new Set<string>();

  for (const raw of input.split(/\s+/u).filter(Boolean)) {
    // Modificateurs collés au type : `content:text?`, `slug:string!`.
    let spec = raw;
    let indexed = false;
    if (spec.endsWith(":index")) {
      indexed = true;
      spec = spec.slice(0, -":index".length);
    }
    let nullable = false;
    let unique = false;
    // Boucle : `?!` et `!?` doivent être acceptés dans les deux ordres.
    for (;;) {
      if (spec.endsWith("?")) {
        nullable = true;
        spec = spec.slice(0, -1);
        continue;
      }
      if (spec.endsWith("!")) {
        unique = true;
        spec = spec.slice(0, -1);
        continue;
      }
      break;
    }

    const parts = spec.split(":");
    const name = parts[0];
    if (!name || !NAME_RE.test(name)) {
      throw new EntityFieldError(
        `champ invalide « ${raw} » — nom attendu en camelCase (ex : title, publishedAt)`,
      );
    }
    if (seen.has(name)) {
      throw new EntityFieldError(
        `champ invalide « ${raw} » — « ${name} » déclaré deux fois`,
      );
    }
    if (name === "id") {
      throw new EntityFieldError(
        `champ invalide « ${raw} » — « id » est la clé primaire, posée par --id (uuid7 | uuid4 | serial)`,
      );
    }
    seen.add(name);

    // Relation : `author:ref:User`
    if (parts[1] === "ref") {
      const target = parts[2];
      if (!target || !ENTITY_RE.test(target)) {
        throw new EntityFieldError(
          `champ invalide « ${raw} » — cible attendue : nom d'entité en PascalCase (ex : author:ref:User)`,
        );
      }
      fields.push({ name, type: "ref", target, nullable, unique, indexed });
      continue;
    }

    const type = (parts[1] ?? "string") as TEntityFieldType;
    if (!(ENTITY_FIELD_TYPES as readonly string[]).includes(type)) {
      throw new EntityFieldError(
        `champ invalide « ${raw} » — type « ${type} » inconnu ; attendus : ${ENTITY_FIELD_TYPES.join(" | ")} | ref:<Entité>`,
      );
    }
    if (parts.length > 2) {
      throw new EntityFieldError(
        `champ invalide « ${raw} » — trop de segments (attendu nom:type[?][!][:index])`,
      );
    }
    fields.push({ name, type, nullable, unique, indexed });
  }

  return fields;
}

/** Constructeur de colonne Drizzle par (dialecte, type) — le cœur de la traduction. */
const COLUMN: Record<
  TEntityDialect,
  Record<TEntityFieldType | "ref", (col: string) => string>
> = {
  sqlite: {
    string: (c) => `text("${c}")`,
    text: (c) => `text("${c}")`,
    int: (c) => `integer("${c}")`,
    float: (c) => `real("${c}")`,
    bool: (c) => `integer("${c}", { mode: "boolean" })`,
    // SQLite n'a pas de type JSON : `mode: "json"` sérialise/désérialise pour nous.
    json: (c) => `text("${c}", { mode: "json" })`,
    date: (c) => `integer("${c}", { mode: "timestamp_ms" })`,
    uuid: (c) => `text("${c}")`,
    ref: (c) => `text("${c}")`,
  },
  postgres: {
    string: (c) => `varchar("${c}", { length: 255 })`,
    text: (c) => `text("${c}")`,
    int: (c) => `integer("${c}")`,
    float: (c) => `doublePrecision("${c}")`,
    bool: (c) => `boolean("${c}")`,
    // `jsonb` et pas `json` : indexable, comparé sans reparser.
    json: (c) => `jsonb("${c}")`,
    date: (c) => `timestamp("${c}", { withTimezone: true, precision: 3 })`,
    uuid: (c) => `uuid("${c}")`,
    ref: (c) => `text("${c}")`,
  },
  mysql: {
    string: (c) => `varchar("${c}", { length: 255 })`,
    text: (c) => `text("${c}")`,
    int: (c) => `int("${c}")`,
    float: (c) => `double("${c}")`,
    bool: (c) => `boolean("${c}")`,
    json: (c) => `json("${c}")`,
    date: (c) => `datetime("${c}", { fsp: 3 })`,
    // InnoDB ne peut pas indexer un TEXT : toute colonne indexable est un varchar.
    uuid: (c) => `varchar("${c}", { length: 36 })`,
    ref: (c) => `varchar("${c}", { length: 255 })`,
  },
};

/** Fonction de table Drizzle du dialecte (`sqliteTable`…) et son import. */
export const TABLE_FN: Record<TEntityDialect, { fn: string; module: string }> =
  {
    sqlite: { fn: "sqliteTable", module: "drizzle-orm/sqlite-core" },
    postgres: { fn: "pgTable", module: "drizzle-orm/pg-core" },
    mysql: { fn: "mysqlTable", module: "drizzle-orm/mysql-core" },
  };

/** Type TypeScript de la propriété correspondante (interface `XRow`). */
const TS_TYPE: Record<TEntityFieldType | "ref", string> = {
  string: "string",
  text: "string",
  int: "number",
  float: "number",
  bool: "boolean",
  json: "unknown",
  date: "Date",
  uuid: "string",
  ref: "string",
};

/** Schéma Zod correspondant (validation à la frontière). */
const ZOD_TYPE: Record<TEntityFieldType | "ref", string> = {
  string: "z.string().min(1).max(255)",
  text: "z.string()",
  int: "z.number().int()",
  float: "z.number()",
  bool: "z.boolean()",
  json: "z.unknown()",
  date: "z.coerce.date()",
  uuid: "z.string().uuid()",
  ref: "z.string()",
};

/** Colonne de clé primaire, selon la stratégie retenue. */
function primaryKeyColumn(
  dialect: TEntityDialect,
  id: TEntityIdKind,
): { line: string; tsType: string; imports: string[] } {
  if (id === "serial") {
    const line =
      dialect === "sqlite"
        ? `id: integer("id").primaryKey({ autoIncrement: true }),`
        : dialect === "postgres"
          ? `id: serial("id").primaryKey(),`
          : `id: int("id").autoincrement().primaryKey(),`;
    const imports =
      dialect === "sqlite"
        ? ["integer"]
        : dialect === "postgres"
          ? ["serial"]
          : ["int"];
    return { line, tsType: "number", imports };
  }
  // uuid7 (défaut) / uuid4 : la valeur est produite côté JS — le DDL dérivé du dev
  // n'émet PAS les DEFAULT SQL, un défaut posé en base ne s'appliquerait donc pas.
  const generator =
    id === "uuid7" ? "Nodefony.generateSortableId()" : "Nodefony.generateId()";
  const col = COLUMN[dialect].uuid("id");
  return {
    line: `id: ${col}.primaryKey().$defaultFn(() => ${generator}),`,
    tsType: "string",
    imports: [
      dialect === "postgres"
        ? "uuid"
        : dialect === "mysql"
          ? "varchar"
          : "text",
    ],
  };
}

/** Nom du constructeur Drizzle utilisé par un champ (pour la liste d'imports). */
function columnImport(
  dialect: TEntityDialect,
  type: TEntityFieldType | "ref",
): string {
  return COLUMN[dialect][type]("x").split("(")[0];
}

/** Tout ce dont les templates ont besoin pour rendre une entité. */
export interface IEntityCodegen {
  /** Corps de la table (lignes `nom: colonne,`). */
  columns: string;
  /** Import Drizzle du dialecte (`import { text, integer } from "drizzle-orm/sqlite-core";`). */
  drizzleImport: string;
  /** Fonction de table (`sqliteTable`). */
  tableFn: string;
  /** Propriétés de l'interface de ligne. */
  rowProps: string;
  /** Corps du schéma Zod de création. */
  zodProps: string;
  /** `true` si la clé primaire est générée côté JS (le template importe `Nodefony`). */
  needsNodefony: boolean;
  /** Type TS de la clé primaire. */
  idType: string;
}

/**
 * Produit le code des colonnes, de l'interface de ligne et du schéma Zod.
 *
 * Les horodatages sont posés **côté JS** (`$defaultFn`/`$onUpdateFn`) et non en SQL :
 * le DDL dérivé du mode dev n'émet pas les `DEFAULT` — un défaut SQL serait donc
 * silencieusement absent des tables créées au boot.
 *
 * @param fields - champs analysés par {@link parseEntityFields}.
 * @param options - dialecte, stratégie d'identifiant, horodatages, suppression douce.
 */
export function buildEntityCodegen(
  fields: IEntityField[],
  options: {
    dialect: TEntityDialect;
    id: TEntityIdKind;
    timestamps: boolean;
    softDelete: boolean;
  },
): IEntityCodegen {
  const { dialect, id, timestamps, softDelete } = options;
  const imports = new Set<string>();
  const columns: string[] = [];
  const rowProps: string[] = [];
  const zodProps: string[] = [];

  const pk = primaryKeyColumn(dialect, id);
  pk.imports.forEach((i) => imports.add(i));
  columns.push(pk.line);
  rowProps.push(`id: ${pk.tsType};`);

  for (const field of fields) {
    imports.add(columnImport(dialect, field.type));
    let col = COLUMN[dialect][field.type](field.name);
    if (!field.nullable) col += ".notNull()";
    if (field.unique) col += ".unique()";
    columns.push(`${field.name}: ${col},`);

    const optional = field.nullable ? " | null" : "";
    rowProps.push(`${field.name}: ${TS_TYPE[field.type]}${optional};`);

    let zod = ZOD_TYPE[field.type];
    if (field.nullable) zod += ".nullable().optional()";
    zodProps.push(`${field.name}: ${zod},`);

    if (field.type === "ref") {
      // La contrainte de clé étrangère n'est PAS émise : le DDL dérivé du dev ne la
      // créerait pas, et une fausse promesse coûte plus cher qu'un commentaire honnête.
      columns[columns.length - 1] +=
        ` // → ${field.target}.id (contrainte FK à ajouter en migration)`;
    }
  }

  if (timestamps) {
    const dateCol = COLUMN[dialect].date;
    imports.add(columnImport(dialect, "date"));
    columns.push(
      `createdAt: ${dateCol("created_at")}.notNull().$defaultFn(() => new Date()),`,
      `updatedAt: ${dateCol("updated_at")}.notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),`,
    );
    rowProps.push("createdAt: Date;", "updatedAt: Date;");
  }

  if (softDelete) {
    const dateCol = COLUMN[dialect].date;
    imports.add(columnImport(dialect, "date"));
    columns.push(`deletedAt: ${dateCol("deleted_at")},`);
    rowProps.push("deletedAt: Date | null;");
  }

  const { fn, module } = TABLE_FN[dialect];
  imports.add(fn);

  return {
    columns: columns.join("\n  "),
    drizzleImport: `import { ${[...imports].sort().join(", ")} } from "${module}";`,
    tableFn: fn,
    rowProps: rowProps.join("\n  "),
    zodProps: zodProps.join("\n  "),
    needsNodefony: id !== "serial",
    idType: pk.tsType,
  };
}
