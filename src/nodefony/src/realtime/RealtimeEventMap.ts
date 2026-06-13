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

/**
 * Identité d'une connexion temps réel, telle que **résolue par le serveur au
 * handshake** (token neutre `IRealtimeToken` côté back) et **annoncée au client**
 * dans la notification système `realtime:welcome`.
 *
 * Le client la lit pour savoir QUI il est **sans taper une route** : anonyme →
 * écran de login (au lieu de deviner via un 401), authentifié → app. Rafraîchie à
 * chaque (re)connexion (un nouveau welcome ⇒ une nouvelle identité). C'est une vue
 * « sur soi » (équivalent `/auth/me`) — **aucun secret** : seulement l'état d'auth
 * et les rôles/scopes du porteur, qu'il connaît déjà.
 */
export interface RealtimeIdentity {
  /** Type de token résolu (`"anonymous"`, `"session"`, `"jwt"`, …) — discriminator. */
  type: string;
  /** `false` pour un visiteur anonyme (Zero Trust : toujours présent, jamais `null`). */
  authenticated: boolean;
  /** Identifiant logique du porteur (`"anonymous"`, `"user-42"`, …). */
  userIdentifier: string;
  /** Rôles **plats** (RBAC, sans hiérarchie résolue) — `["ROLE_ANONYMOUS"]` si anonyme. */
  roles: string[];
  /** Scopes accordés (clés API / OAuth) — `[]` en session BFF web. */
  scopes: string[];
}

/**
 * Payload de la notification système `realtime:welcome` — **1ʳᵉ frame** poussée par
 * le serveur juste après le handshake. Annonce le protocole, les canaux/actions
 * **découvrables** de l'endpoint et l'{@link RealtimeIdentity} résolue de la
 * connexion. Cold path (1×/connexion).
 */
export interface IRealtimeWelcome {
  /** Timestamp serveur (ms epoch). */
  ts: number;
  /** Étiquette de protocole (`"jsonrpc-2.0"`). */
  protocol: string;
  /** Canaux pub/sub annoncés par l'endpoint (découverte). */
  channels: string[];
  /** Actions RPC exposées par l'endpoint (découverte). */
  methods: string[];
  /** Identité résolue de CETTE connexion (cf {@link RealtimeIdentity}). */
  identity: RealtimeIdentity;
}
