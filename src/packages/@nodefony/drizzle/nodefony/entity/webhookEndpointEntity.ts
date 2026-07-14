import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { entityRegistry } from "@nodefony/orm-core";
import type { IEntity } from "@nodefony/orm-core";
import type { SqlDialect } from "../interfaces/IDrizzleConfig";
import {
  createFrameworkTableFactory,
  type IFrameworkTableSpec,
} from "./colKit";

/**
 * Entité du **store d'endpoints webhook** `@nodefony/security` (P6.13,
 * schema-as-code) — implémentation SQL d'`IWebhookStore` (registre durable des
 * destinations notifiées), déclinée via le `colKit` (S3 multi-dialecte) : une
 * spec logique, la variante de table du dialecte du connecteur.
 *
 * ⚠️ **Horodatages en epoch ms (kind `epochMs`, exposés `number`)** :
 * `IWebhookEndpoint` porte des `number` (`Date.now()`), pas des `Date`.
 *
 * ⚠️ **Pas de `.default()` SQL** (règle colKit) : le DDL dérivé
 * (`getTableConfig`) n'émet pas de `DEFAULT`. Le store fournit TOUJOURS toutes
 * les colonnes `notNull` au `save` ; `events`/`metadata` gardent un `defaultFn`
 * JS en filet.
 *
 * Le contrat `IWebhookEndpoint` est déjà « plat tout `| null` » (comme
 * `IAccessTokenRecord`) → le store n'a qu'un mapping minimal Row ↔ contrat (copie
 * défensive des champs JSON `events`/`metadata`, `readonly` → mutable).
 */
const WEBHOOK_ENDPOINT_TABLE_SPEC = {
  name: "webhook_endpoint",
  columns: {
    // ── Identité + destination ──────────────────────────────────────────────
    /** Identifiant public stable (`wh_<random>`). */
    id: { kind: "text", primaryKey: true },
    /** URL de destination (validée anti-SSRF à l'enregistrement). */
    url: { kind: "text", notNull: true },
    /** Secret de signature **chiffré** au repos (blob `gcm1.…`). Jamais en clair. */
    secretEnc: { kind: "text", notNull: true },

    // ── Souscription ────────────────────────────────────────────────────────
    /** Actions d'audit souscrites (`"*"` = toutes). */
    events: { kind: "json", notNull: true, defaultFn: () => [] },
    /** Endpoint actif ? (désactivé = aucune livraison). */
    enabled: { kind: "bool", notNull: true },

    // ── Contexte admin (nullable) ───────────────────────────────────────────
    /** Libellé humain optionnel (console admin) ; `null` = aucun. */
    description: { kind: "text" },
    /** Slot multi-tenant (réservé P17) — `null` = global. */
    tenantId: { kind: "text" },
    /** Identité de l'admin créateur (soft ref, traçabilité) ; `null` = inconnu. */
    createdBy: { kind: "text" },

    // ── Cycle de vie + télémétrie de livraison (epoch ms) ───────────────────
    createdAt: { kind: "epochMs", notNull: true },
    updatedAt: { kind: "epochMs", notNull: true },
    /** Dernière tentative de livraison (epoch ms) ou `null`. */
    lastDeliveryAt: { kind: "epochMs" },
    /** Code HTTP de la dernière livraison, ou `null`. */
    lastDeliveryStatus: { kind: "int" },
    /** Message d'erreur de la dernière livraison, ou `null`. */
    lastDeliveryError: { kind: "text" },
    /** Échecs consécutifs (auto-désactivation au-delà d'un seuil). */
    failureCount: { kind: "int", notNull: true },

    // ── Extensibilité ───────────────────────────────────────────────────────
    /** Métadonnées extensibles (jamais de secret). */
    metadata: { kind: "json", notNull: true, defaultFn: () => ({}) },
  },
} satisfies IFrameworkTableSpec;

/** Factory de la table des endpoints (mémoïsée — une instance par dialecte). */
export const createWebhookEndpointTable = createFrameworkTableFactory(
  WEBHOOK_ENDPOINT_TABLE_SPEC,
);

/**
 * Variante SQLite de la table (dialecte par défaut) — export conservé pour
 * l'usage direct/banc-test.
 */
export const webhookEndpointTable: SQLiteTable =
  createWebhookEndpointTable("sqlite");

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
 * Le `connector` est **dynamique** (nom du connecteur de l'app, ex. `"default"`) et la
 * variante de table suit le dialecte du connecteur (auto-register
 * `registerStores.ts` à `onKernelRegister`). À enregistrer **avant**
 * `orm.connect()`.
 *
 * `module: "security"` → la table est regroupée sous @nodefony/security dans
 * l'ERD Studio (le store est une feature security, hébergée par l'ORM de l'app).
 *
 * @param orm - clé de l'ORM cible dans le `ormRegistry`.
 * @param dialect - dialecte SQL du connecteur (sélectionne la variante de table).
 */
export function createWebhookEndpointEntity(
  connector: string,
  dialect: SqlDialect = "sqlite",
): IEntity {
  return {
    connector,
    name: WEBHOOK_ENDPOINT_ENTITY,
    module: "security",
    schema: createWebhookEndpointTable(dialect),
  };
}

/**
 * Enregistre l'entité du store webhook dans le `entityRegistry` pour un ORM
 * donné. À appeler **avant** `orm.connect()` (l'adapter crée la table au connect).
 *
 * @param connector - nom de la connexion cible (clé du registre).
 * @param dialect - dialecte SQL du connecteur (variante de table — défaut `sqlite`).
 */
export function registerWebhookEndpointEntity(
  connector: string,
  dialect: SqlDialect = "sqlite",
): void {
  entityRegistry.register(createWebhookEndpointEntity(connector, dialect));
}
