import { randomUUID } from "node:crypto";
import { is } from "drizzle-orm";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import {
  getTableConfig as getPgTableConfig,
  PgTable,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  getTableConfig as getMysqlTableConfig,
  MySqlTable,
} from "drizzle-orm/mysql-core";
import type { AnyMySqlColumn } from "drizzle-orm/mysql-core";
import { entityRegistry } from "@nodefony/orm-core";
import type { IEntity } from "@nodefony/orm-core";
import { USER_COLUMNS, USER_TABLE_NAME } from "@nodefony/user";
import type { IUserColumn, UserColumnType } from "@nodefony/user";
import type { SqlDialect } from "../interfaces/IDrizzleConfig";
import { defineTable } from "./colKit";
import type { ColumnSpec, IPortableTableBase, ITableSpec } from "./colKit";
import { isPortableSchema } from "./colKit.shared";

/** Genres du colKit qu'emploie le contrat utilisateur. */
type UserColumnKind = "text" | "json" | "int" | "bool" | "datetime";

/**
 * Traduction d'un type LOGIQUE du contrat utilisateur vers le type du colKit.
 *
 * C'est le seul endroit du module SQL qui connaisse ce vocabulaire : le contrat
 * dit ce que la donnée EST, le colKit dit comment chaque dialecte la range.
 */
const KIND_BY_TYPE: Record<UserColumnType, UserColumnKind> = {
  uuid: "text",
  string: "text",
  "string[]": "json",
  integer: "int",
  boolean: "bool",
  object: "json",
  "object[]": "json",
  date: "datetime",
};

/**
 * Défaut du contrat, vérifié au type de la colonne : le contrat le déclare
 * `() => unknown`, la colonne exige sa valeur — une dérive lève au premier
 * INSERT en nommant la colonne, au lieu d'écrire une valeur du mauvais type.
 */
function checkedDefault<T>(
  make: () => unknown,
  accepts: (value: unknown) => value is T,
  column: string,
): () => T {
  return () => {
    const value = make();
    if (!accepts(value)) {
      throw new TypeError(
        `[@nodefony/drizzle] User.${column}: contract default has the wrong type.`,
      );
    }
    return value;
  };
}

const isString = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number => typeof value === "number";
const isBoolean = (value: unknown): value is boolean =>
  typeof value === "boolean";
const isDate = (value: unknown): value is Date => value instanceof Date;

/**
 * Construit la spec colKit d'une colonne du contrat utilisateur.
 *
 * Les trois origines ne se déclarent pas pareil en SQL : la clé primaire reçoit
 * l'UUID applicatif, un horodatage reçoit l'heure courante (et se régénère si le
 * contrat le dit), une colonne ordinaire reçoit son défaut déclaré.
 *
 * ⚠️ Les défauts restent **JS-level** (`$defaultFn`) : le DDL dérivé n'émet pas
 * de `DEFAULT` SQL (règle du colKit). Une valeur absente à l'insertion est donc
 * comblée par le pilote, pas par le serveur.
 */
function toColSpec(column: IUserColumn): ColumnSpec {
  const kind = KIND_BY_TYPE[column.type];
  const fail = (expected: UserColumnKind): never => {
    throw new TypeError(
      `[@nodefony/drizzle] User.${column.name}: a "${column.origin}" column must be ` +
        `of kind "${expected}", the contract maps it to "${kind}".`,
    );
  };
  switch (column.origin) {
    case "identity":
      return kind === "text"
        ? { kind, primaryKey: true, defaultFn: () => randomUUID() }
        : fail("text");
    case "audit":
      return kind === "datetime"
        ? {
            kind,
            notNull: true,
            defaultFn: () => new Date(),
            ...(column.refreshedOnWrite
              ? { onUpdateFn: () => new Date() }
              : {}),
          }
        : fail("datetime");
    case "column": {
      const notNull: { notNull?: true } = column.nullable
        ? {}
        : { notNull: true };
      const unique: { unique?: true } = column.unique ? { unique: true } : {};
      const make = column.makeDefault;
      switch (kind) {
        case "json":
          return {
            kind,
            ...notNull,
            ...unique,
            ...(make ? { defaultFn: make } : {}),
          };
        case "text":
          return {
            kind,
            ...notNull,
            ...unique,
            ...(make
              ? { defaultFn: checkedDefault(make, isString, column.name) }
              : {}),
          };
        case "int":
          return {
            kind,
            ...notNull,
            ...unique,
            ...(make
              ? { defaultFn: checkedDefault(make, isNumber, column.name) }
              : {}),
          };
        case "bool":
          return {
            kind,
            ...notNull,
            ...unique,
            ...(make
              ? { defaultFn: checkedDefault(make, isBoolean, column.name) }
              : {}),
          };
        case "datetime":
          return {
            kind,
            ...notNull,
            ...unique,
            ...(make
              ? { defaultFn: checkedDefault(make, isDate, column.name) }
              : {}),
          };
      }
    }
  }
}

/**
 * Entité de l'utilisateur Nodefony (schema-as-code) — implémentation SQL
 * **par défaut** du contrat `@nodefony/user`, **dérivée** de `USER_COLUMNS` et
 * déclinée par le `colKit` : une spec logique, la table du dialecte du
 * connecteur.
 *
 * Rien n'est recopié : les noms, les types logiques, les défauts et les
 * contraintes viennent du contrat. Ce fichier ne décide que de la traduction
 * vers SQL — ce qui est exactement ce qu'un adaptateur doit savoir, et rien de
 * plus. Une colonne ajoutée au contrat apparaît donc ici sans qu'on y touche,
 * et `tests/unit/userContractParity.test.ts` refuse le contraire.
 *
 * Les horodatages sont des colonnes EXPLICITES (kind `datetime`, exposé `Date`) —
 * à la différence de Mongoose, qui les gère au niveau du schéma.
 */
const USER_TABLE_SPEC = {
  // DÉRIVÉ du contrat, jamais recopié : le SQL natif de `queryKit` et le
  // générateur d'entité lisent le même nom, et une troisième copie ici aurait
  // divergé en silence — c'est exactement ce qui est arrivé au générateur.
  name: USER_TABLE_NAME,
  columns: Object.fromEntries(
    USER_COLUMNS.map((column) => [column.name, toColSpec(column)]),
  ),
};

/**
 * Factory de la table `User` — comme `IPortableTable.table`, mais sa clé
 * primaire reste ATTEIGNABLE au type.
 *
 * 🔴 Sans cela, une application ne peut pas RÉFÉRENCER l'utilisateur, et c'est
 * la première relation que quiconque écrit : `create entity Message
 * "author:ref(User)"` rend `.references(() => userTable.id)`, qui ne compilait
 * pas (`TS2339: Property 'id' does not exist on type 'SQLiteTable<TableConfig>'`).
 * La table est bâtie depuis une spec dont les colonnes sont calculées
 * (`Object.fromEntries`) : l'inférence les perd, et le type rendu ne porte plus
 * aucune colonne — alors qu'elles existent toutes à l'exécution.
 *
 * Cette précision reste LOCALE à `User`, et n'est pas remontée dans le colKit :
 * les tables du framework n'ont pas toutes une colonne `id` (`session` et
 * `idempotency_key` portent une autre clé), donc l'y déclarer mentirait sur
 * elles. `tests/unit/userTableReference.test.ts` garde le fait — par sa
 * COMPILATION, qu'un cas d'exécution ne pourrait pas prouver.
 */
export interface UserTableFactory {
  (dialect: "sqlite"): SQLiteTable & { readonly id: AnySQLiteColumn };
  (dialect: "postgres"): PgTable & { readonly id: AnyPgColumn };
  (dialect: "mysql"): MySqlTable & { readonly id: AnyMySqlColumn };
  (
    dialect?: SqlDialect,
  ):
    | (SQLiteTable & { readonly id: AnySQLiteColumn })
    | (PgTable & { readonly id: AnyPgColumn })
    | (MySqlTable & { readonly id: AnyMySqlColumn });
}

/**
 * Factory de la table `User` pour un dialecte donné (mémoïsée — une instance
 * par dialecte). Les trois dialectes sont portés (`sqlite` par défaut).
 */
const USER_TABLE = defineTable(USER_TABLE_SPEC);
export const createUserTable = USER_TABLE.table as UserTableFactory;

/**
 * Spec de `User` telle qu'une RÉFÉRENCE la voit : sa clé, un `text`.
 *
 * Les colonnes réelles sont toutes là à l'exécution ; le type n'en garde que la
 * clé, la seule qu'une `ref` lise — la spec étant CALCULÉE depuis le contrat,
 * sa vue large (`IsWideSpec`) ne dirait pas le type de la colonne qui la vise.
 */
export interface IUserKeySpec extends ITableSpec {
  readonly columns: {
    readonly id: { readonly kind: "text"; readonly primaryKey: true };
  };
}

/** Description portable de `User` : la spec vue par sa clé, la fabrique par dialecte. */
export interface IPortableUserTable extends IPortableTableBase {
  readonly spec: IUserKeySpec;
  readonly table: UserTableFactory;
}

/** La clé du contrat est-elle bien le `text` que les références attendent ? */
function isUserKeySpec(spec: ITableSpec): spec is IUserKeySpec {
  const id = spec.columns["id"];
  return id?.kind === "text" && "primaryKey" in id;
}

function userKeySpec(spec: ITableSpec): IUserKeySpec {
  if (!isUserKeySpec(spec)) {
    throw new Error(
      `[@nodefony/drizzle] User: the contract's primary key is no longer a text "id" — references to User would be mistyped.`,
    );
  }
  return spec;
}

/**
 * Description PORTABLE de la table `User` — le `schema` de l'entité `User` d'une
 * application, et la cible de ses références (`{ kind: "ref", target: () => userTable }`).
 *
 * C'est la MÊME table que {@link createUserTable} déclinée pour un dialecte (même
 * fabrique, mêmes instances mémoïsées) : une application qui change de base ne
 * réécrit rien.
 */
export const portableUserTable: IPortableUserTable = {
  spec: userKeySpec(USER_TABLE.spec),
  table: createUserTable,
};

/**
 * Variante SQLite de la table `User` (dialecte par défaut) — export conservé
 * pour l'usage direct/banc-test (ex. module mediasoup).
 *
 * Son type n'est PAS réécrit en `SQLiteTable` : l'annoter ainsi effaçait la
 * clé primaire que la factory vient d'exposer, et c'était la moitié du défaut.
 */
export const userTable = createUserTable("sqlite");

/**
 * Forme plate d'une ligne `User` renvoyée par le repository de base — le contrat
 * `IUserRow` de `@nodefony/user`, ré-exporté sous son nom historique.
 */
export type { IUserRow as UserRow } from "@nodefony/user";

/**
 * Construit le descripteur d'entité `User` Drizzle pour un ORM nommé.
 *
 * Le `connector` est **dynamique** (nom du connecteur de l'app, ex. `"default"`) et la
 * variante de table suit le dialecte du connecteur (auto-register
 * `registerStores.ts` à `onKernelRegister`). À enregistrer dans `entityRegistry`
 * **avant** `orm.connect()` (cf {@link registerUserEntity}).
 *
 * @param orm - clé de l'ORM cible dans le `ormRegistry`.
 * @param dialect - dialecte SQL du connecteur (sélectionne la variante de table).
 * @returns descripteur {@link IEntity} (`name: "User"`).
 */
export function createUserEntity(
  connector: string,
  dialect: SqlDialect = "sqlite",
): IEntity {
  // `module: "user"` → l'entité est regroupée sous @nodefony/user dans l'ERD Studio.
  // (Horodatages = colonnes explicites ci-dessus ; le flag `timestamps` IEntity ne
  // concerne que les ORM qui les gèrent au niveau schéma, ex. Mongoose.)
  return {
    connector,
    name: "User",
    module: "user",
    schema: createUserTable(dialect),
  };
}

/**
 * Enregistre l'entité `User` Drizzle dans le `entityRegistry` pour un ORM donné.
 * À appeler **avant** `orm.connect()` (l'adapter compile/crée les tables au connect).
 *
 * @param connector - nom de la connexion cible (clé du registre).
 * @param dialect - dialecte SQL du connecteur (variante de table — défaut `sqlite`).
 */
export function registerUserEntity(
  connector: string,
  dialect: SqlDialect = "sqlite",
): void {
  entityRegistry.register(createUserEntity(connector, dialect));
}

/** Ce qu'une colonne SQL dit d'elle-même, quel que soit le dialecte. */
export interface IUserColumnView {
  /** La colonne refuse-t-elle `NULL` ? */
  readonly notNull: boolean;
  /** Porte-t-elle une contrainte d'unicité de colonne ? */
  readonly isUnique: boolean;
  /** Est-elle la clé primaire ? */
  readonly primary: boolean;
}

/**
 * Colonnes d'une table Drizzle, lues dans la GRAMMAIRE de son dialecte.
 *
 * L'extraction n'a rien d'anodin : `getTableConfig` n'est pas la même fonction
 * selon le dialecte, et la mauvaise appliquée à une table LÈVE un
 * `TypeError: Cannot convert undefined or null to object` — mesuré sur les six
 * croisements, aucun ne rend un objet vide ni un résultat partiel. La
 * conséquence est la même dans les deux lectures qu'on pourrait en faire : un
 * appelant qui ne route pas par dialecte n'obtient RIEN d'exploitable. D'où un
 * seul point de lecture, partagé par le contrôle de démarrage et par le banc de
 * parité — et un dialecte qui doit suivre l'entité jusqu'ici.
 *
 * @param table - la table Drizzle, telle que l'entité la rend (`schema`).
 * @param dialect - dialecte du connecteur qui la porte.
 * @returns les colonnes indexées par nom SQL.
 */
export function userTableColumns(
  table: unknown,
  dialect: SqlDialect,
): Map<string, IUserColumnView> {
  // La CLASSE de la table décide de la grammaire, et le dialecte annoncé doit
  // lui correspondre : une table d'un autre dialecte est refusée en le disant,
  // au lieu du `TypeError` opaque de la mauvaise `getTableConfig`.
  // Une table PORTABLE (`defineTable`) est d'abord déclinée pour ce dialecte.
  const resolved: unknown = isPortableSchema(table)
    ? table.table(dialect)
    : table;
  const columns =
    dialect === "postgres" && is(resolved, PgTable)
      ? getPgTableConfig(resolved).columns
      : dialect === "mysql" && is(resolved, MySqlTable)
        ? getMysqlTableConfig(resolved).columns
        : dialect === "sqlite" && is(resolved, SQLiteTable)
          ? getTableConfig(resolved).columns
          : null;
  if (columns === null) {
    throw new TypeError(
      `[@nodefony/drizzle] userTableColumns: the table is not a ${dialect} table.`,
    );
  }
  return new Map(
    columns.map((column) => [
      column.name,
      {
        notNull: column.notNull,
        isUnique: column.isUnique,
        primary: column.primary,
      },
    ]),
  );
}
