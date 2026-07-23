import type { IPage, IPageQuery } from "./IPage";

/**
 * Réponse mémorisée d'une mutation idempotente — la forme `{status, headers?, body}`
 * produite par un endpoint (data plane admin `AdminApiController.runAdmin`, ou
 * action userland `@Idempotent`), pour la rejouer telle quelle à un rejeu (même
 * statut, même corps, même en-têtes).
 */
export interface IdempotentResponse {
  /** Code HTTP de la réponse mémorisée. */
  status: number;
  /** En-têtes additionnels éventuels. */
  headers?: Readonly<Record<string, string>>;
  /** Charge utile sérialisable JSON. */
  body: unknown;
}

/**
 * Verdict de {@link IIdempotencyStore.begin} pour une clé d'idempotence donnée.
 * Aligné sur `draft-ietf-httpapi-idempotency-key-header-06` §2.6/§2.7.
 *
 *  - `fresh` : clé jamais vue (ou bail expiré) → réservée *in-flight*, l'appelant
 *    DOIT exécuter la mutation puis appeler `complete()` (succès) ou `abort()`
 *    (échec). (§2.6 « First time request ».)
 *  - `in-flight` : une exécution identique est **en cours** → l'appelant renvoie
 *    `409 Conflict` (§2.6 « Concurrent Request », §2.7).
 *  - `replayed` : la mutation a **déjà** été exécutée → l'appelant renvoie la
 *    `response` mémorisée SANS ré-exécuter (§2.6 « Retry » : une socket qui
 *    reconnecte rejoue sa frame en vol).
 *  - `mismatch` : la clé a déjà été vue avec un **payload DIFFÉRENT** (fingerprint
 *    distinct) → réutilisation interdite d'une clé → l'appelant renvoie
 *    `422 Unprocessable Content` (§2.2 + §2.7).
 */
export type IdempotencyOutcome =
  | { state: "fresh" }
  | { state: "in-flight" }
  | { state: "replayed"; response: IdempotentResponse }
  | { state: "mismatch" };

/**
 * Une clé d'idempotence telle qu'exposée à l'INTROSPECTION admin.
 *
 * 🔒 **Sans la réponse mémorisée, par construction du contrat.** Le `body`
 * mémorisé est la réponse métier d'un utilisateur : le rendre lisible par ce
 * chemin serait exactement l'IDOR sur le cache contre lequel
 * {@link IIdempotencyStore} met en garde. Le `fingerprint` est également exclu
 * (aucune valeur d'exploitation). La `key`, elle, est visible : c'est ce qu'un
 * admin doit voir pour repérer une clé figée *in-flight* — d'où un endpoint
 * réservé à l'administration.
 */
export interface IIdempotencyKeyEntry {
  /** La clé d'idempotence (telle que composée par l'appelant). */
  readonly key: string;
  /** `in-flight` = mutation en cours ; `done` = réponse mémorisée (rejouable). */
  readonly state: "in-flight" | "done";
  /** Échéance de l'entrée (epoch ms) — au-delà, la clé redevient `fresh`. */
  readonly expiresAtMs: number;
  /** `true` si une réponse est mémorisée (jamais son contenu). */
  readonly hasResponse: boolean;
}

/**
 * Requête de listing des clés d'idempotence — {@link IPageQuery} + le filtre
 * d'exploitation. `q` (hérité) = **préfixe** de clé : les clés sont composées
 * (identité + méthode + chemin), donc le préfixe isole un scope entier.
 */
export interface IIdempotencyListQuery extends IPageQuery {
  /** Restreint à un état. Omis = les deux. */
  state?: "in-flight" | "done";
}

/**
 * Cache d'idempotence borné (modèle Stripe `Idempotency-Key`) — dédoublonne les
 * **mutations** rejouées (reconnexion socket, double-clic) du data plane admin
 * comme des controllers userland décorés `@Idempotent`.
 *
 * Contrat de l'appelant (anti double-effet) — `begin` prend DEUX arguments, et
 * l'`await` est requis (une impl distribuée renvoie une `Promise`) :
 * ```
 * const o = await store.begin(key, fingerprint);
 * if (o.state === "in-flight") return conflict409;
 * if (o.state === "replayed") return o.response;
 * if (o.state === "mismatch") return unprocessable422;  // clé réutilisée, autre payload
 * try { const r = await handler(); await store.complete(key, r); return r; }
 * catch (e) { await store.abort(key); throw e; }   // un échec ne se mémorise pas
 * ```
 *
 * 🔒 **La `key` DOIT être scopée à l'identité** (`userId` + méthode + chemin +
 * clé client) : sinon un utilisateur rejouerait la clé d'un autre et lirait sa
 * réponse mémorisée (IDOR sur le cache). Le store reste **agnostique** au scope
 * — c'est l'appelant qui compose une clé sûre.
 *
 * **Per-pod** : implémentation mémoire par défaut (la socket reste affine à son
 * pod). En cluster, une impl partagée (Redis `SET NX`+`EXPIRE`, Drizzle) se
 * branche derrière ce contrat — slot prévu, à la façon de `ITokenStore`. Ce
 * contrat vit au CORE (pas `@nodefony/framework`) pour que `@nodefony/redis` /
 * `@nodefony/drizzle` (graphe sous orm-core/core, hors framework) puissent
 * l'implémenter sans dépendre de framework.
 *
 * **Sync OU async** : `begin`/`complete`/`abort` renvoient `T | Promise<T>`.
 * L'impl mémoire reste **synchrone** (mono-thread JS, 0 microtask sur le store
 * lui-même) ; une impl **distribuée** (Redis/Drizzle) est forcément async (round
 * trip réseau) → elle renvoie des `Promise`. L'appelant `await` le résultat : le
 * surcoût d'un `await` sur une valeur sync (1 microtask) ne touche QUE le chemin
 * **mutation idempotente** (déjà async, froid) ; le hot path GET/non-décoré ne
 * passe jamais ici (court-circuit `idempotent === null` en amont).
 */
export interface IIdempotencyStore {
  /**
   * Réserve **atomiquement** la clé et renvoie le verdict à suivre. L'atomicité
   * vient du **mono-thread JS** (impl mémoire) ou d'un `SET … NX` côté serveur
   * (impl Redis) : deux `begin` concurrents → un seul réserve (`fresh`), l'autre
   * voit l'entrée (`in-flight`). Une entrée *in-flight* dont le bail a expiré
   * (handler figé sans `complete`/`abort`) est traitée comme `fresh`.
   *
   * @param fingerprint - empreinte du **payload** de la requête (méthode + chemin
   *   + corps), comparée à celle mémorisée pour la clé : si elle diffère, la clé
   *   est réutilisée pour une AUTRE requête → `mismatch` (422). Cf draft §2.4.
   */
  begin(
    key: string,
    fingerprint: string,
  ): IdempotencyOutcome | Promise<IdempotencyOutcome>;
  /** Mémorise la réponse d'une clé *in-flight* (TTL) → rejeux futurs = `replayed`. */
  complete(key: string, response: IdempotentResponse): void | Promise<void>;
  /**
   * Libère une clé *in-flight* dont l'exécution a échoué : rien n'est mémorisé
   * (un échec doit pouvoir être réessayé). No-op si la clé n'est plus *in-flight*.
   */
  abort(key: string): void | Promise<void>;
  /**
   * Purge les entrées expirées — présente UNIQUEMENT sur les impls SANS expiration
   * native (`drizzle` → `DELETE WHERE expiresAt <= now`). **Absente** quand le store
   * expire seul (Redis `PX` natif) ou purge passivement (mémoire, au cap FIFO).
   * Quand cette méthode existe, le framework arme un `GcScheduler` au boot
   * (intervalle `idempotency.gcIntervalS`) — hors hot-path.
   *
   * @param now - horloge de purge (epoch ms ; défaut = horloge interne du store).
   * @returns nombre d'entrées purgées.
   */
  gc?(now?: number): Promise<number> | number;
  /**
   * Page de clés vivantes — introspection admin (repérer une clé figée
   * *in-flight* qui bloque les rejeux d'un client). Ne matérialise jamais plus
   * d'une page ; la réponse mémorisée ne sort pas (cf
   * {@link IIdempotencyKeyEntry}).
   *
   * Capacité selon le backend : **offset + total** (mémoire, SQL) ou
   * **curseur** (`nextCursor`, Redis `SCAN`) — le store déclare ce qu'il sait
   * faire en posant l'un ou l'autre, jamais les deux.
   *
   * Ordre : `expiresAtMs` ASC (ce qui va expirer en premier d'abord) pour les
   * backends ordonnables ; non garanti en mode curseur (`SCAN` n'ordonne pas).
   */
  listPage(query: IIdempotencyListQuery): Promise<IPage<IIdempotencyKeyEntry>>;
  /**
   * Nombre d'entrées vivantes (observabilité / tests). **Sync best-effort** : la
   * vérité per-pod pour l'impl mémoire ; pour une impl distribuée (Redis), une
   * approximation locale (compteur du pod, pas un `SCAN`/`DBSIZE` cluster cher).
   */
  readonly size: number;
}
