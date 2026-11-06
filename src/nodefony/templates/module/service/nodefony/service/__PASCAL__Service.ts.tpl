import { Service, Module, injectable } from "nodefony";
import type { I<%= it.pascal %>Service } from "../interfaces/I<%= it.pascal %>Service";
import type { I<%= it.pascal %>Config } from "../config/config";
import { define<%= it.pascal %>Config } from "../config/defineModuleConfig";

/**
 * Service principal du module — la logique vit ici, pas dans les controllers :
 * la même méthode sert HTTP, la socket, la CLI ou un autre module. Guide
 * complet (deux noms, injection, cycle de vie, tâche périodique) :
 * `node_modules/nodefony/docs/service.md`.
 *
 * - `@injectable()` nomme la CLASSE (`@Inject("<%= it.pascal %>Service")`) ;
 *   `super("<%= it.name %>", …)` nomme l'INSTANCE (`container.get("<%= it.name %>")`).
 * - Ne pas redéclarer `options` : `Service` l'assigne par le 4ᵉ argument du
 *   `super()` ; `cfg` en garde la référence typée.
 * - Ne recopie pas ce fichier pour un autre service :
 *   `npx nodefony create service <Nom> [--inject <Autre>]` l'écrit à jour.
 */
@injectable()
class <%= it.pascal %>Service extends Service implements I<%= it.pascal %>Service {
  module: Module;
  private readonly cfg: I<%= it.pascal %>Config;

  constructor(module: Module) {
    // La config que le module a VALIDÉE à `onKernelRegister` — relue par le
    // même builder, jamais affirmée : un `as` ferait taire le typage sans rien
    // vérifier.
    const merged = define<%= it.pascal %>Config(module.options);
    super(
      "<%= it.name %>",
      module.container ?? undefined,
      module.notificationsCenter,
      merged,
    );
    this.module = module;
    this.cfg = merged;
  }

  /**
   * Démarrage, appelé UNE fois après la construction. ⚠️ `init`, pas
   * `initialize` : un `initialize` sur un service n'est jamais appelé.
   */
  async init(): Promise<this> {
    this.log("service <%= it.name %> initialisé", "DEBUG");
    return this;
  }

  /** Exemple de méthode métier — à remplacer par la vôtre. */
  greet(who = "monde"): string {
    return `${this.cfg.greeting}, ${who} !`;
  }

  status(): { ready: boolean } {
    return { ready: this.cfg.enabled };
  }
}

export default <%= it.pascal %>Service;
