import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { entityRegistry } from "@nodefony/orm-core";
import type { IEntity } from "@nodefony/orm-core";

/**
 * Table Drizzle du **store d'endpoints webhook** `@nodefony/security` (P6.13,
 * schema-as-code) — implémentation SQL d'`IWebhookStore` (registre durable des
 * destinations notifiées). Driver `better-sqlite3` ; Postgres/MySQL par
 * changement de driver.
 *
 * **Liaison ORM dynamique** (pattern `tokenEntity`/`webAuthnCredentialEntity`,
 * pas `@entity` figé) : c'est l'**application** qui câble le store
 * (`registerWebhookStore("drizzle", …)`) ET le connecteur cible
 * (`registerWebhookEndpointEntity(orm)` avant `orm.connect()`) — le module
 * drizzle n'auto-enregistre rien.
 *
 * ⚠️ **Horodatages en epoch ms (`integer` mode number), pas `timestamp_ms`** :
 * `IWebhookEndpoint` porte des `number` (`Date.now()`), pas des `Date`.
 *
 * ⚠️ **Pas de `.default()` SQL** : le DDL dérivé (`getTableConfig`) n'émet pas de
 * `DEFAULT`. Le store fournit TOUJOURS toutes les colonnes `notNull` au `save` ;
 * `events`/`metadata` gardent un `$defaultFn` JS en filet.
 *
 * ⚠️ **`sqliteTable` dur (dialecte sqlite)** — comme `user`/`token`/`session`/
 * `webauthn` : +1 entité à porter sur le **chantier multi-dialecte** (pg/mysql,
 * `createXTable(dialect)`), après P6. Cohérent (ordre figé du chantier ORM).
 *
 * Le contrat `IWebhookEndpoint` est déjà « plat tout `| null` » (comme
 * `IAccessTokenRecord`) → le store n'a qu'un mapping minimal Row ↔ contrat (copie
 * défensive des champs JSON `events`/`metadata`, `readonly` → mutable).
 */
export const webhookEndpointTable = sqliteTable("webhook_endpoint", {
  /** Identifiant public stable (`wh_<random>`). */
  id: text("id").primaryKey(),
  /** URL de destination (validée anti-SSRF à l'enregistrement). */
  url: text("url").notNull(),
  /** Secret de signature **chiffré** au repos (blob `gcm1.…`). Jamais en clair. */
  secretEnc: text("secretEnc").notNull(),
  /** Actions d'audit souscrites (`"*"` = toutes). */
  events: text("events", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .$defaultFn(() => []),
  /** Endpoint actif ? (désactivé = aucune livraison). */
  enabled: integer("enabled", { mode: "boolean" }).notNull(),
  /** Libellé humain optionnel (console admin) ; `null` = aucun. */
  description: text("description"),
  /** Slot multi-tenant (réservé P17) — `null` = global. */
  tenantId: text("tenantId"),
  /** Identité de l'admin créateur (soft ref, traçabilité) ; `null` = inconnu. */
  createdBy: text("createdBy"),
  /** Création (epoch ms). */
  createdAt: integer("createdAt").notNull(),
  /** Dernière modification (epoch ms). */
  updatedAt: integer("updatedAt").notNull(),
  /** Dernière tentative de livraison (epoch ms) ou `null`. */
  lastDeliveryAt: integer("lastDeliveryAt"),
  /** Code HTTP de la dernière livraison, ou `null`. */
  lastDeliveryStatus: integer("lastDeliveryStatus"),
  /** Message d'erreur de la dernière livraison, ou `null`. */
  lastDeliveryError: text("lastDeliveryError"),
  /** Échecs consécutifs (auto-désactivation au-delà d'un seuil). */
  failureCount: integer("failureCount").notNull(),
  /** Métadonnées extensibles (jamais de secret). */
  metadata: text("metadata", { mode: "json" })
    .$type<Record<string, unknown>>()
    .notNull()
    .$defaultFn(() => ({})),
});

/**
 * Forme **plate** d'une ligne d'endpoint renvoyée par le repository ORM —
 * `events` mutable (le contrat porte `readonly string[]`). Tous les autres
 * champs sont identiques à `IWebhookEndpoint` (déjà « plat tout `| null` »).
 * `DrizzleWebhookStore` mappe `Row ↔ IWebhookEndpoint`.
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
 * L'`orm` est **dynamique** (nom du connecteur de l'app, ex. `"default"`) : la
 * table est statique mais sa liaison à un ORM dépend de la config → pas
 * d'`@entity` figé. À enregistrer **avant** `orm.connect()`.
 *
 * `module: "security"` → la table est regroupée sous @nodefony/security dans
 * l'ERD Studio (le store est une feature security, hébergée par l'ORM de l'app).
 *
 * @param orm - clé de l'ORM cible dans le `ormRegistry`.
 */
export function createWebhookEndpointEntity(orm: string): IEntity {
  return {
    orm,
    name: WEBHOOK_ENDPOINT_ENTITY,
    module: "security",
    schema: webhookEndpointTable,
  };
}

/**
 * Enregistre l'entité du store webhook dans le `entityRegistry` pour un ORM
 * donné. À appeler **avant** `orm.connect()` (l'adapter crée la table au connect).
 *
 * @param orm - clé de l'ORM cible.
 */
export function registerWebhookEndpointEntity(orm: string): void {
  entityRegistry.register(createWebhookEndpointEntity(orm));
}
