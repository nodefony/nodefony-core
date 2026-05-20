/// <reference types="node" />
import { Controller, Get, controller } from "@nodefony/framework";
import { Context } from "@nodefony/http";
import type { FrontendService } from "@nodefony/frontend";
import { performance } from "node:perf_hooks";

/**
 * Controller POC Vue :
 *  - GET /vue/app       → page HTML qui charge le bundle Vue 3 via Vite
 *  - GET /vue/api/data  → endpoint léger (ping backend) consommé par l'app Vue
 */
@controller("/vue")
class VueController extends Controller {
  constructor(context: Context) {
    super("VueController", context);
  }

  /**
   * Page HTML rendue par Nodefony. Le `<head>` inclut les balises `<script>`
   * Vite via `FrontendService.renderTags("test-frontend-vue")` — pas de
   * preamble (spécifique React) : Vue se monte seul dans `main.ts`.
   */
  @Get("/app")
  renderVue(): unknown {
    this.setContextHtml();
    const svc = this.context?.container?.get("frontend") as
      | FrontendService
      | undefined;
    // Override la CSP par défaut (`script-src 'self'`) sinon les scripts Vite
    // (5173) sont bloqués cross-origin → page blanche.
    if (svc) {
      this.context?.response?.setHeader(
        "Content-Security-Policy",
        svc.getCspDirectives(),
      );
    }
    const viteTags = svc?.renderTags("test-frontend-vue")
      ?? "<!-- @nodefony/frontend: service unavailable -->";
    const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Nodefony POC — Vue 3 via @nodefony/frontend</title>
    ${viteTags}
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>`;
    return this.render(html);
  }

  /**
   * Endpoint léger consommé par l'app Vue (poll 1s). Renvoie un JSON minimal —
   * pas de DB, pas d'I/O.
   */
  @Get("/api/data")
  apiData() {
    return this.renderJson({
      ts: performance.now(),
      pid: process.pid,
      env: this.kernel?.environment,
    });
  }
}

export default VueController;
