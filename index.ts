import { Kernel, Module } from "nodefony";
import { controllers } from "@nodefony/framework";
import config from "./nodefony.config";
import AppController from "./nodefony/controllers/AppController";
import indexController from "./nodefony/controllers/indexController";
// Entités de démo (User 1-N Post) sur l'ORM Drizzle par défaut : enregistrées au
// top-level → présentes dans le entityRegistry avant le boot (ERD + profiler).
import "./nodefony/entity/user";

/**
 * Point d'entrée de l'application Nodefony.
 *
 * La configuration vit dans `nodefony.config.ts` (descripteur `defineConfig`,
 * résolu par le Kernel au boot avec le contexte d'environnement) ; les MODULES y
 * sont déclarés via `config.modules` (le Kernel les résout selon l'env + le profil
 * d'exécution puis les charge en un seul endroit, cf mémoire IA
 * `project_module_loading_architecture`). `index.ts` ne déclare que ce qui est
 * INTRINSÈQUE à l'app : ses controllers et ses entités.
 */

/**
 * Catalogue des variables d'environnement typées (`defineEnv`) — lu par le Kernel
 * au boot pour alimenter `ctx.env` du descripteur `defineConfig`. Voir `./env.ts`.
 */
export { env } from "./env";

@controllers([AppController, indexController])
class App extends Module {
  /**
   * @param kernel - instance du Kernel.
   */
  constructor(kernel: Kernel) {
    super("app", kernel, import.meta.url, config);
  }
}

export default App;
