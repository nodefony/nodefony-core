import { Kernel, Module } from "nodefony";
import { controllers } from "@nodefony/framework";
import config, { type IAiConfigInput } from "./nodefony/config/config";
import { defineAiConfig } from "./nodefony/config/defineModuleConfig";

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
@controllers([])
class AiModule extends Module {
  constructor(kernel: Kernel) {
    super("ai", kernel, import.meta.url, config);
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
  McpGateSeverity,
} from "./nodefony/mcp/gate";
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
export { checkMcpAccess, isLocalAddress } from "./nodefony/mcp/guard";
export type {
  GuardVerdict,
  IGuardInput,
  IGuardPolicy,
} from "./nodefony/mcp/guard";
// La règle « que vaut un appelant sur une porte MCP » — UNE implémentation,
// partagée par toutes les portes.
export { mcpCallerRoles } from "./nodefony/mcp/caller";
export type { IMcpGatePosture } from "./nodefony/mcp/caller";
export {
  mcpText,
  declareMcpTools,
  collectMcpTools,
  mcpDeclaredScopes,
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
