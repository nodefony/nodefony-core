import { resolve } from "node:path";
import { createRequire } from "node:module";
import fs from "node:fs";
import {
  route,
  controller,
  Controller,
  UseSession,
  Body,
} from "@nodefony/framework";
import { HttpError } from "@nodefony/http";
import type { ContextType } from "@nodefony/http";
import { isLoginPageSkin, loginPagePath } from "nodefony";
import {
  KeycloakAdminError,
  type AuthFlow,
  type KeycloakService,
} from "@nodefony/security";

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

  // Développement : la page de connexion de Keycloak suit l'habillage choisi
  // au sélecteur de /login (`loginPage.previewHook`). Même geste que
  // `security:keycloak:realm --apply` — le SERVICE, jamais la commande.
  @route("route-app-keycloak-theme", {
    path: "/keycloak/theme",
    requirements: { methods: ["POST"] },
  })
  async keycloakTheme(@Body("skin") skin?: unknown) {
    const environment = this.kernel?.environment ?? "production";
    if (environment !== "development") {
      throw new HttpError("Not Found", 404, this.context);
    }
    if (!isLoginPageSkin(skin)) {
      throw new HttpError("habillage inconnu", 400, this.context);
    }
    const keycloak = this.get<KeycloakService>("keycloak");
    if (!keycloak) {
      throw new HttpError("Not Found", 404, this.context);
    }
    try {
      const result = await keycloak.applyLoginTheme({ skin });
      return await this.renderJson(result);
    } catch (error) {
      if (!(error instanceof KeycloakAdminError)) throw error;
      // Keycloak éteint ou absent : l'aperçu se recharge quand même, le
      // journal dit pourquoi Keycloak n'a pas suivi.
      this.log(error.message, "WARNING");
      return this.renderJson({ error: error.message }, 503);
    }
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
