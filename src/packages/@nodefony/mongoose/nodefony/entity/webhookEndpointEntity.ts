import type { SchemaDefinition } from "mongoose";
import { entityRegistry } from "@nodefony/orm-core";
import type { IEntity } from "@nodefony/orm-core";

/**
 * Schéma Mongoose du **store d'endpoints webhook** `@nodefony/security` (P6.13,
 * pendant documentaire de la table Drizzle) — implémentation NoSQL d'
 * `IWebhookStore` (registre durable des destinations notifiées).
 *
 * ⚠️ **`_id` = clé naturelle (String), PAS un ObjectId auto** : l'`id` d'un
 * endpoint est un identifiant `wh_<random>` **fourni** (pas généré par Mongo) →
 * on force `_id: String` → l'id EST la clé primaire. Le contrat `IRepository`
 * traduit le critère `{ id }` en `{ _id }` ; le virtuel `id` (activé par
 * `MongooseOrm`, `toObject:{virtuals:true}`) renvoie `String(_id)` = l'id.
 *
 * ⚠️ **Horodatages = `Number` (epoch ms), `timestamps:false`** : `IWebhookEndpoint`
 * porte des `number` (`Date.now()`) et l'appelant fournit `createdAt`/`updatedAt`.
 *
 * `events` = tableau de strings ; `metadata` = objet libre (`Object`/Mixed, idem
 * `tokenEntity.metadata`). Le store réécrit ces champs en bloc (pas de mutation
 * partielle in-place) → pas de souci de change-tracking Mixed.
 */
export const webhookEndpointSchema: SchemaDefinition = {
  _id: { type: String }, // id wh_<random> (fourni, pas généré par Mongo)
  url: { type: String, required: true },
  secretEnc: { type: String, required: true },
  events: { type: [String], default: [] },
  enabled: { type: Boolean, required: true },
  description: { type: String, default: null },
  tenantId: { type: String, default: null },
  createdBy: { type: String, default: null },
  createdAt: { type: Number, required: true },
  updatedAt: { type: Number, required: true },
  lastDeliveryAt: { type: Number, default: null },
  lastDeliveryStatus: { type: Number, default: null },
  lastDeliveryError: { type: String, default: null },
  failureCount: { type: Number, required: true },
  metadata: { type: Object, default: {} },
};

/**
 * Forme **plate** d'une ligne d'endpoint renvoyée par le repository Mongoose —
 * `id` = virtuel (= `_id` = l'id `wh_…`), `events` mutable (le contrat porte
 * `readonly string[]`). `MongooseWebhookStore` mappe `Row ↔ IWebhookEndpoint`.
 */
export interface WebhookEndpointRow {
  id: string;
  url: string;
  secretEnc: string;
  events: string[];
  enabled: boolean;
  description: string | null;
  tenantId: string | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
  lastDeliveryAt: number | null;
  lastDeliveryStatus: number | null;
  lastDeliveryError: string | null;
  failureCount: number;
  metadata: Record<string, unknown>;
}

/** Nom logique de l'entité (clé de lookup `getRepository`). */
export const WEBHOOK_ENDPOINT_ENTITY = "webhook_endpoint";

/**
 * Construit le descripteur d'entité du store webhook pour un ORM nommé.
 *
 * Le `connector` est **dynamique** (nom du connecteur de l'app, ex. `"nodefony"`) : le
 * schéma est statique mais sa liaison à un ORM dépend de la config → pas
 * d'`@entity` figé. `timestamps:false`. À enregistrer **avant** `orm.connect()`.
 *
 * @param orm - clé de l'ORM cible dans le `ormRegistry`.
 */
export function createWebhookEndpointEntity(connector: string): IEntity {
  return {
    connector,
    name: WEBHOOK_ENDPOINT_ENTITY,
    module: "security",
    schema: webhookEndpointSchema,
  };
}

/**
 * Enregistre l'entité du store webhook dans le `entityRegistry` pour un ORM
 * donné. À appeler **avant** `orm.connect()` (le modèle est compilé au connect).
 *
 * @param connector - nom de la connexion cible (clé du registre).
 */
export function registerWebhookEndpointEntity(connector: string): void {
  entityRegistry.register(createWebhookEndpointEntity(connector));
}
