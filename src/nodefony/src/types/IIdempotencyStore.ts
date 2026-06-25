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
 * Cache d'idempotence borné (modèle Stripe `Idempotency-Key`) — dédoublonne les
 * **mutations** rejouées (reconnexion socket, double-clic) du data plane admin
 * comme des controllers userland décorés `@Idempotent`.
 *
 * Contrat de l'appelant (anti double-effet) :
 * ```
 * const o = store.begin(key);
 * if (o.state === "in-flight") return conflict409;
 * if (o.state === "replayed") return o.response;
 * try { const r = await handler(); store.complete(key, r); return r; }
 * catch (e) { store.abort(key); throw e; }   // un échec ne se mémorise pas
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
 */
export interface IIdempotencyStore {
  /**
   * Réserve **atomiquement** la clé (JS mono-thread → `begin` ne s'entrelace
   * pas) et renvoie le verdict à suivre. Une entrée *in-flight* dont le bail a
   * expiré (handler figé sans `complete`/`abort`) est traitée comme `fresh`.
   *
   * @param fingerprint - empreinte du **payload** de la requête (méthode + chemin
   *   + corps), comparée à celle mémorisée pour la clé : si elle diffère, la clé
   *   est réutilisée pour une AUTRE requête → `mismatch` (422). Cf draft §2.4.
   */
  begin(key: string, fingerprint: string): IdempotencyOutcome;
  /** Mémorise la réponse d'une clé *in-flight* (TTL) → rejeux futurs = `replayed`. */
  complete(key: string, response: IdempotentResponse): void;
  /**
   * Libère une clé *in-flight* dont l'exécution a échoué : rien n'est mémorisé
   * (un échec doit pouvoir être réessayé). No-op si la clé n'est plus *in-flight*.
   */
  abort(key: string): void;
  /** Nombre d'entrées vivantes (observabilité / tests). */
  readonly size: number;
}
