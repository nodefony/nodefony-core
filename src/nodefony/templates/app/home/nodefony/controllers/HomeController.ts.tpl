import { route, controller, Controller } from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";

/**
 * Accueil `GET /` — la carte de visite JSON de l'app.
 *
 * Sans frontend, une racine muette répond 404 : la première URL qu'on ouvre
 * après `npm run dev` dirait « rien ici ». Cette route dit QUI répond (nom,
 * version) et OÙ aller ensuite. Elle n'est générée que pour une app SANS
 * frontend — avec un front, c'est `AppController` qui tient `/`.
 *
 * Tu ajoutes un frontend plus tard (`nodefony create front`) ? Sa page vivra
 * sous sa propre route ; garde cet accueil JSON ou remplace-le, c'est TA racine.
 */
@controller("")
class HomeController extends Controller {
  constructor(context: ContextType) {
    super("home", context);
  }

  @route("app-home", { path: "/", method: "GET" })
  async home() {
    return this.renderJson({
      app: "<%= it.appName %>",
      nodefony: "<%= it.nodefonyVersion %>",
      liens: {
        hello: "/api/hello",
<% if (it.complete) { %>        studio: "/nodefony (console d'admin, mode développement)",
<% } %>        docs: "node_modules/nodefony/docs/ + node_modules/@nodefony/*/docs/",
        agents: "AGENTS.md (instructions pour un agent IA)",
      },
    });
  }
}

export default HomeController;
