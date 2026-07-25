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
  "enum",
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
  /** Valeurs admises quand `type === "enum"` (`status:enum(draft,published)`). */
  values?: string[];
  /**
   * Valeur par défaut littérale, telle qu'écrite (`price:float=0` → `"0"`).
   *
   * Conservée en texte : c'est le générateur qui sait la traduire en littéral du
   * bon type, et lui seul connaît le dialecte visé.
   */
  defaultValue?: string;
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

/** Types qui n'acceptent pas de valeur par défaut littérale. */
const NO_DEFAULT: ReadonlySet<string> = new Set(["json", "date", "ref"]);

/**
 * Analyse la déclaration textuelle des champs.
 *
 * Grammaire : `nom:type[?][!][=defaut][:index]` · `nom:ref:Entité[?][!][:index]`
 * - `?` → nullable (sinon **NOT NULL** : une colonne nullable est une décision, pas un oubli) ;
 * - `!` → unique ;
 * - `=valeur` → valeur par défaut (`price:float=0`, `status:enum(draft,published)=draft`) ;
 * - `:index` → index simple.
 *
 * Le type `enum` porte ses valeurs entre parenthèses : `status:enum(draft,published)`.
 *
 * @param input - `"title:string! content:text? views:int=0 author:ref:User"`.
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
    // Valeur par défaut. Le `=` est cherché APRÈS la parenthèse fermante d'un
    // éventuel `enum(...)` : sans cette précaution, `status:enum(a=1,b)` couperait
    // au milieu de la liste de valeurs.
    let defaultValue: string | undefined;
    const equalsAt = spec.indexOf("=", spec.lastIndexOf(")") + 1);
    if (equalsAt >= 0) {
      defaultValue = spec.slice(equalsAt + 1);
      spec = spec.slice(0, equalsAt);
      if (defaultValue === "") {
        throw new EntityFieldError(
          `champ invalide « ${raw} » — valeur par défaut vide après « = » (ex : views:int=0)`,
        );
      }
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
      if (defaultValue !== undefined) {
        throw new EntityFieldError(
          `champ invalide « ${raw} » — une relation n'a pas de valeur par défaut`,
        );
      }
      fields.push({ name, type: "ref", target, nullable, unique, indexed });
      continue;
    }

    // Énumération : `status:enum(draft,published)`.
    const enumMatch = /^enum\((.*)\)$/u.exec(parts[1] ?? "");
    if (enumMatch) {
      const values = (enumMatch[1] ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      if (values.length === 0) {
        throw new EntityFieldError(
          `champ invalide « ${raw} » — enum sans valeur (ex : status:enum(draft,published))`,
        );
      }
      if (defaultValue !== undefined && !values.includes(defaultValue)) {
        throw new EntityFieldError(
          `champ invalide « ${raw} » — défaut « ${defaultValue} » absent des valeurs (${values.join(", ")})`,
        );
      }
      fields.push({
        name,
        type: "enum",
        values,
        nullable,
        unique,
        indexed,
        // Clé posée seulement si une valeur existe : un `defaultValue: undefined`
        // explicite change la forme de l'objet sans rien apporter.
        ...(defaultValue !== undefined ? { defaultValue } : {}),
      });
      continue;
    }

    const type = (parts[1] ?? "string") as TEntityFieldType;
    if (!(ENTITY_FIELD_TYPES as readonly string[]).includes(type)) {
      throw new EntityFieldError(
        `champ invalide « ${raw} » — type « ${type} » inconnu ; attendus : ${ENTITY_FIELD_TYPES.join(" | ")} | ref:<Entité>`,
      );
    }
    if (type === "enum") {
      throw new EntityFieldError(
        `champ invalide « ${raw} » — enum doit lister ses valeurs (ex : status:enum(draft,published))`,
      );
    }
    if (parts.length > 2) {
      throw new EntityFieldError(
        `champ invalide « ${raw} » — trop de segments (attendu nom:type[?][!][=defaut][:index])`,
      );
    }
    if (defaultValue !== undefined) {
      if (NO_DEFAULT.has(type)) {
        throw new EntityFieldError(
          `champ invalide « ${raw} » — le type « ${type} » n'accepte pas de valeur par défaut`,
        );
      }
      if (
        (type === "int" || type === "float") &&
        !Number.isFinite(Number(defaultValue))
      ) {
        throw new EntityFieldError(
          `champ invalide « ${raw} » — défaut « ${defaultValue} » n'est pas un nombre`,
        );
      }
      if (
        type === "bool" &&
        defaultValue !== "true" &&
        defaultValue !== "false"
      ) {
        throw new EntityFieldError(
          `champ invalide « ${raw} » — défaut d'un booléen : true ou false`,
        );
      }
    }
    fields.push({
      name,
      type,
      nullable,
      unique,
      indexed,
      ...(defaultValue !== undefined ? { defaultValue } : {}),
    });
  }

  return fields;
}

/** Liste de valeurs d'énumération, écrite comme option Drizzle (`{ enum: [...] }`). */
const enumOption = (values: readonly string[] = []): string =>
  `enum: [${values.map((value) => JSON.stringify(value)).join(", ")}] as const`;

/**
 * Constructeur de colonne Drizzle par (dialecte, type) — le cœur de la traduction.
 *
 * Le second argument ne sert qu'aux énumérations.
 */
const COLUMN: Record<
  TEntityDialect,
  Record<
    TEntityFieldType | "ref",
    (col: string, values?: readonly string[]) => string
  >
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
    enum: (c, v) => `text("${c}", { ${enumOption(v)} })`,
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
    // Pas de `pgEnum` : un type PostgreSQL nommé exige un `CREATE TYPE` que le
    // DDL dérivé du mode dev n'émet pas — la table ne se créerait pas au boot.
    // La contrainte vit donc au typage TS et dans le schéma Zod, qui la fait
    // respecter sur TOUS les transports (REST, socket, CLI).
    enum: (c, v) => `varchar("${c}", { length: 255, ${enumOption(v)} })`,
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
    // `mysqlEnum` existe, mais produirait un type de colonne différent des deux
    // autres dialectes pour la même déclaration Nodefony. On garde la même
    // colonne partout : porter une entité d'un moteur à l'autre ne doit rien
    // changer d'autre que le fichier de configuration.
    enum: (c, v) => `varchar("${c}", { length: 255, ${enumOption(v)} })`,
  },
};

/**
 * Ce que chaque type de champ devient, dans chaque moteur.
 *
 * Montrer la traduction plutôt que la promettre : `json` devient `jsonb` en
 * PostgreSQL et une colonne texte en SQLite, `string` un `varchar(255)` ici et un
 * `text` là. C'est une information dont dépend le choix de celui qui modélise, et
 * elle n'est déductible d'aucune documentation générique.
 *
 * Dérivé de la table de traduction elle-même : impossible que ce catalogue
 * dérive de ce que le générateur produit réellement.
 *
 * @returns un descripteur par type, avec sa colonne Drizzle par dialecte.
 */
export function describeColumnTypes(): Array<{
  type: string;
  byDialect: Record<string, string>;
}> {
  const types = [...ENTITY_FIELD_TYPES, "ref"] as const;
  return types.map((type) => ({
    type,
    byDialect: Object.fromEntries(
      ENTITY_DIALECTS.map((dialect) => [
        dialect,
        // Colonne d'exemple : le nom importe peu, la FORME est ce qu'on montre.
        COLUMN[dialect][type]("exemple", ["a", "b"]),
      ]),
    ),
  }));
}

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
  enum: "string",
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
  enum: "z.string()",
};

/**
 * Littéral TypeScript d'une valeur par défaut, selon le type du champ.
 *
 * Les nombres et booléens sont écrits nus, tout le reste est une chaîne : c'est
 * la seule interprétation possible d'un texte saisi en ligne de commande.
 */
function defaultLiteral(field: IEntityField): string {
  if (field.type === "int" || field.type === "float") {
    return String(Number(field.defaultValue));
  }
  if (field.type === "bool") return String(field.defaultValue === "true");
  return JSON.stringify(field.defaultValue);
}

/** Type TS d'un champ — union littérale pour une énumération. */
function tsTypeOf(field: IEntityField): string {
  if (field.type === "enum" && field.values) {
    return field.values.map((value) => JSON.stringify(value)).join(" | ");
  }
  return TS_TYPE[field.type];
}

/** Schéma Zod d'un champ — `z.enum` pour une énumération. */
function zodTypeOf(field: IEntityField): string {
  if (field.type === "enum" && field.values) {
    return `z.enum([${field.values.map((value) => JSON.stringify(value)).join(", ")}])`;
  }
  return ZOD_TYPE[field.type];
}

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
  /**
   * Troisième argument de la table Drizzle — les index déclarés par `:index`.
   *
   * Chaîne vide quand aucun index n'est demandé : la table garde alors sa forme
   * à deux arguments.
   */
  tableExtras: string;
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
    /**
     * Nom de la table — sert à préfixer les noms d'index.
     *
     * Requis : en PostgreSQL comme en SQLite, un nom d'index est unique pour
     * TOUTE la base. Deux entités qui indexeraient chacune un `title` se
     * marcheraient dessus au premier boot.
     */
    table: string;
  },
): IEntityCodegen {
  const { dialect, id, timestamps, softDelete, table } = options;
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
    let col = COLUMN[dialect][field.type](field.name, field.values);
    if (!field.nullable) col += ".notNull()";
    if (field.unique) col += ".unique()";
    if (field.defaultValue !== undefined) {
      // `$defaultFn` (côté JS) et non `.default()` (côté SQL) : le DDL dérivé du
      // mode dev n'émet pas les `DEFAULT`, une valeur posée en base ne
      // s'appliquerait donc jamais. Même raison que pour les horodatages.
      col += `.$defaultFn(() => ${defaultLiteral(field)})`;
    }
    columns.push(`${field.name}: ${col},`);

    const optional = field.nullable ? " | null" : "";
    rowProps.push(`${field.name}: ${tsTypeOf(field)}${optional};`);

    let zod = zodTypeOf(field);
    if (field.nullable) zod += ".nullable().optional()";
    if (field.defaultValue !== undefined) {
      zod += `.default(${defaultLiteral(field)})`;
    }
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

  // Index déclarés par `:index`. Ils vivent dans le TROISIÈME argument de la
  // table — une colonne ne peut pas se déclarer indexée toute seule chez Drizzle.
  const indexed = fields.filter((field) => field.indexed);
  let tableExtras = "";
  if (indexed.length > 0) {
    imports.add("index");
    const lines = indexed
      .map(
        (field) =>
          `    index("${table}_${field.name}_idx").on(t.${field.name}),`,
      )
      .join("\n");
    tableExtras = `, (t) => [\n${lines}\n  ]`;
  }

  const { fn, module } = TABLE_FN[dialect];
  imports.add(fn);

  // Saut de ligne FINAL obligatoire : eta supprime le newline qui suit une
  // interpolation, donc la fermeture (`});`) remonterait sur la dernière ligne rendue.
  // Anodin tant qu'elle finit par une virgule (`…notNull(),});` reste valide) — mais
  // dès qu'un champ de RELATION est en dernier, son commentaire de fin de ligne avale
  // la fermeture : `…, // → User.id …});` ne compile pas. Vécu en appliquant un vrai
  // schéma (WordPress), invisible sur tous les exemples jusque-là.
  const block = (lines: string[]): string => `${lines.join("\n  ")}\n`;

  return {
    columns: block(columns),
    drizzleImport: `import { ${[...imports].sort().join(", ")} } from "${module}";`,
    tableFn: fn,
    rowProps: block(rowProps),
    zodProps: block(zodProps),
    tableExtras,
    needsNodefony: id !== "serial",
    idType: pk.tsType,
  };
}
