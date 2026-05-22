/// <reference types="node" />
import { Controller, Get, Post, Body, controller } from "@nodefony/framework";
import { Context } from "@nodefony/http";
import type { FrontendService } from "@nodefony/frontend";

/**
 * Rôles applicatifs Studio (MOCK). ⚠️ Doivent rester alignés avec
 * `frontend/src/auth/dashboards.ts` — la source de vérité passera à
 * @nodefony/security (P6, firewall + voters).
 */
const ROLE_NODEFONY_ADMIN = "ROLE_NODEFONY_ADMIN";
const ROLE_DEV = "ROLE_DEV";
const ROLE_SUPERVISOR = "ROLE_SUPERVISOR";

/** Préfixe du token mock : porte le username (relu par /auth/me au reload). */
const MOCK_TOKEN_PREFIX = "mock-jwt.";

/**
 * Mappe un username mock → ses rôles, pour exercer le routage par rôle SANS le
 * firewall P6 : `dev` → dashboard dev, `supervisor` → supervision, tout autre
 * compte (dont `admin`) → les deux. Rôles dérivés **côté serveur** (le token ne
 * porte que le username) — aucune confiance au client, même en mock.
 */
function mockRolesFor(username: string): string[] {
  switch (username.trim().toLowerCase()) {
    case "dev":
      return [ROLE_NODEFONY_ADMIN, ROLE_DEV];
    case "sup":
    case "supervisor":
      return [ROLE_NODEFONY_ADMIN, ROLE_SUPERVISOR];
    default:
      return [ROLE_NODEFONY_ADMIN, ROLE_DEV, ROLE_SUPERVISOR];
  }
}

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
  @Get("/")
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
  @Get("/{page}")
  renderSpaFallback(): unknown {
    return this.renderStudio();
  }

  /**
   * SPA fallback profondeur 2 — deep-link / refresh sur la seule page React à
   * deux segments : `modules/:name` (ex `/nodefony/modules/core`). Sans lui, un
   * F5 sur cette URL tombait sur le 404 backend.
   *
   * ⚠️ Segment littéral `modules` (PAS un générique `/{section}/{page}`) :
   * d'autres modules montent de vraies routes sous `/nodefony/<x>/<y>` (ex le
   * module test : `/nodefony/test/index`). Un fallback générique les masquerait
   * (régression). On ne capture donc QUE le préfixe SPA connu. Toute nouvelle
   * page SPA à ≥2 segments → ajouter son fallback littéral ici.
   */
  @Get("/modules/{name}")
  renderSpaFallbackDeep(): unknown {
    return this.renderStudio();
  }

  @Get("/studio/api/health")
  apiHealth() {
    return this.renderJson({
      status: "ok",
      uptime: process.uptime(),
      pid: process.pid,
    });
  }

  @Get("/studio/api/info")
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
  @Post("/studio/api/auth/login")
  apiLogin(@Body() body: { username?: string }) {
    const username = (body?.username ?? "admin").trim() || "admin";
    return this.renderJson({
      token: `${MOCK_TOKEN_PREFIX}${encodeURIComponent(username)}`,
      user: {
        id: 1,
        username,
        roles: mockRolesFor(username),
        email: `${username}@nodefony.local`,
      },
    });
  }

  @Get("/studio/api/auth/me")
  apiMe() {
    const username = this.mockUsername();
    return this.renderJson({
      id: 1,
      username,
      roles: mockRolesFor(username),
      email: `${username}@nodefony.local`,
    });
  }

  /** Username déduit du token mock (en-tête Authorization), repli `admin`. */
  private mockUsername(): string {
    const raw = (
      this.context as {
        request?: { headers?: Record<string, string | string[] | undefined> };
      }
    )?.request?.headers?.authorization;
    const header = Array.isArray(raw) ? raw[0] : raw;
    if (typeof header !== "string") return "admin";
    const token = header.replace(/^Bearer\s+/i, "");
    if (!token.startsWith(MOCK_TOKEN_PREFIX)) return "admin";
    try {
      return decodeURIComponent(token.slice(MOCK_TOKEN_PREFIX.length)) || "admin";
    } catch {
      return "admin";
    }
  }

  @Post("/studio/api/auth/logout")
  apiLogout() {
    return this.renderJson({ ok: true });
  }

  /**
   * Stub `@nodefony/client` realtime endpoint info.
   * Le client front lit ça pour savoir où ouvrir le WebSocket.
   * Sera relié à P13.4 RealtimeService + P13.7 JSON-RPC.
   */
  @Get("/studio/api/realtime/info")
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
  @Get("/studio/api/logs/stream")
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
