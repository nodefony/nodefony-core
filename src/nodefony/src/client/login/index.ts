/**
 * Script de la page de connexion par défaut, publié en bundle autonome
 * `nodefony/login.js` : la page le charge par un simple `<script type="module">`,
 * sans Vite, sans framework de vue et sans résolution d'imports.
 *
 * Il se branche de lui-même sur le document au chargement ; un module
 * `type="module"` s'exécute après l'analyse du balisage, le DOM est donc là.
 */
import { mountLoginPage } from "./mountLoginPage";

export {
  mountLoginPage,
  DEFAULT_LOGIN_PAGE_MESSAGES,
  type ILoginPageMessages,
  type IMountLoginPageOptions,
} from "./mountLoginPage";

if (typeof document !== "undefined") mountLoginPage(document);
