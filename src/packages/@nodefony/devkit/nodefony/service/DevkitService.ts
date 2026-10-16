import {
  Service,
  Module,
  Container,
  Nodefony,
  extend,
  injectable,
  ADMIN_DEFAULT_ROLE,
} from "nodefony";
import type {
  IAdminBrokerLike,
  IMcpTool,
  IProtectedResourceInput,
} from "nodefony";
import { defineMcpGate, mcpDeclaredScopes, type IMcpGate } from "@nodefony/ai";
import { selectBuiltinMcpTools, type IMcpToolDeps } from "../mcp/tools";
import type { IDevkitCard, IDevkitService } from "../interfaces/IDevkitService";
import { buildCard } from "../src/card";
import defaultConfig, { type IDevkitConfig } from "../config/config";

/**
 * Ce que l'agent lit en arrivant sur la porte de développement — la phrase
 * d'ouverture des `instructions`, suivie par le moteur des outils servis.
 */
const DEVKIT_MCP_INSTRUCTIONS =
  "Outils d'introspection d'une application Nodefony — ils répondent depuis " +
  "l'application qui TOURNE, pas depuis une lecture des sources. Commence " +
  "par la carte de visite si tu arrives sur cette application.";

/** Ce qu'accorde la porte de développement à qui l'atteint sans jeton. */
const DEV_OPERATOR_ROLES: readonly string[] = [ADMIN_DEFAULT_ROLE];

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
  private readonly cfg: IDevkitConfig;
  /** La porte MCP de développement — définie au premier usage (`mcpGate()`). */
  #mcpGate: IMcpGate | null = null;

  constructor(module: Module) {
    // Sans config déclarée, le module peut n'avoir reçu aucune section.
    const options = module.options as object | undefined;
    const merged = extend(
      true,
      {},
      defaultConfig,
      options ?? {},
    ) as IDevkitConfig;
    super(
      "devkit",
      module.container as Container,
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

  /**
   * Réglages du serveur MCP, tels que l'application les a effectivement.
   *
   * La porte HTTP les LIT ici plutôt que de relire la configuration de son
   * côté : les défauts du schéma sont déjà fusionnés avec ce que l'app a passé
   * dans `use()`, une seconde lecture finirait par diverger de celle-ci.
   */
  mcpSettings(): IDevkitConfig["mcp"] {
    return this.cfg.mcp;
  }

  /**
   * Ce dont les outils MCP intégrés ont besoin pour répondre.
   *
   * Composé ICI, et non dans la porte HTTP, parce que DEUX questions les
   * réclament — « que sert-on à cet appelant ? » (la porte) et « qu'exige cette
   * porte ? » ({@link DevkitService.declaredMcpScopes}, lue sans requête, au
   * moment de publier le document RFC 9728). Deux compositions auraient fini
   * par diverger, et c'est le document publié qui aurait eu tort.
   *
   * @returns broker d'administration (absent si `@nodefony/framework` n'est pas
   *          monté — les outils le DISENT alors, ils ne plantent pas), carte de
   *          visite et racine de l'APPLICATION (jamais `process.cwd()` : le
   *          serveur répond dans le process de l'app, dont le dossier courant
   *          n'est pas garanti être celui du projet).
   */
  mcpToolDeps(): IMcpToolDeps {
    const kernel = this.module.kernel;
    return {
      broker: this.get<IAdminBrokerLike>("adminBroker") ?? undefined,
      getCard: () => this.getCard(),
      projectRoot: kernel?.path ?? process.cwd(),
    };
  }

  /**
   * Les outils `nodefony_*` retenus par l'allowlist `mcp.tools`.
   *
   * Recomposés à chaque appel, jamais mémorisés : la collecte a lieu à la
   * requête MCP, sur une porte qui n'existe qu'en développement — un cache
   * serait une structure de plus à invalider pour un gain nul.
   *
   * @returns les outils, dans l'ordre de l'allowlist
   */
  mcpTools(): IMcpTool[] {
    return selectBuiltinMcpTools(this.cfg.mcp.tools, this.mcpToolDeps());
  }

  /**
   * Les scopes que la porte MCP EXIGE — dérivés des outils qu'elle déclare.
   *
   * 🔴 **Aucune liste de configuration ne double celle-ci**, et c'est la
   * correction d'un mensonge normatif : la liste écrite publiait `admin:write`
   * qu'aucun outil n'exige, et taisait le scope de tout outil déclaré par un
   * module — deux écarts qu'aucun contrôle ne pouvait voir, puisque rien ne
   * reliait les deux. Une application qui veut voir un scope publié le pose sur
   * son outil (`IMcpTool.scopes`), seul endroit où un scope a un EFFET.
   *
   * Vide quand la porte n'exige rien : `scopes_supported` est alors OMIS du
   * document (RFC 9728 §2, champ optionnel) plutôt que publié vide.
   *
   * @returns les scopes dédupliqués et triés
   */
  declaredMcpScopes(): readonly string[] {
    return mcpDeclaredScopes({ modules: this.module.kernel?.modules });
  }

  /**
   * Ce que ce module protège, à publier en RFC 9728 — la porte MCP, ou rien.
   *
   * ⭐ **Le document n'est plus monté ici.** Il l'était, par un controller
   * dédié, et cela faisait deux implémentations d'une même règle : celle du
   * pare-feu (les zones qui déclarent leur ressource) et celle-ci. Deux copies
   * divergent — chacune passe ses propres tests — et elles pouvaient en plus se
   * disputer un chemin, que `Router.createRoute` attribue au premier arrivé sans
   * un mot. Le module DÉCLARE désormais, `@nodefony/framework` monte.
   *
   * 🔴 **Effet voulu du changement** : le document n'est plus servi que sur
   * l'autorité de `resource`. L'ancien controller répondait sur n'importe
   * laquelle — exactement le défaut corrigé sur le document d'émetteur, qu'un
   * vrai client MCP avait trouvé : recevoir le document d'une autre autorité le
   * fait ARRÊTER, là où un `404` l'aurait laissé continuer.
   *
   * Rôle éteint (aucun serveur d'autorisation déclaré) ⇒ rien : un document sans
   * `authorization_servers` apprendrait au client qu'un jeton est nécessaire
   * sans lui dire où l'obtenir, ce que la spécification MCP interdit.
   *
   * @returns une entrée pour la porte MCP, ou aucune
   */
  publishedProtectedResources(): readonly IProtectedResourceInput[] {
    return this.mcpGate().protectedResources(this.module.kernel?.modules);
  }

  /**
   * La porte MCP de développement — définie au premier usage, une fois.
   *
   * Bâtie sur `defineMcpGate` comme celle de n'importe quelle application : ses
   * réglages viennent de `devkit.mcp.*`, elle sert les outils de TOUS les modules
   * chargés (`tools: "modules"` — l'outillage éprouve aussi ceux de l'app), et
   * accorde le rôle d'opérateur à qui l'atteint sans jeton. Ce rôle n'est sûr que
   * parce que son PÉRIMÈTRE la protège (module `policy: "dev"`, absent en
   * production) ; une porte protégée par un serveur d'autorisation le tire, elle,
   * des scopes du jeton.
   *
   * @returns la porte, prête à servir.
   */
  mcpGate(): IMcpGate {
    if (this.#mcpGate === null) {
      const mcp = this.cfg.mcp;
      const gateProtected = mcp.authorization.authorizationServers.length > 0;
      this.#mcpGate = defineMcpGate({
        enabled: mcp.enabled,
        allowedOrigins: mcp.allowedOrigins,
        allowRemote: mcp.allowRemote,
        authorization: mcp.authorization,
        tools: "modules",
        instructions: DEVKIT_MCP_INSTRUCTIONS,
        unprotectedRoles: gateProtected ? [] : [...DEV_OPERATOR_ROLES],
      });
    }
    return this.#mcpGate;
  }

  status(): { ready: boolean } {
    return { ready: this.cfg.enabled };
  }
}

export default DevkitService;
