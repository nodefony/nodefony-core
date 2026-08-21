// @nodefony/core — barrel ESM
// import { Kernel, Service, Container, Syslog, ... } from "@nodefony/core"

// ─── Framework ────────────────────────────────────────────────────────────────
export { Nodefony } from "./Nodefony";
export { default as Kernel } from "./kernel/Kernel";
export { default as Module } from "./kernel/Module";
export { BootConfigurationError } from "./kernel/BootConfigurationError";
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
export { default as clc } from "./colors";
export type { ColorFn, Clc } from "./colors";
export { SysExit } from "./cli/sysexits";
// Rendu de la page de manuel, publié parce qu'une APPLICATION en a l'usage :
// ses commandes de module ne peuvent figurer dans la page du framework, et
// elle seule peut donc rendre la sienne. Publier la fonction évite qu'un
// projet réécrive un générateur roff à côté du nôtre.
export { renderManPage, escapeRoff, MAN_PAGE_NAME } from "./cli/manPage";
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
export {
  default as JsonRpcPeer,
  RpcError,
  RpcEnvelope,
} from "./realtime/JsonRpcPeer";
export type {
  IRealtimePeer,
  RpcActionHandler,
  RpcNotificationHandler,
  RpcMeta,
  RpcTracedResult,
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
export {
  NODEFONY_CHANNEL_NAMESPACE,
  PLATFORM_CHANNELS,
  PLATFORM_METHODS,
  PLATFORM_EVENTS,
  isPlatformChannel,
  startsWithCI,
} from "./realtime/platformChannels";
export type {
  PlatformChannel,
  PlatformMethod,
} from "./realtime/platformChannels";
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
  RealtimeIdentity,
  IRealtimeWelcome,
  IRealtimeDenied,
} from "./realtime/RealtimeEventMap";

// ─── Errors ───────────────────────────────────────────────────────────────────
export { default as nodefonyError, registerErrorAdapter } from "./Error";
export type { IErrorAdapter } from "./Error";

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
export { GcScheduler } from "./runtime/GcScheduler";
export type { IGcSchedulerOptions } from "./runtime/GcScheduler";

// ─── Decorators ───────────────────────────────────────────────────────────────
export {
  injectable,
  inject,
  services,
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
  stripTrailingSlashes,
  escapeRegExp,
} from "./Tools";

// ─── Config (defineConfig — back-only, zod peerDep core, D1) ──────────────────
// Absent du barrel browser (src/client/index.ts) → 0 zod côté client.
export { defineConfig, isConfigDescriptor } from "./config/defineConfig";
export type { AppConfigDescriptor } from "./config/defineConfig";
export { use } from "./config/use";
export type { NodefonyModuleConfig, ConfigOf, UseOptions } from "./config/use";
export {
  defineEnv,
  envString,
  envNumber,
  envBoolean,
  envEnum,
  getEnvCatalog,
} from "./config/defineEnv";
export type {
  EnvVarKind,
  EnvVarMeta,
  NamedEnvVarMeta,
} from "./config/defineEnv";
export { renderEnvExample } from "./config/envExample";
export { defaultAppConfig } from "./config/defaults";
export { parseNfEnvOverrides, applyResolvedPath } from "./config/envOverride";
export type { NfEnvOverride } from "./config/envOverride";
export {
  computeConfigProvenance,
  extractJsonSchemaDefaults,
} from "./config/configProvenance";
export type { ConfigOrigin } from "./config/configProvenance";
export {
  appConfigSchema,
  appConfigJsonSchema,
  validateAppConfig,
} from "./config/schema";
export type { AppConfig } from "./config/schema";
export { configReactivity, getConfigReactivity } from "./config/reactivity";
export type { Reactivity } from "./config/reactivity";
export type { IConfigFieldMeta } from "./config/configMeta";
export {
  resolveInfra,
  resolveAutoStore,
  deriveStoreBackend,
  readStoreLocation,
  parseDatabaseUrl,
  sqliteFilenameFromUrl,
  AUTO_STORE,
  EMPTY_INFRA,
} from "./config/infra";
export type {
  IInfra,
  IInfraDatabase,
  IInfraCache,
  IInfraLogs,
  IAutoStoreResolution,
  IStoreResolution,
  StoreProvenance,
  InfraSqlDialect,
  DatabaseFamily,
  StoreKind,
  InfraEnvSource,
} from "./config/infra";
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
  IAdminPageCapabilities,
  IAdminDescriptor,
  IAdminRequest,
  IAdminResponse,
  AdminHandler,
  AdminHttpMethod,
} from "./types/IAdminApi";
// Lecture de l'état de l'application par le plan d'administration — la table
// des sujets et sa résolution, partagées par TOUTES les portes (commande
// `inspect`, serveur MCP du devkit). Une seule table, sinon elles divergent.
export {
  INSPECT_SUBJECTS,
  readAdminSubject,
  unwrapAdminResult,
} from "./kernel/inspect/adminSubjects";
export type {
  IInspectSubject,
  IAdminBrokerLike,
  InspectFailure,
  InspectResult,
} from "./kernel/inspect/adminSubjects";
export type {
  IIdempotencyStore,
  IIdempotencyKeyEntry,
  IIdempotencyListQuery,
  IdempotencyOutcome,
  IdempotentResponse,
} from "./types/IIdempotencyStore";
export type { IPage, IPageQuery, ISortableSource } from "./types/IPage";
export {
  assertPageQuery,
  PaginationModeError,
  CursorOrderError,
} from "./runtime/pageGuard";
export type { PaginationMode } from "./runtime/pageGuard";
export {
  parsePageQuery,
  PageQueryError,
  PAGE_QUERY_KEYS,
} from "./runtime/pageQuery";
export {
  compareByOrder,
  pickOrder,
  renameOrderFields,
} from "./runtime/pageSort";
export type { FieldReader } from "./runtime/pageSort";
export type {
  PageQuerySource,
  IParsePageQueryOptions,
} from "./runtime/pageQuery";
export { parseFilters } from "./runtime/pageFilters";
export type {
  FilterKind,
  FilterDef,
  IFilterSpec,
  FilterValue,
  FilterValues,
  IParseFiltersOptions,
} from "./runtime/pageFilters";
export {
  countFacets,
  facetDimensions,
  UNKNOWN_COUNT,
} from "./runtime/pageFacets";
export type { FacetCount, FacetCounts, IFacetSpec } from "./runtime/pageFacets";
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

export { SEVERITY_NAMES } from "./syslog/Pdu";
export type { Message, Msgid, Pci, Severity, SeverityName } from "./syslog/Pdu";

export type {
  FamilyType,
  KernelEventsType,
  NetworkInterface,
  FilterInterface,
  ServiceWithInit,
  ServiceConstructor,
  TypeKernelOptions,
} from "./kernel/Kernel";

export type {
  IBootReport,
  IBootFailure,
  IBootServerInfo,
  IBootModuleGated,
} from "./kernel/bootReport";

export type { OptionsCommandInterface } from "./command/Command";

// ─── Introspection des process de DÉVELOPPEMENT (ps + sonde ports + pidfile) ──
// Node-only (spawn `ps`, sonde TCP) — absent du bundle browser (src/client). Source
// de vérité PARTAGÉE entre la CLI (`nodefony status`) et le data plane Studio
// (`GET /nodefony/kernel/api/processes`) → même topologie affichée des deux côtés.
export {
  collectDevStatus,
  buildDevStatus,
} from "./service/dev/devStatusReport";
export type { DevStatusReport } from "./service/dev/devStatusReport";
export {
  detectRuntimeMode,
  runtimeModes,
  findRuntimeConflict,
  // State file runtime — le serveur PUBLIE ses ports effectifs (`@nodefony/http`
  // l'écrit après le listen), `status`/`stop`/readiness les LISENT. Sans ce canal,
  // `servers.portPolicy: "auto"` rendrait ces outils aveugles (ils sondaient
  // `[5151, 5152]` en dur).
  writeRuntimeState,
  readRuntimeState,
  clearRuntimeState,
  defaultDevPorts,
  // Verrou de génération de code — le serveur DIT au superviseur dev « je suis en train
  // d'écrire, ne me redémarre pas ». Sans lui, un scaffold (qui écrit dans `nodefony/` et
  // `index.ts`, précisément là où le watcher regarde) déclenche un redémarrage AU MILIEU
  // du job et tue le `npm install` en cours.
  suspendSupervisor,
  resumeSupervisor,
  readSupervisorSuspension,
  // Arrêt d'un ARBRE de process — implémentation UNIQUE du dépôt (groupe POSIX /
  // `taskkill /T` Windows). Exposée parce que tout superviseur d'enfants en a besoin
  // hors du cœur (Vite et son service esbuild) : la recopier ailleurs ferait
  // réapparaître, dans le paquet suivant, l'angle mort qu'on vient de fermer ici.
  signalProcessGroup,
} from "./service/dev/devProcess";
export type {
  DevProcessInfo,
  DevProcessRole,
  RuntimeMode,
  PortState,
  RuntimeState,
  SupervisorLock,
  TreeSignalOutcome,
} from "./service/dev/devProcess";

// ─── Scaffold (création app/module/…) : spec déclarative + moteur PUR ─────────
// Trois fronts, UN moteur : CLI rapide (argv), CLI interactif (readline) et le
// futur data plane Studio (`GET spec` en JSON → formulaire → `POST run`). La
// spec est 100 % JSON-able ; runScaffold n'a aucune I/O terminal.
export { getScaffoldSpec } from "./cli/scaffold/spec";
export type {
  IScaffoldQuestion,
  IScaffoldTypeSpec,
  TFrontendChoice,
  TPresetChoice,
} from "./cli/scaffold/spec";
export {
  runScaffold,
  resolveAnswers,
  listTargets,
  findProjectRoot,
  scaffoldCaps,
  getScaffoldContext,
} from "./cli/scaffold/engine";
export type {
  IScaffoldContext,
  IScaffoldConnector,
} from "./cli/scaffold/engine";
// Où une app créée DEPUIS LE WEB a le droit de naître. En CLI la destination est le
// `cwd` (l'utilisateur est chez lui) ; par le réseau, elle doit être RECOMPOSÉE côté
// serveur sous une racine autorisée — un endpoint qui écrit au chemin qu'on lui donne
// écrit aussi dans `/etc`.
export {
  resolveScaffoldDestination,
  isSafeSubPath,
  isInsideRoot,
  ScaffoldDestinationError,
  APP_NAME_RE,
} from "./cli/scaffold/destination";
export type { IScaffoldRoot } from "./cli/scaffold/destination";
export type {
  IScaffoldRequest,
  IScaffoldResult,
  IScaffoldRunOptions,
  IScaffoldCaps,
  IScaffoldTarget,
  TScaffoldAnswers,
} from "./cli/scaffold/engine";
// Simulation : `runScaffold(…, { dryRun: true })` rend le PLAN au lieu d'écrire.
// Le diff est calculé ici et non par chaque front, pour que la préview d'un
// front décrive exactement l'exécution qui suivra.
export { diffLines } from "./cli/scaffold/writer";
export type { IScaffoldChange, IDiffLine } from "./cli/scaffold/writer";
// Étapes post-écriture (install/build/typecheck) : décrites une fois, exécutées
// par le CLI comme par Studio — chacun à sa façon de les montrer.
export {
  SCAFFOLD_STEPS,
  SCAFFOLD_STEP_COMMANDS,
  SCAFFOLD_STEP_LABELS,
  isScaffoldStep,
} from "./cli/scaffold/steps";
export type { TScaffoldStep } from "./cli/scaffold/steps";

// ─── Carte de visite de l'application : UNE composition, DEUX portes ──────────
// La CLI (`nodefony card`, standalone 0-boot) et le module `@nodefony/devkit`
// (route HTTP, Kernel en marche) rendent la MÊME carte. Elle vit au cœur parce
// qu'elle doit répondre sur une application non construite ou lancée sans
// `NODE_ENV` — une capacité qui doit tenir sans installation ne peut pas
// dépendre d'un module.
// Le graphe symbolique : UNE résolution (projet, puis framework installé) pour
// tous ses lecteurs — la commande `symbols` et le data plane doc du framework.
// Un chemin en dur de chaque côté est ce qui l'avait rendu introuvable dans une
// application installée depuis npm.
export {
  resolveSymbolsFile,
  readSymbolsGraph,
  lookupSymbol,
  runSymbolsCommand,
} from "./cli/symbols";
export type { ISymbolEntry, ISymbolsGraph } from "./cli/symbols";

// ─── Rôle SERVEUR DE RESSOURCE OAuth 2.1 — protocole seul, aucune crypto ──────
// Publier ce qu'on protège (RFC 9728), refuser en disant où obtenir un jeton
// (RFC 6750), et lier ce jeton à CETTE ressource (RFC 8707). Rien ici ne valide
// une signature : cela demande un fournisseur de clés et une politique, qui
// vivent dans `@nodefony/security` — d'où le contrat `IAccessTokenVerifier`,
// que la porte consomme sans connaître son implémentation.
// ⚠️ Volontairement HORS de `mcp/` : le Model Context Protocol n'en est que le
// premier consommateur. Une porte agentique de production ou une API d'agents
// (P12) protégeront leurs propres chemins avec les mêmes fonctions — la RFC 9728
// prévoit plusieurs ressources par hôte par insertion de chemin.
export {
  canonicalResourceUri,
  protectedResourceMetadataPath,
  protectedResourceMetadataUrl,
  buildProtectedResourceMetadata,
  buildBearerChallenge,
  authorizeProtectedResource,
  missingScopes,
  BearerError,
  ACCESS_TOKEN_VERIFIER,
} from "./oauth/protectedResource";
export type {
  IProtectedResourceMetadata,
  IProtectedResourceInput,
  IProtectedResourcePolicy,
  IAccessPrincipal,
  IAccessTokenVerifier,
  ProtectedResourceOutcome,
  IBearerChallenge,
  BearerErrorCode,
} from "./oauth/protectedResource";
// Lecture d'un en-tête `Authorization: Bearer` — au cœur parce que DEUX couches
// qui ne se voient pas la partagent (les authentificateurs de `@nodefony/security`
// et la porte MCP). Une copie n'aurait pas divergé bruyamment : elle aurait
// divergé sur un cas limite que chaque copie continue de passer.
export { bearerToken } from "./runtime/bearer";

// ─── Rôle SERVEUR D'AUTORISATION OAuth (RFC 8414) — les DEUX faces ────────────
// Lire les métadonnées d'un émetteur tiers (pour découvrir ses clés) et publier
// les siennes (pour que d'autres découvrent les nôtres). Au cœur pour la même
// raison que `bearerToken` : deux couches qui ne se voient pas partagent le
// chemin bien connu — `@nodefony/security` le compose pour LIRE, et
// `@nodefony/framework`, qui n'importe jamais `security`, sert la route qui
// PUBLIE. Deux copies produiraient un `404` que chacun interpréterait comme
// « pas d'autorisation ici ».
export {
  canonicalIssuer,
  authorizationServerMetadataPath,
  issuerMetadataUrls,
  validateIssuerMetadata,
  buildAuthorizationServerMetadata,
  extractScopes,
  JWKS_PATH,
} from "./oauth/authorizationServer";
export type {
  IIssuerMetadata,
  IAuthorizationServerMetadata,
  IAuthorizationServerInput,
} from "./oauth/authorizationServer";

// ─── Model Context Protocol — le PROTOCOLE au cœur, la PORTE dans un module ───
// Tout ce qui suit est PUR : traitement d'un message, gardes de transport,
// catalogue intégré, collecte des outils qu'une application déclare. Rien n'y
// touche au socket. C'est ce qui permet à `@nodefony/devkit` d'exposer
// `POST /nodefony/mcp` en développement, et à un futur module de porter la même
// chose ailleurs — sans qu'aucun des deux ne réécrive une ligne de protocole.
// La règle « 1 règle = 1 implémentation » n'a pas d'autre forme ici : deux
// serveurs MCP qui redéclareraient leurs codes d'erreur divergeraient en
// silence, chacun passant ses propres tests.
export {
  MCP_PROTOCOL_VERSION,
  MCP_SUPPORTED_VERSIONS,
  MCP_DEFAULT_NEGOTIATED_VERSION,
  MCP_ENDPOINT_PATH,
  META_PROTOCOL_VERSION,
  META_SERVER_INFO,
  JsonRpcError,
  McpProtocolError,
  jsonRpcSuccess,
  jsonRpcFailure,
  isNotification,
} from "./mcp/protocol";
export type {
  IJsonRpcMessage,
  IJsonRpcSuccess,
  IJsonRpcFailure,
  IMcpHttpReply,
  JsonRpcId,
} from "./mcp/protocol";
export { handleMcpMessage } from "./mcp/server";
export type { IMcpServerContext, IMcpHeaders } from "./mcp/server";
export { checkMcpAccess, isLocalAddress } from "./mcp/guard";
export type { GuardVerdict, IGuardInput, IGuardPolicy } from "./mcp/guard";
export {
  mcpText,
  builtinMcpTools,
  collectMcpTools,
  publishMcpTools,
  callMcpTool,
  BUILTIN_MCP_TOOL_KEYS,
} from "./mcp/tools";
export type {
  IMcpTool,
  IMcpToolDefinition,
  IMcpToolResult,
  IMcpToolDeps,
  IMcpCaller,
  IMcpCollectOptions,
  BuiltinMcpToolKey,
} from "./mcp/tools";

// Câblage MCP — composition PURE (le fichier `.mcp.json` qu'un agent lit) et
// son adaptateur, côté CLI (`nodefony ai:mcp`).
export {
  buildMcpUrl,
  planMcpConfig,
  renderMcpPlan,
  MCP_CONFIG_FILE,
  MCP_SERVER_KEY,
} from "./cli/aiMcpReport";
export type {
  IMcpConfigDocument,
  IMcpConfigPlan,
  IMcpServerEntry,
  McpConfigAction,
} from "./cli/aiMcpReport";
export { runAiMcpCommand, guessOrigin } from "./cli/aiMcp";

// Hooks git natifs — composition PURE (contenu des hooks, plan, refus) et son
// adaptateur (`nodefony git:hooks`) : core.hooksPath, zéro dépendance.
export {
  GIT_HOOKS_DIR,
  GIT_HOOKS_MARKER,
  GIT_HOOK_NAMES,
  renderGitHook,
  planGitHooks,
  renderGitHooksPlan,
} from "./cli/gitHooksReport";
export type {
  GitHookName,
  GitHookAction,
  HooksPathAction,
  IPlannedGitHook,
  IGitHooksPlan,
} from "./cli/gitHooksReport";
export { runGitHooksCommand, installGitHooks } from "./cli/gitHooks";

// Diagnostic statique — la COLLECTE, séparée de son rendu, pour que la commande
// `check` et le serveur MCP du devkit rendent le même document.
export {
  collectCheckReport,
  countCheckFindings,
} from "./kernel/checks/runCheck";
export type { ICheckReport } from "./kernel/checks/runCheck";

export { buildCard, renderCard } from "./cli/cardReport";
export type {
  ICard,
  ICardAppInfo,
  ICardDoor,
  ICardInput,
  ICardVerb,
  CardSource,
} from "./cli/cardReport";

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
