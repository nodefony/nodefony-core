/**
 * La socket cliente de Nodefony — classe {@link NodefonySocket}, publiée par
 * `nodefony/client`.
 *
 * Machine d'états : disconnected → connecting → connected → reconnecting → error.
 * Le transport est injectable ({@link IRealtimeTransport}) ; le transport par
 * défaut est le WebSocket du navigateur ({@link BrowserWsTransport}).
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
 * Enveloppe d'un appel {@link NodefonySocket.call} : la valeur rendue par la
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
  RealtimeIdentity,
  TypedRpcActionHandler,
  ContractParams,
  ContractResult,
} from "../../realtime/RealtimeEventMap";
import { unrefTimer } from "../../runtime/unrefTimer";
import { BrowserWsTransport } from "./BrowserWsTransport";
import { describeSocket, socketSnapshot } from "./snapshot";
import {
  announceRealtime,
  hasKernel,
  consoleDetails,
  noteServerEnv,
} from "../announce";
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
import { isJsonRpcId } from "../../jsonrpc/index";

export type RealtimeState =
  "disconnected" | "connecting" | "connected" | "reconnecting" | "error";

export interface NodefonySocketOptions {
  url?: string | undefined;
  token?: string | null | undefined;
  /** Reconnexion auto. Défaut: true. */
  autoReconnect?: boolean | undefined;
  /**
   * Délai initial entre tentatives (ms). Défaut: 1000. Il double à chaque échec,
   * avec une gigue, et ne descend jamais sous un plancher de 100 ms — quelle que
   * soit la valeur donnée ici.
   */
  reconnectDelay?: number | undefined;
  /** Délai max entre tentatives (ms). Défaut: 30000. Le plancher l'emporte s'il est plus bas. */
  reconnectDelayMax?: number | undefined;
  /**
   * Délai d'ouverture (ms) : une poignée de main qui n'aboutit pas dans ce délai
   * est abandonnée, `connect()` rejette et la reconnexion prend le relais.
   * Défaut : 10000. `0` désactive la borne.
   */
  connectTimeout?: number | undefined;
  /** Heartbeat ping interval (ms). Défaut: 30000. */
  heartbeatInterval?: number | undefined;
  /**
   * Annoncer le framework dans la console du navigateur ? Défaut : oui.
   *
   * Une socket qui vit NUE — sans noyau — est souvent tout ce qu'une page monte :
   * sans cette annonce, elle ne dit rien d'elle-même et `nodefony` reste
   * `undefined` dans la console, ce qui se lit « le framework n'est pas chargé ».
   * `false` fait taire l'annonce ET le handle, pour une application publiée qui
   * ne veut rien dans la console de ses utilisateurs.
   */
  banner?: boolean | undefined;
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
  id?: number | undefined;
  /** Canal pub/sub (`params.channel`), si présent. */
  channel?: string | undefined;
  /** Payload affichable — champs sensibles **redactés** (token/secret…). */
  payload: unknown;
}

/** Taille max du ring du log protocole (inspecteur realtime). */
const FRAME_LOG_MAX = 300;

/**
 * Budget du log protocole, en caractères sérialisés. Le compte de trames seul ne
 * borne rien : 300 trames de 2 Mo retenaient 80 Mo choisis par le serveur.
 */
const FRAME_LOG_MAX_CHARS = 2 * 1024 * 1024;

/** Au-delà, une trame n'est journalisée qu'en résumé (méthode, id, canal, taille). */
const FRAME_LOG_ENTRY_MAX_CHARS = 64 * 1024;

/**
 * Plancher d'un délai de reconnexion (ms). Ni la configuration ni un serveur qui
 * coupe chaque connexion ne font descendre une relance en dessous : sans lui, un
 * délai de 0 transformait chaque client en tempête de poignées de main.
 */
const RECONNECT_DELAY_FLOOR = 100;

/** Plus grand délai que `setTimeout` respecte (2^31-1 ms) ; au-delà il tire à 1 ms. */
const TIMER_MAX = 2 ** 31 - 1;

/**
 * Durée d'ouverture (ms) au-delà de laquelle une connexion compte comme STABLE et
 * remet le back-off à zéro. Un serveur qui accepte puis coupe aussitôt ne le remet
 * donc jamais : il est ménagé de plus en plus, au lieu d'être sondé à cadence fixe.
 */
const STABLE_CONNECTION_MS = 5000;

/** Délai d'ouverture par défaut (ms) — cf {@link NodefonySocketOptions.connectTimeout}. */
const CONNECT_TIMEOUT_DEFAULT = 10_000;

/**
 * Délai de la tentative `attempt` (1 = la première) : doublement depuis `base`,
 * plafonné par `max`, puis gigue « égale » — la moitié fixe garde la croissance,
 * l'autre moitié désynchronise N clients coupés au même instant (sinon ils
 * reviennent tous ensemble frapper le serveur qui redémarre).
 *
 * @param attempt - numéro de la tentative, à partir de 1.
 * @param base - délai initial configuré (ms).
 * @param max - plafond configuré (ms).
 * @returns un délai entier dans `[RECONNECT_DELAY_FLOOR, TIMER_MAX]`.
 */
function reconnectDelay(attempt: number, base: number, max: number): number {
  const start = Number.isFinite(base) && base > 0 ? base : 0;
  const ceiling = Math.min(
    Math.max(Number.isNaN(max) ? 0 : max, RECONNECT_DELAY_FLOOR),
    TIMER_MAX,
  );
  // Exposant borné : 2^1024 vaut Infinity, et 0 × Infinity vaut NaN.
  const grown = Math.min(start * 2 ** Math.min(attempt - 1, 31), ceiling);
  const jittered = grown / 2 + Math.random() * (grown / 2);
  return Math.max(RECONNECT_DELAY_FLOOR, Math.round(jittered));
}

/**
 * Adresse WebSocket d'une URL donnée par l'application — la règle du
 * constructeur WHATWG `new WebSocket()` (`http:` → `ws:`, `https:` → `wss:`,
 * tout autre schéma refusé), plus un refus que le navigateur ne fait pas : des
 * identifiants dans l'adresse. Ils finiraient dans les journaux, l'historique et
 * les en-têtes ; le jeton passe par l'option `token`.
 *
 * @param url - adresse absolue ou relative.
 * @param base - base de résolution d'une adresse relative.
 * @returns l'URL `ws:`/`wss:` résolue.
 * @throws Error si l'adresse est illisible, d'un autre schéma, ou porte des identifiants.
 */
function toSocketUrl(url: string, base: string): URL {
  let u: URL;
  try {
    u = new URL(url, base);
  } catch {
    // Une URL que `new URL()` refuse est une faute de frappe, pas un cas à
    // rattraper : la rendre telle quelle laisserait le transport échouer plus
    // loin, sans dire ce qui était mal écrit.
    throw new Error(
      `[nodefony] adresse du serveur temps réel illisible : ${JSON.stringify(url)}`,
    );
  }
  if (u.protocol === "http:") u.protocol = "ws:";
  else if (u.protocol === "https:") u.protocol = "wss:";
  if (u.protocol !== "ws:" && u.protocol !== "wss:") {
    throw new Error(
      `[nodefony] schéma refusé pour le temps réel : ${u.protocol} (ws:, wss:, http: ou https: attendus)`,
    );
  }
  if (u.username || u.password) {
    throw new Error(
      "[nodefony] identifiants refusés dans l'adresse temps réel : passer le jeton par l'option `token`",
    );
  }
  return u;
}

/**
 * Résumé journalisable d'une trame démesurée : méthode, id, canal et taille,
 * jamais la charge. Garde les clés `result`/`error` pour que le log en lise la
 * nature.
 */
function frameSummary(msg: unknown, size: number): Record<string, unknown> {
  const out: Record<string, unknown> = {
    truncated: `${size} caractères — charge non journalisée`,
  };
  if (msg === null || typeof msg !== "object") return out;
  if ("method" in msg && typeof msg.method === "string")
    out.method = msg.method;
  if ("id" in msg && (typeof msg.id === "number" || typeof msg.id === "string"))
    out.id = msg.id;
  if ("params" in msg) {
    const p = msg.params;
    out.params =
      p !== null &&
      typeof p === "object" &&
      "channel" in p &&
      typeof p.channel === "string"
        ? { channel: p.channel }
        : "[tronqué]";
  }
  if ("result" in msg) out.result = "[tronqué]";
  if ("error" in msg) out.error = "[tronqué]";
  return out;
}

/** Clés sensibles masquées dans le log protocole (sécurité — jamais de secret en clair). */
const FRAME_REDACT_RE =
  /(token|password|secret|api[_-]?key|apikey|authorization|bearer)/i;

/** Copie d'un payload JSON-RPC avec masquage des champs sensibles (bornée en profondeur). */
function redactFrame(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redactFrame(v, depth + 1));
  // `fromEntries` crée des propriétés PROPRES : une clé `__proto__` reçue reste
  // une donnée, là où une affectation `out[k] = …` changerait le prototype.
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [
      k,
      FRAME_REDACT_RE.test(k) ? "[redacted]" : redactFrame(v, depth + 1),
    ]),
  );
}

/**
 * Champ `key` d'une valeur reçue du réseau — `undefined` si ce n'est pas un
 * objet qui le porte. Le serveur est un pair, pas une source de confiance : ce
 * qu'il envoie se lit champ par champ, jamais se déclare d'un type.
 */
function fieldOf(value: unknown, key: string): unknown {
  // Propriété PROPRE seulement : `constructor` ou `toString` hérités ne sont
  // pas des champs envoyés par le serveur.
  return value !== null && typeof value === "object"
    ? Object.getOwnPropertyDescriptor(value, key)?.value
    : undefined;
}

/** Les chaînes d'une liste reçue (le reste est écarté) ; `null` si ce n'est pas une liste. */
function stringsOf(value: unknown): string[] | null {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : null;
}

/**
 * Identité annoncée par le `realtime:welcome`, recopiée champ par champ — ou
 * `null` si un seul champ n'a pas son type. Une identité à moitié valide n'en
 * est pas une : `roles: "ROLE_ADMIN"` typé `string[]` ferait répondre vrai à
 * `roles.includes("ROLE_ADMIN")`.
 */
function identityOf(value: unknown): RealtimeIdentity | null {
  const type = fieldOf(value, "type");
  const authenticated = fieldOf(value, "authenticated");
  const userIdentifier = fieldOf(value, "userIdentifier");
  const roles = fieldOf(value, "roles");
  const scopes = fieldOf(value, "scopes");
  if (
    typeof type !== "string" ||
    typeof authenticated !== "boolean" ||
    typeof userIdentifier !== "string" ||
    !Array.isArray(roles) ||
    !Array.isArray(scopes)
  )
    return null;
  const roleList = stringsOf(roles);
  const scopeList = stringsOf(scopes);
  if (roleList?.length !== roles.length || scopeList?.length !== scopes.length)
    return null;
  return {
    type,
    authenticated,
    userIdentifier,
    roles: roleList,
    scopes: scopeList,
  };
}

/**
 * Réponse de la méthode RPC standard `nodefony:kernel:ping` — CONVENTION Nodefony : tout
 * endpoint realtime (Studio aujourd'hui, `RealtimeService` en P13.4) y répond.
 * Sert de liveness + base de mesure du round-trip (cf {@link NodefonySocket.ping}).
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
 * {@link NodefonySocket.onReconnect}.
 */
export interface RealtimeReconnectInfo {
  /** Numéro de la tentative depuis la dernière connexion réussie (1 = la première). */
  attempt: number;
  /** Délai retenu avant cette tentative (ms), plafonné par `reconnectDelayMax`. */
  delay: number;
  /** Échéance absolue de la tentative (ms epoch) — pour un compte à rebours. */
  nextRetryAt: number;
}

/**
 * Socket cliente de Nodefony : une connexion WebSocket JSON-RPC 2.0 vers le
 * serveur temps réel de l'application, qui rétablit la liaison après une coupure.
 *
 * `NodefonySocket.shared({ url })` rend l'instance unique de la page pour cette
 * adresse — l'adresse est obligatoire, la route dépend de l'application. Les
 * liaisons `nodefony/{react,vue,angular,svelte}` et le noyau client s'appuient
 * sur cette instance partagée. Elle porte le pub/sub par canal (`subscribe`),
 * les appels corrélés (`request`) et les événements locaux (`onState`,
 * `onIdentity`, `onNotice`, `onStats`).
 *
 * Implémente {@link IRealtimeSocket}, le contrat que la connexion serveur
 * implémente aussi.
 *
 * @typeParam Emit - événements que la page émet vers le serveur.
 * @typeParam Listen - événements que la page reçoit du serveur.
 * @typeParam Actions - actions RPC appelables par `request`.
 */
export class NodefonySocket<
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
      this.dispatchNotification(method, params),
  });
  private readonly handlers = new Map<string, Set<EventHandler>>();
  // Abonnements pub/sub ref-comptés (canal → nb de consommateurs). Le subscribe/
  // unsubscribe RÉSEAU n'est émis qu'aux transitions 0↔1 → N consommateurs (hooks
  // React `nodefony/react` + store MobX Studio) partagent UN seul abonnement
  // serveur, sans se couper l'un l'autre. Ré-abonné à chaque `realtime:welcome`.
  private readonly _subscriptions = new Map<string, number>();
  // Le serveur n'enregistre un abonnement qu'APRÈS avoir émis son `realtime:welcome` :
  // tant que l'authentification court, son transport JSON-RPC n'est pas branché et
  // toute frame entrante est jetée — sans réponse possible, faute de canal pour la
  // porter (`RealtimeController.handleRealtime`). Ce drapeau est donc la seule fenêtre
  // où un `subscribe` compte. Un booléen, remis à `false` à chaque tentative.
  private _welcomed = false;
  private reconnectAttempt = 0;
  private _nextRetryAt: number | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  // Borne de la poignée de main en cours — `null` hors ouverture.
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
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
  private _rawFrames:
    { ts: number; dir: "in" | "out"; msg: unknown; size: number }[] | null =
    null;
  // Somme des `size` du ring — tenue à jour au push/shift, jamais recalculée.
  private _rawFramesChars = 0;
  // Identité résolue + capabilities annoncées par le serveur au `realtime:welcome`
  // (cold path, 1×/connexion). `null` tant que pas reçu → lazy, 0 alloc « au cas
  // où ». Réfs brutes vers les objets du welcome (pas de copie).
  private _identity: RealtimeIdentity | null = null;
  private _serverChannels: string[] | null = null;
  private _serverMethods: string[] | null = null;

  constructor(
    private readonly opts: NodefonySocketOptions = {},
    // Fabrique de transport injectable (tests = transport mock ; défaut = WebSocket
    // navigateur). Garde NodefonySocket testable sans vrai socket.
    transportFactory?: RealtimeTransportFactory,
  ) {
    this.transportFactory =
      transportFactory ?? ((url: string) => new BrowserWsTransport(url));
    this.startStatsSampler();
    // Le diagnostic ne se compose pas (ADR-0007 D7 révisé) : une socket nue
    // annonce le framework et se rend inspectable, exactement comme le ferait un
    // noyau. Quand il y en a un, il s'est annoncé AVANT de nous fabriquer — le
    // badge porte alors son nom, et cet appel n'en émet pas un second.
    announceRealtime(this.opts.banner);
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
  static shared(opts: NodefonySocketOptions = {}): NodefonySocket {
    const key = NodefonySocket.resolveUrl(opts.url);
    const g = globalThis as { __nfRealtime__?: Map<string, NodefonySocket> };
    const map = (g.__nfRealtime__ ??= new Map<string, NodefonySocket>());
    let client = map.get(key);
    if (!client) {
      client = new NodefonySocket({ ...opts, url: key });
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
        '  Donne-la explicitement : NodefonySocket.shared({ url: "/api/live/realtime" })\n' +
        '  ou, en React : <NodefonyProvider url="/api/live/realtime">\n' +
        "  Il n'y a pas de valeur par défaut : la route dépend de ton application " +
        "(une application générée monte /api/live/realtime, la console d'administration " +
        "/nodefony/studio/api/realtime).",
    );
  }

  /** Résout une URL (relative ou absolue) en chaîne absolue stable = clé du singleton. */
  private static resolveUrl(url?: string): string {
    if (!url) throw NodefonySocket.missingUrl();
    if (typeof window === "undefined") return url;
    // Normaliser http(s)→ws(s) : une URL RELATIVE résout vers le scheme de la
    // page (https) → sinon la clé `https://…` ≠ `wss://…` → 2 instances/2 sockets.
    return toSocketUrl(url, window.location.href).toString();
  }

  get state(): RealtimeState {
    return this._state;
  }

  /**
   * Nombre de tentatives de reconnexion depuis la dernière connexion STABLE —
   * restée ouverte au moins 5 s. Une connexion éphémère ne le remet pas à zéro.
   */
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
   *
   * Se règle sur CETTE tentative : résout à l'ouverture, rejette si la socket se
   * ferme avant de s'ouvrir (refus, délai `connectTimeout` dépassé, réseau,
   * `disconnect()`). Avec `autoReconnect`, la reconnexion continue en fond après
   * un rejet — l'état se suit par {@link onState}. Un appel non attendu s'écrit
   * donc `socket.connect().catch(() => {})`, jamais `void socket.connect()`.
   *
   * @param url - adresse à utiliser à la place de celle des options.
   * @throws Error si l'adresse manque, est illisible, d'un autre schéma que
   *   `ws:`/`wss:`/`http:`/`https:`, ou porte des identifiants.
   */
  async connect(url?: string): Promise<void> {
    if (this._state === "connected" || this._state === "connecting") return;
    this.intentionalClose = false;
    this.opts.url = url ?? this.requireUrl();
    return this.openSocket();
  }

  /** L'URL configurée, ou l'échec franc — jamais une valeur devinée. */
  private requireUrl(): string {
    if (!this.opts.url) throw NodefonySocket.missingUrl();
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
    this._welcomed = false;
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
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as EventHandler);
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
    this.emit(channel, payload);
  }

  /**
   * S'abonne à un canal pub/sub serveur (**ref-compté**). Émet la notification
   * `subscribe` au serveur UNIQUEMENT au 1er consommateur du canal ; les suivants
   * ne font qu'incrémenter le compteur. Ré-émis automatiquement à chaque
   * `realtime:welcome` — jamais à la simple ouverture de la socket, où le serveur
   * le jetterait sans un mot. NE remplace PAS {@link on} : `on(channel, h)` REÇOIT les
   * messages, `subscribe(channel)` DEMANDE au serveur de les pousser.
   *
   * Autorité unique partagée par le binding `nodefony/react` ET le store Studio →
   * deux consommateurs du même canal ne se coupent plus l'un l'autre.
   */
  subscribe(channel: EventNames<Listen> | (string & {})): void {
    const c = channel;
    const n = (this._subscriptions.get(c) ?? 0) + 1;
    this._subscriptions.set(c, n);
    // Hors de la fenêtre d'écoute du serveur, l'émission serait perdue : la map
    // suffit, c'est elle que `replaySubscriptions` rejoue au welcome.
    if (n === 1 && this._welcomed) this._emitRaw("subscribe", { channel: c });
  }

  /**
   * Désabonne un consommateur d'un canal (ref-compté) : émet `unsubscribe` au
   * serveur seulement au **dernier** consommateur. No-op si le canal n'est pas suivi.
   */
  unsubscribe(channel: EventNames<Listen> | (string & {})): void {
    const c = channel;
    const cur = this._subscriptions.get(c);
    if (!cur) return;
    if (cur <= 1) {
      this._subscriptions.delete(c);
      // Avant le welcome, le serveur n'a rien enregistré : retirer l'entrée suffit.
      if (this._welcomed) this._emitRaw("unsubscribe", { channel: c });
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
  /**
   * Request/response JSON-RPC 2.0 — `Promise` résolue avec le `result`.
   *
   * Le 1ᵉʳ générique est le **nom de la méthode**, le 2ᵉ le type du résultat :
   * ```ts
   * const r = await socket.request<"nodefony:kernel:ping", { pong: boolean }>(
   *   "nodefony:kernel:ping",
   * );
   * ```
   * Quand `method` appartient au contrat `Actions`, `params` ET le résultat en
   * sont déduits — un payload hors contrat est REFUSÉ à la compilation.
   *
   * ⚠️ **Rupture 10.0.0** : la forme `request<MonType>("ma:methode")` (`<T>` =
   * résultat) n'existe plus. Elle était un attrape-tout qui rendait inopérant le
   * contrôle des `params`. La réécrire en `request<"ma:methode", MonType>`.
   */
  async request<K extends string, T = unknown>(
    method: K,
    params?: ContractParams<Actions, K>,
    timeoutMs?: number,
  ): Promise<ContractResult<Actions, K, T>>;
  /**
   * Contrat {@link IRealtimePeer} rendu EXPLICITE — `method` et `params` sont
   * tous deux bornés par le contrat `Actions`. Sans elle, la liste de surcharges
   * (qui type `params` par un conditionnel non résolu) n'est pas assignable à la
   * signature du peer et TS2416 tombe.
   */
  async request<K extends ActionNames<Actions>>(
    method: K,
    params?: ActionParams<Actions, K>,
    timeoutMs?: number,
  ): Promise<ActionResult<Actions, K>>;
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
    // `request()` rend un type CONDITIONNEL sur `Actions`, paramètre de classe
    // non résolu ici — donc inexploitable depuis l'intérieur de la classe. D'où
    // le cast, sur un contrat que le serveur garantit (`nodefony:kernel:ping`).
    // Passer par `request()` et non par le moteur est délibéré : c'est le point
    // d'extension que les tests et les décors substituent.
    const res = (await this.request<
      typeof PLATFORM_METHODS.ping,
      KernelPingResult
    >(PLATFORM_METHODS.ping, undefined, timeoutMs)) as KernelPingResult;
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
  unregister(method: ActionNames<Actions>): void {
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
   *
   * @param frame - la frame déjà parsée.
   * @param size - sa taille sérialisée (caractères), pour le budget du log protocole.
   * @returns la nature de la frame selon le moteur JSON-RPC.
   */
  receive(frame: unknown, size = 0): JsonRpcFrameKind {
    this.recordFrame("in", frame, size); // log protocole (lazy)
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
   * (Ré)émet un `subscribe` pour chaque canal ref-compté, à la réception du
   * `realtime:welcome` — le seul instant où le serveur est prêt à l'enregistrer.
   *
   * Ouvrir la socket ne suffit pas : pendant que le serveur authentifie, son
   * transport JSON-RPC n'est pas encore branché et il **jette** les frames
   * entrantes, sans pouvoir répondre — c'est le contrat écrit par
   * `RealtimeController.handleRealtime`. Rejouer sur `onOpen` revenait à parler
   * dans le vide, et perdait en silence deux cas entiers : un `subscribe` posé
   * avant `start()`, et TOUS les abonnements après une reconnexion.
   *
   * Cold path (1×/connexion) : ne parcourt que les canaux réellement suivis, et
   * n'alloue rien.
   */
  private replaySubscriptions(): void {
    this._welcomed = true;
    for (const channel of this._subscriptions.keys()) {
      this._emitRaw("subscribe", { channel });
    }
  }

  /**
   * Ingère le `realtime:welcome` : mémorise l'identité résolue + les capabilities
   * annoncées (canaux/actions découvrables) et émet `__identity__`. Tolérant à un
   * welcome partiel/legacy (champs absents → `null`). Cold path (1×/connexion).
   */
  private ingestWelcome(params: unknown): void {
    if (params === null || typeof params !== "object") return;
    this._identity = identityOf(fieldOf(params, "identity"));
    this._serverChannels = stringsOf(fieldOf(params, "channels"));
    this._serverMethods = stringsOf(fieldOf(params, "methods"));
    // Le serveur dit son mode quand il n'est pas en production : c'est ce qui
    // permet de parler dans la console d'un bundle bâti pour la production mais
    // servi par un serveur de développement, cas qu'`import.meta.env.DEV` ne
    // peut pas voir.
    const env = fieldOf(params, "env");
    noteServerEnv(typeof env === "string" ? env : undefined);
    // Détail dans la console — SEULEMENT s'il n'y a pas de noyau : quand il y en
    // a un, c'est lui qui parle, il a plus à dire (état, identité, services).
    // C'est le moment juste : avant l'accueil, il n'y aurait rien à montrer.
    if (this.opts.banner !== false && !hasKernel()) this.detailsSocket();
    this.fireLocal(LOCAL_EVENTS.identity, this._identity);
  }

  /**
   * Détail de la socket dans la console — le pendant, pour une page SANS noyau,
   * du groupe que le noyau émet quand il y en a un (#136).
   *
   * Une vitrine ne compose rien : sans ceci, elle n'a aucun endroit où lire son
   * adresse, ses canaux ou son identité, alors que c'est exactement ce qu'on
   * cherche quand une socket ne pousse rien. Émis au premier accueil, une seule
   * fois par page, et jamais en production.
   */
  private detailsSocket(): void {
    // Les MÊMES lignes que la vignette d'une page (`describeSocket`) : une
    // seule source pour ce que la socket dit d'elle-même, console ou écran.
    const rows: Record<string, { valeur: string }> = {};
    for (const row of describeSocket(socketSnapshot(this)))
      rows[row.label] = { valeur: row.value };
    consoleDetails(rows, this, "socket nodefony — détail et raccourcis");
  }

  /**
   * Ingère un `realtime:denied` (refus d'abonnement/push poussé par le serveur) :
   * émet une notice normalisée ({@link onNotice}) ET un event ciblé `__denied__`
   * ({@link onDenied}) pour une réaction polymorphe de l'app. Tolérant à un
   * payload partiel (motif par défaut `forbidden`). Cold path (refus rare).
   */
  private ingestDenied(params: unknown): void {
    const rawChannel = fieldOf(params, "channel");
    const channel = typeof rawChannel === "string" ? rawChannel : "";
    // Motif NORMALISÉ sur le contrat : un serveur plus récent (ou un pont mal
    // écrit) qui inventerait un motif ne doit pas faire tomber l'écran dans un
    // cas que personne ne traite. Repli sur `forbidden`, le motif le plus
    // prudent : il n'annonce jamais qu'un accès était possible.
    const brut = fieldOf(params, "reason");
    const reason: IRealtimeDenied["reason"] =
      brut === "unknown" || brut === "limit" ? brut : "forbidden";
    // Le DÉTAIL est repris tel quel quand le serveur en pose un — il n'existe
    // qu'hors production (`deniedDetail`, côté serveur), et il porte ce qu'il
    // faut regarder là où `reason`, générique par construction, ne dit rien.
    // Il n'est pas normalisé comme `reason` : ce n'est pas une valeur du
    // protocole que du code lit, c'est une phrase qu'un humain lit. Filtré sur
    // le TYPE seulement — une frame hostile ne doit pas glisser un objet là où
    // l'écran attend du texte.
    const rawDetail = fieldOf(params, "detail");
    const detail = typeof rawDetail === "string" ? rawDetail : undefined;
    const denied: IRealtimeDenied = {
      channel,
      reason,
      ...(detail === undefined ? {} : { detail }),
    };
    this.fireNotice(deniedToNotice(denied));
    this.fireLocal(LOCAL_EVENTS.denied, denied);
  }

  /**
   * Dispatch d'une NOTIFICATION entrante — appelé par le moteur via `onNotification`.
   * Ordre figé : ingestion welcome (1ʳᵉ frame) → stats → handlers locaux + wildcard
   * (un handler `on("realtime:welcome")` voit donc l'identité déjà ingérée).
   */
  private dispatchNotification(method: string, params: unknown): void {
    if (method === "realtime:welcome") {
      this.ingestWelcome(params);
      // HORS de `ingestWelcome`, qui sort tôt sur un welcome partiel/legacy : le
      // rejeu est dû quel que soit le contenu de la trame.
      this.replaySubscriptions();
    } else if (method === "realtime:denied") this.ingestDenied(params);
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
   * Frame `invalid` (JSON-RPC strict) portant un `error` sans `id` lisible = erreur
   * GLOBALE serveur (extension Nodefony hors spec, ex. refus tardif ; ou erreur à
   * `id: null`, §5) → notice pour le centre de notifications. Une frame qui porte
   * un `id` chaîne ou nombre est CORRÉLÉE : le pair a déjà réglé l'appel concerné,
   * une notice globale la doublerait. Frame sans `.error` → no-op.
   */
  private handleServerError(frame: unknown): void {
    // `null`, un nombre ou un tableau sont des frames `invalid` comme les autres :
    // les lire sans garde levait hors de tout `try`, jusqu'au processus.
    if (frame === null || typeof frame !== "object" || !("error" in frame))
      return;
    if ("id" in frame && isJsonRpcId(frame.id)) return;
    const err = frame.error;
    if (err === null || typeof err !== "object") return;
    const message =
      "message" in err && typeof err.message === "string" ? err.message : "";
    this.fireNotice({
      level: "error",
      title: "Temps réel",
      message: message || "Erreur serveur temps réel",
      source: "server",
      code:
        "code" in err && typeof err.code === "number" ? err.code : undefined,
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
    unrefTimer(this.statsTimer);
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
      // Nouvelle tentative = nouvelle session serveur : rien n'y est abonné tant
      // que le welcome de CETTE connexion n'est pas arrivé.
      this._welcomed = false;
      this.setState(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");
      // Un écouteur d'état a pu appeler `disconnect()` : rien ne s'ouvre après.
      if (this.intentionalClose) {
        reject(
          new Error("[nodefony] connexion temps réel annulée par disconnect()"),
        );
        return;
      }
      let transport: IRealtimeTransport;
      try {
        const url = toSocketUrl(
          this.requireUrl(),
          typeof window !== "undefined"
            ? window.location.href
            : "http://localhost",
        );
        if (this.opts.token) url.searchParams.set("token", this.opts.token);
        // Transport NEUF à chaque tentative (le précédent est clos). Le transport
        // ne sait QUE ouvrir/envoyer/fermer ; l'orchestration reste ici.
        transport = this.transportFactory(url.toString());
        this.transport = transport;
      } catch (e) {
        this.setState("error");
        reject(e instanceof Error ? e : new Error(String(e), { cause: e }));
        return;
      }
      let openedAt = 0;
      transport.onOpen(() => {
        if (this.connectTimer) clearTimeout(this.connectTimer);
        this.connectTimer = null;
        openedAt = Date.now();
        const wasReconnecting = this.reconnectAttempt > 0;
        this._nextRetryAt = null;
        this.setState("connected");
        if (this.intentionalClose) {
          resolve();
          return;
        }
        this.startHeartbeat();
        // Le rejeu des abonnements N'A PAS LIEU ICI : la socket est ouverte, mais le
        // serveur authentifie encore et jette toute frame reçue avant son welcome.
        // Il se fait à l'ingestion du `realtime:welcome` — cf `replaySubscriptions`.
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
        // Fermée avant de s'ouvrir (refus, délai, réseau) : la promesse de
        // `connect()` le dit, au lieu de rester pendante à jamais. La reconnexion,
        // elle, continue en fond.
        if (openedAt === 0) {
          reject(
            new Error(
              `[nodefony] connexion temps réel fermée avant ouverture (code ${code})`,
            ),
          );
        }
        if (this.intentionalClose) {
          this.setState("disconnected");
          return;
        }
        // Seule une connexion STABLE remet le back-off à zéro.
        if (openedAt !== 0 && Date.now() - openedAt >= STABLE_CONNECTION_MS)
          this.reconnectAttempt = 0;
        // Criticité qui casse le temps réel (RFC 6455 §7.4) → notice normalisée,
        // pendant client du `toWsCloseCode` serveur (@nodefony/http).
        const notice = closeCodeToNotice(code, reason);
        if (notice) this.fireNotice(notice);
        // Un écouteur de notice a pu appeler `disconnect()`.
        if (this.disconnectRequested()) return;
        // Respect de la SÉMANTIQUE du close code : un code DÉFINITIF (policy 1008
        // = 401/403, révocation 4001, protocole, introuvable) ne RELANCE PAS la
        // boucle de reco — sinon un anonyme martèle un endpoint protégé. L'app
        // rétablit après l'action corrective (login → `connect()`/`retryNow()`).
        // Reco réservée aux codes transitoires (perte réseau, restart, erreur serveur).
        const reconnectable = isReconnectableCloseCode(code);
        if (reconnectable && this.opts.autoReconnect !== false) {
          this.scheduleReconnect();
        } else {
          // Fatal → "error" (échec définitif, action requise) ; transitoire mais
          // autoReconnect désactivé → "disconnected".
          this.setState(reconnectable ? "disconnected" : "error");
        }
      });
      // Une poignée de main sans réponse ne laisse pas `connect()` pendue : la
      // fermer la fait échouer (1006), et la reconnexion prend le relais.
      const timeout = this.opts.connectTimeout ?? CONNECT_TIMEOUT_DEFAULT;
      if (timeout > 0) {
        this.connectTimer = setTimeout(
          () => {
            this.connectTimer = null;
            transport.close(1000, "connect timeout");
          },
          Math.min(timeout, TIMER_MAX),
        );
      }
      transport.connect();
    });
  }

  /**
   * Un `disconnect()` est-il passé ? Relu APRÈS chaque écouteur, qui a pu
   * l'appeler — un effet que le resserrement de type ne voit pas sur un champ.
   */
  private disconnectRequested(): boolean {
    return this.intentionalClose;
  }

  private scheduleReconnect(): void {
    this.reconnectAttempt++;
    const delay = reconnectDelay(
      this.reconnectAttempt,
      this.opts.reconnectDelay ?? 1000,
      this.opts.reconnectDelayMax ?? 30000,
    );
    this._nextRetryAt = Date.now() + delay;
    // Armé AVANT les écouteurs : un `disconnect()` appelé depuis l'un d'eux
    // l'annule (`clearTimers`) au lieu de passer avant lui.
    this.reconnectTimer = setTimeout(() => {
      this.openSocket().catch(() => {
        /* swallow — onclose re-déclenchera */
      });
    }, delay);
    this.setState("reconnecting");
    if (this.intentionalClose) return;
    // Event dédié → l'UI peut afficher tentative + compte à rebours live.
    this.fireLocal(LOCAL_EVENTS.reconnect, {
      attempt: this.reconnectAttempt,
      delay,
      nextRetryAt: this._nextRetryAt,
    });
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
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.connectTimer = null;
  }

  /**
   * Log protocole : les `FRAME_LOG_MAX` dernières frames JSON-RPC (redactées),
   * enregistrées EN CONTINU → la console « retrace l'instant » dès l'ouverture
   * (jamais de démarrage à vide). Construction + redaction faites ici, à la lecture.
   */
  get frameLog(): readonly RealtimeFrame[] {
    return (this._rawFrames ?? []).map((f) =>
      NodefonySocket.buildFrame(f.dir, f.msg, f.ts),
    );
  }

  /** Purge le log protocole. */
  clearFrameLog(): void {
    if (this._rawFrames) this._rawFrames.length = 0;
    this._rawFramesChars = 0;
  }

  /**
   * Enregistre une frame dans le ring — coût = 1 push de réf (construction +
   * redaction DIFFÉRÉES). Le ring est borné en nombre ET en caractères : une
   * trame démesurée n'y entre qu'en résumé, et les plus anciennes sortent tant
   * que le budget est dépassé. Émet `__frame__` (frame construite) seulement si
   * la console écoute.
   *
   * @param size - taille sérialisée de la frame (caractères), `0` si inconnue.
   */
  private recordFrame(dir: "in" | "out", msg: unknown, size: number): void {
    const ts = Date.now();
    const big = size > FRAME_LOG_ENTRY_MAX_CHARS;
    const kept = big ? frameSummary(msg, size) : msg;
    const keptSize = big ? 0 : size;
    const ring = (this._rawFrames ??= []);
    ring.push({ ts, dir, msg: kept, size: keptSize });
    this._rawFramesChars += keptSize;
    while (
      ring.length > FRAME_LOG_MAX ||
      this._rawFramesChars > FRAME_LOG_MAX_CHARS
    ) {
      const old = ring.shift();
      if (!old) break;
      this._rawFramesChars -= old.size;
    }
    const listeners = this.handlers.get("__frame__");
    if (listeners && listeners.size > 0)
      this.fireLocal("__frame__", NodefonySocket.buildFrame(dir, kept, ts));
  }

  /** Construit une frame affichable (kind/canal/id + payload redacté). */
  private static buildFrame(
    dir: "in" | "out",
    msg: unknown,
    ts: number,
  ): RealtimeFrame {
    const method = fieldOf(msg, "method");
    const id = fieldOf(msg, "id");
    let kind = "?";
    let channel: string | undefined;
    if (typeof method === "string") {
      kind = method;
      const c = fieldOf(fieldOf(msg, "params"), "channel");
      if (typeof c === "string") channel = c;
    } else if (fieldOf(msg, "error") !== undefined) kind = "error";
    else if (fieldOf(msg, "result") !== undefined) kind = "response";
    return {
      ts,
      dir,
      kind,
      id: typeof id === "number" ? id : undefined,
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
    const raw = JSON.stringify(msg);
    this.transport.send(raw);
    this.recordFrame("out", msg, raw.length);
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
    this.receive(msg, raw.length);
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

export default NodefonySocket;
