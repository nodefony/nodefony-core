import { Service, Module, injectable } from "nodefony";
import type { IAiService } from "../interfaces/IAiService";
import type { IAiConfig } from "../config/config";
import { defineAiConfig } from "../config/defineModuleConfig";

/**
 * Service principal du module — la logique vit ici, pas dans les controllers
 * (un controller traduit du HTTP/WS ; un service, lui, est réutilisable par la
 * CLI, un job, un autre module).
 *
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
 * Cycle : `constructor` (fusion défauts + config de l'app) → `init`
 * (branchements kernel) → méthodes métier.
 *
 * Un service porte DEUX noms, et c'est normal :
 *   `@injectable()`             → nomme la CLASSE (`AiService`),
 *                                 c'est ce qu'on écrit dans `@inject("…")`
 *   `super("ai", …)` → nomme l'INSTANCE, sa clé dans le conteneur,
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
 *     @inject("AiService") private ai: AiService,
 *   ) {
 *     super("report", module.container, module.notificationsCenter);
 *   }
 * }
 *
 * // 2. RÉSOLUTION par le conteneur, pour une dépendance tardive ou optionnelle
 * //    (nom d'INSTANCE).
 * const ai = this.container.get("ai");
 * ```
 */
@injectable()
class AiService extends Service implements IAiService {
  module: Module;
  private readonly cfg: IAiConfig;

  constructor(module: Module) {
    const merged = defineAiConfig(module.options);
    super(
      "ai",
      module.container ?? undefined,
      module.notificationsCenter,
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
    this.log("service ai initialisé", "DEBUG");
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

export default AiService;
