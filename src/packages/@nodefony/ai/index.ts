import { Kernel, Module } from "nodefony";
import { controllers } from "@nodefony/framework";
import config, { type IAiConfigInput } from "./nodefony/config/config";
import { defineAiConfig } from "./nodefony/config/defineModuleConfig";
import StdioCommand from "./nodefony/command/StdioCommand";

/**
 * @nodefony/ai — La boîte à outils IA de Nodefony : serveur MCP, puis les services de la couche agentique.
 *
 * Module applicatif : un workspace npm à part entière
 * (`src/packages/@nodefony/ai/`), chargé par le manifeste `modules` de
 * `nodefony.config.ts`. Le Kernel l'importe PAR SON NOM (`@nodefony/ai`) —
 * d'où le workspace, qui le rend résolvable.
 */

/**
 * Rend la config du module typée à l'appel : `use("@nodefony/ai", { … })`
 * dans `nodefony.config.ts` propose les clés du schéma et refuse les fautes de
 * frappe, au lieu d'avaler un `Record<string, unknown>`.
 */
declare module "nodefony" {
  interface NodefonyModuleConfig {
    "@nodefony/ai": IAiConfigInput;
  }
}

// Les controllers du module se déclarent ici — `nodefony create controller <nom>
// --module ai` les ajoute à cette liste (et à ce dossier) tout seul.
/**
 * Module `@nodefony/ai` : le serveur MCP du framework et les services de la couche agentique.
 *
 * @experimental Paquet EXPÉRIMENTAL : il suit la spécification MCP, qui change
 * de forme à chaque révision. Son API peut donc changer dans une version
 * mineure de la série 10, toujours annoncé au changelog — politique de
 * compatibilité, § « Surfaces expérimentales ». Livré, publié et utilisable
 * comme les autres : seule la promesse est plus légère.
 */
@controllers([])
class AiModule extends Module {
  constructor(kernel: Kernel) {
    super("ai", kernel, import.meta.url, config);
    this.addCommand(StdioCommand);
  }

  /**
   * Valide la config au boot — défauts du schéma fusionnés avec ce que l'app
   * passe dans `use()`. Une clé inconnue ou mal typée plante ICI, avec le champ
   * fautif nommé, plutôt qu'en `undefined.x` au premier appel en production.
   */
  override async onKernelRegister(): Promise<this> {
    this.options = defineAiConfig(this.options);
    return this;
  }
}

export default AiModule;

// Type d'ENTRÉE de la config — c'est lui que le registre enregistre ci-dessus.
// Sans ce ré-export, `nodefony.config.ts` ne peut pas le nommer, donc pas faire
// entrer l'augmentation dans son programme : `use("@nodefony/ai", { … })`
// accepterait alors n'importe quelle clé, que Zod retirerait en silence au boot.
export type { IAiConfigInput } from "./nodefony/config/config";

export {
  aiConfigSchema,
  mcpConfigSchema,
  type IAiConfig,
  type IMcpConfig,
} from "./nodefony/config/config";
export {
  defineAiConfig,
  aiConfigJsonSchema,
} from "./nodefony/config/defineModuleConfig";

// ─── Model Context Protocol — la boîte à outils ───────────────────────────────
// Tout ce qui suit est PUR : traitement d'un message, gardes de transport,
// collecte et appel des outils qu'une application déclare. Rien n'y touche au
// socket — une porte (HTTP, stdio, appel en process) n'apporte que le
// transport. Deux serveurs MCP qui redéclareraient leurs codes d'erreur
// divergeraient en silence : une seule source, ici.
export {
  MCP_PROTOCOL_VERSION,
  MCP_SUPPORTED_VERSIONS,
  MCP_DEFAULT_NEGOTIATED_VERSION,
  META_PROTOCOL_VERSION,
  META_SERVER_INFO,
  McpProtocolError,
  // Briques JSON-RPC du cœur, ré-exportées : un serveur MCP les trouve ici
  // sans savoir qu'elles sont partagées avec le temps réel.
  JsonRpcError,
  jsonRpcSuccess,
  jsonRpcFailure,
  isNotification,
} from "./nodefony/mcp/protocol";
export type {
  IMcpHttpReply,
  JsonRpcId,
  IJsonRpcMessage,
  IJsonRpcSuccess,
  IJsonRpcFailure,
  McpProtocolVersion,
} from "./nodefony/mcp/protocol";
export { handleMcpMessage } from "./nodefony/mcp/server";
export type {
  IMcpServerContext,
  IMcpHeaders,
  IMcpTransport,
  IServerInfo,
  IMcpCacheHints,
} from "./nodefony/mcp/server";
// La porte HTTP — la mécanique, sans la route : une porte se DÉFINIT une fois
// (`defineMcpGate`) et se sert d'une action de controller (`gate.serve`).
export {
  defineMcpGate,
  mcpGateSchema,
  MCP_STREAM_MAX_EVENT_BYTES,
} from "./nodefony/mcp/gate";
export type {
  IMcpGate,
  IMcpGateDefinition,
  IMcpGateSettings,
  IMcpGateRequest,
  IMcpGateRuntime,
  IMcpGateResponse,
  IMcpStdioRequest,
  McpGateSeverity,
} from "./nodefony/mcp/gate";
// Le transport stdio — un client qui lance lui-même son serveur MCP.
export { serveMcpStdio } from "./nodefony/mcp/stdio";
export type { IMcpStdioOptions } from "./nodefony/mcp/stdio";
export {
  createProgressReporter,
  readProgressToken,
  MCP_PROGRESS_MIN_INTERVAL_MS,
  MCP_PROGRESS_MESSAGE_MAX,
} from "./nodefony/mcp/progress";
export type {
  IMcpProgressReporter,
  McpProgressToken,
} from "./nodefony/mcp/progress";
export {
  createMcpResponseStream,
  MCP_STREAM_GRACE_MS,
} from "./nodefony/mcp/stream";
export type {
  IMcpEventSink,
  IMcpResponseStream,
  IMcpResponseStreamOptions,
} from "./nodefony/mcp/stream";
export {
  checkMcpAccess,
  isLocalAddress,
  isRelayedRequest,
  RELAY_HEADERS,
} from "./nodefony/mcp/guard";
export type {
  GuardVerdict,
  IGuardInput,
  IGuardPolicy,
} from "./nodefony/mcp/guard";
// Niveau 2 : la session par ticket, au nom de laquelle un outil tire de vraies
// requêtes HTTP vers l'application.
export {
  SESSION_TICKET_HEADER,
  SESSION_TICKET_LENGTH,
  SESSION_TICKET_MAX_PENDING,
  SESSION_TICKET_TTL_MS,
  SessionTicketStore,
  fingerprintSessionTicket,
} from "./nodefony/mcp/sessionTicket";
export type { ISessionTicketStoreOptions } from "./nodefony/mcp/sessionTicket";
export {
  TICKET_SESSION_REFUSED,
  defineTicketSessionGate,
  isSessionFlowView,
  isSessionServiceView,
  openTicketSession,
  readTicketSessionVerdict,
  ticketSessionGateSchema,
  toTicketSessionUser,
} from "./nodefony/mcp/ticketSession";
export type {
  ISessionFlowView,
  ISessionServiceView,
  ITicketSessionDeps,
  ITicketSessionGate,
  ITicketSessionGateDefinition,
  ITicketSessionGateSettings,
  ITicketSessionRequest,
  ITicketSessionUser,
  TicketSessionVerdict,
} from "./nodefony/mcp/ticketSession";
// La règle « que vaut un appelant sur une porte MCP » — UNE implémentation,
// partagée par toutes les portes.
export { mcpCallerRoles } from "./nodefony/mcp/caller";
export type { IMcpGatePosture } from "./nodefony/mcp/caller";
export {
  mcpText,
  declareMcpTools,
  collectMcpTools,
  mcpDeclaredScopes,
  mcpCallScopes,
  insufficientScopeMessage,
  publishMcpTools,
  callMcpTool,
  MCP_TEXT_MAX_CHARS,
  MCP_RESERVED_PREFIX,
} from "./nodefony/mcp/tools";
export type {
  IMcpTool,
  IMcpToolAnnotations,
  IMcpToolDefinition,
  IMcpToolResult,
  IMcpCaller,
  IMcpToolRun,
  IMcpDeclareOptions,
  IMcpCollectOptions,
} from "./nodefony/mcp/tools";
export { AiError } from "./nodefony/src/errors/AiError";
