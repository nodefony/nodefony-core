/**
 * RealtimeClient — Core isomorphe Nodefony côté navigateur (P14.11).
 *
 * Protocole : JSON-RPC 2.0 maison sur WebSocket (+ HTTP long-polling fallback TODO P13).
 * State machine : disconnected → connecting → connected → reconnecting → error.
 *
 * Features :
 *  - reconnect exponentiel avec back-off
 *  - pub/sub (on/off/emit) — notifications JSON-RPC sans id
 *  - request/response — RPC bidirectionnel typé
 *  - streaming — chunks `{ id, stream: { chunk, done } }` pour LLM token-by-token
 *
 * Le backend WS de référence (RealtimeService) sera implémenté en P13.4.
 * En attendant, ce client peut parler à n'importe quel serveur JSON-RPC 2.0.
 */
import {
  closeCodeToNotice,
  deniedToNotice,
  isReconnectableCloseCode,
  type NodefonyNotice,
  type IRealtimeDenied,
} from "./notice";
import {
  JsonRpcPeer,
  type IRealtimePeer,
  type JsonRpcFrameKind,
  type RpcTracedResult,
} from "../../realtime/JsonRpcPeer";
// Les six événements LOCAUX ont une table — personne ne les écrit en clair,
// ici pas plus qu'ailleurs (cf `./localEvents.ts`).
import { LOCAL_EVENTS } from "./localEvents";

/**
 * Enveloppe d'un appel {@link RealtimeClient.call} : la valeur rendue par la
 * route, et l'identifiant du profil serveur de cette frame (dev — `null` en
 * production, où le serveur n'émet aucune méta).
 */
export interface IApiCallResult<T = unknown> {
  result: T;
  requestId: string | null;
}
import {
  TransportState,
  type IRealtimeTransport,
  type RealtimeTransportFactory,
} from "../../realtime/IRealtimeTransport";
import type {
  IRealtimeSocket,
  IRealtimeChannel,
  IChannelStats,
  RealtimeHandler,
} from "../../realtime/IRealtimeSocket";
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
  IRealtimeWelcome,
  RealtimeIdentity,
  TypedRpcActionHandler,
} from "../../realtime/RealtimeEventMap";
import { BrowserWsTransport } from "./BrowserWsTransport";
import {
  bindAdaptiveChannel,
  type BindAdaptiveOptions,
  type AdaptiveChannelBinding,
} from "./AdaptiveRate";
export {
  closeCodeToNotice,
  deniedToNotice,
  isReconnectableCloseCode,
} from "./notice";
export type { NodefonyNotice, NoticeLevel, IRealtimeDenied } from "./notice";
// Ré-export DX : `catch (e) { if (e instanceof RpcError) e.data.status … }`
// sans importer le subpath protocole.
export { RpcError } from "../../realtime/JsonRpcPeer";
// Ré-export DX : le consommateur (Studio) type `socket.identity` depuis le même
// subpath que le client, sans connaître `RealtimeEventMap`.
export type {
  RealtimeIdentity,
  IRealtimeWelcome,
} from "../../realtime/RealtimeEventMap";
import { PLATFORM_METHODS } from "../../realtime/platformChannels";

export type RealtimeState =
  "disconnected" | "connecting" | "connected" | "reconnecting" | "error";

export interface RealtimeOptions {
  url?: string;
  token?: string | null;
  /** Reconnexion auto. Défaut: true. */
  autoReconnect?: boolean;
  /** Délai initial entre tentatives (ms). Défaut: 1000. */
  reconnectDelay?: number;
  /** Délai max entre tentatives (ms). Défaut: 30000. */
  reconnectDelayMax?: number;
  /** Heartbeat ping interval (ms). Défaut: 30000. */
  heartbeatInterval?: number;
}

type EventHandler = (...args: unknown[]) => void;

/**
 * Stats d'un canal — alias historique de {@link IChannelStats} (le contrat isomorphe
 * `IRealtimeSocket`). Conservé pour les consommateurs qui importent `MessageStats`.
 */
export type MessageStats = IChannelStats;

/** Points conservés dans la série de débit (~32 s à 1 échantillon/s). */
const STATS_SERIES_POINTS = 32;

/** Une frame du protocole temps réel (JSON-RPC 2.0) — pour le log/inspecteur. */
export interface RealtimeFrame {
  /** Timestamp (ms epoch). */
  ts: number;
  /** Sens : `out` = client→serveur, `in` = serveur→client. */
  dir: "in" | "out";
  /** Méthode (notification/requête) ou `response`/`error`/`stream`. */
  kind: string;
  /** id JSON-RPC (requêtes/réponses), si présent. */
  id?: number;
  /** Canal pub/sub (`params.channel`), si présent. */
  channel?: string;
  /** Payload affichable — champs sensibles **redactés** (token/secret…). */
  payload: unknown;
}

/** Taille max du ring du log protocole (inspecteur realtime). */
const FRAME_LOG_MAX = 300;

/** Clés sensibles masquées dans le log protocole (sécurité — jamais de secret en clair). */
const FRAME_REDACT_RE =
  /(token|password|secret|api[_-]?key|apikey|authorization|bearer)/i;

/** Copie d'un payload JSON-RPC avec masquage des champs sensibles (bornée en profondeur). */
function redactFrame(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redactFrame(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = FRAME_REDACT_RE.test(k) ? "[redacted]" : redactFrame(v, depth + 1);
  }
  return out;
}

/**
 * Réponse de la méthode RPC standard `nodefony:kernel:ping` — CONVENTION Nodefony : tout
 * endpoint realtime (Studio aujourd'hui, `RealtimeService` en P13.4) y répond.
 * Sert de liveness + base de mesure du round-trip (cf {@link RealtimeClient.ping}).
 */
export interface KernelPingResult {
  pong: true;
  ts: number;
  /** uptime process serveur (s). */
  uptime: number;
  pid: number;
  version?: string;
}

/**
 * Tentative de reconnexion programmée par le back-off — charge utile de
 * {@link RealtimeClient.onReconnect}.
 */
export interface RealtimeReconnectInfo {
  /** Numéro de la tentative depuis la dernière connexion réussie (1 = la première). */
  attempt: number;
  /** Délai retenu avant cette tentative (ms), plafonné par `reconnectDelayMax`. */
  delay: number;
  /** Échéance absolue de la tentative (ms epoch) — pour un compte à rebours. */
  nextRetryAt: number;
}

export class RealtimeClient<
  Emit extends EventsMap = DefaultEventsMap,
  Listen extends EventsMap = DefaultEventsMap,
  Actions extends ActionsMap = DefaultActionsMap,
>
  implements
    IRealtimeSocket<Emit, Listen, Actions>,
    IRealtimePeer<Emit, Actions>
{
  // Transport courant ({@link IRealtimeTransport}) — recréé à chaque (re)connexion.
  // L'orchestration (reconnect/heartbeat/state) vit ici ; le transport reste « bête ».
  private transport: IRealtimeTransport | null = null;
  private readonly transportFactory: RealtimeTransportFactory;
  private _state: RealtimeState = "disconnected";
  // Moteur protocole JSON-RPC 2.0 ISOMORPHE — le MÊME que la connexion serveur
  // compose (cf RealtimeController). Le client DÉLÈGUE tout le plan de contrôle
  // (request/notify/stream/receive/register/erreurs/corrélation d'id) ; il ne
  // garde que le « client » (transport, reconnect, heartbeat, stats, frameLog,
  // ref-count subscribe, identité). `pending`/`actions` du peer sont LAZY (0 alloc
  // tant qu'aucune requête sortante / action exposée). `send` est déréférencé à
  // chaque frame (pas `.bind`) → un test qui remplace `client.send` reste intercepté.
  private readonly peer: JsonRpcPeer<Emit, Listen, Actions> = new JsonRpcPeer<
    Emit,
    Listen,
    Actions
  >({
    send: (frame) => this.send(frame),
    onNotification: (method, params) =>
      this.dispatchNotification(method as string, params),
  });
  private readonly handlers = new Map<string, Set<EventHandler>>();
  // Abonnements pub/sub ref-comptés (canal → nb de consommateurs). Le subscribe/
  // unsubscribe RÉSEAU n'est émis qu'aux transitions 0↔1 → N consommateurs (hooks
  // React `nodefony/react` + store MobX Studio) partagent UN seul abonnement
  // serveur, sans se couper l'un l'autre. Ré-abonné automatiquement au reconnect.
  private readonly _subscriptions = new Map<string, number>();
  private reconnectAttempt = 0;
  private _nextRetryAt: number | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private intentionalClose = false;
  // Stats génériques par méthode/canal — calculées ici (au point d'arrivée des
  // frames), donc fiables et réutilisables par toute app.
  private readonly _stats = new Map<string, MessageStats>();
  private _framesReceived = 0;
  // Frames qui n'ont pas pu partir (transport fermé) — pendant sortant de
  // `_framesReceived`, lu par la debug bar et les bancs.
  private _framesUnsent = 0;
  // Vaut `true` tant qu'on ne s'est jamais connecté : une frame émise avant la
  // première connexion est un séquencement d'application, pas une coupure — la
  // signaler comme telle serait un faux avertissement. Remis à `false` à chaque
  // passage en `connected` → une notice par ÉPISODE de coupure, jamais par frame.
  private _unsentNotified = true;
  private _lastFrameAt: number | null = null;
  private _lastFrameMethod: string | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private readonly _prevSampled = new Map<string, number>();
  // Log protocole (inspecteur realtime) — ring ALWAYS-ON mais bon marché : on ne
  // pousse qu'une RÉF brute (`{ts,dir,msg}`) ; la construction + la redaction
  // sont DIFFÉRÉES à la lecture (`frameLog`) ou au live (`__frame__`). Toujours
  // alimenté → la console « retrace l'instant » dès l'ouverture (pas de vide).
  private _rawFrames: { ts: number; dir: "in" | "out"; msg: unknown }[] | null =
    null;
  // Identité résolue + capabilities annoncées par le serveur au `realtime:welcome`
  // (cold path, 1×/connexion). `null` tant que pas reçu → lazy, 0 alloc « au cas
  // où ». Réfs brutes vers les objets du welcome (pas de copie).
  private _identity: RealtimeIdentity | null = null;
  private _serverChannels: string[] | null = null;
  private _serverMethods: string[] | null = null;

  constructor(
    private readonly opts: RealtimeOptions = {},
    // Fabrique de transport injectable (tests = transport mock ; défaut = WebSocket
    // navigateur). Garde RealtimeClient testable sans vrai socket.
    transportFactory?: RealtimeTransportFactory,
  ) {
    this.transportFactory =
      transportFactory ?? ((url: string) => new BrowserWsTransport(url));
    this.startStatsSampler();
  }

  /**
   * Instance de connexion **partagée par URL** (résolue en absolu) sur
   * `globalThis`. Plusieurs consommateurs d'une même page (ex. Studio + barre de
   * debug) obtiennent la MÊME instance → **une seule socket** WebSocket. Les
   * options ne s'appliquent qu'à la 1ʳᵉ création (les suivantes réutilisent).
   *
   * @param opts - options (au moins `url`), appliquées seulement à la création.
   * @returns l'instance partagée pour cette URL.
   */
  static shared(opts: RealtimeOptions = {}): RealtimeClient {
    const key = RealtimeClient.resolveUrl(opts.url);
    const g = globalThis as { __nfRealtime__?: Map<string, RealtimeClient> };
    const map = (g.__nfRealtime__ ??= new Map<string, RealtimeClient>());
    let client = map.get(key);
    if (!client) {
      client = new RealtimeClient({ ...opts, url: key });
      map.set(key, client);
    }
    return client;
  }

  /**
   * Message d'une adresse manquante — LA seule formulation, employée par les
   * deux chemins qui peuvent la constater.
   *
   * Il n'y a **pas** de valeur par défaut, et c'est délibéré : la route dépend
   * de l'application, pas du framework. Deviner `/nodefony/api/realtime` — ce
   * que faisait ce client — donnait une socket qui ne se connecte jamais et se
   * contente de retenter, sans un mot. Un échec franc coûte trente secondes ;
   * une socket silencieusement morte coûte une soirée.
   */
  private static missingUrl(): Error {
    return new Error(
      "[nodefony] adresse du serveur temps réel manquante.\n" +
        '  Donne-la explicitement : RealtimeClient.shared({ url: "/api/live/realtime" })\n' +
        '  ou, en React : <NodefonyProvider url="/api/live/realtime">\n' +
        "  Il n'y a pas de valeur par défaut : la route dépend de ton application " +
        "(une application générée monte /api/live/realtime, la console d'administration " +
        "/nodefony/studio/api/realtime).",
    );
  }

  /** Résout une URL (relative ou absolue) en chaîne absolue stable = clé du singleton. */
  private static resolveUrl(url?: string): string {
    if (!url) throw RealtimeClient.missingUrl();
    if (typeof window === "undefined") return url;
    try {
      const u = new URL(url, window.location.href);
      // Normaliser http(s)→ws(s) : une URL RELATIVE résout vers le scheme de la
      // page (https) → sinon la clé `https://…` ≠ `wss://…` → 2 instances/2 sockets.
      if (u.protocol === "http:") u.protocol = "ws:";
      else if (u.protocol === "https:") u.protocol = "wss:";
      return u.toString();
    } catch {
      // Une URL que `new URL()` refuse est une faute de frappe, pas un cas à
      // rattraper : la rendre telle quelle laisserait le transport échouer plus
      // loin, sans dire ce qui était mal écrit.
      throw new Error(
        `[nodefony] adresse du serveur temps réel illisible : ${JSON.stringify(url)}`,
      );
    }
  }

  get state(): RealtimeState {
    return this._state;
  }

  /** Nombre de tentatives de reconnexion depuis la dernière connexion réussie. */
  get reconnectAttempts(): number {
    return this.reconnectAttempt;
  }

  /**
   * Timestamp (ms epoch) de la prochaine tentative de reconnexion planifiée,
   * `null` hors backoff. Permet un compte à rebours UI synchronisé au vrai délai.
   */
  get nextRetryAt(): number | null {
    return this._nextRetryAt;
  }

  /**
   * Force une reconnexion **immédiate** (annule le backoff en cours). No-op si
   * déjà connecté/connexion en cours.
   */
  retryNow(): void {
    if (this._state === "connected" || this._state === "connecting") return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this._nextRetryAt = null;
    this.intentionalClose = false;
    this.openSocket().catch(() => {
      /* onclose relancera le backoff */
    });
  }

  /**
   * Ouvre la connexion WS. Idempotent — si déjà ouverte, no-op.
   * Resolve une fois `connected` ou reject sur erreur fatale.
   */
  async connect(url?: string): Promise<void> {
    if (this._state === "connected" || this._state === "connecting") return;
    this.intentionalClose = false;
    this.opts.url = url ?? this.requireUrl();
    return this.openSocket();
  }

  /** L'URL configurée, ou l'échec franc — jamais une valeur devinée. */
  private requireUrl(): string {
    if (!this.opts.url) throw RealtimeClient.missingUrl();
    return this.opts.url;
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.clearTimers();
    this.transport?.close(1000, "client disconnect");
    // Logout = on annule les requêtes sortantes en vol (rejet immédiat plutôt que
    // timeout). Le peer reste réutilisable (un `connect()` ultérieur repart propre).
    this.peer.dispose("client disconnect");
    // Déconnexion VOLONTAIRE (ex. logout) → l'identité n'est plus valable. Une
    // perte RÉSEAU (onClose non intentionnel) garde la dernière identité jusqu'au
    // prochain welcome → évite un flash login pendant une micro-reconnexion.
    this._identity = null;
    this._serverChannels = null;
    this._serverMethods = null;
    this.fireLocal(LOCAL_EVENTS.identity, null);
    this.setState("disconnected");
  }

  /** Pub/sub local — handler sur un event server-pushed (notification JSON-RPC). */
  on<K extends string>(
    event: K,
    handler: K extends EventNames<Listen>
      ? (payload: EventPayload<Listen, K>) => void
      : RealtimeHandler,
  ): () => void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler as EventHandler);
    return () => this.off(event, handler);
  }

  off<K extends string>(
    event: K,
    handler: K extends EventNames<Listen>
      ? (payload: EventPayload<Listen, K>) => void
      : RealtimeHandler,
  ): void {
    this.handlers.get(event)?.delete(handler as EventHandler);
  }

  /**
   * S'abonne aux **notices normalisées** émises par le client : criticités qui
   * cassent le temps réel (close codes RFC 6455 interprétés via
   * {@link closeCodeToNotice}), erreurs serveur poussées, rétablissement de
   * connexion. Réutilisable par toute app — le centre de notifications (snackbar
   * Studio) s'y branche directement.
   *
   * @param handler - reçoit chaque {@link NodefonyNotice}.
   * @returns dispose (désabonnement).
   */
  onNotice(handler: (notice: NodefonyNotice) => void): () => void {
    // `__notice__` est un event LOCAL (jamais réseau) hors map `Listen` user.
    // Le type conditionnel de `on` ne se résout pas car `Listen` est générique
    // → cast pour bypasser. Aucun impact runtime, sécurité préservée par le type
    // du paramètre `handler` ci-dessus.
    return this.on(LOCAL_EVENTS.notice, handler as never);
  }

  /**
   * S'abonne aux **refus de canal** poussés par le serveur (`realtime:denied`) :
   * un `subscribe`/push vers un canal protégé sans droit suffisant. Permet une
   * réaction CIBLÉE par canal (griser un contrôle, demander une élévation),
   * complémentaire de {@link onNotice} (UX générique). Event LOCAL `__denied__`.
   *
   * Polymorphisme CLIENT : la réaction est pluggable ici ; l'AUTORITÉ reste
   * serveur (le firewall a déjà décidé, le motif est générique — pas d'oracle).
   *
   * @param handler - reçoit `{ channel, reason }`.
   * @returns dispose (désabonnement).
   */
  onDenied(handler: (denied: IRealtimeDenied) => void): () => void {
    return this.on(LOCAL_EVENTS.denied, handler as never);
  }

  /**
   * Notification one-way client → server (pas de réponse attendue).
   *
   * C'est la SEULE émission dont personne n'apprend l'échec autrement : une
   * requête corrélée est rejetée, un (dés)abonnement est rejoué au reconnect —
   * une notification applicative perdue, elle, ne laisse aucune trace. Si le
   * transport est fermé, l'utilisateur en est donc averti (une fois par épisode
   * de coupure, cf {@link send}).
   */
  emit<K extends string>(
    method: K,
    params?: K extends EventNames<Emit> ? EventPayload<Emit, K> : unknown,
  ): void {
    if (!this._emitRaw(method, params)) this.noticeUnsent();
  }

  /**
   * Émission interne sans typage strict — utilisée pour les notifications système
   * (`subscribe`, `unsubscribe`, `ping`) qui ne figurent pas dans la map `Emit`
   * utilisateur. Bypasse les types conditionnels de {@link emit}.
   *
   * Ces frames-là **ne préviennent pas** l'utilisateur quand elles se perdent :
   * les abonnements sont rejoués à la reconnexion et le heartbeat est arrêté
   * avec les timers. Avertir ferait paraître comme une perte ce que le client
   * rattrape tout seul — du bruit dans le centre de notifications d'une app qui
   * monte et démonte des vues (le cas de Studio).
   *
   * @returns `false` si le transport n'a pas émis la frame.
   */
  private _emitRaw(method: string, params?: unknown): boolean {
    // `method`/`params` système (subscribe/unsubscribe/ping) hors map `Emit` →
    // cast vers la signature stricte du peer (équivalent à l'API pré-types).
    return this.peer.notify(method as never, params as never);
  }

  /**
   * Émet sur un canal — verbe socket de {@link IRealtimeSocket.publish}. Côté client =
   * notification au serveur (alias clair de {@link emit}).
   */
  publish<K extends string>(
    channel: K,
    payload?: K extends EventNames<Emit> ? EventPayload<Emit, K> : unknown,
  ): void {
    this.emit(channel, payload as never);
  }

  /**
   * S'abonne à un canal pub/sub serveur (**ref-compté**). Émet la notification
   * `subscribe` au serveur UNIQUEMENT au 1er consommateur du canal ; les suivants
   * ne font qu'incrémenter le compteur. Ré-émis automatiquement à chaque
   * (re)connexion. NE remplace PAS {@link on} : `on(channel, h)` REÇOIT les
   * messages, `subscribe(channel)` DEMANDE au serveur de les pousser.
   *
   * Autorité unique partagée par le binding `nodefony/react` ET le store Studio →
   * deux consommateurs du même canal ne se coupent plus l'un l'autre.
   */
  subscribe(channel: EventNames<Listen> | (string & {})): void {
    const c = channel as string;
    const n = (this._subscriptions.get(c) ?? 0) + 1;
    this._subscriptions.set(c, n);
    if (n === 1) this._emitRaw("subscribe", { channel: c });
  }

  /**
   * Désabonne un consommateur d'un canal (ref-compté) : émet `unsubscribe` au
   * serveur seulement au **dernier** consommateur. No-op si le canal n'est pas suivi.
   */
  unsubscribe(channel: EventNames<Listen> | (string & {})): void {
    const c = channel as string;
    const cur = this._subscriptions.get(c);
    if (!cur) return;
    if (cur <= 1) {
      this._subscriptions.delete(c);
      this._emitRaw("unsubscribe", { channel: c });
    } else {
      this._subscriptions.set(c, cur - 1);
    }
  }

  /** Canaux actuellement abonnés (≥ 1 consommateur). Lecture seule. */
  get subscribedChannels(): string[] {
    return Array.from(this._subscriptions.keys());
  }

  /**
   * L'adresse du serveur temps réel, telle qu'elle a été donnée (ou résolue en
   * absolu par {@link shared}). `null` tant qu'aucune n'a été fournie — le
   * framework n'en devine aucune.
   *
   * Publiée pour l'auto-observation : un instantané de socket qui ne dit pas DE
   * QUELLE socket il parle ne sert à rien dès qu'une page en tient plus d'une.
   */
  get url(): string | null {
    return this.opts.url ?? null;
  }

  /**
   * Identité de la connexion, **annoncée par le serveur** au `realtime:welcome`
   * ({@link RealtimeIdentity}). `null` tant qu'aucun welcome n'a été reçu ; une
   * fois reçu, un visiteur anonyme a `authenticated: false` (jamais `null`). Un
   * consommateur (Studio) sait ainsi s'il doit afficher le login **sans taper de
   * route**. Rafraîchie à chaque (re)connexion ; remise à `null` au
   * {@link disconnect} volontaire (logout).
   */
  get identity(): RealtimeIdentity | null {
    return this._identity;
  }

  /** Canaux pub/sub annoncés par le serveur au welcome (découverte). `null` si pas (encore) reçu. */
  get serverChannels(): readonly string[] | null {
    return this._serverChannels;
  }

  /** Actions RPC annoncées par le serveur au welcome (découverte). `null` si pas (encore) reçu. */
  get serverMethods(): readonly string[] | null {
    return this._serverMethods;
  }

  /**
   * S'abonne à l'identité résolue (event LOCAL `__identity__`, jamais réseau) :
   * le handler est rappelé à chaque (re)welcome et au `disconnect()`. Permet à
   * l'UI de basculer anonyme↔authentifié sans polling ni route `/auth/me`.
   *
   * @param handler - reçoit la {@link RealtimeIdentity} courante (ou `null`).
   * @returns dispose (désabonnement).
   */
  onIdentity(handler: (identity: RealtimeIdentity | null) => void): () => void {
    return this.on(LOCAL_EVENTS.identity, handler as never);
  }

  /**
   * S'abonne à l'**état de la connexion** (event LOCAL `__state__`, jamais réseau) :
   * le handler est rappelé à chaque transition (`connecting`, `connected`,
   * `reconnecting`, `error`, `disconnected`), jamais pour un état inchangé.
   *
   * C'est la porte à employer partout — un badge de connexion, une liaison de vue,
   * une barre de debug. Écrire `on("__state__", …)` en clair marche aussi, mais
   * recopie un nom d'événement interne dans du code applicatif : c'est ce qui a
   * fait diverger les trois gabarits d'application.
   *
   * @param handler - reçoit le nouvel {@link RealtimeState}.
   * @returns dispose (désabonnement).
   */
  onState(handler: (state: RealtimeState) => void): () => void {
    return this.on(LOCAL_EVENTS.state, handler as never);
  }

  /**
   * S'abonne au **tick d'échantillonnage des statistiques** (event LOCAL
   * `__stats__`, jamais réseau), émis une fois par seconde après recalcul des
   * débits par canal. Sans charge utile : lire ensuite {@link getChannelStats}
   * ou {@link getStats}, dont les valeurs viennent d'être rafraîchies.
   *
   * @param handler - appelé à chaque échantillon.
   * @returns dispose (désabonnement).
   */
  onStats(handler: () => void): () => void {
    return this.on(LOCAL_EVENTS.stats, handler as never);
  }

  /**
   * S'abonne aux **tentatives de reconnexion programmées** (event LOCAL
   * `__reconnect__`, jamais réseau) : numéro d'essai, délai retenu par le
   * back-off, et échéance absolue. De quoi afficher un compte à rebours plutôt
   * qu'un « déconnecté » muet.
   *
   * @param handler - reçoit `{ attempt, delay, nextRetryAt }`.
   * @returns dispose (désabonnement).
   */
  onReconnect(handler: (info: RealtimeReconnectInfo) => void): () => void {
    return this.on(LOCAL_EVENTS.reconnect, handler as never);
  }

  /**
   * Handle « socket-like » d'un canal ({@link IRealtimeChannel}) — fine liaison sur
   * les primitives (`subscribe`/`on`/`publish`/`unsubscribe`), forme naturelle des
   * canaux à état (SIP, bridge) et point d'accroche des couches à venir (codec,
   * cadence, politique). N'ouvre rien : appeler `.open()` pour s'abonner. `kind` reste
   * indéfini côté client tant que le serveur ne l'annonce pas.
   */
  channel(name: string): IRealtimeChannel {
    const hub = this;
    const disposers = new Set<() => void>();
    return {
      name,
      on(handler: RealtimeHandler): () => void {
        // `name` est dynamique (`string`) → le type conditionnel de `hub.on`
        // ne se résout pas en présence d'un `Listen` générique. Cast nécessaire
        // (l'IRealtimeChannel reste non paramétré par choix).
        const dispose = hub.on(name, handler as never);
        disposers.add(dispose);
        return () => {
          dispose();
          disposers.delete(dispose);
        };
      },
      send(payload?: unknown): void {
        hub.publish(name, payload as never);
      },
      open(): void {
        hub.subscribe(name);
      },
      close(): void {
        for (const d of disposers) d();
        disposers.clear();
        hub.unsubscribe(name);
      },
    };
  }

  /**
   * S'abonne à un canal d'ÉTAT en **cadence adaptative** (AIMD client-driven) : la lib
   * mesure la gigue d'arrivée et ré-abonne automatiquement à une cadence plus grossière en
   * cas de famine, plus fine quand c'est sain — sans changement serveur. `handler` reçoit
   * les frames à travers les changements de cadence. Réservé aux canaux latest-wins.
   *
   * @param base - canal de base (sans suffixe de cadence).
   * @param handler - reçoit le payload de chaque frame.
   * @param options - cadence désirée + réglages AIMD (cf {@link BindAdaptiveOptions}).
   * @returns une poignée {@link AdaptiveChannelBinding} (cadence courante + `dispose`).
   */
  adaptiveChannel(
    base: string,
    handler: RealtimeHandler,
    options: BindAdaptiveOptions,
  ): AdaptiveChannelBinding {
    // `bindAdaptiveChannel` accepte un `IRealtimeSocket` non paramétré
    // (= defaults permissifs) ; les méthodes typées de cette classe n'ont
    // pas la covariance requise vers les defaults dans le sens classe→interface.
    // Cast minimal au point d'appel.
    return bindAdaptiveChannel(
      this as unknown as IRealtimeSocket,
      base,
      handler,
      options,
    );
  }

  /**
   * Requête API par **path** — la MÊME action controller que le GET REST, via
   * la socket (« API souveraine » : 1 action = N transports). Sucre au-dessus
   * de la méthode RPC `api.request` (protocole caché — convention dans la lib,
   * comme `nodefony:kernel:ping`/`ping()`) :
   * ```ts
   * const modules = await socket.request("/nodefony/kernel/api/modules");
   * ```
   * Échec → rejet {@link RpcError} (`data.status` = statut HTTP équivalent :
   * 404 path inconnu, 403 refus…). Un path commence toujours par `/`, une
   * méthode JSON-RPC jamais → zéro collision avec la forme `request(method)`.
   */
  async request<T = unknown>(
    path: `/${string}`,
    timeoutMs?: number,
  ): Promise<T>;
  /** Request/response JSON-RPC 2.0 — Promise resolved with `result`. */
  async request<K extends string, T = unknown>(
    method: K,
    params?: K extends ActionNames<Actions>
      ? ActionParams<Actions, K>
      : unknown,
    timeoutMs?: number,
  ): Promise<K extends ActionNames<Actions> ? ActionResult<Actions, K> : T>;
  /**
   * Forme HISTORIQUE `request<T>(method, params?)` — `T` est le type du RÉSULTAT.
   *
   * ⚠️ Cette surcharge est aussi un ATTRAPE-TOUT : quand la surcharge typée
   * ci-dessus échoue (params mal formés sur une action du contrat), TS retombe
   * ici et accepte n'importe quel payload. Le garde-fou « params conformes au
   * contrat » est donc INOPÉRANT tant qu'elle existe (prouvé dans
   * `tests/RealtimeClient.types.test.ts`).
   *
   * Elle est CONSERVÉE sciemment : la retirer est un *breaking change* d'API
   * publique, pas un correctif. Les deux formes se disputent le 1ᵉʳ paramètre
   * générique (`<T>` = résultat ici, `<K>` = nom de méthode au-dessus) : tout
   * appel `request<MonType>("ma:methode")` — dont `ping()` et le Studio
   * (`request<IScaffoldJobState>("nodefony:scaffold:run", …)`) — devrait être réécrit en
   * `request<"ma:methode", MonType>`. À trancher hors session de dette.
   */
  async request<T = unknown>(
    method: string,
    params?: unknown,
    timeoutMs?: number,
  ): Promise<T>;
  async request<T = unknown>(
    method: string,
    params?: unknown,
    timeoutMs = 30000,
  ): Promise<T> {
    // Forme path (`request("/x", timeout?)`) : le 2ᵉ argument EST le timeout.
    // Détection runtime (charCode `/`) — couvre aussi un path non-littéral
    // (variable `string`, typée par l'overload générique mais routée ici).
    if (method.charCodeAt(0) === 47) {
      if (typeof params === "number") timeoutMs = params;
      params = { path: method };
      method = "api.request";
    }
    // Plan de contrôle (id, corrélation, timeout, RpcError) délégué au moteur
    // isomorphe. `method`/`params` sont routés par l'overload générique permissif
    // → cast vers la signature stricte du peer (équivalent pré-types).
    return this.peer.request(
      method as never,
      params as never,
      timeoutMs,
    ) as Promise<T>;
  }

  /**
   * **Mutation** API par le pont `api.request` (POST/PUT/PATCH/DELETE) — pendant
   * d'écriture de {@link request} (qui ne fait que des lectures GET). Transporte
   * la méthode HTTP **logique**, le corps, et une **clé d'idempotence**
   * (OBLIGATOIRE côté serveur : une socket reconnecte et peut rejouer une frame
   * en vol → la clé dédoublonne le rejeu, anti double-effet) :
   * ```ts
   * await socket.mutate("/nodefony/security/api/apikeys/42/revoke", {
   *   method: "POST", idempotencyKey: crypto.randomUUID(),
   * });
   * ```
   * Échec → rejet {@link RpcError} (`data.status` = statut HTTP équivalent :
   * 400 clé absente, 409 rejeu concurrent, 403 refus, 404 path inconnu…).
   */
  async mutate<T = unknown>(
    path: `/${string}`,
    init: {
      method: "POST" | "PUT" | "PATCH" | "DELETE";
      body?: unknown;
      idempotencyKey: string;
      timeoutMs?: number;
    },
  ): Promise<T> {
    return this.peer.request(
      "api.request" as never,
      {
        path,
        method: init.method,
        body: init.body,
        idempotencyKey: init.idempotencyKey,
      } as never,
      init.timeoutMs ?? 30000,
    ) as Promise<T>;
  }

  /**
   * Appel API par la socket rendant l'**enveloppe complète** — le résultat ET
   * la méta serveur — là où {@link request}/{@link mutate} ne rendent que la
   * valeur (forme courante, contrat « snapshot ≡ GET REST »).
   *
   * Utile à l'outillage plus qu'aux applications : en développement, le serveur
   * joint le `requestId` du profil de CETTE frame, ce qui permet d'aller lire sa
   * radiographie (`GET /nodefony/profiler/api/{requestId}` — phases, SQL,
   * décision du firewall). En production le serveur n'émet aucune méta :
   * `requestId` vaut alors `null`, et l'appel coûte exactement le même trafic.
   *
   * ```ts
   * const { result, requestId } = await socket.call("/nodefony/kernel/api/modules");
   * ```
   *
   * Échec → rejet {@link RpcError}, comme {@link request} ; l'id du profil, lui,
   * voyage dans `error.data.requestId` (un refus se radiographie aussi).
   *
   * @param path - chemin de la route (transport WEBSOCKET requis côté serveur).
   * @param init - méthode logique (défaut `GET`), corps, clé d'idempotence.
   */
  async call<T = unknown>(
    path: `/${string}`,
    init?: {
      method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      body?: unknown;
      idempotencyKey?: string;
      timeoutMs?: number;
    },
  ): Promise<IApiCallResult<T>> {
    const traced = await this.peer.requestTraced(
      "api.request" as never,
      {
        path,
        method: init?.method ?? "GET",
        body: init?.body,
        idempotencyKey: init?.idempotencyKey,
      } as never,
      init?.timeoutMs ?? 30000,
    );
    const { result, meta } = traced as RpcTracedResult<T>;
    return {
      result,
      requestId: typeof meta?.requestId === "string" ? meta.requestId : null,
    };
  }

  /**
   * Mesure le round-trip WS via la méthode RPC standard `nodefony:kernel:ping` — helper
   * RÉUTILISABLE par tout consommateur (topbar Studio, debug bar, app user) :
   * la mesure du RTT et la convention `nodefony:kernel:ping` vivent dans la lib cliente,
   * pas dupliquées dans chaque front. Renvoie le payload serveur enrichi de `rtt`
   * (ms, aller-retour mesuré côté client). Lève si le serveur ne répond pas
   * (`request` timeout) ou ne connaît pas la méthode (`-32601`).
   */
  async ping(timeoutMs = 5000): Promise<KernelPingResult & { rtt: number }> {
    const now = (): number =>
      typeof performance !== "undefined" &&
      typeof performance.now === "function"
        ? performance.now()
        : Date.now();
    const t0 = now();
    const res = await this.request<KernelPingResult>(
      PLATFORM_METHODS.ping,
      undefined,
      timeoutMs,
    );
    return { ...res, rtt: Math.round(now() - t0) };
  }

  // ── Contrat IRealtimePeer (plan de contrôle, délégué au moteur) ─────────
  // Le client EXPOSE la surface bidirectionnelle isomorphe en composant le MÊME
  // `JsonRpcPeer` que la connexion serveur. `register` rend le client CALLEE : un
  // serveur peut désormais le `request` (duplex serveur→client réel, débloqué par L0).

  /** Notification SORTANTE typée (pas de réponse). Pendant de {@link emit}/{@link publish}. */
  notify<K extends EventNames<Emit>>(
    method: K,
    params?: EventPayload<Emit, K>,
  ): void {
    this.peer.notify(method, params);
  }

  /**
   * Expose une action appelable PAR LE PAIR (requête entrante serveur→client).
   * Cœur du duplex débloqué par L0 : sans handler, une requête entrante reçoit
   * `-32601` ; avec, le `result` repart au serveur (confirmation d'action,
   * invalidation de cache poussée, health applicatif serveur→client).
   */
  register<K extends ActionNames<Actions>>(
    method: K,
    handler: TypedRpcActionHandler<Actions, K>,
  ): void {
    this.peer.register(method, handler);
  }

  /** Retire une action exposée. */
  unregister<K extends ActionNames<Actions>>(method: K): void {
    this.peer.unregister(method);
  }

  /** Actions exposées par CE client (découverte). ≠ {@link serverMethods} (côté serveur). */
  get methods(): string[] {
    return this.peer.methods;
  }

  /**
   * Ingestion d'une frame ENTRANTE déjà parsée → log + classification/route par le
   * moteur. Renvoie sa nature. Une frame `invalid` peut porter une erreur GLOBALE
   * serveur (`{jsonrpc, error}` hors spec JSON-RPC) → notice (cf {@link handleServerError}).
   */
  receive(frame: unknown): JsonRpcFrameKind {
    this.recordFrame("in", frame); // log protocole (lazy)
    const kind = this.peer.receive(frame);
    if (kind === "invalid") this.handleServerError(frame);
    return kind;
  }

  /** Annule les requêtes sortantes en attente (fermeture transport / logout). */
  dispose(reason?: string): void {
    this.peer.dispose(reason);
  }

  // ── Stats (génériques, réutilisables) ──────────────────────────────────

  /** Total de notifications reçues, tous canaux confondus (welcome inclus). */
  get framesReceived(): number {
    return this._framesReceived;
  }

  /**
   * Total de frames qui n'ont **pas** pu partir depuis la création du client
   * (transport fermé au moment de l'émission). Reste à `0` en fonctionnement
   * normal ; toute valeur non nulle date d'une coupure ou d'une émission
   * antérieure à la première connexion.
   */
  get framesUnsent(): number {
    return this._framesUnsent;
  }

  /** Timestamp (ms) de la dernière notification reçue. */
  get lastFrameAt(): number | null {
    return this._lastFrameAt;
  }

  /** `method`/canal de la dernière notification reçue. */
  get lastFrameMethod(): string | null {
    return this._lastFrameMethod;
  }

  /** Snapshot des stats par canal (msgCount/rate/series). Les objets sont les
   *  refs internes — à LIRE, pas à muter (copier les valeurs si besoin). */
  getStats(): MessageStats[] {
    return Array.from(this._stats.values());
  }

  /** Stats d'un canal précis (== method JSON-RPC) ou `undefined`. */
  getChannelStats(method: string): MessageStats | undefined {
    return this._stats.get(method);
  }

  // ── Internals ─────────────────────────────────────────────────────────

  /** Comptabilise une notification entrante (avant dispatch aux handlers). */
  private trackFrame(method: string): void {
    const now = Date.now();
    this._framesReceived++;
    this._lastFrameAt = now;
    this._lastFrameMethod = method;
    let st = this._stats.get(method);
    if (!st) {
      st = { method, msgCount: 0, lastMessage: null, rate: 0, series: [] };
      this._stats.set(method, st);
    }
    st.msgCount++;
    st.lastMessage = now;
  }

  /**
   * Ingère le `realtime:welcome` : mémorise l'identité résolue + les capabilities
   * annoncées (canaux/actions découvrables) et émet `__identity__`. Tolérant à un
   * welcome partiel/legacy (champs absents → `null`). Cold path (1×/connexion).
   */
  private ingestWelcome(params: unknown): void {
    const w = params as Partial<IRealtimeWelcome> | null;
    if (!w || typeof w !== "object") return;
    this._identity = w.identity ?? null;
    this._serverChannels = Array.isArray(w.channels) ? w.channels : null;
    this._serverMethods = Array.isArray(w.methods) ? w.methods : null;
    this.fireLocal(LOCAL_EVENTS.identity, this._identity);
  }

  /**
   * Ingère un `realtime:denied` (refus d'abonnement/push poussé par le serveur) :
   * émet une notice normalisée ({@link onNotice}) ET un event ciblé `__denied__`
   * ({@link onDenied}) pour une réaction polymorphe de l'app. Tolérant à un
   * payload partiel (motif par défaut `forbidden`). Cold path (refus rare).
   */
  private ingestDenied(params: unknown): void {
    const p = params as { channel?: unknown; reason?: unknown } | null;
    const channel = typeof p?.channel === "string" ? p.channel : "";
    const reason = typeof p?.reason === "string" ? p.reason : "forbidden";
    const denied: IRealtimeDenied = { channel, reason };
    this.fireNotice(deniedToNotice(denied));
    this.fireLocal(LOCAL_EVENTS.denied, denied);
  }

  /**
   * Dispatch d'une NOTIFICATION entrante — appelé par le moteur via `onNotification`.
   * Ordre figé : ingestion welcome (1ʳᵉ frame) → stats → handlers locaux + wildcard
   * (un handler `on("realtime:welcome")` voit donc l'identité déjà ingérée).
   */
  private dispatchNotification(method: string, params: unknown): void {
    if (method === "realtime:welcome") this.ingestWelcome(params);
    else if (method === "realtime:denied") this.ingestDenied(params);
    this.trackFrame(method); // stats génériques avant dispatch
    this.handlers.get(method)?.forEach((h) => {
      try {
        h(params);
      } catch {
        /* ignore handler errors */
      }
    });
    // wildcard
    this.handlers.get("*")?.forEach((h) => {
      try {
        h(method, params);
      } catch {
        /* ignore */
      }
    });
  }

  /**
   * Frame `invalid` (JSON-RPC strict) portant un `error` sans `id`/`method` = erreur
   * GLOBALE serveur (extension Nodefony hors spec, ex. refus tardif) → notice pour le
   * centre de notifications. Frame réellement malformée (sans `.error`) → no-op.
   */
  private handleServerError(frame: unknown): void {
    const err = (frame as { error?: { code?: number; message?: string } })
      .error;
    if (!err || typeof err !== "object") return;
    this.fireNotice({
      level: "error",
      title: "Temps réel",
      message: err.message || "Erreur serveur temps réel",
      source: "server",
      code: err.code,
      ts: Date.now(),
    });
  }

  /** Échantillonne le débit (msg/s) + série par canal, 1×/s, puis émet
   *  `__stats__` (event local) pour notifier les consommateurs réactifs. */
  private startStatsSampler(): void {
    if (this.statsTimer) return;
    this.statsTimer = setInterval(() => {
      for (const st of this._stats.values()) {
        const prev = this._prevSampled.get(st.method) ?? st.msgCount;
        st.rate = Math.max(0, st.msgCount - prev);
        this._prevSampled.set(st.method, st.msgCount);
        st.series = [...st.series, st.rate].slice(-STATS_SERIES_POINTS);
      }
      this.fireLocal(LOCAL_EVENTS.stats);
    }, 1000);
    (this.statsTimer as { unref?: () => void }).unref?.();
  }

  /** Émet une notice normalisée aux abonnés `onNotice` (event local, pas réseau). */
  private fireNotice(notice: NodefonyNotice): void {
    this.fireLocal(LOCAL_EVENTS.notice, notice);
  }

  /** Déclenche les handlers locaux d'un event interne (pas d'envoi réseau). */
  private fireLocal(event: string, ...args: unknown[]): void {
    this.handlers.get(event)?.forEach((h) => {
      try {
        h(...args);
      } catch {
        /* ignore handler errors */
      }
    });
  }

  private openSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.setState(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");
      let transport: IRealtimeTransport;
      try {
        const base =
          typeof window !== "undefined"
            ? window.location.href
            : "http://localhost";
        const url = new URL(this.requireUrl(), base);
        // Une URL relative hérite du scheme de la page (http/https) → WebSocket
        // exige ws/wss. Normaliser systématiquement (sinon throw "scheme must be…").
        if (url.protocol === "http:") url.protocol = "ws:";
        else if (url.protocol === "https:") url.protocol = "wss:";
        if (this.opts.token) url.searchParams.set("token", this.opts.token);
        // Transport NEUF à chaque tentative (le précédent est clos). Le transport
        // ne sait QUE ouvrir/envoyer/fermer ; l'orchestration reste ici.
        transport = this.transportFactory(url.toString());
        this.transport = transport;
      } catch (e) {
        this.setState("error");
        reject(e);
        return;
      }
      transport.onOpen(() => {
        const wasReconnecting = this.reconnectAttempt > 0;
        this.reconnectAttempt = 0;
        this._nextRetryAt = null;
        this.setState("connected");
        this.startHeartbeat();
        // Ré-abonne tous les canaux ref-comptés : le serveur repart d'un état
        // vide après une (re)connexion ; couvre aussi un `subscribe` appelé avant
        // l'ouverture du socket (l'`emit` avait alors été droppé par `send`).
        for (const channel of this._subscriptions.keys()) {
          this._emitRaw("subscribe", { channel });
        }
        // Notice de rétablissement : seulement après une vraie perte (pas au 1er
        // connect) → l'UI confirme le retour du temps réel.
        if (wasReconnecting) {
          this.fireNotice({
            level: "success",
            title: "Temps réel",
            message: "Connexion temps réel rétablie",
            source: "realtime",
            ts: Date.now(),
          });
        }
        resolve();
      });
      transport.onMessage((raw) => this.handleMessage(raw));
      transport.onError(() => {
        // L'event `close` qui suit gère le reconnect.
      });
      transport.onClose((code, reason) => {
        this.clearTimers();
        this.transport = null;
        if (this.intentionalClose) {
          this.setState("disconnected");
          return;
        }
        // Criticité qui casse le temps réel (RFC 6455 §7.4) → notice normalisée,
        // pendant client du `toWsCloseCode` serveur (@nodefony/http).
        const notice = closeCodeToNotice(code, reason);
        if (notice) this.fireNotice(notice);
        // Respect de la SÉMANTIQUE du close code : un code DÉFINITIF (policy 1008
        // = 401/403, protocole, introuvable) ne RELANCE PAS la boucle de reco —
        // sinon un anonyme martèle un endpoint protégé. L'app rétablit après
        // l'action corrective (login → `connect()`/`retryNow()`). Reco réservée
        // aux codes transitoires (perte réseau, restart, erreur serveur).
        const reconnectable = isReconnectableCloseCode(code);
        if (reconnectable && this.opts.autoReconnect !== false) {
          this.scheduleReconnect();
        } else {
          // Fatal → "error" (échec définitif, action requise) ; transitoire mais
          // autoReconnect désactivé → "disconnected".
          this.setState(reconnectable ? "disconnected" : "error");
        }
      });
      transport.connect();
    });
  }

  private scheduleReconnect(): void {
    this.reconnectAttempt++;
    const base = this.opts.reconnectDelay ?? 1000;
    const max = this.opts.reconnectDelayMax ?? 30000;
    const delay = Math.min(base * 2 ** (this.reconnectAttempt - 1), max);
    this._nextRetryAt = Date.now() + delay;
    this.setState("reconnecting");
    // Event dédié → l'UI peut afficher tentative + compte à rebours live.
    this.fireLocal(LOCAL_EVENTS.reconnect, {
      attempt: this.reconnectAttempt,
      delay,
      nextRetryAt: this._nextRetryAt,
    });
    this.reconnectTimer = setTimeout(() => {
      this.openSocket().catch(() => {
        /* swallow — onclose re-déclenchera */
      });
    }, delay);
  }

  private startHeartbeat(): void {
    const interval = this.opts.heartbeatInterval ?? 30000;
    this.heartbeatTimer = setInterval(() => {
      if (this.transport?.readyState === TransportState.OPEN) {
        this._emitRaw("ping", { ts: Date.now() });
      }
    }, interval);
  }

  private clearTimers(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
  }

  /**
   * Log protocole : les `FRAME_LOG_MAX` dernières frames JSON-RPC (redactées),
   * enregistrées EN CONTINU → la console « retrace l'instant » dès l'ouverture
   * (jamais de démarrage à vide). Construction + redaction faites ici, à la lecture.
   */
  get frameLog(): readonly RealtimeFrame[] {
    return (this._rawFrames ?? []).map((f) =>
      RealtimeClient.buildFrame(f.dir, f.msg, f.ts),
    );
  }

  /** Purge le log protocole. */
  clearFrameLog(): void {
    if (this._rawFrames) this._rawFrames.length = 0;
  }

  /**
   * Enregistre une frame dans le ring — coût = 1 push de réf (construction +
   * redaction DIFFÉRÉES). Émet `__frame__` (frame construite) seulement si la
   * console écoute.
   */
  private recordFrame(dir: "in" | "out", msg: unknown): void {
    const ts = Date.now();
    (this._rawFrames ??= []).push({ ts, dir, msg });
    if (this._rawFrames.length > FRAME_LOG_MAX) this._rawFrames.shift();
    const listeners = this.handlers.get("__frame__");
    if (listeners && listeners.size > 0)
      this.fireLocal("__frame__", RealtimeClient.buildFrame(dir, msg, ts));
  }

  /** Construit une frame affichable (kind/canal/id + payload redacté). */
  private static buildFrame(
    dir: "in" | "out",
    msg: unknown,
    ts: number,
  ): RealtimeFrame {
    const m = (msg ?? {}) as Record<string, unknown>;
    let kind = "?";
    let channel: string | undefined;
    if (typeof m.method === "string") {
      kind = m.method;
      const p = m.params as { channel?: unknown } | undefined;
      if (p && typeof p.channel === "string") channel = p.channel;
    } else if ("error" in m) kind = "error";
    else if ("result" in m) kind = "response";
    return {
      ts,
      dir,
      kind,
      id: typeof m.id === "number" ? m.id : undefined,
      channel,
      payload: redactFrame(msg),
    };
  }

  /**
   * Émet une frame si — et seulement si — le transport est ouvert.
   *
   * La frame n'est **pas** mise en file d'attente : rejouer une intention après
   * coup peut être pire que la perdre (une commande obsolète appliquée en
   * retard, un abonnement rétabli sur un écran déjà quitté). Ce qui n'est plus
   * accepté, c'est de la perdre **en silence** — l'appelant reçoit `false`, une
   * requête corrélée est rejetée aussitôt par {@link JsonRpcPeer} plutôt qu'au
   * bout de son timeout, et l'utilisateur est prévenu une fois par épisode.
   *
   * @param msg - la frame JSON-RPC à sérialiser.
   * @returns `true` si la frame est partie, `false` si le transport était fermé.
   */
  private send(msg: unknown): boolean {
    if (this.transport?.readyState !== TransportState.OPEN) {
      this._framesUnsent++;
      return false;
    }
    this.transport.send(JSON.stringify(msg));
    this.recordFrame("out", msg);
    return true;
  }

  /**
   * Avertit que des notifications applicatives se perdent — **une fois par
   * épisode** de coupure, jamais par frame : une vue qui pousse en boucle
   * remplirait sinon le centre de notifications à elle seule.
   *
   * Appelé depuis {@link emit} uniquement. Les requêtes corrélées et les
   * (dés)abonnements ont déjà leur propre voie (rejet, rejeu au reconnect).
   */
  private noticeUnsent(): void {
    if (this._unsentNotified) return;
    this._unsentNotified = true;
    this.fireNotice({
      level: "warning",
      title: "Temps réel",
      message:
        "Connexion interrompue — les messages émis pendant la coupure sont perdus",
      source: "realtime",
      ts: Date.now(),
    });
  }

  private handleMessage(raw: string | ArrayBuffer | Blob): void {
    if (typeof raw !== "string") return; // ignore binary for now
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    // Discrimination (request/notification/response), routage et corrélation d'id
    // délégués au moteur isomorphe via `receive` (log + welcome + stats + handlers
    // y sont rebranchés). Plus aucune classification dupliquée côté client.
    this.receive(msg);
  }

  private setState(s: RealtimeState): void {
    if (this._state === s) return;
    // Réarme l'avertissement de frames perdues : la prochaine coupure en émettra
    // un, celle-ci n'en émettra pas un second.
    if (s === "connected") this._unsentNotified = false;
    this._state = s;
    this.fireLocal(LOCAL_EVENTS.state, s);
  }
}

export default RealtimeClient;
