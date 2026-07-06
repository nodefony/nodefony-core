import { and, count, desc, eq, gte, lt, lte, or } from "drizzle-orm";
// `import type` du contrat (via `@nodefony/security`) → effacé à la compilation :
// 0 dépendance runtime de l'ORM vers la couche sécurité (approche B). L'application
// câble le store (`registerAuditStore("drizzle", …)`) + l'entité
// (`registerAuditEntities(orm)` avant `orm.connect()`).
import type {
  IAuditEvent,
  IAuditQuery,
  IAuditQueryResult,
  IAuditStore,
} from "@nodefony/security";
import type { DrizzleDb } from "./orm-core/DrizzleRepository";
import type { DrizzleOrm } from "./orm-core/DrizzleOrm";
import {
  auditEventTable,
  type AuditEventRow,
} from "../entity/auditEventEntity";

/** Table du journal telle que consommée par le store (variante SQLite par défaut). */
type AuditEventTable = typeof auditEventTable;

/** Rétention par défaut d'un événement : 365 jours (aligné `MemoryAuditStore`). */
const DEFAULT_RETENTION_MS = 365 * 24 * 3_600_000;

/** Taille de page par défaut / plafond (alignés `MemoryAuditStore`). */
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/**
 * Journal d'audit **Drizzle** (driver `better-sqlite3` en test, Postgres/MySQL en
 * prod) — implémentation SQL d'{@link IAuditStore} (append-only, tamper-evident)
 * pour la **rétention longue** et le **partage cross-pod**, là où le store mémoire
 * par défaut reste affine à un pod et volatile.
 *
 * **Append-only** : `append` est la seule écriture (INSERT) ; aucune mutation ni
 * suppression ciblée d'un événement — seul {@link DrizzleAuditStore.gc} (rétention)
 * retire des lignes. L'immuabilité EST la garantie d'audit.
 *
 * **Pagination curseur EXACTE (`query`)** — via le query builder Drizzle
 * (dialect-agnostique), l'ordre total est `(ts DESC, id DESC)` : `ts` porte l'ordre
 * chronologique, `id` casse les collisions à la milliseconde (rafales de login). Le
 * curseur `before` (id) est résolu par une comparaison **composite**
 * `(ts, id) < (cursorTs, cursorId)` — non exprimable en critère `IRepository`
 * AND-only, d'où la trappe native (ADR-0003, comme `DrizzleIdempotencyStore`). Une
 * ligne de garde (`limit + 1`) détermine `nextBefore` sans page vide parasite.
 *
 * **Résolution LAZY + dégradation gracieuse** (calqué sur les stores frères) : le
 * handle Drizzle est résolu à CHAQUE appel, pas capturé à la construction — l'ordre
 * de boot n'est pas garanti (l'app câble à `onKernelBoot`, l'ORM peut n'être pas
 * encore connecté) et l'ORM se déconnecte au shutdown avant le drain des serveurs.
 * Si le handle est `null` : `append` est un no-op **best-effort** (l'audit ne
 * bloque ni ne fait échouer le flux métier — un événement au boot/shutdown est
 * perdu plutôt que de crasher un login), `query` rend une page vide et `gc` rend 0.
 *
 * Horloge injectable (`now`) pour des tests déterministes.
 */
export class DrizzleAuditStore implements IAuditStore {
  readonly #resolveDb: () => DrizzleDb | null;
  readonly #table: AuditEventTable;
  readonly #now: () => number;
  readonly #retentionMs: number;
  readonly #location: string | undefined;

  /**
   * @param resolveDb - résolveur **lazy** du handle Drizzle (`null` = ORM non
   *   connecté → dégradation gracieuse).
   * @param now - horloge (epoch ms) injectable pour des tests déterministes.
   * @param retentionMs - fenêtre de rétention (ms) avant purge par `gc`.
   * @param table - variante de table à utiliser (dialecte). Défaut = SQLite.
   * @param location - emplacement physique de la base (fichier SQLite) pour Studio
   *   ({@link DrizzleOrm.location}) ; `undefined` pour un backend réseau/`:memory:`.
   */
  constructor(
    resolveDb: () => DrizzleDb | null,
    now: () => number = Date.now,
    retentionMs: number = DEFAULT_RETENTION_MS,
    table: AuditEventTable = auditEventTable,
    location?: string,
  ) {
    this.#resolveDb = resolveDb;
    this.#table = table;
    this.#now = now;
    this.#retentionMs = retentionMs;
    this.#location = location;
  }

  /**
   * Emplacement physique de la base (fichier SQLite) pour l'écran Studio « Stores »
   * — lu par `readStoreLocation`. `undefined` = backend réseau ou `:memory:`.
   */
  get location(): string | undefined {
    return this.#location;
  }

  /**
   * Construit le store depuis un {@link DrizzleOrm}. Le handle est résolu **lazy**
   * (gardé par `isConnected()` → `null` tant que l'ORM n'est pas/plus connecté).
   * L'entité (`registerAuditEntities`) doit avoir été enregistrée **avant**
   * `orm.connect()` (la table est créée au connect).
   *
   * @param orm - ORM Drizzle hébergeant la table `audit_event`.
   * @param now - horloge injectable (tests).
   * @param retentionMs - fenêtre de rétention (ms).
   */
  static from(
    orm: DrizzleOrm,
    now?: () => number,
    retentionMs?: number,
  ): DrizzleAuditStore {
    return new DrizzleAuditStore(
      () => (orm.isConnected() ? orm.getNativeConnection<DrizzleDb>() : null),
      now,
      retentionMs,
      auditEventTable,
      orm.location,
    );
  }

  async append(event: IAuditEvent): Promise<void> {
    const db = this.#resolveDb();
    if (!db) {
      return; // ORM non connecté (boot/shutdown) → best-effort no-op.
    }
    // INSERT immuable : les champs optionnels d'IAuditEvent tombent sur NULL en SQL.
    await db.insert(this.#table).values({
      id: event.id,
      ts: event.ts,
      category: event.category,
      action: event.action,
      outcome: event.outcome,
      actor: event.actor ?? null,
      resource: event.resource ?? null,
      reason: event.reason ?? null,
      ip: event.ip ?? null,
      userAgent: event.userAgent ?? null,
      requestId: event.requestId ?? null,
      flags: event.flags ?? null,
      metadata: event.metadata ?? null,
    });
  }

  async query(filter: IAuditQuery = {}): Promise<IAuditQueryResult> {
    const db = this.#resolveDb();
    if (!db) {
      return { events: [], nextBefore: null, total: 0 };
    }
    const table = this.#table;
    const limit = Math.min(
      Math.max(1, filter.limit ?? DEFAULT_LIMIT),
      MAX_LIMIT,
    );
    const filterWhere = this.#buildFilter(filter);

    // Total = tous les événements du filtre (hors pagination/curseur).
    const totalRows = (await db
      .select({ n: count() })
      .from(table)
      .where(filterWhere)) as Array<{ n: number }>;
    const total = Number(totalRows[0]?.n ?? 0);

    // Curseur : ne garder que ce qui PRÉCÈDE (ts, id) de l'événement `before`.
    let where = filterWhere;
    if (filter.before !== undefined) {
      const curRows = (await db
        .select({ ts: table.ts, id: table.id })
        .from(table)
        .where(eq(table.id, filter.before))
        .limit(1)) as Array<{ ts: number; id: string }>;
      const cur = curRows[0];
      if (cur) {
        const cursorCond = or(
          lt(table.ts, cur.ts),
          and(eq(table.ts, cur.ts), lt(table.id, cur.id)),
        );
        where = filterWhere ? and(filterWhere, cursorCond) : cursorCond;
      }
    }

    // Ordre total (ts DESC, id DESC) ; `limit + 1` = ligne de garde pour savoir
    // s'il reste une page (nextBefore) sans risquer une page suivante vide.
    const rows = (await db
      .select()
      .from(table)
      .where(where)
      .orderBy(desc(table.ts), desc(table.id))
      .limit(limit + 1)) as AuditEventRow[];

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const events = pageRows.map((row) => this.#toEvent(row));
    const nextBefore = hasMore ? pageRows[pageRows.length - 1]!.id : null;
    return { events, nextBefore, total };
  }

  async gc(now: number = this.#now()): Promise<number> {
    const db = this.#resolveDb();
    if (!db) {
      return 0; // ORM non connecté → rien à purger.
    }
    const threshold = now - this.#retentionMs;
    const result = (await db
      .delete(this.#table)
      .where(lt(this.#table.ts, threshold))) as { changes?: number };
    return result.changes ?? 0;
  }

  /** Compose la clause `WHERE` des filtres AND ; `undefined` si aucun (= tout). */
  #buildFilter(filter: IAuditQuery) {
    const table = this.#table;
    const clauses = [];
    if (filter.category !== undefined) {
      clauses.push(eq(table.category, filter.category));
    }
    if (filter.outcome !== undefined) {
      clauses.push(eq(table.outcome, filter.outcome));
    }
    if (filter.actor !== undefined) {
      clauses.push(eq(table.actor, filter.actor));
    }
    if (filter.action !== undefined) {
      clauses.push(eq(table.action, filter.action));
    }
    if (filter.requestId !== undefined) {
      clauses.push(eq(table.requestId, filter.requestId));
    }
    if (filter.since !== undefined) {
      clauses.push(gte(table.ts, filter.since));
    }
    if (filter.until !== undefined) {
      clauses.push(lte(table.ts, filter.until));
    }
    return clauses.length > 0 ? and(...clauses) : undefined;
  }

  /** Mappe une ligne SQL vers un événement (NULL → optionnel absent). */
  #toEvent(row: AuditEventRow): IAuditEvent {
    const event: IAuditEvent = {
      id: row.id,
      ts: row.ts,
      category: row.category,
      action: row.action,
      outcome: row.outcome,
      actor: row.actor,
      resource: row.resource,
      reason: row.reason,
      ip: row.ip,
      userAgent: row.userAgent,
      requestId: row.requestId,
    };
    if (row.flags) {
      event.flags = row.flags;
    }
    if (row.metadata) {
      event.metadata = row.metadata;
    }
    return event;
  }
}
