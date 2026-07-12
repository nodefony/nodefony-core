import { Controller, route, controller } from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";
import type { FrontendService } from "@nodefony/frontend";

/**
 * Sert la page de l'app <%= it.frontend %>. Le HTML ne vit PAS ici : c'est la
 * coquille `frontend/index.html` (TA page — meta, polices, externals), dans
 * laquelle `renderDocument` injecte les balises du framework au marqueur
 * `<!--nodefony:frontend-->` : entry Vite + HMR en dev, bundle fingerprinté
 * en prod, nonce CSP de la requête propagé aux `<script>`.
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
    if (!svc) {
      return this.render("<!-- @nodefony/frontend not ready -->");
    }
    return this.render(
      svc.renderDocument("<%= it.appName %>", this.context?.cspNonce),
    );
  }
}

export default AppController;
