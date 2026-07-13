import { Service, Module, Container, Event, extend, injectable } from "nodefony";
import type { I<%= it.pascal %>Service } from "../interfaces/I<%= it.pascal %>Service";
import defaultConfig, { type <%= it.pascal %>Config } from "../config/config";

/**
 * Service principal du module — la logique vit ici, pas dans les controllers
 * (un controller traduit du HTTP/WS ; un service, lui, est réutilisable par la
 * CLI, un job, un autre module).
 *
 * Cycle : `constructor` (fusion défauts + config de l'app) → `initialize`
 * (branchements kernel) → méthodes métier.
 *
 * ⚠️ Ne JAMAIS redéclarer `options` comme propriété : la classe `Service` parente
 * l'assigne déjà via le 4ᵉ argument du `super()`. On garde une référence typée
 * `cfg` pour lire la config sans se battre avec TypeScript.
 */
@injectable()
class <%= it.pascal %>Service extends Service implements I<%= it.pascal %>Service {
  module: Module;
  private readonly cfg: <%= it.pascal %>Config;

  constructor(module: Module) {
    const merged = extend(
      true,
      {},
      defaultConfig,
      module.options ?? {},
    ) as <%= it.pascal %>Config;
    super(
      "<%= it.name %>",
      module.container as Container,
      module.notificationsCenter as Event,
      merged,
    );
    this.module = module;
    this.cfg = merged;
  }

  /**
   * Appelé une fois par le conteneur, au démarrage. C'est ici qu'on s'abonne aux
   * événements du kernel — jamais dans le constructeur, où le kernel n'est pas
   * encore prêt.
   */
  async initialize(): Promise<this> {
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
