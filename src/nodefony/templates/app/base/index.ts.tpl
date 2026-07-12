import { Module } from "nodefony";
import type { Kernel } from "nodefony";
import { controllers } from "@nodefony/framework";
<% if (it.front) { %>import type { FrontendService } from "@nodefony/frontend";
<% } %>import config from "./nodefony.config";
import HelloController from "./nodefony/controllers/HelloController";
<% if (it.front) { %>import AppController from "./nodefony/controllers/AppController";
<% } %><% if (it.complete) { %>import { provisionUsers } from "./nodefony/security/provisionUsers";
<% } %>
/**
 * Catalogue d'env typé, lu par le Kernel au boot pour alimenter `ctx.env`
 * du descripteur `defineConfig`.
 */
export { env } from "./env";

/**
 * Point d'entrée de l'application (chargé par le Kernel : `dist/index.js`).
 * L'app ne déclare ici que ce qui lui est INTRINSÈQUE : ses controllers.
 * Les modules chargés vivent dans `nodefony.config.ts` (manifeste `modules`).
 */
@controllers([HelloController<% if (it.front) { %>, AppController<% } %>])
class App extends Module {
  constructor(kernel: Kernel) {
    super("app", kernel, import.meta.url, config);
  }
<% if (it.complete) { %>
  /**
   * Pose l'annuaire utilisateurs de l'app + seed le compte admin (idempotent).
   * L'identité est la responsabilité de l'APPLICATION — le firewall
   * (@nodefony/security) authentifie, mais c'est ici qu'on décide QUI sont les
   * utilisateurs et OÙ ils vivent. Détails : nodefony/security/provisionUsers.ts
   */
  override async onKernelReady(): Promise<this> {
    await provisionUsers(this);
    return this;
  }
<% } %><% if (it.front) { %>
  /**
   * Déclare l'entry frontend <%= it.frontend %> auprès du FrontendService —
   * AVANT `onKernelReady` pour que le superviseur Vite démarre avec elle.
   * En dev : HMR ; en prod : build pré-compilé servi en statics.
   */
  override async onKernelBoot(): Promise<this> {
    const svc = this.kernel?.container?.get("frontend") as
      | FrontendService
      | undefined;
    if (!svc) {
      this.log("@nodefony/frontend service not registered", "ERROR");
      return this;
    }
    svc.registerEntry(this, {
      type: "<%= it.front.type %>",
      entry: "<%= it.front.entry %>",
      root: "./frontend",
      outDir: "./public/dist",
      name: "<%= it.appName %>",
      // Sans ça, un fetch("/api/…") depuis la page servie par Vite tape Vite
      // (qui répond son SPA-fallback HTML) au lieu du backend (piège n°1).
      apiProxyPaths: ["/api"],
    });
    return this;
  }
<% } %>}

export default App;
