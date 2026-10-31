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
}

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
