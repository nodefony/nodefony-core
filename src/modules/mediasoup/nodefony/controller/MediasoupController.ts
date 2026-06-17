/// <reference types="node" />
import { Controller, Get, controller } from "@nodefony/framework";
import { Context } from "@nodefony/http";
import type { FrontendService } from "@nodefony/frontend";
import { performance } from "node:perf_hooks";

/**
 * Controller du module `mediasoup` (front Vue **non implémenté** — build prêt) :
 *  - GET `/mediasoup/`         → page HTML qui charge le bundle Vue 3 via Vite
 *  - GET `/mediasoup/api/data` → endpoint léger (ping backend) pour le front futur
 *
 * Le modèle de données vit dans `nodefony/entity/schema.ts` (connecteur Drizzle
 * `mediasoup`) et se visualise dans Studio (ERD).
 */
@controller("/mediasoup")
class MediasoupController extends Controller {
  constructor(context: Context) {
    super("MediasoupController", context);
  }

  /** Page HTML : injecte les balises Vite du bundle `mediasoup`. Vue se monte dans `main.ts`. */
  @Get("/")
  renderApp(): unknown {
    this.setContextHtml();
    const svc = this.context?.container?.get("frontend") as
      | FrontendService
      | undefined;
    // CSP émis par le firewall (@nodefony/security) : on propage le nonce de la
    // requête aux <script> (origines Vite déclarées via registerCspOrigins).
    const viteTags =
      svc?.renderTags("mediasoup", this.context?.cspNonce) ??
      "<!-- @nodefony/frontend: service unavailable -->";
    const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Nodefony — mediasoup (Vue 3)</title>
    ${viteTags}
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>`;
    return this.render(html);
  }

  /** Endpoint léger (ping backend) destiné au front futur. Pas de DB, pas d'I/O. */
  @Get("/api/data")
  apiData() {
    return this.renderJson({
      ts: performance.now(),
      pid: process.pid,
      env: this.kernel?.environment,
      module: "mediasoup",
    });
  }
}

export default MediasoupController;
