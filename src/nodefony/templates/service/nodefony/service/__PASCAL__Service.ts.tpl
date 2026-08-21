import { Service, Module, Container, Event, injectable<% if (it.inject) { %>, inject<% } %> } from "nodefony";
import type { I<%= it.pascal %>Service } from "../interfaces/I<%= it.pascal %>Service";
<% if (it.inject) { %>import <%= it.inject.pascal %> from "./<%= it.inject.pascal %>";
<% } %>

/**
 * ⚡ **Tu veux un service ? Ne recopie pas ce fichier — génère-le :**
 *
 * ```bash
 * npx nodefony create service <Nom>                  # la classe + sa déclaration
 * npx nodefony create service <Nom> --inject <Autre> # + la dépendance écrite
 * ```
 *
 * Le générateur écrit la version COURANTE du framework et déclare le service sur
 * le module ; recopié à la main, il naît déjà décalé et personne ne le signale.
 * Ce fichier reste là pour se LIRE — comprendre ce qu'est un service — pas pour
 * se dupliquer.
 *
 *
 * <%= it.description %>.
 *
 * La logique métier vit ICI, pas dans un controller : un controller traduit du
 * HTTP/WS ; un service, lui, est réutilisable par n'importe quel controller,
 * une commande CLI ou un autre module — la même méthode sert tous les
 * transports, sans être réécrite pour chacun.
 *
 * Un service porte DEUX noms, et c'est normal :
 *   `@injectable()`                → nomme la CLASSE (`<%= it.pascal %>Service`),
 *                                    c'est ce qu'on écrit dans `@inject("…")`
 *   `super("<%= it.camel %>", …)`  → nomme l'INSTANCE, sa clé dans le conteneur,
 *                                    c'est ce qu'on écrit dans `kernel.get("…")`
 * Les deux mènent à la MÊME instance : le conteneur les réconcilie via la classe.
 * (Le décorateur ne peut pas deviner la clé — il s'exécute au chargement de la
 * classe, le `super()` seulement à la construction.)
 *
 * Une classe à méthodes `static`, ou un objet exporté, COMPILE et marche — et
 * reste invisible au framework : ni conteneur, ni journal (`this.log`), ni
 * événements. C'est `@injectable()` + `extends Service` qui font qu'un service
 * EST un service Nodefony.
 *
 * POUR L'UTILISER AILLEURS, deux voies, toutes deux légales :
 *
<% if (it.inject) { %> * 1. INJECTION par le constructeur — c'est CE QUE FAIT le constructeur
 *    ci-dessous avec `<%= it.inject.pascal %>` : la dépendance est DÉCLARÉE, donc le
 *    conteneur l'ordonnance et elle se voit dans la signature. Le décorateur
 *    prend le nom de la CLASSE (`<%= it.inject.pascal %>`), pas la clé d'instance.
 *
 * ```ts
 * // 2. RÉSOLUTION par le conteneur — utile quand la dépendance est tardive ou
 * //    optionnelle. Ici c'est le nom de l'INSTANCE.
 * const <%= it.camel %> = this.container.get("<%= it.camel %>");
 * ```
<% } else { %> * ```ts
 * // 1. INJECTION par le constructeur — la dépendance est DÉCLARÉE, donc le
 * //    conteneur l'ordonnance et elle se voit dans la signature. Le décorateur
 * //    prend le nom de la CLASSE.
 * import { inject, injectable, Service, Module } from "nodefony";
 *
 * @injectable()
 * class ReportService extends Service {
 *   constructor(
 *     module: Module,
 *     @inject("<%= it.pascal %>Service") private <%= it.camel %>: <%= it.pascal %>Service,
 *   ) {
 *     super("report", module.container, module.notificationsCenter);
 *   }
 * }
 *
 * // 2. RÉSOLUTION par le conteneur — utile quand la dépendance est tardive ou
 * //    optionnelle. Ici c'est le nom de l'INSTANCE.
 * const <%= it.camel %> = this.container.get("<%= it.camel %>");
 * ```
 *
 * Le scaffold écrit la voie 1 pour toi : `nodefony create service <nom>
 * --inject <%= it.pascal %>Service` rend le constructeur déjà injecté.
<% } %> */
@injectable()
class <%= it.pascal %>Service extends Service implements I<%= it.pascal %>Service {
  module: Module;

  constructor(
    module: Module,
<% if (it.inject) { %>    // La dépendance passe par le CONSTRUCTEUR : le conteneur la construit avant
    // celui-ci et l'ordonnance. `@inject` prend le nom de la CLASSE — la clé
    // d'instance (`"<%= it.inject.key %>"`) ne sert qu'à `container.get`.
    @inject("<%= it.inject.pascal %>") private readonly <%= it.inject.camel %>: <%= it.inject.pascal %>,
<% } %>  ) {
    super(
      "<%= it.camel %>",
      module.container as Container,
      module.notificationsCenter as Event,
    );
    this.module = module;
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
    this.log("service <%= it.camel %> initialisé", "DEBUG");
    return this;
  }

  /** Exemple de méthode métier — à remplacer par la vôtre. */
  greet(who = "monde"): string {
    return `Bonjour, ${who} !`;
  }
<% if (it.inject) { %>

  /**
   * Délègue au service injecté — remplace ce corps par ta logique.
   *
   * Rien à résoudre ici : `this.<%= it.inject.camel %>` est déjà l'instance que le
   * conteneur a construite. C'est toute la différence avec
   * `container.get("<%= it.inject.key %>")`, qui cherche à l'exécution et rend
   * `undefined` en silence si le service n'est pas enregistré.
   */
  async depuis<%= it.inject.pascal %>(): Promise<unknown> {
    return this.<%= it.inject.camel %>.<%= it.inject.method %>();
  }
<% } %>

  status(): { ready: boolean } {
    return { ready: true };
  }
}

export default <%= it.pascal %>Service;
