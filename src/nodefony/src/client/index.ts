import Container from "../Container";
import { randomUuid } from "../runtime/randomUuid";
import Service from "../Service";
import Syslog from "../syslog/Syslog";
import Pdu, { SEVERITY_NAMES, BROWSER_ORIGIN } from "../syslog/Pdu";
import {
  extend,
  isEmptyObject,
  isPlainObject,
  isUndefined,
  isRegExp,
  isContainer,
  typeOf,
  isFunction,
  isArray,
  isPromise,
  isSubclassOf,
} from "../Tools";
import { NodefonySocket } from "./realtime/NodefonySocket";
import { NodefonySse } from "./sse/NodefonySse";
import { SseParser, SseLimitError, SSE_MAX_EVENT_SIZE } from "./sse/SseParser";
import { closeCodeToNotice } from "./realtime/notice";
import { JsonRpcPeer, RpcError } from "../realtime/JsonRpcPeer";
import { TransportState } from "../realtime/IRealtimeTransport";
import { BrowserWsTransport } from "./realtime/BrowserWsTransport";
import { rateChannel, parseRate, isRateChannel } from "../realtime/channelRate";
import { AdaptiveRate, bindAdaptiveChannel } from "./realtime/AdaptiveRate";
import { pduProtocol } from "../syslog/drivers/pduProtocol";
import { pduFlowStep, FLOW_STEPS } from "../syslog/drivers/pduFlow";
export type {
  RealtimeState,
  NodefonySocketOptions,
  MessageStats,
  RealtimeFrame,
  KernelPingResult,
  IApiCallResult,
  // Ré-export DX promis par `NodefonySocket.ts` : le consommateur navigateur
  // type `socket.identity` / la trame de refus depuis le MÊME subpath que le
  // client. Sans ces trois lignes les types n'existent qu'au barrel node, que
  // la condition `browser` ne résout jamais (TS2724 chez le consommateur).
  RealtimeIdentity,
  IRealtimeWelcome,
  IRealtimeDenied,
  // Charge utile de `onReconnect` / `observeReconnect` : l'écran qui rend un
  // compte à rebours doit pouvoir NOMMER ce qu'il reçoit.
  RealtimeReconnectInfo,
} from "./realtime/NodefonySocket";
export type { NodefonyNotice, NoticeLevel } from "./realtime/notice";
// Flux d'événements serveur (SSE) — client et analyseur UNIQUE du format.
export type { NodefonySseOptions } from "./sse/NodefonySse";
export type { ISseEvent, ISseParserHandlers } from "./sse/SseParser";
// Socle agnostique des liaisons SSE (`useNodefonySse`, `injectNodefonySse`,
// `nodefonySse`) : ouverture, état, fermeture — écrits une fois pour les quatre.
export { observeSse, initialSseSnapshot, sseRebindKey } from "./sse/observe";
export type { SseSnapshot, ObserveSseOptions } from "./sse/observe";
// Vocabulaire des sévérités RFC 5424 — isomorphe : la console
// d'administration en tirait deux copies locales, dans deux ordres.
export type { Severity, SeverityName } from "../syslog/Pdu";
export type {
  IRealtimePeer,
  RpcActionHandler,
  RpcNotificationHandler,
  JsonRpcErrorObject,
  JsonRpcPeerOptions,
} from "../realtime/JsonRpcPeer";
// Briques JSON-RPC 2.0 partagées avec le serveur (`jsonrpc/`) : un client qui
// lit un code d'erreur le compare à la MÊME constante que le serveur émet.
export {
  JSON_RPC_VERSION,
  JsonRpcError,
  JsonRpcServerError,
  classifyJsonRpcFrame,
  isJsonRpcId,
  isJsonRpcErrorObject,
  // Fabriques pures : une frame se FABRIQUE, elle ne s'écrit pas à la main
  // (garde `jsonrpcSingleSource.test.ts`) — y compris côté navigateur.
  jsonRpcRequest,
  jsonRpcNotification,
  jsonRpcSuccess,
  jsonRpcFailure,
} from "../jsonrpc/index";
export type {
  JsonRpcId,
  JsonRpcFrameKind,
  IJsonRpcErrorObject,
  IJsonRpcRequest,
  IJsonRpcNotification,
  IJsonRpcSuccess,
  IJsonRpcFailure,
} from "../jsonrpc/index";
export type {
  IRealtimeTransport,
  TransportStateValue,
  RealtimeTransportFactory,
} from "../realtime/IRealtimeTransport";
export type {
  IRealtimeSocket,
  IRealtimeChannel,
  IChannelStats,
  RealtimeHandler,
} from "../realtime/IRealtimeSocket";

// ── Kernel client isomorphe (ADR-0007) ───────────────────────────────────────
// Le contrat REVIENT dans la surface publiée, et son retour est une preuve, pas
// une formalité : `clientSurfaceExercised.test.ts` refuse toute interface
// publiée que rien n'exerce dans le dépôt, et la console d'administration — la
// seule application réelle du dépôt — compose désormais ses services par ce
// noyau, y délègue son cycle d'identité et en nourrit son fournisseur React.
// C'est cet exercice qui a fait tomber quatre défauts qu'aucune relecture
// n'avait vus : le registre typé sur une interface qui ne pouvait pas nourrir
// `NodefonyProvider`, l'absence de toute porte d'entrée pour l'identité (D9
// restait une intention), un membre `log` qui masquait la méthode d'écriture de
// `Service`, et une composition différée au `boot()` alors qu'une application
// câble ses magasins avant de démarrer.
export { NodefonyKernel } from "./NodefonyKernel";
export type {
  NodefonyKernelIdentity,
  NodefonyKernelEvent,
  NodefonyKernelOptions,
  NodefonyKernelState,
  INodefonyKernel,
  NodefonyKernelServices,
} from "./INodefonyKernel";

/**
 * Génère un identifiant unique (UUID v4) côté client.
 *
 * Named export plat — remplace l'ancienne façade singleton `Nodefony` du barrel
 * client (supprimée par l'ADR-0007 D4 : named exports only, symétrie avec le
 * barrel node où le singleton exporté a déjà été supprimé).
 */
export function generateId(): string {
  return randomUuid();
}

export {
  Service,
  Container,
  Pdu,
  SEVERITY_NAMES,
  BROWSER_ORIGIN,
  Syslog,
  extend,
  isEmptyObject,
  isPlainObject,
  isUndefined,
  isRegExp,
  isContainer,
  typeOf,
  isFunction,
  isArray,
  isPromise,
  isSubclassOf,
  NodefonySocket,
  NodefonySse,
  SseParser,
  SseLimitError,
  SSE_MAX_EVENT_SIZE,
  JsonRpcPeer,
  RpcError,
  TransportState,
  BrowserWsTransport,
  closeCodeToNotice,
  rateChannel,
  parseRate,
  isRateChannel,
  AdaptiveRate,
  bindAdaptiveChannel,
  pduProtocol,
  pduFlowStep,
  FLOW_STEPS,
};
// Le contrat de pagination est ISOMORPHE : le serveur rend des `IPage`, le
// navigateur les consomme. Types purs — zéro octet de runtime côté client, et
// une seule définition des deux côtés du fil (une copie front dériverait).
export type { IPage, IPageQuery } from "../types/IPage";
export type { LogProtocol } from "../syslog/drivers/pduProtocol";
export type { FlowStepId, FlowStepMeta } from "../syslog/drivers/pduFlow";
export type { RateBounds } from "../realtime/channelRate";
// Voie MONTANTE des journaux du navigateur (#35) : le transport, la capture des
// erreurs non rattrapées, et les identités de corrélation. Rien n'est installé par
// défaut — une page qui n'appelle pas `installSyslogUplink` ne paie rien (`Syslog`
// ne notifie ses écouteurs que s'il en a).
export { installSyslogUplink, UPLINK_MSGID } from "./syslog/uplink";
export type {
  SyslogUplinkOptions,
  UplinkPublisher,
  UplinkBatch,
  WireLogEntry,
} from "./syslog/uplink";
export {
  installErrorCapture,
  BROWSER_ERROR_MSGID,
  BROWSER_REJECTION_MSGID,
} from "./syslog/errors";
export type { ErrorCaptureOptions } from "./syslog/errors";
export {
  getPageId,
  withRequestId,
  getCurrentRequestId,
  installRequestIdProvider,
  resetClientLogContext,
} from "./syslog/context";
export {
  NODEFONY_CHANNEL_NAMESPACE,
  PLATFORM_CHANNELS,
  PLATFORM_INBOUND,
  PLATFORM_METHODS,
  PLATFORM_EVENTS,
  isPlatformChannel,
} from "../realtime/platformChannels";
export type {
  PlatformChannel,
  PlatformInboundChannel,
  PlatformMethod,
} from "../realtime/platformChannels";
export type {
  RateChangeReason,
  RateDecision,
  AdaptiveRateOptions,
  BindAdaptiveOptions,
  AdaptiveChannelBinding,
  AdaptiveScheduler,
} from "./realtime/AdaptiveRate";
// Socle AGNOSTIQUE des liaisons de vue (`observe*` → `rappel + libération`) : la
// logique de souscription et de cycle qui n'a rien de React, et que les liaisons
// Vue/Angular/Svelte consomment au lieu de la recopier. Cf `./realtime/observe.ts`.
export {
  connectShared,
  observeState,
  observeIdentity,
  observeKernelState,
  observeKernelIdentity,
  observeReconnect,
  observeChannel,
  observeChannelData,
  observeChannelStats,
  observeAdaptiveChannel,
  observeSyslog,
  observeNotices,
  observeNoticeLog,
  observeSnapshot,
  socketSnapshot,
  describeSocket,
  adaptiveRebindKey,
} from "./realtime/observe";
export type {
  Emit,
  Dispose,
  ObservableClient,
  ConnectSharedOptions,
  SharedConnection,
  AdaptiveObserveOptions,
  ObserveSyslogOptions,
  ObserveNoticeLogOptions,
  SocketSnapshot,
  SocketDetailRow,
} from "./realtime/observe";
// Table des événements LOCAUX du client — les portes publiques (`onState`,
// `onIdentity`, `onStats`, `onNotice`, `onDenied`, `onReconnect`) restent à préférer ; la table
// sert aux implémentations et à l'inspection bas niveau.
export { LOCAL_EVENTS, isLocalEvent } from "./realtime/localEvents";
export type { LocalEvent } from "./realtime/localEvents";
// Déroulé de connexion côté navigateur — machine à états PURE, sans interface :
// l'application écrit son balisage, le déroulé porte les règles (étapes, second
// facteur, blocage, fournisseurs, passkey). Les liaisons de vue relaient son état.
export { NodefonyLogin, observeLogin } from "./auth/NodefonyLogin";
export type {
  NodefonyLoginOptions,
  NodefonyLoginState,
  NodefonyLoginError,
  NodefonyLoginProvider,
  NodefonyLoginUser,
  NodefonyPasskeyAgent,
  LoginStep,
  LoginErrorKind,
} from "./auth/NodefonyLogin";
export {
  AUTH_API_BASE,
  WEBAUTHN_API_BASE,
  OAUTH2_API_BASE,
  AUTH_LOGIN_PATH,
  AUTH_LOGIN_TOTP_PATH,
  AUTH_LOGOUT_PATH,
  AUTH_ME_PATH,
  WEBAUTHN_LOGIN_OPTIONS_PATH,
  WEBAUTHN_LOGIN_VERIFY_PATH,
  OAUTH2_PROVIDERS_PATH,
  oauth2AuthorizePath,
  LOGIN_PAGE_PATH,
  LOGIN_PAGE_ASSETS_BASE,
  LOGIN_PAGE_SCRIPT_PATH,
  LOGIN_PAGE_STYLE_PATH,
  LOGIN_PAGE_LAYOUTS,
} from "../runtime/authRoutes";
export type {
  LoginPageLayout,
  ILoginPageProvider,
  ILoginPageDescription,
} from "../runtime/authRoutes";
export { safeRedirectPath } from "../runtime/safeRedirect";
export {
  SESSION_AUTH_AT_KEY,
  SESSION_AMR_KEY,
  readSessionAuthentication,
} from "../runtime/sessionAuthentication";
export type { ISessionAuthentication } from "../runtime/sessionAuthentication";
