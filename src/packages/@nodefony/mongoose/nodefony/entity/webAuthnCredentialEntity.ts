import type { SchemaDefinition } from "mongoose";
import { entityRegistry } from "@nodefony/orm-core";
import type { IEntity } from "@nodefony/orm-core";

/**
 * Schéma Mongoose du **store de credentials WebAuthn** `@nodefony/security`
 * (pendant documentaire de la table Drizzle) — implémentation NoSQL d'
 * `IWebAuthnCredentialStore` (passkeys).
 *
 * ⚠️ **`_id` = clé naturelle (String), PAS un ObjectId auto** : le contrat
 * `IRepository` traduit le critère `{ id }` en `{ _id }` (cf `MongooseRepository`).
 * Comme l'`id` d'un credential est un **identifiant base64url fourni par
 * l'authenticator** (pas généré par Mongo), on force `_id: String` → le
 * credentialId EST la clé primaire. Le virtuel `id` (activé par `MongooseOrm`,
 * `toObject:{virtuals:true}`) renvoie `String(_id)` = le credentialId.
 *
 * ⚠️ **Horodatages = `Number` (epoch ms), `timestamps:false`** : `IWebAuthnCredential`
 * porte des `number` (`Date.now()`) et l'appelant fournit `createdAt`.
 *
 * Le store ne lit/écrit JAMAIS `IWebAuthnCredential` directement : il traduit via
 * {@link WebAuthnCredentialRow} (forme plate, `nickname: string | null`) — le
 * contrat porte un `nickname?` optionnel et des champs `readonly`, que la
 * frontière de persistance normalise.
 */
export const webAuthnCredentialSchema: SchemaDefinition = {
  _id: { type: String }, // credentialId base64url (fourni par l'authenticator)
  userId: { type: String, required: true, index: true },
  publicKey: { type: String, required: true },
  signCount: { type: Number, required: true },
  transports: { type: [String], default: [] },
  backupEligible: { type: Boolean, required: true },
  backupState: { type: Boolean, required: true },
  uvInitialized: { type: Boolean, required: true },
  nickname: { type: String, default: null },
  createdAt: { type: Number, required: true },
  lastUsedAt: { type: Number, default: null },
};

/**
 * Forme **plate** d'une ligne de credentials renvoyée par le repository Mongoose —
 * `id` = virtuel (= `_id` = credentialId), `nickname: string | null`. Le store
 * mappe `Row ↔ IWebAuthnCredential` (`nickname?` omis si `null`).
 */
export interface WebAuthnCredentialRow {
  id: string;
  userId: string;
  publicKey: string;
  signCount: number;
  transports: string[];
  backupEligible: boolean;
  backupState: boolean;
  uvInitialized: boolean;
  nickname: string | null;
  createdAt: number;
  lastUsedAt: number | null;
}

/** Nom logique de l'entité (clé de lookup `getRepository`). */
export const WEBAUTHN_CREDENTIAL_ENTITY = "webauthn_credential";

/**
 * Construit le descripteur d'entité du store de credentials pour un ORM nommé.
 *
 * Le `connector` est **dynamique** (nom du connecteur de l'app, ex. `"nodefony"`) : le
 * schéma est statique mais sa liaison à un ORM dépend de la config → pas d'`@entity`
 * figé (parité `createTokenEntities`). `timestamps:false`. À enregistrer **avant**
 * `orm.connect()`.
 *
 * @param orm - clé de l'ORM cible dans le `ormRegistry`.
 */
export function createWebAuthnCredentialEntity(connector: string): IEntity {
  return {
    connector,
    name: WEBAUTHN_CREDENTIAL_ENTITY,
    module: "security",
    schema: webAuthnCredentialSchema,
  };
}

/**
 * Enregistre l'entité du store de credentials dans le `entityRegistry` pour un
 * ORM donné. À appeler **avant** `orm.connect()` (le modèle est compilé au connect).
 *
 * @param connector - nom de la connexion cible (clé du registre).
 */
export function registerWebAuthnCredentialEntity(connector: string): void {
  entityRegistry.register(createWebAuthnCredentialEntity(connector));
}
