import Container from "../Container";
import Service from "../Service";
import Syslog from "../syslog/Syslog";
import Pdu, { SEVERITY_NAMES } from "../syslog/Pdu";
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
import { RealtimeClient } from "./realtime/RealtimeClient";
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
  RealtimeOptions,
  MessageStats,
  RealtimeFrame,
  KernelPingResult,
  IApiCallResult,
  // Ré-export DX promis par `RealtimeClient.ts` : le consommateur navigateur
  // type `socket.identity` / la trame de refus depuis le MÊME subpath que le
  // client. Sans ces trois lignes les types n'existent qu'au barrel node, que
  // la condition `browser` ne résout jamais (TS2724 chez le consommateur).
  RealtimeIdentity,
  IRealtimeWelcome,
  IRealtimeDenied,
} from "./realtime/RealtimeClient";
export type { NodefonyNotice, NoticeLevel } from "./realtime/notice";
// Vocabulaire des sévérités RFC 5424 — isomorphe : la console
// d'administration en tirait deux copies locales, dans deux ordres.
export type { Severity, SeverityName } from "../syslog/Pdu";
export type {
  IRealtimePeer,
  RpcActionHandler,
  RpcNotificationHandler,
  JsonRpcFrameKind,
  JsonRpcErrorObject,
  JsonRpcPeerOptions,
} from "../realtime/JsonRpcPeer";
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

// Le contrat du kernel client isomorphe (ADR-0007, `./IClientKernel.ts`) N'EST PAS
// publié : rien ne l'implémente encore, donc rien ne l'a jamais confronté au
// compilateur. Un contrat que personne n'exerce est une promesse invérifiable —
// et celui-ci portait déjà deux défauts que la première implémentation aurait
// révélés (son registre ne pouvait pas nourrir `NodefonyProvider`, et il ne
// savait pas exprimer le re-handshake d'identité de sa propre décision D9).
// Le publier le gelait SemVer : le corriger aurait coûté une majeure, alors que
// l'ajouter une fois exercé ne coûte qu'une mineure.
// La spécification, elle, reste dans le dépôt et vaut toujours.
// Ces quatre types reviennent ici le jour où `createClientKernel()` les exerce —
// `src/tests/clientSurfaceExercised.test.ts` refuse leur retour avant.

/**
 * Génère un identifiant unique (UUID v4) côté client.
 *
 * Named export plat — remplace l'ancienne façade singleton `Nodefony` du barrel
 * client (supprimée par l'ADR-0007 D4 : named exports only, symétrie avec le
 * barrel node où le singleton exporté a déjà été supprimé).
 */
export function generateId(): string {
  return globalThis.crypto.randomUUID();
}

export {
  Service,
  Container,
  Pdu,
  SEVERITY_NAMES,
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
  RealtimeClient,
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
export {
  NODEFONY_CHANNEL_NAMESPACE,
  PLATFORM_CHANNELS,
  PLATFORM_METHODS,
  PLATFORM_EVENTS,
  isPlatformChannel,
} from "../realtime/platformChannels";
export type {
  PlatformChannel,
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
