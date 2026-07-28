import { Service, Module, Container, Event, injectable } from "nodefony";
import type { I<%= it.pascal %>Service } from "../interfaces/I<%= it.pascal %>Service";

/**
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
 */
@injectable()
class <%= it.pascal %>Service extends Service implements I<%= it.pascal %>Service {
  module: Module;

  constructor(module: Module) {
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

  status(): { ready: boolean } {
    return { ready: true };
  }
}

export default <%= it.pascal %>Service;
