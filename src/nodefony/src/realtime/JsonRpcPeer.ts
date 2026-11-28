/**
 * JsonRpcPeer — moteur protocole **JSON-RPC 2.0 ISOMORPHE** (client ET serveur).
 *
 * Client et serveur sont des **pairs** : le protocole (classer une frame, router,
 * corréler les réponses) est identique des deux côtés. Cette classe l'implémente
 * **une seule fois** ; chaque côté l'enrobe de son transport (`send`) et de ses
 * handlers. → fin de la duplication client/serveur (la discrimination request /
 * notification / response vivait à 2 endroits qui divergeaient).
 *
 * Transport-agnostique : on injecte `send(frame)` ; le peer ignore WebSocket/TCP/…
 * Aucune dépendance Node (browser-safe) : seulement `setTimeout`/`clearTimeout`.
 *
 * ── La RÈGLE de discrimination (le cœur) ──
 *  Le RÔLE d'une frame se lit sur `method`, PAS sur `id` :
 *   - `method` + `id`        → **requête** entrante  → handler enregistré → réponse `result`/`error`
 *   - `method` seul          → **notification**      → `onNotification` (pas de réponse)
 *   - `id` sans `method`, avec `result` OU `error` bien formé
 *                            → **réponse**           → résout/rejette un `pending` sortant
 *  `id` autorisé string OU number (JSON-RPC 2.0 §id). Méthode inconnue → `-32601` ;
 *  handler qui throw → `-32603` (message GÉNÉRIQUE au pair, détail via `onError` = Zero Trust).
 *  La classification est celle de `classifyJsonRpcFrame` (`jsonrpc/`), PARTAGÉE
 *  avec la porte MCP : un `id` null, objet ou booléen rend la frame invalide.
 *
 * ── Types partagés (pattern Socket.IO) ────────────────────────────────────
 *  3 génériques (`Emit`, `Listen`, `Actions`) avec **défauts permissifs**
 *  ({@link DefaultEventsMap}, {@link DefaultActionsMap}) : code non paramétré
 *  → comportement pré-types inchangé (rétro-compat 100%). Cf {@link EventsMap},
 *  {@link ActionsMap} et le détail dans `RealtimeEventMap.ts`.
 */

import type {
  ActionNames,
  ActionParams,
  ActionResult,
  ActionsMap,
  DefaultActionsMap,
  DefaultEventsMap,
  EventNames,
  EventPayload,
  EventsMap,
  TypedRpcActionHandler,
} from "./RealtimeEventMap";
import {
  JSON_RPC_CANCEL_REQUEST,
  JSON_RPC_PROGRESS,
  JSON_RPC_VERSION,
  JsonRpcBaseProtocolError,
  JsonRpcError,
  JsonRpcServerError,
  classifyJsonRpcFrame,
  isJsonRpcErrorObject,
  isJsonRpcId,
  jsonRpcFailure,
  jsonRpcNotification,
  jsonRpcRequest,
  jsonRpcSuccess,
  type IJsonRpcErrorObject,
  type IJsonRpcNotification,
  type IJsonRpcRequest,
  type IJsonRpcSuccess,
  type JsonRpcFrameKind,
  type JsonRpcId,
} from "../jsonrpc/index";
import type { IFrameCodec } from "./IFrameCodec";
import { JSON_FRAME_CODEC } from "./jsonFrameCodec";

export type { JsonRpcFrameKind } from "../jsonrpc/index";

/**
 * Erreur JSON-RPC 2.0 (objet `error` d'une réponse).
 *
 * Alias de {@link IJsonRpcErrorObject}, la forme partagée par toutes les
 * portes JSON-RPC du framework — conservé pour ses consommateurs.
 */
export type JsonRpcErrorObject = IJsonRpcErrorObject;

/**
 * Refus d'une frame entrante par `beforeDispatch` — code de la plage serveur
 * (JSON-RPC 2.0 §5.1), propre au temps réel. Message GÉNÉRIQUE : le pair
 * n'apprend pas pourquoi (Zero Trust).
 */
const REALTIME_UNAUTHORIZED = -32001;

/**
 * Erreur RPC **applicative** — l'exception VOLONTAIRE au principe « throw →
 * `-32603` générique » : un handler qui rejette avec une `RpcError` choisit
 * explicitement d'exposer `code`/`message`/`data` au pair (404 d'un path
 * invoqué, 403 d'un voter…). Tout autre throw reste opaque (Zero Trust).
 *
 * Isomorphe : côté serveur le handler la lève ; côté client `request()` rejette
 * avec — `code` et `data` (ex. `{ status: 404 }`) sont lisibles par l'appelant,
 * symétrie d'un `fetch` qui expose son statut HTTP.
 *
 * Plage de codes : `-32000` à `-32099` (« Server error », réservée applicatif
 * par JSON-RPC 2.0 §5.1). Défaut `-32000`.
 */
// `code` déclaré par FUSION interface+classe (pas un champ de classe) : le
// build node augmente l'interface globale `Error` (`code?: any`, cf Error.ts)
// → un champ déclaré exigerait `override` ; le build client (tsconfigClient,
// sans cette augmentation) refuserait ce même `override` (TS4113/TS4114
// inconciliables). La prop fusionnée échappe au check et type `number` partout.
// oxlint-disable-next-line no-unsafe-declaration-merging -- fusion VOULUE, cf ci-dessus
export interface RpcError {
  /** Code JSON-RPC 2.0 (`-32000`…`-32099` applicatif, ou codes protocole). */
  code: number;
}
export class RpcError extends Error {
  override readonly name = "RpcError";
  readonly data?: unknown;

  constructor(
    message: string,
    code: number = JsonRpcServerError.DEFAULT,
    data?: unknown,
  ) {
    super(message);
    this.code = code;
    if (data !== undefined) this.data = data;
  }
}

/**
 * Le rejet d'une requête dont le délai a expiré — le pair n'a pas répondu, et
 * l'annulation (`$/cancelRequest`) lui est partie. Distinct d'un pair disposé
 * ou d'un abandon : l'appelant qui se replie doit pouvoir DIRE que le serveur
 * n'a pas répondu, sans lire le texte du message.
 */
export class RpcTimeoutError extends Error {
  override readonly name = "RpcTimeoutError";

  /** @param method - la méthode restée sans réponse. */
  constructor(readonly method: string) {
    super(`RPC timeout: ${method}`);
  }
}

/**
 * Métadonnées **serveur** d'une réponse RPC — transportées À CÔTÉ du `result`,
 * jamais dedans (le `result` d'`api.request` doit rester identique à ce que
 * rendrait la même route en REST : « snapshot ≡ GET REST » par construction).
 *
 * Aujourd'hui : `requestId` (dev) = la clé du profil de la frame dans le
 * Profiler → le client peut aller chercher sa radiographie. Champ ouvert :
 * un pair qui n'en connaît pas les clés l'ignore (rétro-compatible).
 */
export interface RpcMeta {
  /** Identifiant du profil de CETTE invocation (`<connexion>.<n° de frame>`). */
  requestId?: string;
  [key: string]: unknown;
}

/**
 * Réponse d'un handler qui veut JOINDRE des métadonnées serveur à son résultat.
 *
 * Un handler retourne normalement sa valeur nue (elle devient `result`). Quand
 * il retourne une enveloppe, le peer la déballe : `result` reste la valeur nue,
 * et `meta` voyage dans un champ frère de la trame JSON-RPC. Coût pour ceux qui
 * ne l'utilisent pas : un `instanceof` par frame.
 */
export class RpcEnvelope<T = unknown> {
  constructor(
    readonly result: T,
    readonly meta: RpcMeta,
  ) {}
}

/** Résultat d'un appel sortant tracé : la valeur + la méta serveur. */
export interface RpcTracedResult<T = unknown> {
  result: T;
  meta?: RpcMeta;
}

/** Délai d'une requête sortante sans délai donné — celui d'un réseau. */
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

/**
 * Une part de contenu typée — la forme du `Part` d'A2A et du `content` de MCP :
 * une porte future la traduit champ pour champ. Toute surface sait afficher
 * une part `text` ; une part `data` se dessine par qui connaît son `mediaType`.
 */
export type RpcPart =
  | { readonly text: string; readonly mediaType?: string }
  | { readonly data: unknown; readonly mediaType: string }
  | {
      readonly raw: string;
      readonly mediaType: string;
      readonly filename?: string;
    }
  | { readonly url: string; readonly mediaType?: string };

/**
 * Une étape qu'un handler émet par {@link IRpcCall.progress}. Sans `progress`,
 * le pair numérote (1, 2, 3…) ; un `progress` donné doit croître strictement.
 */
export interface IRpcProgressUpdate {
  /** Rang de l'étape, strictement croissant. */
  readonly progress?: number;
  /** Nombre d'étapes attendu, quand il est connu. */
  readonly total?: number;
  /** Libellé court de l'étape. */
  readonly message?: string;
  /** Contenu produit par l'étape. */
  readonly parts?: readonly RpcPart[];
}

/**
 * Une étape reçue par l'appelant (`$/progress`, champ `value`) — numérotée.
 * Donnée réseau : le contrat la décrit sans la valider.
 */
export interface IRpcProgress extends IRpcProgressUpdate {
  readonly progress: number;
}

/**
 * Options d'une requête sortante — la forme longue du troisième argument de
 * `request` ; un nombre y reste le délai.
 */
export interface IRpcRequestOptions {
  /** Délai avant rejet (défaut 30 s) ; expiré, il ANNULE aussi la requête chez le pair. */
  readonly timeoutMs?: number;
  /**
   * Abandon : la promesse rejette avec la raison du signal, puis le pair émet
   * `$/cancelRequest`. Déjà abandonné : rejet immédiat, rien n'est émis.
   */
  readonly signal?: AbortSignal;
  /**
   * Demande un flux : la requête porte `meta.progressToken`, et chaque
   * `$/progress` du répondant arrive ici jusqu'à la réponse. Une étape ne
   * repousse pas le délai.
   */
  readonly onProgress?: (value: IRpcProgress) => void;
}

/**
 * L'appel en cours, tel que le voit un handler posé par
 * {@link JsonRpcPeer.registerCall} : de quoi s'interrompre et émettre un flux.
 */
export interface IRpcCall {
  /** `id` de la requête entrante. */
  readonly id: JsonRpcId;
  /**
   * Abandonné quand l'appelant annule (`$/cancelRequest`) ou que le pair est
   * disposé. Créé à la première lecture : qui ne le lit pas ne le paie pas.
   */
  readonly signal: AbortSignal;
  /**
   * Émet une étape (`$/progress`).
   *
   * @returns `false` quand l'appelant n'a demandé aucun flux, que la requête
   *   est close, ou que la frame n'est pas partie.
   */
  progress(update: IRpcProgressUpdate): boolean;
}

/**
 * Handler d'une action posée par {@link JsonRpcPeer.registerCall} : il reçoit
 * l'appel en cours en plus des `params`. Paramètres en position de méthode
 * (bivariants), comme {@link RpcActionHandler}.
 */
export type RpcCallHandler = {
  handle(params: unknown, call: IRpcCall): unknown;
}["handle"];

/** {@link RpcCallHandler} typé par le contrat d'actions. */
export type TypedRpcCallHandler<
  M extends ActionsMap,
  K extends ActionNames<M>,
> = (
  params: ActionParams<M, K>,
  call: IRpcCall,
) => ActionResult<M, K> | Promise<ActionResult<M, K>>;

/**
 * Handler d'une action (requête→réponse). Sync ou async ; throw → `-32603`.
 *
 * Le paramètre est déclaré en position de MÉTHODE, donc comparé de façon
 * bivariante : un handler typé par le contrat (`TypedRpcActionHandler`) s'y
 * range sans conversion. C'est la frontière où les paramètres reçus du réseau
 * rencontrent le contrat — le contrat les décrit sans les valider, comme
 * `RealtimeHandler` pour les canaux.
 */
export type RpcActionHandler = {
  handle(params: unknown): unknown;
}["handle"];

/**
 * Handler des notifications entrantes (pas de réponse). Paramétrable par `Listen`
 * (map des notifications REÇUES par ce peer). Défaut permissif → comportement
 * pré-types-partagés inchangé.
 */
export type RpcNotificationHandler<
  Listen extends EventsMap = DefaultEventsMap,
> = <K extends EventNames<Listen>>(
  method: K,
  params: EventPayload<Listen, K>,
) => void;

/**
 * Frame de notification sortante (JSON-RPC 2.0, sans `id` : aucune réponse
 * attendue). Type nommé parce que cette frame **sort du peer** : le fan-out d'un
 * canal diffusé la sérialise une fois pour tous ses abonnés. Alias de
 * {@link IJsonRpcNotification}, la forme partagée.
 */
export type JsonRpcNotification = IJsonRpcNotification;

/**
 * Motif d'un évènement audit protocolaire (consommé par P6.14 `AuditEventEntity`) :
 *  - `invalid`           : frame non conforme JSON-RPC 2.0 (cf `classifyJsonRpcFrame` : lot, `jsonrpc`≠"2.0", `id` null/objet/booléen, `method` non chaîne, réponse sans `result` ni `error` valide).
 *  - `denied`            : frame entrante refusée par `beforeDispatch` (Zero Trust realtime — voter P6 a dit non).
 *  - `method_not_found`  : requête entrante pour une action non enregistrée (`-32601` envoyée).
 *  - `internal_error`    : handler d'action a throw (`-32603` envoyée, détail loggé via `onError` — Zero Trust : pas renvoyé au pair).
 */
export type FrameAuditReason =
  "invalid" | "denied" | "method_not_found" | "internal_error";

/**
 * Sortie d'un pair qui laisse la SÉRIALISATION à son transport : il reçoit la
 * frame en objet. Forme historique, conservée pour les transports qui ne
 * parlent pas de codec (relais en mémoire, tests).
 */
export interface IJsonRpcFrameSink {
  /**
   * Envoie une frame sérialisable sur le transport (le peer ignore le transport).
   *
   * Un transport qui sait que la frame **n'est pas partie** (socket fermée,
   * reconnexion en cours) doit retourner `false` : le peer rejette alors la
   * requête corrélée immédiatement, au lieu de laisser l'appelant attendre son
   * timeout pour une frame jamais émise. `void`/`true` = considéré comme émis
   * (comportement historique des transports qui ne savent pas répondre).
   */
  send: (frame: unknown) => boolean | void;
  write?: never;
  admit?: never;
  codec?: never;
}

/**
 * Sortie d'un pair qui SÉRIALISE lui-même, avec son codec courant (ADR-0022 §4,
 * ligne (i) : les codecs vivent dans le pair partagé, jamais dans le client ni
 * dans le contrôleur). Le transport ne reçoit que des données prêtes pour le fil.
 */
export interface IJsonRpcWireSink {
  /**
   * Écrit une frame DÉJÀ encodée sur le transport.
   *
   * @param data - la frame encodée par le codec courant : une chaîne (trame
   *   texte) ou des octets (trame binaire).
   * @param frame - la même frame en objet, pour qui la journalise — à ne pas
   *   réencoder.
   * @returns `false` si la frame n'est pas partie (même contrat que
   *   {@link IJsonRpcFrameSink.send}).
   */
  write: (
    data: string | Uint8Array<ArrayBuffer>,
    frame: unknown,
  ) => boolean | void;
  /**
   * Contre-pression AVANT l'encodage : `false` → la frame n'est ni encodée ni
   * écrite, et compte comme non émise. Absent → toujours admise.
   */
  admit?: (() => boolean) | undefined;
  /**
   * Codec du début de connexion — le texte `nodefony.jsonrpc.v1` par défaut,
   * celui de l'accueil. La bascule se fait ensuite par {@link JsonRpcPeer.codec}.
   */
  codec?: IFrameCodec | undefined;
  send?: never;
}

/**
 * Crochets d'un pair JSON-RPC, communs aux deux formes de sortie.
 */
export interface IJsonRpcPeerHooks<
  Emit extends EventsMap = DefaultEventsMap,
  Listen extends EventsMap = DefaultEventsMap,
  Actions extends ActionsMap = DefaultActionsMap,
> {
  /** Notifications entrantes (`method` sans `id`) : pub/sub côté client, subscribe/unsubscribe côté serveur. */
  onNotification?: RpcNotificationHandler<Listen> | undefined;
  /**
   * Erreur interne — détail JAMAIS renvoyé au pair (journalisé ici) : un handler
   * qui lève, une réponse ou une notification que le codec ne sait pas encoder.
   * Absent, une notification non encodable lève chez l'appelant de `notify`.
   */
  onError?: ((context: string, err: unknown) => void) | undefined;
  /**
   * **Seam sécurité 1/5 (P13 → P6)** — gate `beforeDispatch` appelé AVANT le
   * dispatch d'une frame entrante (request ET notification — pas les responses,
   * passives). `false` → frame BLOQUÉE (audit `denied`, et pour une requête,
   * réponse `-32001 unauthorized` ; notification = drop silencieux). `true` →
   * dispatch normal. `undefined` (cas client par défaut) → bypass 0-coût.
   *
   * SYNC uniquement (voters P6 = lecture metadata + jeton décodé en cache = ~µs).
   * L'async serait une fausse économie : ajouter `await` sur le hot-path d'une WS
   * coûte une microtask PAR FRAME (~50 ns) y compris quand non-async (Promise.resolve)
   * + sérialise les frames per-peer. Si un voter doit attendre une lookup distante,
   * pré-cacher la décision côté authenticator au handshake.
   *
   * Branchement P6 : reading metadata `@IsGranted` du handler + voters → `boolean`.
   *
   * La trame arrive DÉJÀ CLASSÉE (requête ou notification, `method` chaîne) :
   * aucun garde de forme ni conversion à refaire sur le chemin chaud. Un hook
   * écrit pour `unknown` reste accepté — un paramètre plus étroit ne casse
   * aucune fonction existante.
   */
  beforeDispatch?:
    | ((
        frame: IJsonRpcRequest | IJsonRpcNotification,
        peer: IRealtimePeer<Emit, Actions>,
      ) => boolean)
    | undefined;
  /**
   * **Seam audit 5/5 (P13 → P6.14)** — fire-and-forget sur évènements
   * protocolaires notables (cf {@link FrameAuditReason}). Sync (pas de
   * back-pressure : un audit lent ne doit pas ralentir le pipeline RPC).
   * `undefined` (cas client par défaut) → bypass 0-coût.
   *
   * Le `peer` est passé pour permettre au consommateur (typiquement
   * `RealtimeHub` côté serveur) de retrouver l'**actor** associé à la
   * connexion via son mapping `peer → IRealtimeToken` (slot #6 forward-audit
   * P6 : « qui a été refusé » exige l'identité, pas juste l'IP du paquet).
   *
   * Branchement P6.14 : alimente le journal `AuditEventEntity` (qui agit, qui a
   * été refusé, qui appelle une méthode inconnue — traçabilité Zero Trust).
   */
  onFrameAudit?:
    | ((
        reason: FrameAuditReason,
        frame: unknown,
        peer: IRealtimePeer<Emit, Actions>,
      ) => void)
    | undefined;
}

/**
 * Options d'un {@link JsonRpcPeer} : ses crochets, et UNE sortie — `send` (le
 * transport sérialise) ou `write` (le pair encode avec son codec).
 */
export type JsonRpcPeerOptions<
  Emit extends EventsMap = DefaultEventsMap,
  Listen extends EventsMap = DefaultEventsMap,
  Actions extends ActionsMap = DefaultActionsMap,
> = IJsonRpcPeerHooks<Emit, Listen, Actions> &
  (IJsonRpcFrameSink | IJsonRpcWireSink);

/**
 * Surface BIDIRECTIONNELLE d'un endpoint temps réel — **contrat ISOMORPHE**,
 * identique back et front. `NodefonySocket` (navigateur) ET la connexion serveur
 * l'exposent, en composant le même {@link JsonRpcPeer}. Du code métier écrit
 * contre cette interface tourne des deux côtés (le pari isomorphe de Nodefony).
 *
 * Sortant : `request` (attend une réponse), `notify` (fire-and-forget).
 * Entrant : `receive` (le transport y pousse chaque frame). Callee : `register`.
 */
/**
 * @typeParam Emit    — notifications SORTANTES (typage de `notify`).
 * @typeParam Actions — contrat RPC bidirectionnel (typage de `request`/`register`).
 *
 * Note : `Listen` (notifications ENTRANTES) n'est PAS sur cette interface raw —
 * il est consommé par `JsonRpcPeerOptions.onNotification` et par `NodefonySocket.on()`.
 */
export interface IRealtimePeer<
  Emit extends EventsMap = DefaultEventsMap,
  Actions extends ActionsMap = DefaultActionsMap,
> {
  /**
   * Requête sortante → `Promise` du `result` (rejette sur `error`, délai ou
   * abandon). Troisième argument : le délai, ou {@link IRpcRequestOptions}.
   */
  request<K extends ActionNames<Actions>>(
    method: K,
    params?: ActionParams<Actions, K>,
    options?: number | IRpcRequestOptions,
  ): Promise<ActionResult<Actions, K>>;
  /** Notification sortante (pas de réponse). */
  notify<K extends EventNames<Emit>>(
    method: K,
    params?: EventPayload<Emit, K>,
  ): void;
  /** Expose une action appelable par le pair (requête entrante → `result`). */
  register<K extends ActionNames<Actions>>(
    method: K,
    handler: TypedRpcActionHandler<Actions, K>,
  ): void;
  /** Retire une action. */
  unregister(method: ActionNames<Actions>): void;
  /** Ingestion d'une frame ENTRANTE (déjà parsée) → classe + route. */
  receive(frame: unknown): JsonRpcFrameKind;
  /** Actions exposées (découverte). */
  readonly methods: string[];
  /** Annule les requêtes en attente (fermeture transport). */
  dispose(reason?: string): void;
}

/**
 * Une de NOS requêtes sortantes en attente — forme stable, champs posés au
 * constructeur. `resolve`/`reject` sont ceux de la promesse, nus : le nettoyage
 * (minuteur, écouteur du signal, table) vit à UN endroit, `JsonRpcPeer.settle`.
 */
class PendingCall {
  timer: ReturnType<typeof setTimeout> | null = null;
  /** Signal d'abandon de l'appelant, et l'écouteur posé dessus — retiré à chaque issue. */
  signal: AbortSignal | null = null;
  onAbort: (() => void) | null = null;

  constructor(
    readonly method: string,
    readonly resolve: (value: unknown) => void,
    readonly reject: (reason: Error) => void,
    /** Appel tracé : la promesse rend `{ result, meta }` au lieu du `result` nu. */
    readonly withMeta: boolean,
    /** Flux demandé : le jeton envoyé vaut l'`id` de la requête. */
    readonly onProgress: ProgressSink | null,
  ) {}
}

/**
 * Récepteur d'une étape reçue. Paramètre en position de méthode (bivariant) :
 * c'est la frontière où une donnée réseau rencontre `IRpcProgress`, que le
 * contrat décrit sans valider — comme {@link RpcActionHandler} pour les `params`.
 */
type ProgressSink = { handle(value: object): void }["handle"];

/**
 * Enveloppe d'un handler posé par `registerCall` — rangée dans la même table
 * que les handlers simples ; `typeof handler === "function"` les distingue.
 */
class CallHandler {
  constructor(readonly fn: RpcCallHandler) {}
}

/**
 * Une requête ENTRANTE servie par un handler de `registerCall` : son signal
 * (paresseux) et son flux. Close à la réponse, à l'abandon ou au `dispose`.
 */
class RpcCall implements IRpcCall {
  closed = false;
  private controller: AbortController | null = null;
  /** Raison d'un abandon survenu AVANT la première lecture du signal. */
  private reason: Error | null = null;
  private last = 0;

  constructor(
    readonly id: JsonRpcId,
    /** Jeton de flux demandé par l'appelant (`meta.progressToken`), sinon `null`. */
    private readonly token: JsonRpcId | null,
    /** Sortie du pair, qui ne lève jamais (cf `JsonRpcPeer.emitter`). */
    private readonly out: (frame: unknown) => boolean,
  ) {}

  get signal(): AbortSignal {
    if (this.controller === null) {
      this.controller = new AbortController();
      // Lu pour la première fois APRÈS l'abandon (le handler l'interroge au
      // retour d'un `await`) : il naît abandonné, sinon l'annulation serait
      // perdue pour lui.
      if (this.reason !== null) this.controller.abort(this.reason);
    }
    return this.controller.signal;
  }

  progress(update: IRpcProgressUpdate): boolean {
    if (this.closed || this.token === null) return false;
    const progress = update.progress ?? this.last + 1;
    this.last = progress;
    return this.out(
      jsonRpcNotification(JSON_RPC_PROGRESS, {
        token: this.token,
        value: { ...update, progress },
      }),
    );
  }

  /** Ferme l'appel et abandonne son signal — tout de suite s'il a été lu, à sa première lecture sinon. */
  abort(reason: Error): void {
    this.closed = true;
    if (this.controller === null) this.reason = reason;
    else this.controller.abort(reason);
  }
}

/**
 * Le jeton de flux qu'une requête entrante demande (`meta.progressToken`), ou
 * `null`. Donnée réseau : `meta` peut manquer, valoir `null` ou n'importe quoi.
 */
function progressTokenOf(frame: unknown): JsonRpcId | null {
  if (typeof frame !== "object" || frame === null || !("meta" in frame)) {
    return null;
  }
  const meta = frame.meta;
  if (typeof meta !== "object" || meta === null || !("progressToken" in meta)) {
    return null;
  }
  const token = meta.progressToken;
  return isJsonRpcId(token) ? token : null;
}

/** La raison d'un abandon, en `Error` (la promesse ne rejette qu'avec une `Error`). */
function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error ? reason : new Error(String(reason));
}

/**
 * Une réponse JSON-RPC entrante, telle que `classifyJsonRpcFrame` la garantit :
 * `id` chaîne ou nombre, et `result` OU `error` bien formé.
 */
interface JsonRpcInboundResponse {
  id: JsonRpcId;
  result?: unknown;
  error?: IJsonRpcErrorObject;
  /** Métadonnées serveur (dev) — champ frère du `result`, cf {@link RpcMeta}. */
  meta?: RpcMeta;
}

export class JsonRpcPeer<
  Emit extends EventsMap = DefaultEventsMap,
  Listen extends EventsMap = DefaultEventsMap,
  Actions extends ActionsMap = DefaultActionsMap,
> implements IRealtimePeer<Emit, Actions> {
  private nextId = 1;
  // `pending` = NOS requêtes sortantes en attente de réponse (lazy : alloué au 1ᵉʳ
  // `request`). Les actions entrantes ne touchent pas cette map.
  private pending: Map<number, PendingCall> | null = null;
  // Registre des actions exposées (requêtes entrantes). Lazy : la plupart des pairs
  // (ex. client) n'exposent aucune action → pas d'alloc « au cas où ».
  private actions: Map<string, RpcActionHandler | CallHandler> | null = null;
  // Requêtes ENTRANTES servies par un handler de `registerCall`, le temps de
  // leur réponse : ce que `$/cancelRequest` retrouve. Lazy, comme `pending`.
  private inbound: Map<JsonRpcId, RpcCall> | null = null;
  // Sortie qui ne lève jamais, partagée par les appels entrants (une par pair).
  private emitterFn: ((frame: unknown) => boolean) | null = null;
  // Codec COURANT (ADR-0022 §4) : encode les émissions d'une sortie `write`,
  // relit l'entrée par `decode`. Le texte jusqu'à l'accueil.
  private _codec: IFrameCodec;
  // Les deux sorties possibles, résolues une fois : une seule est posée.
  private readonly writeOut: IJsonRpcWireSink["write"] | null;
  private readonly sendOut: IJsonRpcFrameSink["send"] | null;
  private readonly admitOut: (() => boolean) | null;

  constructor(
    private readonly opts: JsonRpcPeerOptions<Emit, Listen, Actions>,
  ) {
    this.writeOut = opts.write ?? null;
    this.sendOut = opts.send ?? null;
    this.admitOut = opts.admit ?? null;
    this._codec = opts.codec ?? JSON_FRAME_CODEC;
  }

  /**
   * Codec de la connexion — celui qui encode les émissions (sortie `write`) et
   * relit l'entrée ({@link decode}). L'orchestrateur le bascule une fois, quand
   * l'accueil a dit le codec retenu, et le remet au texte à chaque reconnexion.
   */
  get codec(): IFrameCodec {
    return this._codec;
  }

  set codec(codec: IFrameCodec) {
    this._codec = codec;
  }

  /**
   * Relit une trame reçue avec le codec courant — la frame rendue se confie
   * ensuite à {@link receive}.
   *
   * @param data - la trame telle que reçue, texte ou octets.
   * @returns la frame décodée.
   * @throws Quand la trame est illisible pour ce codec : l'appelant la compte
   *   comme malformée.
   */
  decode(data: string | Uint8Array): unknown {
    return this._codec.decode(data);
  }

  /** Expose une action (requête entrante `method`+`id` → `result`). Idempotent. */
  register<K extends ActionNames<Actions>>(
    method: K,
    handler: TypedRpcActionHandler<Actions, K>,
  ): void {
    this.registerHandler(method, handler);
  }

  /**
   * Expose une action sous un nom quelconque — la forme non typée de
   * {@link JsonRpcPeer.register}, pour qui tient le peer sans son contrat (la
   * socket client, qui le type par ses propres signatures). Idempotent.
   *
   * @param method - nom de l'action.
   * @param handler - ce qui répond à la requête entrante.
   */
  registerHandler(method: string, handler: RpcActionHandler): void {
    (this.actions ??= new Map<string, RpcActionHandler | CallHandler>()).set(
      method,
      handler,
    );
  }

  /**
   * Expose une action dont le handler reçoit l'APPEL en cours
   * ({@link IRpcCall}) : son `signal`, abandonné quand l'appelant annule
   * (`$/cancelRequest`) ou que le pair est disposé, et `progress()`, qui émet
   * un flux quand l'appelant en a demandé un.
   *
   * Annulé, l'appel reçoit tout de suite la réponse `-32800`
   * (`JsonRpcBaseProtocolError.REQUEST_CANCELLED`) ; ce que le handler rend
   * ensuite est jeté. Une action de {@link register} n'est pas annulable : sa
   * réponse part normalement, et l'appelant, qui a déjà rendu la main, l'ignore.
   * Idempotent, et remplace une action du même nom.
   *
   * @param method - nom de l'action.
   * @param handler - ce qui répond, avec l'appel en cours.
   */
  registerCall<K extends ActionNames<Actions>>(
    method: K,
    handler: TypedRpcCallHandler<Actions, K>,
  ): void {
    const fn: RpcCallHandler = handler;
    (this.actions ??= new Map<string, RpcActionHandler | CallHandler>()).set(
      method,
      new CallHandler(fn),
    );
  }

  /** Retire une action. */
  unregister(method: ActionNames<Actions>): void {
    this.actions?.delete(method);
  }

  /** Liste des actions exposées (pour annoncer au handshake, découverte côté pair). */
  get methods(): string[] {
    return this.actions ? [...this.actions.keys()] : [];
  }

  /**
   * Requête SORTANTE — `Promise` résolue avec le `result` (rejette sur `error`,
   * délai ou abandon).
   *
   * @param options - le délai en millisecondes (30 s par défaut), ou
   *   {@link IRpcRequestOptions} : `signal` pour abandonner (`$/cancelRequest`),
   *   `onProgress` pour recevoir un flux (`$/progress`).
   */
  request<K extends ActionNames<Actions>>(
    method: K,
    params?: ActionParams<Actions, K>,
    options?: number | IRpcRequestOptions,
  ): Promise<ActionResult<Actions, K>> {
    return this.startCall<ActionResult<Actions, K>>(method, params, options);
  }

  /**
   * Requête SORTANTE typée par un contrat que l'APPELANT déclare — pour qui tient
   * ce pair sous son contrat effacé et connaît celui de son interlocuteur.
   *
   * Cas d'usage : l'état d'une connexion vit sur la connexion, et plusieurs
   * contrôleurs peuvent la servir. Le pair y est donc rangé sans contrat, et
   * chaque contrôleur le relit avec le sien.
   *
   * Même garantie que {@link request}, dont c'est la forme où le contrat vient de
   * l'appel au lieu de la classe : la réponse est une donnée réseau, et le
   * contrat la décrit sans la valider.
   *
   * @typeParam A - le contrat RPC de l'interlocuteur.
   * @param method - action exposée par l'interlocuteur.
   * @param params - ses paramètres, typés par le contrat.
   * @param options - délai avant rejet (défaut 30 s), ou {@link IRpcRequestOptions}.
   * @returns le `result` de l'interlocuteur ; rejette sur `error`, timeout ou
   *   pair disposé.
   */
  requestAs<A extends ActionsMap, K extends ActionNames<A>>(
    method: K,
    params?: ActionParams<A, K>,
    options?: number | IRpcRequestOptions,
  ): Promise<ActionResult<A, K>> {
    return this.startCall<ActionResult<A, K>>(method, params, options);
  }

  /**
   * Requête SORTANTE **tracée** typée par un contrat que l'APPELANT déclare —
   * {@link requestAs} qui garde la méta serveur, comme {@link requestTraced}.
   *
   * @typeParam A - le contrat RPC de l'interlocuteur.
   * @param method - action exposée par l'interlocuteur.
   * @param params - ses paramètres, typés par le contrat.
   * @param options - délai avant rejet (défaut 30 s), ou {@link IRpcRequestOptions}.
   * @returns `{ result, meta }` ; rejette sur `error`, timeout ou pair disposé.
   */
  requestTracedAs<A extends ActionsMap, K extends ActionNames<A>>(
    method: K,
    params?: ActionParams<A, K>,
    options?: number | IRpcRequestOptions,
  ): Promise<RpcTracedResult<ActionResult<A, K>>> {
    return this.startCall<RpcTracedResult<ActionResult<A, K>>>(
      method,
      params,
      options,
      true,
    );
  }

  /**
   * Requête SORTANTE **tracée** — rend `{ result, meta }` au lieu du `result` nu.
   *
   * Même appel que {@link request} : la seule différence est que l'appelant
   * garde la méta serveur (en dev, le `requestId` du profil de la frame → sa
   * radiographie). Un serveur qui n'en émet pas laisse simplement `meta`
   * absent.
   */
  requestTraced<K extends ActionNames<Actions>>(
    method: K,
    params?: ActionParams<Actions, K>,
    options?: number | IRpcRequestOptions,
  ): Promise<RpcTracedResult<ActionResult<Actions, K>>> {
    return this.startCall<RpcTracedResult<ActionResult<Actions, K>>>(
      method,
      params,
      options,
      true,
    );
  }

  /**
   * Frame d'une notification sortante — **source unique** de sa forme.
   *
   * Extraite pour que le fan-out d'un canal diffusé puisse sérialiser la frame
   * **une seule fois** pour N abonnés, sans jamais risquer de diverger du format
   * qu'émet {@link notify} : les deux voies passent par ici.
   *
   * @param method - nom de la méthode (côté canal : le nom du canal).
   * @param params - charge applicative ; omise de la frame si `undefined`.
   * @returns la frame JSON-RPC 2.0, prête à sérialiser.
   */
  static buildNotification(
    method: string,
    params?: unknown,
  ): JsonRpcNotification {
    return jsonRpcNotification(method, params);
  }

  /**
   * Notification SORTANTE (pas de réponse attendue).
   *
   * @returns `false` si le transport a signalé qu'il n'a pas émis. Une
   * notification n'attend rien en retour : sans cette valeur, une frame perdue
   * ne laisserait aucune trace chez l'appelant. Les appels qui se rattrapent
   * seuls (ré-abonnement au reconnect) peuvent l'ignorer.
   * @throws Quand le codec ne sait pas encoder la charge et qu'aucun `onError`
   *   n'est posé — avec `onError`, l'erreur y est rapportée et rend `false`.
   */
  notify<K extends EventNames<Emit>>(
    method: K,
    params?: EventPayload<Emit, K>,
  ): boolean {
    const frame = JsonRpcPeer.buildNotification(method, params);
    const onError = this.opts.onError;
    if (onError === undefined) return this.emit(frame);
    try {
      return this.emit(frame);
    } catch (err) {
      onError(`notify ${method}`, err);
      return false;
    }
  }

  /**
   * Ingestion d'une frame ENTRANTE déjà parsée → classe (request/notification/
   * response) et route. Renvoie la nature (utile log/tests). Ne lève jamais.
   * (Le pendant sortant = `request`/`notify` ; le `send` brut est injecté.)
   */
  receive(msg: unknown): JsonRpcFrameKind {
    // Le prédicat est PARTAGÉ avec la porte MCP (`jsonrpc/`) ; la réaction est
    // propre au pair : une frame invalide est jetée et auditée, jamais répondue.
    const kind = classifyJsonRpcFrame(msg);
    if (kind === "invalid") {
      this.settleUnreadableResponse(msg);
      this.opts.onFrameAudit?.("invalid", msg, this);
      return "invalid";
    }
    // Frame SANS `method` = réponse à une de NOS requêtes sortantes.
    if (kind === "response") {
      this.handleResponse(msg as JsonRpcInboundResponse);
      return "response";
    }

    // Requête ou notification entrante (le pair nous appelle) : `method` est
    // une chaîne, et l'`id` d'une requête une chaîne ou un nombre.
    const frame = msg as IJsonRpcRequest | IJsonRpcNotification;
    const isRequest = kind === "request";

    // Méthode du PROTOCOLE (`$/…`, LSP) : traitée ici, avant la garde et avant
    // l'application — un écouteur joker ne la voit jamais. Elle n'agit que sur
    // les appels de CETTE connexion, rien à arbitrer pour `beforeDispatch`.
    // Chemin chaud : une comparaison de caractère par frame ordinaire.
    const method = frame.method;
    if (method.charCodeAt(0) === 36 && method.charCodeAt(1) === 47) {
      if ("id" in frame) {
        // Une REQUÊTE `$/` se refuse en `-32601` (LSP, « $ Notifications »).
        this.opts.onFrameAudit?.("method_not_found", msg, this);
        this.emit(
          jsonRpcFailure(
            frame.id,
            JsonRpcError.METHOD_NOT_FOUND,
            `method not found: ${method}`,
          ),
        );
        return "request";
      }
      this.handleProtocolNotification(method, frame.params);
      return "notification";
    }

    // Seam sécu 1/5 : gate AVANT le dispatch (request ET notification). Hot-path
    // sync — `undefined` → bypass 0-coût. Cf JsonRpcPeerOptions.beforeDispatch.
    if (this.opts.beforeDispatch && !this.opts.beforeDispatch(frame, this)) {
      this.opts.onFrameAudit?.("denied", msg, this);
      if (isRequest) {
        // Requête refusée : code de la plage `Server error` (JSON-RPC 2.0
        // §5.1), message GÉNÉRIQUE (Zero Trust : ne révèle pas pourquoi).
        this.emit(
          jsonRpcFailure(
            (frame as IJsonRpcRequest).id,
            REALTIME_UNAUTHORIZED,
            "unauthorized",
          ),
        );
        return "request";
      }
      // Notification refusée : drop silencieux (pas de canal de réponse).
      return "notification";
    }

    if (isRequest) {
      this.handleRequest(
        (frame as IJsonRpcRequest).id,
        frame.method,
        frame.params,
        msg,
      );
      return "request";
    }
    // Le handler typé `RpcNotificationHandler<Listen>` ne peut pas être appelé
    // avec un `unknown` dynamique — TS n'a pas la corrélation `method ↔ params`
    // au runtime. Cast vers la signature permissive (équivalente à l'API d'avant
    // les types partagés) : c'est ce que voient les consommateurs non paramétrés.
    (this.opts.onNotification as RpcNotificationHandler | undefined)?.(
      frame.method,
      frame.params,
    );
    return "notification";
  }

  /**
   * Fermeture du transport : rejette nos requêtes en attente et abandonne les
   * appels ENTRANTS en cours (leur `signal`) — c'est ce qui arrête un
   * producteur quand l'interlocuteur disparaît. Rien n'est émis.
   */
  dispose(reason = "peer disposed"): void {
    const inbound = this.inbound;
    if (inbound !== null && inbound.size > 0) {
      const error = new Error(reason);
      for (const call of inbound.values()) call.abort(error);
      inbound.clear();
    }
    const pending = this.pending;
    if (pending === null) return;
    for (const call of pending.values()) {
      this.release(call);
      call.reject(new Error(reason));
    }
    pending.clear();
  }

  // ── interne ───────────────────────────────────────────────────────────────

  /**
   * Émet une frame par la sortie posée — chemin chaud, un appel par frame.
   * Sortie `write` : admission, puis encodage par le codec COURANT, puis écriture.
   *
   * @returns `false` si la frame n'est pas partie.
   * @throws Quand le codec ne sait pas l'encoder (structure circulaire, `bigint`).
   */
  private emit(frame: unknown): boolean {
    const write = this.writeOut;
    if (write !== null) {
      if (this.admitOut !== null && !this.admitOut()) return false;
      return write(this._codec.encode(frame), frame) !== false;
    }
    return this.sendOut !== null && this.sendOut(frame) !== false;
  }

  /**
   * Répond à une requête entrante sans JAMAIS casser la chaîne du pair : une
   * réponse que le codec ne sait pas encoder devient un `-32603` générique (le
   * pair n'apprend rien de la structure — Zero Trust), le détail part à
   * `onError`. Sans ce filet, l'appelant distant attendrait son délai pour une
   * réponse jamais émise.
   */
  private reply(
    id: JsonRpcId,
    method: string,
    rawFrame: unknown,
    frame: unknown,
  ): void {
    try {
      this.emit(frame);
    } catch (err) {
      this.opts.onError?.(`rpc ${method} : réponse non encodable`, err);
      this.opts.onFrameAudit?.("internal_error", rawFrame, this);
      // Libellé établi : il dit la cause (charge non encodable) sans rien de sa
      // structure, et le client l’a déjà rencontré — il ne change pas.
      this.emit(
        jsonRpcFailure(
          id,
          JsonRpcError.INTERNAL_ERROR,
          "internal error: non-serializable payload",
        ),
      );
    }
  }

  private startCall<T>(
    method: string,
    params: unknown,
    options: number | IRpcRequestOptions | undefined,
    withMeta = false,
  ): Promise<T> {
    let timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS;
    let signal: AbortSignal | null = null;
    let onProgress: ((value: IRpcProgress) => void) | null = null;
    if (typeof options === "number") {
      timeoutMs = options;
    } else if (options !== undefined) {
      timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
      signal = options.signal ?? null;
      onProgress = options.onProgress ?? null;
    }
    // Déjà abandonnée : la requête ne part jamais, rien n'est émis.
    if (signal?.aborted) return Promise.reject(abortReason(signal));
    const id = this.nextId++;
    const pending = (this.pending ??= new Map<number, PendingCall>());
    return new Promise<T>((resolve, reject) => {
      const call = new PendingCall(
        method,
        (value: unknown) => resolve(value as T),
        reject,
        withMeta,
        onProgress,
      );
      pending.set(id, call);
      // Un transport qui répond `false` n'a PAS émis : inutile de faire patienter
      // l'appelant jusqu'au timeout (30 s par défaut) pour une frame perdue.
      // Des paramètres que le codec ne sait pas encoder échouent CHEZ
      // l'appelant, maintenant — jamais une réponse forgée vers le pair.
      let sent: boolean;
      try {
        sent = this.emit(
          onProgress === null
            ? jsonRpcRequest(id, method, params)
            : jsonRpcRequest(id, method, params, { progressToken: id }),
        );
      } catch (err) {
        pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      if (!sent) {
        pending.delete(id);
        reject(new Error(`RPC non émis (transport indisponible) : ${method}`));
        return;
      }
      // Un transport en mémoire peut avoir répondu PENDANT l'émission : l'appel
      // est alors déjà réglé, et un minuteur armé après lui ne ferait que fuir.
      if (pending.get(id) !== call) return;
      call.timer = setTimeout(() => this.expire(id), timeoutMs);
      if (signal !== null) {
        const onAbort = (): void => this.abandon(id, signal);
        call.signal = signal;
        call.onAbort = onAbort;
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }

  /**
   * Règle un appel sortant : le retire de la table, coupe son minuteur, retire
   * l'écouteur du signal. Seul endroit du nettoyage — chaque issue y passe.
   */
  private settle(id: number, call: PendingCall): void {
    this.pending?.delete(id);
    this.release(call);
  }

  /** Coupe le minuteur et retire l'écouteur du signal d'un appel sortant. */
  private release(call: PendingCall): void {
    if (call.timer !== null) clearTimeout(call.timer);
    if (call.onAbort !== null) {
      call.signal?.removeEventListener("abort", call.onAbort);
    }
  }

  /** Délai expiré : rejet, PUIS annulation chez le pair — personne n'attend plus. */
  private expire(id: number): void {
    const call = this.pending?.get(id);
    if (call === undefined) return;
    this.settle(id, call);
    call.reject(new RpcTimeoutError(call.method));
    this.cancelOutbound(id);
  }

  /** Abandon par le signal de l'appelant : rejet avec sa raison, PUIS annulation. */
  private abandon(id: number, signal: AbortSignal): void {
    const call = this.pending?.get(id);
    if (call === undefined) return;
    this.settle(id, call);
    call.reject(abortReason(signal));
    this.cancelOutbound(id);
  }

  /**
   * Émet `$/cancelRequest` pour une de nos requêtes. Chemin froid, appelé hors
   * de toute pile de l'appelant (minuteur, écouteur) : rien n'y lève.
   */
  private cancelOutbound(id: number): void {
    this.emitter()(jsonRpcNotification(JSON_RPC_CANCEL_REQUEST, { id }));
  }

  /**
   * La sortie du pair qui ne lève jamais : une frame non encodable ou un
   * transport qui lève rendent `false`, le détail part à `onError`. Une par
   * pair, créée au premier besoin.
   */
  private emitter(): (frame: unknown) => boolean {
    return (this.emitterFn ??= (frame: unknown): boolean => {
      try {
        return this.emit(frame);
      } catch (err) {
        this.opts.onError?.("emit", err);
        return false;
      }
    });
  }

  /**
   * Notification du protocole (`$/…`) : l'annulation d'une requête entrante,
   * une étape d'une de nos requêtes. Toute autre méthode `$/` est ignorée
   * (LSP : « free to ignore »). Ne lève jamais.
   */
  private handleProtocolNotification(method: string, params: unknown): void {
    if (typeof params !== "object" || params === null) return;
    if (method === JSON_RPC_CANCEL_REQUEST) {
      if (this.inbound === null || !("id" in params)) return;
      const id = params.id;
      if (!isJsonRpcId(id)) return;
      const call = this.inbound.get(id);
      // Inconnu, ou réponse déjà partie : rien à faire.
      if (call === undefined) return;
      this.inbound.delete(id);
      call.abort(new Error("request cancelled"));
      // La requête reçoit QUAND MÊME sa réponse (LSP, « Cancellation Support »).
      this.emitter()(
        jsonRpcFailure(
          id,
          JsonRpcBaseProtocolError.REQUEST_CANCELLED,
          "Request cancelled",
        ),
      );
      return;
    }
    if (method === JSON_RPC_PROGRESS) {
      if (this.pending === null || !("token" in params)) return;
      // Nos jetons valent l'`id` de la requête : la table des appels suffit.
      const token = params.token;
      if (typeof token !== "number") return;
      const onProgress = this.pending.get(token)?.onProgress;
      if (onProgress == null || !("value" in params)) return;
      const value = params.value;
      if (typeof value !== "object" || value === null) return;
      try {
        onProgress(value);
      } catch (err) {
        this.opts.onError?.(`progress ${token}`, err);
      }
    }
  }

  private handleRequest(
    id: JsonRpcId,
    method: string,
    params: unknown,
    rawFrame: unknown,
  ): void {
    const handler = this.actions?.get(method);
    if (!handler) {
      this.opts.onFrameAudit?.("method_not_found", rawFrame, this);
      this.emit(
        jsonRpcFailure(
          id,
          JsonRpcError.METHOD_NOT_FOUND,
          `method not found: ${method}`,
        ),
      );
      return;
    }
    // Handler de `registerCall` : l'appel est suivi jusqu'à sa réponse, pour
    // que `$/cancelRequest` le retrouve. Handler simple : rien n'est alloué.
    let call: RpcCall | null = null;
    let invoke: () => unknown;
    if (typeof handler === "function") {
      invoke = () => handler(params);
    } else {
      const tracked = new RpcCall(
        id,
        progressTokenOf(rawFrame),
        this.emitter(),
      );
      (this.inbound ??= new Map<JsonRpcId, RpcCall>()).set(id, tracked);
      call = tracked;
      invoke = () => handler.fn(params, tracked);
    }
    Promise.resolve()
      .then(invoke)
      .then(
        (result) => {
          if (call !== null && !this.closeInbound(id, call)) return;
          // Le handler a JOINT une méta serveur (dev : l'id du profil de la
          // frame) → elle voyage en champ FRÈRE, le `result` reste la valeur nue.
          if (result instanceof RpcEnvelope) {
            // `instanceof` sur une classe générique rend `RpcEnvelope<any>`.
            const success: IJsonRpcSuccess & { meta?: RpcMeta } =
              jsonRpcSuccess(id, result.result as unknown);
            success.meta = result.meta;
            this.reply(id, method, rawFrame, success);
            return;
          }
          this.reply(id, method, rawFrame, jsonRpcSuccess(id, result));
        },
        (err: unknown) => {
          if (call !== null && !this.closeInbound(id, call)) return;
          // Erreur APPLICATIVE assumée (RpcError) → renvoyée fidèlement au pair
          // (pas un internal_error : ni onError ni audit — le handler a choisi
          // d'exposer ce refus, il peut l'auditer lui-même s'il est notable).
          if (err instanceof RpcError) {
            // `data` vient de l'application : il peut ne pas s'encoder.
            this.reply(
              id,
              method,
              rawFrame,
              jsonRpcFailure(id, err.code, err.message, err.data),
            );
            return;
          }
          this.opts.onError?.(`rpc ${method}`, err);
          this.opts.onFrameAudit?.("internal_error", rawFrame, this);
          this.emit(
            jsonRpcFailure(id, JsonRpcError.INTERNAL_ERROR, "internal error"),
          );
        },
      );
  }

  /**
   * Clôt un appel entrant à la fin de son handler.
   *
   * @returns `false` quand il était déjà clos (annulé, pair disposé) : la
   *   réponse est partie ou ne partira pas, ce que rend le handler est jeté.
   */
  private closeInbound(id: JsonRpcId, call: RpcCall): boolean {
    if (call.closed) return false;
    call.closed = true;
    if (this.inbound?.get(id) === call) this.inbound.delete(id);
    return true;
  }

  private handleResponse(msg: JsonRpcInboundResponse): void {
    // Nos requêtes sortantes ont des `id` numériques → on ne matche que ceux-là ;
    // une réponse à `id` string (jamais émise par nous) est ignorée.
    if (typeof msg.id !== "number" || !this.pending) return;
    const pending = this.pending.get(msg.id);
    if (!pending) return; // réponse inattendue (déjà résolue/timeout) → ignore
    this.settle(msg.id, pending);
    if (msg.error) {
      // `code`/`data` préservés (ex. `data.status` HTTP d'un `api.request`) —
      // l'appelant discrimine un 404 d'un refus voter sans parser le message.
      pending.reject(
        new RpcError(msg.error.message, msg.error.code, msg.error.data),
      );
      return;
    }
    // Appel tracé → l'appelant reçoit la méta serveur avec le résultat ; appel
    // ordinaire → il ne voit que le `result` (contrat historique inchangé).
    pending.resolve(
      pending.withMeta ? { result: msg.result, meta: msg.meta } : msg.result,
    );
  }

  /**
   * Frame INVALIDE qui répond pourtant à une de nos requêtes en attente
   * (`jsonrpc: "2.0"`, même `id` numérique, pas de `method`) : l'appel échoue
   * MAINTENANT au lieu d'attendre son délai pour une réponse qui ne viendra plus.
   *
   * Chemin froid — n'est atteint que par une frame déjà jugée invalide. Une
   * erreur bien formée accompagnée d'un `result` (JSON-RPC 2.0 §5 l'interdit)
   * est rendue fidèlement : l'erreur gagne. Tout autre défaut rejette avec
   * `-32603`.
   */
  private settleUnreadableResponse(msg: unknown): void {
    if (!this.pending || msg === null || typeof msg !== "object") return;
    const f = msg as {
      jsonrpc?: unknown;
      id?: unknown;
      method?: unknown;
      error?: unknown;
    };
    // Une frame d'un AUTRE protocole n'est pas une réponse, même si elle porte
    // un de nos `id` : seule une frame JSON-RPC 2.0 sans `method` en est une.
    if (
      f.jsonrpc !== JSON_RPC_VERSION ||
      f.method !== undefined ||
      typeof f.id !== "number"
    ) {
      return;
    }
    const pending = this.pending.get(f.id);
    if (!pending) return;
    this.settle(f.id, pending);
    pending.reject(
      isJsonRpcErrorObject(f.error)
        ? new RpcError(f.error.message, f.error.code, f.error.data)
        : new RpcError(
            "réponse JSON-RPC invalide",
            JsonRpcError.INTERNAL_ERROR,
          ),
    );
  }
}

export default JsonRpcPeer;
