import Container from "../Container";
import Service from "../Service";
import Syslog from "../syslog/Syslog";
import Pdu from "../syslog/Pdu";
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

// Contrat du kernel client isomorphe (ADR-0007) — types-only, 0 octet de runtime.
// L'implémentation (`createClientKernel`) arrive en Phase 3.2.
export type {
  IClientKernel,
  NodefonyClientServices,
  ClientKernelEvent,
  ClientKernelState,
} from "./IClientKernel";

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
export type { LogProtocol } from "../syslog/drivers/pduProtocol";
export type { FlowStepId, FlowStepMeta } from "../syslog/drivers/pduFlow";
export type { RateBounds } from "../realtime/channelRate";
export type {
  RateChangeReason,
  RateDecision,
  AdaptiveRateOptions,
  BindAdaptiveOptions,
  AdaptiveChannelBinding,
  AdaptiveScheduler,
} from "./realtime/AdaptiveRate";
