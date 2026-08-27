/// <reference types="node" />
import { Controller, Get, controller, route } from "@nodefony/framework";
import { Context } from "@nodefony/http";
import type { FrontendService } from "@nodefony/frontend";
import { performance } from "node:perf_hooks";

/**
 * Controller POC Angular :
 *  - GET /angular/app       → page HTML qui charge le bundle Angular via Vite
 *  - GET /angular/api/data  → endpoint léger (ping backend) consommé par l'app
 */
@controller("/angular")
class AngularController extends Controller {
  constructor(context: Context) {
    super("AngularController", context);
  }

  /**
   * Page HTML rendue par Nodefony. Le `<body>` contient `<app-root>` ;
   * `main.ts` (injecté via `renderTags`) appelle `bootstrapApplication`.
   * Pas de preamble (spécifique React).
   */
  @Get("/app")
  renderAngular(): unknown {
    this.setContextHtml();
    const svc = this.context?.container?.get("frontend") as
      FrontendService | undefined;
    // CSP émis par le firewall (@nodefony/security) : on propage le nonce de la
    // requête aux <script> (origines Vite déclarées via registerCspOrigins).
    const viteTags =
      svc?.renderTags(
        "test-frontend-angular",
        this.context?.cspNonce,
        this.context?.domain,
      ) ?? "<!-- @nodefony/frontend: service unavailable -->";
    const html = `<!DOCTYPE html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Angular 21 — vitrine temps réel Nodefony</title>
    ${viteTags}
  </head>
  <body>
    <app-root></app-root>
  </body>
</html>`;
    return this.render(html);
  }

  /**
   * Endpoint léger consommé par l'app Angular (poll 1s). JSON minimal.
   */
  // Deux transports pour UNE action : le `@Get` sert la requête HTTP, et
  // `WEBSOCKET` dans `methods` autorise le pont `api.request` à la joindre par
  // la socket. Sans cette déclaration, le pont refuse — une action décide des
  // portes par lesquelles on l'atteint.
  @route("front-angular-api-data", {
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

export default AngularController;
