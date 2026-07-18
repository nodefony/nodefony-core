import { Service, Module, Container, Event, injectable } from "nodefony";
import type { IPage } from "nodefony";
import type {
  IIdempotencyKeyEntry,
  IIdempotencyListQuery,
  IIdempotencyStore,
  IdempotencyOutcome,
  IdempotentResponse,
} from "../interfaces/IIdempotencyStore";

const serviceName = "idempotencyStore";

/** Réponses mémorisées : 10 min (un rejeu plausible reste dans cette fenêtre). */
const DEFAULT_TTL_MS = 600_000;
/** Bail d'une entrée *in-flight* : 60 s (au-delà = exécution réputée abandonnée). */
const DEFAULT_LEASE_MS = 60_000;
/** Borne mémoire : nombre max d'entrées (éviction FIFO de la plus ancienne). */
const DEFAULT_CAP = 1000;

type Entry =
  | { kind: "in-flight"; fingerprint: string; expiresAt: number }
  | {
      kind: "done";
      fingerprint: string;
      response: IdempotentResponse;
      expiresAt: number;
    };

/**
 * Implémentation **mémoire** (per-pod) de {@link IIdempotencyStore} — cache borné
 * de dédup des mutations admin rejouées.
 *
 * Vit dans `@nodefony/framework` (niveau qui possède le data plane admin) et
 * s'enregistre comme service DI `idempotencyStore` (manifeste `@services`).
 *
 * **Perf/mémoire** : `Map` allouée **lazy** au 1ᵉʳ `begin` (le store ne sert que
 * les mutations admin = cold path) ; aucun timer/listener (purge passive +
 * éviction FIFO au cap, payées seulement quand on écrit). Aucun coût tant
 * qu'aucune mutation idempotente n'est invoquée.
 *
 * @see IIdempotencyStore pour le contrat + l'invariant de scope de la clé.
 */
@injectable()
class MemoryIdempotencyStore extends Service implements IIdempotencyStore {
  /** Entrées vivantes — `null` tant qu'aucun `begin` n'a eu lieu (lazy alloc). */
  private entries: Map<string, Entry> | null = null;
  private readonly ttlMs = DEFAULT_TTL_MS;
  private readonly leaseMs = DEFAULT_LEASE_MS;
  private readonly cap = DEFAULT_CAP;

  constructor(module: Module) {
    super(
      serviceName,
      module.container as Container,
      module.notificationsCenter as Event,
      undefined,
    );
  }

  get size(): number {
    return this.entries === null ? 0 : this.entries.size;
  }

  /**
   * {@inheritDoc IIdempotencyStore.listPage}
   *
   * La collection est déjà en RAM et **bornée par le cap** : le tri porte sur
   * des références, seule la page devient des vues. Les entrées expirées sont
   * exclues à la LECTURE (la purge d'ici est passive : elle n'a lieu qu'à
   * l'écriture) — sinon on montrerait comme vivante une clé déjà rejouable.
   */
  listPage(query: IIdempotencyListQuery): Promise<IPage<IIdempotencyKeyEntry>> {
    const limit = Math.max(1, Math.floor(query.limit));
    const offset = Math.max(0, Math.floor(query.offset ?? 0));
    const now = Date.now();
    const prefix = query.q !== undefined && query.q.length > 0 ? query.q : null;
    const matched: Array<[string, Entry]> = [];
    for (const pair of this.entries ?? []) {
      const [key, entry] = pair;
      if (now > entry.expiresAt) continue; // déjà morte : pas une clé vivante
      if (prefix !== null && !key.startsWith(prefix)) continue;
      if (query.state !== undefined && entry.kind !== query.state) continue;
      matched.push(pair);
    }
    // `expiresAt` ASC : ce qui va disparaître en premier en tête (c'est la
    // lecture utile). Départagé par clé → offset déterministe.
    matched.sort(
      (a, b) =>
        a[1].expiresAt - b[1].expiresAt ||
        (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
    );
    const items = matched.slice(offset, offset + limit).map(([key, entry]) => ({
      key,
      state: entry.kind,
      expiresAtMs: entry.expiresAt,
      hasResponse: entry.kind === "done",
    }));
    return Promise.resolve({
      items,
      total: query.withTotal === false ? undefined : matched.length,
      limit,
      offset,
      hasNext: offset + items.length < matched.length,
    });
  }

  begin(key: string, fingerprint: string): IdempotencyOutcome {
    const entries = this.entries ?? (this.entries = new Map());
    const now = Date.now();
    const existing = entries.get(key);
    if (existing !== undefined && now <= existing.expiresAt) {
      // Même clé encore vivante : le payload DOIT être identique (draft §2.2) —
      // un fingerprint distinct = clé réutilisée pour une autre requête → 422.
      if (existing.fingerprint !== fingerprint) return { state: "mismatch" };
      // Soit la réponse est prête (rejeu → on la rejoue), soit une exécution
      // identique est en cours (bail non expiré → conflit).
      if (existing.kind === "done") {
        return { state: "replayed", response: existing.response };
      }
      return { state: "in-flight" };
    }
    // Absente OU expirée (réponse périmée / bail in-flight dépassé = exécution
    // réputée abandonnée) → réserver. `delete` d'abord pour ré-insérer la clé
    // en QUEUE FIFO (ordre d'insertion = ordre d'éviction).
    if (existing !== undefined) entries.delete(key);
    entries.set(key, {
      kind: "in-flight",
      fingerprint,
      expiresAt: now + this.leaseMs,
    });
    return { state: "fresh" };
  }

  complete(key: string, response: IdempotentResponse): void {
    const entries = this.entries;
    if (entries === null) return;
    const existing = entries.get(key);
    // N'écrit QUE si la clé est encore NOTRE in-flight (ni `abort`, ni évincée
    // entre-temps) → on ne ressuscite jamais une clé libérée.
    if (existing === undefined || existing.kind !== "in-flight") return;
    entries.set(key, {
      kind: "done",
      fingerprint: existing.fingerprint, // préserve l'empreinte du payload
      response,
      expiresAt: Date.now() + this.ttlMs,
    });
    this.evictIfNeeded();
  }

  abort(key: string): void {
    const entries = this.entries;
    if (entries === null) return;
    const existing = entries.get(key);
    if (existing !== undefined && existing.kind === "in-flight") {
      entries.delete(key);
    }
  }

  /**
   * Borne la taille : purge passive des expirées rencontrées, puis éviction FIFO
   * (la plus ancienne insérée) jusqu'à repasser sous le cap. Appelé au `complete`
   * (seul point qui fait croître durablement la Map).
   */
  private evictIfNeeded(): void {
    const entries = this.entries;
    if (entries === null || entries.size <= this.cap) return;
    const now = Date.now();
    for (const [k, e] of entries) {
      if (now > e.expiresAt) entries.delete(k);
      if (entries.size <= this.cap) return;
    }
    for (const k of entries.keys()) {
      entries.delete(k);
      if (entries.size <= this.cap) return;
    }
  }
}

export default MemoryIdempotencyStore;
