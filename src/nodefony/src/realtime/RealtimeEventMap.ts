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

/**
 * Retire l'index signature (`[k: string]: …`) d'un type, en ne gardant que les
 * clés LITTÉRALES déclarées.
 *
 * Indispensable ici : la convention documentée est `interface App extends
 * ActionsMap`, or `extends` fait HÉRITER le `[k: string]` de `Record<string, …>`.
 * Sans ce filtre, `keyof App` vaut `string` — donc tout nom inconnu passe la
 * compile, et la branche « hors map » des types conditionnels devient
 * INATTEIGNABLE (`K extends EventNames<M>` toujours vrai). C'est ce qui typait le
 * handler wildcard `on("*")` à UN argument alors que le runtime l'appelle avec
 * `(method, params)`.
 *
 * Les maps par défaut ({@link DefaultEventsMap}, {@link DefaultActionsMap}) n'ont
 * QUE l'index signature → elles se réduisent à `never`, ce qui fait tomber le
 * code non paramétré dans la branche permissive : rétro-compat préservée.
 */
type RemoveIndexSignature<T> = {
  [
    K in keyof T as string extends K
      ? never
      : number extends K
        ? never
        : symbol extends K
          ? never
          : K
  ]: T[K];
};

/**
 * Clés LITTÉRALES d'une map, ou `never` si elle n'en déclare aucune (map
 * purement permissive comme {@link DefaultEventsMap}).
 */
type LiteralKeys<M> = keyof RemoveIndexSignature<M> & string;

/**
 * Nom valide dans une `EventsMap`.
 *
 * Map qui DÉCLARE des canaux → union stricte de ses noms (autocomplétion, et un
 * nom inconnu est refusé). Map SANS aucune clé littérale (les défauts permissifs)
 * → `string` : le code non paramétré garde son comportement d'avant les types
 * partagés. Le `[…] extends […]` en tuple empêche la distribution du conditionnel
 * sur `never` (qui rendrait `never` au lieu de `string`).
 */
export type EventNames<M extends EventsMap> = [LiteralKeys<M>] extends [never]
  ? string
  : LiteralKeys<M>;

/** Payload typé d'un canal. */
export type EventPayload<M extends EventsMap, K extends keyof M> = M[K];

/** Nom valide dans une `ActionsMap` — même règle que {@link EventNames}. */
export type ActionNames<M extends ActionsMap> = [LiteralKeys<M>] extends [never]
  ? string
  : LiteralKeys<M>;

/**
 * Paramètres entrants d'une RPC, lus sur le `in` de la déclaration.
 *
 * On teste la PRÉSENCE de la clé (`"in" extends keyof M[K]`) avant d'inférer, au
 * lieu de `M[K] extends { in: infer I }` : un `in` **optionnel** ne satisfait pas
 * une contrainte qui l'exige, et {@link DefaultActionsMap} déclare précisément
 * `in?`. La forme naïve retombait donc sur `undefined` pour tout peer NON
 * paramétré — impossible de passer le moindre paramètre, alors que ce défaut
 * promet une rétro-compat permissive. Zéro impact runtime (types effacés), d'où
 * la survie du trou jusqu'au type-check des tests.
 *
 * - `{ in: { id: string } }` → `{ id: string }`
 * - `{ in: void }` → `void` (appel sans argument)
 * - `{ out: X }` (pas de `in`) → `undefined` (la RPC ne prend rien)
 * - `DefaultActionsMap` (`in?: unknown`) → `unknown` (permissif)
 */
export type ActionParams<
  M extends ActionsMap,
  K extends keyof M,
> = "in" extends keyof M[K]
  ? M[K] extends { in?: infer I }
    ? I
    : undefined
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
  /**
   * Mode d'exécution du serveur — **posé UNIQUEMENT hors production**.
   *
   * Il existe parce que le client ne dispose sinon que de `import.meta.env.DEV`,
   * qui dit le mode du BUNDLE : une application bâtie pour la production mais
   * servie par un serveur de développement (banc, cluster local, image testée
   * sur le poste) restait muette dans la console alors qu'on avait tout intérêt
   * à la faire parler. Le serveur, lui, sait.
   *
   * ⚠️ **Une absence vaut production, jamais l'inverse.** Un serveur publié
   * n'émet pas ce champ : ce n'est pas un réglage qu'on lit, c'est une
   * permission de parler — et on ne l'accorde pas par défaut.
   */
  env?: string;
}

/**
 * Payload de la notification système `realtime:denied` — poussée par le serveur
 * quand une frame `subscribe`/inbound est REFUSÉE par le verrou d'autorisation
 * (P6). Rend le refus OBSERVABLE côté client (une notification, contrairement à
 * une requête, serait sinon droppée en silence → le client resterait aveugle).
 *
 * Contrat de PROTOCOLE **isomorphe** : un seul type, le serveur l'émet
 * (`@nodefony/realtime`), le client le parse (core → notice + event `onDenied`).
 * Zero Trust : `reason` est GÉNÉRIQUE (jamais le rôle/scope manquant — pas
 * d'oracle d'autorisation). Cold path (un refus est rare).
 */
export interface IRealtimeDenied {
  /** Canal (ou méthode inbound) refusé(e). */
  channel: string;
  /** Motif générique (cf {@link RealtimeDeniedReason}) — jamais le détail de la policy. */
  reason: RealtimeDeniedReason;
}

/**
 * Motif d'un `realtime:denied`. Fermé exprès : le client doit pouvoir traiter
 * TOUS les cas (le compilateur le lui rappelle), et un motif inventé côté
 * serveur ne doit pas atteindre un écran qui ne sait pas le dire.
 *
 * - `"forbidden"` — décision d'AUTORISATION : le verrou de frame a refusé
 *   (rôle/scope insuffisant), ou le plancher du namespace de plateforme est
 *   fermé faute de module de sécurité. Générique par construction : dire
 *   lequel des deux, ou quel rôle manque, serait un oracle.
 * - `"limit"` — garde de RESSOURCE : le plafond de canaux de cette connexion
 *   est atteint. Une borne n'est pas un secret, elle se nomme.
 * - `"unknown"` — le canal n'a AUCUN producteur sur ce pod (nom mal orthographié,
 *   module non chargé). Ce n'est pas un refus d'accès, et le distinguer ne
 *   révèle rien : un canal gardé est tranché en amont, donc rendu `"forbidden"`
 *   qu'il existe ou non.
 */
export type RealtimeDeniedReason = "forbidden" | "limit" | "unknown";
