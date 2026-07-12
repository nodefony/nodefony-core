import { Controller, route, controller } from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";
import type { FrontendService } from "@nodefony/frontend";

/**
 * Sert la page HTML de l'app <%= it.frontend %> — les tags Vite (`renderTags`)
 * branchent le bon mode tout seuls : scripts HMR en dev, bundle pré-compilé en
 * prod. CSP : c'est le firewall (@nodefony/security) qui l'émet quand il est
 * chargé — le controller ne fait que PROPAGER le nonce de la requête aux
 * `<script>` rendus (satisfait `script-src 'nonce-…'`).
 */
@controller("")
class AppController extends Controller {
  constructor(context: ContextType) {
    super("app-front", context);
  }

  @route("route-app-index", { path: "/", method: "GET" })
  renderApp(): unknown {
    this.setContextHtml();
    const svc = this.context?.container?.get("frontend") as
      | FrontendService
      | undefined;
    const viteTags =
      svc?.renderTags("<%= it.appName %>", this.context?.cspNonce) ??
      "<!-- @nodefony/frontend not ready -->";
    return this.render(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title><%= it.appName %></title>
    ${viteTags}
  </head>
  <body>
    <%= it.front.mountNode %>
  </body>
</html>`);
  }
}

export default AppController;
