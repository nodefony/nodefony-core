import type { IPage } from "nodefony";
import type {
  IRateLimitEntry,
  IRateLimitListQuery,
  IRateLimitOptions,
  IRateLimitStore,
  RateLimitVerdict,
} from "./IRateLimitStore";

/** État suivi pour une clé (IP) : compteur de la fenêtre + son échéance. */
interface RlEntry {
  count: number;
  resetAt: number;
}

/**
 * Store de rate-limit **en mémoire** — algorithme *fixed window* par clé (IP).
 *
 * Une entrée par IP `{ count, resetAt }` ; à l'expiration de la fenêtre le
 * compteur repart à zéro (mutation in-place, 0 alloc pour une IP récurrente).
 * `hit()` est O(1) (1 `Map.get` + arithmétique), et la `Map` est allouée en
 * **lazy** au 1ᵉʳ hit → 0 coût mémoire si le rate-limit n'est jamais sollicité.
 *
 * Mémoire **bornée** par `maxTracked` : au cap, on purge d'abord les fenêtres
 * expirées puis on évince en FIFO (ordre d'insertion `Map`). Un {@link gc}
 * planifiable (GcScheduler du core) fait le ménage hors hot-path.
 *
 * ⚠️ Limite assumée (fenêtre fixe) : un pic à cheval sur deux fenêtres peut
 * laisser passer jusqu'à `2 × max` sur un court intervalle. Acceptable pour une
 * défense de capacité ; un *sliding window* viendrait en option si nécessaire.
 */
export class MemoryRateLimitStore implements IRateLimitStore {
  #entries: Map<string, RlEntry> | null = null;
  #rejectedTotal = 0;
  readonly #windowMs: number;
  readonly #max: number;
  readonly #maxTracked: number;
  readonly #now: () => number;

  /**
   * @param options - fenêtre, plafond, borne mémoire.
   * @param now - horloge injectable (ms) — `Date.now` par défaut, surchargée en test.
   */
  constructor(options: IRateLimitOptions, now: () => number = Date.now) {
    this.#windowMs = options.windowMs;
    this.#max = options.max;
    this.#maxTracked = options.maxTracked;
    this.#now = now;
  }

  hit(key: string): RateLimitVerdict {
    const now = this.#now();
    const entries = (this.#entries ??= new Map());
    const entry = entries.get(key);
    // IP jamais vue → nouvelle fenêtre (éventuelle éviction au cap d'abord).
    if (entry === undefined) {
      if (entries.size >= this.#maxTracked) {
        this.#evict(now);
      }
      const resetAt = now + this.#windowMs;
      entries.set(key, { count: 1, resetAt });
      return this.#allow(resetAt, this.#max - 1);
    }
    // Fenêtre précédente expirée → reset EN PLACE (0 alloc pour une IP connue).
    if (now >= entry.resetAt) {
      entry.count = 1;
      entry.resetAt = now + this.#windowMs;
      return this.#allow(entry.resetAt, this.#max - 1);
    }
    // Fenêtre courante — incrémente.
    entry.count += 1;
    if (entry.count > this.#max) {
      this.#rejectedTotal += 1;
      return {
        limited: true,
        limit: this.#max,
        remaining: 0,
        resetAtMs: entry.resetAt,
        // ≥ 1 : un Retry-After à 0 relancerait un client bien élevé immédiatement.
        retryAfterS: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
      };
    }
    return this.#allow(entry.resetAt, this.#max - entry.count);
  }

  gc(nowMs: number = this.#now()): number {
    if (this.#entries === null) {
      return 0;
    }
    let purged = 0;
    for (const [key, entry] of this.#entries) {
      if (nowMs >= entry.resetAt) {
        this.#entries.delete(key);
        purged += 1;
      }
    }
    return purged;
  }

  /**
   * {@inheritDoc IRateLimitStore.listPage}
   *
   * La collection est déjà en RAM et **bornée par `maxTracked`** (c'est la
   * nature de ce store) : le tri porte sur des références, seule la page est
   * matérialisée en objets de sortie. Les fenêtres expirées sont exclues à la
   * lecture — les montrer ferait passer un compteur mort pour du trafic vivant
   * (le `gc` les retire plus tard, hors hot-path).
   */
  listPage(query: IRateLimitListQuery): Promise<IPage<IRateLimitEntry>> {
    const limit = Math.max(1, Math.floor(query.limit));
    const offset = Math.max(0, Math.floor(query.offset ?? 0));
    const now = this.#now();
    const prefix = query.q !== undefined && query.q.length > 0 ? query.q : null;
    const matched: Array<[string, RlEntry]> = [];
    for (const pair of this.#entries ?? []) {
      const [key, entry] = pair;
      if (now >= entry.resetAt) continue; // fenêtre morte : pas du trafic vivant
      if (prefix !== null && !key.startsWith(prefix)) continue;
      if (
        query.limited !== undefined &&
        entry.count > this.#max !== query.limited
      ) {
        continue;
      }
      matched.push(pair);
    }
    matched.sort(
      (a, b) =>
        b[1].count - a[1].count || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
    );
    const items = matched.slice(offset, offset + limit).map(([key, entry]) => ({
      key,
      count: entry.count,
      resetAtMs: entry.resetAt,
      limited: entry.count > this.#max,
    }));
    return Promise.resolve({
      items,
      total: query.withTotal === false ? undefined : matched.length,
      limit,
      offset,
      hasNext: offset + items.length < matched.length,
    });
  }

  get trackedCount(): number {
    return this.#entries?.size ?? 0;
  }

  get rejectedTotal(): number {
    return this.#rejectedTotal;
  }

  /** Verdict « autorisé » — factorise la forme commune (0 rejet). */
  #allow(resetAtMs: number, remaining: number): RateLimitVerdict {
    return {
      limited: false,
      limit: this.#max,
      remaining,
      resetAtMs,
      retryAfterS: 0,
    };
  }

  /**
   * Borne mémoire : supprime d'abord les fenêtres expirées ; si le cap tient
   * toujours, évince en FIFO (ordre d'insertion `Map`) jusqu'à faire de la place.
   */
  #evict(now: number): void {
    const entries = this.#entries;
    if (entries === null) {
      return;
    }
    for (const [key, entry] of entries) {
      if (now >= entry.resetAt) {
        entries.delete(key);
      }
    }
    while (entries.size >= this.#maxTracked) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      entries.delete(oldest);
    }
  }
}
