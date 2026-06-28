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
import Websocket from "./transport/websocket";
import Storage from "./api/Storage";
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

class Nodefony {
  private static instance: Nodefony;
  public Service: typeof Service = Service;
  public Container: typeof Container = Container;
  public Syslog: typeof Syslog = Syslog;
  public Pdu: typeof Pdu = Pdu;
  public Websocket: typeof Websocket = Websocket;
  public Storage: typeof Storage = Storage;
  public RealtimeClient: typeof RealtimeClient = RealtimeClient;
  private constructor() {}
  public static getInstance(): Nodefony {
    if (!Nodefony.instance) {
      Nodefony.instance = new Nodefony();
    }
    return Nodefony.instance;
  }
  generateId(): string {
    return globalThis.crypto.randomUUID();
  }
}

export default Nodefony.getInstance();
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
