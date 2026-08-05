/// <reference types="node" />
import { Controller, Get, controller } from "@nodefony/framework";
import { Context } from "@nodefony/http";
import type { FrontendService } from "@nodefony/frontend";
import { performance } from "node:perf_hooks";

/**
 * Controller POC Svelte :
 *  - GET /svelte/app       → page HTML qui charge le bundle Svelte 5 via Vite
 *  - GET /svelte/api/data  → endpoint léger (ping backend) consommé par l'app Svelte
 */
@controller("/svelte")
class SvelteController extends Controller {
  constructor(context: Context) {
    super("SvelteController", context);
  }

  /**
   * Page HTML rendue par Nodefony. Le `<head>` inclut les balises `<script>`
   * Vite via `FrontendService.renderTags("test-frontend-svelte")` — pas de
   * preamble (spécifique React) : Svelte se monte seul dans `main.ts`.
   */
  @Get("/app")
  renderSvelte(): unknown {
    this.setContextHtml();
    const svc = this.context?.container?.get("frontend") as
      FrontendService | undefined;
    // CSP émis par le firewall (@nodefony/security) : on propage le nonce de la
    // requête aux <script> (origines Vite déclarées via registerCspOrigins).
    const viteTags =
      svc?.renderTags("test-frontend-svelte", this.context?.cspNonce) ??
      "<!-- @nodefony/frontend: service unavailable -->";
    const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Nodefony POC — Svelte 5 via @nodefony/frontend</title>
    ${viteTags}
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>`;
    return this.render(html);
  }

  /**
   * Endpoint léger consommé par l'app Svelte (poll 1s). Renvoie un JSON
   * minimal — pas de DB, pas d'I/O.
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

export default SvelteController;
