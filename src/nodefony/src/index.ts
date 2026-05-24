// @nodefony/core — barrel ESM
// import { Kernel, Service, Container, Syslog, ... } from "@nodefony/core"

// ─── Framework ────────────────────────────────────────────────────────────────
export { Nodefony } from "./Nodefony";
export { default as Kernel } from "./kernel/Kernel";
export { default as Module } from "./kernel/Module";
export { default as CliKernel } from "./kernel/CliKernel";
export { default as Service } from "./Service";
export { default as Container } from "./Container";
export { default as Event } from "./Event";
export { default as Cli } from "./Cli";
export { default as Command } from "./command/Command";
export { default as Builder } from "./command/Builder";

// ─── Logging ──────────────────────────────────────────────────────────────────
export { default as Syslog } from "./syslog/Syslog";
export { default as Pdu } from "./syslog/Pdu";
export {
  ConsoleTransport,
  FileTransport,
  HttpTransport,
  SyslogTransport,
} from "./syslog/transports/index";
export type {
  FileTransportOptions,
  HttpTransportOptions,
} from "./syslog/transports/index";

// ─── Realtime (protocole JSON-RPC 2.0 isomorphe) ───────────────────────────────
export { default as JsonRpcPeer } from "./realtime/JsonRpcPeer";
export type {
  IRealtimePeer,
  RpcActionHandler,
  RpcNotificationHandler,
  JsonRpcFrameKind,
  JsonRpcErrorObject,
  JsonRpcPeerOptions,
} from "./realtime/JsonRpcPeer";
export { TransportState } from "./realtime/IRealtimeTransport";
export type {
  IRealtimeTransport,
  TransportStateValue,
  RealtimeTransportFactory,
} from "./realtime/IRealtimeTransport";
export type {
  IRealtimeSocket,
  IRealtimeChannel,
  IChannelStats,
  RealtimeHandler,
} from "./realtime/IRealtimeSocket";
export { rateChannel, parseRate, isRateChannel } from "./realtime/channelRate";
export type { RateBounds } from "./realtime/channelRate";

// ─── Errors ───────────────────────────────────────────────────────────────────
export { default as nodefonyError } from "./Error";

// ─── Finder / Files ───────────────────────────────────────────────────────────
export { default as Finder } from "./finder/Finder";
export { default as File } from "./finder/File";
export { default as Result } from "./finder/Result";
export { default as FileClass } from "./FileClass";
export { default as FileResult } from "./finder/FileResult";

// ─── Services ─────────────────────────────────────────────────────────────────
export { default as Fetch } from "./service/fetchService";
export { default as GitService } from "./service/gitService";
export type { GitInfo } from "./service/gitService";
export { default as Injector } from "./kernel/injector/injector";

// ─── Cluster (mode multi-process sans PM2 — cgroup-aware) ─────────────────────
export {
  resolveWorkerCount,
  readCgroupCpuQuota,
} from "./service/cluster/cpuQuota";
export type {
  ResolveWorkerOptions,
  FileReader,
} from "./service/cluster/cpuQuota";
export {
  ClusterManager,
  computeBackoff,
} from "./service/cluster/ClusterManager";
export type {
  ClusterManagerOptions,
  IClusterRuntime,
  IClusterWorker,
  ClusterScheduler,
} from "./service/cluster/ClusterManager";
export { ClusterRelay } from "./service/cluster/ClusterRelay";
export type {
  IRelayWorker,
  ClusterRelayOptions,
} from "./service/cluster/ClusterRelay";
export { ClusterProbeAggregator } from "./service/cluster/ClusterProbeAggregator";
export type {
  IProbeWorker,
  ClusterProbeAggregatorOptions,
} from "./service/cluster/ClusterProbeAggregator";
export {
  CLUSTER_RT_KIND,
  CLUSTER_PROBE_KIND,
  CLUSTER_PROBE_SNAPSHOT_KIND,
  isClusterMessage,
} from "./service/cluster/clusterMessage";
export type { IClusterMessage } from "./service/cluster/clusterMessage";

// ─── Runtime (P1.4 — AsyncLocalStorage) ───────────────────────────────────────
export { default as RequestContext } from "./runtime/RequestContext";
export type {
  RequestContextPayload,
  IProfilerQuery,
} from "./runtime/RequestContext";
export { redactSecrets } from "./runtime/redact";

// ─── ORM ──────────────────────────────────────────────────────────────────────
export { default as Orm } from "./kernel/orm/Orm";
export { default as Entity } from "./kernel/orm/Entity";
export { default as Connector } from "./kernel/orm/Connector";

// ─── Decorators ───────────────────────────────────────────────────────────────
export {
  modules,
  injectable,
  inject,
  services,
  entities,
} from "./kernel/decorators/kernelDecorator";
export type { DIScope, InjectableOptions } from "./kernel/injector/injector";

// ─── Utilities ────────────────────────────────────────────────────────────────
export {
  extend,
  typeOf,
  isPromise,
  isEmptyObject,
  isPlainObject,
  isUndefined,
  isRegExp,
  isContainer,
  isFunction,
  isArray,
} from "./Tools";

// ─── Types & Interfaces ───────────────────────────────────────────────────────
export type { IKernel, KernelNetworkResult } from "./types/IKernel";
export type {
  IService,
  DefaultOptionsService,
  EventListener,
} from "./types/IService";
export type { IContainer, IScope } from "./types/IContainer";
export type { IModule } from "./types/IModule";
export type {
  IAdminApi,
  IAdminRegistry,
  IAdminEndpoint,
  IAdminDescriptor,
  IAdminRequest,
  IAdminResponse,
  AdminHandler,
  AdminHttpMethod,
} from "./types/IAdminApi";
export type { ISyslog } from "./types/ISyslog";
export type { ITransport } from "./types/ITransport";
export type { EnvironmentType, DebugType } from "./types/globals";

export type {
  DynamicParam,
  DynamicService,
  Scopes,
  ProtoService,
  ProtoParameters,
} from "./Container";
export { Scope } from "./Container";

export type { Message, Msgid, Pci, Severity } from "./syslog/Pdu";

export type {
  FamilyType,
  KernelEventsType,
  NetworkInterface,
  FilterInterface,
  ServiceWithInitialize,
  ServiceConstructor,
  EntityConstructor,
  TypeKernelOptions,
} from "./kernel/Kernel";

export type { OptionsCommandInterface, CommandEvents } from "./command/Command";
