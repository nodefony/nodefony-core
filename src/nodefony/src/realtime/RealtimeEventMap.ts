/**
 * Types partagés pour le contrat **realtime** Nodefony — pattern « typed events »
 * (Socket.IO §emitter-typing) appliqué à JSON-RPC 2.0.
 *
 * Le contrat (canaux pub/sub + RPC) est déclaré UNE fois côté partagé, puis injecté
 * en générique sur `IRealtimePeer<Emit, Listen, Actions>`, `JsonRpcPeer<...>` et
 * `NodefonySocket<...>`. Bénéfices : autocomplétion IDE, refactor safe (rename canal
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

import type {
  IStandardSchemaV1,
  InferSchemaInput,
} from "../runtime/standardSchemaTypes";

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
 * Noms d'actions RÉELLEMENT déclarés par le contrat — `never` quand la map n'en
 * déclare aucune ({@link DefaultActionsMap}).
 *
 * ⚠️ À ne pas confondre avec {@link ActionNames}, qui vaut `string` sur une map
 * non paramétrée : ce repli est ce qu'il faut pour une CONTRAINTE (accepter
 * n'importe quelle méthode), mais il rend toujours VRAIE la condition d'un type
 * conditionnel — la branche permissive devient alors inatteignable et le type de
 * résultat demandé par l'appelant est écrasé en `unknown`.
 */
export type ContractActionNames<M extends ActionsMap> = LiteralKeys<M>;

/**
 * `params` d'une RPC : dictés par le contrat quand `K` lui appartient, libres
 * sinon. Règle UNIQUE — `IRealtimeSocket`, `NodefonySocket` et
 * `ServerRealtimeSocket` la partagent au lieu de la recopier.
 */
export type ContractParams<M extends ActionsMap, K> =
  K extends ContractActionNames<M> ? ActionParams<M, K & keyof M> : unknown;

/**
 * Résultat d'une RPC : dicté par le contrat quand `K` lui appartient, sinon le
 * `T` que l'appelant demande. Pendant de {@link ContractParams}.
 */
export type ContractResult<M extends ActionsMap, K, T> =
  K extends ContractActionNames<M> ? ActionResult<M, K & keyof M> : T;

/**
 * Verbe HTTP d'une action servie par le pont `api.request` — le pont n'en sert
 * pas d'autre.
 */
export type BridgeVerb = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * Une route servie par le pont, vue par le contrat : le schéma de son corps et
 * de sa query — la VALEUR que la route valide, référencée par `typeof`, jamais
 * recopiée —, et ce qu'elle rend.
 *
 * @example
 * ```ts
 * "POST /chat/send": { body: typeof SendBody; result: { sentAt: number } };
 * ```
 */
export interface IContractRoute {
  /** Schéma du corps (`schema: { body }` de la route). */
  body?: IStandardSchemaV1;
  /** Schéma de la query (`schema: { query }` de la route). */
  query?: IStandardSchemaV1;
  /**
   * Schéma des paramètres de chemin (`schema: { params }` de la route) ; absent,
   * leurs noms sont lus dans le gabarit de la clé (`{id}`).
   */
  params?: IStandardSchemaV1;
  /** Ce que l'action rend. */
  result: unknown;
}

/**
 * Carte des routes du pont : `"<VERBE> <chemin>"` → {@link IContractRoute}. Le
 * chemin est celui de la route montée, préfixe du contrôleur compris.
 */
export type RoutesMap = Record<`${BridgeVerb} /${string}`, IContractRoute>;

/**
 * Routes DÉCLARÉES d'une carte : ses clés dont le chemin est écrit, sans le
 * motif `"<VERBE> /${string}"` que porte {@link RoutesMap} lui-même.
 *
 * `LiteralKeys` ne suffit pas ici : il garde les motifs, à dessein — un canal
 * `user:${string}` est une déclaration. Mais le motif de la carte des routes
 * n'en est pas une : laissé, il faisait passer toute route d'une socket SANS
 * contrat pour déclarée, et `get<T>()` y rendait `unknown` au lieu de `T`.
 */
type DeclaredRouteKeys<R> = {
  [K in keyof R & string]: K extends `${BridgeVerb} ${infer P}`
    ? `/${string}` extends P
      ? never
      : K
    : never;
}[keyof R & string];

/** Membre `M` d'une route déclarée, lu par sa PRÉSENCE (`undefined` sinon). */
type RoutePart<
  R,
  K extends keyof R,
  M extends "body" | "query" | "params",
> = M extends keyof R[K]
  ? R[K] extends Partial<Record<M, infer S>>
    ? S extends IStandardSchemaV1
      ? InferSchemaInput<S>
      : undefined
    : undefined
  : undefined;

/**
 * Le corps qu'accepte une route du pont : l'entrée de son schéma quand la clé
 * `K` (`"<VERBE> <chemin>"`) appartient au contrat, `undefined` si la route
 * déclarée n'a pas de corps, libre (`unknown`) hors contrat.
 */
export type ContractRouteBody<R extends RoutesMap, K extends string> =
  K extends DeclaredRouteKeys<R> ? RoutePart<R, K, "body"> : unknown;

/**
 * Noms des variables d'un gabarit de chemin — `"/a/{id}/b/{slug}"` → `"id" | "slug"` ;
 * `never` sans variable. Même lecture que `routePathParams` (`runtime/routePath.ts`).
 */
export type RoutePathParamNames<P extends string> =
  P extends `${string}{${infer Name}}${infer Rest}`
    ? Name | RoutePathParamNames<Rest>
    : never;

/** Les valeurs d'un gabarit sans schéma : une par variable, `undefined` sans variable. */
type TemplateParams<P extends string> = [RoutePathParamNames<P>] extends [never]
  ? undefined
  : Record<RoutePathParamNames<P>, string | number>;

/**
 * Les paramètres de chemin qu'accepte une route du pont : l'entrée de son schéma
 * `params` quand la route déclarée en a un, sinon une valeur par `{nom}` du
 * gabarit `P` — sous contrat comme hors contrat.
 */
export type ContractRouteParams<
  R extends RoutesMap,
  K extends string,
  P extends string,
> =
  K extends DeclaredRouteKeys<R>
    ? "params" extends keyof R[K & keyof R]
      ? RoutePart<R, K & keyof R, "params">
      : TemplateParams<P>
    : TemplateParams<P>;

/** La query qu'accepte une route du pont — pendant de {@link ContractRouteBody}. */
export type ContractRouteQuery<R extends RoutesMap, K extends string> =
  K extends DeclaredRouteKeys<R> ? RoutePart<R, K, "query"> : unknown;

/**
 * Ce que rend une route du pont, lu par {@link Jsonify} (il a traversé le fil)
 * quand `K` appartient au contrat ; sinon le `T` que l'appelant demande.
 */
export type ContractRouteResult<R extends RoutesMap, K extends string, T> =
  K extends DeclaredRouteKeys<R>
    ? R[K & keyof R] extends { result: infer X }
      ? Jsonify<X>
      : unknown
    : T;

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

/** Valeurs que JSON transporte telles quelles. */
type JsonPrimitive = string | number | boolean | null;

/** Ce que `JSON.stringify` retire d'un objet, ou rend `null` dans un tableau. */
type JsonDropped = undefined | symbol | ((...args: never[]) => unknown);

/** Décrément de profondeur de {@link Jsonify} — `Prev[0]` vaut `never`, fin de la descente. */
type JsonifyDepth = [never, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/** Élément de tableau : ce que JSON retire d'un objet devient `null` dans un tableau. */
type JsonifyItem<T, D extends number> = T extends JsonDropped
  ? null
  : Jsonify<T, D>;

/** Objet : les membres que JSON retire disparaissent, les autres sont convertis. */
type JsonifyObject<T, D extends number> = {
  [
    K in keyof T as K extends symbol
      ? never
      : [Exclude<T[K], JsonDropped>] extends [never]
        ? never
        : K
  ]: Jsonify<T[K], D>;
};

/**
 * Le type qu'un pair REÇOIT quand l'autre a envoyé un `T` : ce que JSON en fait.
 *
 * Ce que j'envoie est ce que j'ai déclaré ; ce que je reçois est ce que JSON en
 * rend, quel que soit le codec (JSON est la référence de tous les codecs,
 * ADR-0022 §2). `serverToClient: { meeting: { start: Date } }` se lit donc
 * `{ start: string }` au `on()` du client — l'éditeur souligne `m.start.getTime()`
 * au lieu de le laisser planter au navigateur.
 *
 * - `toJSON()` est suivi (`Date` → `string`) ;
 * - un membre fonction, symbole ou toujours `undefined` disparaît d'un objet, et
 *   devient `null` dans un tableau ;
 * - `bigint` n'a pas de forme JSON (`JSON.stringify` lève) : `never` ;
 * - `Uint8Array` reste `Uint8Array` : les octets voyagent dans une trame binaire,
 *   jamais dans le JSON (ADR-0022 §2, S8) ;
 * - `unknown` reste `unknown` : le défaut permissif d'une carte non déclarée.
 *
 * Profondeur bornée à dix niveaux : au-delà, `unknown`, que l'appelant doit
 * réduire lui-même. Un type récursif sans borne ralentit le compilateur sur les
 * charges profondes. **Le type n'est pas une validation** : une entrée reste NON
 * FIABLE à l'exécution. Coût d'exécution nul (type effacé).
 *
 * @typeParam T - le type déclaré par l'émetteur.
 * @typeParam D - profondeur restante (interne).
 */
export type Jsonify<T, D extends number = 10> = unknown extends T
  ? T
  : [D] extends [never]
    ? unknown
    : T extends Uint8Array
      ? T
      : T extends { toJSON(...args: never[]): infer R }
        ? Jsonify<R, JsonifyDepth[D]>
        : T extends JsonPrimitive | undefined | void
          ? T
          : T extends bigint | symbol | ((...args: never[]) => unknown)
            ? never
            : T extends readonly unknown[]
              ? { [I in keyof T]: JsonifyItem<T[I], JsonifyDepth[D]> }
              : T extends object
                ? JsonifyObject<T, JsonifyDepth[D]>
                : never;

/**
 * Le moule du contrat temps réel d'une application — déclaré UNE fois, dans un
 * fichier partagé par ses deux côtés, et lu par chacun dans SA direction.
 *
 * Le framework ne déclare aucun contrat métier : il livre ce moule. Les quatre
 * clés sont facultatives (un tableau de bord ne déclare que `serverToClient`) ; une
 * direction absente reste permissive, comme un pair non paramétré.
 *
 * - `serverToClient` : événements poussés par le serveur. Type aussi le flux SSE
 *   d'un canal et l'émission d'un webhook (`type` = le canal) : une application
 *   écrit un contrat, ses trois livraisons le lisent.
 * - `clientToServer` : événements envoyés par le client (entrées d'un canal).
 * - `serverMethods` : méthodes du serveur — le client appelle, le serveur répond.
 * - `clientMethods` : méthodes du client — le serveur appelle, le client répond.
 *
 * Le fichier du contrat ne contient QUE des types : 0 octet compilé, et le
 * navigateur qui l'importe ne tire aucun code serveur. Chaque côté entre par sa
 * porte : `NodefonySocket.fromContract<C>()` (client) et
 * `extends ContractRealtimeController<C>` (`@nodefony/realtime`) ; un service
 * diffuse par `getRealtimeHub<C>()`. Le type n'est pas une
 * validation : la garde de canal s'applique à toutes les livraisons.
 *
 * @example
 * ```ts
 * // shared/chat.ts
 * export interface ChatContract extends IRealtimeContract {
 *   serverToClient: { "chat:room": { from: string; text: string } };
 *   clientToServer: { "chat:typing": { on: boolean } };
 *   serverMethods: { "chat:send": { in: { text: string }; out: { id: string } } };
 * }
 * ```
 */
export interface IRealtimeContract {
  /** Événements poussés par le serveur (socket, flux SSE, webhook). */
  serverToClient?: EventsMap;
  /** Événements envoyés par le client. */
  clientToServer?: EventsMap;
  /** Méthodes du serveur : le client appelle, le serveur répond. */
  serverMethods?: ActionsMap;
  /** Méthodes du client : le serveur appelle, le client répond. */
  clientMethods?: ActionsMap;
  /**
   * Routes servies par le pont `api.request` : `"<VERBE> <chemin>"` → schéma du
   * corps et de la query (`typeof` du schéma que la route VALIDE — une seule
   * source) et résultat. Le client en déduit `get`/`post`/`put`/`patch`/`delete` ;
   * le serveur vérifie au démarrage que chaque entrée a sa route
   * (`ContractRealtimeController`, table statique `serverRoutes`).
   */
  serverRoutes?: RoutesMap;
}

/**
 * Les routes du pont qu'un client appelle — `serverRoutes` du contrat, ou la
 * carte permissive si le contrat n'en déclare pas.
 */
export type ContractClientRoutes<C extends IRealtimeContract> = ContractSide<
  C,
  "serverRoutes",
  RoutesMap
>;

/**
 * Table de VALEURS qu'un contrôleur de contrat déclare pour que le démarrage
 * vérifie ses `serverRoutes` : une entrée par route du contrat, portant le
 * schéma même que la route valide (`body`, `query`, `params`). Écrite côté serveur
 * seulement — le navigateur ne la voit jamais, donc n'embarque aucun schéma.
 *
 * @example
 * ```ts
 * class ChatRt extends ContractRealtimeController<ChatContract> {
 *   static readonly serverRoutes = {
 *     "POST /chat/send": { body: SendBody },
 *     "GET /chat/history": {},
 *   } satisfies ContractRouteSchemas<ChatContract>;
 * }
 * ```
 */
export type ContractRouteSchemas<C extends IRealtimeContract> = {
  [K in LiteralKeys<ContractClientRoutes<C>>]: {
    [
      P in keyof ContractClientRoutes<C>[K] & ("body" | "query" | "params")
    ]: ContractClientRoutes<C>[K][P];
  };
};

/** Carte d'une direction du contrat ; direction absente → `M` déclaré par le moule (permissif). */
type ContractSide<C, K extends keyof IRealtimeContract, M> = K extends keyof C
  ? NonNullable<C[K]> extends M
    ? NonNullable<C[K]>
    : M
  : M;

/** Carte d'événements telle que le pair qui la REÇOIT la lit. */
type ReceivedEvents<M> = { [K in keyof M]: Jsonify<M[K]> };

/**
 * Carte de méthodes vue d'un côté : `Jsonify` sur le membre REÇU (`in` pour qui
 * implémente, `out` pour qui appelle), le type déclaré sur le membre envoyé.
 */
type MethodsSeenBy<M, Received extends "in" | "out"> = {
  [K in keyof M]: {
    [P in keyof M[K]]: P extends Received ? Jsonify<M[K][P]> : M[K][P];
  };
};

/** Ce que le serveur ÉMET : `serverToClient`, tel que déclaré. */
export type ContractServerEmit<C extends IRealtimeContract> = ContractSide<
  C,
  "serverToClient",
  EventsMap
>;

/** Ce que le serveur REÇOIT : `clientToServer`, lu par {@link Jsonify}. */
export type ContractServerListen<C extends IRealtimeContract> = ReceivedEvents<
  ContractSide<C, "clientToServer", EventsMap>
>;

/**
 * Les méthodes que le serveur APPELLE (`requestClient`) : `clientMethods`, le
 * résultat lu par {@link Jsonify}.
 */
export type ContractServerActions<C extends IRealtimeContract> = MethodsSeenBy<
  ContractSide<C, "clientMethods", ActionsMap>,
  "out"
>;

/**
 * Les méthodes que le serveur IMPLÉMENTE : `serverMethods`, les paramètres lus par
 * {@link Jsonify}, le résultat tel que déclaré.
 */
export type ContractServerMethods<C extends IRealtimeContract> = MethodsSeenBy<
  ContractSide<C, "serverMethods", ActionsMap>,
  "in"
>;

/** Ce que le client ÉMET : `clientToServer`, tel que déclaré. */
export type ContractClientEmit<C extends IRealtimeContract> = ContractSide<
  C,
  "clientToServer",
  EventsMap
>;

/** Ce que le client REÇOIT : `serverToClient`, lu par {@link Jsonify}. */
export type ContractClientListen<C extends IRealtimeContract> = ReceivedEvents<
  ContractSide<C, "serverToClient", EventsMap>
>;

/**
 * Les méthodes du client vues par `NodefonySocket` : `serverMethods` qu'il appelle
 * (`request`, résultat lu par {@link Jsonify}) et `clientMethods` qu'il implémente
 * (`register`, paramètres lus par {@link Jsonify}). La socket range les deux sous
 * un seul générique `Actions` : une méthode déclarée des deux côtés sous le même
 * nom n'a pas de sens, le contrat ne la sépare pas.
 */
export type ContractClientActions<C extends IRealtimeContract> = MethodsSeenBy<
  ContractSide<C, "serverMethods", ActionsMap>,
  "out"
> &
  MethodsSeenBy<ContractSide<C, "clientMethods", ActionsMap>, "in">;

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
// Le paramètre de type EST l'assertion (nommé par l'appelant) : sa présence
// unique dans la signature est le but de l'outil.
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters
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
  /**
   * Identifiant STABLE et OPAQUE du compte — la clé des canaux personnels
   * (`user:${id}`) ; `null` pour l'anonyme, et pour un authentificateur qui ne
   * produit pas d'identité d'admission (`IRealtimeToken.getIdentity` absent).
   *
   * Jamais le login : un e-mail change, un login libéré se réattribue, et le
   * nouveau compte hériterait des canaux de l'ancien. C'est l'identifiant du
   * compte local, ou `<émetteur>#<sujet>` pour un appelant sans compte.
   */
  id: string | null;
  /** Identifiant logique du porteur (`"anonymous"`, `"user-42"`, …) — affichage et audit, jamais une clé de canal. */
  userIdentifier: string;
  /** Rôles **plats** (RBAC, sans hiérarchie résolue) — `["ROLE_ANONYMOUS"]` si anonyme. */
  roles: readonly string[];
  /** Scopes accordés (clés API / OAuth) — `[]` en session BFF web. */
  scopes: readonly string[];
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
  /**
   * Le serveur ACQUITTE chaque abonnement accepté (`realtime:subscribed`, cf
   * {@link IRealtimeSubscribed}).
   *
   * ⚠️ **Une absence vaut « pas d'acquittement »** : un serveur antérieur à la
   * notification ne pose pas ce champ, et un client qui l'attendrait resterait
   * suspendu pour toujours. Sans lui, le client répute l'abonnement actif dès
   * qu'il l'a rejoué au welcome — la garantie d'avant, sans plus.
   */
  subscriptionAcks?: boolean;
  /**
   * Sous-protocole du codec retenu pour les frames qui SUIVENT cet accueil — l'un de
   * ceux que le client a offerts au handshake (ADR-0022 §2, cf `IFrameCodec`).
   *
   * ⚠️ **Une absence vaut `nodefony.jsonrpc.v1`** (JSON-RPC texte) : un serveur sans
   * branchement du codec ne pose pas ce champ. Et l'écho `Sec-WebSocket-Protocol`
   * du handshake ne fait jamais foi — `ws` renvoie le premier sous-protocole offert,
   * qu'il le parle ou non.
   */
  codec?: string;
  /**
   * Marqueur de la convention d'octets (`$bytes`) que le serveur émet sur cette
   * connexion TEXTE — posé quand il a activé un codec binaire que le client n'a pas
   * pris (ADR-0022 §2). Le client passe alors au JSON à convention, sans rien avoir
   * importé, et rend des `Uint8Array`. Absent : JSON natif, comme avant les codecs.
   */
  bytes?: string;
}

/**
 * Payload de la notification système `realtime:subscribed` — poussée par le
 * serveur quand un `subscribe` est ACCEPTÉ, y compris pour un canal que la
 * connexion suivait déjà (sans quoi un `subscribe` réémis attendrait un
 * acquittement qui ne vient jamais).
 *
 * Garantie : tout événement publié sur le canal APRÈS l'émission de cette
 * notification est livré à la connexion. Le producteur s'attache AVANT
 * l'acquittement : une première charge (un tick initial) peut donc arriver
 * avant lui — « rien n'arrive avant » n'est PAS promis.
 *
 * Le pendant de {@link IRealtimeDenied} : un abonnement reçoit l'un ou l'autre,
 * jamais les deux, et un refus n'est jamais acquitté. Cold path (1×/canal et
 * par connexion).
 */
export interface IRealtimeSubscribed {
  /** Canal dont l'abonnement est désormais effectif sur cette connexion. */
  channel: string;
  /**
   * `true` quand c'est le SERVEUR qui a abonné la connexion (abonnement imposé,
   * ADR-0022 §6 décision 2) — absent pour la réponse à un `subscribe` du client.
   * Le client inscrit alors le canal dans ses abonnements, comme s'il l'avait
   * demandé : il le rejoue à la reconnexion, et peut s'en désabonner.
   */
  imposed?: true;
}

/**
 * Motif d'un `realtime:closed`. Fermé exprès, comme {@link RealtimeDeniedReason} :
 * le client doit pouvoir traiter tous les cas.
 *
 * - `"ended"` — le canal est terminé pour TOUS ses abonnés (fin d'appel, partie
 *   finie, import achevé).
 * - `"evicted"` — CETTE connexion en est retirée ; les autres restent servies.
 */
export type RealtimeClosedReason = "ended" | "evicted";

/**
 * Payload de la notification système `realtime:closed` — poussée par le serveur
 * quand il met fin, de lui-même, à un abonnement en cours (ADR-0021 S4,
 * ADR-0022 §6 décision 3).
 *
 * Le client retire l'abonnement et ne le rejoue PAS à la reconnexion. Ce n'est
 * qu'une politesse : une page rechargée refait `subscribe`, et c'est alors la
 * règle d'entrée du canal (`allow`) ou sa fabrique qui tranche. Un refus n'est
 * pas une fin : il a `realtime:denied`. Cold path.
 */
export interface IRealtimeClosed {
  /** Canal dont l'abonnement vient de prendre fin. */
  channel: string;
  /** Pourquoi (cf {@link RealtimeClosedReason}) — jamais le détail de la décision. */
  reason: RealtimeClosedReason;
}

/**
 * Ce que porte une identité présente sur un canal (ADR-0025 P4) — l'entrée de la VUE
 * (`ReadonlyMap` du hook, `hub.presence()`). Sur le fil, entre pods comme vers le
 * navigateur, elle voyage à plat ({@link PresencePairs}, {@link PresenceStates}).
 *
 * Le nombre d'onglets suffit tant qu'aucun état n'existe ; les états voyagent dans un
 * champ FACULTATIF distinct, jamais par un changement de type de la valeur, qu'un lecteur
 * plus ancien refuserait pendant un déploiement progressif. 10.0 livre la forme et AUCUN
 * moyen de poser un état.
 *
 * @typeParam TState - état d'un onglet, fixé plus tard par le contrat de l'application.
 */
export interface IPresenceEntry<TState = unknown> {
  /** Connexions (onglets) de cette identité sur le canal, tous pods confondus — entier ≥ 1. */
  tabs: number;
  /**
   * États par onglet ; clé = référence d'onglet OPAQUE (elle ne dit rien de la topologie
   * des pods), présente seulement avec un état (RFC 3863 §4.1.2, `id` de chaque tuple).
   */
  states?: Readonly<Record<string, TState>>;
}

/**
 * En-tête commun des trames `realtime:presence` (ADR-0025 P2 bis) — champs figés.
 */
export interface IRealtimePresenceHead {
  /** Nom EXACT du canal décrit (un canal cadencé `base:<ms>` en est un autre). */
  channel: string;
  /**
   * Version de la vue, entière, propre au canal SUR le pod qui sert la connexion.
   * +1 par trame de changements seulement ; une liste complète porte la version COURANTE.
   */
  version: number;
  /** Identités NOMMÉES distinctes présentes (comptes seulement). */
  count: number;
  /** Connexions comptées sans être nommées (anonymes, appelants machine sans compte). */
  unnamed: number;
  /**
   * Présent seulement à `true` : la vue est connue incomplète ou figée (liste locale avant
   * la réponse des pairs, bus perdu, trou en cours sur un pod). Absent = complète.
   */
  partial?: true;
}

/**
 * Identités et nombre d'onglets À PLAT : `[identité, onglets, identité, onglets, …]` —
 * la forme sur le fil de {@link IPresenceEntry} (sans ses états).
 *
 * Choisie pour le coût, pas pour la lecture : aucun objet par membre à l'encodage ni au
 * décodage (un tableau compact de primitives, là où `{ id: { tabs } }` alloue un objet
 * par identité et un objet à clés dynamiques), -18 % d’octets en JSON et -13 % en CBOR à 1 000 membres (mesuré),
 * et une identité n'y est jamais une CLÉ d'objet (`__proto__` sans objet). Le lecteur
 * avance de deux en deux et garde chaque paire par `typeof` (gratuit, et exigé par
 * `noUncheckedIndexedAccess`).
 */
export type PresencePairs = readonly (string | number)[];

/**
 * États par identité puis par onglet (référence opaque → état) — champ FACULTATIF voisin
 * des paires, présent seulement pour les identités qui ont un état. Un lecteur qui ne le
 * connaît pas l'ignore ; jamais posé en 10.0 (ADR-0025 P4).
 */
export type PresenceStates<TState = unknown> = Readonly<
  Record<string, Readonly<Record<string, TState>>>
>;

/** Changements appliqués à la vue (trame {@link IRealtimePresenceDelta}). */
export interface IRealtimePresenceChanges<TState = unknown> {
  /** Identités arrivées ou modifiées, avec leur nombre d'onglets (remplace l'ancien). */
  set?: PresencePairs;
  /** États des identités de `set` qui en portent un. */
  states?: PresenceStates<TState>;
  /** Identités parties. Un pod perdu = UNE trame qui les nomme toutes. */
  gone?: readonly string[];
}

/**
 * Liste complète : REMPLACE la vue et RÉINITIALISE sa référence de version. Servie à
 * chaque (re-)`subscribe`, et à tout moment quand elle pèse moins que les changements
 * (RFC 5262 §4) — le client l'accepte sans l'avoir demandée.
 */
export interface IRealtimePresenceList<
  TState = unknown,
> extends IRealtimePresenceHead {
  /** Tous les présents NOMMÉS, à plat (cf {@link PresencePairs}). */
  members: PresencePairs;
  /** États des présents qui en portent un. */
  states?: PresenceStates<TState>;
  changes?: never;
}

/**
 * Changements numérotés : s'appliquent à la vue seulement si la règle
 * `classifyNumberedChange(référence, version)` rend `applied` ; `gap` → le client réémet
 * `subscribe`, `stale` → jetée.
 */
export interface IRealtimePresenceDelta<
  TState = unknown,
> extends IRealtimePresenceHead {
  changes: IRealtimePresenceChanges<TState>;
  members?: never;
  states?: never;
}

/**
 * Nombres seuls : au-delà du seuil de membres nommés (défaut 1 000 ; seuil 0 = jamais
 * nommés), aucune identité ne voyage. Complète comme une liste — elle porte la version
 * courante, remplace la vue (vide d'identités) et réinitialise la référence.
 */
export interface IRealtimePresenceCount extends IRealtimePresenceHead {
  members?: never;
  changes?: never;
  states?: never;
}

/**
 * Nom de la notification du protocole qui porte la présence d'un canal (ADR-0025 P2 bis) — une source pour le serveur qui l'émet et le navigateur qui la lit.
 */
export const REALTIME_PRESENCE_METHOD = "realtime:presence";

/**
 * Payload de la notification du protocole `realtime:presence` (ADR-0025 P2 bis) : qui
 * est présent sur un canal à présence. Exactement une des trois formes — la discriminer
 * par `changes !== undefined`, puis `members !== undefined`, sinon nombres seuls.
 *
 * Un client plus ancien l'ignore (méthode inconnue). Les identités voyagent en paires à
 * plat ({@link PresencePairs}) ; le client les range dans une `Map`.
 *
 * @typeParam TState - état d'un onglet (cf {@link IPresenceEntry}).
 */
export type RealtimePresenceFrame<TState = unknown> =
  | IRealtimePresenceList<TState>
  | IRealtimePresenceDelta<TState>
  | IRealtimePresenceCount;

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
  /**
   * Ce qui s'est passé, en clair — **hors production UNIQUEMENT**.
   *
   * `reason` est fermé et générique par construction : c'est ce qui empêche
   * d'en faire un oracle. Mais un développeur qui reçoit `forbidden` n'a alors
   * aucun moyen de savoir LEQUEL des cas il tient — rôle insuffisant, ou
   * plancher de plateforme fermé faute de module de sécurité — ni quoi
   * regarder. Il lui reste à deviner, et un signal qu'on ne sait pas lire ne
   * vaut guère mieux qu'un silence.
   *
   * Ce champ porte donc la phrase utile, et il est posé par
   * {@link deniedDetail}, sur le modèle EXACT de `welcomeEnv` : **absent en
   * production**, où la même phrase deviendrait précisément l'oracle que
   * `reason` refuse d'être. Une absence vaut production, jamais l'inverse.
   */
  detail?: string;
  /**
   * Délai minimal, en millisecondes, avant de réessayer — posé seulement avec
   * `reason: "unavailable"`, quand le serveur sait combien de temps il restera
   * indisponible (coupe-circuit ouvert). Le client attend AU MOINS ce délai ;
   * absent, il suit son seul recul.
   */
  retryAfterMs?: number;
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
 * - `"unavailable"` — INDÉCIDABLE pour l'instant : la règle d'admission
 *   (`allow`) n'a pas répondu dans son délai, ou l'exemplaire est saturé
 *   d'admissions en cours. Ce n'est PAS un verdict sur le droit de l'abonné —
 *   le client réessaie ce seul abonnement (recul exponentiel à gigue complète,
 *   trois tentatives au plus), en respectant `retryAfterMs` s'il est posé.
 *   Les trois autres motifs ne se réessaient jamais.
 */
export type RealtimeDeniedReason =
  "forbidden" | "limit" | "unknown" | "unavailable";
