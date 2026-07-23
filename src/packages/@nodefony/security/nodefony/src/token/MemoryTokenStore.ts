import type { IPage } from "nodefony";
import { assertPageQuery } from "nodefony";
import type {
  IAccessTokenRecord,
  ITokenListQuery,
  ITokenStore,
  ITokenUsage,
  TokenRevokeReason,
} from "../../contracts/ITokenStore";

/** Filtre un record contre une requête de listing (portable, réutilisé par les impls). */
export function matchesTokenQuery(
  record: IAccessTokenRecord,
  query: ITokenListQuery,
): boolean {
  if (query.subjectId !== undefined && record.subjectId !== query.subjectId) {
    return false;
  }
  if (query.kind !== undefined && record.kind !== query.kind) return false;
  if (
    query.revoked !== undefined &&
    (record.revokedAt !== null) !== query.revoked
  ) {
    return false;
  }
  return true;
}

/**
 * Instantané sérialisable de l'état d'un store en mémoire — base de la
 * persistance fichier ({@link MemoryTokenStore.snapshot}/`restore`) et de
 * l'inspection. Les index dérivés (par hash/famille/sujet) ne sont PAS
 * sérialisés : ils sont reconstruits depuis `records` au `restore`.
 */
export interface TokenStoreSnapshot {
  records: IAccessTokenRecord[];
  deniedJti: Array<[string, number]>;
  invalidBefore: Array<[string, number]>;
}

/**
 * Store de jetons **en mémoire** — implémentation de référence d'{@link ITokenStore}.
 *
 * 0 dépendance, idéale pour le développement mono-process et les **tests**. NON
 * partagée entre process (pas de cluster) et **volatile** (tout est perdu au
 * redémarrage) → en production multi-process, utiliser un adapter ORM ou Redis.
 *
 * Perf/mémoire : les `Map` n'existent que si le store est instancié (JWT activé),
 * jamais sur le hot path par requête. La denylist `jti` est bornée par un
 * **balayage amorti** (purge des entrées expirées tous les 256 ajouts) doublé
 * d'une expiration paresseuse à la lecture — pas de minuterie, pas de fuite.
 *
 * Horloge injectable (`now`) pour des tests déterministes (pattern `LoginThrottler`).
 */
export class MemoryTokenStore implements ITokenStore {
  /** id → enregistrement (source de vérité). */
  readonly #byId = new Map<string, IAccessTokenRecord>();
  /** hash de secret → id (recherche au login). */
  readonly #idByHash = new Map<string, string>();
  /** famille de rotation → ids (révocation groupée, reuse detection). */
  readonly #idsByFamily = new Map<string, Set<string>>();
  /** porteur → ids (console « mes jetons », révocation ciblée). */
  readonly #idsBySubject = new Map<string, Set<string>>();
  /** jti d'access denylisté → expiration (epoch ms). */
  readonly #deniedJti = new Map<string, number>();
  /** porteur → seuil `invalidBefore` (epoch ms) — révocation en masse. */
  readonly #invalidBefore = new Map<string, number>();
  readonly #now: () => number;
  /** Fenêtre de conservation d'un PAT révoqué sans expiration (audit) avant purge. */
  readonly #retentionRevokedMs: number;
  #sweepCounter = 0;

  constructor(
    now: () => number = Date.now,
    retentionRevokedMs: number = 30 * 24 * 3_600_000, // 30 jours
  ) {
    this.#now = now;
    this.#retentionRevokedMs = retentionRevokedMs;
  }

  // ── Records ──────────────────────────────────────────────────────────────────

  put(record: IAccessTokenRecord): Promise<void> {
    this.#byId.set(record.id, record);
    this.#idByHash.set(record.secretHash, record.id);
    this.#addToIndex(this.#idsBySubject, record.subjectId, record.id);
    if (record.family) {
      this.#addToIndex(this.#idsByFamily, record.family, record.id);
    }
    return Promise.resolve();
  }

  findById(id: string): Promise<IAccessTokenRecord | null> {
    return Promise.resolve(this.#byId.get(id) ?? null);
  }

  findByHash(secretHash: string): Promise<IAccessTokenRecord | null> {
    const id = this.#idByHash.get(secretHash);
    return Promise.resolve(
      id !== undefined ? (this.#byId.get(id) ?? null) : null,
    );
  }

  findBySubject(subjectId: string): Promise<IAccessTokenRecord[]> {
    const ids = this.#idsBySubject.get(subjectId);
    if (!ids) {
      return Promise.resolve([]);
    }
    const out: IAccessTokenRecord[] = [];
    for (const id of ids) {
      const record = this.#byId.get(id);
      if (record) {
        out.push(record);
      }
    }
    return Promise.resolve(out);
  }

  listAll(): Promise<IAccessTokenRecord[]> {
    return Promise.resolve([...this.#byId.values()]);
  }

  listPage(query: ITokenListQuery): Promise<IPage<IAccessTokenRecord>> {
    assertPageQuery(query, "offset");
    const limit = Math.max(1, Math.floor(query.limit));
    const offset = Math.max(0, Math.floor(query.offset ?? 0));
    const filtered = [...this.#byId.values()].filter((r) =>
      matchesTokenQuery(r, query),
    );
    // Tri createdAt DESC, id DESC (déterministe pour l'offset — parité avec le SQL).
    filtered.sort(
      (a, b) =>
        b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
    );
    const items = filtered.slice(offset, offset + limit);
    const total = query.withTotal === false ? undefined : filtered.length;
    return Promise.resolve({
      items,
      total,
      limit,
      offset,
      hasNext: offset + items.length < filtered.length,
    });
  }

  countTokens(query: ITokenListQuery): Promise<number> {
    let n = 0;
    for (const r of this.#byId.values()) {
      if (matchesTokenQuery(r, query)) n += 1;
    }
    return Promise.resolve(n);
  }

  markUsed(id: string, usage: ITokenUsage): Promise<void> {
    const record = this.#byId.get(id);
    if (record) {
      record.lastUsedAt = usage.at;
      record.lastUsedIp = usage.ip ?? null;
      record.lastUsedUserAgent = usage.userAgent ?? null;
    }
    return Promise.resolve();
  }

  revoke(id: string, reason: TokenRevokeReason): Promise<void> {
    this.#revokeRecord(this.#byId.get(id), reason);
    return Promise.resolve();
  }

  revokeFamily(family: string, reason: TokenRevokeReason): Promise<void> {
    const ids = this.#idsByFamily.get(family);
    if (ids) {
      for (const id of ids) {
        this.#revokeRecord(this.#byId.get(id), reason);
      }
    }
    return Promise.resolve();
  }

  // ── Denylist jti ─────────────────────────────────────────────────────────────

  denyJti(jti: string, expiresAt: number): Promise<void> {
    this.#deniedJti.set(jti, expiresAt);
    this.#maybeSweep();
    return Promise.resolve();
  }

  isJtiDenied(jti: string): Promise<boolean> {
    const expiresAt = this.#deniedJti.get(jti);
    if (expiresAt === undefined) {
      return Promise.resolve(false);
    }
    if (expiresAt <= this.#now()) {
      // Expiré : le JWT lui-même est mort, l'entrée n'a plus d'utilité.
      this.#deniedJti.delete(jti);
      return Promise.resolve(false);
    }
    return Promise.resolve(true);
  }

  // ── Révocation en masse par porteur ──────────────────────────────────────────

  revokeAllForSubject(subjectId: string, invalidBefore: number): Promise<void> {
    // Monotone : on ne recule jamais le seuil (deux logouts successifs).
    const current = this.#invalidBefore.get(subjectId);
    if (current === undefined || invalidBefore > current) {
      this.#invalidBefore.set(subjectId, invalidBefore);
    }
    return Promise.resolve();
  }

  getInvalidBefore(subjectId: string): Promise<number | null> {
    return Promise.resolve(this.#invalidBefore.get(subjectId) ?? null);
  }

  // ── Maintenance ──────────────────────────────────────────────────────────────

  gc(now: number = this.#now()): Promise<number> {
    let purged = 0;
    for (const [jti, expiresAt] of this.#deniedJti) {
      if (expiresAt <= now) {
        this.#deniedJti.delete(jti);
        purged++;
      }
    }
    for (const [id, record] of this.#byId) {
      if (this.#isPurgeable(record, now)) {
        this.#removeRecord(id, record);
        purged++;
      }
    }
    return Promise.resolve(purged);
  }

  /**
   * Un record est purgeable s'il est **expiré** (`expiresAt` passé — couvre les
   * refresh, y compris révoqués par rotation : conservés jusqu'à leur `exp` =
   * fenêtre de détection de rejeu, puis tombent ici), OU s'il est un PAT
   * **révoqué sans expiration** au-delà de la fenêtre de rétention (audit) —
   * sinon il resterait éternellement.
   */
  #isPurgeable(record: IAccessTokenRecord, now: number): boolean {
    if (record.expiresAt !== null && record.expiresAt <= now) {
      return true;
    }
    return (
      record.revokedAt !== null &&
      record.expiresAt === null &&
      record.revokedAt + this.#retentionRevokedMs <= now
    );
  }

  // ── Persistance (snapshot / restore) ─────────────────────────────────────────

  /** Instantané sérialisable de l'état courant (records + denylist + seuils). */
  snapshot(): TokenStoreSnapshot {
    return {
      records: [...this.#byId.values()],
      deniedJti: [...this.#deniedJti.entries()],
      invalidBefore: [...this.#invalidBefore.entries()],
    };
  }

  /** Remplace l'état par celui d'un instantané (reconstruit les index dérivés). */
  restore(snapshot: TokenStoreSnapshot): void {
    this.#byId.clear();
    this.#idByHash.clear();
    this.#idsByFamily.clear();
    this.#idsBySubject.clear();
    this.#deniedJti.clear();
    this.#invalidBefore.clear();
    for (const record of snapshot.records) {
      this.#byId.set(record.id, record);
      this.#idByHash.set(record.secretHash, record.id);
      this.#addToIndex(this.#idsBySubject, record.subjectId, record.id);
      if (record.family) {
        this.#addToIndex(this.#idsByFamily, record.family, record.id);
      }
    }
    for (const [jti, expiresAt] of snapshot.deniedJti) {
      this.#deniedJti.set(jti, expiresAt);
    }
    for (const [subjectId, ts] of snapshot.invalidBefore) {
      this.#invalidBefore.set(subjectId, ts);
    }
  }

  // ── Internes ─────────────────────────────────────────────────────────────────

  #addToIndex(index: Map<string, Set<string>>, key: string, id: string): void {
    let set = index.get(key);
    if (!set) {
      set = new Set<string>();
      index.set(key, set);
    }
    set.add(id);
  }

  #revokeRecord(
    record: IAccessTokenRecord | undefined,
    reason: TokenRevokeReason,
  ): void {
    if (record && record.revokedAt === null) {
      record.revokedAt = this.#now();
      record.revokedReason = reason;
    }
  }

  /** Retire un record et nettoie TOUS ses index (évite les références fantômes). */
  #removeRecord(id: string, record: IAccessTokenRecord): void {
    this.#byId.delete(id);
    this.#idByHash.delete(record.secretHash);
    this.#dropFromIndex(this.#idsBySubject, record.subjectId, id);
    if (record.family) {
      this.#dropFromIndex(this.#idsByFamily, record.family, id);
    }
  }

  #dropFromIndex(
    index: Map<string, Set<string>>,
    key: string,
    id: string,
  ): void {
    const set = index.get(key);
    if (set) {
      set.delete(id);
      if (set.size === 0) {
        index.delete(key);
      }
    }
  }

  /** Purge amortie des `jti` expirés — borne la denylist sans coût par appel. */
  #maybeSweep(): void {
    if ((++this.#sweepCounter & 0xff) !== 0) {
      return;
    }
    const now = this.#now();
    for (const [jti, expiresAt] of this.#deniedJti) {
      if (expiresAt <= now) {
        this.#deniedJti.delete(jti);
      }
    }
  }
}
