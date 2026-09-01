import { randomUUID } from "node:crypto";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
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
