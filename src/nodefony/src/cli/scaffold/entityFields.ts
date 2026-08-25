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
  "char",
  "decimal",
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
   * Longueur déclarée d'une chaîne (`title:string(200)`, `country:char(2)`).
   *
   * Absente pour `string`, la colonne retombe sur 255 — la valeur par défaut
   * historique. Un schéma réel dimensionne ses colonnes (onze longueurs
   * distinctes chez Umami) : la place perdue se paie en octets par ligne, et
   * l'absence de borne laisse passer des valeurs qu'aucune règle ne veut.
   */
  length?: number;
  /** Chiffres significatifs d'un décimal exact (`price:decimal(12,2)` → 12). */
  precision?: number;
  /** Chiffres après la virgule d'un décimal exact (`price:decimal(12,2)` → 2). */
  scale?: number;
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

/**
 * Casses de nom de colonne SQL proposées — la propriété TypeScript ne bouge jamais.
 *
 * `camel` reproduit la propriété telle quelle (défaut historique) ; `snake` émet
 * `site_id` là où la propriété reste `siteId`. Drizzle porte nativement cette
 * dissociation — le premier argument d'un constructeur de colonne EST le nom SQL.
 *
 * Une seule option couvre l'écrasante majorité des schémas existants : sur les 134
 * renommages qu'exige le schéma d'Umami, **115 sont ce passage mécanique** au
 * `snake_case`. Les nommer un par un aurait demandé un dictionnaire ; ils tiennent
 * dans un choix.
 */
export const COLUMN_CASES = ["camel", "snake"] as const;
export type TColumnCase = (typeof COLUMN_CASES)[number];

/** `BlogPost` / `blog-post` / `siteId` → `blog_post` / `site_id`. */
export function toSnakeCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .replaceAll("-", "_")
    .toLowerCase();
}

/**
 * Nom SQL d'une colonne, dérivé de sa propriété TypeScript.
 *
 * @param property - nom de la propriété (`siteId`).
 * @param columnCase - casse demandée ; `camel` rend la propriété inchangée.
 */
export function sqlColumn(property: string, columnCase: TColumnCase): string {
  return columnCase === "snake" ? toSnakeCase(property) : property;
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
      // Une colonne de relation est INDEXÉE d'office. C'est par elle que passent
      // le `?include=` (une requête `IN (…)` par relation) et toute jointure
      // écrite ensuite : sans index, chacune balaie la table entière, et le
      // ralentissement n'apparaît qu'une fois les données arrivées — jamais sur
      // les dix lignes de développement. La contrainte d'intégrité (FOREIGN KEY)
      // est un sujet DISTINCT, traité au DDL ; l'index, lui, sert à chaque
      // requête et ne coûte qu'à l'écriture. `unique` s'en passe : il en pose
      // déjà un (relation 1-1).
      fields.push({
        name,
        type: "ref",
        target,
        nullable,
        unique,
        indexed: indexed || !unique,
      });
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

    // Tailles de colonne : `string(200)`, `char(2)`, `decimal(12,2)`. Meme forme
    // que l'énumération, parce que c'est la même idée — un type qui se précise.
    const spec2 = parts[1] ?? "string";
    let length: number | undefined;
    let precision: number | undefined;
    let scale: number | undefined;
    const sized = /^(string|char)\((\d+)\)$/u.exec(spec2);
    const decimalMatch = /^decimal\((\d+),\s*(\d+)\)$/u.exec(spec2);
    if (sized) {
      length = Number(sized[2]);
      if (length < 1) {
        throw new EntityFieldError(
          `champ invalide « ${raw} » — longueur nulle (ex : title:string(200), country:char(2))`,
        );
      }
      parts[1] = sized[1] as string;
    } else if (decimalMatch) {
      precision = Number(decimalMatch[1]);
      scale = Number(decimalMatch[2]);
      if (precision < 1 || scale > precision) {
        throw new EntityFieldError(
          `champ invalide « ${raw} » — décimal incohérent : l'échelle (${scale}) ne peut dépasser la précision (${precision}), ex : price:decimal(12,2)`,
        );
      }
      parts[1] = "decimal";
    } else if (spec2 === "char" || spec2 === "decimal") {
      // Ces deux types NE SE DEVINENT PAS : un `char` sans longueur vaudrait
      // `char(1)` chez la plupart des moteurs — presque jamais l'intention —, et
      // un décimal sans précision perd la garantie même qu'on venait chercher.
      throw new EntityFieldError(
        spec2 === "char"
          ? `champ invalide « ${raw} » — char doit déclarer sa longueur (ex : country:char(2))`
          : `champ invalide « ${raw} » — décimal doit déclarer sa précision et son échelle (ex : price:decimal(12,2))`,
      );
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
      ...(length !== undefined ? { length } : {}),
      ...(precision !== undefined ? { precision, scale } : {}),
      ...(defaultValue !== undefined ? { defaultValue } : {}),
    });
  }

  return fields;
}

/**
 * Index portant sur PLUSIEURS colonnes, déclaré au niveau de la table.
 *
 * Un index composite n'appartient à aucune colonne en particulier — il décrit une
 * façon d'interroger la table (« les événements de ce site, du plus récent au plus
 * ancien »). C'est pourquoi il se déclare à part de la grammaire de champs, et non
 * par un modificateur : il n'y aurait pas de champ légitime où l'accrocher.
 *
 * L'ORDRE des colonnes est significatif et se conserve : un index sur `(site, date)`
 * sert les requêtes qui filtrent sur le site, celles qui ne filtrent que sur la date
 * ne le verront pas.
 */
export interface IEntityIndex {
  /** Colonnes indexées, dans l'ordre déclaré. */
  columns: string[];
  /** `true` pour une contrainte d'unicité portant sur la combinaison. */
  unique: boolean;
}

/**
 * Colonnes qu'une entité possède SANS qu'un champ les déclare.
 *
 * Elles sont indexables comme les autres — un index composite sur la date de
 * création est même le cas le plus courant sur une table d'événements — mais elles
 * n'apparaissent pas dans la liste des champs analysés, d'où cette table.
 */
function implicitColumns(options: {
  timestamps: boolean;
  softDelete: boolean;
}): string[] {
  const names = ["id"];
  if (options.timestamps) names.push("createdAt", "updatedAt");
  if (options.softDelete) names.push("deletedAt");
  return names;
}

/**
 * Analyse les index de table déclarés par `--index` / `--unique`.
 *
 * Chaque valeur est une liste de colonnes séparées par des virgules
 * (`"websiteId,createdAt"`). Toute colonne citée doit exister : sans ce contrôle, on
 * écrirait une entité qui ne compile pas, et l'erreur tomberait chez l'utilisateur
 * sous la forme d'une propriété inconnue — loin de la commande qui l'a causée.
 *
 * @param specs - valeurs brutes des options, dans l'ordre de la ligne de commande.
 * @param fields - champs déjà analysés, qui fournissent les noms légitimes.
 * @param options - présence des colonnes implicites (horodatages, suppression douce).
 * @param unique - `true` quand ces valeurs viennent de `--unique`.
 * @returns les index analysés, doublons retirés.
 * @throws {EntityFieldError} colonne inconnue, liste vide, ou colonne répétée.
 */
export function parseEntityIndexes(
  specs: readonly string[],
  fields: readonly IEntityField[],
  options: { timestamps: boolean; softDelete: boolean },
  unique = false,
): IEntityIndex[] {
  const known = new Set([
    ...implicitColumns(options),
    ...fields.map((f) => f.name),
  ]);
  const out: IEntityIndex[] = [];
  const seen = new Set<string>();

  for (const raw of specs) {
    const columns = raw
      .split(",")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    if (columns.length === 0) {
      throw new EntityFieldError(
        `index « ${raw} » : aucune colonne — attendu une liste séparée par des virgules, ex. --index "websiteId,createdAt"`,
      );
    }
    for (const column of columns) {
      if (!known.has(column)) {
        throw new EntityFieldError(
          `index « ${raw} » : la colonne « ${column} » n'existe pas sur cette entité — ` +
            `colonnes disponibles : ${[...known].join(", ")}`,
        );
      }
    }
    // Une colonne répétée dans le même index ne veut rien dire, et le moteur
    // l'accepterait sans broncher en créant un index inutile.
    const duplicate = columns.find((c, i) => columns.indexOf(c) !== i);
    if (duplicate !== undefined) {
      throw new EntityFieldError(
        `index « ${raw} » : la colonne « ${duplicate} » est citée deux fois`,
      );
    }
    // Deux déclarations identiques produiraient deux fois le même nom d'index, et
    // la base refuserait la seconde au premier démarrage.
    const key = `${unique ? "u" : "i"}:${columns.join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ columns, unique });
  }
  return out;
}

/** Liste de valeurs d'énumération, écrite comme option Drizzle (`{ enum: [...] }`). */
const enumOption = (values: readonly string[] = []): string =>
  `enum: [${values.map((value) => JSON.stringify(value)).join(", ")}] as const`;

/** Taille déclarée d'une colonne, telle que l'analyse l'a lue. */
interface IColumnSize {
  length?: number;
  precision?: number;
  scale?: number;
}

/** Longueur d'une chaîne, avec le repli historique quand rien n'est déclaré. */
const len = (size?: IColumnSize): number => size?.length ?? 255;

/**
 * Option de précision d'un décimal, écrite comme Drizzle l'attend.
 *
 * Sans précision déclarée, on n'écrit RIEN plutôt qu'un défaut inventé : les
 * moteurs n'ont pas la même idée d'un `numeric` nu, et choisir à leur place
 * masquerait ce désaccord au lieu de le laisser paraître.
 */
const decimalOption = (size?: IColumnSize): string =>
  size?.precision === undefined
    ? ""
    : `, { precision: ${size.precision}, scale: ${size.scale ?? 0} }`;

/**
 * Constructeur de colonne Drizzle par (dialecte, type) — le cœur de la traduction.
 *
 * Le second argument ne sert qu'aux énumérations, le troisième aux tailles
 * (longueur d'une chaîne, précision d'un décimal).
 *
 * Les trois moteurs n'offrent pas le même vocabulaire, et la table le dit au lieu
 * de le contourner : SQLite ignore `varchar` et `char` — toute chaîne y est un
 * `text`, la longueur n'y est de toute façon pas appliquée —, et MySQL n'expose
 * pas `numeric`, dont `decimal` est l'exact équivalent.
 */
const COLUMN: Record<
  TEntityDialect,
  Record<
    TEntityFieldType | "ref",
    (col: string, values?: readonly string[], size?: IColumnSize) => string
  >
> = {
  sqlite: {
    string: (c) => `text("${c}")`,
    // SQLite n'applique aucune contrainte de longueur : une chaîne bornée y est
    // un `text` comme les autres. La borne reste tenue par le schéma Zod, donc
    // sur tous les transports — c'est la seule à mordre ici.
    char: (c) => `text("${c}")`,
    // `numeric` en mode chaîne : la précision décimale ne survit pas à un
    // flottant, et c'est précisément ce qu'on venait chercher.
    decimal: (c) => `numeric("${c}")`,
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
    string: (c, _v, s) => `varchar("${c}", { length: ${len(s)} })`,
    char: (c, _v, s) => `char("${c}", { length: ${len(s)} })`,
    decimal: (c, _v, s) => `numeric("${c}"${decimalOption(s)})`,
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
    string: (c, _v, s) => `varchar("${c}", { length: ${len(s)} })`,
    char: (c, _v, s) => `char("${c}", { length: ${len(s)} })`,
    // MySQL n'expose pas `numeric` chez Drizzle : `decimal` en est l'équivalent
    // exact côté moteur, le nom seul diffère.
    decimal: (c, _v, s) => `decimal("${c}"${decimalOption(s)})`,
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
        // Les tailles sont fournies pour que `char` et `decimal` se montrent tels
        // qu'on les écrit vraiment — un `char` sans longueur n'existe pas.
        COLUMN[dialect][type]("exemple", ["a", "b"], {
          ...(type === "char" ? { length: 2 } : {}),
          ...(type === "decimal" ? { precision: 12, scale: 2 } : {}),
        }),
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
  char: "string",
  // Un décimal exact transite en CHAÎNE, dans les trois moteurs : le convertir en
  // nombre JavaScript lui ferait perdre en route la précision qu'on est venu
  // chercher (0.1 + 0.2 ne fait pas 0.3 en virgule flottante).
  decimal: "string",
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
  char: "z.string()",
  decimal: "z.string()",
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

/**
 * Schéma Zod d'un champ — `z.enum` pour une énumération, borné pour une taille.
 *
 * C'est ici que les tailles deviennent une garantie RÉELLE. La colonne, elle, ne
 * protège pas partout : SQLite n'applique aucune longueur, et une valeur trop
 * longue y entrerait sans un mot pour ressortir tronquée le jour d'une migration
 * vers PostgreSQL. Le schéma, lui, s'applique sur tous les transports — REST,
 * socket, ligne de commande — et dans les trois moteurs.
 */
function zodTypeOf(field: IEntityField): string {
  if (field.type === "enum" && field.values) {
    return `z.enum([${field.values.map((value) => JSON.stringify(value)).join(", ")}])`;
  }
  if (field.type === "string") {
    return `z.string().min(1).max(${field.length ?? 255})`;
  }
  if (field.type === "char") {
    // Longueur EXACTE : un `char(2)` qui recevrait une seule lettre serait
    // complété par des espaces côté moteur, et la comparaison suivante
    // échouerait sans raison visible.
    return field.length === undefined
      ? "z.string()"
      : `z.string().length(${field.length})`;
  }
  if (field.type === "decimal") {
    // Le message porte la précision : c'est la seule trace qu'en verra l'appelant
    // d'une API. Pas de commentaire en fin de ligne ici — il avalerait la virgule
    // suivante du schéma rendu.
    const hint =
      field.precision === undefined
        ? "d\u00e9cimal attendu"
        : `d\u00e9cimal attendu (${field.precision} chiffres dont ${field.scale ?? 0} apr\u00e8s la virgule)`;
    return `z.string().regex(/^-?\\d+(\\.\\d+)?$/, ${JSON.stringify(hint)})`;
  }
  return ZOD_TYPE[field.type];
}

/**
 * Colonne de clé primaire, selon la stratégie retenue.
 *
 * La PROPRIÉTÉ reste `id` en toutes circonstances : le service CRUD, le controller,
 * le tri par défaut et les tests générés la nomment ainsi, et un schéma existant
 * n'a aucune raison d'imposer sa convention au code TypeScript. Seule la COLONNE
 * SQL suit le nom demandé — c'est elle qui doit épouser la table déjà en place
 * (`website_id` chez Umami, `session_id`, `user_id`… : 18 des 134 renommages).
 *
 * @param column - nom SQL de la colonne (`id` par défaut).
 */
function primaryKeyColumn(
  dialect: TEntityDialect,
  id: TEntityIdKind,
  column: string,
): { line: string; tsType: string; imports: string[] } {
  if (id === "serial") {
    const line =
      dialect === "sqlite"
        ? `id: integer("${column}").primaryKey({ autoIncrement: true }),`
        : dialect === "postgres"
          ? `id: serial("${column}").primaryKey(),`
          : `id: int("${column}").autoincrement().primaryKey(),`;
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
  const col = COLUMN[dialect].uuid(column);
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

/**
 * Colonne qui PORTE une référence — le pendant exact de {@link primaryKeyColumn}.
 *
 * Une clé étrangère doit avoir le TYPE de la clé qu'elle désigne, et c'est la
 * raison d'être de cette fonction : la référence était jusqu'ici une colonne
 * texte, quelle que soit la clé visée. En PostgreSQL, comparer un `text` à un
 * `uuid` échoue — « operator does not exist: text = uuid ». La jointure que cette
 * colonne existe précisément pour servir refusait donc de s'exécuter, et le
 * `?include=` avec elle. En SQLite, moteur du développement, la même comparaison
 * passe sans broncher : la panne n'attendait que le premier vrai serveur.
 *
 * La stratégie retenue est celle de l'entité qu'on crée. C'est le seul indice
 * dont dispose le générateur — il ne lit pas l'entité visée —, et il est juste
 * tant qu'une application ne mélange pas ses styles d'identifiant, ce qui est le
 * cas ordinaire. Une cible d'un autre style se corrige dans la table générée :
 * c'est du Drizzle natif.
 *
 * Aucune contrainte `REFERENCES` n'est émise — même raison qu'ailleurs : le DDL
 * dérivé du mode développement ne l'appliquerait pas, et une promesse non tenue
 * coûte plus cher qu'un commentaire honnête.
 *
 * @param dialect - moteur visé.
 * @param id - stratégie de clé primaire de l'entité en cours.
 * @param col - nom de la colonne.
 * @returns l'expression Drizzle, son type TypeScript et l'import nécessaire.
 */
function foreignKeyColumn(
  dialect: TEntityDialect,
  id: TEntityIdKind,
  col: string,
): { expr: string; tsType: string; imports: string[] } {
  if (id === "serial") {
    // Un entier ORDINAIRE : la table cible auto-incrémente sa clé, celle qui la
    // désigne se contente de la recopier.
    const expr = dialect === "mysql" ? `int("${col}")` : `integer("${col}")`;
    return {
      expr,
      tsType: "number",
      imports: [dialect === "mysql" ? "int" : "integer"],
    };
  }
  return {
    expr: COLUMN[dialect].uuid(col),
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
    /**
     * Index de TABLE, portant une ou plusieurs colonnes ({@link parseEntityIndexes}).
     *
     * Fusionnés avec ceux que les champs déclarent par `:index` — un même jeu de
     * colonnes n'est émis qu'une fois, quelle que soit la voie empruntée.
     */
    indexes?: IEntityIndex[];
    /**
     * Casse des noms de COLONNES SQL — les propriétés TypeScript n'en dépendent pas.
     *
     * Défaut `camel` : le comportement historique, où la colonne porte le nom de la
     * propriété. Une application existante impose presque toujours `snake`.
     */
    columnCase?: TColumnCase;
    /**
     * Nom SQL de la colonne de clé primaire (défaut `id`).
     *
     * La propriété reste `id` quoi qu'il arrive — cf {@link primaryKeyColumn}.
     */
    idName?: string;
  },
): IEntityCodegen {
  const { dialect, id, timestamps, softDelete, table } = options;
  const columnCase: TColumnCase = options.columnCase ?? "camel";
  const idName = options.idName ?? "id";
  /** Nom SQL d'une propriété, dans la casse retenue. */
  const sql = (property: string): string => sqlColumn(property, columnCase);
  const imports = new Set<string>();
  const columns: string[] = [];
  const rowProps: string[] = [];
  const zodProps: string[] = [];

  const pk = primaryKeyColumn(dialect, id, idName);
  pk.imports.forEach((i) => imports.add(i));
  columns.push(pk.line);
  rowProps.push(`id: ${pk.tsType};`);

  for (const field of fields) {
    // Une référence emprunte le type de la CLÉ qu'elle désigne, pas celui d'une
    // chaîne quelconque : c'est la condition pour que la jointure s'exécute.
    const column = sql(field.name);
    const fk =
      field.type === "ref" ? foreignKeyColumn(dialect, id, column) : undefined;
    if (fk) {
      fk.imports.forEach((i) => imports.add(i));
    } else {
      imports.add(columnImport(dialect, field.type));
    }
    let col =
      fk?.expr ??
      COLUMN[dialect][field.type](column, field.values, {
        length: field.length,
        precision: field.precision,
        scale: field.scale,
      });
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
    rowProps.push(
      `${field.name}: ${fk?.tsType ?? tsTypeOf(field)}${optional};`,
    );

    // Le schéma suit le même type : une clé auto-incrémentée est un NOMBRE, et
    // le valider comme une chaîne rejetterait la valeur que la base rend.
    let zod = fk?.tsType === "number" ? "z.number().int()" : zodTypeOf(field);
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

  // Index de table. Ils vivent dans le TROISIÈME argument — une colonne ne peut pas
  // se déclarer indexée toute seule chez Drizzle. Deux sources se rejoignent ici :
  // le modificateur `:index` d'un champ, et les index de TABLE (`--index`,
  // `--unique`), seuls capables de porter plusieurs colonnes.
  //
  // La fusion se fait sur le NOM d'index, qui dérive des colonnes : déclarer
  // `email:string:index` et `--index "email"` ne produit qu'un index, là où deux
  // lignes identiques auraient fait échouer la création de la table au démarrage.
  const declared: IEntityIndex[] = [
    ...fields
      .filter((field) => field.indexed)
      .map((field) => ({ columns: [field.name], unique: false })),
    ...(options.indexes ?? []),
  ];
  let tableExtras = "";
  if (declared.length > 0) {
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const entry of declared) {
      const suffix = entry.unique ? "key" : "idx";
      // Le nom d'index est un objet SQL : il suit la casse des COLONNES, pas celle
      // des propriétés. Les colonnes visées, elles, restent nommées côté Drizzle
      // (`t.siteId`) — c'est du TypeScript, l'ORM fait la traduction.
      const name = `${table}_${entry.columns.map(sql).join("_")}_${suffix}`;
      if (seen.has(name)) continue;
      seen.add(name);
      const fn = entry.unique ? "uniqueIndex" : "index";
      imports.add(fn);
      const cols = entry.columns.map((c) => `t.${c}`).join(", ");
      lines.push(`    ${fn}("${name}").on(${cols}),`);
    }
    tableExtras = `, (t) => [\n${lines.join("\n")}\n  ]`;
  }

  const { fn, module } = TABLE_FN[dialect];
  imports.add(fn);

  // Saut de ligne FINAL obligatoire : eta supprime le newline qui suit une
  // interpolation, donc la fermeture (`});`) remonterait sur la dernière ligne rendue.
  // Anodin tant qu'elle finit par une virgule (`…notNull(),});` reste valide) — mais
  // dès qu'un champ de RELATION est en dernier, son commentaire de fin de ligne avale
  // la fermeture : `…, // → User.id …});` ne compile pas. Vécu en appliquant un vrai
  // schéma (WordPress), invisible sur tous les exemples jusque-là.
  // Pas de saut de ligne FINAL : c'est la ligne du gabarit qui le porte
  // (`  <%= it.rowProps %>` suivi de sa propre fin de ligne). Il en était ajouté
  // un ici, et le moteur l'avalait — les deux fautes se compensaient. Depuis que
  // le moteur rend ce que le gabarit écrit, la valeur ne doit plus emporter la
  // ponctuation de son point d'insertion : sinon une ligne vide s'ouvre juste
  // avant l'accolade fermante de chaque interface et de chaque schéma générés.
  const block = (lines: string[]): string => lines.join("\n  ");
  // La variante QUI FERME sa ligne, pour le seul point d'insertion où le gabarit
  // enchaîne sur la MÊME ligne : `  <%= it.columns %>}<%= it.tableExtras %>);`.
  // Deux helpers plutôt qu'un, parce que la ponctuation appartient au point
  // d'insertion — la déduire du contenu était exactement l'erreur précédente.
  const blockLn = (lines: string[]): string => `${block(lines)}\n`;

  return {
    columns: blockLn(columns),
    drizzleImport: `import { ${[...imports].sort().join(", ")} } from "${module}";`,
    tableFn: fn,
    rowProps: block(rowProps),
    zodProps: block(zodProps),
    tableExtras,
    needsNodefony: id !== "serial",
    idType: pk.tsType,
  };
}
