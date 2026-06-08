import { randomUUID } from "node:crypto";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { entityRegistry } from "@nodefony/orm-core";
import type { IEntity } from "@nodefony/orm-core";
import type { ISocialProvider } from "@nodefony/user";

/**
 * Table Drizzle de l'utilisateur Nodefony (schema-as-code) — implémentation SQL
 * **par défaut** du contrat `@nodefony/user` (P5.9, ORM recommandé #1).
 *
 * Colonnes calquées sur `BaseUser` : identité (`id`/`identifier`), credential
 * (`password` nullable = compte 100 % OAuth), rôles **plats** JSON, statut
 * (`enabled`/`locked`), profil de session (`currentRole`), les **champs
 * anti-migration** JSON (`socialProviders`, `metadata`) et les **horodatages**
 * (`createdAt`/`updatedAt`, ms epoch). Aucun ajout de provider ne demande de
 * migration.
 *
 * ⚠️ **Valeurs par défaut en `$defaultFn` (JS-level), pas `.default()` (SQL)** :
 * l'adapter dérive le DDL via `getTableConfig()` qui n'émet **pas** les `DEFAULT`
 * SQL → une colonne `NOT NULL` sans valeur à l'`INSERT` casserait. Les
 * `$defaultFn` sont appliqués par Drizzle au moment de l'insert : `id` (UUID),
 * `roles`/`socialProviders` (`[]`), `metadata` (`{}`), `enabled` (`true`),
 * `locked` (`false`), `createdAt`/`updatedAt` (`now`). `updatedAt` est régénéré à
 * chaque update via `$onUpdateFn` (pendant SQL du `timestamps: true` Mongoose).
 */
export const userTable = sqliteTable("User", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  identifier: text("identifier").notNull().unique(),
  password: text("password"),
  roles: text("roles", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .$defaultFn(() => []),
  enabled: integer("enabled", { mode: "boolean" })
    .notNull()
    .$defaultFn(() => true),
  locked: integer("locked", { mode: "boolean" })
    .notNull()
    .$defaultFn(() => false),
  currentRole: text("currentRole"),
  socialProviders: text("socialProviders", { mode: "json" })
    .$type<ISocialProvider[]>()
    .notNull()
    .$defaultFn(() => []),
  metadata: text("metadata", { mode: "json" })
    .$type<Record<string, unknown>>()
    .notNull()
    .$defaultFn(() => ({})),
  createdAt: integer("createdAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date()),
});

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
 * L'`orm` est **dynamique** (nom du connecteur de l'app, ex. `"default"`) : la
 * table est statique mais sa liaison à un ORM dépend de la config → on ne peut
 * pas la figer via `@entity`. À enregistrer dans `entityRegistry` **avant**
 * `orm.connect()` (cf {@link registerUserEntity}).
 *
 * @param orm - clé de l'ORM cible dans le `ormRegistry`.
 * @returns descripteur {@link IEntity} (`name: "User"`, `schema: userTable`).
 */
export function createUserEntity(orm: string): IEntity {
  // `module: "user"` → l'entité est regroupée sous @nodefony/user dans l'ERD Studio.
  // (Horodatages = colonnes explicites ci-dessus ; le flag `timestamps` IEntity ne
  // concerne que les ORM qui les gèrent au niveau schéma, ex. Mongoose.)
  return { orm, name: "User", module: "user", schema: userTable };
}

/**
 * Enregistre l'entité `User` Drizzle dans le `entityRegistry` pour un ORM donné.
 * À appeler **avant** `orm.connect()` (l'adapter compile/crée les tables au connect).
 *
 * @param orm - clé de l'ORM cible.
 */
export function registerUserEntity(orm: string): void {
  entityRegistry.register(createUserEntity(orm));
}
