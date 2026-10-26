#!/usr/bin/env node
/**
 * Convertit un DDL MySQL réel (`*.sql` + `*.key.sql`) en descriptions
 * d'entités NEUTRES — la grammaire du kit de colonnes (`colKit.spec.ts` de
 * `@nodefony/drizzle`), sans un import d'ORM.
 *
 * La sortie est du JSON : une description par table, et la liste des écarts
 * que la conversion a dû trancher. Aucun ORM n'intervient ici — Drizzle ne
 * paraît qu'à la FABRICATION (`bench-real-schema.mjs`), et le corpus converti
 * resservirait tel quel à un autre adaptateur.
 *
 * ## Forme d'une description sérialisée
 *
 * C'est `ITableSpec`, à deux différences près, imposées par JSON :
 *
 * - `ref` : `target` est le NOM de la table visée (ou `"self"`), là où la
 *   spec TypeScript attend une fonction ;
 * - un défaut calculé s'écrit `defaultFn: "now"` / `onUpdateFn: "now"` (le
 *   seul que MySQL permette ici : `CURRENT_TIMESTAMP`).
 *
 * ## Les traductions — chacune est une DÉCISION, notée quand elle s'applique
 *
 * | MySQL                                   | Genre du kit                                 |
 * | --------------------------------------- | -------------------------------------------- |
 * | `integer AUTO_INCREMENT PRIMARY KEY`    | `serial`                                     |
 * | `integer`/`int`/`smallint`/`tinyint`    | `int` (`unsigned` 32 bits → `int64`)         |
 * | `bigint`                                | `int64`                                      |
 * | `varchar(n)`                            | `string(n)` — jamais 255 par défaut          |
 * | `char(n)`                               | `char(n)`                                    |
 * | `double(p,s)`, `decimal(p,s)`           | `decimal(p,s)` — un montant n'est pas un flottant |
 * | `double`, `real`, `float` sans échelle  | `float`                                      |
 * | `date`                                  | `date` (jour)                                |
 * | `datetime`, `timestamp`                 | `datetime` (instant)                         |
 * | `*text`                                 | `text`                                       |
 * | `boolean`                               | `bool`                                       |
 * | `json`                                  | `json`                                       |
 * | FK des `*.key.sql` vers la clé primaire | `ref`                                        |
 *
 * Ce que le kit ne sait pas dire est CONVERTI ET SIGNALÉ, jamais tu :
 *
 * - une table sans clé primaire, ou à clé COMPOSITE (tables de liaison) :
 *   clé `rowid` ajoutée ; la composite devient un index UNIQUE, pour garder la
 *   contrainte qu'elle portait ;
 * - une clé primaire entière non auto-incrémentée devient `serial` ;
 * - une clé étrangère vers une colonne qui n'est PAS la clé primaire visée
 *   (codes pays, devises) reste une valeur — le kit ne référence qu'une clé ;
 * - le défaut d'une colonne devenue `ref` est retiré (une référence n'en a pas,
 *   et `0` ne désignerait aucune ligne) ;
 * - le préfixe d'un index (`col(255)`) est retiré.
 *
 * Usage :
 *   node mysql-ddl-to-specs.mjs                   # corpus `erp` (cache de corpus-fetch.mjs)
 *   node mysql-ddl-to-specs.mjs --corpus <nom>    # un autre corpus du catalogue
 *   node mysql-ddl-to-specs.mjs --dir <d> --table-prefix <p>   # un dossier de DDL quelconque
 *   node mysql-ddl-to-specs.mjs --out <f.json>    # défaut tmp/bench/corpus/<nom>/specs.json
 *
 * Sorties : 0 converti · 1 DDL non compris (chaque ligne nommée) · 64 usage.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { garderDrapeaux } from "./lib/argv.mjs";
import { CORPORA, cachedCorpus, corpusCache } from "./corpus-fetch.mjs";

// ─── lecture du SQL ─────────────────────────────────────────────────────────

/**
 * Retire les commentaires (`-- …`, `# …`, `/* … *\/`) sans toucher aux
 * chaînes, puis découpe en instructions sur les `;` de premier niveau.
 *
 * @param {string} sql
 * @returns {string[]} instructions non vides, espaces normalisés aux bords.
 */
export function splitStatements(sql) {
  const out = [];
  let current = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "\\") {
          j += 2;
          continue;
        }
        if (sql[j] === c) {
          if (sql[j + 1] === c) {
            j += 2;
            continue;
          }
          break;
        }
        j += 1;
      }
      current += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (
      // `--` ouvre un commentaire même collé au texte : c'est la règle de
      // l'installeur du corpus `erp`, plus lâche que celle de MySQL (`-- `).
      (c === "-" && sql[i + 1] === "-") ||
      c === "#"
    ) {
      while (i < sql.length && sql[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      current += " ";
      continue;
    }
    if (c === ";") {
      if (current.trim()) out.push(current.trim());
      current = "";
      i += 1;
      continue;
    }
    current += c;
    i += 1;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/** Découpe sur les virgules de PREMIER niveau (hors parenthèses et chaînes). */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === "'") {
      let j = i + 1;
      while (j < text.length && !(text[j] === "'" && text[j + 1] !== "'")) {
        j +=
          text[j] === "\\" || (text[j] === "'" && text[j + 1] === "'") ? 2 : 1;
      }
      current += text.slice(i, j + 1);
      i = j;
      continue;
    }
    if (c === "(") depth += 1;
    if (c === ")") depth -= 1;
    if (c === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += c;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Nom d'identifiant SQL, guillemets inverses retirés. */
const unquote = (name) => name.replace(/^`|`$/gu, "");

/** Liste de colonnes `(a, b(255) DESC)` → `["a", "b"]`, préfixes signalés. */
function columnList(text, onPrefix) {
  return splitTopLevel(text).map((item) => {
    const m = /^`?(\w+)`?\s*(\(\s*\d+\s*\))?\s*(asc|desc)?$/iu.exec(item);
    if (!m) throw new Error(`liste de colonnes non comprise : (${text})`);
    if (m[2]) onPrefix(m[1]);
    return m[1];
  });
}

/** Décode un littéral SQL `'…'` (échappements `''` et `\x`). */
function decodeString(literal) {
  return literal
    .slice(1, -1)
    .replace(/''/gu, "'")
    .replace(/\\(.)/gu, (_, ch) =>
      ch === "n" ? "\n" : ch === "t" ? "\t" : ch === "0" ? "\0" : ch,
    );
}

/**
 * Modificateurs lus sur une colonne : `default` porte le littéral SQL brut,
 * les autres valent `true` quand ils sont présents.
 *
 * @typedef {{ default?: string, unsigned?: boolean, zerofill?: boolean, notNull?: boolean, null?: boolean, onUpdateNow?: boolean, autoIncrement?: boolean, primaryKey?: boolean, unique?: boolean, charset?: boolean, collate?: boolean, comment?: boolean }} IColumnMods
 */

/** Les modificateurs d'une colonne, dans n'importe quel ordre. */
const MODIFIERS = [
  ["unsigned", /^unsigned\b/iu],
  ["zerofill", /^zerofill\b/iu],
  ["notNull", /^not\s+null\b/iu],
  ["null", /^null\b/iu],
  ["onUpdateNow", /^on\s+update\s+current_timestamp(?:\(\s*\d*\s*\))?/iu],
  [
    "default",
    /^default\s+('(?:[^'\\]|\\.|'')*'|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?|null\b|current_timestamp(?:\(\s*\d*\s*\))?|true\b|false\b)/iu,
  ],
  ["autoIncrement", /^auto_increment\b/iu],
  ["primaryKey", /^primary\s+key\b/iu],
  ["unique", /^unique(?:\s+key)?\b/iu],
  ["charset", /^(?:character\s+set|charset)\s+\w+/iu],
  ["collate", /^collate\s+\w+/iu],
  ["comment", /^comment\s+'(?:[^'\\]|\\.|'')*'/iu],
];

/**
 * Lit une définition de colonne de `CREATE TABLE`.
 *
 * @returns {{ name: string, type: string, args: number[], mods: IColumnMods }}
 * @throws Quand un mot n'est pas reconnu — rien ne s'ignore en silence.
 */
export function parseColumn(text) {
  const m = /^`?(\w+)`?\s+(\w+)\s*(?:\(([^)]*)\))?\s*([\s\S]*)$/u.exec(text);
  if (!m) throw new Error(`colonne non comprise : ${text}`);
  const [, name, rawType, rawArgs, rest] = m;
  const args =
    rawArgs === undefined
      ? []
      : rawArgs.split(",").map((a) => {
          const n = Number(a.trim());
          if (!Number.isFinite(n)) {
            throw new Error(`argument de type non compris : ${text}`);
          }
          return n;
        });
  /** @type {IColumnMods} */
  const mods = {};
  let tail = rest.trim();
  while (tail) {
    const hit = MODIFIERS.find(([, re]) => re.test(tail));
    if (!hit)
      throw new Error(`modificateur non compris dans « ${text} » : ${tail}`);
    const [key, re] = hit;
    const matched = re.exec(tail);
    mods[key] = key === "default" ? matched[1] : true;
    tail = tail.slice(matched[0].length).trim();
  }
  return { name, type: rawType.toLowerCase(), args, mods };
}

/**
 * Lit un `CREATE TABLE` : colonnes et contraintes déclarées dans le corps.
 *
 * @returns {{ name: string, columns: ReturnType<typeof parseColumn>[], keys: object[] }}
 */
export function parseCreateTable(statement) {
  const m =
    /^create\s+table\s+(?:if\s+not\s+exists\s+)?`?(\w+)`?\s*\(([\s\S]*)\)\s*([\s\S]*)$/iu.exec(
      statement,
    );
  if (!m)
    throw new Error(`CREATE TABLE non compris : ${statement.slice(0, 80)}`);
  const [, name, body, options] = m;
  if (
    options &&
    !/^(?:engine\s*=\s*\w+\s*)?(?:(?:default\s+)?(?:charset|character\s+set)\s*=?\s*\w+\s*)?$/iu.test(
      options.trim(),
    )
  ) {
    throw new Error(`options de table non comprises (${name}) : ${options}`);
  }
  const columns = [];
  const keys = [];
  for (const item of splitTopLevel(body)) {
    const key = parseTableKey(item, name);
    if (key) keys.push(key);
    else columns.push(parseColumn(item));
  }
  return { name, columns, keys };
}

/**
 * Lit une contrainte — dans un corps de `CREATE TABLE`, ou après le `ADD` d'un
 * `ALTER TABLE`. Rend `null` pour ce qui n'est pas une contrainte (une colonne).
 */
function parseTableKey(text, table, onPrefix = () => {}) {
  const cols = (list) => columnList(list, (c) => onPrefix(c));
  let m =
    /^primary\s+key\s*(?:`?(\w+)`?\s*)?\(([^)]*(?:\([^)]*\)[^)]*)*)\)$/iu.exec(
      text,
    );
  if (m) return { kind: "primary", name: m[1] ?? null, on: cols(m[2]) };
  m =
    /^(?:constraint\s+`?(\w+)`?\s+)?unique(?:\s+(?:index|key))?\s*(?:`?(\w+)`?\s*)?\(([^)]*(?:\([^)]*\)[^)]*)*)\)$/iu.exec(
      text,
    );
  if (m) return { kind: "unique", name: m[1] ?? m[2] ?? null, on: cols(m[3]) };
  m = /^(?:index|key)\s+`?(\w+)`?\s*\(([^)]*(?:\([^)]*\)[^)]*)*)\)$/iu.exec(
    text,
  );
  if (m) return { kind: "index", name: m[1], on: cols(m[2]) };
  m =
    /^(?:constraint\s+`?(\w+)`?\s+)?foreign\s+key\s*(?:`?\w+`?\s*)?\(([^)]*)\)\s*references\s+`?(\w+)`?\s*\(([^)]*)\)\s*((?:on\s+(?:delete|update)\s+(?:restrict|cascade|set\s+null|no\s+action|set\s+default)\s*)*)$/iu.exec(
      text,
    );
  if (m) {
    const onDelete =
      /on\s+delete\s+(restrict|cascade|set\s+null|no\s+action)/iu.exec(
        m[5] ?? "",
      );
    return {
      kind: "foreign",
      name: m[1] ?? null,
      on: cols(m[2]),
      target: m[3],
      targetOn: cols(m[4]),
      onDelete: onDelete
        ? onDelete[1].toLowerCase().replace(/\s+/gu, " ")
        : null,
    };
  }
  if (
    /^(?:primary|unique|index|key|constraint|foreign|fulltext|spatial)\b/iu.test(
      text,
    )
  ) {
    throw new Error(`contrainte non comprise (${table}) : ${text}`);
  }
  return null;
}

/**
 * Lit un fichier `*.key.sql` : chaque `ALTER TABLE … ADD …`.
 *
 * @returns {{ table: string, key: object }[]}
 */
export function parseKeyFile(sql, onPrefix = () => {}) {
  const out = [];
  for (const statement of splitStatements(sql)) {
    const m = /^alter\s+table\s+`?(\w+)`?\s+add\s+([\s\S]+)$/iu.exec(
      statement.replace(/\s+/gu, " "),
    );
    if (!m) throw new Error(`instruction de clé non comprise : ${statement}`);
    const key = parseTableKey(m[2].trim(), m[1], (c) => onPrefix(m[1], c));
    if (!key) throw new Error(`ALTER TABLE … ADD non compris : ${statement}`);
    out.push({ table: m[1], key });
  }
  return out;
}

// ─── conversion vers la grammaire du kit ────────────────────────────────────

const INT_TYPES = new Set([
  "integer",
  "int",
  "mediumint",
  "smallint",
  "tinyint",
]);
const TEXT_TYPES = new Set(["text", "tinytext", "mediumtext", "longtext"]);
const DECIMAL_TYPES = new Set([
  "decimal",
  "numeric",
  "double",
  "real",
  "float",
]);
/**
 * Types sans équivalent portable — la géométrie surtout (`point` des fiches
 * tiers). Le kit les refuse par principe (§ « types non portables » de la doc
 * de `@nodefony/drizzle`) : la colonne est retirée et SIGNALÉE, jamais approximée.
 */
const UNSUPPORTED_TYPES = new Set([
  "point",
  "geometry",
  "linestring",
  "polygon",
  "blob",
  "tinyblob",
  "mediumblob",
  "longblob",
  "binary",
  "varbinary",
  "bit",
  "set",
  "year",
  "time",
]);

/** Plus long identifiant que PostgreSQL garde sans le tronquer (MySQL : 64). */
const MAX_IDENTIFIER = 63;

/** Borne un nom à 63 caractères : tronqué, puis 8 caractères d'empreinte pour rester unique. */
function boundedName(name) {
  if (name.length <= MAX_IDENTIFIER) return name;
  const hash = createHash("sha256").update(name).digest("hex").slice(0, 8);
  return `${name.slice(0, MAX_IDENTIFIER - 9)}_${hash}`;
}

/** Clé ajoutée aux tables sans clé simple — la convention la plus répandue des schémas MySQL hérités. */
const ADDED_KEY = "rowid";

/**
 * Traduit une valeur `DEFAULT` MySQL dans le type JS du genre visé.
 *
 * @returns {{ default?: unknown, defaultFn?: "now" } | null} `null` = défaut
 *   non représentable (noté par l'appelant).
 */
function translateDefault(raw, kind) {
  if (raw === undefined || /^null$/iu.test(raw)) return {};
  if (/^current_timestamp/iu.test(raw)) {
    return kind === "datetime" ? { defaultFn: "now" } : null;
  }
  const isString = raw.startsWith("'");
  const text = isString ? decodeString(raw) : raw;
  switch (kind) {
    case "int":
    case "int64":
    case "float": {
      const n = Number(text);
      if (text.trim() === "" || !Number.isFinite(n)) return null;
      if (kind !== "float" && !Number.isInteger(n)) return null;
      return { default: n };
    }
    case "decimal": {
      const n = Number(text);
      if (text.trim() === "" || !Number.isFinite(n)) return null;
      return { default: text.trim() };
    }
    case "bool":
      if (/^(1|true)$/iu.test(text)) return { default: true };
      if (/^(0|false)$/iu.test(text)) return { default: false };
      return null;
    case "string":
    case "char":
    case "text":
    case "date":
      return { default: text };
    default:
      return null;
  }
}

/** Genre du kit d'une colonne MySQL (hors clé et référence). */
function kindOf(col) {
  const { type, args, mods } = col;
  if (INT_TYPES.has(type)) {
    return type !== "smallint" && type !== "tinyint" && mods.unsigned
      ? { kind: "int64" }
      : { kind: "int" };
  }
  if (type === "bigint") return { kind: "int64" };
  if (type === "varchar") return { kind: "string", length: args[0] };
  if (type === "char") return { kind: "char", length: args[0] ?? 1 };
  if (TEXT_TYPES.has(type)) return { kind: "text" };
  if (DECIMAL_TYPES.has(type)) {
    return args.length === 2
      ? { kind: "decimal", precision: args[0], scale: args[1] }
      : type === "decimal" || type === "numeric"
        ? { kind: "decimal", precision: args[0] ?? 10, scale: 0 }
        : { kind: "float" };
  }
  if (type === "date") return { kind: "date" };
  if (type === "datetime" || type === "timestamp") return { kind: "datetime" };
  if (type === "boolean" || type === "bool") return { kind: "bool" };
  if (type === "json") return { kind: "json" };
  return null;
}

/**
 * Convertit le corpus entier.
 *
 * @param {{ tables: { file: string, sql: string }[], keys: { file: string, sql: string }[] }} corpus
 * @param {{ tablePrefix?: string }} [options] - préfixe commun des tables
 *   (`app_`), retiré des noms d'index que la conversion fabrique.
 * @returns {{ specs: object[], notes: { code: string, table: string, column?: string, detail: string }[], errors: string[] }}
 *   `errors` non vide = DDL non compris : la conversion n'est pas fiable.
 */
export function convertCorpus({ tables, keys }, { tablePrefix = "" } = {}) {
  const short = (table) =>
    tablePrefix && table.startsWith(tablePrefix)
      ? table.slice(tablePrefix.length)
      : table;
  const notes = [];
  const errors = [];
  const note = (code, table, column, detail) =>
    notes.push({ code, table, ...(column ? { column } : {}), detail });

  /** @type {Map<string, ReturnType<typeof parseCreateTable>>} */
  const parsed = new Map();
  for (const { file, sql } of tables) {
    for (const statement of splitStatements(sql)) {
      try {
        if (!/^create\s+table/iu.test(statement)) {
          throw new Error(`instruction inattendue : ${statement.slice(0, 80)}`);
        }
        const t = parseCreateTable(statement);
        parsed.set(t.name, t);
      } catch (error) {
        errors.push(`${file}: ${error.message}`);
      }
    }
  }
  for (const { file, sql } of keys) {
    try {
      for (const { table, key } of parseKeyFile(sql, (t, c) =>
        note("index-prefix", t, c, "préfixe d'index retiré"),
      )) {
        const t = parsed.get(table);
        if (!t) {
          note(
            "key-orphan",
            table,
            null,
            `${file} vise une table absente du corpus`,
          );
          continue;
        }
        t.keys.push(key);
      }
    } catch (error) {
      errors.push(`${file}: ${error.message}`);
    }
  }

  // 1. La clé primaire de chaque table — décidée AVANT les références, qui
  //    doivent savoir si elles visent une clé.
  /** @type {Map<string, string>} table → colonne clé (simple) */
  const primary = new Map();
  for (const t of parsed.values()) {
    const inline = t.columns
      .filter((c) => c.mods.primaryKey)
      .map((c) => c.name);
    const declared = t.keys.find((k) => k.kind === "primary");
    const pk = inline.length > 0 ? inline : (declared?.on ?? []);
    // Une clé qui est AUSSI une clé étrangère (une table d'extension par utilisateur) :
    // le kit refuse une `ref` clé primaire. Traitée comme une composite — clé
    // ajoutée, et la colonne garde sa référence ET son unicité.
    const foreign = new Set(
      t.keys
        .filter((k) => k.kind === "foreign" && k.on.length === 1)
        .map((k) => k.on[0]),
    );
    if (pk.length === 1 && foreign.has(pk[0])) {
      note(
        "pk-ref",
        t.name,
        pk[0],
        "clé primaire qui est aussi une référence → clé rowid ajoutée, référence unique",
      );
      t.pkRef = pk[0];
      for (const c of t.columns) {
        if (c.name === pk[0]) {
          c.mods.primaryKey = false;
          c.mods.notNull = true;
          c.mods.unique = true;
        }
      }
      t.pk = [];
      primary.set(t.name, ADDED_KEY);
      continue;
    }
    t.pk = pk;
    if (pk.length === 1) primary.set(t.name, pk[0]);
    else primary.set(t.name, ADDED_KEY);
  }

  const specs = [];
  for (const t of parsed.values()) {
    const columns = {};
    const indexes = [];
    const indexNames = new Set();
    const addIndex = (ix) => {
      if (indexNames.has(ix.name)) {
        note(
          "index-duplicate",
          t.name,
          null,
          `index ${ix.name} déclaré deux fois`,
        );
        return;
      }
      indexNames.add(ix.name);
      indexes.push(ix);
    };

    if (t.pk.length !== 1) {
      if (t.columns.some((c) => c.name === ADDED_KEY)) {
        errors.push(
          `${t.name}: clé à ajouter, mais « ${ADDED_KEY} » existe déjà`,
        );
        continue;
      }
      columns[ADDED_KEY] = { kind: "serial", primaryKey: true };
      if (t.pkRef) {
        // déjà noté (`pk-ref`)
      } else if (t.pk.length === 0) {
        note(
          "pk-added",
          t.name,
          ADDED_KEY,
          "table sans clé primaire : clé ajoutée",
        );
      } else {
        note(
          "pk-composite",
          t.name,
          ADDED_KEY,
          `clé composite (${t.pk.join(", ")}) → clé ${ADDED_KEY} + index unique`,
        );
        addIndex({
          name: `pk_${short(t.name)}`,
          on: t.pk,
          unique: true,
        });
      }
    }

    // Les FK SIMPLES qui visent la clé primaire de leur cible deviennent des `ref`.
    /** @type {Map<string, object>} colonne → ref */
    const refs = new Map();
    for (const k of t.keys.filter((k) => k.kind === "foreign")) {
      const where = `${k.on.join(",")} → ${k.target}(${k.targetOn.join(",")})`;
      if (k.on.length !== 1 || k.targetOn.length !== 1) {
        note(
          "fk-composite",
          t.name,
          k.on.join(","),
          `clé étrangère composite non exprimable : ${where}`,
        );
        continue;
      }
      if (!parsed.has(k.target)) {
        note(
          "fk-orphan",
          t.name,
          k.on[0],
          `cible absente du corpus : ${where}`,
        );
        continue;
      }
      if (primary.get(k.target) !== k.targetOn[0]) {
        note(
          "fk-not-key",
          t.name,
          k.on[0],
          `vise une colonne qui n'est pas la clé : ${where}`,
        );
        continue;
      }
      if (refs.has(k.on[0])) {
        note(
          "fk-duplicate",
          t.name,
          k.on[0],
          `clé étrangère déclarée deux fois : ${where}`,
        );
        continue;
      }
      refs.set(k.on[0], {
        kind: "ref",
        target: k.target === t.name ? "self" : k.target,
        ...(k.onDelete ? { onDelete: k.onDelete } : {}),
      });
    }

    for (const col of t.columns) {
      const label = col.name;
      if (col.mods.zerofill) note("zerofill", t.name, label, "ZEROFILL ignoré");
      if (t.pk.length === 1 && t.pk[0] === col.name) {
        const kind = kindOf(col);
        if (kind?.kind === "int" || kind?.kind === "int64") {
          if (!col.mods.autoIncrement) {
            note(
              "pk-int-serial",
              t.name,
              label,
              "clé entière non auto-incrémentée → serial",
            );
          }
          columns[label] = { kind: "serial", primaryKey: true };
        } else if (kind && ["string", "char", "text"].includes(kind.kind)) {
          columns[label] = { ...kind, primaryKey: true };
        } else {
          errors.push(
            `${t.name}.${label}: clé primaire de type ${col.type} non exprimable`,
          );
        }
        continue;
      }
      const ref = refs.get(col.name);
      if (ref) {
        const kind = kindOf(col);
        const targetKey = primary.get(
          ref.target === "self" ? t.name : ref.target,
        );
        const targetTable = parsed.get(
          ref.target === "self" ? t.name : ref.target,
        );
        const targetCol = targetTable.columns.find((c) => c.name === targetKey);
        const targetKind = targetCol ? kindOf(targetCol) : { kind: "int" };
        const compatible =
          (kind?.kind === "int" || kind?.kind === "int64") ===
          (targetKind?.kind === "int" || targetKind?.kind === "int64");
        if (!compatible) {
          note(
            "fk-type",
            t.name,
            label,
            `type ${col.type} face à la clé ${ref.target}.${targetKey} : laissée en valeur`,
          );
        } else {
          if (
            col.mods.default !== undefined &&
            !/^null$/iu.test(col.mods.default)
          ) {
            note(
              "ref-default",
              t.name,
              label,
              `défaut ${col.mods.default} retiré d'une référence`,
            );
          }
          columns[label] = {
            ...ref,
            ...(col.mods.notNull ? { notNull: true } : {}),
            ...(col.mods.unique ? { unique: true } : {}),
          };
          continue;
        }
      }
      const kind = kindOf(col);
      if (!kind) {
        if (UNSUPPORTED_TYPES.has(col.type)) {
          note(
            "type-unsupported",
            t.name,
            label,
            `type ${col.type} sans genre portable : colonne retirée`,
          );
        } else {
          errors.push(`${t.name}.${label}: type ${col.type} non traduit`);
        }
        continue;
      }
      if (col.mods.autoIncrement) {
        note(
          "autoincrement-ignored",
          t.name,
          label,
          "AUTO_INCREMENT hors clé ignoré",
        );
      }
      if (col.mods.unsigned && kind.kind === "int64" && col.type !== "bigint") {
        note("unsigned-widened", t.name, label, `${col.type} unsigned → int64`);
      }
      if (
        DECIMAL_TYPES.has(col.type) &&
        col.args.length !== 2 &&
        kind.kind === "float"
      ) {
        note("float", t.name, label, `${col.type} sans échelle → float`);
      }
      const spec = { ...kind };
      if (col.mods.notNull) spec.notNull = true;
      if (col.mods.unique) spec.unique = true;
      const def = translateDefault(col.mods.default, kind.kind);
      if (def === null) {
        note(
          "default-dropped",
          t.name,
          label,
          `DEFAULT ${col.mods.default} non représentable pour ${kind.kind}`,
        );
      } else {
        Object.assign(spec, def);
      }
      if (col.mods.onUpdateNow) {
        if (kind.kind === "datetime") spec.onUpdateFn = "now";
        else
          note(
            "on-update-dropped",
            t.name,
            label,
            "ON UPDATE hors instant ignoré",
          );
      }
      columns[label] = spec;
    }

    for (const k of t.keys) {
      if (k.kind === "index" || k.kind === "unique") {
        const unknown = k.on.find((c) => !Object.hasOwn(columns, c));
        if (unknown) {
          note(
            "index-unknown-column",
            t.name,
            unknown,
            `index ${k.name ?? "?"} sur une colonne absente : retiré`,
          );
          continue;
        }
        if (k.on.length === 1 && k.kind === "unique" && !k.name) {
          const c = columns[k.on[0]];
          c.unique = true;
          continue;
        }
        addIndex({
          name:
            k.name ??
            `${k.kind === "unique" ? "uk" : "idx"}_${short(t.name)}_${k.on.join("_")}`,
          on: k.on,
          ...(k.kind === "unique" ? { unique: true } : {}),
        });
      }
    }

    specs.push({
      name: t.name,
      columns,
      ...(indexes.length > 0 ? { indexes } : {}),
    });
  }
  specs.sort((a, b) => a.name.localeCompare(b.name));

  // Un nom d'index est GLOBAL au schéma en PostgreSQL et en SQLite, local à la
  // table en MySQL — un schéma né sur MySQL en réutilise sans le savoir. Le premier
  // porteur (ordre alphabétique) garde le nom, les suivants sont renommés.
  const owners = new Map();
  for (const spec of specs) {
    for (const ix of spec.indexes ?? []) {
      if (!owners.has(ix.name)) {
        owners.set(ix.name, spec.name);
        continue;
      }
      const renamed = boundedName(`${ix.name}_${short(spec.name)}`);
      note(
        "index-renamed",
        spec.name,
        null,
        `index ${ix.name} déjà porté par ${owners.get(ix.name)} : renommé ${renamed}`,
      );
      ix.name = renamed;
      owners.set(renamed, spec.name);
    }
  }
  return { specs, notes, errors };
}

/** Lit un dossier de DDL MySQL (`*.sql` / `*.key.sql`). */
export function readCorpusDir(dir) {
  const files = readdirSync(dir).sort();
  const read = (f) => ({
    file: f,
    sql: readFileSync(path.join(dir, f), "utf8"),
  });
  return {
    tables: files
      .filter((f) => f.endsWith(".sql") && !f.endsWith(".key.sql"))
      .map(read),
    keys: files.filter((f) => f.endsWith(".key.sql")).map(read),
  };
}

/** Compte des notes par code — le résumé que le banc imprime. */
export function summarizeNotes(notes) {
  const byCode = {};
  for (const n of notes) byCode[n.code] = (byCode[n.code] ?? 0) + 1;
  return Object.fromEntries(Object.entries(byCode).sort((a, b) => b[1] - a[1]));
}

/**
 * Rend la conversion sous forme de module TypeScript de DONNÉES SEULES — aucun
 * import : un test le lit sans chaîne de build, et Node l'importe nativement
 * (le selftest le compare à une conversion fraîche, garde de dérive).
 *
 * @returns {string} le source du module.
 */
export function specsModule({ specs, notes }) {
  return [
    "/**",
    " * Descriptions d'entités NEUTRES du corpus synthétique — GÉNÉRÉ par",
    " * `.claude/skills/nodefony-devkit-bench/scripts/mysql-ddl-to-specs.mjs`",
    " * depuis `ddl/`, ne pas éditer : modifier le DDL, puis régénérer.",
    " */",
    `export const SPECS = ${JSON.stringify(specs, null, 2)} as const;`,
    "",
    "/** Écarts que la conversion a tranchés — chacun est une décision. */",
    `export const NOTES = ${JSON.stringify(notes, null, 2)} as const;`,
    "",
  ].join("\n");
}

function main() {
  const args = process.argv.slice(2);
  garderDrapeaux({
    args,
    connus: ["--corpus", "--dir", "--table-prefix", "--out"],
    aValeur: ["--corpus", "--dir", "--table-prefix", "--out"],
    usage: [
      "Convertit un DDL MySQL réel en descriptions d'entités neutres (JSON).",
      "",
      `  node mysql-ddl-to-specs.mjs --corpus <nom>      ${Object.keys(CORPORA).join(", ")} (défaut erp, cache de corpus-fetch.mjs)`,
      "  node mysql-ddl-to-specs.mjs --dir <d>          un dossier de DDL quelconque",
      "  node mysql-ddl-to-specs.mjs --table-prefix <p> préfixe commun des tables",
      "  node mysql-ddl-to-specs.mjs --out <f.json>     défaut tmp/bench/corpus/<nom>/specs.json",
    ].join("\n"),
  });
  const valueOf = (flag) => {
    const i = args.indexOf(flag);
    return i === -1 ? undefined : args[i + 1];
  };
  const name = valueOf("--corpus") ?? "erp";
  if (!Object.hasOwn(CORPORA, name)) {
    process.stderr.write(
      `--corpus ${name} inconnu — connus : ${Object.keys(CORPORA).join(", ")}\n`,
    );
    process.exit(64);
  }
  let dir = valueOf("--dir");
  let tablePrefix = valueOf("--table-prefix") ?? "";
  let source = null;
  if (dir === undefined) {
    const corpus = cachedCorpus(name);
    if (corpus === null) {
      process.stderr.write(
        `Corpus ${name} absent — lancer d'abord corpus-fetch.mjs --corpus ${name}\n`,
      );
      process.exit(1);
    }
    dir = corpus.dir;
    source = corpus.source;
    tablePrefix = valueOf("--table-prefix") ?? CORPORA[name].tablePrefix;
  }
  const out = valueOf("--out") ?? path.join(corpusCache(name), "specs.json");
  const { specs, notes, errors } = convertCorpus(readCorpusDir(dir), {
    tablePrefix,
  });
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(
    out,
    out.endsWith(".ts")
      ? specsModule({ specs, notes })
      : `${JSON.stringify({ source, specs, notes }, null, 2)}\n`,
  );
  const columns = specs.reduce((n, s) => n + Object.keys(s.columns).length, 0);
  const refs = specs.reduce(
    (n, s) =>
      n + Object.values(s.columns).filter((c) => c.kind === "ref").length,
    0,
  );
  const indexes = specs.reduce((n, s) => n + (s.indexes?.length ?? 0), 0);
  process.stdout.write(
    `${specs.length} tables · ${columns} colonnes · ${refs} références · ${indexes} index\n` +
      `Écarts tranchés : ${JSON.stringify(summarizeNotes(notes))}\n${out}\n`,
  );
  if (errors.length > 0) {
    process.stderr.write(
      `\n${errors.length} DDL non compris :\n${errors.map((e) => `  ${e}`).join("\n")}\n`,
    );
    process.exit(1);
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
