import { route, controller, Controller } from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";
<% if (it.complete) { %>import { loginPagePath } from "nodefony";
<% } %>import { renderHomePage } from "../home/homePage";

/** Un client qui DEMANDE du HTML le nomme ; `*\/*` (curl, un programme) n'en est pas un. */
const WANTS_HTML = /\btext\/html\b/u;

/**
 * Accueil `GET /` — la racine de TON application.
 *
 * Sans frontend, une racine muette répond 404 : la première URL qu'on ouvre
 * après `npm run dev` dirait « rien ici ». Cette route dit QUI répond, sous la
 * forme que le client demande (négociation de contenu, RFC 9110 §12) :
 * - un navigateur (`Accept: text/html`) reçoit la page d'accueil
 *   (`nodefony/home/homePage.ts`) ;
 * - tout autre client — un programme, `curl` — reçoit `{ "app": … }`, comme
 *   avant : rien ne change pour lui.
 * `Vary: Accept` dit aux caches que la réponse dépend de cet en-tête.
 *
 * ⚠️ **Volontairement sobre en production, et c'est une décision de sécurité.**
 * Ce que cette réponse contient part vers n'importe qui : le NOM, rien d'autre.
 * Énumérer les routes internes, la console d'administration ou les chemins de
 * documentation décrirait ton architecture à qui la demande. Les sections de
 * développement de la page ne sont rendues qu'en développement ; ailleurs, ces
 * informations se demandent au TERMINAL : `npx nodefony card`.
 */
@controller("")
class HomeController extends Controller {
  constructor(context: ContextType) {
    super("home", context);
  }

  @route("app-home", { path: "/", method: "GET" })
  async home() {
    const vary = { vary: "Accept" };
    if (!WANTS_HTML.test(this.request?.headers.accept ?? "")) {
      // Le NOM, rien d'autre. Pas de version du framework : une version
      // exposée est une empreinte offerte à qui cherche une faille connue.
      return this.renderJson({ app: "<%= it.appName %>" }, 200, vary);
    }
    const development = this.kernel?.isDev === true;
    const html = renderHomePage({
      appName: "<%= it.appName %>",
      development,
      // La démo est `policy: "dev"` : chargée, elle est proposée ; la
      // production la retire, et le bouton avec elle.
      demo:
        development && this.kernel?.getModule("demo") !== undefined
          ? "/demo"
          : null,
<% if (it.complete) { %>      user: this.user?.identifier ?? null,
      loginHref: loginPagePath("/"),
<% } %>    });
    return this.render(html, "utf8", 200, {
      ...vary,
      "content-type": "text/html; charset=utf-8",
    });
  }
}

export default HomeController;
