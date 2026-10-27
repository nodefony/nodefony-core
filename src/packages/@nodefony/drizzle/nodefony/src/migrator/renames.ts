import type { SqlDialect } from "../../config/config";

/**
 * Les renommages DÉCLARÉS — la réponse « renamed » donnée d'avance.
 *
 * ## Le trou que ce module ferme
 *
 * Un générateur de diff ne distingue pas un renommage (les données suivent)
 * d'une suppression suivie d'un ajout (les données disparaissent) : c'est une
 * intention, pas une différence de schéma. `drizzle-kit` le sait, et POSE la
 * question — mais seulement à un terminal. Sans terminal (intégration
 * continue, agent, script de déploiement), la génération s'arrêtait, et le
 * seul geste non interactif restant écrivait `DROP COLUMN` + `ADD COLUMN`.
 * Aucune chaîne automatisée ne pouvait donc renommer une colonne sans perte.
 *
 * ## Comment la réponse est donnée sans terminal
 *
 * L'outil compare le schéma courant au DERNIER instantané du dossier. On lui
 * fait lire une copie de cet instantané où les noms déclarés sont DÉJÀ
 * renommés : il n'y a plus d'ambiguïté, il n'écrit que le reste de l'écart. Le
 * renommage lui-même est émis par nous, en tête de migration, dans la forme
 * exacte que l'outil aurait écrite. L'instantané d'origine est restitué octet
 * pour octet : ce fichier est versionné, et il décrit ce que les bases ont
 * déjà reçu.
 *
 * Effet de bord voulu : un renommage accompagné d'un changement de type est
 * écrit EN ENTIER — l'outil, lui, oubliait le type (drizzle-orm#3826), parce
 * qu'il ne voit plus le renommage et compare donc deux colonnes de même nom.
 *
 * Module PUR (aucune I/O) : la commande lit et écrit, ce module décide.
 */

/** Un renommage de table : `ancienne=nouvelle`. */
export interface ITableRename {
  from: string;
  to: string;
}

/**
 * Un renommage de colonne : `table.ancienne=nouvelle`.
 *
 * `table` est le nom ACTUEL de la table — celui que porte l'entité. Une table
 * renommée dans la même migration se désigne donc par son nouveau nom.
 */
export interface IColumnRename {
  table: string;
  from: string;
  to: string;
}

/** Tous les renommages d'une génération. */
export interface IRenamePlan {
  tables: readonly ITableRename[];
  columns: readonly IColumnRename[];
}

/** Verdict de la lecture des renommages demandés. */
export type IRenameParse =
  { ok: true; plan: IRenamePlan } | { ok: false; spec: string; reason: string };

/** L'instantané réécrit, et ce qu'il faut ajouter à la migration. */
export interface IRenamedSnapshot {
  /** L'instantané tel que l'outil doit le lire — une COPIE, jamais l'original. */
  doc: Record<string, unknown>;
  /** Les instructions de renommage, dans l'ordre (tables, puis colonnes). */
  statements: string[];
  /** Le bloc `_meta` que l'outil écrit après une réponse « renamed ». */
  meta: { tables: Record<string, string>; columns: Record<string, string> };
  /** Ce qui ne correspond pas à l'instantané — vide si tout s'applique. */
  problems: string[];
}

/** Un identifiant SQL nu : ce que les entités du kit savent nommer. */
const IDENT = /^[A-Za-z_][A-Za-z0-9_$]*$/;

/**
 * Lit les renommages passés à `--rename`.
 *
 * @param specs - les valeurs reçues, `table=nouvelle` ou `table.colonne=nouvelle`.
 * @returns le plan, ou le premier renommage refusé et sa raison.
 */
export function parseRenames(specs: readonly string[]): IRenameParse {
  const tables: ITableRename[] = [];
  const columns: IColumnRename[] = [];
  for (const spec of specs) {
    const eq = spec.indexOf("=");
    if (eq <= 0 || eq === spec.length - 1) {
      return refused(
        spec,
        "attendu « table=nouvelle » ou « table.colonne=nouvelle »",
      );
    }
    const left = spec.slice(0, eq).trim();
    const to = spec.slice(eq + 1).trim();
    const parts = left.split(".");
    if (parts.length > 2 || !parts.every((p) => IDENT.test(p))) {
      return refused(
        spec,
        `« ${left} » n'est ni une table ni « table.colonne »`,
      );
    }
    if (!IDENT.test(to)) {
      return refused(
        spec,
        `« ${to} » n'est pas un nom simple — la partie droite ne porte que le NOUVEAU nom, sans table`,
      );
    }
    const [table = "", column] = parts;
    if (column === undefined) {
      if (table === to) {
        return refused(spec, "l'ancien et le nouveau nom sont identiques");
      }
      tables.push({ from: table, to });
    } else {
      if (column === to) {
        return refused(spec, "l'ancien et le nouveau nom sont identiques");
      }
      columns.push({ table, from: column, to });
    }
  }
  const conflict =
    duplicate(
      tables.map((t) => t.from),
      "la table",
    ) ??
    duplicate(
      tables.map((t) => t.to),
      "le nouveau nom de table",
    ) ??
    duplicate(
      columns.map((c) => `${c.table}.${c.from}`),
      "la colonne",
    ) ??
    duplicate(
      columns.map((c) => `${c.table}.${c.to}`),
      "le nouveau nom de colonne",
    );
  if (conflict !== null) {
    return refused(conflict.spec, conflict.reason);
  }
  // Une chaîne (a=b puis b=c) n'a pas d'ordre évident : deux migrations.
  const targets = new Set(tables.map((t) => t.to));
  const chained = tables.find((t) => targets.has(t.from));
  if (chained !== undefined) {
    return refused(
      `${chained.from}=${chained.to}`,
      `« ${chained.from} » est aussi le NOUVEAU nom d'une autre table — renommer en deux migrations`,
    );
  }
  return { ok: true, plan: { tables, columns } };
}

/** Les renommages d'un plan, tels qu'on les cite (`table.ancienne → nouvelle`). */
export function describeRenames(plan: IRenamePlan): string[] {
  return [
    ...plan.tables.map((t) => `${t.from} → ${t.to}`),
    ...plan.columns.map((c) => `${c.table}.${c.from} → ${c.to}`),
  ];
}

/** Le plan ne demande-t-il rien ? */
export function isEmptyPlan(plan: IRenamePlan): boolean {
  return plan.tables.length === 0 && plan.columns.length === 0;
}

/**
 * Applique les renommages à une COPIE de l'instantané précédent, et rend les
 * instructions qui feront la même chose à la base.
 *
 * Les NOMS de contraintes et d'index ne sont pas touchés : la base garde les
 * siens après un renommage, et l'outil doit voir la vérité de la base — un nom
 * dérivé du nom de colonne qui change se diffe alors normalement (retrait puis
 * ajout de la contrainte, sans perte).
 *
 * @param source - l'instantané lu sur le disque (non modifié).
 * @param plan - les renommages déclarés.
 * @param dialect - le moteur, pour la forme des instructions.
 * @returns la copie réécrite, les instructions, le `_meta`, et ce qui ne va pas.
 */
export function applyRenames(
  source: unknown,
  plan: IRenamePlan,
  dialect: SqlDialect,
): IRenamedSnapshot {
  const doc: Record<string, unknown> = isRecord(source)
    ? structuredClone(source)
    : {};
  const tables = isRecord(doc.tables) ? doc.tables : {};
  // MySQL : l'outil nomme la clé primaire `<table>_<colonnes>`, et le moteur
  // l'appelle toujours `PRIMARY`. Ce nom n'existe donc QUE dans l'instantané —
  // mais s'il garde l'ancien nom de table, l'outil y lit une clé différente et
  // écrit `DROP PRIMARY KEY`, refusé sur une colonne auto-incrémentée. On
  // relève les clés dérivées AVANT les renommages pour les recalculer après.
  const derivedKeys = dialect === "mysql" ? derivedPrimaryKeys(tables) : [];
  const problems: string[] = [];
  const statements: string[] = [];
  const meta: IRenamedSnapshot["meta"] = { tables: {}, columns: {} };

  for (const { from, to } of plan.tables) {
    const found = findTable(tables, from);
    if (found === null) {
      problems.push(`table « ${from} » : absente du dernier instantané`);
      continue;
    }
    if (findTable(tables, to) !== null) {
      problems.push(`table « ${to} » : existe déjà dans le dernier instantané`);
      continue;
    }
    const [key, table] = found;
    const schema = typeof table.schema === "string" ? table.schema : "";
    delete tables[key];
    table.name = to;
    tables[`${key.slice(0, key.length - from.length)}${to}`] = table;
    for (const other of Object.values(tables)) {
      for (const fk of recordValues(
        isRecord(other) ? other.foreignKeys : undefined,
      )) {
        if (fk.tableFrom === from) fk.tableFrom = to;
        if (fk.tableTo === from) fk.tableTo = to;
      }
    }
    statements.push(renameTableSql(dialect, schema, from, to));
    meta.tables[renameKey(schema, from)] = renameKey(schema, to);
  }

  for (const { table: name, from, to } of plan.columns) {
    const found = findTable(tables, name);
    if (found === null) {
      problems.push(
        `colonne « ${name}.${from} » : table « ${name} » absente du dernier instantané`,
      );
      continue;
    }
    const table = found[1];
    const columns = isRecord(table.columns) ? table.columns : {};
    if (!Object.hasOwn(columns, from)) {
      problems.push(
        `colonne « ${name}.${from} » : absente du dernier instantané`,
      );
      continue;
    }
    if (Object.hasOwn(columns, to)) {
      problems.push(
        `colonne « ${name}.${to} » : existe déjà dans le dernier instantané`,
      );
      continue;
    }
    // L'ordre des colonnes est conservé : c'est celui des recopies SQLite.
    const renamed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(columns)) {
      if (key === from && isRecord(value)) {
        value.name = to;
        renamed[to] = value;
      } else {
        renamed[key] = value;
      }
    }
    table.columns = renamed;
    for (const index of recordValues(table.indexes)) renameIn(index, from, to);
    for (const key of recordValues(table.compositePrimaryKeys))
      renameIn(key, from, to);
    for (const unique of recordValues(table.uniqueConstraints))
      renameIn(unique, from, to);
    for (const fk of recordValues(table.foreignKeys)) {
      if (Array.isArray(fk.columnsFrom)) {
        fk.columnsFrom = fk.columnsFrom.map((c: unknown) =>
          c === from ? to : c,
        );
      }
    }
    for (const other of Object.values(tables)) {
      for (const fk of recordValues(
        isRecord(other) ? other.foreignKeys : undefined,
      )) {
        if (fk.tableTo === name && Array.isArray(fk.columnsTo)) {
          fk.columnsTo = fk.columnsTo.map((c: unknown) =>
            c === from ? to : c,
          );
        }
      }
    }
    const schema = typeof table.schema === "string" ? table.schema : "";
    statements.push(renameColumnSql(dialect, schema, name, from, to));
    meta.columns[renameKey(schema, name, from)] = renameKey(schema, name, to);
  }
  for (const { table, keys, entry } of derivedKeys) {
    const columns = Array.isArray(entry.columns) ? entry.columns : [];
    const name = `${String(table.name)}_${columns.join("_")}`;
    for (const [k, v] of Object.entries(keys)) {
      if (v === entry) delete keys[k];
    }
    entry.name = name;
    keys[name] = entry;
  }
  return { doc, statements, meta, problems };
}

/**
 * Les renommages dont la CIBLE manque au schéma écrit par l'outil.
 *
 * Contrôle d'après génération : `--rename a.x=y` alors qu'aucune entité ne
 * déclare `y` produirait une migration qui renomme puis SUPPRIME — le pire des
 * deux mondes, sous l'apparence d'une réponse donnée.
 *
 * @param written - l'instantané que l'outil vient d'écrire.
 * @param plan - les renommages déclarés.
 * @returns un message par cible absente.
 */
export function missingRenameTargets(
  written: unknown,
  plan: IRenamePlan,
): string[] {
  const tables =
    isRecord(written) && isRecord(written.tables) ? written.tables : {};
  const missing: string[] = [];
  for (const { to } of plan.tables) {
    if (findTable(tables, to) === null) {
      missing.push(`table « ${to} » : aucune entité ne la déclare`);
    }
  }
  for (const { table, to } of plan.columns) {
    const found = findTable(tables, table);
    const columns =
      found !== null && isRecord(found[1].columns) ? found[1].columns : {};
    if (!Object.hasOwn(columns, to)) {
      missing.push(`colonne « ${table}.${to} » : aucune entité ne la déclare`);
    }
  }
  return missing;
}

/**
 * Place les renommages en TÊTE d'une migration écrite par l'outil.
 *
 * En tête, parce que tout ce que l'outil a écrit emploie déjà les NOUVEAUX
 * noms — il les a lus dans l'instantané réécrit.
 *
 * @param sql - le fichier brut de l'outil (vide pour un renommage seul).
 * @param statements - les instructions de {@link applyRenames}.
 * @returns le fichier complet.
 */
export function prependStatements(
  sql: string,
  statements: readonly string[],
): string {
  const head = statements.join("\n--> statement-breakpoint\n");
  return sql.trim().length === 0
    ? `${head}\n`
    : `${head}\n--> statement-breakpoint\n${sql}`;
}

/** Renommage de table — la forme exacte qu'écrit `drizzle-kit`. */
function renameTableSql(
  dialect: SqlDialect,
  schema: string,
  from: string,
  to: string,
): string {
  if (dialect === "postgres") {
    const qualified = schema ? `"${schema}"."${from}"` : `"${from}"`;
    return `ALTER TABLE ${qualified} RENAME TO "${to}";`;
  }
  if (dialect === "mysql") {
    return `RENAME TABLE \`${from}\` TO \`${to}\`;`;
  }
  return `ALTER TABLE \`${from}\` RENAME TO \`${to}\`;`;
}

/** Renommage de colonne — la forme exacte qu'écrit `drizzle-kit`. */
function renameColumnSql(
  dialect: SqlDialect,
  schema: string,
  table: string,
  from: string,
  to: string,
): string {
  if (dialect === "postgres") {
    const qualified = schema ? `"${schema}"."${table}"` : `"${table}"`;
    return `ALTER TABLE ${qualified} RENAME COLUMN "${from}" TO "${to}";`;
  }
  if (dialect === "mysql") {
    return `ALTER TABLE \`${table}\` RENAME COLUMN \`${from}\` TO \`${to}\`;`;
  }
  return `ALTER TABLE \`${table}\` RENAME COLUMN "${from}" TO "${to}";`;
}

/** Clé d'un renommage dans `_meta` — celle de l'outil (`"schéma"."table"."colonne"`). */
function renameKey(schema: string, ...names: string[]): string {
  return [...(schema ? [schema] : []), ...names].map((n) => `"${n}"`).join(".");
}

/** Remplace une colonne dans la liste `columns` d'un index ou d'une contrainte. */
function renameIn(
  holder: Record<string, unknown>,
  from: string,
  to: string,
): void {
  if (!Array.isArray(holder.columns)) return;
  holder.columns = holder.columns.map((c: unknown) => {
    if (c === from) return to;
    // Index PostgreSQL : `{ expression, isExpression }` — une EXPRESSION n'est
    // pas un nom de colonne, on n'y touche pas.
    if (isRecord(c) && c.isExpression !== true && c.expression === from) {
      return { ...c, expression: to };
    }
    return c;
  });
}

/** Les clés primaires dont le nom est DÉRIVÉ (`<table>_<colonnes>`, MySQL). */
function derivedPrimaryKeys(tables: Record<string, unknown>): Array<{
  table: Record<string, unknown>;
  keys: Record<string, unknown>;
  entry: Record<string, unknown>;
}> {
  const found = [];
  for (const table of Object.values(tables)) {
    if (!isRecord(table) || !isRecord(table.compositePrimaryKeys)) continue;
    const keys = table.compositePrimaryKeys;
    for (const entry of recordValues(keys)) {
      const columns = Array.isArray(entry.columns) ? entry.columns : [];
      if (entry.name === `${String(table.name)}_${columns.join("_")}`) {
        found.push({ table, keys, entry });
      }
    }
  }
  return found;
}

/** La table d'un instantané qui porte ce nom, avec sa clé. */
function findTable(
  tables: Record<string, unknown>,
  name: string,
): [string, Record<string, unknown>] | null {
  for (const [key, table] of Object.entries(tables)) {
    if (isRecord(table) && table.name === name) return [key, table];
  }
  return null;
}

function recordValues(value: unknown): Record<string, unknown>[] {
  return isRecord(value) ? Object.values(value).filter(isRecord) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function duplicate(
  values: readonly string[],
  what: string,
): { spec: string; reason: string } | null {
  const seen = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) {
      return { spec: v, reason: `${what} « ${v} » apparaît deux fois` };
    }
    seen.add(v);
  }
  return null;
}

function refused(spec: string, reason: string): IRenameParse {
  return { ok: false, spec, reason };
}
