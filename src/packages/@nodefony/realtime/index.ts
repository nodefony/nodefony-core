/**
 * @nodefony/realtime — Couche realtime serveur Nodefony.
 *
 * Ce module porte le hub WebSocket (broker fan-out), le protocole JSON-RPC 2.0
 * (peer isomorphe partagé avec le client core), le backplane cluster
 * (Loopback / Cluster IPC / Redis / Kafka) et, à terme, les protocoles TCP / UDP
 * / Unix sockets (P13.1).
 *
 * État actuel (2026-05-28) — scaffold + doc + Module class minimale avec
 * validation Zod de la config au boot. Le code serveur (RealtimeHub,
 * RealtimeController, RealtimeAdminApi, IBackplane, LoopbackBackplane,
 * ClusterBackplane et les tests associés) sera rapatrié depuis
 * `@nodefony/framework` en P13.0. Le client isomorphe reste dans le subpath
 * `nodefony/realtime` du core (décision figée — pas de package navigateur).
 *
 * Lire `docs/index.md` pour la vue d'ensemble vulgarisée.
 *
 * Voir aussi :
 *  - CLAUDE.md  — décisions d'archi figées + 5 seams sécurité
 *  - MEMORY.md  — internals IA
 *  - README.md  — usage humain
 *  - docs/      — doc dev vulgarisée (6 pages)
 */
import { Kernel, Module } from "nodefony";
import defaultConfig from "./nodefony/config/config";
import { realtimeConfigSchema } from "./nodefony/config/schema";

class Realtime extends Module {
  constructor(kernel: Kernel) {
    super("realtime", kernel, import.meta.url, defaultConfig);
  }

  /**
   * Validation Zod de la config racine merge au boot (convention figée 2026-05-28,
   * cf [[feedback_config_validation_zod]]). Plante propre avec messages clairs si
   * la config (defaults + module.options) n'est pas conforme au schéma — évite tous
   * les `undefined.x` silencieux en runtime.
   */
  override async onKernelRegister(): Promise<this> {
    const parsed = realtimeConfigSchema.safeParse(this.options ?? {});
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join(" · ");
      throw new Error(`[@nodefony/realtime] Invalid config: ${issues}`);
    }
    return this;
  }
}

export default Realtime;
export { Realtime };

export { RealtimeError } from "./nodefony/src/errors/RealtimeError";
export type { RealtimeConfig } from "./nodefony/config/config";
