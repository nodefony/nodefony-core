import { resolve } from "node:path";
import { createRequire } from "node:module";
import fs from "node:fs";
import { route, controller, Controller, UseSession } from "@nodefony/framework";
import { ContextType, HttpError } from "@nodefony/http";

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
@UseSession({ context: "app" })
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
    return this.renderView(
      view,
      this.context?.metaData as Record<string, unknown> | undefined,
    ).catch((e) => {
      throw e;
    });
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
