import type { MaybePromise } from "nodefony";
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
  readonly bodyStream?: boolean | undefined;
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
  exception?: Error | null | undefined;
  /** Classe du controller résolu — seul son nom est lu (erreurs, journal). */
  readonly controller?: { readonly name: string } | null | undefined;
  /** Nom de l'action résolue. */
  actionName?: string | undefined;

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
   * @returns l'instance du controller — directement quand elle existe déjà ou
   *   se construit sans rien attendre, sinon la promesse de sa création
   */
  newController(context?: ContextType): MaybePromise<object>;
  /**
   * Exécute l'action résolue, puis rend sa valeur sur le transport.
   *
   * @param data - arguments supplémentaires de l'action
   * @param reload - rejouer depuis l'instance en cache (forward)
   * @returns le résultat du rendu — synchrone quand ni l'action ni le rendu
   *   n'attendent, sinon sa promesse
   */
  callController(data?: unknown[], reload?: boolean): MaybePromise<unknown>;
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
   * Dit si au moins une route déclare le transport `WEBSOCKET` pour ce chemin.
   *
   * Lu AVANT le `101` : une socket vers un chemin sans route se refuse par un
   * statut HTTP (RFC 6455 §4.2.2), jamais par une ouverture suivie d'une
   * fermeture — un client qui sonde par une ouverture conclurait que le
   * serveur l'a acceptée. La réponse est un SUR-ENSEMBLE de ce que
   * {@link IRequestRouter.resolve} acceptera : l'hôte (`@Domain`), le
   * sous-protocole et les exigences de variables ne sont pas jugés ici, ils
   * restent des fermetures après ouverture — refuser à tort coûterait une
   * connexion légitime.
   *
   * @param pathname - chemin de l'URL d'upgrade (WHATWG), barres finales comprises
   * @returns `false` si aucune route WebSocket ne peut répondre à ce chemin
   */
  servesWebsocket(pathname: string): boolean;
  /**
   * Instance partagée d'un controller `scope: "singleton"`, créée une seule fois.
   *
   * @param ctor - la classe du controller (clé du cache)
   * @param create - fabrique exécutée au premier appel
   * @returns l'instance partagée une fois créée ; la promesse de sa création
   *   tant qu'elle est en cours
   */
  getSingletonController<T extends object>(
    // `never[]` : toute classe, quels que soient ses paramètres, s'y assigne.
    ctor: new (...args: never[]) => T,
    create: () => MaybePromise<T>,
  ): MaybePromise<T>;
}
