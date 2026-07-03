import { Kernel, Module } from "nodefony";
import { controllers } from "@nodefony/framework";
import config from "./nodefony.config.js";
import HelloController from "./nodefony/controllers/HelloController.js";

/**
 * Catalogue d'env typé, lu par le Kernel au boot pour alimenter `ctx.env`
 * du descripteur `defineConfig`.
 */
export { env } from "./env.js";

/**
 * Point d'entrée de l'application (chargé par le Kernel : `dist/index.js`).
 * L'app ne déclare ici que ce qui lui est INTRINSÈQUE : ses controllers.
 * Les modules chargés vivent dans `nodefony.config.ts` (manifeste `modules`).
 */
@controllers([HelloController])
class App extends Module {
  constructor(kernel: Kernel) {
    super("app", kernel, import.meta.url, config);
  }
}

export default App;
