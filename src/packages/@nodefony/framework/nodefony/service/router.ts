import {
  Service,
  Module,
  Container,
  Event,
  //inject,
  injectable,
} from "nodefony";
import Route, { RouteOptions } from "../src/Route";
import { ContextType, HttpError, isDomainAllowed } from "@nodefony/http";
import Resolver from "../src/Resolver";
import Controller from "../src/Controller";
import { routeExpectsBodyStream } from "../decorators/routerDecorators";

type RouteRequirementMethods = string | string[] | undefined;

// 🚦 PERF : « route trouvée » monte à NOTICE (jalon visible sans DEBUG) HORS
// production seulement. En prod → DEBUG → 0 log de routage supplémentaire émis
// par requête. Résolu 1× (1ʳᵉ requête, kernel présent), puis caché.
let routeNoticePromoted: boolean | null = null;

/**
 * Décore une erreur 405 avec l'en-tête `Allow` (RFC 9110 §15.5.6) et le type de
 * rejet. Champs ajoutés dynamiquement sur l'`HttpError` au moment du throw.
 */
interface MethodNotAllowedError extends Error {
  allow?: string;
  type?: string;
}

function collectSupportedMethods(route: Route): Set<string> {
  const set = new Set<string>();
  const m = route.requirements?.methods as RouteRequirementMethods;
  if (typeof m === "string") {
    m.split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
      .forEach((x) => set.add(x));
  } else if (Array.isArray(m)) {
    m.map((s) => String(s).toUpperCase()).forEach((x) => set.add(x));
  }
  return set;
}
// Idiome TS officiel des mixins/factories de constructeur — `unknown[]` y casse
// la contravariance des args ; `any[]` gardé volontairement (pas de la dette).
// oxlint-disable-next-line typescript/no-explicit-any -- signature de constructeur générique — `unknown[]` casse l'assignabilité des classes concrètes
export type TypeController<T> = new (...args: any[]) => T;

const routes: Route[] = [];
//const controllers: Record<string, TypeController<Controller>> = {};
const serviceName: string = "router";

// ─── Index de routes (fast path étape 4) ─────────────────────────────────────
// Partition de la table par FORME de path — ne court-circuite JAMAIS le match :
//  - littérale = pattern qui ne peut matcher qu'UNE string exacte (casse-insensible,
//    flag `i` de compile()) → Map path.toLowerCase() → candidates, lookup O(1) ;
//  - dynamique = {var}, wildcard, ou metachar regex NON neutralisé par compile()
//    (qui n'échappe que `/` et `.`) → scan regex ordonné, comme avant.
// resolve() fusionne les deux flux PAR POSITION D'INSERTION → même séquence de
// candidats que le scan linéaire complet, MOINS les littérales d'autres paths
// (pattern ancré ^…$ : elles ne pouvaient pas matcher, et Resolver.match est
// sans effet de bord avant un path-match → les sauter est inobservable).
// Contrat figé par le banc routing-nonregression.test.ts (invariants A→J).

interface IndexedRoute {
  route: Route;
  pos: number;
}

interface RouteIndex {
  statics: Map<string, IndexedRoute[]>;
  dynamics: IndexedRoute[];
  // Photo de la table au build — garde-fou contre les mutations DIRECTES de
  // `routes` sans passer par l'API Router (swap splice/push, pattern
  // d'isolation des bancs de tests) : si elle ne correspond plus, rebuild.
  length: number;
  first: Route | undefined;
  last: Route | undefined;
}

// Metachars qui rendraient le pattern compilé plus large que le path lui-même.
const REG_NON_LITERAL = /[{}*+?()[\]^$|\\]/;
// Liste vide partagée — évite 1 alloc par resolve sans candidate littérale.
const NO_LITERALS: IndexedRoute[] = [];

// `null` = index à (re)construire — posé par toute mutation API de la table.
let routeIndex: RouteIndex | null = null;

function invalidateRouteIndex(): void {
  routeIndex = null;
}

function buildRouteIndex(): RouteIndex {
  const statics = new Map<string, IndexedRoute[]>();
  const dynamics: IndexedRoute[] = [];
  for (let i = 0; i < routes.length; i++) {
    const route = routes[i];
    const path = route.path;
    if (
      path !== undefined &&
      route.variables.length === 0 &&
      !REG_NON_LITERAL.test(path)
    ) {
      const key = path.toLowerCase();
      let list = statics.get(key);
      if (list === undefined) {
        list = [];
        statics.set(key, list);
      }
      list.push({ route, pos: i });
    } else {
      dynamics.push({ route, pos: i });
    }
  }
  return (routeIndex = {
    statics,
    dynamics,
    length: routes.length,
    first: routes[0],
    last: routes[routes.length - 1],
  });
}

@injectable()
class Router extends Service {
  //static controllers = controllers;
  static routes = routes;
  routes: Route[] = Router.routes;
  // V4.3 — instances singleton par classe controller, kernel-scoped (le cache
  // meurt avec le Router/kernel : pas de bleed entre kernels d'un même process,
  // tests inclus). Lazy `null` : coût zéro pour une app 100 % per-request.
  // TS `private` (PAS `#`) : le pattern proxy des tests (`Object.create`) ne
  // passe pas par le ctor — un champ `#` y jetterait TypeError ; le guard
  // `== null` couvre `null` ET `undefined` (proxy sans champ).
  private singletonControllers: Map<
    TypeController<Controller>,
    Promise<Controller>
  > | null = null;
  constructor(
    module: Module,
    //@inject("HttpKernel") private httpKernel: HttpKernel
  ) {
    super(
      serviceName,
      module.container as Container,
      module.notificationsCenter as Event,
      module.options.router,
    );
  }

  /**
   * Retourne l'instance singleton d'une classe controller `@Scope("singleton")`,
   * en la créant au premier appel via `create`. On cache la **promesse** (pas
   * l'instance) : N requêtes concurrentes pendant la création (`initialize()`
   * async) attendent le MÊME travail — jamais deux instances (race de création
   * éliminée structurellement).
   *
   * @param ctor - la classe controller (clé du cache).
   * @param create - fabrique exécutée une seule fois (instantiate + initialize).
   * @returns la promesse de l'instance partagée.
   */
  getSingletonController(
    ctor: TypeController<Controller>,
    create: () => Promise<Controller>,
  ): Promise<Controller> {
    if (this.singletonControllers == null) {
      this.singletonControllers = new Map();
    }
    let instance = this.singletonControllers.get(ctor);
    if (!instance) {
      instance = create();
      this.singletonControllers.set(ctor, instance);
    }
    return instance;
  }

  /**
   * Résout une route pour un contexte donné.
   *
   * @param context - le contexte HTTP/WS courant (porte container, méthode, URL…).
   * @param cleanPathOverride - quand fourni, le matching se fait sur CE pathname au
   *   lieu de `context.request.url` — permet de router un path **porté par un message**
   *   (WS-RPC `invoke`) vers une action, sans muter l'URL de la connexion (état partagé).
   *   `undefined` (cas hot path normal) → comportement inchangé.
   * @param methodOverride - méthode HTTP **logique** à exiger en plus du transport
   *   WEBSOCKET (pont WS-RPC `api.request` d'une MUTATION) : lève l'ambiguïté
   *   GET-via-WS / POST-via-WS sur un même chemin (`context.method` = "WEBSOCKET").
   *   `undefined` (GET/HTTP) → match historique sur `context.method`.
   * @returns un `Resolver` (`.resolve === true` si une route a matché).
   */
  resolve(
    context: ContextType,
    cleanPathOverride?: string,
    methodOverride?: string,
  ): Resolver {
    const resolver = new Resolver(context);
    resolver.methodOverride = methodOverride ?? null;
    // L5a perf : pathname normalisé UNE fois (constant pour la requête) — évite
    // que chaque Route.match du scan O(N) recalcule URL.pathname + regex + alloc.
    // `cleanPathOverride` (WS-RPC invoke) court-circuite le pathname de la connexion.
    const cleanPath = cleanPathOverride ?? Route.cleanPathname(context);
    let index = routeIndex;
    if (
      index === null ||
      index.length !== routes.length ||
      index.first !== routes[0] ||
      index.last !== routes[routes.length - 1]
    ) {
      index = buildRouteIndex();
    }
    const literals =
      cleanPath !== undefined
        ? (index.statics.get(cleanPath.toLowerCase()) ?? NO_LITERALS)
        : NO_LITERALS;
    const dynamics = index.dynamics;
    const litCount = literals.length;
    const dynCount = dynamics.length;
    let li = 0;
    let di = 0;
    // Pass 1 : match path + method — merge ordonné littérales(path) ∪ dynamiques,
    // séquence identique au scan linéaire de la table complète.
    while (li < litCount || di < dynCount) {
      const route =
        li < litCount && (di >= dynCount || literals[li].pos < dynamics[di].pos)
          ? literals[li++].route
          : dynamics[di++].route;
      try {
        if (resolver.match(route, context, cleanPath)) {
          // « route trouvée » = jalon notable (NOTICE hors prod). En prod :
          // AUCUN appel — le Pdu DEBUG était gaté par le seuil Syslog (T2) mais
          // la template string était quand même construite par requête (L1 :
          // ne jamais formater au-dessus du niveau actif).
          if (routeNoticePromoted === null) {
            // P8 : runtime ∈ {development, production} (resolveRuntimeEnv) —
            // le check "prod" était mort.
            routeNoticePromoted = this.kernel?.environment !== "production";
          }
          if (routeNoticePromoted) {
            this.log(`Match route : ${route.name}`, "NOTICE");
          }
          resolver.exception = undefined;
          // P2.9 — pré-calcule (memo) le flag body-stream sur la route matchée :
          // O(1) après le 1er hit. http lit ensuite `resolver.route.bodyStream`
          // (booléen) en amont du parse — sans importer ce helper (cycle interdit).
          routeExpectsBodyStream(route);
          return resolver;
        }
      } catch (e) {
        this.log(`Match route exception : ${route.name} ${e}`, "DEBUG");
        resolver.exception = e as Error;
        continue;
      }
    }
    // Pass 2 : if no method-match but path matches another route → RFC 9110 §15.5.6 (405 + Allow)
    // RFC 9110 §15.5.6 is an HTTP rule — does NOT apply to WebSocket. For WS, preserve the
    // original exception (typically 1002 Protocol Error from Route.matchRequirements).
    // S'exécute AUSSI quand la pass 1 finit sur une 405 : le Allow doit être
    // l'AGRÉGAT des méthodes que le path sert sur CE vhost (§15.5.6), pas celles
    // de la dernière route scannée. Le hostname étant vérifié AVANT les methods
    // (Route.match), toute 405 de pass 1 vient d'une route de CE vhost → la
    // pass 2 retrouve toujours ≥ 1 méthode : le 405 HTTP sort TOUJOURS d'ici.
    if (context.method !== "WEBSOCKET" && context.request?.url) {
      // Réutilise le pathname déjà normalisé (cleanPath) — défini ici car le
      // garde `context.request?.url` ci-dessus implique une URL présente.
      const path = (cleanPath ?? "") || "/";
      const allowed = new Set<string>();
      for (const route of routes) {
        // Une route restreinte à un autre vhost (@Domain) ne SERT pas cette
        // requête → invisible pour le calcul du Allow (sinon un 403 domaine
        // serait masqué par un 405 trompeur). Cf domain-routing.test.ts.
        const servesDomain =
          !route.hostRegexp ||
          isDomainAllowed(route.hostRegexp, context.domain);
        if (route.pattern && route.pattern.test(path) && servesDomain) {
          const m = collectSupportedMethods(route);
          m.forEach((x) => allowed.add(x));
        }
      }
      if (allowed.size > 0) {
        const allowHeader = Array.from(allowed).join(", ");
        const err = new HttpError(
          `Method ${context.method} Not Allowed`,
          405,
          context,
        );
        const methodErr = err as HttpError & MethodNotAllowedError;
        methodErr.allow = allowHeader;
        methodErr.type = "method";
        context.response?.setHeaders({ Allow: allowHeader });
        throw err;
      }
    }
    if (resolver.exception) {
      switch (resolver.exception.code) {
        case 405:
          context.response?.setHeaders({
            Allow: (resolver.exception as MethodNotAllowedError).allow,
          });
          break;
      }
      throw resolver.exception;
    }
    return resolver;
  }

  resolveController(contex: ContextType, name: string): Resolver {
    const resolver = new Resolver(contex);
    resolver.parsePathernController(name);
    return resolver;
  }

  matchRoutes(path: string): RegExpExecArray[] {
    let result = [];
    for (const route of routes) {
      let res = route.pattern?.exec(path);
      if (res) {
        result.push(res);
      }
    }
    return result;
  }

  getRoutes(name: string) {
    if (name) {
      return routes.find((route) => route.name === name);
    }
    return routes;
  }

  setRoute() {}

  removeRoutes(name: string) {
    if (name) {
      const index = routes.findIndex((route) => route.name === name);
      if (index !== -1) {
        routes.splice(index, 1);
        invalidateRouteIndex();
      } else {
        throw new Error(`Route ${name} not found.`);
      }
    } else {
      routes.length = 0;
      invalidateRouteIndex();
    }
  }

  static createRoute(name: string, obj: RouteOptions): Route {
    const routenew = new Route(name, obj);
    routes.push(routenew);
    invalidateRouteIndex();
    return routenew;
  }
  static setController(
    myconstructor: TypeController<Controller>,
    module: Module,
  ): TypeController<Controller> {
    Object.defineProperty(myconstructor.prototype, "module", {
      value: module,
      writable: false,
    });
    // Clé module-scopée `${module}:${ClassName}` (cf Module.getController +
    // forward "module:controller:action") → 2 modules tiers peuvent porter un
    // controller homonyme sans collision dans le registre process-global.
    const key = `${module.name}:${myconstructor.name}`;
    if (Module.controllers[key]) {
      module.log(new Error(`Controller already exist ${key}`), "WARNING");
    }
    // Propage le module sur les routes déjà créées par les décorateurs
    // `@route` + `@controller` (qui s'exécutent à l'import — donc avant ce
    // setController appelé à `onBoot`). Le log est fait par l'appelant
    // (décorateur `@controllers`) pour que le msgid soit `MODULE <name>` —
    // appeler `module.log()` depuis ce contexte static perd parfois la chaîne
    // d'override Module.log → Service.log.
    for (const r of routes) {
      if (r.controller === myconstructor) {
        r.module = { name: module.name };
      }
    }
    return (Module.controllers[key] = myconstructor);
  }

  /**
   * Retourne les routes enregistrées pour un controller donné — utilisé par
   * le décorateur `@controllers` pour logger chaque route depuis le module
   * propriétaire (msgid `MODULE <name>` au lieu de `KERNEL`).
   */
  static getRoutesForController(
    myconstructor: TypeController<Controller>,
  ): Route[] {
    return routes.filter((r) => r.controller === myconstructor);
  }
}

export default Router;
