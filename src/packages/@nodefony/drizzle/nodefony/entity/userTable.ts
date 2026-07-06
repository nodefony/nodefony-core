import { randomUUID } from "node:crypto";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { entityRegistry } from "@nodefony/orm-core";
import type { IEntity } from "@nodefony/orm-core";
import type { ISocialProvider } from "@nodefony/user";
import type { SqlDialect } from "../interfaces/IDrizzleConfig";
import {
  createFrameworkTableFactory,
  type IFrameworkTableSpec,
} from "./colKit";

/**
 * Entité de l'utilisateur Nodefony (schema-as-code) — implémentation SQL
 * **par défaut** du contrat `@nodefony/user` (P5.9, ORM recommandé #1),
 * déclinée via le `colKit` (S2 multi-dialecte) : une spec logique, la table
 * du dialecte du connecteur.
 *
 * Colonnes calquées sur `BaseUser` : identité (`id`/`identifier`), credential
 * (`password` nullable = compte 100 % OAuth), rôles **plats** JSON, statut
 * (`enabled`/`locked`), profil de session (`currentRole`), les **champs
 * anti-migration** JSON (`socialProviders`, `metadata`) et les **horodatages**
 * (`createdAt`/`updatedAt`, kind `dateMs` — exposés `Date`, ≠ `epochMs` des
 * stores security qui exposent des `number`). Aucun ajout de provider ne
 * demande de migration.
 *
 * ⚠️ **Valeurs par défaut en `defaultFn` (JS-level), pas `.default()` (SQL)**
 * (règle colKit) : `id` (UUID), `roles`/`socialProviders` (`[]`), `metadata`
 * (`{}`), `enabled` (`true`), `locked` (`false`), `createdAt`/`updatedAt`
 * (`now`). `updatedAt` est régénéré à chaque update via `onUpdateFn` (pendant
 * SQL du `timestamps: true` Mongoose).
 */
const USER_TABLE_SPEC = {
  name: "User",
  columns: {
    id: { kind: "text", primaryKey: true, defaultFn: () => randomUUID() },
    identifier: { kind: "text", notNull: true, unique: true },
    password: { kind: "text" },
    roles: { kind: "json", notNull: true, defaultFn: () => [] },
    enabled: { kind: "bool", notNull: true, defaultFn: () => true },
    locked: { kind: "bool", notNull: true, defaultFn: () => false },
    currentRole: { kind: "text" },
    socialProviders: { kind: "json", notNull: true, defaultFn: () => [] },
    metadata: { kind: "json", notNull: true, defaultFn: () => ({}) },
    createdAt: { kind: "dateMs", notNull: true, defaultFn: () => new Date() },
    updatedAt: {
      kind: "dateMs",
      notNull: true,
      defaultFn: () => new Date(),
      onUpdateFn: () => new Date(),
    },
  },
} satisfies IFrameworkTableSpec;

/**
 * Factory de la table `User` pour un dialecte donné (mémoïsée — une instance
 * par dialecte). `sqlite` (défaut) et `postgres` sont portés ; `mysql` jette (S4).
 */
export const createUserTable = createFrameworkTableFactory(USER_TABLE_SPEC);

/**
 * Variante SQLite de la table `User` (dialecte par défaut) — export conservé
 * pour l'usage direct/banc-test (ex. module mediasoup).
 */
export const userTable: SQLiteTable = createUserTable("sqlite");

/**
 * Forme plate d'une ligne `User` renvoyée par le repository de base (colonnes JSON
 * déjà désérialisées + booléens + dates par le `mode` Drizzle). Mappée en `BaseUser`.
 */
export interface UserRow {
  id: string;
  identifier: string;
  password: string | null;
  roles: string[];
  enabled: boolean;
  locked: boolean;
  currentRole: string | null;
  socialProviders: ISocialProvider[];
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Construit le descripteur d'entité `User` Drizzle pour un ORM nommé.
 *
 * L'`orm` est **dynamique** (nom du connecteur de l'app, ex. `"default"`) et la
 * variante de table suit le dialecte du connecteur (auto-register
 * `registerStores.ts` à `onKernelRegister`). À enregistrer dans `entityRegistry`
 * **avant** `orm.connect()` (cf {@link registerUserEntity}).
 *
 * @param orm - clé de l'ORM cible dans le `ormRegistry`.
 * @param dialect - dialecte SQL du connecteur (sélectionne la variante de table).
 * @returns descripteur {@link IEntity} (`name: "User"`).
 */
export function createUserEntity(
  orm: string,
  dialect: SqlDialect = "sqlite",
): IEntity {
  // `module: "user"` → l'entité est regroupée sous @nodefony/user dans l'ERD Studio.
  // (Horodatages = colonnes explicites ci-dessus ; le flag `timestamps` IEntity ne
  // concerne que les ORM qui les gèrent au niveau schéma, ex. Mongoose.)
  return {
    orm,
    name: "User",
    module: "user",
    schema: createUserTable(dialect),
  };
}

/**
 * Enregistre l'entité `User` Drizzle dans le `entityRegistry` pour un ORM donné.
 * À appeler **avant** `orm.connect()` (l'adapter compile/crée les tables au connect).
 *
 * @param orm - clé de l'ORM cible.
 * @param dialect - dialecte SQL du connecteur (variante de table — défaut `sqlite`).
 */
export function registerUserEntity(
  orm: string,
  dialect: SqlDialect = "sqlite",
): void {
  entityRegistry.register(createUserEntity(orm, dialect));
}
