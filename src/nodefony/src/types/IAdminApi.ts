/**
 * Contrat d'exposition d'admin (Studio data plane) — défini dans le CORE.
 *
 * Vit dans `@nodefony/core` (et non dans framework/http) pour une raison
 * d'architecture : la donnée d'admin peut être produite par N'IMPORTE quel
 * niveau de la pile — y compris un module qui ne dépend que du core (adapter
 * ORM, service IA, kernel lui-même). Le contrat doit donc résider au plus bas
 * niveau commun.
 *
 * Séparation des rôles (inversion de dépendance) :
 *  - Ce fichier = **producteur** de donnée. Un module déclare *quoi* il expose,
 *    sans connaître le transport (HTTP, route, sérialisation).
 *  - `IAdminBroker` (dans `@nodefony/framework`) = **transporteur**. Lui seul a
 *    le Router : il collecte les `IAdminApi` au boot et monte
 *    `/nodefony/<namespace>/api/*`.
 *
 * Le handler reçoit un {@link IAdminRequest} (abstraction du Context HTTP) et
 * renvoie du JSON sérialisable — **jamais** un objet `Context`/`Response`.
 * C'est ce qui permet au core de définir le contrat sans importer
 * `@nodefony/http` (interdit : le core est sous http dans le graphe de deps).
 */

/** Méthodes HTTP supportées par le data plane admin. */
export type AdminHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * Requête admin normalisée — projection minimale du Context HTTP/WS.
 *
 * Le broker (framework) construit cet objet à partir du `ContextType` réel,
 * puis le passe au handler. Le handler n'accède jamais au socket ni à la
 * Response : il lit des données, il renvoie des données.
 */
export interface IAdminRequest {
  /** Variables de route extraites du pattern, ex `{id}` → `params.id`. */
  params: Readonly<Record<string, string>>;
  /** Query string parsée (`?a=1&b=2` → `{ a: "1", b: "2" }`). */
  query: Readonly<Record<string, string | string[]>>;
  /** Corps de requête déjà parsé (JSON), `null` si absent. */
  body: unknown;
  /**
   * Utilisateur authentifié injecté par le firewall (P6), `null` tant que
   * l'auth est mock ou la route anonyme. Typé `unknown` : le core ne connaît
   * pas `IUser` (vit dans `@nodefony/user`).
   */
  user: unknown | null;
  /** Rôles résolus de l'utilisateur courant — base du contrôle d'accès. */
  roles: readonly string[];
  /** Corrélation de logs (ALS `RequestContext.getRequestId()`). */
  requestId?: string;
}

/**
 * Enveloppe de réponse d'un endpoint admin.
 *
 * Un handler peut renvoyer directement sa donnée (`T`) — le broker assume
 * `{ status: 200, body: T }` — ou cette enveloppe pour piloter le statut et
 * les en-têtes.
 */
export interface IAdminResponse<T = unknown> {
  /** Code HTTP, défaut `200`. */
  status?: number;
  /** En-têtes additionnels (le broker pose `content-type: application/json`). */
  headers?: Readonly<Record<string, string>>;
  /** Charge utile sérialisable JSON. */
  body: T;
}

/**
 * Handler d'un endpoint admin : fonction pure entrée → sortie.
 *
 * Synchrone ou async. Renvoie soit la donnée brute, soit une
 * {@link IAdminResponse} pour contrôler statut/headers.
 */
export type AdminHandler<T = unknown> = (
  request: IAdminRequest,
) => T | IAdminResponse<T> | Promise<T | IAdminResponse<T>>;

/**
 * Définition déclarative d'un endpoint, relative au namespace du module.
 *
 * Exemple : `{ path: "sessions", method: "GET" }` sur le module `http` est
 * monté en `GET /nodefony/http/api/sessions`.
 */
export interface IAdminEndpoint<T = unknown> {
  /**
   * Chemin RELATIF au namespace, sans `/` initial. Supporte les variables de
   * route du framework (`"routes/{id}"`). **≥ 1 segment** — interdit de monter
   * la racine `/nodefony/<module>/api` seule (réservée à un éventuel index).
   */
  path: string;
  /** Méthode HTTP, défaut `"GET"`. */
  method?: AdminHttpMethod;
  /**
   * Rôle minimum requis pour appeler l'endpoint (RBAC appliqué par le broker).
   * Défaut `"ROLE_NODEFONY_ADMIN"`. Le broker refuse (403) si
   * `request.roles` ne le contient pas.
   */
  role?: string;
  /**
   * Endpoint PUBLIC : le broker n'impose AUCUN rôle (pas de défaut
   * `ROLE_NODEFONY_ADMIN`), la route est atteignable sans authentification.
   * À RÉSERVER aux sondes (liveness/readiness cloud-native) ; toute gradation
   * d'information par rôle se fait alors DANS le handler (`request.roles`). La
   * route doit aussi être placée hors d'une aire fermée (zone firewall dédiée
   * avec `anonymous`), sinon le firewall la verrouille en amont (401).
   */
  public?: boolean;
  /** Résumé court pour l'auto-doc Studio et l'introspection. */
  summary?: string;
  /** Implémentation. */
  handler: AdminHandler<T>;
}

/**
 * Métadonnées d'affichage du module dans la sidebar Studio.
 */
export interface IAdminDescriptor {
  /** Libellé humain, ex `"HTTP"`, `"Sécurité"`, `"Kernel"`. */
  label: string;
  /** Nom d'icône (jeu Tabler, cohérent avec le frontend Studio). */
  icon?: string;
  /** Ordre d'affichage croissant dans la sidebar. */
  order?: number;
  /** Rôle requis pour voir l'entrée de menu (peut différer par endpoint). */
  role?: string;
}

/**
 * Contrat qu'un producteur (module ou kernel) implémente pour exposer sa
 * donnée d'admin à Studio via le data plane `/nodefony/<namespace>/api/*`.
 *
 * Un `IAdminApi` est un objet **séparé** de la classe `Module` (pas un mixin) :
 * un module l'expose via `getAdminApi?(): IAdminApi | null` et le broker le
 * collecte au boot. Cela évite de polluer la classe `Module` et permet au
 * kernel — qui n'est pas un `Module` — d'exposer le sien de la même façon.
 *
 * @see IAdminBroker (dans `@nodefony/framework`) pour le montage des routes.
 */
export interface IAdminApi {
  /**
   * Segment de route ET clé d'identification unique. Donne
   * `/nodefony/<adminNamespace>/api/*`. Ex `"http"`, `"security"`, `"kernel"`.
   * Doit être stable (les liens Studio en dépendent) et url-safe.
   */
  readonly adminNamespace: string;
  /** Métadonnées d'affichage (sidebar Studio). */
  adminDescriptor(): IAdminDescriptor;
  /** Endpoints exposés par ce producteur. Évalué une fois au montage. */
  adminEndpoints(): IAdminEndpoint[];
}

/**
 * Façade d'enregistrement du data plane admin — vue **minimale** du broker que
 * voit un producteur.
 *
 * Vit dans le core (pas dans framework) précisément pour que n'importe quel
 * module producteur puisse s'enregistrer **sans importer `@nodefony/framework`**
 * (interdit : `@nodefony/http` etc. sont sous framework dans le graphe de deps).
 * Un module récupère le service `"adminBroker"` du container et le type via
 * cette interface :
 *
 * ```ts
 * const registry = container.get("adminBroker") as IAdminRegistry;
 * registry.register(myAdminApi);
 * ```
 *
 * Le contrat complet (montage des routes, résolution) est `IAdminBroker` dans
 * `@nodefony/framework`, qui étend celui-ci.
 */
export interface IAdminRegistry {
  /**
   * Enregistre un producteur. À appeler dans `onKernelBoot` (avant le montage
   * fait par framework à `onKernelReady`).
   * @throws si le namespace est déjà pris ou si le montage a déjà eu lieu.
   */
  register(api: IAdminApi): this;
  /** Retire un producteur (et ses routes si déjà montées). */
  unregister(namespace: string): boolean;
  /** `true` si un producteur est enregistré sous ce namespace. */
  has(namespace: string): boolean;
  /** Producteur enregistré sous ce namespace, ou `undefined`. */
  getApi(namespace: string): IAdminApi | undefined;
  /** Liste immuable des producteurs enregistrés. */
  list(): readonly IAdminApi[];
}
