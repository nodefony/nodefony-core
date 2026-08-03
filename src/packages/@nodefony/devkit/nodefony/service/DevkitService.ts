import {
  Service,
  Module,
  Container,
  Event,
  Nodefony,
  extend,
  injectable,
} from "nodefony";
import type { IDevkitCard, IDevkitService } from "../interfaces/IDevkitService";
import { buildCard } from "../src/card";
import defaultConfig, { type DevkitConfig } from "../config/config";

/**
 * Service principal du module — la logique vit ici, pas dans les controllers
 * (un controller traduit du HTTP/WS ; un service, lui, est réutilisable par la
 * CLI, un job, un autre module).
 *
 * Cycle : `constructor` (fusion défauts + config de l'app) → `init`
 * (branchements kernel) → méthodes métier.
 *
 * Un service porte DEUX noms, et c'est normal :
 *   `@injectable()`             → nomme la CLASSE (`DevkitService`),
 *                                 c'est ce qu'on écrit dans `@inject("…")`
 *   `super("devkit", …)` → nomme l'INSTANCE, sa clé dans le conteneur,
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
 *     @inject("DevkitService") private devkit: DevkitService,
 *   ) {
 *     super("report", module.container, module.notificationsCenter);
 *   }
 * }
 *
 * // 2. RÉSOLUTION par le conteneur, pour une dépendance tardive ou optionnelle
 * //    (nom d'INSTANCE).
 * const devkit = this.container.get("devkit");
 * ```
 */
@injectable()
class DevkitService extends Service implements IDevkitService {
  module: Module;
  private readonly cfg: DevkitConfig;

  constructor(module: Module) {
    const merged = extend(
      true,
      {},
      defaultConfig,
      module.options ?? {},
    ) as DevkitConfig;
    super(
      "devkit",
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
    this.log("service devkit initialisé", "DEBUG");
    return this;
  }

  /**
   * Carte de visite de l'application — recalculée à CHAQUE lecture.
   *
   * Tout est DÉRIVÉ de l'état du Kernel : le module ne stocke rien en propre, et
   * ne peut donc pas décrire une application qui n'est plus celle-là. Un cache
   * mentirait au premier module ajouté ; le coût ne le justifie pas (quelques
   * lectures de champs, sur une route de développement appelée à la main).
   *
   * `buildCard` reste PURE et reçoit cet état : c'est la frontière qui rend la
   * composition de la carte éprouvable sans Kernel ni serveur.
   */
  getCard(): IDevkitCard {
    const kernel = this.module.kernel;
    return buildCard({
      appName: kernel?.projectName ?? "application",
      // `kernel.version` est celle de l'APP (lue de son package.json) ;
      // `Nodefony.version` celle du FRAMEWORK. Deux versions distinctes, et les
      // confondre est le genre d'erreur qu'une carte de visite ne doit pas faire.
      appVersion: kernel?.version ?? "0.0.0",
      nodefonyVersion: Nodefony.version,
      environment: kernel?.environment ?? "unknown",
      modules: Object.keys(kernel?.modules ?? {}),
      // Le Kernel tourne : ce sont les modules CHARGÉS, gating `policy`/`when`
      // déjà appliqué. La porte CLI répond à froid et ne connaît, elle, que les
      // modules INSTALLÉS — d'où ce champ, qui empêche les deux cartes de se
      // faire passer l'une pour l'autre.
      source: "runtime",
    });
  }

  status(): { ready: boolean } {
    return { ready: this.cfg.enabled };
  }
}

export default DevkitService;
