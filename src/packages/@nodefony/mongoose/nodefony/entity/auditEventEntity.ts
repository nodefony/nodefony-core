import type { SchemaDefinition } from "mongoose";
import { entityRegistry } from "@nodefony/orm-core";
import type { IEntity } from "@nodefony/orm-core";
// `import type` UNIQUEMENT → effacé à la compilation (approche B : 0 dépendance
// runtime de `@nodefony/mongoose` vers `@nodefony/security`, l'ORM reste pur).
import type {
  AuditCategory,
  AuditOutcome,
  IAuditEventFlags,
} from "@nodefony/security";

/**
 * Schéma Mongoose du **journal d'audit** `@nodefony/security` — pendant
 * documentaire de la table Drizzle `audit_event`, implémentation NoSQL d'
 * `IAuditStore` (append-only, tamper-evident).
 *
 * ⚠️ **`_id` = clé naturelle (String), PAS un ObjectId auto** : l'`id` d'un
 * événement est posé par l'`AuditService` (corrélation + curseur de pagination)
 * → on force `_id: String`, l'id EST la clé primaire. Même convention que
 * `webhookEndpointEntity` et `tokenEntity`.
 *
 * ⚠️ **Horodatage = `Number` (epoch ms), `timestamps:false`** : `IAuditEvent.ts`
 * porte un `number` (`Date.now()`), pas une `Date` — et c'est ce champ qui porte
 * l'ordre du journal.
 *
 * **Index** — mêmes axes que la variante SQL, et pour la même raison (filtrage
 * de la console d'audit) ; perf de lecture seule, jamais de sémantique.
 *
 * ⚠️ Ils sont **simples, un par champ** : `MongooseOrm` compile chaque entité
 * depuis un `SchemaDefinition` plat, où un index COMPOSITE (`{ts:-1,_id:-1}`,
 * l'ordre total du store) ne s'exprime pas. Conséquence à connaître, et elle est
 * bornée : Mongo sert le filtre par l'index sur `ts`, puis départage en mémoire
 * les événements d'une même milliseconde. Le `limit` du store rend ce tri
 * **top-K** — il porte sur une page, jamais sur le journal. Si une rafale
 * soutenue à la milliseconde devenait la norme, le remède est un index composite
 * déclaré à la connexion, pas un relâchement de l'ordre : c'est lui qui garantit
 * qu'aucun événement ne se répète ni ne se perd d'une page à l'autre.
 */
export const auditEventSchema: SchemaDefinition = {
  // ── Identité + horodatage (posés par l'AuditService) ──────────────────────
  _id: { type: String }, // id d'événement (fourni, pas généré par Mongo)
  ts: { type: Number, required: true, index: true },

  // ── Classification ─────────────────────────────────────────────────────────
  category: { type: String, required: true, index: true },
  action: { type: String, required: true },
  outcome: { type: String, required: true },

  // ── Contexte (tous NULLABLE — libellés d'identité, jamais un secret) ───────
  actor: { type: String, default: null, index: true },
  resource: { type: String, default: null },
  reason: { type: String, default: null },
  ip: { type: String, default: null },
  userAgent: { type: String, default: null },
  requestId: { type: String, default: null, index: true },

  // ── Présence de matériel sensible + extras (jamais la valeur) ─────────────
  flags: { type: Object, default: null },
  metadata: { type: Object, default: null },
};

/**
 * Forme **plate** d'une ligne du journal renvoyée par le repository Mongoose —
 * `id` = virtuel (= `_id` = l'id d'événement). Miroir d'`IAuditEvent` avec les
 * champs optionnels rendus explicitement `| null` (le document Mongo les porte
 * à `null`, jamais absents). `MongooseAuditStore` mappe `Row ↔ IAuditEvent`.
 */
export interface AuditEventRow {
  id: string;
  ts: number;
  category: AuditCategory;
  action: string;
  outcome: AuditOutcome;
  actor: string | null;
  resource: string | null;
  reason: string | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  flags: IAuditEventFlags | null;
  metadata: Record<string, unknown> | null;
}

/** Noms logiques des entités du store (clés de lookup `getRepository`). */
export const AUDIT_ENTITY_NAMES = {
  events: "audit_event",
} as const;

/**
 * Construit les descripteurs d'entités du journal d'audit pour un ORM nommé.
 *
 * Le `connector` est **dynamique** (nom du connecteur de l'app, ex. `"nodefony"`) :
 * le schéma est statique mais sa liaison à un ORM dépend de la config → pas
 * d'`@entity` figé. Pas de dialecte (NoSQL) : le schéma est portable par
 * construction. À enregistrer **avant** `orm.connect()` (modèle compilé au connect).
 *
 * `module: "security"` → la collection est regroupée sous @nodefony/security dans
 * l'ERD Studio (l'audit est une feature security, hébergée par l'ORM).
 *
 * @param connector - clé de l'ORM cible dans le `ormRegistry`.
 * @returns les descripteurs {@link IEntity} du journal d'audit.
 */
export function createAuditEntities(connector: string): IEntity[] {
  return [
    {
      connector,
      name: AUDIT_ENTITY_NAMES.events,
      module: "security",
      schema: auditEventSchema,
    },
  ];
}

/**
 * Enregistre les entités du journal d'audit dans le `entityRegistry` pour un ORM
 * donné. À appeler **avant** `orm.connect()` (le modèle est compilé au connect).
 *
 * @param connector - nom de la connexion cible (clé du registre).
 */
export function registerAuditEntities(connector: string): void {
  for (const entity of createAuditEntities(connector)) {
    entityRegistry.register(entity);
  }
}
