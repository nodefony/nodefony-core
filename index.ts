import { Kernel, Module } from "nodefony";
import { controllers } from "@nodefony/framework";
import config from "./nodefony/config/config";
import AppController from "./nodefony/controllers/AppController";
import indexController from "./nodefony/controllers/indexController";
// Entités de démo (User 1-N Post) sur l'ORM Drizzle par défaut : enregistrées au
// top-level → présentes dans le entityRegistry avant le boot (ERD + profiler).
import "./nodefony/entity/user";

/**
 * Point d'entrée de l'application Nodefony.
 *
 * Les MODULES ne sont plus listés ici : la liste vit dans la config
 * (`nodefony/config/modules.ts`, exposée via `config.modules`). Le Kernel la
 * résout selon l'environnement + le profil d'exécution, puis charge les modules
 * en un seul endroit (cf mémoire IA `project_module_loading_architecture`).
 * `index.ts` ne déclare que ce qui est INTRINSÈQUE à l'app : ses controllers et
 * ses entités.
 */
/**
 * Validateur de la config app (schéma Zod) — résolu et exécuté par le Kernel au
 * boot (`loadApp`, avant l'init du log). Voir `nodefony/config/schema.ts`.
 */
export { validateConfig } from "./nodefony/config/schema";

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
