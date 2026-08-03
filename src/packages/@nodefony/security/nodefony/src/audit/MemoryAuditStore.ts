import type { IPage } from "nodefony";
import { assertPageQuery } from "nodefony";
import type { IAuditEvent } from "../../contracts/IAuditEvent";
import type { IAuditListQuery, IAuditStore } from "../../contracts/IAuditStore";

/** Instantané sérialisable du journal mémoire (persistance fichier + tests). */
export interface AuditStoreSnapshot {
  events: IAuditEvent[];
}

const DEFAULT_MAX_ENTRIES = 10_000;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/**
 * Sépare les deux composantes du curseur. Le curseur est **composite**
 * (`<ts>:<id>`) et non un id nu : il se suffit à lui-même, donc une page reste
 * exacte même si l'événement qui l'a produite a été purgé entre-temps par
 * {@link MemoryAuditStore.gc} (un id nu, lui, n'aurait plus rien à résoudre →
 * curseur ignoré → retour silencieux à la première page).
 *
 * Format **privé au store** : l'appelant repasse le jeton tel quel.
 */
const CURSOR_SEPARATOR = ":";

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

  listPage(query: IAuditListQuery): Promise<IPage<IAuditEvent>> {
    assertPageQuery(query, "cursor");
    const limit = Math.min(
      Math.max(1, query.limit ?? DEFAULT_LIMIT),
      MAX_LIMIT,
    );
    // Collecte filtrée (ordre d'insertion : ancien → récent).
    const matched: IAuditEvent[] = [];
    for (let i = 0; i < this.#events.length; i++) {
      const event = this.#events[i]!;
      if (this.#matches(event, query)) {
        matched.push(event);
      }
    }
    const total = matched.length;
    // Ordre total (ts DESC, id DESC) — le même que le backend SQL. L'ordre
    // d'insertion ne suffit PAS : deux événements de la même milliseconde
    // (rafale de login) doivent être départagés par leur id, sinon le curseur
    // composite pourrait sauter ou répéter l'un d'eux.
    //
    // Cet ordre est IMPOSÉ, pas un défaut : c'est celui qu'encode le curseur.
    // Un `order` reçu est donc refusé en amont par `assertPageQuery(…,
    // "cursor")` — jamais avalé en silence. Et il ne passe PAS par
    // `compareByOrder` du cœur : celui-ci compare les chaînes en
    // `localeCompare`, là où `#parseCursor` départage les id en comparaison
    // BRUTE (`<`). Deux ordres différents pour la même page feraient sauter des
    // lignes au tour suivant — les deux comparaisons doivent rester identiques.
    matched.sort((a, b) =>
      a.ts !== b.ts ? b.ts - a.ts : a.id < b.id ? 1 : -1,
    );
    // Curseur : ne garder que ce qui SUIT le jeton dans cet ordre (plus ancien).
    let page = matched;
    const cursor = this.#parseCursor(query.cursor);
    if (cursor) {
      const from = matched.findIndex(
        (event) =>
          event.ts < cursor.ts ||
          (event.ts === cursor.ts && event.id < cursor.id),
      );
      page = from >= 0 ? matched.slice(from) : [];
    }
    const hasNext = page.length > limit;
    const items = hasNext ? page.slice(0, limit) : page;
    const last = items[items.length - 1];
    return Promise.resolve({
      items,
      limit,
      hasNext,
      nextCursor:
        hasNext && last ? `${last.ts}${CURSOR_SEPARATOR}${last.id}` : null,
      ...(query.withTotal === false ? {} : { total }),
    });
  }

  /**
   * Décode le curseur composite. Un jeton absent ou malformé (forgé — le nôtre
   * ne l'est jamais) rend `null` : la lecture repart de la page la plus récente,
   * jamais d'erreur sur un chemin de consultation.
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

  #matches(event: IAuditEvent, filter: IAuditListQuery): boolean {
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
