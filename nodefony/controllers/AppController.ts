import { resolve } from "node:path";
import { createRequire } from "node:module";
import fs from "node:fs";
import { route, controller, Controller, UseSession } from "@nodefony/framework";
import { HttpError } from "@nodefony/http";
import type { ContextType } from "@nodefony/http";
import { loginPagePath } from "nodefony";
import type { AuthFlow } from "@nodefony/security";

/**
 * Bundle standalone de la debug bar (`nodefony/debugbar.js` = build core), lu
 * UNE fois puis caché. Inclus en `<script>` externe sur la page d'accueil
 * (rendue serveur, hors Vite). `null` = pas lu, `false` = irrésoluble.
 */
let debugbarBundle: string | false | null = null;
function loadDebugbarBundle(): string | false {
  if (debugbarBundle !== null) return debugbarBundle;
  try {
    const file = createRequire(import.meta.url).resolve("nodefony/debugbar.js");
    debugbarBundle = fs.readFileSync(file, "utf8");
  } catch {
    debugbarBundle = false;
  }
  return debugbarBundle;
}

@controller("/app")
@UseSession()
class AppController extends Controller {
  constructor(context: ContextType) {
    super("app", context);
  }

  @route("route-app-index", { path: "", method: "GET" })
  async method1() {
    const view = resolve(
      this.module?.path as string,
      "nodefony",
      "views",
      "index.eta",
    );
    // `this.user` : l'identité que le pare-feu a posée (zone `app-pages`,
    // session ou anonyme) — les boutons de la barre marchent sans JavaScript.
    const context = this.context as ContextType;
    const url = context.request?.url;
    return this.renderView(view, {
      ...context.metaData,
      session: {
        user: this.user?.identifier ?? null,
        loginHref: loginPagePath(
          url instanceof URL ? url.pathname + url.search : "/",
        ),
      },
    });
  }

  // Déconnexion par formulaire : un POST de même origine (CSRF : Fetch
  // Metadata), puis retour à l'accueil — ou chez le fournisseur, qui ferme
  // aussi SA session et sans quoi il reconnecterait au prochain passage.
  @route("route-app-logout", {
    path: "/logout",
    requirements: { methods: ["POST"] },
  })
  async logout() {
    const flow = this.#flow();
    const context = this.context as ContextType;
    let target = "/";
    if (flow) {
      target = (await flow.logoutWithProvider(context)).logoutUrl ?? "/";
    }
    this.redirect(target, 303);
  }

  #flow(): AuthFlow | null {
    return this.get<AuthFlow>("authFlow") ?? null;
  }

  // Sert le bundle standalone de la debug bar pour la page d'accueil (rendue
  // serveur, hors Vite). `index.eta` l'inclut via <script src> EXTERNE
  // (autorisé par CSP `script-src 'self'` — un script inline serait bloqué).
  @route("route-app-debugbar", {
    path: "/debugbar.js",
    requirements: { methods: ["GET", "HEAD"] },
  })
  debugbarJs() {
    const js = loadDebugbarBundle();
    if (js === false) {
      throw new HttpError("debugbar bundle introuvable", 404, this.context);
    }
    return this.render(`${js}\nmountDebugBar();\n`, "utf-8", 200, {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-cache",
    });
  }
}

export default AppController;
