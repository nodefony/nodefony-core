import type { IAuditEvent } from "../../contracts/IAuditEvent";
import type {
  IAuditQuery,
  IAuditQueryResult,
  IAuditStore,
} from "../../contracts/IAuditStore";

/** Instantané sérialisable du journal mémoire (persistance fichier + tests). */
export interface AuditStoreSnapshot {
  events: IAuditEvent[];
}

const DEFAULT_MAX_ENTRIES = 10_000;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/**
 * Journal d'audit **en mémoire** — implémentation de référence d'{@link IAuditStore}.
 *
 * 0 dépendance, idéal pour le dev mono-process et les **tests**. **Volatile**
 * (perdu au redémarrage) et **non partagé** (per-pod) → en prod multi-process,
 * brancher un backend ORM/Redis. Le volume est **borné** (`maxEntries`, FIFO : au
 * delà, le plus ancien tombe) pour ne JAMAIS fuir, doublé d'une purge par âge
 * ({@link MemoryAuditStore.gc}, rétention). Append-only : aucune mutation d'un
 * événement déjà journalisé.
 *
 * Horloge injectable (`now`) pour des tests déterministes (pattern `MemoryTokenStore`).
 */
export class MemoryAuditStore implements IAuditStore {
  /** Événements en ordre d'insertion (ancien → récent). FIFO borné. */
  readonly #events: IAuditEvent[] = [];
  readonly #now: () => number;
  readonly #maxEntries: number;
  /** Fenêtre de rétention (ms) — au-delà, `gc` purge. */
  readonly #retentionMs: number;

  constructor(
    now: () => number = Date.now,
    retentionMs: number = 365 * 24 * 3_600_000, // 365 jours
    maxEntries: number = DEFAULT_MAX_ENTRIES,
  ) {
    this.#now = now;
    this.#retentionMs = retentionMs;
    this.#maxEntries = maxEntries;
  }

  append(event: IAuditEvent): Promise<void> {
    this.#events.push(event);
    // Borne de volume (anti-fuite) : le plus ancien tombe. Le gc temporel
    // (rétention) gère l'âge ; ici on protège la mémoire du pod en continu.
    if (this.#events.length > this.#maxEntries) {
      this.#events.shift();
    }
    return Promise.resolve();
  }

  query(filter: IAuditQuery = {}): Promise<IAuditQueryResult> {
    const limit = Math.min(
      Math.max(1, filter.limit ?? DEFAULT_LIMIT),
      MAX_LIMIT,
    );
    // Collecte filtrée en ordre d'insertion (ancien → récent).
    const matched: IAuditEvent[] = [];
    for (let i = 0; i < this.#events.length; i++) {
      const event = this.#events[i]!;
      if (this.#matches(event, filter)) {
        matched.push(event);
      }
    }
    const total = matched.length;
    // On rend du plus récent au plus ancien ; `before` borne vers le passé.
    let end = matched.length; // exclusif
    if (filter.before !== undefined) {
      const idx = matched.findIndex((event) => event.id === filter.before);
      if (idx >= 0) {
        end = idx; // ne garder que ce qui PRÉCÈDE le curseur (plus ancien)
      }
    }
    const start = Math.max(0, end - limit);
    const pageAsc = matched.slice(start, end);
    // Curseur suivant = le plus ancien de la page (calculé AVANT le reverse).
    const nextBefore = start > 0 && pageAsc.length > 0 ? pageAsc[0]!.id : null;
    pageAsc.reverse(); // récent → ancien
    return Promise.resolve({ events: pageAsc, nextBefore, total });
  }

  gc(now: number = this.#now()): Promise<number> {
    const threshold = now - this.#retentionMs;
    let purged = 0;
    // FIFO par ts croissant : les plus vieux sont en tête → shift tant que trop vieux.
    while (this.#events.length > 0 && this.#events[0]!.ts < threshold) {
      this.#events.shift();
      purged++;
    }
    return Promise.resolve(purged);
  }

  #matches(event: IAuditEvent, filter: IAuditQuery): boolean {
    if (filter.category !== undefined && event.category !== filter.category) {
      return false;
    }
    if (filter.outcome !== undefined && event.outcome !== filter.outcome) {
      return false;
    }
    if (filter.actor !== undefined && event.actor !== filter.actor) {
      return false;
    }
    if (filter.action !== undefined && event.action !== filter.action) {
      return false;
    }
    if (
      filter.requestId !== undefined &&
      event.requestId !== filter.requestId
    ) {
      return false;
    }
    if (filter.since !== undefined && event.ts < filter.since) {
      return false;
    }
    if (filter.until !== undefined && event.ts > filter.until) {
      return false;
    }
    return true;
  }

  /** Nombre d'événements actuellement retenus (introspection / tests). */
  get size(): number {
    return this.#events.length;
  }

  /** Instantané sérialisable de l'état courant. */
  snapshot(): AuditStoreSnapshot {
    return { events: [...this.#events] };
  }

  /** Remplace l'état par celui d'un instantané. */
  restore(snapshot: AuditStoreSnapshot): void {
    this.#events.length = 0;
    for (const event of snapshot.events) {
      this.#events.push(event);
    }
  }
}
