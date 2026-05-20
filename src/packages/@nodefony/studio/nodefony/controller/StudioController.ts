/// <reference types="node" />
import { Controller, route, controller } from "@nodefony/framework";
import { Context } from "@nodefony/http";
import type { FrontendService } from "@nodefony/frontend";

/**
 * Controller Studio admin.
 *
 * Partition du namespace réservé `/nodefony` (cf CLAUDE.md du module) :
 *  - `/nodefony` + `/nodefony/{page}` (mono-segment) → pages SPA Studio (humain).
 *    N'existent QUE si le module Studio est chargé ; le framework boote sans.
 *  - `/nodefony/<module>/api/*` (≥3 segments, marqueur `/api/`) → data plane admin,
 *    porté par chaque module indépendamment de Studio (consommable aussi en CLI/curl).
 *  Le fallback SPA mono-segment ne masque jamais une route API (toujours ≥3 segments).
 *
 * Routes UI :
 *  - GET  /nodefony            → page HTML qui charge le bundle React via Vite
 *  - GET  /nodefony/{page}     → SPA fallback
 *
 * Routes API Studio — mocks "catégorie 3" hébergés ici faute de mieux. Sémantiquement
 * ils appartiennent à d'autres modules et migreront vers leur `/nodefony/<module>/api/*` :
 *  - GET  /nodefony/studio/api/health        → ping (cible : kernel)
 *  - GET  /nodefony/studio/api/info          → infos runtime (cible : kernel)
 *  - POST /nodefony/studio/api/auth/login    → mock login (cible : @nodefony/security P6)
 *  - GET  /nodefony/studio/api/auth/me       → mock user (cible : @nodefony/security P6)
 *  - POST /nodefony/studio/api/auth/logout   → mock logout (cible : @nodefony/security P6)
 *  - GET  /nodefony/studio/api/realtime/info → URL WS @nodefony/client (cible : P13)
 *  - GET  /nodefony/studio/api/logs/stream   → SSE Pdu syslog (cible : core syslog)
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

  @route("studio-api-health", { path: "/studio/api/health" })
  apiHealth() {
    return this.renderJson({
      status: "ok",
      uptime: process.uptime(),
      pid: process.pid,
    });
  }

  @route("studio-api-info", { path: "/studio/api/info" })
  apiInfo() {
    return this.renderJson({
      name: "Nodefony Studio",
      version: "10.0.0-poc.1",
      env: this.kernel?.environment,
      debug: Boolean(this.kernel?.debug),
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
  @route("studio-api-login", { path: "/studio/api/auth/login", method: "POST" })
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

  @route("studio-api-me", { path: "/studio/api/auth/me" })
  apiMe() {
    return this.renderJson({
      id: 1,
      username: "admin",
      roles: ["ROLE_NODEFONY_ADMIN"],
      email: "admin@nodefony.local",
    });
  }

  @route("studio-api-logout", { path: "/studio/api/auth/logout", method: "POST" })
  apiLogout() {
    return this.renderJson({ ok: true });
  }

  /**
   * Stub `@nodefony/client` realtime endpoint info.
   * Le client front lit ça pour savoir où ouvrir le WebSocket.
   * Sera relié à P13.4 RealtimeService + P13.7 JSON-RPC.
   */
  @route("studio-api-realtime-info", { path: "/studio/api/realtime/info" })
  apiRealtimeInfo() {
    return this.renderJson({
      wsUrl: "/nodefony/studio/api/realtime", // StudioRealtimeController (WS JSON-RPC 2.0)
      protocol: "jsonrpc-2.0",
      heartbeatInterval: 30000,
      available: true, // endpoint WS live ; migrera vers RealtimeService en P13.4
    });
  }

  /**
   * Streaming SSE des Pdu du Syslog kernel.
   *
   * Vision P14.11 isomorphe : chaque Pdu est sérialisé en JSON et envoyé
   * au browser, qui le rehydrate via `new Pdu()` + `parseJson()` — la même
   * classe Pdu importée depuis `nodefony` (Core isomorphe).
   *
   * Format SSE : `data: <pdu json>\n\n`. Heartbeat `: ping` toutes les 15s.
   * Cleanup auto sur client close → removeListener du syslog.
   *
   * TODO P13.4 : déplacer dans un endpoint WS dédié + canal pub/sub.
   */
  @route("studio-api-logs-stream", { path: "/studio/api/logs/stream" })
  async apiLogsStream(): Promise<void> {
    const httpResp = this.context?.response as
      | { response?: { setHeader: (k: string, v: string) => void; write: (s: string) => boolean; flushHeaders?: () => void; once: (e: string, fn: () => void) => void } }
      | undefined;
    const rawRes = httpResp?.response;
    if (!rawRes || !this.syslog) return;

    rawRes.setHeader("Content-Type", "text/event-stream");
    rawRes.setHeader("Cache-Control", "no-cache, no-transform");
    rawRes.setHeader("X-Accel-Buffering", "no");
    rawRes.flushHeaders?.();
    rawRes.write(": connected\n\n");

    const onLog = (pdu: unknown) => {
      try {
        rawRes.write(`data: ${JSON.stringify(pdu)}\n\n`);
      } catch {
        /* socket closed during write */
      }
    };
    this.syslog.on("onLog", onLog);
    this.log("SSE handler connected", "INFO");

    const heartbeat = setInterval(() => {
      try {
        rawRes.write(": ping\n\n");
      } catch {
        /* socket closed */
      }
    }, 15000);

    // En HTTP/2, `request.on("close")` fire dès la fin du stream REQUEST
    // (client a fini d'envoyer ses headers, pas de body) — bien avant la
    // fermeture du stream response. Écouter "close" sur la RESPONSE qui
    // reste ouverte tant que SSE émet.
    await new Promise<void>((resolve) => {
      const cleanup = () => {
        clearInterval(heartbeat);
        this.syslog?.off?.("onLog", onLog);
        resolve();
      };
      rawRes.once("close", cleanup);
      rawRes.once("error", cleanup);
    });
  }
}

export default StudioController;
