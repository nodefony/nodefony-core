import { Service, Module, Container, Event, extend, injectable } from "nodefony";
import type { I<%= it.pascal %>Service } from "../interfaces/I<%= it.pascal %>Service";
import defaultConfig, { type <%= it.pascal %>Config } from "../config/config";

/**
 * Service principal du module — la logique vit ici, pas dans les controllers
 * (un controller traduit du HTTP/WS ; un service, lui, est réutilisable par la
 * CLI, un job, un autre module).
 *
 * Cycle : `constructor` (fusion défauts + config de l'app) → `init`
 * (branchements kernel) → méthodes métier.
 *
 * Un service porte DEUX noms, et c'est normal :
 *   `@injectable()`             → nomme la CLASSE (`<%= it.pascal %>Service`),
 *                                 c'est ce qu'on écrit dans `@inject("…")`
 *   `super("<%= it.name %>", …)` → nomme l'INSTANCE, sa clé dans le conteneur,
 *                                 c'est ce qu'on écrit dans `kernel.get("…")`
 * Les deux mènent à la MÊME instance : le conteneur les réconcilie via la classe.
 * (Le décorateur ne peut pas deviner la clé — il s'exécute au chargement de la
 * classe, le `super()` seulement à la construction.)
 *
 * ⚠️ Ne JAMAIS redéclarer `options` comme propriété : la classe `Service` parente
 * l'assigne déjà via le 4ᵉ argument du `super()`. On garde une référence typée
 * `cfg` pour lire la config sans se battre avec TypeScript.
 *
 * POUR L'UTILISER AILLEURS, deux voies, toutes deux légales :
 *
 * ```ts
 * // 1. INJECTION par le constructeur — la dépendance est DÉCLARÉE, donc le
 * //    conteneur l'ordonnance et elle se voit dans la signature (nom de CLASSE).
 * import { inject, injectable, Service, Module } from "nodefony";
 *
 * @injectable()
 * class ReportService extends Service {
 *   constructor(
 *     module: Module,
 *     @inject("<%= it.pascal %>Service") private <%= it.name %>: <%= it.pascal %>Service,
 *   ) {
 *     super("report", module.container, module.notificationsCenter);
 *   }
 * }
 *
 * // 2. RÉSOLUTION par le conteneur, pour une dépendance tardive ou optionnelle
 * //    (nom d'INSTANCE).
 * const <%= it.name %> = this.container.get("<%= it.name %>");
 * ```
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
   * Hook de démarrage d'un service : appelé UNE fois par le kernel, après la
   * construction. C'est ici qu'on s'abonne aux événements du kernel — jamais
   * dans le constructeur, où le kernel n'est pas encore prêt.
   *
   * ⚠️ Il s'appelle `init`, pas `initialize`. Le kernel ne cherche que `init`
   * (`guardServiceInitialize`) : une méthode nommée `initialize` sur un service
   * n'est JAMAIS appelée, et rien ne le signale — le code y dort en silence.
   * (`initialize` existe bien, mais sur un CONTROLLER, où il tourne à CHAQUE
   * requête : deux cycles de vie distincts, d'où deux noms.)
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
