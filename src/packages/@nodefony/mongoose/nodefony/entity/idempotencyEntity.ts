import type { SchemaDefinition } from "mongoose";
import { entityRegistry } from "@nodefony/orm-core";
import type { IEntity } from "@nodefony/orm-core";
// `import type` UNIQUEMENT → effacé à la compilation (approche B : 0 dépendance
// runtime de `@nodefony/mongoose` vers `@nodefony/framework`). Le contrat
// d'idempotence vit au CORE (`nodefony`), donc l'import de son DTO ne crée AUCUN
// cycle (mongoose dépend déjà du core).
import type { IdempotentResponse } from "nodefony";

/**
 * Schéma Mongoose du **store d'idempotence** — pendant documentaire de la table
 * Drizzle `idempotency_key`, implémentation NoSQL d'`IIdempotencyStore` (contrat
 * au CORE) pour dédoublonner les mutations rejouées PARTAGÉ cross-pod, là où le
 * store mémoire par défaut reste affine à un pod.
 *
 * **Pourquoi MongoDB plutôt que Redis** : un cluster qui possède déjà une base
 * Mongo mais pas de Redis obtient la dédup cross-pod sans nouvelle infra — le
 * même argument qui fonde la variante SQL.
 *
 * ⚠️ **`_id` = la clé d'idempotence (String)** : c'est la contrainte d'unicité de
 * la clé primaire qui porte la **réservation atomique** de `begin`
 * (`findOneAndUpdate(… , {upsert:true})` → `E11000` pour le perdant). Faire
 * porter l'unicité par un index secondaire serait un faux ami : Mongoose
 * construit ses index en tâche de fond, donc la contrainte n'existerait pas
 * pendant la fenêtre de construction, et deux `begin` concurrents renverraient
 * tous deux `fresh` — exactement le double-effet que ce store existe pour
 * empêcher. Sur `_id`, la contrainte existe dès le premier document.
 *
 * Le champ `key` est **dupliqué** à côté de `_id` : c'est lui que le vocabulaire
 * public filtre (`q` = préfixe de clé) et que `listPage` rend. Les deux sont
 * écrits ensemble, jamais séparément.
 *
 * ⚠️ **PAS de TTL index natif** (≠ `expireAfterSeconds`) : l'échéance d'une
 * entrée n'est pas une durée fixe depuis sa création — c'est d'abord un **bail**
 * *in-flight* (`now + lease`), puis une **rétention** (`now + ttl`) posée à la
 * complétion. Un TTL index effacerait selon une règle qui ignore cette bascule.
 * `expiresAt` est donc un `Number` (epoch ms) indexé, purgé par le `gc()`
 * applicatif — même contrepartie que la variante SQL.
 *
 * `state` : `if` = réservation *in-flight* ; `done` = réponse mémorisée
 * (rejouée en `replayed`). `response` = la réponse mémorisée, `null` tant
 * qu'*in-flight* ; elle ne sort JAMAIS par `listPage` (anti-IDOR sur le cache).
 */
export const idempotencyKeySchema: SchemaDefinition = {
  _id: { type: String }, // = la clé d'idempotence (fournie, déjà scopée à l'identité)
  key: { type: String, required: true },
  fingerprint: { type: String, required: true },
  state: { type: String, required: true },
  response: { type: Object, default: null },
  expiresAt: { type: Number, required: true, index: true },
};

/**
 * Forme plate d'une ligne du store d'idempotence telle que rendue par le
 * repository Mongoose. Identique aux champs de {@link idempotencyKeySchema}
 * → zéro mapping store ↔ entité.
 */
export interface IdempotencyKeyRow {
  key: string;
  fingerprint: string;
  state: "if" | "done";
  response: IdempotentResponse | null;
  expiresAt: number;
}

/** Nom logique de l'entité (clé de lookup `getRepository` / `entityRegistry`). */
export const IDEMPOTENCY_ENTITY_NAME = "idempotency_key" as const;

/**
 * Construit le descripteur d'entité du store d'idempotence pour un ORM nommé.
 *
 * Le `connector` est **dynamique** (nom du connecteur de l'app, ex. `"nodefony"`) :
 * le schéma est statique mais sa liaison à un ORM dépend de la config → pas
 * d'`@entity` figé. À enregistrer **avant** `orm.connect()` (le modèle est
 * compilé au connect).
 *
 * `module: "framework"` → la collection est regroupée sous @nodefony/framework
 * dans l'ERD Studio (l'idempotence est une feature framework — data plane admin
 * + `@Idempotent` — simplement hébergée par l'ORM).
 *
 * @param connector - clé de l'ORM cible dans le `ormRegistry`.
 * @returns les descripteurs {@link IEntity} du store d'idempotence.
 */
export function createIdempotencyEntities(connector: string): IEntity[] {
  return [
    {
      connector,
      name: IDEMPOTENCY_ENTITY_NAME,
      module: "framework",
      schema: idempotencyKeySchema,
    },
  ];
}

/**
 * Enregistre l'entité du store d'idempotence dans le `entityRegistry` pour un
 * ORM donné. À appeler **avant** `orm.connect()`.
 *
 * @param connector - nom de la connexion cible (clé du registre).
 */
export function registerIdempotencyEntities(connector: string): void {
  for (const entity of createIdempotencyEntities(connector)) {
    entityRegistry.register(entity);
  }
}
