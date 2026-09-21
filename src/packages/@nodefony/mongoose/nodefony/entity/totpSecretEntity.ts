import type { SchemaDefinition } from "mongoose";
import { entityRegistry } from "@nodefony/orm-core";
import type { IEntity } from "@nodefony/orm-core";

/**
 * Algorithme HMAC du code TOTP (RFC 6238) — union littérale (miroir du
 * `TotpAlgorithm` de `@nodefony/security`, non ré-exporté à la racine). Écrite en
 * clair plutôt que dérivée d'`ITotpSecret["algorithm"]` : sinon le `.d.ts` généré
 * référencerait un chemin interne du package security (non portable, TS2883).
 */
type TotpAlgorithm = "SHA1" | "SHA256" | "SHA512";

/**
 * Schéma Mongoose du **store de secrets TOTP** `@nodefony/security` (2FA) —
 * pendant documentaire de la table Drizzle `totp_secret`, implémentation NoSQL
 * d'`ITotpSecretStore`.
 *
 * ⚠️ **`_id` = `userId` (String)** : le modèle est **1 secret / utilisateur**, donc
 * la clé naturelle EST l'utilisateur — `save` devient un upsert par `_id`, et
 * l'unicité est portée par la clé primaire elle-même (aucun index à construire
 * en tâche de fond, donc aucune fenêtre où la contrainte n'existerait pas).
 *
 * Le champ `userId` est **dupliqué** à côté de `_id` : c'est lui que le
 * vocabulaire public trie et filtre (`q` = préfixe d'`userId`), et un document
 * Mongo n'expose pas `_id` sous un autre nom. Les deux sont écrits ensemble par
 * le store, jamais séparément.
 *
 * ⚠️ **`secretEnc` = secret déjà CHIFFRÉ** (AES-256-GCM par le service détenteur
 * de la clé) : le store ne voit que des octets opaques, jamais le secret `K` en
 * clair. Il ne sort JAMAIS par `listPage` (cf `ITotpEnrollmentSummary`).
 *
 * ⚠️ **Horodatages = `Number` (epoch ms), `timestamps:false`** — sauf
 * `lastUsedStep`, qui est une **tranche `T`** RFC 6238 (`floor(epochSeconds /
 * period)`), pas un horodatage.
 *
 * `recoveryCodes` = tableau de condensats `sha256` des codes NON consommés ; le
 * store les réécrit en bloc (jamais de mutation partielle in-place).
 */
export const totpSecretSchema: SchemaDefinition = {
  _id: { type: String }, // = userId (clé naturelle fournie, pas générée par Mongo)
  userId: { type: String, required: true },
  secretEnc: { type: String, required: true },
  algorithm: { type: String, required: true },
  digits: { type: Number, required: true },
  period: { type: Number, required: true },
  recoveryCodes: { type: [String], default: [] },
  confirmedAt: { type: Number, default: null },
  lastUsedStep: { type: Number, default: null },
  createdAt: { type: Number, required: true },
  lastUsedAt: { type: Number, default: null },
};

/**
 * Forme **plate** d'une ligne de secret renvoyée par le repository Mongoose.
 * Structure identique à `ITotpSecret` (tout `| null` déjà présent côté contrat)
 * → mapping quasi-identité dans `MongooseTotpSecretStore`.
 */
export interface TotpSecretRow {
  userId: string;
  secretEnc: string;
  algorithm: TotpAlgorithm;
  digits: number;
  period: number;
  recoveryCodes: string[];
  confirmedAt: number | null;
  lastUsedStep: number | null;
  createdAt: number;
  lastUsedAt: number | null;
}

/** Nom logique de l'entité (clé de lookup `getRepository`). */
export const TOTP_SECRET_ENTITY = "totp_secret";

/**
 * Construit le descripteur d'entité du store de secrets TOTP pour un ORM nommé.
 *
 * Le `connector` est **dynamique** (nom du connecteur de l'app, ex. `"nodefony"`) :
 * le schéma est statique mais sa liaison à un ORM dépend de la config → pas
 * d'`@entity` figé. À enregistrer **avant** `orm.connect()` (le modèle est
 * compilé au connect). `module: "security"` → regroupé sous @nodefony/security
 * dans l'ERD Studio.
 *
 * @param connector - clé de l'ORM cible dans le `ormRegistry`.
 */
export function createTotpSecretEntity(connector: string): IEntity {
  return {
    connector,
    name: TOTP_SECRET_ENTITY,
    module: "security",
    schema: totpSecretSchema,
  };
}

/**
 * Enregistre l'entité du store de secrets TOTP dans le `entityRegistry` pour un
 * ORM donné. À appeler **avant** `orm.connect()`.
 *
 * @param connector - nom de la connexion cible (clé du registre).
 */
export function registerTotpSecretEntity(connector: string): void {
  entityRegistry.register(createTotpSecretEntity(connector));
}
