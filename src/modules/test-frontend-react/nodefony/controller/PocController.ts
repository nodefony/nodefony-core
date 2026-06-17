/// <reference types="node" />
import { Controller, Get, controller } from "@nodefony/framework";
import { Context } from "@nodefony/http";
import type { FrontendService } from "@nodefony/frontend";
import { performance } from "node:perf_hooks";

/**
 * Controller POC :
 *  - GET /react/app       → page HTML qui charge le bundle React via Vite
 *  - GET /react/api/data  → endpoint léger pour bench p99 backend (autocannon/curl)
 *  - GET /react/api/burn  → endpoint qui simule un travail CPU sync (calibration)
 */
@controller("/react")
class PocController extends Controller {
  constructor(context: Context) {
    super("PocController", context);
  }

  /**
   * Page HTML rendue par Nodefony. Le `<head>` inclut les balises `<script>`
   * Vite via `FrontendService.renderTags("test-frontend-react")`.
   *
   * En dev avec Vite spawné, le browser charge `http://127.0.0.1:5173/src/main.tsx`
   * directement → backend Node n'est PAS sur le chemin critique des assets.
   */
  @Get("/app")
  renderReact(): unknown {
    this.setContextHtml();
    const svc = this.context?.container?.get("frontend") as
      | FrontendService
      | undefined;
    // CSP : le firewall (@nodefony/security) émet désormais le CSP (nonce + origines
    // Vite déclarées via registerCspOrigins). On ne fait que propager le nonce de la
    // requête aux <script> rendus → satisfait `script-src 'nonce-…'`.
    const viteTags =
      svc?.renderTags("test-frontend-react", this.context?.cspNonce) ??
      "<!-- @nodefony/frontend: service unavailable -->";
    const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Nodefony POC — React via @nodefony/frontend</title>
    ${viteTags}
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;
    return this.render(html);
  }

  /**
   * Endpoint léger pour bencher la latence backend pendant que Vite compile/HMR.
   * Renvoie un JSON minimal — pas de DB, pas de I/O, juste perf.now().
   */
  @Get("/api/data")
  apiData() {
    return this.renderJson({
      ts: performance.now(),
      pid: process.pid,
      env: this.kernel?.environment,
    });
  }

  /**
   * Endpoint calibration : brûle CPU pendant ms (synchrone) pour valider
   * que la mesure de latence détecte un freeze event-loop. NE PAS BENCHER ICI.
   */
  @Get("/api/burn/{ms}")
  apiBurn() {
    const ms = parseInt(String(this.queryGet?.ms ?? "100"), 10);
    const start = Date.now();
    // Spin lock — bloque l'event-loop. Pour calibration uniquement.
    while (Date.now() - start < ms) {
      /* burn */
    }
    return this.renderJson({ burnedMs: Date.now() - start });
  }
}

export default PocController;
