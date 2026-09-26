import type { ContextType } from "../service/http-kernel";

/**
 * Ce que le pipeline HTTP/WS lit d'une route résolue — et rien de plus.
 *
 * Le routage vit dans `@nodefony/framework`, qui dépend de `@nodefony/http` :
 * `http` ne peut donc pas nommer ses classes sans recréer un cycle. C'est le
 * LECTEUR qui définit le contrat ; `Route` (framework) le satisfait par
 * structure, et le typecheck de `framework` garantit l'alignement.
 */
export interface IResolvedRoute {
  /** Nom de la route (journalisation, diagnostic). */
  readonly name: string;
  /** Corps laissé en flux (`@Body({ stream: true })`) : le parse est sauté. */
  readonly bodyStream?: boolean;
}

/**
 * Ce que le pipeline HTTP/WS attend du résolveur d'une requête, posé sur
 * `context.resolver` par le routeur.
 *
 * Implémenté par `Resolver` (`@nodefony/framework`), qui l'étend de ses propres
 * membres — un code de `framework` qui a besoin de la classe entière la tient
 * de son routeur, pas de ce contrat.
 */
export interface IRouteResolver {
  /** Route matchée, `null` tant qu'aucune ne l'est. */
  readonly route: IResolvedRoute | null;
  /** `true` si une route a matché la requête. */
  resolve: boolean;
  /** Erreur levée pendant la résolution, relue par le pipeline. */
  exception?: Error | null;
  /** Classe du controller résolu — seul son nom est lu (erreurs, journal). */
  readonly controller?: { readonly name: string } | null;
  /** Nom de l'action résolue. */
  actionName?: string;

  /**
   * Rejoue le match d'une route sur un contexte (WS : handshake puis frames).
   *
   * @param route - la route à matcher, lue sur {@link IRouteResolver.route}
   * @param context - le contexte courant
   * @param cleanPath - chemin imposé (pont WS-RPC), sinon l'URL du contexte
   */
  match(
    route: IResolvedRoute,
    context: ContextType,
    cleanPath?: string,
  ): unknown;
  /**
   * Instancie le controller résolu — le pipeline ne fait que le transmettre.
   *
   * @param context - le contexte de la requête
   * @returns l'instance du controller
   */
  newController(context?: ContextType): Promise<object>;
  /**
   * Exécute l'action résolue.
   *
   * @param data - arguments supplémentaires de l'action
   * @param reload - rejouer depuis l'instance en cache (forward)
   * @returns le résultat de l'action
   */
  callController(data?: unknown[], reload?: boolean): Promise<unknown>;
}

/**
 * Ce que le pipeline HTTP/WS attend du service `router` — implémenté par
 * `Router` (`@nodefony/framework`).
 */
export interface IRequestRouter {
  /**
   * Résout la route d'un contexte.
   *
   * @param context - le contexte HTTP/WS courant
   * @param cleanPathOverride - chemin porté par un message (pont WS-RPC)
   * @param methodOverride - méthode logique exigée en plus du transport WS
   * @returns le résolveur (`resolve === true` si une route a matché)
   */
  resolve(
    context: ContextType,
    cleanPathOverride?: string,
    methodOverride?: string,
  ): IRouteResolver;
  /**
   * Instance partagée d'un controller `scope: "singleton"`, créée une seule fois.
   *
   * @param ctor - la classe du controller (clé du cache)
   * @param create - fabrique exécutée au premier appel
   * @returns la promesse de l'instance partagée
   */
  getSingletonController<T extends object>(
    // `never[]` : toute classe, quels que soient ses paramètres, s'y assigne.
    ctor: new (...args: never[]) => T,
    create: () => Promise<T>,
  ): Promise<T>;
}
