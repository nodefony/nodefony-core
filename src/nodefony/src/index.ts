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
export type {
  IGuardedEmitOptions,
  IGuardedEmitResult,
  IGuardedEmitError,
  IGuardedListenerInfo,
} from "./Event";
export { default as Cli } from "./Cli";
export { SysExit } from "./cli/sysexits";
export { default as Command } from "./command/Command";
export { default as Builder } from "./command/Builder";

// ─── Logging ──────────────────────────────────────────────────────────────────
export { default as Syslog } from "./syslog/Syslog";
export { NULL_LOG_SINK } from "./syslog/Syslog";
export type { ILogSink } from "./syslog/Syslog";
export { default as Pdu } from "./syslog/Pdu";
// Gate couleur ANSI des logs (résolue au boot) — payloads bruts hors TTY.
export { logColor, setLogColor, isLogColorEnabled } from "./syslog/logColor";
export { FileSink } from "./syslog/sinks/FileSink";
export type { FileSinkOptions } from "./syslog/sinks/FileSink";
// Log Backplane (LB.0/LB.1) — axe DESTINATION queryable (≠ ILogSink write texte).
export { pduToRecord } from "./syslog/drivers/ILogDriver";
export type {
  ILogDriver,
  ILogDriverCapabilities,
  ILogDriverProbe,
  ILogQueryCriteria,
  ILogQueryResult,
  ILogRecord,
  IPduLike,
} from "./syslog/drivers/ILogDriver";
export { filterPdus } from "./syslog/drivers/filterPdus";
export { pduProtocol } from "./syslog/drivers/pduProtocol";
export type { LogProtocol } from "./syslog/drivers/pduProtocol";
export { pduFlowStep, FLOW_STEPS } from "./syslog/drivers/pduFlow";
export type { FlowStepId, FlowStepMeta } from "./syslog/drivers/pduFlow";
export { createMemoryLogDriver } from "./syslog/drivers/MemoryLogDriver";
export { createFileLogDriver } from "./syslog/drivers/FileLogDriver";
export type { FileLogDriverOptions } from "./syslog/drivers/FileLogDriver";
export { createLokiLogDriver } from "./syslog/drivers/LokiLogDriver";
export type { LokiLogDriverOptions } from "./syslog/drivers/LokiLogDriver";
export { createOpenSearchLogDriver } from "./syslog/drivers/OpenSearchLogDriver";
export type { OpenSearchLogDriverOptions } from "./syslog/drivers/OpenSearchLogDriver";
export type { FetchLike } from "./syslog/httpFetch";
export {
  registerLogDriver,
  setActiveLogDriver,
  getActiveLogDriver,
  getLogDriver,
  listLogDrivers,
  registerLogDriverFactory,
  getLogDriverFactory,
  listLogDriverFactories,
} from "./syslog/drivers/logDriverRegistry";
export type {
  ILogDriverFactory,
  ILogDriverContext,
  ILogDriverMount,
  ILogConfigLike,
} from "./syslog/drivers/logDriverRegistry";
export { registerBuiltinLogDrivers } from "./syslog/drivers/builtinLogDrivers";
export {
  ConsoleTransport,
  FileTransport,
  HttpTransport,
  SyslogTransport,
  BatchingHttpTransport,
  LokiTransport,
  OpenSearchTransport,
} from "./syslog/transports/index";
export type {
  FileTransportOptions,
  HttpTransportOptions,
  BatchTransportOptions,
  BatchTransportStats,
  LokiTransportOptions,
  OpenSearchTransportOptions,
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
  FrameAuditReason,
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
export { expectType } from "./realtime/RealtimeEventMap";
export type {
  EventsMap,
  ActionsMap,
  DefaultEventsMap,
  DefaultActionsMap,
  EventNames,
  EventPayload,
  ActionNames,
  ActionParams,
  ActionResult,
  TypedRpcActionHandler,
} from "./realtime/RealtimeEventMap";

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
export { resolveTopology, loadClusterConfig } from "./service/cluster/topology";
export { ProcessProbe } from "./service/cluster/processProbe";
export type { IProcessHealth } from "./service/cluster/processProbe";
export { RichProcessProbe } from "./service/cluster/richProcessProbe";
export type { IProcessRich } from "./service/cluster/richProcessProbe";
export {
  setOrmHealthProvider,
  readOrmHealth,
  setOrmRichProvider,
  readOrmRich,
} from "./service/cluster/instanceProbe";
export type {
  IOrmLeanHealth,
  IInstanceErrorHealth,
} from "./service/cluster/instanceProbe";
export type {
  WorkersSetting,
  IClusterConfig,
  Topology,
  TopologySource,
  ResolveTopologyOptions,
} from "./service/cluster/topology";
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
  CLUSTER_PROBE_CTL_KIND,
  CLUSTER_PROBE_ENRICH_KIND,
  isClusterMessage,
  isClusterProbeCtl,
  isClusterProbeEnrich,
} from "./service/cluster/clusterMessage";
export type {
  IClusterMessage,
  IClusterProbeCtl,
  IClusterProbeEnrich,
  ClusterProbeFacet,
} from "./service/cluster/clusterMessage";

// ─── Runtime (P1.4 — AsyncLocalStorage) ───────────────────────────────────────
export { default as RequestContext } from "./runtime/RequestContext";
export type {
  RequestContextPayload,
  IProfilerQuery,
} from "./runtime/RequestContext";
export { redactSecrets } from "./runtime/redact";
export { loadEnv } from "./runtime/loadEnv";
export type { ILoadEnvOptions } from "./runtime/loadEnv";
export { withTimeout, TimeoutError } from "./runtime/withTimeout";

// ─── ORM ──────────────────────────────────────────────────────────────────────
export { default as Orm } from "./kernel/orm/Orm";
export { default as Entity } from "./kernel/orm/Entity";
export { default as Connector } from "./kernel/orm/Connector";

// ─── Decorators ───────────────────────────────────────────────────────────────
export {
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

// ─── Config (defineConfig — back-only, zod peerDep core, D1) ──────────────────
// Absent du barrel browser (src/client/index.ts) → 0 zod côté client.
export { defineConfig, isConfigDescriptor } from "./config/defineConfig";
export type { AppConfigDescriptor } from "./config/defineConfig";
export { defaultAppConfig } from "./config/defaults";
export { appConfigSchema, validateAppConfig } from "./config/schema";
export type { AppConfig } from "./config/schema";
export { configReactivity, getConfigReactivity } from "./config/reactivity";
export type { Reactivity } from "./config/reactivity";
export type {
  AppConfigInput,
  ResolvedAppConfig,
  ConfigInput,
  ConfigContext,
  KnownModule,
  ModuleEntryInput,
  ModuleManifestInput,
  AppMeta,
  ServersConfig,
  HttpServerConfig,
  HttpsServerConfig,
  LogConfig,
  LogFileConfig,
  LogDestinationConfig,
} from "./config/types";

// ─── Types & Interfaces ───────────────────────────────────────────────────────
export type { IKernel, KernelNetworkResult } from "./types/IKernel";
export type {
  IModuleManifest,
  IModuleManifestEntry,
  ModulePolicy,
} from "./types/IModuleManifest";
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
  ServiceWithInit,
  ServiceConstructor,
  EntityConstructor,
  TypeKernelOptions,
} from "./kernel/Kernel";

export type { OptionsCommandInterface } from "./command/Command";

// ─── Branchement Node-only : ALS → Pdu.requestId (corrélation log↔requête) ────
// Le bundle browser/client (src/client/index.ts) NE RÉ-EXPORTE PAS ce fichier
// et n'importe donc PAS `node:async_hooks`. Le provider reste `null` côté
// browser → 0 alloc, 0 lecture. Coût ajouté côté Node : ~50-100 ns par Pdu
// (lecture ALS + accès `.requestId`), gratuit hors bulle RequestContext.
// Cf [[project_syslog_requestid_correlation]].
import _PduForBranching from "./syslog/Pdu";
import _RequestContextForBranching from "./runtime/RequestContext";
_PduForBranching.requestIdProvider = () =>
  _RequestContextForBranching.getRequestId();
