import type { ContextType } from "../../../service/http-kernel.js";
import type WebsocketContext from "./WebsocketContext.js";

/**
 * Dit si un contexte sert une connexion WebSocket — la garde qui rétrécit
 * `ContextType` à `WebsocketContext` sans conversion.
 *
 * Elle lit le type de serveur posé à la construction du contexte, jamais
 * `instanceof` : deux copies installées de `@nodefony/http` font échouer
 * `instanceof` en silence, quand ce champ dit vrai pour les deux. Deux
 * comparaisons de chaînes, aucune allocation.
 *
 * @param context - le contexte à éprouver.
 * @returns `true` si le contexte vient d'un serveur `websocket` ou
 *   `websocket-secure`.
 */
export function isWebsocketContext(
  context: ContextType,
): context is WebsocketContext {
  return context.type === "websocket" || context.type === "websocket-secure";
}
