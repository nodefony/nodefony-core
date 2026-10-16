<% if (it.oauth) { %>import { Service, Module, injectable } from "nodefony";
import type { IProtectedResourceInput } from "nodefony";
import { <%= it.camel %>Gate } from "../mcp/<%= it.kebab %>-gate";

/**
 * Publie le document de ressource protégée (RFC 9728) de la porte MCP
 * `<%= it.route %>` — celui que l'en-tête `WWW-Authenticate` d'un `401` désigne.
 *
 * Sans lui, la porte refuserait bien l'appel sans jeton, mais l'agent ne
 * trouverait pas où l'obtenir : l'adresse annoncée répondrait `404`.
 * `@nodefony/framework` monte le document de tout service qui expose
 * `publishedProtectedResources()` ; ce service ne fait que le déclarer.
 */
@injectable()
class <%= it.pascal %>GateService extends Service {
  module: Module;

  constructor(module: Module) {
    super(
      "<%= it.camel %>Gate",
      module.container ?? undefined,
      module.notificationsCenter,
    );
    this.module = module;
  }

  /** Ce que la porte protège : son URI, ses serveurs d'autorisation, ses scopes. */
  publishedProtectedResources(): readonly IProtectedResourceInput[] {
    return <%= it.camel %>Gate.protectedResources();
  }
}

export default <%= it.pascal %>GateService;
<% } %>
