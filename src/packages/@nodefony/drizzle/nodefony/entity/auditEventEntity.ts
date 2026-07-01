import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { entityRegistry } from "@nodefony/orm-core";
import type { IEntity } from "@nodefony/orm-core";
// `import type` UNIQUEMENT → effacé à la compilation (approche B : 0 dépendance
// runtime de `@nodefony/drizzle` vers `@nodefony/security`, l'ORM reste pur).
import type {
  AuditCategory,
  AuditOutcome,
  IAuditEventFlags,
} from "@nodefony/security";

/**
 * Table Drizzle du **journal d'audit** `@nodefony/security` (schema-as-code) —
 * implémentation SQL d'`IAuditStore` (append-only, tamper-evident). Driver
 * `better-sqlite3` ; Postgres/MySQL par simple changement de driver (le store
 * n'utilise que des colonnes portables + le query builder dialect-agnostique).
 *
 * **Liaison ORM dynamique** (pattern `tokenEntity`, pas `@entity` figé) : en
 * approche B, c'est l'**application** qui câble le store (`registerAuditStore`) ET
 * le connecteur cible (`registerAuditEntities(orm)`) — le module drizzle
 * n'auto-enregistre rien. La table est statique, sa liaison dépend de la config.
 *
 * ⚠️ **Horodatage en epoch ms (`integer` mode number)** : `IAuditEvent.ts` porte
 * un `number` (`Date.now()`), pas une `Date`. `AuditEventRow` (forme repository)
 * est **identique** à `IAuditEvent` (champs optionnels ⇒ colonnes NULLABLE) → zéro
 * mapping surprise store ↔ entité.
 *
 * ⚠️ **Pas de `.default()` SQL** : le DDL dérivé (`getTableConfig`) n'émet ni
 * `DEFAULT` ni index séparés. Les `index()` ci-dessous sont lus par `drizzle-kit`
 * (migrations prod) et sans effet sur le DDL dev/test (perf de filtrage seule,
 * jamais de sémantique) — ils couvrent les axes de la console d'audit (`ts` pour
 * la pagination chronologique, `category`/`actor`/`requestId` pour les filtres).
 */
export const auditEventTable = sqliteTable(
  "audit_event",
  {
    // ── Identité + horodatage (posés par l'AuditService) ──────────────────────
    id: text("id").primaryKey(),
    ts: integer("ts").notNull(),

    // ── Classification ────────────────────────────────────────────────────────
    category: text("category").$type<AuditCategory>().notNull(),
    action: text("action").notNull(),
    outcome: text("outcome").$type<AuditOutcome>().notNull(),

    // ── Contexte (tous NULLABLE — libellés d'identité, jamais un secret) ──────
    actor: text("actor"),
    resource: text("resource"),
    reason: text("reason"),
    ip: text("ip"),
    userAgent: text("userAgent"),
    requestId: text("requestId"),

    // ── Présence de matériel sensible + extras (JSON, jamais la valeur) ───────
    flags: text("flags", { mode: "json" }).$type<IAuditEventFlags>(),
    metadata: text("metadata", { mode: "json" }).$type<
      Record<string, unknown>
    >(),
  },
  (t) => ({
    tsIdx: index("audit_event_ts_idx").on(t.ts),
    categoryIdx: index("audit_event_category_idx").on(t.category),
    actorIdx: index("audit_event_actor_idx").on(t.actor),
    requestIdIdx: index("audit_event_requestId_idx").on(t.requestId),
  }),
);

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
 * L'`orm` est **dynamique** (nom du connecteur de l'app, ex. `"default"`) : la
 * table est statique mais sa liaison à un ORM dépend de la config → on ne peut pas
 * la figer via `@entity`. À enregistrer dans `entityRegistry` **avant**
 * `orm.connect()` (cf {@link registerAuditEntities}).
 *
 * @param orm - clé de l'ORM cible dans le `ormRegistry`.
 * @returns le descripteur {@link IEntity} du journal d'audit.
 */
export function createAuditEntities(orm: string): IEntity[] {
  // `module: "security"` → la table est regroupée sous @nodefony/security dans
  // l'ERD Studio (l'audit est une feature security, hébergée par l'ORM).
  return [
    {
      orm,
      name: AUDIT_ENTITY_NAMES.events,
      module: "security",
      schema: auditEventTable,
    },
  ];
}

/**
 * Enregistre les entités du journal d'audit dans le `entityRegistry` pour un ORM
 * donné. À appeler **avant** `orm.connect()` (l'adapter crée les tables au connect).
 *
 * @param orm - clé de l'ORM cible.
 */
export function registerAuditEntities(orm: string): void {
  for (const entity of createAuditEntities(orm)) {
    entityRegistry.register(entity);
  }
}
