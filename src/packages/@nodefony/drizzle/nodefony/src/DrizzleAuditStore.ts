import { and, count, desc, eq, gte, lt, lte, or } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
// `import type` du contrat (via `@nodefony/security`) → effacé à la compilation :
// 0 dépendance runtime de l'ORM vers la couche sécurité (approche B). L'application
// câble le store (`registerAuditStore("drizzle", …)`) + l'entité
// (`registerAuditEntities(orm)` avant `orm.connect()`).
import type { IPage } from "nodefony";
import type {
  IAuditEvent,
  IAuditListQuery,
  IAuditStore,
} from "@nodefony/security";
import {
  execTable,
  type DrizzleDb,
  type DrizzleTable,
} from "./orm-core/DrizzleRepository";
import type { DrizzleOrm } from "./orm-core/DrizzleOrm";
import {
  auditEventTable,
  createAuditEventTable,
  type AuditEventRow,
} from "../entity/auditEventEntity";

/** Rétention par défaut d'un événement : 365 jours (aligné `MemoryAuditStore`). */
const DEFAULT_RETENTION_MS = 365 * 24 * 3_600_000;

/** Taille de page par défaut / plafond (alignés `MemoryAuditStore`). */
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/** Séparateur du curseur composite `<ts>:<id>` (cf `#parseCursor`). */
const CURSOR_SEPARATOR = ":";

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
 * **Pagination curseur EXACTE (`listPage`)** — via le query builder Drizzle
 * (dialect-agnostique), l'ordre total est `(ts DESC, id DESC)` : `ts` porte l'ordre
 * chronologique, `id` casse les collisions à la milliseconde (rafales de login). Le
 * curseur transporte **les deux** (`<ts>:<id>`) et se compare en **composite**
 * `(ts, id) < (cursorTs, cursorId)` — non exprimable en critère `IRepository`
 * AND-only, d'où la trappe native (ADR-0003, comme `DrizzleIdempotencyStore`). Une
 * ligne de garde (`limit + 1`) détermine `hasNext` sans page vide parasite.
 *
 * **Résolution LAZY + dégradation gracieuse** (calqué sur les stores frères) : le
 * handle Drizzle est résolu à CHAQUE appel, pas capturé à la construction — l'ordre
 * de boot n'est pas garanti (l'app câble à `onKernelBoot`, l'ORM peut n'être pas
 * encore connecté) et l'ORM se déconnecte au shutdown avant le drain des serveurs.
 * Si le handle est `null` : `append` est un no-op **best-effort** (l'audit ne
 * bloque ni ne fait échouer le flux métier — un événement au boot/shutdown est
 * perdu plutôt que de crasher un login), `listPage` rend une page vide et `gc` rend 0.
 *
 * Horloge injectable (`now`) pour des tests déterministes.
 */
export class DrizzleAuditStore implements IAuditStore {
  readonly #resolveDb: () => DrizzleDb | null;
  readonly #table: DrizzleTable;
  /** Colonnes par nom logique, vue canonique (les specs colKit partagent les
   *  NOMS entre dialectes → le query builder reste dialecte-agnostique). */
  readonly #c: Record<string, SQLiteColumn>;
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
    table: DrizzleTable = auditEventTable,
    location?: string,
  ) {
    this.#resolveDb = resolveDb;
    this.#table = table;
    // Accès colonne par nom logique (gotcha module : vue Record de la table).
    this.#c = execTable(table) as unknown as Record<string, SQLiteColumn>;
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
   * `orm.connect()` (la table est créée au connect) — sur la **variante de table
   * du dialecte de l'ORM** (S3 multi-dialecte).
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
      createAuditEventTable(orm.dialect),
      orm.location,
    );
  }

  async append(event: IAuditEvent): Promise<void> {
    const db = this.#resolveDb();
    if (!db) {
      return; // ORM non connecté (boot/shutdown) → best-effort no-op.
    }
    // INSERT immuable : les champs optionnels d'IAuditEvent tombent sur NULL en SQL.
    await db.insert(execTable(this.#table)).values({
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

  async listPage(query: IAuditListQuery): Promise<IPage<IAuditEvent>> {
    const limit = Math.min(
      Math.max(1, query.limit ?? DEFAULT_LIMIT),
      MAX_LIMIT,
    );
    const db = this.#resolveDb();
    if (!db) {
      return { items: [], limit, hasNext: false, nextCursor: null, total: 0 };
    }
    const table = execTable(this.#table);
    const c = this.#c;
    const filterWhere = this.#buildFilter(query);

    // Total = tous les événements du filtre (hors pagination/curseur). Refusable
    // (`withTotal: false`) : un COUNT filtré sur une rétention longue se paie.
    let total: number | undefined;
    if (query.withTotal !== false) {
      const totalRows = (await db
        .select({ n: count() })
        .from(table)
        .where(filterWhere)) as Array<{ n: number }>;
      total = Number(totalRows[0]?.n ?? 0);
    }

    // Curseur AUTO-PORTANT `(ts, id)` : aucune résolution préalable (l'ancien
    // curseur-id exigeait un SELECT, et rembobinait en silence si l'événement
    // avait été purgé entre deux pages).
    let where = filterWhere;
    const cursor = this.#parseCursor(query.cursor);
    if (cursor) {
      const cursorCond = or(
        lt(c.ts, cursor.ts),
        and(eq(c.ts, cursor.ts), lt(c.id, cursor.id)),
      );
      where = filterWhere ? and(filterWhere, cursorCond) : cursorCond;
    }

    // Ordre total (ts DESC, id DESC) ; `limit + 1` = ligne de garde pour savoir
    // s'il reste une page (hasNext) sans risquer une page suivante vide.
    const rows = (await db
      .select()
      .from(table)
      .where(where)
      .orderBy(desc(c.ts), desc(c.id))
      .limit(limit + 1)) as AuditEventRow[];

    const hasNext = rows.length > limit;
    const pageRows = hasNext ? rows.slice(0, limit) : rows;
    const items = pageRows.map((row) => this.#toEvent(row));
    const last = pageRows[pageRows.length - 1];
    return {
      items,
      limit,
      hasNext,
      nextCursor:
        hasNext && last ? `${last.ts}${CURSOR_SEPARATOR}${last.id}` : null,
      ...(total !== undefined ? { total } : {}),
    };
  }

  /**
   * Décode le curseur composite `<ts>:<id>` (format privé au store, comme son
   * pendant mémoire). Jeton absent ou malformé → `null` : la lecture repart de
   * la page la plus récente plutôt que d'échouer sur une consultation.
   */
  #parseCursor(cursor?: string): { ts: number; id: string } | null {
    if (cursor === undefined) {
      return null;
    }
    const sep = cursor.indexOf(CURSOR_SEPARATOR);
    if (sep <= 0) {
      return null;
    }
    const ts = Number(cursor.slice(0, sep));
    return Number.isFinite(ts) ? { ts, id: cursor.slice(sep + 1) } : null;
  }

  async gc(now: number = this.#now()): Promise<number> {
    const db = this.#resolveDb();
    if (!db) {
      return 0; // ORM non connecté → rien à purger.
    }
    const threshold = now - this.#retentionMs;
    // Compteur normalisé par driver : better-sqlite3 `{changes}` / pg
    // `{rowCount}` / mysql2 tuple `[ResultSetHeader{affectedRows}, fields]`.
    const result: unknown = await db
      .delete(execTable(this.#table))
      .where(lt(this.#c.ts, threshold));
    if (Array.isArray(result)) {
      return (result[0] as { affectedRows?: number })?.affectedRows ?? 0;
    }
    const r = result as { changes?: number; rowCount?: number | null };
    return r.changes ?? r.rowCount ?? 0;
  }

  /** Compose la clause `WHERE` des filtres AND ; `undefined` si aucun (= tout). */
  #buildFilter(filter: IAuditListQuery) {
    const c = this.#c;
    const clauses = [];
    if (filter.category !== undefined) {
      clauses.push(eq(c.category, filter.category));
    }
    if (filter.outcome !== undefined) {
      clauses.push(eq(c.outcome, filter.outcome));
    }
    if (filter.actor !== undefined) {
      clauses.push(eq(c.actor, filter.actor));
    }
    if (filter.action !== undefined) {
      clauses.push(eq(c.action, filter.action));
    }
    if (filter.requestId !== undefined) {
      clauses.push(eq(c.requestId, filter.requestId));
    }
    if (filter.since !== undefined) {
      clauses.push(gte(c.ts, filter.since));
    }
    if (filter.until !== undefined) {
      clauses.push(lte(c.ts, filter.until));
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
