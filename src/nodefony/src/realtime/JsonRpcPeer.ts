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
  JSON_RPC_VERSION,
  JsonRpcError,
  JsonRpcServerError,
  classifyJsonRpcFrame,
  isJsonRpcErrorObject,
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

/** Handler d'une action (requête→réponse). Sync ou async ; throw → `-32603`. */
export type RpcActionHandler = (params: unknown) => unknown;

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

export interface JsonRpcPeerOptions<
  Emit extends EventsMap = DefaultEventsMap,
  Listen extends EventsMap = DefaultEventsMap,
  Actions extends ActionsMap = DefaultActionsMap,
> {
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
  /** Notifications entrantes (`method` sans `id`) : pub/sub côté client, subscribe/unsubscribe côté serveur. */
  onNotification?: RpcNotificationHandler<Listen> | undefined;
  /** Erreur interne d'un handler — détail JAMAIS renvoyé au pair (loggé ici). */
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
   */
  beforeDispatch?:
    | ((frame: unknown, peer: IRealtimePeer<Emit, Actions>) => boolean)
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
 * Surface BIDIRECTIONNELLE d'un endpoint temps réel — **contrat ISOMORPHE**,
 * identique back et front. `RealtimeClient` (navigateur) ET la connexion serveur
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
 * il est consommé par `JsonRpcPeerOptions.onNotification` et par `RealtimeClient.on()`.
 */
export interface IRealtimePeer<
  Emit extends EventsMap = DefaultEventsMap,
  Actions extends ActionsMap = DefaultActionsMap,
> {
  /** Requête sortante → `Promise` du `result` (rejette sur `error`/timeout). */
  request<K extends ActionNames<Actions>>(
    method: K,
    params?: ActionParams<Actions, K>,
    timeoutMs?: number,
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

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
  /** Appel tracé : la promesse rend `{ result, meta }` au lieu du `result` nu. */
  withMeta?: boolean | undefined;
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
  private actions: Map<string, RpcActionHandler> | null = null;

  constructor(
    private readonly opts: JsonRpcPeerOptions<Emit, Listen, Actions>,
  ) {}

  /** Expose une action (requête entrante `method`+`id` → `result`). Idempotent. */
  register<K extends ActionNames<Actions>>(
    method: K,
    handler: TypedRpcActionHandler<Actions, K>,
  ): void {
    (this.actions ??= new Map<string, RpcActionHandler>()).set(
      method,
      handler as RpcActionHandler,
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

  /** Requête SORTANTE — `Promise` résolue avec le `result` (rejette sur `error`/timeout). */
  request<K extends ActionNames<Actions>>(
    method: K,
    params?: ActionParams<Actions, K>,
    timeoutMs = 30000,
  ): Promise<ActionResult<Actions, K>> {
    return this.startCall<ActionResult<Actions, K>>(method, params, timeoutMs);
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
    timeoutMs = 30000,
  ): Promise<RpcTracedResult<ActionResult<Actions, K>>> {
    return this.startCall<RpcTracedResult<ActionResult<Actions, K>>>(
      method,
      params,
      timeoutMs,
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
   */
  notify<K extends EventNames<Emit>>(
    method: K,
    params?: EventPayload<Emit, K>,
  ): boolean {
    return (
      this.opts.send(JsonRpcPeer.buildNotification(method, params)) !== false
    );
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

    // Seam sécu 1/5 : gate AVANT le dispatch (request ET notification). Hot-path
    // sync — `undefined` → bypass 0-coût. Cf JsonRpcPeerOptions.beforeDispatch.
    if (this.opts.beforeDispatch && !this.opts.beforeDispatch(msg, this)) {
      this.opts.onFrameAudit?.("denied", msg, this);
      if (isRequest) {
        // Requête refusée : code de la plage `Server error` (JSON-RPC 2.0
        // §5.1), message GÉNÉRIQUE (Zero Trust : ne révèle pas pourquoi).
        this.opts.send(
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

  /** Annule tous les pending (fermeture du transport). */
  dispose(reason = "peer disposed"): void {
    if (!this.pending) return;
    for (const p of this.pending.values()) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    this.pending.clear();
  }

  // ── interne ───────────────────────────────────────────────────────────────

  private startCall<T>(
    method: string,
    params: unknown,
    timeoutMs: number,
    withMeta?: boolean,
  ): Promise<T> {
    const id = this.nextId++;
    const pending = (this.pending ??= new Map<number, PendingCall>());
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }, timeoutMs);
      pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v as T);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
        timer,
        withMeta,
      });
      // Un transport qui répond `false` n'a PAS émis : inutile de faire patienter
      // l'appelant jusqu'au timeout (30 s par défaut) pour une frame perdue.
      if (this.opts.send(jsonRpcRequest(id, method, params)) === false) {
        clearTimeout(timer);
        pending.delete(id);
        reject(new Error(`RPC non émis (transport indisponible) : ${method}`));
      }
    });
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
      this.opts.send(
        jsonRpcFailure(
          id,
          JsonRpcError.METHOD_NOT_FOUND,
          `method not found: ${method}`,
        ),
      );
      return;
    }
    Promise.resolve()
      .then(() => handler(params))
      .then(
        (result) => {
          // Le handler a JOINT une méta serveur (dev : l'id du profil de la
          // frame) → elle voyage en champ FRÈRE, le `result` reste la valeur nue.
          if (result instanceof RpcEnvelope) {
            // `instanceof` sur une classe générique rend `RpcEnvelope<any>`.
            const reply: IJsonRpcSuccess & { meta?: RpcMeta } = jsonRpcSuccess(
              id,
              result.result as unknown,
            );
            reply.meta = result.meta;
            this.opts.send(reply);
            return;
          }
          this.opts.send(jsonRpcSuccess(id, result));
        },
        (err: unknown) => {
          // Erreur APPLICATIVE assumée (RpcError) → renvoyée fidèlement au pair
          // (pas un internal_error : ni onError ni audit — le handler a choisi
          // d'exposer ce refus, il peut l'auditer lui-même s'il est notable).
          if (err instanceof RpcError) {
            this.opts.send(jsonRpcFailure(id, err.code, err.message, err.data));
            return;
          }
          this.opts.onError?.(`rpc ${method}`, err);
          this.opts.onFrameAudit?.("internal_error", rawFrame, this);
          this.opts.send(
            jsonRpcFailure(id, JsonRpcError.INTERNAL_ERROR, "internal error"),
          );
        },
      );
  }

  private handleResponse(msg: JsonRpcInboundResponse): void {
    // Nos requêtes sortantes ont des `id` numériques → on ne matche que ceux-là ;
    // une réponse à `id` string (jamais émise par nous) est ignorée.
    if (typeof msg.id !== "number" || !this.pending) return;
    const pending = this.pending.get(msg.id);
    if (!pending) return; // réponse inattendue (déjà résolue/timeout) → ignore
    this.pending.delete(msg.id);
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
    this.pending.delete(f.id);
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
