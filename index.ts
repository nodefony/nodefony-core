import { Kernel, Module, appConfigJsonSchema } from "nodefony";
import { controllers } from "@nodefony/framework";
import config from "./nodefony.config";
import AppController from "./nodefony/controllers/AppController";
import indexController from "./nodefony/controllers/indexController";
// Entité User (table `@nodefony/drizzle`) sur l'ORM Drizzle par défaut : enregistrée
// au top-level → présente dans le entityRegistry avant le boot (table créée, ERD, profiler).
// NB : les stores framework (idempotence, webhooks, tokens, audit, passkeys) sont
// AUTO-ENREGISTRÉS par leurs modules adapters (drizzle/mongoose/redis) — l'app n'a
// plus aucun câblage `registerXStore` à écrire (lot 0.8, ex-« approche B »).
import "./nodefony/entity/user";
// Source d'identité de l'app : pose le service "users" au boot (cf. fichier).
import { provisionUsers } from "./nodefony/security/provisionUsers";

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

  /**
   * JSON Schema de la config d'APPLICATION → data plane admin (carte de l'app dans
   * le panneau de config Studio). Schéma porté par le core (`appConfigSchema`,
   * documenté), commun à toutes les apps Nodefony.
   */
  override configSchema(): unknown {
    return appConfigJsonSchema();
  }

  /**
   * Une fois le kernel prêt (ORM connecté, firewall câblé), l'app pose sa source
   * d'identité : le service `"users"`. Délégué à `provisionUsers` (dépôt Drizzle
   * persistant par défaut, ou in-memory via `NF_USER_STORE`) — voir
   * `nodefony/security/provisionUsers.ts`.
   */
  override async onKernelReady(): Promise<this> {
    await provisionUsers(this);
    return this;
  }
}

export default App;
