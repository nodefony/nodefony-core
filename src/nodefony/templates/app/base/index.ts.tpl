import { Module<% if (it.complete) { %>, services<% } %> } from "nodefony";
import type { Kernel } from "nodefony";
import { controllers } from "@nodefony/framework";
<% if (it.complete) { %>import AppInfoService from "./nodefony/service/AppInfoService";
import AppBannerService from "./nodefony/service/AppBannerService";
<% } %>
<% if (it.front) { %>import { register<%= it.pascal %>Entry } from "./nodefony/frontend/register<%= it.pascal %>Entry";
<% } %>import config from "./nodefony.config";
import HelloController from "./nodefony/controllers/HelloController";
<% if (it.complete) { %>import LiveController from "./nodefony/controllers/LiveController";
<% } %><% if (it.front) { %>import AppController from "./nodefony/controllers/AppController";
<% } else { %>import HomeController from "./nodefony/controllers/HomeController";
<% } %><% if (it.complete) { %>import { provisionUsers } from "./nodefony/security/provisionUsers";
<% } %>
/**
 * Catalogue d'env typé, lu par le Kernel au boot pour alimenter `ctx.env`
 * du descripteur `defineConfig`.
 */
export { env } from "./env";

/**
 * Point d'entrée de l'application (chargé par le Kernel : `dist/index.js`).
 * L'app ne déclare ici que ce qui lui est INTRINSÈQUE : ses controllers et ses
 * services. Les modules chargés vivent dans `nodefony.config.ts` (manifeste
 * `modules`).
 *
<% if (it.complete) { %> *
 * ⚠️ `@services([…])` est ce qui fait EXISTER un service : écrire une classe
 * `@injectable()` sans l'ajouter ici la laisse invisible au conteneur. Tout
 * service que tu ajoutes — le tien, ou celui que `nodefony create service`
 * génère — se déclare dans cette liste.
<% } %> */
<% if (it.complete) { %>@services([AppInfoService, AppBannerService])
<% } %>@controllers([HelloController<% if (it.complete) { %>, LiveController<% } %><% if (it.front) { %>, AppController<% } else { %>, HomeController<% } %>])
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
   *
   * Le DÉTAIL de l'entry (type, racine Vite, proxy d'API) vit dans
   * `nodefony/frontend/register<%= it.pascal %>Entry.ts` — même fichier, même
   * forme que pour un module créé par `nodefony create front`.
   */
  override async onKernelBoot(): Promise<this> {
    register<%= it.pascal %>Entry(this);
    return this;
  }
<% } %>}

export default App;
