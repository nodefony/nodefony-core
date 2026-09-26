import type { IPage } from "nodefony";
import { assertPageQuery } from "nodefony";
// `import type` du contrat (via `@nodefony/security`) → effacé à la compilation :
// 0 dépendance runtime de l'ORM vers la couche sécurité (approche B). C'est
// l'auto-register du module (`registerStores.ts`) qui câble la fabrique.
import type {
  IAuditEvent,
  IAuditListQuery,
  IAuditStore,
} from "@nodefony/security";
import type { Connection, Model } from "mongoose";
import type { MongooseOrm } from "./orm-core/index";
import {
  AUDIT_ENTITY_NAMES,
  type AuditEventRow,
} from "../entity/auditEventEntity";

/** Modèle Mongoose à document libre (boundary — comme `MongooseRepository`). */
type LooseModel = Model<Record<string, unknown>>;

/** Rétention par défaut d'un événement : 365 jours (aligné `MemoryAuditStore`). */
const DEFAULT_RETENTION_MS = 365 * 24 * 3_600_000;

/** Taille de page par défaut / plafond (alignés `MemoryAuditStore`). */
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/** Séparateur du curseur composite `<ts>:<id>` (cf `#parseCursor`). */
const CURSOR_SEPARATOR = ":";

/**
 * Journal d'audit **Mongoose** (NoSQL) — implémentation documentaire d'
 * {@link IAuditStore} (append-only, tamper-evident) pour la **rétention longue**
 * et le **partage cross-pod**, là où le store mémoire par défaut reste affine à
 * un pod et volatile. Pendant documentaire de `DrizzleAuditStore`.
 *
 * **Append-only** : `append` est la seule écriture ; aucune mutation ni
 * suppression ciblée d'un événement — seul {@link MongooseAuditStore.gc}
 * (rétention) retire des documents. L'immuabilité EST la garantie d'audit.
 *
 * **Pagination curseur EXACTE (`listPage`)** — l'ordre total est `(ts DESC, _id
 * DESC)` : `ts` porte l'ordre chronologique, `_id` (= l'id d'événement) casse
 * les collisions à la milliseconde (rafales de login). Le curseur transporte
 * **les deux** (`<ts>:<id>`) et se compare en **composite** — en Mongo, un `$or`
 * de deux clauses, qui sort du `Criteria` AND-only d'`IRepository`, d'où la
 * query native (même trappe que le frère SQL). Une ligne de garde (`limit + 1`)
 * détermine `hasNext` sans page vide parasite.
 *
 * ⚠️ **Le tri se fait sur `_id`, jamais sur un champ `id`** : au repos un
 * document Mongo n'a PAS de champ `id` (c'est un virtuel de lecture), et Mongo
 * ne se plaint pas d'un tri sur un champ absent — il rend un ordre arbitraire.
 * Un ordre total qui n'ordonne rien casserait le curseur en silence.
 *
 * **Résolution LAZY + dégradation gracieuse** (calqué sur le frère SQL) : le
 * modèle est résolu à CHAQUE appel, pas capturé à la construction — l'ORM se
 * déconnecte au shutdown avant le drain des serveurs, et un `connect()` rejoué
 * recrée la connexion. Si l'ORM n'est pas connecté : `append` est un no-op
 * **best-effort** (l'audit ne bloque ni ne fait échouer le flux métier — un
 * événement au shutdown est perdu plutôt que de crasher un login), `listPage`
 * rend une page vide et `gc` rend 0.
 *
 * Horloge injectable (`now`) pour des tests déterministes.
 */
export class MongooseAuditStore implements IAuditStore {
  readonly #resolveModel: () => LooseModel | null;
  readonly #now: () => number;
  readonly #retentionMs: number;

  /**
   * @param resolveModel - résolveur **lazy** du modèle Mongoose (`null` = ORM non
   *   connecté → dégradation gracieuse).
   * @param now - horloge (epoch ms) injectable pour des tests déterministes.
   * @param retentionMs - fenêtre de rétention (ms) avant purge par `gc`.
   */
  constructor(
    resolveModel: () => LooseModel | null,
    now: () => number = Date.now,
    retentionMs: number = DEFAULT_RETENTION_MS,
  ) {
    this.#resolveModel = resolveModel;
    this.#now = now;
    this.#retentionMs = retentionMs;
  }

  /** Connecteur ORM qui porte ce store — posé par {@link MongooseAuditStore.from}. */
  #connector: string | undefined;

  /**
   * Connecteur ORM qui porte ce store, lu par `readStoreConnector` pour le
   * registre des stores : la console rattache la brique à SON connecteur au
   * lieu de le déduire. `undefined` pour un store construit sans ORM (bancs).
   */
  get connector(): string | undefined {
    return this.#connector;
  }

  /**
   * Construit le store depuis un {@link MongooseOrm}. Le modèle est résolu
   * **lazy** (gardé par `isConnected()` → `null` tant que l'ORM n'est pas/plus
   * connecté). L'entité (`registerAuditEntities`) doit avoir été enregistrée
   * **avant** `orm.connect()` (le modèle est compilé au connect).
   *
   * @param orm - ORM Mongoose hébergeant la collection `audit_event`.
   * @param now - horloge injectable (tests).
   * @param retentionMs - fenêtre de rétention (ms).
   */
  static from(
    orm: MongooseOrm,
    now?: () => number,
    retentionMs?: number,
  ): MongooseAuditStore {
    const store = new MongooseAuditStore(
      () => {
        if (!orm.isConnected()) {
          return null;
        }
        const connection = orm.getNativeConnection<Connection>();
        return connection.model<Record<string, unknown>>(
          AUDIT_ENTITY_NAMES.events,
        );
      },
      now,
      retentionMs,
    );
    store.#connector = orm.name;
    return store;
  }

  async append(event: IAuditEvent): Promise<void> {
    const model = this.#resolveModel();
    if (!model) {
      return; // ORM non connecté (boot/shutdown) → best-effort no-op.
    }
    // INSERT immuable. `_id` porte l'id d'événement (Mongo ne le génère pas) ;
    // les champs optionnels du contrat tombent sur `null` au repos, ce qui rend
    // le document comparable à sa ligne SQL champ pour champ.
    await model.create({
      _id: event.id,
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
    assertPageQuery(query, "cursor");
    const limit = Math.min(
      Math.max(1, query.limit ?? DEFAULT_LIMIT),
      MAX_LIMIT,
    );
    const model = this.#resolveModel();
    if (!model) {
      return { items: [], limit, hasNext: false, nextCursor: null, total: 0 };
    }
    const filter = this.#buildFilter(query);

    // Total = tous les événements du filtre (hors curseur). Refusable
    // (`withTotal: false`) : un COUNT filtré sur une rétention longue se paie.
    let total: number | undefined;
    if (query.withTotal !== false) {
      total = await model.countDocuments(filter).exec();
    }

    // Curseur AUTO-PORTANT `(ts, id)` : aucune résolution préalable (un
    // curseur-id exigerait un findOne, et rembobinerait en silence si
    // l'événement avait été purgé entre deux pages).
    let where = filter;
    const cursor = this.#parseCursor(query.cursor);
    if (cursor) {
      const after = {
        $or: [
          { ts: { $lt: cursor.ts } },
          { ts: cursor.ts, _id: { $lt: cursor.id } },
        ],
      };
      // `$and` explicite : le filtre porte peut-être DÉJÀ un `$or` (aucun
      // aujourd'hui, mais un ajout futur de filtre l'écraserait en silence —
      // deux clés `$or` dans le même objet, la seconde gagne).
      where =
        Object.keys(filter).length > 0 ? { $and: [filter, after] } : after;
    }

    // Ordre total (ts DESC, _id DESC) ; `limit + 1` = ligne de garde pour savoir
    // s'il reste une page (hasNext) sans risquer une page suivante vide.
    const docs = await model
      .find(where)
      .sort({ ts: -1, _id: -1 })
      .limit(limit + 1)
      .exec();

    const hasNext = docs.length > limit;
    const page = hasNext ? docs.slice(0, limit) : docs;
    const rows = page.map(
      (doc) => doc.toObject({ virtuals: true }) as unknown as AuditEventRow,
    );
    const items = rows.map((row) => this.#toEvent(row));
    const last = rows[rows.length - 1];
    return {
      items,
      limit,
      hasNext,
      nextCursor:
        hasNext && last
          ? `${last.ts}${CURSOR_SEPARATOR}${this.#idOf(last)}`
          : null,
      ...(total !== undefined ? { total } : {}),
    };
  }

  /**
   * Décode le curseur composite `<ts>:<id>` (format privé au store, comme ses
   * pendants mémoire et SQL). Jeton absent ou malformé → `null` : la lecture
   * repart de la page la plus récente plutôt que d'échouer sur une consultation.
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
    const model = this.#resolveModel();
    if (!model) {
      return 0; // ORM non connecté → rien à purger.
    }
    const threshold = now - this.#retentionMs;
    const result = await model.deleteMany({ ts: { $lt: threshold } }).exec();
    return result.deletedCount ?? 0;
  }

  /** Compose le filtre Mongo des critères AND ; `{}` si aucun (= tout). */
  #buildFilter(filter: IAuditListQuery): Record<string, unknown> {
    const where: Record<string, unknown> = {};
    if (filter.category !== undefined) {
      where.category = filter.category;
    }
    if (filter.outcome !== undefined) {
      where.outcome = filter.outcome;
    }
    if (filter.actor !== undefined) {
      where.actor = filter.actor;
    }
    if (filter.action !== undefined) {
      where.action = filter.action;
    }
    if (filter.requestId !== undefined) {
      where.requestId = filter.requestId;
    }
    if (filter.since !== undefined || filter.until !== undefined) {
      const ts: Record<string, number> = {};
      if (filter.since !== undefined) {
        ts.$gte = filter.since;
      }
      if (filter.until !== undefined) {
        ts.$lte = filter.until;
      }
      where.ts = ts;
    }
    return where;
  }

  /** Identité réelle d'un événement : `_id` fait foi, le virtuel `id` en repli. */
  #idOf(row: AuditEventRow): string {
    return (row as { _id?: string })._id ?? row.id;
  }

  /**
   * Mappe un document vers un événement du contrat.
   *
   * Les champs optionnels (`flags`, `metadata`) ne sont posés que s'ils portent
   * une valeur : `IAuditEvent` les déclare **absents**, pas `null`, et un banc de
   * parité compare les événements relus à ceux qui ont été écrits.
   */
  #toEvent(row: AuditEventRow): IAuditEvent {
    const event: IAuditEvent = {
      id: this.#idOf(row),
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
