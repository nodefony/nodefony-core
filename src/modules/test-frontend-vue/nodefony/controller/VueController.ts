/// <reference types="node" />
import { Controller, Get, controller, route } from "@nodefony/framework";
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
      FrontendService | undefined;
    // CSP émis par le firewall (@nodefony/security) : on propage le nonce de la
    // requête aux <script> (origines Vite déclarées via registerCspOrigins).
    const viteTags =
      svc?.renderTags(
        "test-frontend-vue",
        this.context?.cspNonce,
        this.context?.domain,
      ) ?? "<!-- @nodefony/frontend: service unavailable -->";
    const html = `<!DOCTYPE html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Vue 3 — vitrine temps réel Nodefony</title>
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
  // Deux transports pour UNE action : le `@Get` sert la requête HTTP, et
  // `WEBSOCKET` dans `methods` autorise le pont `api.request` à la joindre par
  // la socket. Sans cette déclaration, le pont refuse — une action décide des
  // portes par lesquelles on l'atteint.
  @route("front-vue-api-data", {
    path: "/api/data",
    requirements: { methods: ["GET", "WEBSOCKET"] },
  })
  apiData() {
    return this.renderJson({
      ts: performance.now(),
      pid: process.pid,
      env: this.kernel?.environment,
    });
  }
}

export default VueController;
