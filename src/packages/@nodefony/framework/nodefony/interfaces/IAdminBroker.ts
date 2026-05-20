import type { IAdminEndpoint, IAdminRegistry } from "nodefony";

/**
 * Entrée résolue d'un endpoint admin — couple le producteur, sa définition et
 * le chemin absolu monté. Renvoyé par l'introspection du broker (utile à
 * l'auto-doc Studio et aux tests).
 */
export interface IAdminRoute {
  /** Nom unique de la route framework (clé de dispatch O(1)). */
  name: string;
  /** Namespace du producteur (`IAdminApi.adminNamespace`). */
  namespace: string;
  /** Chemin absolu monté, ex `/nodefony/http/api/sessions`. */
  path: string;
  /** Méthode HTTP effective (défaut résolu). */
  method: string;
  /** Rôle effectif requis (défaut résolu). */
  role: string;
  /** Définition d'origine. */
  endpoint: IAdminEndpoint;
}

/**
 * Service du data plane admin — vit dans `@nodefony/framework` car lui seul a
 * le Router pour créer des routes dynamiquement.
 *
 * Rôle : collecter les {@link IAdminApi} produits par les modules (et par le
 * kernel, que framework wrappe), puis monter `/nodefony/<namespace>/api/*` au
 * boot. À l'exécution, pour chaque requête, le broker :
 *   1. adapte le `ContextType` HTTP/WS en `IAdminRequest` (params/query/body/
 *      user/roles/requestId) ;
 *   2. applique le RBAC (compare `endpoint.role` à `request.roles`, 403 sinon) ;
 *   3. appelle le `handler`, normalise le retour en `IAdminResponse` ;
 *   4. sérialise en JSON et pose `content-type: application/json` + status.
 *
 * @remarks
 * Pattern d'enregistrement = **push** : un module appelle `register()` dans son
 * `onKernelBoot` (cohérent avec `frontendService.registerEntry`). Le kernel ne
 * pouvant pas importer framework, c'est framework qui construit et enregistre
 * l'`IAdminApi` du kernel (lecture de `kernel.modules`, `process`, uptime…).
 *
 * @remarks
 * Convention de routage figée (cf CLAUDE.md Studio) : data plane toujours en
 * **≥ 3 segments** `/nodefony/<module>/api/*` — jamais une route admin
 * mono-segment `/nodefony/<module>` (collision avec le fallback SPA Studio).
 *
 * Étend {@link IAdminRegistry} (core) : un producteur s'enregistre via la vue
 * minimale `IAdminRegistry` sans dépendre de framework. Ce contrat ajoute le
 * montage des routes et la résolution — réservés à framework (seul à avoir le
 * Router). `getApi`/`register`/etc. portent un nom non-`get` pour ne pas masquer
 * `Service.get` dans l'implémentation (`AdminBroker extends Service`).
 */
export interface IAdminBroker extends IAdminRegistry {
  /** Préfixe racine réservé au framework. Toujours `"/nodefony"`. */
  readonly rootPrefix: string;
  /** Segment marqueur du data plane. Toujours `"api"`. */
  readonly apiSegment: string;
  /** Rôle exigé par défaut quand un endpoint n'en précise pas. */
  readonly defaultRole: string;

  /**
   * Monte toutes les routes de tous les producteurs enregistrés via le Router
   * (`Router.createRoute`). Appelé une fois après le boot des modules, quand
   * tous les `register()` ont eu lieu. Idempotent (no-op si déjà monté).
   */
  mountAll(): void;

  /**
   * Calcule le chemin absolu d'un endpoint sans le monter.
   * `("http", "sessions")` → `"/nodefony/http/api/sessions"`.
   */
  resolvePath(namespace: string, endpointPath: string): string;

  /**
   * Résout une route admin par son nom framework — lookup O(1) utilisé par le
   * controller pont (`AdminApiController.dispatch`) à chaque requête.
   */
  resolve(routeName: string): IAdminRoute | undefined;

  /**
   * Introspection : toutes les routes admin résolues (montées ou montables).
   * Source de l'auto-doc Studio et des tests de non-collision.
   */
  routes(): readonly IAdminRoute[];
}
