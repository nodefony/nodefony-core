import { Nodefony } from "nodefony";
import { route, controller, Controller } from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";
import {
  DEMO_ABOUT_PATH,
  type IDemoAbout,
} from "../../frontend/src/about";

/**
 * API de l'accueil de la démo, sous `/demo/api` — hors de toute zone de
 * l'application, dont `/api` reste fermé.
 *
 * Guide pour un agent : une route JSON se déclare par `@route` sur un
 * `Controller` (`@nodefony/framework`) et répond par `renderJson` ; le type de
 * la réponse est PARTAGÉ avec la page (`frontend/src/about.ts`). Équivalent
 * généré : `npx nodefony create controller`.
 */
@controller("")
class DemoController extends Controller {
  constructor(context: ContextType) {
    super("demo", context);
  }

  /**
   * Identité de l'application et version de Nodefony installée, lues au
   * démarrage : `kernel.projectName`/`kernel.version` viennent du
   * `package.json` de l'application, `Nodefony.version` du paquet installé.
   */
  @route("demo-about", { path: DEMO_ABOUT_PATH, method: "GET" })
  about() {
    const about: IDemoAbout = {
      app: {
        name: this.kernel?.projectName ?? "<%= it.appName %>",
        version: this.kernel?.version ?? "0.0.0",
      },
      nodefony: { version: Nodefony.version },
    };
    return this.renderJson(about);
  }
}

export default DemoController;
