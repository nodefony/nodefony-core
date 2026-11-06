import { Service, Module, injectable<% if (it.injects.length > 0) { %>, Inject<% } %> } from "nodefony";
import type { I<%= it.pascal %>Service } from "../interfaces/I<%= it.pascal %>Service";
<% for (const inject of it.injects) { %>import type <%= inject.pascal %> from "./<%= inject.pascal %>";
<% } %>

/**
 * <%= it.description %>.
 *
 * La logique vit ici, pas dans un controller : la même méthode sert HTTP, la
 * socket, une commande CLI ou un autre module. Guide complet (deux noms,
 * injection, cycle de vie, tâche périodique) :
 * `node_modules/nodefony/docs/service.md`.
 *
 * - `@injectable()` nomme la CLASSE (`@Inject("<%= it.pascal %>Service")`) ;
 *   `super("<%= it.camel %>", …)` nomme l'INSTANCE (`container.get("<%= it.camel %>")`).
 * - Ne recopie pas ce fichier pour un autre service :
 *   `npx nodefony create service <Nom> [--inject <Autre>]` l'écrit à jour.
 */
@injectable()
class <%= it.pascal %>Service extends Service implements I<%= it.pascal %>Service {
  module: Module;

  constructor(
    module: Module,
<% if (it.injects.length > 0) { %>    // `@Inject` prend le nom de la CLASSE ; le conteneur construit la dépendance avant.
<% } %><% for (const inject of it.injects) { %>    @Inject("<%= inject.pascal %>") private readonly <%= inject.camel %>: <%= inject.pascal %>,
<% } %>  ) {
    super(
      "<%= it.camel %>",
      module.container ?? undefined,
      module.notificationsCenter,
    );
    this.module = module;
  }

  /**
   * Démarrage, appelé UNE fois après la construction. ⚠️ `init`, pas
   * `initialize` : un `initialize` sur un service n'est jamais appelé.
   */
  async init(): Promise<this> {
    this.log("service <%= it.camel %> initialisé", "DEBUG");
    return this;
  }

  /** Exemple de méthode métier — à remplacer par la vôtre. */
  greet(who = "monde"): string {
    return `Bonjour, ${who} !`;
  }
<% for (const inject of it.injects) { %>

  /** Délègue à `<%= inject.pascal %>`, déjà construit par le conteneur. */
  async from<%= inject.pascal %>(): Promise<unknown> {
    return this.<%= inject.camel %>.<%= inject.method %>();
  }
<% } %>

  status(): { ready: boolean } {
    return { ready: true };
  }
}

export default <%= it.pascal %>Service;
