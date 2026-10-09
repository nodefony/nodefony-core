import {
  Service,
  Module,
  Container,
  Injector,
  //inject,
  injectable,
  isPromise,
  stripTrailingSlashes,
} from "nodefony";
import type { DefaultOptionsService, MaybePromise } from "nodefony";
import Route, { RouteOptions } from "../src/Route";
import { ContextType, HttpError, isDomainAllowed } from "@nodefony/http";
import type { IRequestRouter } from "@nodefony/http";
import Resolver from "../src/Resolver";
import Controller from "../src/Controller";
import { routeExpectsBodyStream } from "../decorators/routerDecorators";

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

/**
 * Méthodes que sert une route — lues sur le `methodsSet` COMPILÉ par
 * `Route.compileRequirements`, jamais recalculées depuis la config brute.
 * Deux lectures de la même règle avaient divergé : la route acceptait HEAD
 * (implicite sur GET, RFC 9110 §9.1) quand le `Allow` du 405 l'omettait.
 */
function collectSupportedMethods(route: Route): ReadonlySet<string> {
  return route.methodsSet ?? NO_METHODS;
}
const NO_METHODS: ReadonlySet<string> = new Set();
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
//  - dynamique = {var}, wildcard, ou metachar regex → scan regex ordonné.
//    `compile()` neutralise pourtant TOUT littéral depuis qu'il échappe le
//    chemin AVANT d'y poser les groupes : un path à metachar pourrait donc
//    rejoindre les littérales. On l'en tient à l'écart quand même — la
//    partition ne doit jamais être plus permissive que le matching qu'elle
//    remplace, et le gain porterait sur des chemins qui n'existent pas.
// resolve() fusionne les deux flux PAR POSITION D'INSERTION → même séquence de
// candidats que le scan linéaire de la table où les replis (`Route.fallback`)
// sont repoussés en fin, dans leur ordre relatif, MOINS les littérales d'autres paths
// (pattern ancré ^…$ : elles ne pouvaient pas matcher, et Resolver.match est
// sans effet de bord avant un path-match → les sauter est inobservable).
// Contrat figé par le banc routing-nonregression.test.ts (invariants A→J).

interface IndexedRoute {
  route: Route;
  pos: number;
  // Préfixe littéral du chemin, en minuscules ASCII (voir `literalPrefix`) —
  // `""` quand il n'est pas exploitable. Sert de pré-filtre au scan dynamique.
  prefix: string;
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

/**
 * Préfixe LITTÉRAL d'un chemin de route : tout ce qui précède son premier
 * caractère non littéral, en minuscules. Le motif compilé étant ancré (`^…$`),
 * un chemin que cette route peut servir commence FORCÉMENT par ce préfixe —
 * c'est ce qui autorise à écarter la route sans exécuter son motif.
 *
 * ⚠️ Garde ASCII. Le pré-filtre compare `cleanPath.toLowerCase()` à ce préfixe,
 * or `toLowerCase()` (repli Unicode complet) et le drapeau `i` du motif (repli
 * simple) ne traitent PAS la casse de la même façon hors ASCII : comparer les
 * deux pourrait écarter une route qui matche — un 404 à la place d'une réponse.
 * On tronque donc le préfixe au premier caractère non ASCII : filtrer moins est
 * toujours correct, filtrer à tort ne l'est jamais.
 *
 * @param path - chemin déclaré de la route (`undefined` pour une route sans chemin).
 * @returns le préfixe exploitable, ou `""` quand il n'y en a pas (route jamais filtrée).
 */
function literalPrefix(path: string | undefined): string {
  if (path === undefined) {
    return "";
  }
  const cut = path.search(REG_NON_LITERAL);
  const head = cut === -1 ? path : path.slice(0, cut);
  for (let i = 0; i < head.length; i++) {
    if (head.charCodeAt(i) > 0x7f) {
      return head.slice(0, i).toLowerCase();
    }
  }
  return head.toLowerCase();
}

// `null` = index à (re)construire — posé par toute mutation API de la table.
let routeIndex: RouteIndex | null = null;

function invalidateRouteIndex(): void {
  routeIndex = null;
}

function buildRouteIndex(): RouteIndex {
  const statics = new Map<string, IndexedRoute[]>();
  const dynamics: IndexedRoute[] = [];
  // Deux passes : les routes ordinaires, puis les replis (`Route.fallback`),
  // dont la position est décalée de la longueur de la table. Les deux listes
  // restent ainsi triées par `pos` — ce que la fusion de `resolve` exige — et
  // un repli ne passe jamais devant une route ordinaire, quel que soit l'ordre
  // de déclaration des modules. Coût : un second parcours, au build seulement.
  const total = routes.length;
  for (let pass = 0; pass < 2; pass++) {
    const fallbackPass = pass === 1;
    for (const [rank, route] of routes.entries()) {
      if (route.fallback !== fallbackPass) {
        continue;
      }
      const i = fallbackPass ? total + rank : rank;
      indexRoute(route, i, statics, dynamics);
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

/**
 * Range une route dans l'index — littérale par son chemin exact, dynamique
 * sinon — à la position `i` qui décide de son rang dans la fusion de `resolve`.
 */
function indexRoute(
  route: Route,
  i: number,
  statics: Map<string, IndexedRoute[]>,
  dynamics: IndexedRoute[],
): void {
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
    // Une littérale est déjà trouvée par son chemin exact : son préfixe ne
    // sert à rien, et le pré-filtre ne s'applique pas à elle.
    list.push({ route, pos: i, prefix: "" });
  } else {
    dynamics.push({ route, pos: i, prefix: literalPrefix(path) });
  }
}

@injectable()
class Router extends Service implements IRequestRouter {
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
    new (...args: never[]) => object,
    MaybePromise<object>
  > | null = null;
  constructor(
    module: Module,
    //@inject("HttpKernel") private httpKernel: HttpKernel
  ) {
    super(
      serviceName,
      module.container as Container,
      module.notificationsCenter,
      module.options.router as DefaultOptionsService | undefined,
    );
  }

  /**
   * Retourne l'instance singleton d'une classe controller `@Scope("singleton")`,
   * en la créant au premier appel via `create`.
   *
   * Tant que la création est en cours (`initialize()` async), c'est la
   * **promesse** qui est en cache : N requêtes concurrentes attendent le MÊME
   * travail — jamais deux instances (race de création éliminée
   * structurellement). Dès que l'instance est prête, elle REMPLACE la promesse :
   * les requêtes suivantes la reçoivent directement, au lieu d'attendre à
   * chaque fois une promesse déjà tenue (#505).
   *
   * @param ctor - la classe controller (clé du cache).
   * @param create - fabrique exécutée une seule fois (instantiate + initialize).
   * @returns l'instance partagée quand elle existe — ou que `create` la rend
   *   sans rien attendre —, sinon la promesse de sa création.
   * @throws ce que `create` lève de façon synchrone ; rien n'est alors mis en
   *   cache, la requête suivante recrée.
   */
  getSingletonController<T extends object>(
    ctor: new (...args: never[]) => T,
    create: () => MaybePromise<T>,
  ): MaybePromise<T> {
    this.singletonControllers ??= new Map();
    const cached = this.singletonControllers.get(ctor);
    if (cached !== undefined) {
      // La clé EST la classe de l'instance : le lien ctor → T tient par
      // construction, mais une Map ne sait pas l'exprimer par entrée.
      return cached as MaybePromise<T>;
    }
    const created = create();
    if (!isPromise(created)) {
      this.singletonControllers.set(ctor, created);
      return created;
    }
    // `Promise.resolve` rend la promesse native elle-même (aucune allocation) et
    // n'enveloppe qu'un thenable étranger.
    const pending = Promise.resolve(created) as Promise<T>;
    this.singletonControllers.set(ctor, pending);
    pending.then(
      (instance) => {
        // La garde d'identité épargne une création plus récente posée
        // entre-temps (éviction après un échec, puis recréation).
        if (this.singletonControllers?.get(ctor) === pending) {
          this.singletonControllers.set(ctor, instance);
        }
      },
      () => {
        // Une création rejetée (initialize() qui lève : base pas encore prête)
        // ne reste pas en cache — sinon le contrôleur est mort jusqu'au
        // redémarrage. Les appelants déjà en attente partagent l'échec ; la
        // requête suivante recrée.
        if (this.singletonControllers?.get(ctor) === pending) {
          this.singletonControllers.delete(ctor);
        }
      },
    );
    return pending;
  }

  /**
   * Dit si au moins une route déclare le transport `WEBSOCKET` pour ce chemin
   * — contrôle d'avant `101` du pipeline WebSocket (cf `IRequestRouter`).
   *
   * Parcours de la table entière, sans l'index de `resolve` : il est lu une
   * fois par CONNEXION (pas par message), et une route dont les méthodes
   * changent après coup (`addRequirement`) ne laisse ainsi aucun index périmé.
   * Même normalisation que `resolve` (`stripTrailingSlashes`), même motif.
   *
   * @param pathname - chemin de l'URL d'upgrade
   * @returns `true` si une route WebSocket a un motif qui couvre ce chemin
   */
  servesWebsocket(pathname: string): boolean {
    const path = stripTrailingSlashes(pathname);
    for (const route of routes) {
      if (
        route.methodsSet?.has("WEBSOCKET") === true &&
        route.pattern?.test(path) === true
      ) {
        return true;
      }
    }
    return false;
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
    // Un chemin imposé = le pont WS-RPC invoque une ressource PRÉCISE, ce n'est
    // pas l'ouverture de la connexion. La distinction sert à l'autorisation
    // héritée de la zone (`Resolver.messageInvocation`).
    resolver.messageInvocation = cleanPathOverride !== undefined;
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
    // Minuscule calculée UNE fois : elle sert au lookup des littérales ET au
    // pré-filtre des dynamiques (aucune allocation nouvelle — ce `toLowerCase()`
    // existait déjà pour le lookup, et V8 rend la même chaîne si rien ne change).
    const cleanPathLower =
      cleanPath !== undefined ? cleanPath.toLowerCase() : undefined;
    const literals =
      cleanPathLower !== undefined
        ? (index.statics.get(cleanPathLower) ?? NO_LITERALS)
        : NO_LITERALS;
    const dynamics = index.dynamics;
    const litCount = literals.length;
    const dynCount = dynamics.length;
    let li = 0;
    let di = 0;
    // Pass 1 : match path + method — merge ordonné littérales(path) ∪ dynamiques,
    // séquence identique au scan linéaire de la table complète.
    while (li < litCount || di < dynCount) {
      let route: Route;
      // Vraie pour une candidate de l'index des littérales : son chemin ne
      // porte aucune syntaxe de motif (cf `Route.match`, paramètre `literal`).
      let fromLiterals = false;
      // Lecture au-delà de la fin = undefined : c'est la liste épuisée.
      const literal = literals[li];
      const candidate = dynamics[di];
      if (
        literal !== undefined &&
        (candidate === undefined || literal.pos < candidate.pos)
      ) {
        li++;
        route = literal.route;
        fromLiterals = true;
      } else if (candidate === undefined) {
        break;
      } else {
        di++;
        // Pré-filtre O(longueur du préfixe) : le motif étant ancré, une route
        // dont le préfixe littéral ne débute pas le chemin ne peut PAS matcher.
        // `startsWith` coûte quelques nanosecondes là où `exec` en coûte une
        // vingtaine — sur une table où les dynamiques dominent, c'est le scan
        // entier qui change d'échelle. On SAUTE une candidate, on n'en réordonne
        // aucune : la séquence reste celle de l'insertion (invariant A).
        if (
          candidate.prefix !== "" &&
          cleanPathLower !== undefined &&
          !cleanPathLower.startsWith(candidate.prefix)
        ) {
          continue;
        }
        route = candidate.route;
      }
      try {
        if (resolver.match(route, context, cleanPath, fromLiterals)) {
          // « route trouvée » = jalon notable (NOTICE hors prod). En prod :
          // AUCUN appel — le Pdu DEBUG était gaté par le seuil Syslog (T2) mais
          // la template string était quand même construite par requête (L1 :
          // ne jamais formater au-dessus du niveau actif).
          // P8 : runtime ∈ {development, production} (resolveRuntimeEnv) —
          // le check "prod" était mort.
          routeNoticePromoted ??= this.kernel?.environment !== "production";
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
        this.log(`Match route exception : ${route.name} ${String(e)}`, "DEBUG");
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
    // F-B : garde sur `cleanPath` (undefined ⇔ pas d'URL/pathname) — lire
    // `context.request?.url` déclencherait le getter paresseux HTTP (parse
    // WHATWG) sur chaque 404/405.
    if (context.method !== "WEBSOCKET" && cleanPath !== undefined) {
      const path = cleanPath || "/";
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
      // WEBSOCKET est la pseudo-méthode du transport, pas une méthode HTTP :
      // elle n'a rien à faire dans `Allow` (RFC 9110 §10.2.1). `allowed` est un
      // Set neuf, le retrait ne touche aucune route.
      const servesWebsocket = allowed.delete("WEBSOCKET");
      if (allowed.size === 0 && servesWebsocket) {
        // Le chemin n'existe qu'en WebSocket : 426 Upgrade Required, qui DOIT
        // porter `Upgrade` et l'option `upgrade` de Connection (§15.5.22, §7.8).
        context.response?.setHeaders({
          Upgrade: "websocket",
          Connection: "Upgrade",
        });
        throw new HttpError("Upgrade Required: websocket", 426, context);
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
  /**
   * Enregistre une classe contrôleur pour un module — l'entonnoir UNIQUE : le
   * décorateur `@controllers` y passe, comme les contrôleurs internes que le
   * framework enregistre directement (plan d'administration, OAuth,
   * WebAuthn…).
   *
   * C'est donc ICI que se refusent, au démarrage, les fautes de déclaration
   * qu'un contrôleur ne révélerait qu'à sa première requête : une dépendance
   * captive (un singleton qui détient un service de portée `request`), et une
   * portée que sa classe de base n'admet pas (`Controller.assertScope`).
   *
   * @param myconstructor - la classe contrôleur.
   * @param module - le module qui la porte.
   * @returns la classe, rangée sous `module:Classe`.
   * @throws BootConfigurationError sur une dépendance captive ou une portée
   *   refusée — fatale dans tous les environnements.
   */
  static setController(
    myconstructor: TypeController<Controller>,
    module: Module,
  ): TypeController<Controller> {
    // Graphe lu sur les DÉCLARATIONS, rien d'instancié : un contrôleur n'est
    // construit qu'à sa première requête, et sans cette analyse un singleton
    // qui réclame un service `request` démarrerait vert puis rendrait 500 —
    // ou garderait l'exemplaire d'une requête pour toutes les suivantes.
    Injector.assertNoCaptiveDependency(myconstructor);
    // Lu par typage structurel, comme `scope` par le Resolver : une classe
    // qui n'hérite pas de `Controller` ne déclare aucune contrainte.
    (myconstructor as { assertScope?: () => void }).assertScope?.();
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
