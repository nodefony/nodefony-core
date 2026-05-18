/// <reference types="node" />
import { Controller, route, controller } from "@nodefony/framework";
import { Context } from "@nodefony/http";
import type { FrontendService } from "@nodefony/frontend";

/**
 * Controller Studio admin.
 *
 * Routes UI :
 *  - GET  /nodefony            → page HTML qui charge le bundle React via Vite
 *
 * Routes API (mock — sera relié à @nodefony/security en P6) :
 *  - GET  /nodefony/api/health        → ping serveur
 *  - GET  /nodefony/api/info          → infos runtime
 *  - POST /nodefony/api/auth/login    → mock login (accepte tout)
 *  - GET  /nodefony/api/auth/me       → mock user courant
 *  - POST /nodefony/api/auth/logout   → mock logout
 *  - GET  /nodefony/api/realtime/info → URL WS pour @nodefony/client futur
 */
@controller("/nodefony")
class StudioController extends Controller {
  constructor(context: Context) {
    super("StudioController", context);
  }

  /** Page HTML — entrypoint Studio. */
  @route("studio-index", { path: "/" })
  renderStudio(): unknown {
    this.setContextHtml();
    const svc = this.context?.container?.get("frontend") as
      | FrontendService
      | undefined;
    // CSP override pour Vite cross-origin (POC). TODO P14.14 : @nodefony/security.
    if (svc) {
      this.context?.response?.setHeader(
        "Content-Security-Policy",
        svc.getCspDirectives(),
      );
    }
    const viteTags =
      svc?.renderTags("studio") ??
      "<!-- @nodefony/studio: frontend service unavailable -->";
    return this.render(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="dark light" />
    <title>Nodefony Studio</title>
    ${viteTags}
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`);
  }

  /** SPA fallback — toute route /nodefony/<page> retourne la même page React. */
  @route("studio-spa-fallback", { path: "/{page}" })
  renderSpaFallback(): unknown {
    return this.renderStudio();
  }

  @route("studio-api-health", { path: "/api/health" })
  apiHealth() {
    return this.renderJson({
      status: "ok",
      uptime: process.uptime(),
      pid: process.pid,
    });
  }

  @route("studio-api-info", { path: "/api/info" })
  apiInfo() {
    return this.renderJson({
      name: "Nodefony Studio",
      version: "10.0.0-poc.1",
      env: this.kernel?.environment,
      pid: process.pid,
      node: process.version,
      platform: process.platform,
      memory: process.memoryUsage(),
    });
  }

  /**
   * Mock login — accepte n'importe quoi pour le POC.
   * Sera remplacé par P6 (@nodefony/security firewall + AuthBridge).
   */
  @route("studio-api-login", { path: "/api/auth/login", method: "POST" })
  apiLogin() {
    const body = (this.context as { body?: { username?: string } })?.body ?? {};
    const username = body.username ?? "admin";
    return this.renderJson({
      token: `mock-jwt-${Date.now()}`,
      user: {
        id: 1,
        username,
        roles: ["ROLE_NODEFONY_ADMIN"],
        email: `${username}@nodefony.local`,
      },
    });
  }

  @route("studio-api-me", { path: "/api/auth/me" })
  apiMe() {
    return this.renderJson({
      id: 1,
      username: "admin",
      roles: ["ROLE_NODEFONY_ADMIN"],
      email: "admin@nodefony.local",
    });
  }

  @route("studio-api-logout", { path: "/api/auth/logout", method: "POST" })
  apiLogout() {
    return this.renderJson({ ok: true });
  }

  /**
   * Stub `@nodefony/client` realtime endpoint info.
   * Le client front lit ça pour savoir où ouvrir le WebSocket.
   * Sera relié à P13.4 RealtimeService + P13.7 JSON-RPC.
   */
  @route("studio-api-realtime-info", { path: "/api/realtime/info" })
  apiRealtimeInfo() {
    return this.renderJson({
      wsUrl: "/nodefony/api/realtime", // TODO P13 : vrai endpoint WS
      protocol: "jsonrpc-2.0",
      heartbeatInterval: 30000,
      available: false, // false tant que P13 pas implémenté
    });
  }
}

export default StudioController;
