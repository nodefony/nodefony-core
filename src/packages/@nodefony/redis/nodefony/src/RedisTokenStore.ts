// `import type` UNIQUEMENT (approche B) → effacé à la compilation : aucune
// dépendance runtime de l'infra Redis vers `@nodefony/security`. L'application
// câble le store via `registerTokenStore("redis", …)`.
import type {
  IAccessTokenRecord,
  ITokenStore,
  ITokenUsage,
  TokenRevokeReason,
} from "@nodefony/security";
import type RedisService from "../service/redis";

/** Préfixe namespacé des clés de jetons dans Redis. */
const KEY_PREFIX = "nf:tok";

/** Fenêtre par défaut de conservation d'un PAT révoqué sans expiration (30 j). */
const DEFAULT_RETENTION_REVOKED_MS = 30 * 24 * 3_600_000;

/**
 * Sous-ensemble structural du client `redis` v6 utilisé par le store — permet de
 * tester contre un double déterministe sans serveur (le vrai `RedisClientType`
 * satisfait cette forme par ses méthodes camelCase v6).
 */
export interface RedisClientLike {
  hSet(key: string, fields: Record<string, string>): Promise<number>;
  hGetAll(key: string): Promise<Record<string, string>>;
  hDel(key: string, field: string): Promise<number>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number }): Promise<unknown>;
  del(key: string): Promise<number>;
  exists(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  sAdd(key: string, member: string): Promise<number>;
  sRem(key: string, member: string): Promise<number>;
  sMembers(key: string): Promise<string[]>;
  scan(
    cursor: number,
    options?: { MATCH?: string; COUNT?: number },
  ): Promise<{ cursor: number; keys: string[] }>;
}

/**
 * Store de jetons **Redis** (node-redis v6) — implémentation d'{@link ITokenStore}
 * pour le cluster (source unique cross-pod, denylist hot).
 *
 * **Approche B** : `@nodefony/security` n'est connu qu'en `import type` (0 dép
 * runtime). L'application câble la fabrique (`registerTokenStore("redis", …)`).
 *
 * **Modèle de clés** (préfixe `nf:tok`) :
 *  - `rec:<jti>` = **HASH** du record (1 champ par colonne ; tableaux/objets en
 *    JSON dans le champ ; `null` = champ absent). HASH (≠ blob JSON) car `markUsed`
 *    écrit 1-3 champs via `HSET` **sans réécrire le record ni toucher le TTL** ;
 *  - `hash:<secretHash>` = `jti` (index de lookup au login) ;
 *  - `subj:<subjectId>` / `fam:<family>` = **SET** d'ids (index secondaires —
 *    les membres orphelins sont nettoyés paresseusement à la lecture) ;
 *  - `deny:<jti>` = `"1"` avec **`EX`** (révocation ciblée, TTL natif) ;
 *  - `revsub:<subjectId>` = seuil `invalidBefore` (révocation en masse).
 *
 * **TTL natif → `gc()` est un no-op** : un refresh expire par son `exp`
 * (`EXPIRE`), un PAT **révoqué sans exp** reçoit un `EXPIRE = rétention` au moment
 * du `revoke`, la denylist expire par `EX`. Redis purge seul (zéro balayage).
 *
 * Dégradation gracieuse : si la connexion `main` n'est pas (ou plus) ouverte, les
 * lectures renvoient vide et les écritures sont des no-op (comme le session store).
 */
export class RedisTokenStore implements ITokenStore {
  readonly #resolveClient: () => RedisClientLike | null;
  readonly #now: () => number;
  readonly #retentionRevokedMs: number;

  /**
   * @param resolveClient - résolveur **lazy** du client Redis (l'ordre de boot
   *   n'est pas garanti à la construction ; `null` = connexion indisponible).
   * @param now - horloge (epoch ms) injectable pour les tests.
   * @param retentionRevokedMs - rétention d'un PAT révoqué sans `exp` avant purge.
   */
  constructor(
    resolveClient: () => RedisClientLike | null,
    now: () => number = Date.now,
    retentionRevokedMs: number = DEFAULT_RETENTION_REVOKED_MS,
  ) {
    this.#resolveClient = resolveClient;
    this.#now = now;
    this.#retentionRevokedMs = retentionRevokedMs;
  }

  /**
   * Construit le store depuis un {@link RedisService} (connexion `main`).
   * Résolution **lazy** du client (boot order).
   *
   * @param service - service Redis fournissant `getClient("main")`.
   * @param now - horloge injectable (tests).
   * @param retentionRevokedMs - rétention des PAT révoqués sans `exp`.
   */
  static from(
    service: RedisService,
    now?: () => number,
    retentionRevokedMs?: number,
  ): RedisTokenStore {
    return new RedisTokenStore(
      () => service.getClient("main") as unknown as RedisClientLike | null,
      now,
      retentionRevokedMs,
    );
  }

  #client(): RedisClientLike | null {
    return this.#resolveClient();
  }

  #recKey(id: string): string {
    return `${KEY_PREFIX}:rec:${id}`;
  }
  #hashKey(secretHash: string): string {
    return `${KEY_PREFIX}:hash:${secretHash}`;
  }
  #subjKey(subjectId: string): string {
    return `${KEY_PREFIX}:subj:${subjectId}`;
  }
  #famKey(family: string): string {
    return `${KEY_PREFIX}:fam:${family}`;
  }
  #denyKey(jti: string): string {
    return `${KEY_PREFIX}:deny:${jti}`;
  }
  #revsubKey(subjectId: string): string {
    return `${KEY_PREFIX}:revsub:${subjectId}`;
  }

  /** TTL en secondes pour un `expiresAt` absolu (epoch ms), au moins 1 ; `undefined` si aucun. */
  #ttlSeconds(expiresAt: number | null): number | undefined {
    if (expiresAt === null) {
      return undefined;
    }
    return Math.max(1, Math.ceil((expiresAt - this.#now()) / 1000));
  }

  /** Sérialise un record en champs de HASH (omet les `null`, JSON pour les composites). */
  #encode(record: IAccessTokenRecord): Record<string, string> {
    const h: Record<string, string> = {};
    const put = (k: string, v: string | number | null): void => {
      if (v !== null && v !== undefined) {
        h[k] = String(v);
      }
    };
    put("id", record.id);
    put("kind", record.kind);
    put("name", record.name);
    put("prefix", record.prefix);
    put("subjectId", record.subjectId);
    put("subjectType", record.subjectType);
    put("tenantId", record.tenantId);
    h.scopes = JSON.stringify(record.scopes);
    h.audience = JSON.stringify(record.audience);
    if (record.resources !== null) {
      h.resources = JSON.stringify(record.resources);
    }
    put("secretHash", record.secretHash);
    put("hashAlg", record.hashAlg);
    put("clientId", record.clientId);
    put("cnf", record.cnf);
    put("family", record.family);
    put("replacedBy", record.replacedBy);
    put("createdAt", record.createdAt);
    put("expiresAt", record.expiresAt);
    put("lastUsedAt", record.lastUsedAt);
    put("lastUsedIp", record.lastUsedIp);
    put("lastUsedUserAgent", record.lastUsedUserAgent);
    put("revokedAt", record.revokedAt);
    put("revokedReason", record.revokedReason);
    h.metadata = JSON.stringify(record.metadata);
    return h;
  }

  /** Désérialise un HASH en record (`null` pour les champs absents). */
  #decode(h: Record<string, string>): IAccessTokenRecord {
    const str = (k: string): string | null => (k in h ? h[k] : null);
    const num = (k: string): number | null => (k in h ? Number(h[k]) : null);
    return {
      id: h.id,
      kind: h.kind as "pat" | "refresh",
      name: h.name,
      prefix: str("prefix"),
      subjectId: h.subjectId,
      subjectType: h.subjectType as "user" | "service",
      tenantId: str("tenantId"),
      scopes: h.scopes ? (JSON.parse(h.scopes) as string[]) : [],
      audience: h.audience ? (JSON.parse(h.audience) as string[]) : [],
      resources: h.resources
        ? (JSON.parse(h.resources) as IAccessTokenRecord["resources"])
        : null,
      secretHash: h.secretHash,
      hashAlg: h.hashAlg,
      clientId: str("clientId"),
      cnf: str("cnf"),
      family: str("family"),
      replacedBy: str("replacedBy"),
      createdAt: Number(h.createdAt),
      expiresAt: num("expiresAt"),
      lastUsedAt: num("lastUsedAt"),
      lastUsedIp: str("lastUsedIp"),
      lastUsedUserAgent: str("lastUsedUserAgent"),
      revokedAt: num("revokedAt"),
      revokedReason: str("revokedReason") as TokenRevokeReason | null,
      metadata: h.metadata
        ? (JSON.parse(h.metadata) as Record<string, unknown>)
        : {},
    };
  }

  // ── Records ────────────────────────────────────────────────────────────────

  async put(record: IAccessTokenRecord): Promise<void> {
    const client = this.#client();
    if (!client) {
      return;
    }
    const recKey = this.#recKey(record.id);
    // DEL avant HSET : un upsert ne doit pas laisser de champ obsolète.
    await client.del(recKey);
    await client.hSet(recKey, this.#encode(record));
    const ttl = this.#ttlSeconds(record.expiresAt);
    if (ttl !== undefined) {
      await client.expire(recKey, ttl);
      await client.set(this.#hashKey(record.secretHash), record.id, {
        EX: ttl,
      });
    } else {
      await client.set(this.#hashKey(record.secretHash), record.id);
    }
    await client.sAdd(this.#subjKey(record.subjectId), record.id);
    if (record.family) {
      await client.sAdd(this.#famKey(record.family), record.id);
    }
  }

  async findById(id: string): Promise<IAccessTokenRecord | null> {
    const client = this.#client();
    if (!client) {
      return null;
    }
    const h = await client.hGetAll(this.#recKey(id));
    return Object.keys(h).length > 0 ? this.#decode(h) : null;
  }

  async findByHash(secretHash: string): Promise<IAccessTokenRecord | null> {
    const client = this.#client();
    if (!client) {
      return null;
    }
    const id = await client.get(this.#hashKey(secretHash));
    if (id === null) {
      return null;
    }
    const h = await client.hGetAll(this.#recKey(id));
    if (Object.keys(h).length === 0) {
      // Index orphelin (record expiré par TTL) → nettoyage paresseux.
      await client.del(this.#hashKey(secretHash));
      return null;
    }
    return this.#decode(h);
  }

  async findBySubject(subjectId: string): Promise<IAccessTokenRecord[]> {
    const client = this.#client();
    if (!client) {
      return [];
    }
    const subjKey = this.#subjKey(subjectId);
    const ids = await client.sMembers(subjKey);
    const out: IAccessTokenRecord[] = [];
    for (const id of ids) {
      const h = await client.hGetAll(this.#recKey(id));
      if (Object.keys(h).length > 0) {
        out.push(this.#decode(h));
      } else {
        await client.sRem(subjKey, id); // membre orphelin (record expiré)
      }
    }
    return out;
  }

  /**
   * Tous les jetons (PAT + refresh) — vue d'administration cross-porteur.
   * Énumère les records par **SCAN** (curseur non-bloquant, `MATCH nf:tok:rec:*`).
   * Opération admin RARE (cold-path, jamais sur le hot-path d'auth) ; à très
   * grande échelle, préférer le système de référence SQL pour la gouvernance.
   */
  async listAll(): Promise<IAccessTokenRecord[]> {
    const client = this.#client();
    if (!client) {
      return [];
    }
    const match = `${KEY_PREFIX}:rec:*`;
    const out: IAccessTokenRecord[] = [];
    let cursor = 0;
    do {
      const res = await client.scan(cursor, { MATCH: match, COUNT: 200 });
      cursor = res.cursor;
      for (const key of res.keys) {
        const h = await client.hGetAll(key);
        if (Object.keys(h).length > 0) {
          out.push(this.#decode(h));
        }
      }
    } while (cursor !== 0);
    return out;
  }

  async markUsed(id: string, usage: ITokenUsage): Promise<void> {
    const client = this.#client();
    if (!client) {
      return;
    }
    const recKey = this.#recKey(id);
    // EXISTS d'abord : un HSET sur une clé absente la recréerait SANS TTL.
    if ((await client.exists(recKey)) === 0) {
      return; // no-op si id inconnu / expiré
    }
    const fields: Record<string, string> = { lastUsedAt: String(usage.at) };
    if (usage.ip != null) {
      fields.lastUsedIp = usage.ip;
    }
    if (usage.userAgent != null) {
      fields.lastUsedUserAgent = usage.userAgent;
    }
    await client.hSet(recKey, fields);
    if (usage.ip == null) {
      await client.hDel(recKey, "lastUsedIp");
    }
    if (usage.userAgent == null) {
      await client.hDel(recKey, "lastUsedUserAgent");
    }
  }

  async revoke(id: string, reason: TokenRevokeReason): Promise<void> {
    const client = this.#client();
    if (!client) {
      return;
    }
    const h = await client.hGetAll(this.#recKey(id));
    if (Object.keys(h).length === 0) {
      return;
    }
    const record = this.#decode(h);
    if (record.revokedAt !== null) {
      return; // idempotent : conserve la 1ʳᵉ date/raison
    }
    await this.#applyRevoke(client, record, reason);
  }

  async revokeFamily(family: string, reason: TokenRevokeReason): Promise<void> {
    const client = this.#client();
    if (!client) {
      return;
    }
    const famKey = this.#famKey(family);
    const ids = await client.sMembers(famKey);
    for (const id of ids) {
      const h = await client.hGetAll(this.#recKey(id));
      if (Object.keys(h).length === 0) {
        await client.sRem(famKey, id); // membre orphelin
        continue;
      }
      const record = this.#decode(h);
      if (record.revokedAt === null) {
        await this.#applyRevoke(client, record, reason);
      }
    }
  }

  /** Pose `revokedAt`/`revokedReason` ; un PAT sans `exp` reçoit un TTL = rétention. */
  async #applyRevoke(
    client: RedisClientLike,
    record: IAccessTokenRecord,
    reason: TokenRevokeReason,
  ): Promise<void> {
    const recKey = this.#recKey(record.id);
    await client.hSet(recKey, {
      revokedAt: String(this.#now()),
      revokedReason: reason,
    });
    if (record.expiresAt === null) {
      // PAT sans exp → purge auto après rétention (TTL natif, `gc()` reste no-op).
      const ttl = Math.max(1, Math.ceil(this.#retentionRevokedMs / 1000));
      await client.expire(recKey, ttl);
      await client.expire(this.#hashKey(record.secretHash), ttl);
    }
  }

  // ── Denylist jti ─────────────────────────────────────────────────────────────

  async denyJti(jti: string, expiresAt: number): Promise<void> {
    const client = this.#client();
    if (!client) {
      return;
    }
    const ttl = Math.ceil((expiresAt - this.#now()) / 1000);
    if (ttl > 0) {
      await client.set(this.#denyKey(jti), "1", { EX: ttl });
    }
  }

  async isJtiDenied(jti: string): Promise<boolean> {
    const client = this.#client();
    if (!client) {
      return false;
    }
    // TTL natif : Redis a déjà supprimé l'entrée si elle est expirée.
    return (await client.exists(this.#denyKey(jti))) > 0;
  }

  // ── Révocation en masse par porteur ──────────────────────────────────────────

  async revokeAllForSubject(
    subjectId: string,
    invalidBefore: number,
  ): Promise<void> {
    const client = this.#client();
    if (!client) {
      return;
    }
    const key = this.#revsubKey(subjectId);
    const current = await client.get(key);
    // Monotone : on ne recule jamais le seuil.
    if (current === null || invalidBefore > Number(current)) {
      await client.set(key, String(invalidBefore));
    }
  }

  async getInvalidBefore(subjectId: string): Promise<number | null> {
    const client = this.#client();
    if (!client) {
      return null;
    }
    const value = await client.get(this.#revsubKey(subjectId));
    return value !== null ? Number(value) : null;
  }

  // ── Maintenance ──────────────────────────────────────────────────────────────

  /**
   * **No-op** : Redis gère toute l'expiration par TTL natif (refresh par leur
   * `exp`, PAT révoqués par la rétention posée au `revoke`, denylist par `EX`).
   * Aucun balayage applicatif n'est nécessaire (≠ Drizzle/Mongoose).
   *
   * @returns toujours `0` (rien à purger côté application).
   */
  gc(): Promise<number> {
    return Promise.resolve(0);
  }
}
