import type {
  IIdempotencyKeyEntry,
  IIdempotencyListQuery,
  IIdempotencyStore,
  IdempotencyOutcome,
  IdempotentResponse,
  IPage,
} from "nodefony";

/** Préfixe namespacé des clés d'idempotence dans Redis. */
/**
 * Préfixe HISTORIQUE des clés d'idempotence. Utilisé tel quel par une application
 * sans cloison ; sinon le service Redis y insère le nom de l'application (cf
 * `RedisService.keyPrefix`).
 */
const KEY_BASE = "nf:idem";

/**
 * Bail par défaut d'une entrée *in-flight* : 60 s (au-delà = exécution réputée
 * abandonnée → la clé redevient réservable). Porté par le TTL natif (`PX`).
 */
const DEFAULT_LEASE_MS = 60_000;

/**
 * Rétention par défaut d'une réponse mémorisée : 10 min (un rejeu plausible
 * reste dans cette fenêtre). Porté par le TTL natif (`PX`).
 */
const DEFAULT_TTL_MS = 600_000;

/**
 * Sous-ensemble structural du client `redis` v6 utilisé par le store — permet de
 * tester contre un double déterministe sans serveur (le vrai `RedisClientType`
 * satisfait cette forme par ses méthodes camelCase v6). `set` renvoie `"OK"` si
 * la valeur est posée, `null` si `NX` l'a empêchée (clé déjà présente).
 *
 * Le store reste **structurel** (pas d'import de `@nodefony/redis`) : la fabrique
 * (`framework/index.ts`) résout le service `redis` par NOM dans le container et
 * passe son client `main` — exactement comme `RedisBackplane` (`@nodefony/realtime`)
 * consomme `getClient("publish"/"subscribe")` sans dépendance directe.
 */
export interface RedisIdempotencyClientLike {
  set(
    key: string,
    value: string,
    options?: { NX?: boolean; PX?: number },
  ): Promise<string | null>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
  /** Parcours incrémental du keyspace (introspection admin — jamais `KEYS`). */
  scan(
    cursor: string,
    options?: { MATCH?: string; COUNT?: number },
  ): Promise<{ cursor: string | number; keys: string[] }>;
  /** TTL résiduel en millisecondes (`-1` = sans expiration, `-2` = absente). */
  pTTL(key: string): Promise<number>;
}

/**
 * Encode le curseur composite `"<consommé>:<curseurRedis>"` — cf
 * {@link RedisIdempotencyStore.listPage} pour le pourquoi.
 */
function encodeCursor(scanCursor: string, skip: number): string {
  return `${skip}:${scanCursor}`;
}

/** Inverse d'{@link encodeCursor} — tolère un curseur absent, vide ou malformé. */
function decodeCursor(cursor?: string): { scanCursor: string; skip: number } {
  if (!cursor) return { scanCursor: "0", skip: 0 };
  const sep = cursor.indexOf(":");
  if (sep === -1) {
    // Curseur Redis nu (client externe) → on l'honore tel quel.
    return { scanCursor: cursor, skip: 0 };
  }
  const skip = Number.parseInt(cursor.slice(0, sep), 10);
  return {
    scanCursor: cursor.slice(sep + 1) || "0",
    skip: Number.isFinite(skip) && skip > 0 ? skip : 0,
  };
}

/** État sérialisé d'une entrée d'idempotence (string JSON, valeur d'une clé). */
type Entry =
  { s: "if"; f: string } | { s: "d"; f: string; r: IdempotentResponse };

/**
 * Store d'idempotence **Redis** (node-redis v6) — implémentation distribuée
 * d'{@link IIdempotencyStore} pour le cluster (dédup des mutations rejouées
 * PARTAGÉE cross-pod, là où l'impl mémoire par défaut reste affine à un pod).
 *
 * **Pourquoi Redis est le bon backing** (modèle Stripe `Idempotency-Key`) :
 *  - `SET key … NX PX` = **réservation atomique côté serveur** → le `409`
 *    in-flight marche VRAIMENT entre pods (deux requêtes concurrentes sur deux
 *    pods : un seul `SET NX` gagne, l'autre voit l'entrée → conflit) ;
 *  - **TTL natif** (`PX`) sur le bail in-flight ET la réponse mémorisée → `gc()`
 *    superflu (zéro balayage applicatif, ≠ Drizzle).
 *
 * **Placement** : vit dans `@nodefony/framework` (le consommateur du contrat),
 * PAS dans `@nodefony/redis` — calqué sur `RedisBackplane` (`@nodefony/realtime`)
 * qui possède son adaptateur Redis et résout le service `redis` par nom (couplage
 * structurel, 0 dépendance directe → 0 cycle). Le contrat `IIdempotencyStore`
 * vit au CORE (`nodefony`), consommé en `import type`.
 *
 * **Modèle de clés** (préfixe `nf:idem`, cloisonné par application) : `<prefix>:<key>` = string JSON de
 * l'{@link Entry}. La `<key>` est DÉJÀ scopée à l'identité par l'appelant
 * (`evaluateIdempotency` compose `[identity, clientKey]`) → anti-IDOR garanti en
 * amont ; le store reste agnostique au scope.
 *
 * **Empreinte préservée à la complétion** : `complete()` ne reçoit pas le
 * fingerprint → il **relit** l'entrée *in-flight* pour reporter son `f` dans
 * l'entrée *done*. Sans ça, un rejeu de la clé avec un AUTRE payload après
 * complétion ne serait pas détecté (`mismatch` 422 perdu, draft §2.7).
 *
 * **Dégradation gracieuse** : si la connexion `main` n'est pas (ou plus) ouverte
 * (boot/shutdown), `begin` renvoie `fresh` (la mutation s'exécute, **sans**
 * dédup) et `complete`/`abort` sont des no-op — l'idempotence est temporairement
 * inactive plutôt que de bloquer la mutation (fail-soft sur la dispo, comme le
 * session/token store Redis). Trade-off assumé : un rejeu pendant une coupure
 * Redis peut ré-exécuter (le client rejoue alors sa clé au rétablissement).
 */
export class RedisIdempotencyStore implements IIdempotencyStore {
  readonly #resolveClient: () => RedisIdempotencyClientLike | null;
  /** Fournit le préfixe cloisonné par application (lazy : le service arrive au boot). */
  readonly #resolvePrefix: () => string;
  /** Préfixe mémoïsé — il est lu à chaque clé. */
  #prefixCache: string | null = null;
  readonly #leaseMs: number;
  readonly #ttlMs: number;
  /** Compteur LOCAL best-effort d'entrées réservées par CE pod (cf {@link size}). */
  #pending = 0;

  /**
   * @param resolveClient - résolveur **lazy** du client Redis (l'ordre de boot
   *   n'est pas garanti à la construction ; `null` = connexion indisponible).
   * @param leaseMs - bail d'une entrée *in-flight* (ms).
   * @param ttlMs - rétention d'une réponse mémorisée (ms).
   */
  constructor(
    resolveClient: () => RedisIdempotencyClientLike | null,
    leaseMs: number = DEFAULT_LEASE_MS,
    ttlMs: number = DEFAULT_TTL_MS,
    // En DERNIER, et optionnel : paramètre arrivé après coup (cloison multi-app).
    // L'insérer au milieu décalerait `leaseMs`/`ttlMs` chez tous les appelants
    // sans qu'aucun type ne le signale — des nombres, puis une fonction.
    resolvePrefix: () => string = () => KEY_BASE,
  ) {
    this.#resolveClient = resolveClient;
    this.#resolvePrefix = resolvePrefix;
    this.#leaseMs = leaseMs;
    this.#ttlMs = ttlMs;
  }

  /**
   * Approximation **per-pod, best-effort** : compteur local des réservations
   * faites par CE pod, non décrémenté si le bail expire sans `complete`/`abort`,
   * et désaligné cross-pod (un `begin` sur un pod, un `complete` sur un autre).
   * La vérité cluster passe par `redis-cli` (`SCAN nf:idem:*`/`DBSIZE`), jamais
   * ce getter (un `SCAN` à chaque lecture serait cher). Borné à ≥ 0.
   */
  get size(): number {
    return this.#pending < 0 ? 0 : this.#pending;
  }

  /**
   * {@inheritDoc IIdempotencyStore.listPage}
   *
   * **Curseur SCAN** : au plus UN passage par appel (cold-path admin). Capacité
   * réduite ASSUMÉE — pas de `total` (compter exigerait un SCAN complet du
   * keyspace, précisément ce qu'on refuse), pas d'ordre global, et la page peut
   * compter moins que `limit` (le filtre s'applique au batch scanné). Le client
   * boucle tant que `hasNext` en repassant `nextCursor`.
   *
   * ⚠️ **`COUNT` n'est PAS un plafond** mais un indice d'effort : Redis peut
   * rendre plus de clés que demandé (petit keyspace en listpack → tout arrive
   * d'un coup). Sans précaution la page dépasserait `limit` et violerait
   * `IPage`. D'où le **curseur composite** `"<consommé>:<curseurRedis>"` : on ne
   * rend que `limit` éléments et on mémorise combien de clés du batch ont été
   * consommées ; la page suivante rejoue le MÊME `SCAN` et reprend là. Bug
   * réel, invisible contre un double — trouvé sur serveur Redis réel.
   */
  async listPage(
    query: IIdempotencyListQuery,
  ): Promise<IPage<IIdempotencyKeyEntry>> {
    const limit = Math.max(1, Math.floor(query.limit));
    const client = this.#client();
    if (!client) {
      return { items: [], limit, hasNext: false, nextCursor: null };
    }
    const { scanCursor, skip } = decodeCursor(query.cursor);
    // Le filtre de préfixe descend dans le MATCH : Redis écarte les clés hors
    // scope côté serveur, on ne rapatrie pas ce qu'on jetterait ensuite.
    const match =
      query.q !== undefined && query.q.length > 0
        ? `${this.#prefix()}:${query.q}*`
        : `${this.#prefix()}:*`;
    const res = await client.scan(scanCursor, { MATCH: match, COUNT: limit });
    const next = String(res.cursor);
    const prefixLen = this.#prefix().length + 1;
    const items: IIdempotencyKeyEntry[] = [];
    // `consumed` compte les CLÉS parcourues (pas les items rendus) : c'est la
    // position de reprise, et le filtre d'état en écarte une partie.
    let consumed = 0;
    for (const key of res.keys.slice(skip)) {
      if (items.length >= limit) break; // page pleine → le reste attend
      consumed += 1;
      const entry = this.#parse(await client.get(key));
      if (entry === null) continue; // expirée entre le SCAN et le GET, ou corrompue
      const state = entry.s === "if" ? "in-flight" : "done";
      if (query.state !== undefined && state !== query.state) continue;
      // TTL natif → échéance absolue. `-1`/`-2` (sans expiration / disparue)
      // deviennent 0 : on n'invente pas une date qui n'existe pas.
      const ttl = await client.pTTL(key);
      items.push({
        key: key.slice(prefixLen),
        state,
        expiresAtMs: ttl > 0 ? Date.now() + ttl : 0,
        // La réponse mémorisée existe (`entry.r`) mais NE SORT PAS : seul le
        // fait qu'elle existe est exposé (garantie du contrat).
        hasResponse: entry.s === "d",
      });
    }
    const restInBatch = skip + consumed < res.keys.length;
    const nextCursor = restInBatch
      ? encodeCursor(scanCursor, skip + consumed) // on reste sur ce batch
      : next === "0"
        ? null // batch épuisé ET scan terminé
        : encodeCursor(next, 0); // batch épuisé, on avance
    return { items, limit, hasNext: nextCursor !== null, nextCursor };
  }

  #client(): RedisIdempotencyClientLike | null {
    return this.#resolveClient();
  }

  /** Préfixe effectif des clés, cloisonné par application (mémoïsé). */
  #prefix(): string {
    if (this.#prefixCache === null) this.#prefixCache = this.#resolvePrefix();
    return this.#prefixCache;
  }

  #key(key: string): string {
    return `${this.#prefix()}:${key}`;
  }

  /** Parse défensif d'une valeur de clé ; `null` si absente/corrompue. */
  #parse(raw: string | null): Entry | null {
    if (raw === null) {
      return null;
    }
    try {
      const v = JSON.parse(raw) as Entry;
      return v && (v.s === "if" || v.s === "d") ? v : null;
    } catch {
      return null;
    }
  }

  async begin(key: string, fingerprint: string): Promise<IdempotencyOutcome> {
    const client = this.#client();
    if (!client) {
      // Redis indisponible → fail-soft : exécuter sans dédup (cf TSDoc classe).
      return { state: "fresh" };
    }
    const k = this.#key(key);
    const reservation = JSON.stringify({ s: "if", f: fingerprint } as Entry);
    // Réservation ATOMIQUE : un seul `SET NX` gagne entre N begins concurrents.
    if (
      (await client.set(k, reservation, { NX: true, PX: this.#leaseMs })) !==
      null
    ) {
      this.#pending++;
      return { state: "fresh" };
    }
    // Clé déjà présente → lire l'état.
    const existing = this.#parse(await client.get(k));
    if (existing === null) {
      // Race rare : la clé a expiré entre le `SET NX` échoué et le `GET` →
      // retenter la réservation une fois ; encore prise = quelqu'un a réservé
      // dans l'intervalle → in-flight.
      if (
        (await client.set(k, reservation, { NX: true, PX: this.#leaseMs })) !==
        null
      ) {
        this.#pending++;
        return { state: "fresh" };
      }
      return { state: "in-flight" };
    }
    // Même clé vivante : le payload DOIT être identique (draft §2.2/§2.7).
    if (existing.f !== fingerprint) {
      return { state: "mismatch" };
    }
    if (existing.s === "d") {
      return { state: "replayed", response: existing.r };
    }
    return { state: "in-flight" };
  }

  async complete(key: string, response: IdempotentResponse): Promise<void> {
    const client = this.#client();
    if (!client) {
      return;
    }
    const k = this.#key(key);
    // Relire pour (1) ne mémoriser QUE si la clé est encore NOTRE in-flight (ni
    // abort, ni bail expiré entre-temps → jamais ressusciter une clé libérée) et
    // (2) reporter le fingerprint dans l'entrée done (préservé pour le 422 d'un
    // rejeu avec un autre payload après complétion).
    const existing = this.#parse(await client.get(k));
    if (existing === null || existing.s !== "if") {
      this.#dec();
      return;
    }
    const done = JSON.stringify({
      s: "d",
      f: existing.f,
      r: response,
    } as Entry);
    await client.set(k, done, { PX: this.#ttlMs });
    this.#dec();
  }

  async abort(key: string): Promise<void> {
    const client = this.#client();
    if (!client) {
      return;
    }
    // `complete` et `abort` sont exclusifs pour une même exécution (try/catch) →
    // un `del` direct est sûr (jamais d'écrasement d'une réponse mémorisée par
    // une autre exécution : une requête concurrente est restée en in-flight/409).
    await client.del(this.#key(key));
    this.#dec();
  }

  /** Décrémente le compteur local borné à 0. */
  #dec(): void {
    if (this.#pending > 0) {
      this.#pending--;
    }
  }
}
