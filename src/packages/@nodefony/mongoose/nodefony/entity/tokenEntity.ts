import type { SchemaDefinition } from "mongoose";
import { entityRegistry } from "@nodefony/orm-core";
import type { IEntity } from "@nodefony/orm-core";

/**
 * Schémas Mongoose du **store de jetons** `@nodefony/security` (pendant
 * documentaire des tables Drizzle) — implémentation NoSQL d'`ITokenStore` (PAT,
 * refresh, denylist `jti`, seuil de révocation en masse).
 *
 * ⚠️ **`_id` = clé naturelle (String), PAS un ObjectId auto** : le contrat
 * `IRepository` traduit le critère `{ id }` en `{ _id }` (cf `MongooseRepository`).
 * Comme l'`id` d'un jeton est un **jti fourni par l'appelant** (pas généré par
 * Mongo), on force `_id: String` → le jti EST la clé primaire (gratuit : unique +
 * éligible à un TTL index natif). Le virtuel `id` (activé par `MongooseOrm`,
 * `toObject:{virtuals:true}`) renvoie `String(_id)` = le jti.
 *
 * ⚠️ **Horodatages = `Number` (epoch ms), `timestamps:false`** : `IAccessTokenRecord`
 * porte des `number` (`Date.now()`) et l'appelant fournit `createdAt` → pas de
 * gestion auto Mongoose. Le `gc()` applicatif reste portable (`$lte` exclut les
 * `null` par type bracketing Mongo, comme Drizzle exclut `NULL`).
 */
export const accessTokenSchema: SchemaDefinition = {
  _id: { type: String }, // jti (fourni par l'appelant)
  kind: { type: String, required: true },
  name: { type: String, required: true },
  prefix: { type: String, default: null },
  subjectId: { type: String, required: true, index: true },
  subjectType: { type: String, required: true },
  tenantId: { type: String, default: null },
  scopes: { type: [String], default: [] },
  audience: { type: [String], default: [] },
  resources: { type: Object, default: null }, // IResourcePermission[] | null (Mixed)
  secretHash: { type: String, required: true, unique: true, index: true },
  hashAlg: { type: String, required: true },
  clientId: { type: String, default: null },
  cnf: { type: String, default: null },
  family: { type: String, default: null, index: true },
  replacedBy: { type: String, default: null },
  createdAt: { type: Number, required: true },
  expiresAt: { type: Number, default: null },
  lastUsedAt: { type: Number, default: null },
  lastUsedIp: { type: String, default: null },
  lastUsedUserAgent: { type: String, default: null },
  revokedAt: { type: Number, default: null },
  revokedReason: { type: String, default: null },
  metadata: { type: Object, default: {} },
};

/** Denylist des access tokens (`jti` = `_id`) révoqués avant leur `exp`. */
export const deniedJtiSchema: SchemaDefinition = {
  _id: { type: String }, // jti
  expiresAt: { type: Number, required: true },
};

/** Forme plate d'une ligne de denylist (`id` = virtuel = jti). */
export interface DeniedJtiRow {
  id: string;
  expiresAt: number;
}

/** Seuil de révocation en masse par porteur (`subjectId` = `_id`). */
export const subjectRevocationSchema: SchemaDefinition = {
  _id: { type: String }, // subjectId
  invalidBefore: { type: Number, required: true },
};

/** Forme plate d'une ligne de révocation par porteur (`id` = virtuel = subjectId). */
export interface SubjectRevocationRow {
  id: string;
  invalidBefore: number;
}

/** Noms logiques des entités du store (clés de lookup `getRepository`). */
export const TOKEN_ENTITY_NAMES = {
  records: "access_token",
  denied: "denied_jti",
  revocations: "subject_revocation",
} as const;

/**
 * Construit les descripteurs d'entités du store de jetons pour un ORM nommé.
 *
 * Le `connector` est **dynamique** (nom du connecteur de l'app, ex. `"nodefony"`) : les
 * schémas sont statiques mais leur liaison à un ORM dépend de la config → pas
 * d'`@entity` figé (parité `createUserEntity`). `timestamps:false` (l'appelant
 * gère `createdAt`). À enregistrer **avant** `orm.connect()`.
 *
 * @param orm - clé de l'ORM cible dans le `ormRegistry`.
 * @returns les trois descripteurs {@link IEntity} (records / denylist / seuils).
 */
export function createTokenEntities(connector: string): IEntity[] {
  return [
    {
      connector,
      name: TOKEN_ENTITY_NAMES.records,
      module: "security",
      schema: accessTokenSchema,
    },
    {
      connector,
      name: TOKEN_ENTITY_NAMES.denied,
      module: "security",
      schema: deniedJtiSchema,
    },
    {
      connector,
      name: TOKEN_ENTITY_NAMES.revocations,
      module: "security",
      schema: subjectRevocationSchema,
    },
  ];
}

/**
 * Enregistre les entités du store de jetons dans le `entityRegistry` pour un ORM
 * donné. À appeler **avant** `orm.connect()` (le modèle est compilé au connect).
 *
 * @param connector - nom de la connexion cible (clé du registre).
 */
export function registerTokenEntities(connector: string): void {
  for (const entity of createTokenEntities(connector)) {
    entityRegistry.register(entity);
  }
}
