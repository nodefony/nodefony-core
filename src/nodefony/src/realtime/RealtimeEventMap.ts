/**
 * Types partagés pour le contrat **realtime** Nodefony — pattern « typed events »
 * (Socket.IO §emitter-typing) appliqué à JSON-RPC 2.0.
 *
 * Le contrat (canaux pub/sub + RPC) est déclaré UNE fois côté partagé, puis injecté
 * en générique sur `IRealtimePeer<Emit, Listen, Actions>`, `JsonRpcPeer<...>` et
 * `RealtimeClient<...>`. Bénéfices : autocomplétion IDE, refactor safe (rename canal
 * → erreur compile partout), doc-as-code. **0 coût runtime** — génériques effacés
 * à la compile.
 *
 * Convention :
 * - `Emit`     = ce que CE peer ENVOIE (notifications sortantes).
 * - `Listen`   = ce que CE peer REÇOIT (notifications entrantes).
 * - `Actions`  = contrat RPC bidirectionnel (les 2 pairs respectent la même map :
 *                `request()` typé sortant + `register()` typé entrant).
 *
 * Pour un échange `client ↔ serveur` : symétrie naturelle.
 * Côté client : `Emit = ClientToServer`, `Listen = ServerToClient`.
 * Côté serveur : `Emit = ServerToClient`, `Listen = ClientToServer`.
 */

/**
 * Map des canaux pub/sub — nom de canal → forme du payload.
 *
 * @example
 * ```ts
 * interface ServerToClient extends EventsMap {
 *   "chat:room42":  { ts: number; msg: string };
 *   "presence":     { user: string; online: boolean };
 * }
 * ```
 */
export type EventsMap = Record<string, unknown>;

/**
 * Map des RPC — nom de méthode → `{ in: paramètres, out: résultat }`.
 *
 * Utilisée par `request()` (sortant) ET `register()` (entrant) : les 2 pairs
 * respectent le même contrat (JSON-RPC 2.0 est symétrique).
 *
 * @example
 * ```ts
 * interface ChatActions extends ActionsMap {
 *   "chat:ping":  { in: void;          out: { pong: boolean; ts: number } };
 *   "chat:fetch": { in: { id: string }; out: { msg: string } };
 * }
 * ```
 */
export type ActionsMap = Record<string, { in?: unknown; out: unknown }>;

/**
 * Défaut **permissif** pour `EventsMap` — toute clé `string`, payload `unknown`.
 * Code instancié sans paramétrage (`new JsonRpcPeer(opts)`) → comportement
 * pré-types-partagés inchangé. **Sécurité rétro-compat 100%**.
 */
export interface DefaultEventsMap {
  [event: string]: unknown;
}

/** Défaut **permissif** pour `ActionsMap` (rétro-compat). */
export interface DefaultActionsMap {
  [method: string]: { in?: unknown; out: unknown };
}

/** Nom valide dans une `EventsMap` (clé `string`). */
export type EventNames<M extends EventsMap> = keyof M & string;

/** Payload typé d'un canal. */
export type EventPayload<M extends EventsMap, K extends keyof M> = M[K];

/** Nom valide dans une `ActionsMap`. */
export type ActionNames<M extends ActionsMap> = keyof M & string;

/**
 * Paramètres entrants d'une RPC. Si la déclaration est `{ in: void }` ou que
 * `in` est absent, le paramètre devient optionnel/`void`.
 */
export type ActionParams<
  M extends ActionsMap,
  K extends keyof M,
> = M[K] extends {
  in: infer I;
}
  ? I
  : undefined;

/** Résultat attendu d'une RPC (`out`). */
export type ActionResult<M extends ActionsMap, K extends keyof M> = M[K]["out"];

/**
 * Handler typé pour une RPC entrante (côté qui expose via `register`).
 * Sync ou async — JSON-RPC 2.0 §5.1 : throw → réponse `-32603 internal_error`.
 */
export type TypedRpcActionHandler<
  M extends ActionsMap,
  K extends keyof M & string,
> = (
  params: ActionParams<M, K>,
) => ActionResult<M, K> | Promise<ActionResult<M, K>>;

/**
 * Assertion type **compile-time** : `expectType<T>(value)` échoue à la compilation
 * si `value` n'est pas assignable à `T`. **0 coût runtime** (fonction vide).
 *
 * @example
 * ```ts
 * const x = peer.request("chat:ping");
 * expectType<Promise<{ pong: boolean }>>(x); // ✅
 * expectType<Promise<string>>(x);            // ❌ TS error
 * ```
 */
export function expectType<T>(_value: T): void {
  /* no-op — assertion à la compile uniquement */
}
