import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { entityRegistry } from "@nodefony/orm-core";
import type { IEntity } from "@nodefony/orm-core";
// `import type` UNIQUEMENT → effacé à la compilation (approche B : 0 dépendance
// runtime de `@nodefony/drizzle` vers `@nodefony/security`, l'ORM reste pur).
import type {
  AuditCategory,
  AuditOutcome,
  IAuditEventFlags,
} from "@nodefony/security";
import type { SqlDialect } from "../interfaces/IDrizzleConfig";
import {
  createFrameworkTableFactory,
  type IFrameworkTableSpec,
} from "./colKit";

/**
 * Entité du **journal d'audit** `@nodefony/security` (schema-as-code) —
 * implémentation SQL d'`IAuditStore` (append-only, tamper-evident), déclinée
 * via le `colKit` (S3 multi-dialecte) : une spec logique, la variante de table
 * du dialecte du connecteur.
 *
 * ⚠️ **Horodatage en epoch ms (kind `epochMs`, exposé `number`)** :
 * `IAuditEvent.ts` porte un `number` (`Date.now()`), pas une `Date`.
 * `AuditEventRow` (forme repository) est **identique** à `IAuditEvent` (champs
 * optionnels ⇒ colonnes NULLABLE) → zéro mapping surprise store ↔ entité. Les
 * unions du contrat (`category`/`outcome`) vivent sur le type `Row` (frontière
 * typée), plus sur les colonnes — décision S1 : les types publics des entités
 * framework sont leurs interfaces `Row`, pas l'inférence Drizzle.
 *
 * ⚠️ **Pas de `.default()` SQL** (règle colKit) : le DDL dérivé n'émet ni
 * `DEFAULT` ni index séparés. Les index déclarés sont lus par `drizzle-kit`
 * (migrations prod) et sans effet sur le DDL dev/test (perf de filtrage seule,
 * jamais de sémantique) — ils couvrent les axes de la console d'audit (`ts` pour
 * la pagination chronologique, `category`/`actor`/`requestId` pour les filtres).
 */
const AUDIT_EVENT_TABLE_SPEC = {
  name: "audit_event",
  columns: {
    // ── Identité + horodatage (posés par l'AuditService) ────────────────────
    id: { kind: "text", primaryKey: true },
    ts: { kind: "epochMs", notNull: true },

    // ── Classification ──────────────────────────────────────────────────────
    category: { kind: "text", notNull: true },
    action: { kind: "text", notNull: true },
    outcome: { kind: "text", notNull: true },

    // ── Contexte (tous NULLABLE — libellés d'identité, jamais un secret) ────
    actor: { kind: "text" },
    resource: { kind: "text" },
    reason: { kind: "text" },
    ip: { kind: "text" },
    userAgent: { kind: "text" },
    requestId: { kind: "text" },

    // ── Présence de matériel sensible + extras (JSON, jamais la valeur) ─────
    flags: { kind: "json" },
    metadata: { kind: "json" },
  },
  indexes: [
    { name: "audit_event_ts_idx", on: ["ts"] },
    { name: "audit_event_category_idx", on: ["category"] },
    { name: "audit_event_actor_idx", on: ["actor"] },
    { name: "audit_event_requestId_idx", on: ["requestId"] },
  ],
} satisfies IFrameworkTableSpec;

/** Factory de la table du journal (mémoïsée — une instance par dialecte). */
export const createAuditEventTable = createFrameworkTableFactory(
  AUDIT_EVENT_TABLE_SPEC,
);

/**
 * Variante SQLite de la table (dialecte par défaut) — export conservé pour
 * l'usage direct/banc-test.
 */
export const auditEventTable: SQLiteTable = createAuditEventTable("sqlite");

/**
 * Forme plate d'une ligne du journal d'audit. Miroir d'`IAuditEvent` avec les
 * champs optionnels rendus explicitement `| null` (colonnes NULLABLE SQL). Le
 * store mappe `null` ↔ `undefined` aux frontières.
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
 * Le `connector` est **dynamique** (nom du connecteur de l'app, ex. `"default"`) et la
 * variante de table suit le dialecte du connecteur (auto-register
 * `registerStores.ts` à `onKernelRegister`). À enregistrer dans `entityRegistry`
 * **avant** `orm.connect()` (cf {@link registerAuditEntities}).
 *
 * @param orm - clé de l'ORM cible dans le `ormRegistry`.
 * @param dialect - dialecte SQL du connecteur (sélectionne la variante de table).
 * @returns le descripteur {@link IEntity} du journal d'audit.
 */
export function createAuditEntities(
  connector: string,
  dialect: SqlDialect = "sqlite",
): IEntity[] {
  // `module: "security"` → la table est regroupée sous @nodefony/security dans
  // l'ERD Studio (l'audit est une feature security, hébergée par l'ORM).
  return [
    {
      connector,
      name: AUDIT_ENTITY_NAMES.events,
      module: "security",
      schema: createAuditEventTable(dialect),
    },
  ];
}

/**
 * Enregistre les entités du journal d'audit dans le `entityRegistry` pour un ORM
 * donné. À appeler **avant** `orm.connect()` (l'adapter crée les tables au connect).
 *
 * @param connector - nom de la connexion cible (clé du registre).
 * @param dialect - dialecte SQL du connecteur (variante de table — défaut `sqlite`).
 */
export function registerAuditEntities(
  connector: string,
  dialect: SqlDialect = "sqlite",
): void {
  for (const entity of createAuditEntities(connector, dialect)) {
    entityRegistry.register(entity);
  }
}
