import { and, eq, lt, lte } from "drizzle-orm";
// `import type` du contrat (CORE) → effacé à la compilation : 0 dépendance
// runtime vers `@nodefony/framework` (où vivent le data plane admin + `@Idempotent`
// qui CONSOMMENT ce store). Le contrat vit au CORE exprès pour ça (cf TSDoc du
// contrat) → drizzle (sous framework dans le graphe) l'implémente sans cycle.
import type {
  IIdempotencyStore,
  IdempotencyOutcome,
  IdempotentResponse,
} from "nodefony";
import type { DrizzleDb } from "./orm-core/DrizzleRepository";
import type { DrizzleOrm } from "./orm-core/DrizzleOrm";
import {
  idempotencyKeyTable,
  type IdempotencyKeyRow,
} from "../entity/idempotencyEntity";

/** Bail par défaut d'une entrée *in-flight* : 60 s (au-delà = exécution abandonnée). */
const DEFAULT_LEASE_MS = 60_000;

/** Rétention par défaut d'une réponse mémorisée : 10 min (rejeu plausible). */
const DEFAULT_TTL_MS = 600_000;

/**
 * Store d'idempotence **Drizzle** (driver `better-sqlite3` en test, Postgres/MySQL
 * en prod) — implémentation SQL d'{@link IIdempotencyStore} (contrat au CORE) pour
 * dédoublonner les mutations rejouées PARTAGÉ cross-pod, là où le store mémoire par
 * défaut reste affine à un pod.
 *
 * **Pourquoi SQL plutôt que Redis** : un cluster qui possède déjà une base
 * (Postgres) mais pas de Redis obtient la dédup cross-pod sans nouvelle infra.
 *
 * **Réservation atomique (`begin`)** — clé de voûte. Un `INSERT … ON CONFLICT(key)
 * DO UPDATE SET … WHERE expiresAt < now RETURNING` = l'équivalent SQL du `SET … NX
 * PX` Redis, en **une seule instruction atomique** côté serveur :
 *  - clé absente → l'`INSERT` passe → 1 ligne retournée → `fresh` ;
 *  - clé présente mais **morte** (bail/rétention expirés) → le `DO UPDATE … WHERE
 *    expirée` la **vole** atomiquement → 1 ligne retournée → `fresh` ;
 *  - clé présente et **vivante** → le `WHERE` du `DO UPDATE` échoue → 0 ligne
 *    retournée → on lit l'état (`in-flight` / `replayed` / `mismatch`).
 *
 * Cette atomicité au niveau de l'INSTRUCTION est ce qui rend la dédup correcte
 * sous concurrence inter-pods (deux `begin` simultanés sur deux pods : un seul
 * gagne la réservation). Le store ne renvoie JAMAIS `fresh` sur le chemin de
 * contention → anti double-effet garanti (l'invariant capital d'un store
 * d'idempotence).
 *
 * **Pas de TTL natif** (≠ Redis `PX`) → un {@link DrizzleIdempotencyStore.gc}
 * applicatif purge les entrées expirées. À mutualiser avec la maintenance du store
 * de session (chantier « GC moderne »).
 *
 * **Empreinte préservée à la complétion** : `complete()` ne touche pas la colonne
 * `fingerprint` (UPDATE ciblé) → un rejeu de la clé avec un AUTRE payload après
 * complétion est toujours détecté (`mismatch` 422, draft §2.7).
 *
 * ⚠️ **SQLite = banc de test de la sémantique** : un fichier SQLite est
 * mono-machine (lock d'écriture) → aucun intérêt multi-pod. La cible RÉELLE est
 * **Postgres/MySQL** (changement de driver). La preuve cross-pod réelle passe par
 * un e2e Postgres (≠ test SQLite, qui valide la sémantique séquentielle).
 *
 * **Résolution LAZY + dégradation gracieuse** (calqué sur `RedisIdempotencyStore`,
 * le frère idempotence) : le store ne capture PAS le handle Drizzle à la
 * construction mais le résout à CHAQUE appel — l'ordre de boot n'est pas garanti
 * (le framework résout ce store à `onKernelBoot`, quand l'ORM peut ne pas être
 * encore connecté), et l'ORM se déconnecte au shutdown avant le drain des
 * serveurs (cf le gotcha `SessionStorage`). Si le handle est `null` (ORM non
 * connecté), `begin` renvoie `fresh` (la mutation s'exécute SANS dédup) et
 * `complete`/`abort`/`gc` sont des no-op — l'idempotence est temporairement
 * inactive plutôt que de crasher une mutation en vol. Trade-off identique à Redis
 * (un rejeu pendant la fenêtre peut ré-exécuter) ; en pratique la base
 * d'idempotence = la base applicative → « connectée » est vrai sur tout le service.
 *
 * **Câblage (approche B)** : classe PURE (`import type` du contrat core).
 * L'**application** câble la fabrique (`registerIdempotencyStore("drizzle", …)` —
 * registre `@nodefony/framework`) + l'entité (`registerIdempotencyEntities(orm)`
 * avant `orm.connect()`). Le module drizzle n'auto-enregistre rien.
 */
export class DrizzleIdempotencyStore implements IIdempotencyStore {
  readonly #resolveDb: () => DrizzleDb | null;
  readonly #now: () => number;
  readonly #leaseMs: number;
  readonly #ttlMs: number;
  /** Compteur LOCAL best-effort des réservations faites par CE pod (cf {@link size}). */
  #pending = 0;

  /**
   * @param resolveDb - résolveur **lazy** du handle Drizzle (`null` = ORM non
   *   connecté → dégradation gracieuse). Lazy car l'ordre de boot/shutdown n'est
   *   pas garanti à la construction.
   * @param now - horloge (epoch ms) injectable pour des tests déterministes.
   * @param leaseMs - bail d'une entrée *in-flight* (ms).
   * @param ttlMs - rétention d'une réponse mémorisée (ms).
   */
  constructor(
    resolveDb: () => DrizzleDb | null,
    now: () => number = Date.now,
    leaseMs: number = DEFAULT_LEASE_MS,
    ttlMs: number = DEFAULT_TTL_MS,
  ) {
    this.#resolveDb = resolveDb;
    this.#now = now;
    this.#leaseMs = leaseMs;
    this.#ttlMs = ttlMs;
  }

  /**
   * Construit le store depuis un {@link DrizzleOrm}. Le handle est résolu **lazy**
   * (gardé par `isConnected()` → `null` tant que l'ORM n'est pas/plus connecté).
   * L'entité (`registerIdempotencyEntities`) doit avoir été enregistrée **avant**
   * `orm.connect()` (la table est créée au connect).
   *
   * @param orm - ORM Drizzle hébergeant la table `idempotency_key`.
   * @param now - horloge injectable (tests).
   * @param leaseMs - bail *in-flight* (ms).
   * @param ttlMs - rétention d'une réponse mémorisée (ms).
   */
  static from(
    orm: DrizzleOrm,
    now?: () => number,
    leaseMs?: number,
    ttlMs?: number,
  ): DrizzleIdempotencyStore {
    return new DrizzleIdempotencyStore(
      () => (orm.isConnected() ? orm.getNativeConnection<DrizzleDb>() : null),
      now,
      leaseMs,
      ttlMs,
    );
  }

  /**
   * Approximation **per-pod, best-effort** : compteur local des réservations
   * faites par CE pod (incrémenté au `fresh`, décrémenté au `complete`/`abort`),
   * non décrémenté si le bail expire sans complétion, et désaligné cross-pod. La
   * vérité cluster passe par un `COUNT(*)`, jamais ce getter (sync). Borné à ≥ 0.
   */
  get size(): number {
    return this.#pending < 0 ? 0 : this.#pending;
  }

  async begin(key: string, fingerprint: string): Promise<IdempotencyOutcome> {
    const db = this.#resolveDb();
    if (!db) {
      // ORM non connecté (boot/shutdown) → fail-soft : exécuter sans dédup.
      return { state: "fresh" };
    }
    const now = this.#now();
    const leaseExpiresAt = now + this.#leaseMs;
    // Réservation ATOMIQUE (équivalent SQL de `SET … NX PX`) : insère la clé, OU
    // « vole » une entrée EXPIRÉE via le `DO UPDATE … WHERE expiresAt < now`. Le
    // `RETURNING` ne renvoie une ligne QUE si l'INSERT ou l'UPDATE a réellement eu
    // lieu → length>0 ⇒ on a obtenu la réservation (clé neuve ou morte reprise).
    const reserved = await db
      .insert(idempotencyKeyTable)
      .values({
        key,
        fingerprint,
        state: "if",
        response: null,
        expiresAt: leaseExpiresAt,
      })
      .onConflictDoUpdate({
        target: idempotencyKeyTable.key,
        set: {
          fingerprint,
          state: "if",
          response: null,
          expiresAt: leaseExpiresAt,
        },
        // Ne réécrit (= ne vole) QUE si l'entrée existante est morte. Sur une
        // entrée vivante, le WHERE échoue → 0 ligne → contention (lire l'état).
        setWhere: lt(idempotencyKeyTable.expiresAt, now),
      })
      .returning({ key: idempotencyKeyTable.key });
    if (reserved.length > 0) {
      this.#pending++;
      return { state: "fresh" };
    }
    // Contention : la clé était VIVANTE à l'instant de l'upsert → lire son état.
    const rows = await db
      .select()
      .from(idempotencyKeyTable)
      .where(eq(idempotencyKeyTable.key, key));
    const existing = rows[0] as IdempotencyKeyRow | undefined;
    if (existing === undefined) {
      // Course rare : la clé a expiré entre l'upsert et le SELECT. Prudence
      // anti double-effet : on ne renvoie JAMAIS `fresh` hors réservation
      // atomique → `in-flight` (le client rejouera, et le prochain `begin`
      // réservera proprement la clé désormais libre).
      return { state: "in-flight" };
    }
    // Même clé vivante : le payload DOIT être identique (draft §2.2/§2.7).
    if (existing.fingerprint !== fingerprint) {
      return { state: "mismatch" };
    }
    if (existing.state === "done" && existing.response !== null) {
      return { state: "replayed", response: existing.response };
    }
    return { state: "in-flight" };
  }

  async complete(key: string, response: IdempotentResponse): Promise<void> {
    const db = this.#resolveDb();
    if (!db) {
      return; // ORM non connecté → no-op (cf dégradation gracieuse).
    }
    // UPDATE conditionnel atomique : ne mémorise QUE si la clé est encore NOTRE
    // in-flight (ni `abort`, ni bail expiré + volée entre-temps) → jamais
    // ressusciter une clé libérée. `fingerprint` non touché = empreinte préservée
    // (mismatch 422 d'un rejeu avec un autre payload après complétion).
    const result = (await db
      .update(idempotencyKeyTable)
      .set({ state: "done", response, expiresAt: this.#now() + this.#ttlMs })
      .where(
        and(
          eq(idempotencyKeyTable.key, key),
          eq(idempotencyKeyTable.state, "if"),
        ),
      )) as { changes?: number };
    if ((result.changes ?? 0) > 0) {
      this.#dec();
    }
  }

  async abort(key: string): Promise<void> {
    const db = this.#resolveDb();
    if (!db) {
      return; // ORM non connecté → no-op (cf dégradation gracieuse).
    }
    // Libère une clé in-flight dont l'exécution a échoué (rien n'est mémorisé →
    // l'appel pourra être réessayé). `state='if'` garde le DELETE sûr : jamais
    // d'effacement d'une réponse déjà mémorisée (`done`) par une autre exécution.
    const result = (await db
      .delete(idempotencyKeyTable)
      .where(
        and(
          eq(idempotencyKeyTable.key, key),
          eq(idempotencyKeyTable.state, "if"),
        ),
      )) as { changes?: number };
    if ((result.changes ?? 0) > 0) {
      this.#dec();
    }
  }

  /**
   * Purge les entrées mortes (`expiresAt <= now`) — supplée l'absence de TTL natif
   * SQL (≠ Redis `PX`). À déclencher périodiquement (timer de maintenance, à
   * mutualiser avec le GC du store de session).
   *
   * @param now - horloge de purge (défaut : horloge injectée).
   * @returns le nombre d'entrées supprimées.
   */
  async gc(now: number = this.#now()): Promise<number> {
    const db = this.#resolveDb();
    if (!db) {
      return 0; // ORM non connecté → rien à purger.
    }
    const result = (await db
      .delete(idempotencyKeyTable)
      .where(lte(idempotencyKeyTable.expiresAt, now))) as { changes?: number };
    return result.changes ?? 0;
  }

  /** Décrémente le compteur local borné à 0. */
  #dec(): void {
    if (this.#pending > 0) {
      this.#pending--;
    }
  }
}
