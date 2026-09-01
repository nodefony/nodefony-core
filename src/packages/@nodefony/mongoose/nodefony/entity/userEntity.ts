import type { SchemaDefinition, SchemaDefinitionProperty } from "mongoose";
import { entityRegistry } from "@nodefony/orm-core";
import type { IEntity } from "@nodefony/orm-core";
import { USER_COLUMNS } from "@nodefony/user";
import type { IUserColumn, UserColumnType } from "@nodefony/user";

/**
 * Traduction d'un type LOGIQUE du contrat utilisateur vers un type Mongoose.
 *
 * C'est le seul endroit du module document qui connaisse ce vocabulaire : le
 * contrat dit ce que la donnée EST, ce fichier dit comment un document la range.
 * `object[]` reste un `Array` LIBRE — pas un sous-schéma : c'est ce qui permet
 * d'accueillir un nouveau fournisseur d'identité sans migration.
 */
const TYPE_BY_COLUMN: Record<UserColumnType, unknown> = {
  uuid: String,
  string: String,
  "string[]": [String],
  boolean: Boolean,
  object: Object,
  "object[]": Array,
  date: Date,
};

/**
 * Construit la définition Mongoose d'une colonne du contrat utilisateur.
 *
 * Un défaut structuré est passé en FABRIQUE, jamais en valeur : Mongoose
 * partagerait sinon le même tableau entre tous les documents. Une colonne
 * facultative reçoit `null` explicite plutôt que rien, pour qu'un document
 * ancien et un document neuf se lisent pareil. Une colonne obligatoire QUI A un
 * défaut n'est pas `required` : la valeur ne peut pas manquer, l'exiger de
 * l'appelant n'ajouterait qu'un refus.
 */
function toFieldDefinition(column: IUserColumn): SchemaDefinitionProperty {
  const base = {
    type: TYPE_BY_COLUMN[column.type],
    ...(column.nullable || column.makeDefault ? {} : { required: true }),
    ...(column.unique ? { unique: true, index: true } : {}),
  };
  if (column.makeDefault) {
    return { ...base, default: column.makeDefault } as SchemaDefinitionProperty;
  }
  if (column.nullable) {
    return { ...base, default: null } as SchemaDefinitionProperty;
  }
  return base as SchemaDefinitionProperty;
}

/**
 * Schéma Mongoose de l'utilisateur Nodefony — implémentation NoSQL du contrat
 * `@nodefony/user`, **dérivée** de `USER_COLUMNS` (pendant documentaire de
 * `userTable`).
 *
 * Rien n'est recopié : noms, types logiques, défauts et unicité viennent du
 * contrat, et `tests/unit/userContractParity.test.ts` refuse le contraire.
 *
 * Deux origines du contrat ne sont pas déclarées ici, et c'est voulu : la clé
 * primaire est `_id` (ObjectId), servie au contrat `id: string` par le
 * **virtuel `id`** activé à la sérialisation par `MongooseOrm`
 * (`toObject/toJSON: { virtuals: true }`) ; les horodatages sont gérés par
 * l'option `timestamps: true` du descripteur. Le moteur les fournit — les
 * redéclarer les mettrait en concurrence avec lui.
 */
export const userSchema: SchemaDefinition = Object.fromEntries(
  USER_COLUMNS.filter((column) => column.origin === "column").map((column) => [
    column.name,
    toFieldDefinition(column),
  ]),
);

/**
 * Forme plate d'une ligne `User` (virtuel `id` + horodatages inclus) renvoyée par
 * le repository — le contrat `IUserRow` de `@nodefony/user`, ré-exporté sous son
 * nom historique.
 */
export type { IUserRow as UserRow } from "@nodefony/user";

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
