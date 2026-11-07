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
  isProbeRefusal,
  probeRefusalNotice,
  discardedFrameNotice,
  unofferedCodecNotice,
  rawBinaryUnderCodecNotice,
} from "./notice";
import { createIdempotencyKey } from "../../realtime/idempotencyKey";
import { fillRoutePath } from "../../runtime/routePath";
import {
  JsonRpcPeer,
  type IRealtimePeer,
  type JsonRpcFrameKind,
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
  type RealtimeFrameData,
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
  IRealtimeSubscribed,
  IRealtimeClosed,
  TypedRpcActionHandler,
  ContractParams,
  ContractResult,
  IRealtimeContract,
  ContractClientEmit,
  ContractClientListen,
  ContractClientActions,
  ContractClientRoutes,
  BridgeVerb,
  RoutesMap,
  ContractRouteBody,
  ContractRouteQuery,
  ContractRouteParams,
  ContractRouteResult,
} from "../../realtime/RealtimeEventMap";
import { unrefTimer } from "../../runtime/unrefTimer";
import { ownField } from "../../runtime/ownField";
import { CircularBuffer } from "../../runtime/CircularBuffer";
import { BrowserWsTransport } from "./BrowserWsTransport";
import { describeSocket, socketSnapshot } from "./snapshot";
import {
  announceRealtime,
  hasKernel,
  consoleDetails,
  isDevBuild,
  isVerbose,
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
  RealtimeDeniedReason,
  IRealtimeSubscribed,
  IRealtimeClosed,
  RealtimeClosedReason,
  IRealtimeContract,
  Jsonify,
  ContractClientEmit,
  ContractClientListen,
  ContractClientActions,
  ContractClientRoutes,
  BridgeVerb,
  IContractRoute,
  RoutesMap,
  ContractRouteBody,
  ContractRouteQuery,
  ContractRouteParams,
  ContractRouteResult,
  RoutePathParamNames,
} from "../../realtime/RealtimeEventMap";
import { PLATFORM_METHODS } from "../../realtime/platformChannels";
import {
  userChannel,
  type UserChannelPayload,
} from "../../realtime/userChannel";
import { isJsonRpcId, jsonRpcNotification } from "../../jsonrpc/index";
import {
  binaryPayloadLabel,
  isRealtimePayload,
  realtimePayloadError,
} from "../../realtime/payload";
import type { IFrameCodec } from "../../realtime/IFrameCodec";
import {
  adoptFrameCodec,
  frameCodecSet,
  type IFrameCodecSet,
} from "../../realtime/frameCodecNegotiation";
import {
  decideBackpressure,
  nextDropBalance,
} from "../../realtime/backpressure";
import { BACKPRESSURE_CLOSE_CODE } from "../../realtime/closeCodes";

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
   * Sonde d'un échec d'ouverture. Le navigateur cache le statut d'un handshake
   * refusé : le code ne voit qu'un `1006`, le même qu'un serveur éteint. Avant
   * de retenter, le client demande donc au serveur, par une requête HTTP sur la
   * même adresse, ce que le handshake aurait décidé — 401/403/404 : refus
   * définitif (état `error`, pas de reconnexion) ; 426 : admis, le serveur est
   * là ; aucune réponse : serveur absent. Les deux derniers retentent. Défaut :
   * `fetch` (cookies inclus, jeton en `Authorization`) ; `false` désactive la
   * sonde — tout échec d'ouverture redevient une panne à retenter.
   */
  probe?: RealtimeProbe | false | undefined;
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
  /**
   * Seuil (octets) de la file d'envoi du navigateur (`WebSocket.bufferedAmount`)
   * au-delà duquel une frame sortante est JETÉE au lieu d'être mise en file —
   * `emit`, `request` et `sendBinary` rendent alors `false` et la frame est
   * comptée dans {@link NodefonySocket.framesDropped}. Pour un émetteur qui
   * produit plus vite que le réseau n'écoule (positions d'un jeu, mesures d'un
   * capteur) : une donnée périmée jetée vaut mieux qu'une file qui grossit.
   * `0`/absent = désactivé (défaut de la série 10).
   */
  maxBufferedAmount?: number | undefined;
  /**
   * Solde de frames jetées (+1 par frame jetée, −1 par frame partie) au-delà
   * duquel le client FERME sa socket en `4007` (`BACKPRESSURE_CLOSE_CODE`) puis
   * se reconnecte comme après toute coupure : une file qui ne se vide plus est
   * une connexion morte. Sans effet sans {@link maxBufferedAmount}. `0` = ne
   * jamais fermer. Défaut `1000`, comme `backpressureCloseAfterDrops` du serveur.
   */
  backpressureCloseAfterDrops?: number | undefined;
  /**
   * Codec BINAIRE à offrir au serveur — `CBOR_FRAME_CODEC`, importé de
   * `nodefony/cbor` (ADR-0022 §2). Absent : aucune offre, JSON-RPC texte, le
   * fil d'avant #618 octet pour octet — sauf si l'accueil annonce `bytes` :
   * le serveur émet alors la convention d'octets, et la socket la relit en
   * `Uint8Array` sans rien importer de plus.
   *
   * Le client offre le sous-protocole du codec, puis `nodefony.jsonrpc.v1` ; le
   * serveur choisit et annonce son choix dans `realtime:welcome` — jamais dans
   * l'écho du handshake. Retenu, le codec porte toutes les frames qui suivent
   * l'accueil, dans les deux sens, et une charge qui est ou contient un
   * `Uint8Array` arrive à `on(canal)` en `Uint8Array`, sans base64. Non
   * retenu (serveur sans ce codec), la connexion reste en texte, convention
   * `{"$bytes": …}` armée pour les octets.
   *
   * Le codec ne pèse que sur la page qui l'importe : `nodefony/client` ne
   * contient que le codec JSON. Un codec dont le sous-protocole est
   * `nodefony.jsonrpc.v1` n'est pas offert : il remplace le codec texte.
   *
   * @example
   * ```ts
   * import { CBOR_FRAME_CODEC } from "nodefony/cbor";
   * const socket = new NodefonySocket({ url: "/realtime", codec: CBOR_FRAME_CODEC });
   * ```
   */
  codec?: IFrameCodec | undefined;
}

/**
 * Options de {@link NodefonySocket.fromContract} : celles du constructeur, plus le
 * choix de la socket PARTAGÉE de la page.
 */
export interface FromContractOptions extends NodefonySocketOptions {
  /**
   * Rendre la socket partagée de la page pour cette adresse ({@link NodefonySocket.shared}),
   * vue à travers le contrat, au lieu d'en fabriquer une neuve. Une seule connexion par
   * adresse : la barre de debug, ou tout autre consommateur de la même URL, parle sur la
   * même socket. Défaut : `false` (socket neuve, privée à l'appelant).
   */
  shared?: boolean | undefined;
}

/** Solde de frames jetées qui ferme la socket, faute de `backpressureCloseAfterDrops`. */
const BACKPRESSURE_CLOSE_AFTER_DEFAULT = 1000;

/**
 * Sonde d'un échec d'ouverture : rend le statut HTTP de l'adresse de la socket
 * (`http:`/`https:`), ou `null` quand le serveur ne répond pas.
 */
export type RealtimeProbe = (
  url: string,
  token: string | null,
) => Promise<number | null>;

/**
 * Stats d'un canal — alias historique de {@link IChannelStats} (le contrat isomorphe
 * `IRealtimeSocket`). Conservé pour les consommateurs qui importent `MessageStats`.
 */
export type MessageStats = IChannelStats;

/**
 * Compteurs du fil d'une socket : trames et tailles dans chaque sens, temps passé à
 * décoder. Cumulés depuis le premier appel de {@link NodefonySocket.wireStats} — un
 * débit ou une moyenne se calcule par différence entre deux lectures.
 *
 * La taille suit la convention du journal protocole : caractères d'une trame texte,
 * octets d'une trame binaire.
 */
export interface IWireStats {
  /** Trames reçues puis décodées par le codec de la connexion. */
  framesIn: number;
  /** Trames écrites sur le transport. */
  framesOut: number;
  /** Taille cumulée des trames reçues. */
  sizeIn: number;
  /** Taille cumulée des trames écrites. */
  sizeOut: number;
  /** Trames binaires parmi les reçues. */
  binaryIn: number;
  /** Trames binaires parmi les écrites. */
  binaryOut: number;
  /** Temps cumulé passé à décoder les trames reçues, en millisecondes. */
  decodeMs: number;
}

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
  /**
   * Payload affichable — champs sensibles **redactés** (token/secret…), octets
   * résumés en `[binary N B]` (jamais vidés).
   */
  payload: unknown;
  /** Taille sur le fil : caractères d'une trame texte, octets d'une trame binaire ; `0` si inconnue. */
  size: number;
  /** Trame binaire (codec binaire de la connexion), sinon trame texte. */
  binary: boolean;
}

/** Taille max du ring du log protocole (inspecteur realtime). */
const FRAME_LOG_MAX = 300;

/**
 * Budget du log protocole, en unités du fil (caractères d'une trame texte, octets
 * d'une trame binaire). Le compte de trames seul ne borne rien : 300 trames de
 * 2 Mo retenaient 80 Mo choisis par le serveur.
 */
const FRAME_LOG_MAX_CHARS = 2 * 1024 * 1024;

/** Au-delà (mêmes unités), une trame n'est journalisée qu'en résumé (méthode, id, canal, taille). */

/** Une entrée du journal protocole : la RÉF brute, la construction est différée. */
interface IFrameLogEntry {
  ts: number;
  dir: "in" | "out";
  /** La frame décodée, ou son résumé si elle dépasse {@link FRAME_LOG_ENTRY_MAX_CHARS}. */
  msg: unknown;
  /** Taille sur le fil (caractères ou octets). */
  size: number;
  binary: boolean;
}

/**
 * Ce qu'une entrée retient du budget : sa taille, ou rien quand seul son résumé
 * est gardé — dérivé, donc jamais stocké.
 */
function frameLogCost(size: number): number {
  return size > FRAME_LOG_ENTRY_MAX_CHARS ? 0 : size;
}
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
 * Réessais d'un abonnement refusé `unavailable` (ADR-0021 §S10 bis point 3) :
 * trois au plus, recul exponentiel à gigue COMPLÈTE depuis 1 s — fenêtres
 * [0, 1 s[, [0, 2 s[, [0, 4 s[. La gigue complète étale dans toute la fenêtre
 * les milliers d'abonnés refusés au même instant par une base saturée : une
 * gigue partielle les ferait revenir ensemble.
 */
const ADMISSION_RETRY_MAX = 3;
const ADMISSION_RETRY_BASE_MS = 1000;

/** Un réessai d'admission programmé pour un canal. */
interface IAdmissionRetry {
  /** Réessais déjà programmés pour ce canal (1 à {@link ADMISSION_RETRY_MAX}). */
  readonly attempt: number;
  readonly timer: ReturnType<typeof setTimeout>;
}

/**
 * Délai du réessai `attempt` (0 = le premier) d'un abonnement `unavailable` : gigue complète sur la fenêtre, APRÈS le délai que le serveur impose s'il en pose un.
 *
 * @param attempt - réessais déjà faits pour ce canal.
 * @param retryAfterMs - délai minimal annoncé par le serveur (coupe-circuit),
 *   déjà validé fini et positif par l'appelant.
 * @returns un délai entier dans `[0, TIMER_MAX]`.
 */
function admissionRetryDelay(
  attempt: number,
  retryAfterMs: number | undefined,
): number {
  const jitter = Math.random() * ADMISSION_RETRY_BASE_MS * 2 ** attempt;
  return Math.min(Math.round((retryAfterMs ?? 0) + jitter), TIMER_MAX);
}

/**
 * Durée d'ouverture (ms) au-delà de laquelle une connexion compte comme STABLE et
 * remet le back-off à zéro. Un serveur qui accepte puis coupe aussitôt ne le remet
 * donc jamais : il est ménagé de plus en plus, au lieu d'être sondé à cadence fixe.
 */
const STABLE_CONNECTION_MS = 5000;

/** Délai d'ouverture par défaut (ms) — cf {@link NodefonySocketOptions.connectTimeout}. */
const CONNECT_TIMEOUT_DEFAULT = 10_000;
/** Borne de la sonde d'un échec d'ouverture (ms). */
const PROBE_TIMEOUT_MS = 5000;

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
 * Adresse HTTP de la sonde : la même que la socket, en `http:`/`https:`, sans
 * le jeton dans la requête — il voyage en en-tête (RFC 6750 §2.1).
 *
 * @param url - adresse `ws:`/`wss:` de la tentative
 * @returns l'adresse à sonder
 */
function toProbeUrl(url: URL): string {
  const u = new URL(url);
  u.protocol = u.protocol === "wss:" ? "https:" : "http:";
  u.searchParams.delete("token");
  return u.toString();
}

/**
 * Sonde par défaut : `fetch` sur l'adresse, cookies inclus (la session BFF),
 * jeton en `Authorization`, sans suivre une redirection (une porte d'entrée
 * `302` n'est pas un verdict). Rend le statut, ou `null` sans réponse.
 */
async function fetchProbe(
  url: string,
  token: string | null,
): Promise<number | null> {
  if (typeof fetch !== "function") return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
      ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
    });
    return res.status;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Résumé journalisable d'une trame démesurée : méthode, id, canal et taille,
 * jamais la charge. Garde les clés `result`/`error` pour que le log en lise la
 * nature.
 */
function frameSummary(
  msg: unknown,
  size: number,
  binary: boolean,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    truncated: `${size} ${binary ? "octets" : "caractères"} — charge non journalisée`,
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
  if (value === null || typeof value !== "object") return value;
  // AVANT la borne de profondeur et avant `Object.entries` : une vue de 64 Ko
  // énumérée rendrait 65 536 entrées. La taille suffit au journal.
  if (ArrayBuffer.isView(value)) return binaryPayloadLabel(value.byteLength);
  if (value instanceof ArrayBuffer) return binaryPayloadLabel(value.byteLength);
  if (depth > 4) return value;
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
/** La charge d'un acquittement `realtime:subscribed` a-t-elle sa forme ? */
function isSubscribedAck(value: unknown): value is IRealtimeSubscribed {
  return typeof ownField(value, "channel") === "string";
}

/** Une attente `whenSubscribed` en cours : ses deux issues. */
interface IAckWaiter {
  resolve: () => void;
  reject: (e: Error) => void;
}

// Messages de rejet de `whenSubscribed` — fonctions du MODULE, pas des fermetures :
// rien n'est alloué tant qu'aucune attente n'est à rejeter.
const unsubscribedBeforeAck = (channel: string): string =>
  `[nodefony] abonnement à « ${channel} » rendu (unsubscribe) avant son acquittement`;
const deniedBeforeAck = (channel: string): string =>
  `[nodefony] abonnement à « ${channel} » refusé par le serveur`;
const closedBeforeAck = (channel: string): string =>
  `[nodefony] abonnement à « ${channel} » terminé par le serveur`;

/** La charge d'une fin `realtime:closed` a-t-elle sa forme ? */
function isClosedNotice(value: unknown): value is IRealtimeClosed {
  const reason = ownField(value, "reason");
  return (
    typeof ownField(value, "channel") === "string" &&
    (reason === "ended" || reason === "evicted")
  );
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
  const type = ownField(value, "type");
  const authenticated = ownField(value, "authenticated");
  const rawId = ownField(value, "id");
  // ABSENT = un serveur antérieur à l'identité d'admission (≤ 10.0.0-beta.5),
  // rencontré pendant un déploiement progressif : même sens que `null`, que le
  // serveur courant envoie pour un jeton sans identité d'admission — aucun
  // canal personnel. PRÉSENT mais mal typé : refusé ci-dessous.
  const id = rawId === undefined ? null : rawId;
  const userIdentifier = ownField(value, "userIdentifier");
  const roles = ownField(value, "roles");
  const scopes = ownField(value, "scopes");
  if (
    typeof type !== "string" ||
    typeof authenticated !== "boolean" ||
    // `id` vaut une chaîne ou `null`, jamais `undefined` : un canal personnel
    // `user:${id}` ne peut pas devenir `user:undefined`.
    (id !== null && typeof id !== "string") ||
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
    id,
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

/** Options d'une lecture par le pont (`get`). */
export interface IBridgeReadOptions<Q = unknown, PR = unknown> {
  /**
   * Query, sérialisée dans le chemin (`?a=1&b=2`, une clé répétée par élément
   * d'un tableau). Valeurs scalaires seulement ; `undefined`/`null` omis.
   */
  query?: Q;
  /**
   * Valeurs des variables du gabarit (`/chat/messages/{id}` → `{ id }`), chacune
   * encodée pour tenir dans UN segment. Une variable sans valeur, ou une valeur
   * vide, `.` ou `..`, est refusée avant l'envoi (`TypeError`).
   */
  params?: PR;
  /** Délai avant rejet, en ms (défaut 30 s). */
  timeoutMs?: number;
}

/** Options d'une écriture par le pont (`post`, `put`, `patch`, `delete`). */
export interface IBridgeWriteOptions<
  Q = unknown,
  PR = unknown,
> extends IBridgeReadOptions<Q, PR> {
  /**
   * Clé d'idempotence — générée par défaut, une par appel. À fournir pour
   * dédoublonner une INTENTION (double clic : même clé pour deux appels), ou
   * pour réutiliser la clé d'un repli HTTP.
   */
  idempotencyKey?: string;
}

/** Ce que porte `call` : méthode logique (défaut `GET`), corps, clé, délai. */
interface ICallInit {
  method?: BridgeVerb;
  body?: unknown;
  idempotencyKey?: string;
  timeoutMs?: number;
}

/** Paramètres de la trame `api.request` — la forme que le serveur lit. */
interface IBridgeRequestParams {
  path: string;
  method?: BridgeVerb | undefined;
  body?: unknown;
  idempotencyKey?: string | undefined;
}

/** Le pont vu comme une action JSON-RPC : la seule que la socket appelle hors contrat. */
type BridgeActions = {
  "api.request": { in: IBridgeRequestParams; out: unknown };
};

/** `true` quand une valeur DOIT être fournie (un champ exigé, au moins). */
type MustProvide<V> = undefined extends V ? false : {} extends V ? false : true;

/** Les champs d'options que la route exige : la query, les paramètres de chemin. */
type ProvidedFields<Q, PR> = (MustProvide<Q> extends true
  ? { query: Q }
  : unknown) &
  (MustProvide<PR> extends true ? { params: PR } : unknown);

/**
 * Arguments d'une lecture : `options` devient OBLIGATOIRE quand la query ou les
 * paramètres de chemin de la route exigent une valeur.
 */
type BridgeReadArgs<Q, PR> = true extends MustProvide<Q> | MustProvide<PR>
  ? [options: IBridgeReadOptions<Q, PR> & ProvidedFields<Q, PR>]
  : [options?: IBridgeReadOptions<Q, PR>];

/**
 * Arguments d'une écriture : le corps est OBLIGATOIRE quand le schéma de la
 * route l'exige, absent quand la route déclarée n'en a pas, libre hors contrat ;
 * `options` devient obligatoire quand le gabarit porte des variables — le corps
 * se passe alors en clair, `undefined` s'il n'y en a pas.
 */
type BridgeWriteArgs<R extends RoutesMap, K extends string, P extends string> =
  true extends MustProvide<ContractRouteParams<R, K, P>>
    ? [
        body: ContractRouteBody<R, K>,
        options: IBridgeWriteOptions<
          ContractRouteQuery<R, K>,
          ContractRouteParams<R, K, P>
        > & { params: ContractRouteParams<R, K, P> },
      ]
    : undefined extends ContractRouteBody<R, K>
      ? [
          body?: ContractRouteBody<R, K>,
          options?: IBridgeWriteOptions<
            ContractRouteQuery<R, K>,
            ContractRouteParams<R, K, P>
          >,
        ]
      : [
          body: ContractRouteBody<R, K>,
          options?: IBridgeWriteOptions<
            ContractRouteQuery<R, K>,
            ContractRouteParams<R, K, P>
          >,
        ];

/** Ajoute une query au chemin — scalaires seulement, `undefined`/`null` omis. */
function withQuery(path: string, query: unknown): string {
  if (query === null || typeof query !== "object") return path;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    const items: unknown[] = Array.isArray(value) ? value : [value];
    for (const item of items) {
      if (item === undefined || item === null) continue;
      if (
        typeof item !== "string" &&
        typeof item !== "number" &&
        typeof item !== "boolean"
      ) {
        throw new TypeError(
          `query « ${key} » : seules les valeurs scalaires voyagent dans un chemin`,
        );
      }
      search.append(key, String(item));
    }
  }
  const qs = search.toString();
  if (qs === "") return path;
  return `${path}${path.includes("?") ? "&" : "?"}${qs}`;
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
 * @typeParam Routes - routes du pont appelables par `get`/`post`/`put`/`patch`/`delete`.
 */
export class NodefonySocket<
  Emit extends EventsMap = DefaultEventsMap,
  Listen extends EventsMap = DefaultEventsMap,
  Actions extends ActionsMap = DefaultActionsMap,
  Routes extends RoutesMap = RoutesMap,
>
  implements IRealtimeSocket<Emit, Listen>, IRealtimePeer<Emit, Actions>
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
  // tant qu'aucune requête sortante / action exposée). Le CODEC de la connexion vit
  // dans le peer (ADR-0022 §4) : il encode ses émissions, le client admet puis
  // écrit. `admitFrame`/`writeFrame` sont déréférencés à chaque frame (pas
  // `.bind`) → un test qui les remplace reste intercepté.
  // Le peer est tenu SANS les génériques de la socket : ce champ privé est
  // comparé quand on range une socket dans une autre, et ses gestionnaires
  // (`onNotification`, `beforeDispatch`) rendraient la socket INVARIANTE —
  // une socket typée par contrat serait refusée partout où l'on attend une
  // socket nue (Provider, plugin, `connectShared`). Le contrat est porté par
  // les signatures publiques de la classe, qui seules le promettent.
  private readonly peer: JsonRpcPeer<EventsMap, EventsMap, ActionsMap> =
    new JsonRpcPeer<EventsMap, EventsMap, ActionsMap>({
      admit: () => this.admitFrame(),
      write: (data, frame) => this.writeFrame(data, frame),
      onNotification: (method, params) =>
        this.dispatchNotification(method, params),
    });
  private readonly handlers = new Map<string, Set<RealtimeHandler>>();
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
  // Le serveur de CETTE connexion acquitte-t-il les abonnements ? Annoncé au
  // welcome (`subscriptionAcks`) ; sans l'annonce, un abonnement est réputé
  // actif dès son rejeu — attendre un acquittement qui ne viendra pas
  // suspendrait `whenSubscribed` pour toujours.
  private _subscriptionAcks = false;
  // Canaux acquittés sur la connexion COURANTE — lazy, remis à `null` à chaque
  // tentative : un acquittement ne survit pas à la socket qui l'a reçu.
  private _acked: Set<string> | null = null;
  // Attentes `whenSubscribed` en cours, par canal — lazy (0 alloc tant que
  // personne n'attend). Elles TRAVERSENT une reconnexion : le rejeu des
  // abonnements y appelle un nouvel acquittement.
  private _ackWaiters: Map<string, IAckWaiter[]> | null = null;
  // Réessais d'admission en cours, par canal — lazy (`null` tant qu'aucun
  // `unavailable` n'est reçu, le cas de presque toutes les connexions).
  // `Map` : quelques entrées, posées et retirées au fil des refus.
  private _admissionRetries: Map<string, IAdmissionRetry> | null = null;
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
  /** Frames jetées par la contre-pression (`maxBufferedAmount`), cumul. */
  private _framesDropped = 0;
  /** Solde de refus de la connexion courante — remis à zéro à chaque transport. */
  private _dropBalance = 0;
  // Trames entrantes ÉCARTÉES (#451) — jamais en silence : la première de chaque
  // nature émet une notice, les suivantes se comptent.
  private _binaryFramesDiscarded = 0;
  private _malformedFramesDiscarded = 0;
  // Lecteurs du flux binaire (`onBinary`) — alloué au premier abonné seulement :
  // la très grande majorité des sockets ne reçoit jamais de binaire.
  private _binaryHandlers: Set<(data: Uint8Array<ArrayBuffer>) => void> | null =
    null;
  // Les codecs de CETTE socket, fixés une fois par la règle partagée avec le
  // serveur (`frameCodecSet`) : texte, binaire offert, offre de sous-protocoles.
  // Réassignés une seule fois au plus, avant toute connexion (`adoptRequestedCodec`).
  private codecs: IFrameCodecSet;
  // Compteurs du fil, `null` tant que personne ne les lit (`wireStats`) : la trame ne
  // paie alors qu'un test.
  private _wire: IWireStats | null = null;
  // Flux binaire brut refusé sous codec binaire : déjà signalé sur CETTE connexion.
  private _rawBinaryNoticed = false;
  // Vaut `true` tant qu'on ne s'est jamais connecté : une frame émise avant la
  // première connexion est un séquencement d'application, pas une coupure — la
  // signaler comme telle serait un faux avertissement. Remis à `false` à chaque
  // passage en `connected` → une notice par ÉPISODE de coupure, jamais par frame.
  private _unsentNotified = true;
  private _lastFrameAt: number | null = null;
  private _lastFrameMethod: string | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private readonly _prevSampled = new Map<string, number>();
  // Log protocole (inspecteur realtime) : une RÉF brute par trame, construction et
  // redaction DIFFÉRÉES à la lecture (`frameLog`) ou au live (`LOCAL_EVENTS.frame`).
  // Anneau O(1) (`CircularBuffer`, le seul du dépôt) : un `Array.shift()` y
  // recopiait jusqu'à FRAME_LOG_MAX cases à CHAQUE trame une fois plein.
  private _rawFrames: CircularBuffer<IFrameLogEntry> | null = null;
  // Le journal est-il ALLUMÉ ? En développement (bundle dev, ou serveur qui annonce
  // un mode hors production), dès l'ouverture : la console « retrace l'instant ».
  // En production, éteint — coût NUL par trame — jusqu'à ce qu'une console le
  // demande (lecture de `frameLog`, écouteur `LOCAL_EVENTS.frame`).
  private _frameLogOn = isDevBuild();
  // Depuis QUAND il retient (ms epoch) — `null` tant qu'il est éteint. Ce qui
  // précède n'y est pas : un écran qui l'affiche doit pouvoir le dire.
  private _frameLogSince: number | null = this._frameLogOn ? Date.now() : null;
  // Somme des coûts du ring (`frameLogCost`) — tenue à jour au push/shift,
  // jamais recalculée.
  private _rawFramesChars = 0;
  // Horodatage de la trame entrante en cours d'ingestion : UN `Date.now()` par
  // trame, partagé par le journal et les statistiques.
  private _inboundAt = 0;
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
      transportFactory ??
      ((url: string, protocols?: readonly string[]) =>
        new BrowserWsTransport(url, protocols));
    // Une fois par socket, jamais par trame : qui est le texte, qui est offert.
    this.codecs = frameCodecSet(opts.codec);
    this.peer.codec = this.codecs.text;
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
    } else if (
      opts.codec !== undefined &&
      opts.codec !== client.opts.codec &&
      // Les options ne s'appliquent qu'à la création — sauf le codec tant qu'aucune
      // connexion n'est ouverte : il ne se négocie qu'au handshake, rien n'est encore
      // décidé. Cas courant : la barre de debug crée la socket partagée avant que
      // l'application ne demande le sien.
      !client.adoptRequestedCodec(opts.codec) &&
      isVerbose()
    ) {
      // Connexion déjà ouverte : le codec serait ignoré EN SILENCE, et la page
      // croirait parler binaire.
      console.warn(
        `[nodefony] ${key} : codec « ${opts.codec.protocol} » ignoré, la socket partagée est déjà connectée — le passer à sa création, ou avant la connexion`,
      );
    }
    return client;
  }

  /**
   * Socket typée par le contrat de l'application — la porte du client.
   *
   * L'application déclare UN contrat ({@link IRealtimeContract}) ; cette porte en
   * dérive les trois génériques dans la direction du client : il émet
   * `clientToServer`, reçoit `serverToClient` lu par `Jsonify`, appelle
   * `serverMethods` et implémente `clientMethods`. L'inversion émission/écoute
   * n'est jamais écrite à la main. Rien de plus qu'un `new` typé : aucune
   * allocation supplémentaire, et le fichier du contrat, fait de types seuls,
   * n'ajoute aucun octet au paquet du navigateur.
   *
   * @typeParam C - le contrat de l'application.
   * @param opts - options de connexion, comme pour le constructeur ; `shared: true`
   *   rend la socket partagée de la page pour cette adresse.
   * @param transportFactory - fabrique de transport (tests), comme pour le constructeur.
   * @returns une socket typée par le contrat — neuve, ou la socket partagée.
   * @throws TypeError si `shared` est demandé avec une fabrique de transport.
   *
   * @example
   * ```ts
   * const socket = NodefonySocket.fromContract<ChatContract>({ url: "/chat" });
   * socket.on("chat:room", (m) => m.text);
   * // la socket de la page, celle que partagent tous les consommateurs de l'adresse :
   * const page = NodefonySocket.fromContract<ChatContract>({ url: "/chat", shared: true });
   * ```
   */
  static fromContract<C extends IRealtimeContract>(
    opts: FromContractOptions = {},
    transportFactory?: RealtimeTransportFactory,
  ): NodefonySocket<
    ContractClientEmit<C>,
    ContractClientListen<C>,
    ContractClientActions<C>,
    ContractClientRoutes<C>
  > {
    const { shared, ...socketOpts } = opts;
    if (shared === true) {
      if (transportFactory) {
        throw new TypeError(
          "NodefonySocket.fromContract() : `shared` rend la socket de la page, qui a déjà son transport — ne pas passer de fabrique.",
        );
      }
      // La SEULE conversion de la porte : le registre de la page est une `Map` qui ne
      // peut pas porter le contrat de chacune de ses entrées. C'est le même objet,
      // et les génériques sont effacés à la compilation — le contrat ne fait que
      // décrire ce que l'application a déclaré, comme pour une socket neuve.
      return NodefonySocket.shared(socketOpts) as NodefonySocket<
        ContractClientEmit<C>,
        ContractClientListen<C>,
        ContractClientActions<C>,
        ContractClientRoutes<C>
      >;
    }
    return new NodefonySocket<
      ContractClientEmit<C>,
      ContractClientListen<C>,
      ContractClientActions<C>,
      ContractClientRoutes<C>
    >(socketOpts, transportFactory);
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
        "(`create controller live --kind realtime` monte /api/live/realtime, la console d'administration " +
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
   * ferme avant de s'ouvrir (délai `connectTimeout` dépassé, réseau,
   * `disconnect()`). Avec `autoReconnect`, la reconnexion continue en fond après
   * un rejet — l'état se suit par {@link onState}. Un appel non attendu s'écrit
   * donc `socket.connect().catch(() => {})`, jamais `void socket.connect()`.
   *
   * **Rejette si la connexion est refusée.** Le serveur juge le handshake AVANT
   * de l'accepter (pare-feu, origine, gardes) : un anonyme sur une zone protégée
   * voit `connect()` REJETER — jamais une socket ouverte puis fermée. Le
   * navigateur cachant le statut du refus, le client le demande au serveur
   * (option `probe`) et pose l'état `"error"` (définitif — pas de reconnexion),
   * lisible par {@link onState} et {@link onNotice} ; une panne, elle, retente
   * en fond. Une connexion ACCEPTÉE se confirme au welcome ({@link identity}).
   *
   * @param url - adresse à utiliser à la place de celle des options.
   * @throws Error si l'adresse manque, est illisible, d'un autre schéma que
   *   `ws:`/`wss:`/`http:`/`https:`, ou porte des identifiants.
   */
  async connect(url?: string): Promise<void> {
    // « connecting » SANS transport = la sonde d'un échec court : un connect()
    // (ex. après login) ne doit pas se perdre dans ce court-circuit.
    if (
      this._state === "connected" ||
      (this._state === "connecting" && this.transport !== null)
    )
      return;
    this.intentionalClose = false;
    this.opts.url = url ?? this.requireUrl();
    // Échantillonneur armé à la connexion, coupé par `disconnect()` : armé dans
    // le constructeur, un intervalle jamais arrêté retenait l'instance (et
    // allouait chaque seconde) pour la vie du processus.
    this.startStatsSampler();
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
    if (this.statsTimer !== null) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
    this.transport?.close(1000, "client disconnect");
    // Logout = on annule les requêtes sortantes en vol (rejet immédiat plutôt que
    // timeout). Le peer reste réutilisable (un `connect()` ultérieur repart propre).
    this.peer.dispose("client disconnect");
    // Déconnexion VOLONTAIRE (ex. logout) → l'identité n'est plus valable. Une
    // perte RÉSEAU (onClose non intentionnel) garde la dernière identité jusqu'au
    // prochain welcome → évite un flash login pendant une micro-reconnexion.
    this._welcomed = false;
    this._subscriptionAcks = false;
    this._acked = null;
    const waiters = this._ackWaiters;
    if (waiters !== null) {
      this._ackWaiters = null;
      const error = new Error(
        "[nodefony] connexion temps réel fermée par disconnect()",
      );
      for (const list of waiters.values())
        for (const w of list) w.reject(error);
    }
    this._identity = null;
    this._serverChannels = null;
    this._serverMethods = null;
    this.peer.codec = this.codecs.text;
    this.fireLocal(LOCAL_EVENTS.identity, null);
    this.setState("disconnected");
  }

  /**
   * Adopte le codec que l'accueil annonce (ADR-0022 §2) — chemin froid, une fois
   * par connexion. Absent ou `nodefony.jsonrpc.v1` : le texte. Celui qu'on a
   * offert : il porte toutes les frames qui suivent. Un autre : faute du serveur,
   * dite par une notice, et la connexion reste en texte. En texte, le champ `bytes`
   * fait prendre le JSON à convention d'octets.
   */
  private adoptCodec(announced: unknown, bytesMarker: unknown): void {
    const adopted = adoptFrameCodec(this.codecs, announced, bytesMarker);
    if (adopted !== null) {
      this.peer.codec = adopted;
      if (adopted === this.codecs.binary && this._binaryHandlers !== null)
        this.noticeRawBinary();
      return;
    }
    this.peer.codec = this.codecs.text;
    this.fireNotice(
      unofferedCodecNotice(
        typeof announced === "string" ? announced : typeof announced,
      ),
    );
  }

  /** Signale, une fois par connexion, le flux brut refusé sous codec binaire. */
  private noticeRawBinary(): void {
    if (this._rawBinaryNoticed) return;
    this._rawBinaryNoticed = true;
    this.fireNotice(rawBinaryUnderCodecNotice(this.peer.codec.protocol));
  }

  /** Pub/sub local — handler sur un event server-pushed (notification JSON-RPC). */
  on<K extends string>(
    event: K,
    handler: K extends EventNames<Listen>
      ? (payload: EventPayload<Listen, K>) => void
      : RealtimeHandler,
  ): () => void {
    // Une console qui écoute le journal l'allume (éteint en production).
    if (event === LOCAL_EVENTS.frame) this.startFrameLog();
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
    return () => this.off(event, handler);
  }

  off<K extends string>(
    event: K,
    handler: K extends EventNames<Listen>
      ? (payload: EventPayload<Listen, K>) => void
      : RealtimeHandler,
  ): void {
    this.handlers.get(event)?.delete(handler);
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
   * S'abonne aux **acquittements d'abonnement** poussés par le serveur
   * (`realtime:subscribed`) : le canal est désormais actif sur la connexion
   * courante. Rappelé à chaque (re)connexion, puisque chaque socket neuve
   * rejoue ses abonnements. Event LOCAL `__subscribed__`.
   *
   * @param handler - reçoit `{ channel }`.
   * @returns dispose (désabonnement).
   */
  onSubscribed(handler: (ack: IRealtimeSubscribed) => void): () => void {
    // Une garde plutôt qu'une conversion : la table locale porte des charges
    // `unknown`, et la forme se VÉRIFIE avant d'atteindre le handler.
    const wrapped: RealtimeHandler = (ack) => {
      if (isSubscribedAck(ack)) handler(ack);
    };
    let set = this.handlers.get(LOCAL_EVENTS.subscribed);
    if (!set) {
      set = new Set();
      this.handlers.set(LOCAL_EVENTS.subscribed, set);
    }
    set.add(wrapped);
    return () => {
      this.handlers.get(LOCAL_EVENTS.subscribed)?.delete(wrapped);
    };
  }

  /**
   * S'abonne aux **fins d'abonnement** décidées par le serveur (`realtime:closed`) :
   * le canal est terminé pour tous (`ended`), ou cette connexion en a été retirée
   * (`evicted`). Le client a déjà retiré l'abonnement — il ne le rejouera pas à la
   * reconnexion — et rejeté les `whenSubscribed` en cours ; le handler n'a plus
   * qu'à le dire à l'écran. Event LOCAL `__closed__`.
   *
   * @param handler - reçoit `{ channel, reason }`.
   * @returns dispose (désabonnement).
   */
  onClosed(handler: (closed: IRealtimeClosed) => void): () => void {
    const wrapped: RealtimeHandler = (closed) => {
      if (isClosedNotice(closed)) handler(closed);
    };
    let set = this.handlers.get(LOCAL_EVENTS.closed);
    if (!set) {
      set = new Set();
      this.handlers.set(LOCAL_EVENTS.closed, set);
    }
    set.add(wrapped);
    return () => {
      this.handlers.get(LOCAL_EVENTS.closed)?.delete(wrapped);
    };
  }

  /**
   * Attend que l'abonnement à `channel` soit EFFECTIF côté serveur — le signal
   * qui manquait au patron « je recharge l'état, puis je suis le flux ».
   *
   * Garantie : tout événement publié sur le canal APRÈS la résolution est
   * livré. Une première charge peut arriver AVANT (le producteur s'attache
   * avant l'acquittement) : ce n'est pas « rien n'arrive avant ».
   *
   * À chaque reconnexion l'attente repart de zéro : une promesse obtenue avant
   * la coupure se résout au prochain acquittement. Face à un serveur qui
   * n'annonce pas `subscriptionAcks` (antérieur à la notification), elle se
   * résout dès le rejeu du welcome — la garantie d'avant, sans plus.
   *
   * @param channel - un canal déjà demandé par {@link subscribe}.
   * @returns une promesse résolue à l'acquittement.
   * @throws (rejet) Si le serveur refuse le canal (`realtime:denied`, l'erreur
   *   porte le refus en `cause`), si le canal est rendu par {@link unsubscribe}
   *   avant l'acquittement, au `disconnect()`, ou si aucun `subscribe()` n'est
   *   en cours sur ce canal.
   */
  whenSubscribed(channel: EventNames<Listen> | (string & {})): Promise<void> {
    if (!this._subscriptions.has(channel)) {
      return Promise.reject(
        new Error(
          `[nodefony] whenSubscribed("${channel}") : aucun subscribe() en cours sur ce canal`,
        ),
      );
    }
    if (this.isSubscriptionActive(channel)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const waiters = (this._ackWaiters ??= new Map<string, IAckWaiter[]>());
      let list = waiters.get(channel);
      if (!list) {
        list = [];
        waiters.set(channel, list);
      }
      list.push({ resolve, reject });
    });
  }

  /** L'abonnement à `channel` est-il effectif sur la connexion courante ? */
  private isSubscriptionActive(channel: string): boolean {
    if (!this._welcomed) return false;
    return this._subscriptionAcks ? this._acked?.has(channel) === true : true;
  }

  /** Résout les attentes d'un canal. Cold path. */
  private resolveAckWaiters(channel: string): void {
    const list = this.takeAckWaiters(channel);
    if (list) for (const w of list) w.resolve();
  }

  /**
   * Retire et rend les attentes d'un canal (`undefined` s'il n'y en a pas),
   * en reposant la table à `null` quand elle se vide.
   */
  private takeAckWaiters(channel: string): IAckWaiter[] | undefined {
    const waiters = this._ackWaiters;
    const list = waiters?.get(channel);
    if (!waiters || !list) return undefined;
    waiters.delete(channel);
    if (waiters.size === 0) this._ackWaiters = null;
    return list;
  }

  /**
   * Rejette les attentes d'un canal. L'erreur n'est fabriquée QUE s'il y a
   * quelqu'un à prévenir : une `Error` capture une pile, et `unsubscribe` passe
   * ici à chaque démontage d'un composant.
   */
  private rejectAckWaiters(
    channel: string,
    message: (channel: string) => string,
    cause?: unknown,
  ): void {
    const list = this.takeAckWaiters(channel);
    if (!list) return;
    const error =
      cause === undefined
        ? new Error(message(channel))
        : new Error(message(channel), { cause });
    for (const w of list) w.reject(error);
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
    if (
      !this._emitRaw(method, params) &&
      this.transport?.readyState !== TransportState.OPEN
    ) {
      this.noticeUnsent();
    }
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
    // Le peer est tenu sans la carte `Emit` de la socket : un nom système
    // (subscribe/unsubscribe/ping) s'y émet tel quel, sans conversion.
    return this.peer.notify(method, params);
  }

  /**
   * Émet sur un canal — verbe socket de {@link IRealtimeSocket.publish}. Côté client =
   * notification au serveur (alias clair de {@link emit}).
   *
   * @throws TypeError si la charge n'est ni un objet, ni un tableau, ni absente
   *   ({@link isRealtimePayload}) — un scalaire se publie dans un objet (`{ value }`).
   */
  publish<K extends string>(
    channel: K,
    payload?: K extends EventNames<Emit> ? EventPayload<Emit, K> : object,
  ): void {
    this.#publish(channel, payload);
  }

  /** Porte non générique de {@link publish} : garde de la charge, puis émission. */
  #publish(channel: string, payload: unknown): void {
    if (!isRealtimePayload(payload))
      throw realtimePayloadError(channel, payload);
    if (!this._emitRaw(channel, payload)) this.noticeUnsent();
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
      this._acked?.delete(c);
      if (this._admissionRetries !== null) this.dropAdmissionRetry(c);
      this.rejectAckWaiters(c, unsubscribedBeforeAck);
      // Avant le welcome, le serveur n'a rien enregistré : retirer l'entrée suffit.
      if (this._welcomed) this._emitRaw("unsubscribe", { channel: c });
    } else {
      this._subscriptions.set(c, cur - 1);
    }
  }

  /**
   * Canaux DEMANDÉS (≥ 1 consommateur) — l'intention locale, pas un état
   * confirmé par le serveur : l'abonnement effectif se lit sur
   * {@link whenSubscribed} / {@link onSubscribed}. Lecture seule.
   */
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
   * Reçoit les messages adressés à l'identité de CETTE connexion — `publishToUser(id, charge)` côté serveur (ADR-0022 §6, D1).
   *
   * Abonne cet onglet à son canal personnel `user:<id>`, l'`id` venant du
   * `realtime:welcome` : rien à connaître ni à construire. Suit l'identité —
   * pas encore annoncée, l'abonnement part au welcome ; une reconnexion sous un
   * autre compte change de canal ; un anonyme ou une déconnexion volontaire n'en
   * tient aucun. Jamais d'abonnement d'office : l'onglet s'abonne quand son écran
   * écoute, et la fonction rendue le désabonne.
   *
   * @param handler - reçoit la charge que le contrat déclare pour le canal
   *   personnel (clé gabarit `` [k: `user:${string}`]: … ``).
   * @returns désabonnement (handler retiré, `unsubscribe` au dernier consommateur).
   *
   * @example
   * ```ts
   * useEffect(() => chat.onUser((m) => addPrivate(m)), []);
   * ```
   */
  onUser(handler: (payload: UserChannelPayload<Listen>) => void): () => void {
    let channel: string | null = null;
    const follow = (identity: RealtimeIdentity | null): void => {
      const next =
        identity !== null && identity.authenticated && identity.id !== null
          ? userChannel(identity.id)
          : null;
      if (next === channel) return;
      if (channel !== null) {
        this.handlers.get(channel)?.delete(handler);
        this.unsubscribe(channel);
      }
      channel = next;
      if (next === null) return;
      let set = this.handlers.get(next);
      if (!set) {
        set = new Set();
        this.handlers.set(next, set);
      }
      set.add(handler);
      this.subscribe(next);
    };
    follow(this._identity);
    const offIdentity = this.onIdentity(follow);
    return () => {
      offIdentity();
      follow(null);
    };
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
   * Lit les trames BINAIRES reçues sur la socket — le point d'extension d'un
   * protocole binaire écrit par l'application, à côté du JSON-RPC.
   *
   * Le protocole temps réel de Nodefony est du JSON-RPC texte : il ne sait pas à
   * quel canal une trame binaire appartient, et ne la route donc pas. Sans
   * lecteur, une trame binaire est écartée, comptée
   * ({@link binaryFramesDiscarded}) et signalée une fois par notice. Avec un
   * lecteur, elle lui est remise telle quelle, en `Uint8Array` — le type que
   * reçoit aussi `RealtimeController.onRealtimeBinary` côté serveur —, dans
   * l'ordre des trames texte, et aucune notice ne part : la corrélation (canal,
   * requête) appartient alors à l'application.
   *
   * ⚠️ La vue porte sur la trame entière, mais un `DataView` se construit sur
   * `data.buffer` AVEC `data.byteOffset` et `data.byteLength` : un code écrit
   * pour les deux côtés reçoit aussi des `Buffer` de Node, qui ne commencent pas
   * à 0 dans leur tampon.
   *
   * @param handler - appelé pour chaque trame binaire reçue.
   * @returns dispose (désabonnement).
   */
  onBinary(handler: (data: Uint8Array<ArrayBuffer>) => void): () => void {
    (this._binaryHandlers ??= new Set()).add(handler);
    if (this.peer.codec === this.codecs.binary) this.noticeRawBinary();
    return () => {
      this._binaryHandlers?.delete(handler);
      if (this._binaryHandlers?.size === 0) this._binaryHandlers = null;
    };
  }

  /**
   * Émet une trame BINAIRE, sans la sérialiser — le pendant sortant de
   * {@link onBinary}. Même règle que les frames JSON-RPC : rien n'est mis en
   * file d'attente, un transport fermé rend `false` et compte la trame dans
   * {@link framesUnsent}.
   *
   * @param data - les octets à émettre, sur un `ArrayBuffer` non partagé —
   *   `WebSocket.send` refuse une vue sur un `SharedArrayBuffer`.
   * @returns `true` si la trame est partie, `false` si le transport était fermé.
   */
  sendBinary(data: Uint8Array<ArrayBuffer>): boolean {
    if (this.transport?.readyState !== TransportState.OPEN) {
      this._framesUnsent++;
      return false;
    }
    // Sous codec binaire, le serveur lirait ces octets comme une frame du codec.
    if (this.peer.codec === this.codecs.binary) {
      this.noticeRawBinary();
      return false;
    }
    if (!this.admitOutbound(this.transport)) return false;
    this.transport.send(data);
    return true;
  }

  /**
   * Contre-pression SORTANTE du navigateur : la frame part-elle, ou la jette-t-on ?
   *
   * Même règle que le serveur (`decideBackpressure`, au cœur), lue sur
   * `bufferedAmount` AVANT la sérialisation. Jetée → comptée dans
   * {@link framesDropped} ; solde atteint → fermeture en `4007`, puis la
   * reconnexion habituelle (le navigateur refuse le `1013` du serveur).
   *
   * @param transport - le transport ouvert
   * @returns `true` si la frame peut partir
   */
  private admitOutbound(transport: IRealtimeTransport): boolean {
    const max = this.opts.maxBufferedAmount ?? 0;
    if (max <= 0) return true;
    const verdict = decideBackpressure(
      transport.bufferedAmount ?? 0,
      max,
      "drop",
      this.opts.backpressureCloseAfterDrops ?? BACKPRESSURE_CLOSE_AFTER_DEFAULT,
      this._dropBalance,
    );
    this._dropBalance = nextDropBalance(verdict, this._dropBalance);
    if (verdict === "send") return true;
    this._framesDropped++;
    if (verdict === "close") {
      transport.close(BACKPRESSURE_CLOSE_CODE, "backpressure");
    }
    return false;
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
      send(payload?: object): void {
        hub.#publish(name, payload);
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
  request(
    method: string,
    params?: unknown,
    timeoutMs = 30000,
  ): Promise<unknown> {
    // Plan de contrôle (id, corrélation, timeout, RpcError) délégué au moteur
    // isomorphe. Les surcharges ont déjà borné `method`/`params` par le
    // contrat ; ici le pair est lu sous la carte permissive — le résultat est
    // une donnée réseau, que les surcharges décrivent sans la valider.
    return this.peer.requestAs<ActionsMap, string>(method, params, timeoutMs);
  }

  /**
   * Lit une route par le pont `api.request` — la MÊME action contrôleur que le
   * `GET` HTTP, par la socket. Le verbe de la méthode est celui que la route
   * déclare (`methods: ["GET", "WEBSOCKET"]`).
   *
   * Sous un contrat (`NodefonySocket.fromContract<C>()`), une route déclarée
   * dans `serverRoutes` rend son résultat typé et sa query vérifiée ; un chemin
   * hors contrat reste accepté, résultat `T` (défaut `unknown`).
   *
   * ```ts
   * const history = await chat.get("/chat/history");   // ChatMessage[]
   * const page = await chat.get("/chat/history", { query: { limit: 20 } });
   * ```
   *
   * @param path - chemin de la route (transport WEBSOCKET requis côté serveur).
   * @param options - `query` (sérialisée dans le chemin), `timeoutMs` (30 s).
   * @returns la valeur que rend l'action.
   * @throws {@link RpcError} — `data.status` = statut HTTP équivalent (404
   *   chemin inconnu, 403 refus, 405 route sans transport WEBSOCKET…).
   */
  get<T = unknown, P extends `/${string}` = `/${string}`>(
    path: P,
    ...options: BridgeReadArgs<
      ContractRouteQuery<Routes, `GET ${P}`>,
      ContractRouteParams<Routes, `GET ${P}`, P>
    >
  ): Promise<ContractRouteResult<Routes, `GET ${P}`, T>>;
  get(path: `/${string}`, options?: IBridgeReadOptions): Promise<unknown> {
    return this.bridge("GET", path, undefined, options);
  }

  /**
   * Écrit par le pont `api.request` : la route `POST` de même chemin, par la
   * socket. Une **clé d'idempotence** est posée seule (une par appel) : la trame
   * rejouée après une reconnexion porte la même, et le serveur dédoublonne
   * (`@Idempotent`). `options.idempotencyKey` la remplace quand l'application
   * dédoublonne une INTENTION (double clic : même clé pour deux appels).
   *
   * Sous un contrat, le corps est l'entrée du schéma de la route (`typeof
   * SendBody`) — absent ou mal formé, il ne compile pas — et le résultat est typé.
   *
   * ```ts
   * const { sentAt } = await chat.post("/chat/send", { text: "salut" });
   * ```
   *
   * @param path - chemin de la route.
   * @param body - corps (validé par le schéma de la route côté serveur).
   * @param options - `idempotencyKey`, `query`, `timeoutMs`.
   * @returns la valeur que rend l'action.
   * @throws {@link RpcError} — 400 corps refusé par le schéma, 409 rejeu
   *   concurrent, 403 refus, 404 chemin inconnu…
   */
  post<T = unknown, P extends `/${string}` = `/${string}`>(
    path: P,
    ...args: BridgeWriteArgs<Routes, `POST ${P}`, P>
  ): Promise<ContractRouteResult<Routes, `POST ${P}`, T>>;
  post(
    path: `/${string}`,
    body?: unknown,
    options?: IBridgeWriteOptions,
  ): Promise<unknown> {
    return this.bridge("POST", path, body, options);
  }

  /** Remplace par le pont (`PUT`) — mêmes règles que {@link post}. */
  put<T = unknown, P extends `/${string}` = `/${string}`>(
    path: P,
    ...args: BridgeWriteArgs<Routes, `PUT ${P}`, P>
  ): Promise<ContractRouteResult<Routes, `PUT ${P}`, T>>;
  put(
    path: `/${string}`,
    body?: unknown,
    options?: IBridgeWriteOptions,
  ): Promise<unknown> {
    return this.bridge("PUT", path, body, options);
  }

  /** Modifie par le pont (`PATCH`) — mêmes règles que {@link post}. */
  patch<T = unknown, P extends `/${string}` = `/${string}`>(
    path: P,
    ...args: BridgeWriteArgs<Routes, `PATCH ${P}`, P>
  ): Promise<ContractRouteResult<Routes, `PATCH ${P}`, T>>;
  patch(
    path: `/${string}`,
    body?: unknown,
    options?: IBridgeWriteOptions,
  ): Promise<unknown> {
    return this.bridge("PATCH", path, body, options);
  }

  /** Supprime par le pont (`DELETE`) — mêmes règles que {@link post}. */
  delete<T = unknown, P extends `/${string}` = `/${string}`>(
    path: P,
    ...args: BridgeWriteArgs<Routes, `DELETE ${P}`, P>
  ): Promise<ContractRouteResult<Routes, `DELETE ${P}`, T>>;
  delete(
    path: `/${string}`,
    body?: unknown,
    options?: IBridgeWriteOptions,
  ): Promise<unknown> {
    return this.bridge("DELETE", path, body, options);
  }

  /**
   * Une invocation du pont — seule forme de la trame `api.request`. Une lecture
   * ne porte que `{ path }` (la méthode vaut `GET` côté serveur) ; une écriture
   * ajoute verbe, corps et clé d'idempotence.
   */
  private bridge(
    method: BridgeVerb,
    path: `/${string}`,
    body: unknown,
    options: IBridgeWriteOptions | undefined,
  ): Promise<unknown> {
    // Un gabarit (`/chat/messages/{id}`) se remplit AVANT tout : chaque valeur
    // encodée pour son segment. Un chemin concret ne paie qu'un `includes`.
    let target: string = path.includes("{")
      ? fillRoutePath(path, options?.params)
      : path;
    if (options?.query !== undefined) target = withQuery(target, options.query);
    const params: IBridgeRequestParams =
      method === "GET"
        ? { path: target }
        : {
            path: target,
            method,
            body,
            idempotencyKey: options?.idempotencyKey ?? createIdempotencyKey(),
          };
    return this.peer.requestAs<BridgeActions, "api.request">(
      "api.request",
      params,
      options?.timeoutMs ?? 30000,
    );
  }

  /**
   * Appel API par la socket rendant l'**enveloppe complète** — le résultat ET
   * la méta serveur — là où {@link get}/{@link post} ne rendent que la
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
  call<T = unknown>(
    path: `/${string}`,
    init?: ICallInit,
  ): Promise<IApiCallResult<T>>;
  async call(path: `/${string}`, init?: ICallInit): Promise<IApiCallResult> {
    const { result, meta } = await this.peer.requestTracedAs<
      BridgeActions,
      "api.request"
    >(
      "api.request",
      {
        path,
        method: init?.method ?? "GET",
        body: init?.body,
        idempotencyKey: init?.idempotencyKey,
      },
      init?.timeoutMs ?? 30000,
    );
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
    this.peer.registerHandler(method, handler);
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
   * @param frame - la frame déjà décodée.
   * @param size - sa taille sur le fil (caractères, ou octets d'une trame
   *   binaire), pour le budget du log protocole.
   * @param binary - la frame est arrivée en trame binaire (codec binaire).
   * @returns la nature de la frame selon le moteur JSON-RPC.
   */
  receive(frame: unknown, size = 0, binary = false): JsonRpcFrameKind {
    const ts = Date.now();
    this._inboundAt = ts;
    if (this._frameLogOn) this.recordFrame("in", frame, size, binary, ts);
    const kind = this.peer.receive(frame);
    if (kind === "invalid") this.handleServerError(frame);
    return kind;
  }

  /**
   * Compteurs du fil de cette socket (trames, tailles, temps de décodage), armés au
   * PREMIER appel : avant, aucun compte n'est tenu et une trame ne paie qu'un test.
   * L'objet rendu est la référence vivante — à LIRE, pas à muter.
   *
   * @returns les compteurs, cumulés depuis le premier appel.
   */
  wireStats(): Readonly<IWireStats> {
    return (this._wire ??= {
      framesIn: 0,
      framesOut: 0,
      sizeIn: 0,
      sizeOut: 0,
      binaryIn: 0,
      binaryOut: 0,
      decodeMs: 0,
    });
  }

  /**
   * Adopte un codec demandé APRÈS la création, tant qu'aucune connexion n'est
   * ouverte — le codec ne se négocie qu'au handshake, l'offre suivante le portera.
   * Chemin froid, appelé par {@link NodefonySocket.shared}.
   *
   * @param codec - le codec demandé.
   * @returns `false` si une connexion est ouverte ou en cours : le codec est ignoré.
   */
  private adoptRequestedCodec(codec: IFrameCodec): boolean {
    if (this.transport !== null) return false;
    this.opts.codec = codec;
    this.codecs = frameCodecSet(codec);
    this.peer.codec = this.codecs.text;
    return true;
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

  /**
   * Total de frames JETÉES par la contre-pression depuis la création du client
   * (file d'envoi au-delà de `maxBufferedAmount`). Reste à `0` sans borne.
   */
  get framesDropped(): number {
    return this._framesDropped;
  }

  /**
   * Total de trames BINAIRES reçues puis écartées, faute de lecteur
   * ({@link onBinary}). Reste à `0` tant que le pair ne parle que JSON-RPC ;
   * la première écartée émet une notice (`-32700`), les suivantes se comptent ici.
   */
  get binaryFramesDiscarded(): number {
    return this._binaryFramesDiscarded;
  }

  /**
   * Total de trames TEXTE reçues puis écartées parce qu'elles ne sont pas du
   * JSON. Reste à `0` face à un pair sain ; la première émet une notice.
   */
  get malformedFramesDiscarded(): number {
    return this._malformedFramesDiscarded;
  }

  /** Timestamp (ms) de la dernière notification reçue. */
  get lastFrameAt(): number | null {
    return this._lastFrameAt;
  }

  /** `method`/canal de la dernière notification reçue. */
  get lastFrameMethod(): string | null {
    return this._lastFrameMethod;
  }

  /**
   * Sous-protocole du codec en vigueur sur la connexion — `nodefony.jsonrpc.v1`
   * tant que l'accueil n'en a pas annoncé un autre, et de nouveau après une
   * coupure, jusqu'à l'accueil suivant (ADR-0022 §2). Mis en mots par
   * `describeCodec`.
   */
  get codec(): string {
    return this.peer.codec.protocol;
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
    // Posé par `receive`, qui seul mène ici (moteur → `dispatchNotification`).
    const now = this._inboundAt;
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
    // Serveur qui n'acquitte pas : l'abonnement est réputé actif dès son rejeu,
    // et les attentes en cours se résolvent ici plutôt que jamais.
    // Toutes les attentes portent sur des canaux suivis (`unsubscribe` rejette
    // les siennes) : la table entière se solde d'un coup, sans copie de clés.
    const waiters = this._ackWaiters;
    if (!this._subscriptionAcks && waiters !== null) {
      this._ackWaiters = null;
      for (const list of waiters.values()) for (const w of list) w.resolve();
    }
  }

  /**
   * Ingère un `realtime:subscribed` : marque le canal acquitté sur la connexion
   * courante, résout ses attentes et émet `__subscribed__`. Un acquittement pour
   * un canal rendu entre-temps est ignoré — sauf s'il est IMPOSÉ par le serveur
   * (`imposed: true`) : le canal entre alors dans les abonnements avec un
   * consommateur, et se rejoue à la reconnexion comme s'il avait été demandé.
   * Cold path (1×/canal et par connexion).
   */
  private ingestSubscribed(params: unknown): void {
    const channel = ownField(params, "channel");
    if (typeof channel !== "string") return;
    const imposed = ownField(params, "imposed") === true;
    if (!this._subscriptions.has(channel)) {
      if (!imposed) return;
      this._subscriptions.set(channel, 1);
    }
    (this._acked ??= new Set()).add(channel);
    if (this._admissionRetries !== null) this.dropAdmissionRetry(channel);
    if (this._ackWaiters !== null) this.resolveAckWaiters(channel);
    // La charge n'est construite que si quelqu'un écoute : sans écouteur, un
    // acquittement ne coûte qu'une entrée de Set.
    if (this.handlers.get(LOCAL_EVENTS.subscribed)?.size) {
      const ack: IRealtimeSubscribed = imposed
        ? { channel, imposed: true }
        : { channel };
      this.fireLocal(LOCAL_EVENTS.subscribed, ack);
    }
  }

  /**
   * Ingère un `realtime:closed` : retire l'abonnement QUEL QUE SOIT le nombre de
   * consommateurs locaux (un hook et un magasin partagent un seul abonnement
   * serveur, qui vient de prendre fin pour les deux), rejette les attentes
   * d'acquittement et émet `__closed__`. L'inverse de {@link ingestDenied}, qui
   * GARDE le canal pour le rejouer : un canal terminé ne se rejoue pas
   * (ADR-0022 §6 décision 3). Une charge mal formée, ou qui vise un canal que
   * le client ne suit pas (rendu entre-temps), est ignorée. Cold path.
   */
  private ingestClosed(params: unknown): void {
    if (!isClosedNotice(params)) return;
    const { channel, reason } = params;
    if (!this._subscriptions.delete(channel)) return;
    this._acked?.delete(channel);
    if (this._admissionRetries !== null) this.dropAdmissionRetry(channel);
    // Charge relue champ par champ : rien d'autre que le contrat n'atteint l'écran.
    const closed: IRealtimeClosed = { channel, reason };
    this.rejectAckWaiters(channel, closedBeforeAck, closed);
    this.fireLocal(LOCAL_EVENTS.closed, closed);
  }

  /**
   * Ingère le `realtime:welcome` : mémorise l'identité résolue + les capabilities
   * annoncées (canaux/actions découvrables) et émet `__identity__`. Tolérant à un
   * welcome partiel/legacy (champs absents → `null`). Cold path (1×/connexion).
   */
  private ingestWelcome(params: unknown): void {
    // Avant la sortie anticipée : un welcome partiel/legacy n'annonce rien, et
    // c'est précisément le cas où il ne faut pas attendre d'acquittement.
    this._subscriptionAcks = ownField(params, "subscriptionAcks") === true;
    // Avant le rejeu des abonnements (`dispatchNotification`) : ils partent déjà
    // dans le codec retenu.
    this.adoptCodec(ownField(params, "codec"), ownField(params, "bytes"));
    if (params === null || typeof params !== "object") return;
    this._identity = identityOf(ownField(params, "identity"));
    this._serverChannels = stringsOf(ownField(params, "channels"));
    this._serverMethods = stringsOf(ownField(params, "methods"));
    // Le serveur dit son mode quand il n'est pas en production : c'est ce qui
    // permet de parler dans la console d'un bundle bâti pour la production mais
    // servi par un serveur de développement, cas qu'`import.meta.env.DEV` ne
    // peut pas voir.
    const env = ownField(params, "env");
    noteServerEnv(typeof env === "string" ? env : undefined);
    // Serveur hors production : le journal s'allume comme en développement. La
    // trame qui l'allume y entre AUSSI, et ici — avant le rejeu des abonnements,
    // pour garder l'ordre du fil : `receive` l'a vue passer journal éteint. Sa
    // taille sur le fil n'est plus connue à ce point (`0` = inconnue).
    if (isVerbose() && this.startFrameLog())
      this.recordFrame(
        "in",
        jsonRpcNotification("realtime:welcome", params),
        0,
        false,
      );
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
    const rawChannel = ownField(params, "channel");
    const channel = typeof rawChannel === "string" ? rawChannel : "";
    // Motif NORMALISÉ sur le contrat : un serveur plus récent (ou un pont mal
    // écrit) qui inventerait un motif ne doit pas faire tomber l'écran dans un
    // cas que personne ne traite. Repli sur `forbidden`, le motif le plus
    // prudent : il n'annonce jamais qu'un accès était possible.
    const brut = ownField(params, "reason");
    const reason: IRealtimeDenied["reason"] =
      brut === "unknown" || brut === "limit" || brut === "unavailable"
        ? brut
        : "forbidden";
    // Le DÉTAIL est repris tel quel quand le serveur en pose un — il n'existe
    // qu'hors production (`deniedDetail`, côté serveur), et il porte ce qu'il
    // faut regarder là où `reason`, générique par construction, ne dit rien.
    // Il n'est pas normalisé comme `reason` : ce n'est pas une valeur du
    // protocole que du code lit, c'est une phrase qu'un humain lit. Filtré sur
    // le TYPE seulement — une frame hostile ne doit pas glisser un objet là où
    // l'écran attend du texte.
    const rawDetail = ownField(params, "detail");
    const detail = typeof rawDetail === "string" ? rawDetail : undefined;
    // Un délai d'attente n'a de sens qu'avec `unavailable`, et seulement s'il
    // est un nombre fini positif : une frame hostile ne fixe pas l'horloge du
    // client à `Infinity`.
    const rawRetry =
      reason === "unavailable" ? ownField(params, "retryAfterMs") : undefined;
    const retryAfterMs =
      typeof rawRetry === "number" && Number.isFinite(rawRetry) && rawRetry >= 0
        ? rawRetry
        : undefined;
    // Indécidable pour l'instant : le seul `subscribe` concerné est rejoué en
    // silence — l'attente `whenSubscribed` continue, aucun écran ne clignote.
    // Le refus ne remonte qu'une fois les réessais épuisés.
    if (
      reason === "unavailable" &&
      this._subscriptions.has(channel) &&
      this.scheduleAdmissionRetry(channel, retryAfterMs)
    ) {
      return;
    }
    const denied: IRealtimeDenied = {
      channel,
      reason,
      ...(detail === undefined ? {} : { detail }),
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    };
    this.fireNotice(deniedToNotice(denied));
    this.fireLocal(LOCAL_EVENTS.denied, denied);
    this.rejectAckWaiters(channel, deniedBeforeAck, denied);
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
    } else if (method === "realtime:subscribed") this.ingestSubscribed(params);
    else if (method === "realtime:denied") this.ingestDenied(params);
    else if (method === "realtime:closed") this.ingestClosed(params);
    this.trackFrame(method); // stats génériques avant dispatch
    // `for…of` plutôt que `forEach((h) => …)` : aucune closure allouée par trame.
    const listeners = this.handlers.get(method);
    if (listeners !== undefined)
      for (const h of listeners) {
        try {
          h(params);
        } catch {
          /* ignore handler errors */
        }
      }
    // wildcard
    const wildcard = this.handlers.get("*");
    if (wildcard !== undefined)
      for (const h of wildcard) {
        try {
          h(method, params);
        } catch {
          /* ignore */
        }
      }
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
    const listeners = this.handlers.get(event);
    if (listeners === undefined) return;
    for (const h of listeners) {
      try {
        h(...args);
      } catch {
        /* ignore handler errors */
      }
    }
  }

  private openSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Nouvelle tentative = nouvelle session serveur : rien n'y est abonné tant
      // que le welcome de CETTE connexion n'est pas arrivé.
      this._welcomed = false;
      this._acked = null;
      // L'accueil de CETTE connexion dira son codec ; d'ici là, le texte.
      this.peer.codec = this.codecs.text;
      this._rawBinaryNoticed = false;
      this.setState(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");
      // Un écouteur d'état a pu appeler `disconnect()` : rien ne s'ouvre après.
      if (this.intentionalClose) {
        reject(
          new Error("[nodefony] connexion temps réel annulée par disconnect()"),
        );
        return;
      }
      let transport: IRealtimeTransport;
      let socketUrl: URL | null = null;
      try {
        const url = toSocketUrl(
          this.requireUrl(),
          typeof window !== "undefined"
            ? window.location.href
            : "http://localhost",
        );
        socketUrl = url;
        if (this.opts.token) url.searchParams.set("token", this.opts.token);
        // Transport NEUF à chaque tentative (le précédent est clos). Le transport
        // ne sait QUE ouvrir/envoyer/fermer ; l'orchestration reste ici.
        transport = this.transportFactory(url.toString(), this.codecs.offer);
        this.transport = transport;
        this._dropBalance = 0;
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
        // Fermée AVANT d'ouvrir, sans motif lisible (1006/1005) : refus ou
        // panne ? La SONDE tranche avant de décider de retenter (#596). Un code
        // posé par le serveur (1011, 1001, 1008…) est déjà un motif : pas de sonde.
        if (
          openedAt === 0 &&
          this.opts.probe !== false &&
          (code === 1006 || code === 1005)
        ) {
          void this.probeThenSettle(socketUrl, code, reason);
          return;
        }
        this.settleClose(code, reason);
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

  /**
   * Décide de la suite d'une fermeture non voulue : notice, puis reconnexion si
   * le code la permet (RFC 6455 §7.4) — sinon état `error` (définitif) ou
   * `disconnected` (transitoire, reconnexion désactivée).
   */
  private settleClose(code: number, reason: string): void {
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
  }

  /**
   * Fermée avant d'ouvrir sans motif lisible : le navigateur cache le statut
   * d'un handshake refusé — le code ne voit qu'un `1006`, le même qu'un serveur
   * éteint. La sonde demande au serveur, par une requête HTTP sur la même
   * adresse, ce que le handshake aurait décidé (#596) : un refus définitif
   * arrête là (état `error`) ; tout le reste — 426 « admis », panne, silence —
   * suit le chemin normal de la reconnexion.
   */
  private async probeThenSettle(
    url: URL,
    code: number,
    reason: string,
  ): Promise<void> {
    const probe = this.opts.probe || fetchProbe;
    let status: number | null;
    try {
      status = await probe(toProbeUrl(url), this.opts.token ?? null);
    } catch {
      status = null;
    }
    // Pendant la sonde : `disconnect()` a déjà posé son état ; un `connect()`
    // a déjà ouvert une nouvelle tentative — le verdict d'avant ne la juge pas.
    if (this.disconnectRequested() || this.transport !== null) return;
    if (status !== null && isProbeRefusal(status)) {
      this.fireNotice(probeRefusalNotice(status));
      if (this.disconnectRequested()) return;
      this.setState("error");
      return;
    }
    this.settleClose(code, reason);
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

  /**
   * Programme le réessai d'un abonnement refusé `unavailable`.
   *
   * @returns `false` quand les réessais du canal sont épuisés : le refus doit
   *   alors remonter à l'application.
   */
  private scheduleAdmissionRetry(
    channel: string,
    retryAfterMs: number | undefined,
  ): boolean {
    const retries = (this._admissionRetries ??= new Map<
      string,
      IAdmissionRetry
    >());
    const attempt = retries.get(channel)?.attempt ?? 0;
    if (attempt >= ADMISSION_RETRY_MAX) {
      retries.delete(channel);
      return false;
    }
    // Sans garde à l'échéance : tout ce qui rendrait ce rejeu faux coupe le
    // minuteur avant — désabonnement et acquittement (`dropAdmissionRetry`),
    // déconnexion et fermeture (`clearTimers`).
    const timer = setTimeout(
      () => {
        this._emitRaw("subscribe", { channel });
      },
      admissionRetryDelay(attempt, retryAfterMs),
    );
    retries.set(channel, { attempt: attempt + 1, timer });
    return true;
  }

  /** Oublie le réessai d'un canal (acquitté ou rendu) et coupe son minuteur. */
  private dropAdmissionRetry(channel: string): void {
    const retries = this._admissionRetries;
    if (retries === null) return;
    const retry = retries.get(channel);
    if (retry === undefined) return;
    clearTimeout(retry.timer);
    retries.delete(channel);
  }

  private clearTimers(): void {
    // Une connexion fermée emporte ses réessais : le rejeu du prochain
    // `welcome` redemande chaque canal, avec des tentatives neuves.
    if (this._admissionRetries !== null) {
      for (const retry of this._admissionRetries.values())
        clearTimeout(retry.timer);
      this._admissionRetries = null;
    }
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.connectTimer = null;
  }

  /**
   * Depuis quand le journal retient (ms epoch), `null` s'il est éteint — les
   * trames antérieures n'y sont pas. Lire {@link frameLog} l'allume.
   */
  get frameLogSince(): number | null {
    return this._frameLogSince;
  }

  /**
   * Allume le journal s'il est éteint, et date l'allumage.
   *
   * @returns `true` si l'appel vient de l'allumer.
   */
  private startFrameLog(): boolean {
    if (this._frameLogOn) return false;
    this._frameLogOn = true;
    this._frameLogSince = Date.now();
    return true;
  }

  /**
   * Log protocole : les `FRAME_LOG_MAX` dernières frames JSON-RPC (redactées).
   *
   * En développement, enregistrées dès l'ouverture : la console « retrace
   * l'instant ». En production le journal est éteint, sans coût par trame ; la
   * PREMIÈRE lecture l'allume, et il se remplit à partir de là. Construction +
   * redaction faites ici, à la lecture.
   */
  get frameLog(): readonly RealtimeFrame[] {
    this.startFrameLog();
    // Chemin froid (lecture de la console) : la copie de l'anneau ne coûte qu'ici.
    return (this._rawFrames?.toArray() ?? []).map((f) =>
      NodefonySocket.buildFrame(f.dir, f.msg, f.ts, f.size, f.binary),
    );
  }

  /** Purge le log protocole. */
  clearFrameLog(): void {
    this._rawFrames?.clear();
    this._rawFramesChars = 0;
  }

  /**
   * Enregistre une frame dans le ring — coût = 1 push de réf (construction +
   * redaction DIFFÉRÉES). Le ring est borné en nombre ET en caractères : une
   * trame démesurée n'y entre qu'en résumé, et les plus anciennes sortent tant
   * que le budget est dépassé. Émet `__frame__` (frame construite) seulement si
   * la console écoute.
   *
   * @param size - taille de la frame sur le fil (caractères, ou octets d'une
   *   trame binaire), `0` si inconnue.
   * @param binary - la frame a voyagé en trame binaire.
   * @param ts - horodatage déjà lu par l'appelant (une lecture d'horloge par trame).
   */
  private recordFrame(
    dir: "in" | "out",
    msg: unknown,
    size: number,
    binary: boolean,
    ts: number = Date.now(),
  ): void {
    const cost = frameLogCost(size);
    // Un résumé ne retient plus la charge : il ne coûte rien au budget.
    const kept = cost === 0 && size > 0 ? frameSummary(msg, size, binary) : msg;
    const ring = (this._rawFrames ??= new CircularBuffer<IFrameLogEntry>(
      FRAME_LOG_MAX,
    ));
    // Plein : la plus ancienne sort ICI, pour que son coût quitte le budget —
    // `push` l'écraserait sans le dire. Son objet est RECYCLÉ : en régime établi,
    // journaliser une trame n'alloue rien (le journal ne rend que des copies,
    // `buildFrame`, jamais ses entrées).
    let entry: IFrameLogEntry | undefined;
    if (ring.length === FRAME_LOG_MAX) {
      entry = ring.shift();
      if (entry !== undefined) this._rawFramesChars -= frameLogCost(entry.size);
    }
    if (entry === undefined) entry = { ts, dir, msg: kept, size, binary };
    else {
      entry.ts = ts;
      entry.dir = dir;
      entry.msg = kept;
      entry.size = size;
      entry.binary = binary;
    }
    ring.push(entry);
    this._rawFramesChars += cost;
    while (this._rawFramesChars > FRAME_LOG_MAX_CHARS) {
      const old = ring.shift();
      if (old === undefined) break;
      this._rawFramesChars -= frameLogCost(old.size);
    }
    const listeners = this.handlers.get(LOCAL_EVENTS.frame);
    if (listeners && listeners.size > 0)
      this.fireLocal(
        LOCAL_EVENTS.frame,
        NodefonySocket.buildFrame(dir, kept, ts, size, binary),
      );
  }

  /** Construit une frame affichable (kind/canal/id + payload redacté, taille et nature sur le fil). */
  private static buildFrame(
    dir: "in" | "out",
    msg: unknown,
    ts: number,
    size: number,
    binary: boolean,
  ): RealtimeFrame {
    const method = ownField(msg, "method");
    const id = ownField(msg, "id");
    let kind = "?";
    let channel: string | undefined;
    if (typeof method === "string") {
      kind = method;
      const c = ownField(ownField(msg, "params"), "channel");
      if (typeof c === "string") channel = c;
    } else if (ownField(msg, "error") !== undefined) kind = "error";
    else if (ownField(msg, "result") !== undefined) kind = "response";
    return {
      ts,
      dir,
      kind,
      id: typeof id === "number" ? id : undefined,
      channel,
      payload: redactFrame(msg),
      size,
      binary,
    };
  }

  /**
   * Admet une frame à l'émission si — et seulement si — le transport est ouvert
   * et la contre-pression la laisse passer.
   *
   * La frame n'est **pas** mise en file d'attente : rejouer une intention après
   * coup peut être pire que la perdre (une commande obsolète appliquée en
   * retard, un abonnement rétabli sur un écran déjà quitté). Ce qui n'est plus
   * accepté, c'est de la perdre **en silence** — l'appelant reçoit `false`, une
   * requête corrélée est rejetée aussitôt par {@link JsonRpcPeer} plutôt qu'au
   * bout de son timeout, et l'utilisateur est prévenu une fois par épisode.
   *
   * Appelée par le peer AVANT d'encoder : une frame refusée ne coûte aucune
   * sérialisation.
   *
   * @returns `true` si la frame peut partir, `false` si le transport était
   *   fermé ou la contre-pression l'a jetée.
   */
  private admitFrame(): boolean {
    if (this.transport?.readyState !== TransportState.OPEN) {
      this._framesUnsent++;
      return false;
    }
    return this.admitOutbound(this.transport);
  }

  /**
   * Écrit une frame que le peer vient d'encoder avec le codec de la connexion.
   *
   * @param data - la frame encodée (texte, ou octets sous codec binaire).
   * @param msg - la même frame en objet, pour le journal protocole.
   * @returns `true` si la frame est partie.
   */
  private writeFrame(
    data: string | Uint8Array<ArrayBuffer>,
    msg: unknown,
  ): boolean {
    // `admitFrame` vient de constater le transport ouvert, dans le même appel.
    const transport = this.transport;
    if (transport === null) return false;
    transport.send(data);
    const wire = this._wire;
    if (wire !== null) {
      wire.framesOut++;
      wire.sizeOut += data.length;
      if (typeof data !== "string") wire.binaryOut++;
    }
    if (this._frameLogOn)
      this.recordFrame("out", msg, data.length, typeof data !== "string");
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

  private handleMessage(raw: RealtimeFrameData): void {
    const codec = this.peer.codec;
    // Binaire HORS codec binaire : pas une frame JSON-RPC, le flux brut de
    // l'application. Sous codec binaire, toute trame passe par le codec.
    if (typeof raw !== "string" && codec !== this.codecs.binary) {
      if (this._binaryHandlers !== null) {
        for (const h of this._binaryHandlers) {
          try {
            h(raw);
          } catch {
            /* un lecteur fautif ne coupe pas les autres */
          }
        }
        return;
      }
      // Jamais en silence (#451) : une notice à la PREMIÈRE, un compteur ensuite.
      if (++this._binaryFramesDiscarded === 1)
        this.fireNotice(discardedFrameNotice("binary", codec.protocol));
      return;
    }
    // Compteurs armés seulement si quelqu'un les lit : sinon un test, aucune horloge.
    const wire = this._wire;
    const startedAt = wire === null ? 0 : performance.now();
    let msg: unknown;
    try {
      msg = this.peer.decode(raw);
    } catch {
      if (++this._malformedFramesDiscarded === 1)
        this.fireNotice(discardedFrameNotice("malformed", codec.protocol));
      return;
    }
    const binary = typeof raw !== "string";
    if (wire !== null) {
      wire.decodeMs += performance.now() - startedAt;
      wire.framesIn++;
      wire.sizeIn += raw.length;
      if (binary) wire.binaryIn++;
    }
    // Discrimination (request/notification/response), routage et corrélation d'id
    // délégués au moteur isomorphe via `receive` (log + welcome + stats + handlers
    // y sont rebranchés). Plus aucune classification dupliquée côté client.
    this.receive(msg, raw.length, binary);
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
