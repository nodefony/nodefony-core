import { randomUUID } from "node:crypto";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { getTableConfig as getPgTableConfig } from "drizzle-orm/pg-core";
import type { PgTable } from "drizzle-orm/pg-core";
import { getTableConfig as getMysqlTableConfig } from "drizzle-orm/mysql-core";
import type { MySqlTable } from "drizzle-orm/mysql-core";
import { entityRegistry } from "@nodefony/orm-core";
import type { IEntity } from "@nodefony/orm-core";
import { USER_COLUMNS } from "@nodefony/user";
import type { IUserColumn, UserColumnType } from "@nodefony/user";
import type { SqlDialect } from "../interfaces/IDrizzleConfig";
import {
  createFrameworkTableFactory,
  type FrameworkColKind,
  type IFrameworkColSpec,
  type IFrameworkTableSpec,
} from "./colKit";

/**
 * Traduction d'un type LOGIQUE du contrat utilisateur vers le type du colKit.
 *
 * C'est le seul endroit du module SQL qui connaisse ce vocabulaire : le contrat
 * dit ce que la donnée EST, le colKit dit comment chaque dialecte la range.
 */
const KIND_BY_TYPE: Record<
  UserColumnType,
  Exclude<FrameworkColKind, "enum">
> = {
  uuid: "text",
  string: "text",
  "string[]": "json",
  boolean: "bool",
  object: "json",
  "object[]": "json",
  date: "dateMs",
};

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
function toColSpec(column: IUserColumn): IFrameworkColSpec {
  const kind = KIND_BY_TYPE[column.type];
  switch (column.origin) {
    case "identity":
      return { kind, primaryKey: true, defaultFn: () => randomUUID() };
    case "audit":
      return {
        kind,
        notNull: true,
        defaultFn: () => new Date(),
        ...(column.refreshedOnWrite ? { onUpdateFn: () => new Date() } : {}),
      };
    case "column":
      return {
        kind,
        ...(column.nullable ? {} : { notNull: true }),
        ...(column.unique ? { unique: true } : {}),
        ...(column.makeDefault ? { defaultFn: column.makeDefault } : {}),
      };
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
 * Les horodatages sont des colonnes EXPLICITES (kind `dateMs`, exposé `Date`) —
 * à la différence de Mongoose, qui les gère au niveau du schéma.
 */
const USER_TABLE_SPEC = {
  name: "User",
  columns: Object.fromEntries(
    USER_COLUMNS.map((column) => [column.name, toColSpec(column)]),
  ),
} satisfies IFrameworkTableSpec;

/**
 * Factory de la table `User` pour un dialecte donné (mémoïsée — une instance
 * par dialecte). Les trois dialectes sont portés (`sqlite` par défaut).
 */
export const createUserTable = createFrameworkTableFactory(USER_TABLE_SPEC);

/**
 * Variante SQLite de la table `User` (dialecte par défaut) — export conservé
 * pour l'usage direct/banc-test (ex. module mediasoup).
 */
export const userTable: SQLiteTable = createUserTable("sqlite");

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
 * selon le dialecte, et appeler celle de sqlite sur une table postgres ne lève
 * pas — elle rend un objet vide. Une extraction recopiée ailleurs conclurait
 * donc « aucune colonne » là où il y en a, et un contrôle bâti dessus
 * refuserait tout, ou n'attraperait rien. D'où un seul point de lecture,
 * partagé par le contrôle de démarrage et par le banc de parité.
 *
 * @param table - la table Drizzle, telle que l'entité la rend (`schema`).
 * @param dialect - dialecte du connecteur qui la porte.
 * @returns les colonnes indexées par nom SQL.
 */
export function userTableColumns(
  table: unknown,
  dialect: SqlDialect,
): Map<string, IUserColumnView> {
  const columns =
    dialect === "postgres"
      ? getPgTableConfig(table as PgTable).columns
      : dialect === "mysql"
        ? getMysqlTableConfig(table as MySqlTable).columns
        : getTableConfig(table as SQLiteTable).columns;
  return new Map(
    columns.map((column) => [
      column.name,
      {
        notNull: column.notNull,
        isUnique: column.isUnique ?? false,
        primary: column.primary,
      },
    ]),
  );
}
