/// <reference types="node" />
import { Controller, Get, Post, Body, controller } from "@nodefony/framework";
import { Context } from "@nodefony/http";
import type { FrontendService } from "@nodefony/frontend";
import {
  readStatsSnapshot,
  readGitBranch,
  type AppMeta,
} from "../realtime/providers";

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
 *
 * Le streaming des logs passe désormais par le canal WS `syslog:stream`
 * (`StudioRealtimeController`, JSON-RPC 2.0). L'ancien endpoint SSE
 * `/studio/api/logs/stream` a été retiré (mort + cassé en HTTP/2 : `flushHeaders`
 * inexistant sur Http2ServerResponse → `code=000`). Cf `feedback_sse_http2_request_close`.
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
    // Coquille = `frontend/index.html` du module (le head/meta/externals y vivent),
    // tags injectés par @nodefony/frontend (dev = Vite, prod = manifest). Plus de
    // shell codé en dur ici → un dev personnalise son index.html sans toucher au core.
    const html =
      svc?.renderDocument("studio") ??
      "<!DOCTYPE html><!-- @nodefony/studio: frontend service unavailable -->";
    return this.render(html);
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

  /**
   * SPA fallback profondeur 2 — deep-link / refresh sur le drill-down d'un worker du
   * cluster : `cluster/:pid` (ex `/nodefony/cluster/12345`). Même règle que `modules/:name` :
   * segment littéral `cluster` (PAS de générique `/{section}/{page}` qui masquerait les
   * routes des autres modules sous `/nodefony/<x>/<y>`).
   */
  @Get("/cluster/{pid}")
  renderSpaFallbackCluster(): unknown {
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
   * Snapshot ONE-SHOT des sondes process (PATRON sondes+hub) — pendant HTTP du
   * canal realtime `dashboard:supervision`. Permet à la Supervision d'afficher des
   * valeurs RÉELLES quand le temps réel est désactivé (défaut, pour la perf),
   * sans ouvrir de flux WS. CPU% + event-loop échantillonnés sur une courte
   * fenêtre (~150 ms) ; `gc` null (nécessite un observer dans la durée).
   */
  @Get("/studio/api/stats")
  async apiStats() {
    const k = this.kernel;
    const meta: AppMeta = {
      name: k?.projectName,
      version: k?.version,
      env: k?.environment,
      debug: Boolean(k?.debug),
      branch: readGitBranch(),
    };
    return this.renderJson(await readStatsSnapshot(meta));
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
      return (
        decodeURIComponent(token.slice(MOCK_TOKEN_PREFIX.length)) || "admin"
      );
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
}

export default StudioController;
