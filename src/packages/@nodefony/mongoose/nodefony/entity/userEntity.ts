import type { SchemaDefinition } from "mongoose";
import { entityRegistry } from "@nodefony/orm-core";
import type { IEntity } from "@nodefony/orm-core";
import type { ISocialProvider } from "@nodefony/user";

/**
 * Schéma Mongoose de l'utilisateur Nodefony — implémentation NoSQL du contrat
 * `@nodefony/user` (P5.8), pendant documentaire de `userTable` (Drizzle, P5.9).
 *
 * Champs calqués sur `BaseUser` : identité (`identifier`), credential (`password`
 * nullable = compte 100 % OAuth), rôles **plats**, statut (`enabled`/`locked`),
 * profil de session (`currentRole`) et les **champs anti-migration**
 * `socialProviders` (tableau libre — pas de colonnes par fournisseur) et
 * `metadata`. La clé primaire est `_id` (ObjectId) ; le contrat `id: string` est
 * servi par le **virtuel `id`** (hex), activé à la sérialisation par `MongooseOrm`
 * (`toObject/toJSON: { virtuals: true }`). `createdAt`/`updatedAt` sont gérés
 * **automatiquement** (`timestamps: true` du descripteur → option Schema).
 */
export const userSchema: SchemaDefinition = {
  identifier: { type: String, required: true, unique: true, index: true },
  password: { type: String, default: null },
  roles: { type: [String], default: [] },
  enabled: { type: Boolean, default: true },
  locked: { type: Boolean, default: false },
  currentRole: { type: String, default: null },
  // Tableau libre (anti-migration) : `{ provider, providerId, createdAt }`, scanné
  // par `findBySocialProvider` via `$elemMatch` (pattern Shadow User OAuth).
  socialProviders: { type: Array, default: [] },
  metadata: { type: Object, default: {} },
};

/**
 * Forme plate d'une ligne `User` (virtuel `id` + horodatages inclus) renvoyée par
 * le repository. Mappée en `BaseUser` par `MongooseUserRepository`.
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
 * Construit le descripteur d'entité `User` Mongoose pour un ORM nommé.
 *
 * Le `connector` est **dynamique** (nom du connecteur de l'app, ex. `"nodefony"`) : le
 * schéma est statique mais sa liaison à un ORM dépend de la config → pas d'`@entity`
 * figé (parité avec `createUserEntity` Drizzle). À enregistrer **avant**
 * `orm.connect()` (le modèle est compilé à la connexion par `MongooseOrm`).
 *
 * @param orm - clé de l'ORM cible dans le `ormRegistry`.
 * @returns descripteur {@link IEntity} (`name: "User"`, `timestamps: true`).
 */
export function createUserEntity(connector: string): IEntity {
  // `module: "user"` → regroupé sous @nodefony/user dans l'ERD Studio (parité Drizzle).
  // `timestamps` → createdAt/updatedAt gérés par Mongoose (option Schema).
  return {
    connector,
    name: "User",
    module: "user",
    schema: userSchema,
    timestamps: true,
  };
}

/**
 * Enregistre l'entité `User` Mongoose dans le `entityRegistry` pour un ORM donné.
 * À appeler **avant** `orm.connect()` (le modèle est compilé au connect).
 *
 * @param connector - nom de la connexion cible (clé du registre).
 */
export function registerUserEntity(connector: string): void {
  entityRegistry.register(createUserEntity(connector));
}
