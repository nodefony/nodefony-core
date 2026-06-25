import "reflect-metadata";
//import { fileURLToPath } from "url";
import Router, { TypeController } from "../service/router";
import { RouteOptions } from "../src/Route";
import Controller from "../src/Controller";
import type { ControllerScope } from "../src/Controller";
//import { dirname, join, resolve, relative } from "node:path";
import { Module, RequestContext } from "nodefony";
import { ControllerConstructor } from "../src/Route";
import type { HTTPMethod, SessionIntent } from "@nodefony/http";

// Idiome TS officiel des mixins de constructeur — `any[]` requis (un `unknown[]`
// casse l'`extends constructor` du mixin `controllers`). Pas de la dette.
type Constructor<T = {}> = new (...args: any[]) => T;

const metadataKey = "routes:definitions";

function controllers(
  controller: TypeController<Controller>[] | TypeController<Controller>,
): <T extends Constructor<Module>>(constructor: T) => T {
  return function <T extends Constructor<Module>>(constructor: T): T {
    class NewConstructorControllers extends constructor {
      constructor(...args: any[]) {
        super(...args);
        this.kernel?.once("onBoot", async () => {
          return this.initDecoratorControllers();
        });
      }
      async initDecoratorControllers() {
        const log = (contr: TypeController<Controller>) => {
          Router.setController(contr, this);
          this.log(`ADD CONTROLLER : ${contr.name}`, "DEBUG");
          // Le log des routes DOIT être émis depuis `this` (le module) — pas
          // depuis Router.setController qui est static et perd la chaîne
          // d'override Module.log. Ici `this.log()` produit msgid `MODULE <name>`.
          if (this.kernel?.debug) {
            for (const r of Router.getRoutesForController(contr)) {
              this.log(`route + ${r.toLogLine()}`, "DEBUG");
            }
          }
        };
        if (Array.isArray(controller)) {
          for (const contr of controller) {
            log(contr);
          }
        } else {
          log(controller);
        }
      }
    }
    return NewConstructorControllers;
  };
}

/**
 * Declaration Controller
 *
 * @param prefix - prefixage du router du controller.
 * @param options - Les options .
 * @returns Un décorateur de méthode qui peut être utilisé pour annoter une méthode de contrôleur.
 *
 * @example
 * \@controller("/openapi")
 * \@UseSession()
 *  class OpenApiController extends Controller {
 *    constructor(context: Context) {
 *       super("OpenApiController", context);
 *    }
 *    \@route("index-openapi", { path: "" })
 *     index() {
 *      this.render({});
 *    }
 *  }
 */
function controller(prefix: string) {
  return function <T extends ControllerConstructor & { prefix?: string }>(
    mycontroller: T,
  ): T {
    //const constructor = mycontroller.constructor;
    //const className = mycontroller.name;
    mycontroller.prefix = prefix;
    const metadata = Reflect.getMetadata(metadataKey, mycontroller) || {};
    if (metadata && Object.keys(metadata).length !== 0) {
      let hasMagic: false | { name: string; options: RouteOptions } = false;
      for (const name in metadata) {
        const options = metadata[name];
        options.prefix = prefix;
        // @Domain : précédence @route({host}) > @Domain méthode > @Domain classe.
        if (options.host === undefined) {
          const methodDomain = Reflect.getMetadata(
            DOMAIN_METHOD_METADATA,
            mycontroller,
            options.classMethod,
          );
          const classDomain = Reflect.getMetadata(
            DOMAIN_CLASS_METADATA,
            mycontroller,
          );
          const domain = methodDomain ?? classDomain;
          if (domain) {
            options.host = domain;
          }
        }
        // @BypassFirewall : précédence méthode > classe (comme @Domain). L'option
        // `@Get(…, { bypassFirewall:true })` est déjà dans `options` et l'emporte.
        // Lecture au montage → ordre des décorateurs indifférent (fail-closed : un
        // oubli laisse la route gatée).
        if (options.bypassFirewall !== true) {
          const methodBypass = Reflect.getMetadata(
            BYPASS_FIREWALL_METHOD_METADATA,
            mycontroller,
            options.classMethod,
          );
          const classBypass = Reflect.getMetadata(
            BYPASS_FIREWALL_CLASS_METADATA,
            mycontroller,
          );
          if (methodBypass === true || classBypass === true) {
            options.bypassFirewall = true;
          }
        }
        if (options.path == "*") {
          hasMagic = { options, name };
          continue;
        }
        // Création seule — le log est différé à `Router.setController()` (hook
        // `onBoot` du décorateur `@controllers`) qui a accès au `module` et
        // peut donc émettre une ligne complète `@module/Controller.action`.
        Router.createRoute(name, options);
      }
      if (hasMagic) {
        Router.createRoute(hasMagic.name, hasMagic.options);
      }
    }
    Reflect.deleteMetadata(metadataKey, mycontroller); // Supprimer les métadonnées
    return mycontroller;
  };
}

/**
 * Crée une route avec le nom et les options spécifiés.
 *
 * @param name - Le nom de la route.
 * @param options - Les options de la route.
 * @returns Un décorateur de méthode qui peut être utilisé pour annoter une méthode de contrôleur.
 *
 * @example
 * \@route("myroute", {
 *   path: "/add/{name}",
 *   method: ["GET", "POST"],
 *   defaults: { name: "john" },
 * })
 * method(name: string) {
 *   return this.renderJson({ name });
 * }
 */
function route(name: string, options: RouteOptions) {
  return function (
    target: object,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const className = target.constructor.name;
    const classMethod = propertyKey;
    const prefix = options.prefix || null;
    const path = options.path || "";
    let filePath;
    try {
      const stackTrace = new Error().stack?.split("\n").slice(2); // Ignorer les deux premières lignes (la ligne de la fonction et la ligne de l'appelant de la fonction)
      if (!stackTrace) {
        throw new Error("Erreur lors de l'obtention de la pile d'appels.");
      }
      // Obtenez le chemin du fichier de contrôleur
      const controllerFilePath = extractControllerFilePath(stackTrace);
      if (!controllerFilePath) {
        throw new Error(
          "Fichier de contrôleur non trouvé dans la pile d'appels.",
        );
      }
      // Utilisez le chemin du fichier de contrôleur pour le reste du traitement
      filePath = controllerFilePath;
    } catch (error) {
      filePath = error;
    }
    const metadata = Reflect.getMetadata(metadataKey, target.constructor) || {};
    metadata[name] = {
      path,
      filePath,
      constructor: target.constructor as ControllerConstructor,
      prefix,
      className,
      classMethod,
      method: options.method,
      host: options.host,
      defaults: options.defaults,
      requirements: options.requirements,
      // P6 : une route déclarée publique (liveness, login…) court-circuite le
      // firewall. Défaut `false` côté `Route` → omis = comportement inchangé.
      bypassFirewall: options.bypassFirewall,
    };
    Reflect.defineMetadata(metadataKey, metadata, target.constructor); // Enregistrer les métadonnées mises à jour
    return descriptor;
  };
}

// Fonction pour extraire le chemin du fichier de contrôleur de la stack trace
function extractControllerFilePath(stackTrace: string[]): string | undefined {
  // Recherchez les lignes de la stack trace qui correspondent au chemin du fichier de contrôleur
  for (const line of stackTrace) {
    const match = line.match(/\s+at file:\/\/(.*\/controllers?\/.*\.js)/);
    if (match && match[1]) {
      return match[1];
    }
  }
  return undefined;
}

// ── Metadata keys (exported for Resolver) ──────────────────────────────────
export const HTTP_CODE_METADATA = "route:httpCode";
export const HEADERS_METADATA = "route:responseHeaders";
export const REDIRECT_METADATA = "route:redirect";
export const PARAM_ARGS_METADATA = "route:paramArgs";
export const DOMAIN_CLASS_METADATA = "route:domainClass";
export const DOMAIN_METHOD_METADATA = "route:domainMethod";
export const BYPASS_FIREWALL_CLASS_METADATA = "route:bypassFirewallClass";
export const BYPASS_FIREWALL_METHOD_METADATA = "route:bypassFirewallMethod";
// Autorisation déclarative (P6 J7) — clauses @IsGranted (classe sur le ctor,
// méthode sur le prototype keyé par nom de méthode, comme PARAM_ARGS_METADATA) ;
// marqueur @Anonymous (skip authz, en plus du bypass firewall pour l'authn).
const SECURITY_CLAUSES_METADATA = "nodefony:security:clauses";
const SECURITY_ANONYMOUS_METADATA = "nodefony:security:anonymous";
// Autorisation par scope (P6.8) — clauses @RequireScope (axe `api:action`, clé API
// / JWT). Metadata DÉDIÉE (≠ SECURITY_CLAUSES) pour que la découverte au boot
// puisse agréger les scopes par API sans les confondre avec les rôles. Fusionnée
// au même `SecurityRequirement` que @IsGranted pour réutiliser l'enforcement.
const SECURITY_SCOPES_METADATA = "nodefony:security:scopes";
// Directives CSP additionnelles par action (@Csp). Posées sur le ctor (classe) ou
// le prototype keyé par nom (méthode), comme les clauses @IsGranted.
const CSP_DIRECTIVES_METADATA = "nodefony:csp:directives";
// CSRF par action : @CsrfProtect (opt-in synchronizer token) / @CsrfExempt (opt-out
// de la défense CSRF en gardant l'auth). Marqueurs booléens classe + méthode.
const CSRF_PROTECT_METADATA = "nodefony:csrf:protect";
const CSRF_EXEMPT_METADATA = "nodefony:csrf:exempt";
export const USE_SESSION_CLASS_METADATA = "session:useClass";
export const USE_SESSION_METHOD_METADATA = "session:useMethod";

export type ParamSource =
  | "param"
  | "body"
  | "query"
  | "headers"
  | "cookie"
  | "session"
  | "req"
  | "res"
  | "file"
  | "files"
  // @CurrentUser() — l'utilisateur résolu par le firewall (ALS). Jamais le
  // credential ; lecture O(1) de RequestContext. `undefined` hors zone authentifiée.
  | "user";
export interface ParamMeta {
  source: ParamSource;
  key?: string;
  index: number;
  /**
   * P2.9 — `@Body({ stream: true })` : injecte le **flux brut** de la requête
   * (`IncomingMessage`, un `Readable`) au lieu du body parsé en mémoire. Permet
   * de piper un gros upload (vidéo, backup) vers disque/S3 sans pic RAM. Le
   * pipeline saute le parse busboy/JSON pour la route concernée (cf
   * `routeExpectsBodyStream` + `handleHttp`).
   */
  stream?: boolean;
}

export interface RedirectMeta {
  url: string;
  statusCode: number;
}

// ── Sécurité — autorisation déclarative (@IsGranted / @Anonymous, P6 J7) ──────

/**
 * Une clause `@IsGranted` : un OU plusieurs attributs (OR interne), sujet
 * optionnel. `@IsGranted("ROLE_ADMIN")` → `{ anyOf: ["ROLE_ADMIN"] }` ;
 * `@IsGranted(["A","B"])` → `{ anyOf: ["A","B"] }` (un seul suffit) ;
 * `@IsGranted("doc.edit", { subject: "id" })` → le param de route `id` est passé
 * au voter.
 */
export interface SecurityClause {
  /** Attributs en OR — un seul accordé suffit pour valider la clause. */
  readonly anyOf: readonly string[];
  /** Nom du paramètre de route passé comme `subject` au voter (optionnel). */
  readonly subjectParam?: string;
}

/**
 * Exigence d'autorisation **figée** d'une action — calculée UNE fois par route
 * (fusion classe + méthode) puis gelée sur `RouteActionMeta.security`. Objet
 * PARTAGÉ entre toutes les requêtes : ne jamais muter. `null` (hors de ce type)
 * = aucune garde → coût nul sur le hot path.
 *
 * Plusieurs `@IsGranted` empilés = `clauses` multiples en **AND** (toutes doivent
 * passer). `@Anonymous()` ne produit jamais de `SecurityRequirement` (l'action
 * devient `security: null` = publique).
 */
export interface SecurityRequirement {
  /** Clauses en AND — toutes doivent être accordées (chacune est un OR interne). */
  readonly clauses: readonly SecurityClause[];
}

/**
 * Directives CSP additionnelles déclarées par une action (`@Csp`) :
 * `directive → sources` (ex. `{ "frame-src": ["https://youtube.com"] }`).
 * Structurellement compatible avec `CspFragment` (@nodefony/security) — aucun
 * import cross-module (0 cycle). Mergé additivement dans le CSP de la réponse
 * par le firewall, UNIQUEMENT sur les routes qui en déclarent (cold path).
 */
export type CspDirectives = Record<string, readonly string[]>;

// ── HTTP method decorator factory ───────────────────────────────────────────
type MethodDecoratorOptions = Omit<RouteOptions, "path" | "method">;

function httpMethodDecorator(methods: HTTPMethod[]) {
  return function (path: string = "", options: MethodDecoratorOptions = {}) {
    return function (
      target: object,
      propertyKey: string,
      descriptor: PropertyDescriptor,
    ): PropertyDescriptor {
      const proto = target as Record<string, unknown>;
      const name = `${(proto.constructor as { name: string }).name}::${propertyKey}`;
      return route(name, {
        ...options,
        path,
        requirements: {
          ...options.requirements,
          methods,
        },
      })(target, propertyKey, descriptor);
    };
  };
}

const Get = httpMethodDecorator(["GET"]);
const Post = httpMethodDecorator(["POST"]);
const Put = httpMethodDecorator(["PUT"]);
const Delete = httpMethodDecorator(["DELETE"]);
const Patch = httpMethodDecorator(["PATCH"]);
const Options = httpMethodDecorator(["OPTIONS"]);
const Head = httpMethodDecorator(["HEAD"]);

/**
 * `@All` — route sans restriction de méthode : matche **toutes** les méthodes
 * HTTP (équivalent NestJS `@All()`). N'émet aucun requirement `methods`, donc
 * `Route.matchRequirements` ne lève jamais 405 sur la méthode.
 */
function All(path: string = "", options: MethodDecoratorOptions = {}) {
  return function (
    target: object,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ): PropertyDescriptor {
    const proto = target as Record<string, unknown>;
    const name = `${(proto.constructor as { name: string }).name}::${propertyKey}`;
    return route(name, { ...options, path })(target, propertyKey, descriptor);
  };
}

// ── Response decorators ─────────────────────────────────────────────────────
function HttpCode(statusCode: number) {
  return function (
    target: object,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ): PropertyDescriptor {
    Reflect.defineMetadata(HTTP_CODE_METADATA, statusCode, target, propertyKey);
    return descriptor;
  };
}

function Header(key: string, value: string) {
  return function (
    target: object,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ): PropertyDescriptor {
    const existing: Record<string, string> =
      Reflect.getMetadata(HEADERS_METADATA, target, propertyKey) || {};
    existing[key] = value;
    Reflect.defineMetadata(HEADERS_METADATA, existing, target, propertyKey);
    return descriptor;
  };
}

function Redirect(url: string, statusCode: number = 302) {
  return function (
    target: object,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ): PropertyDescriptor {
    const meta: RedirectMeta = { url, statusCode };
    Reflect.defineMetadata(REDIRECT_METADATA, meta, target, propertyKey);
    return descriptor;
  };
}

// ── Domain decorator (classe + méthode) ─────────────────────────────────────

/**
 * Restreint une route (décorateur de **méthode**) ou tout un contrôleur
 * (décorateur de **classe**) à un ou plusieurs vhosts. Source de vérité du
 * domaine de routing — le `host` posé ici alimente `Route.host`, compilé en
 * RegExp ancrée/wildcard (matcher partagé `@nodefony/http`). Domaine non servi
 * par la route → 403.
 *
 * Précédence : `@route({ host })` > `@Domain` méthode > `@Domain` classe.
 *
 * Pattern : exact (`"marseille.fr"`) ou wildcard un-label (`"*.cdn.nodefony.com"`).
 *
 * ⚠️ En décorateur de **classe**, placer `@Domain` SOUS `@controller` : les
 * décorateurs de classe s'appliquent de bas en haut, et `@controller` construit
 * les routes — il doit voir le domaine de classe déjà posé.
 *
 * @example
 * \@controller("/")
 * \@Domain("marseille.fr")
 * class MarseilleController extends Controller {
 *   \@Get("/") home() {} // marseille.fr/ → OK ; nodefony.com/ → 403
 * }
 */
function Domain(patterns: string | string[]) {
  const list = Array.isArray(patterns) ? patterns : [patterns];
  // Décorateur DUAL classe+méthode : `target` est soit le constructeur (classe),
  // soit le prototype (méthode), et le retour soit la classe soit le descriptor.
  // `any` est l'idiome TS sanctionné pour un décorateur polymorphe (un type
  // concret casse l'assignabilité au générique `ClassDecorator`). Pas de la dette.
  return function (
    target: any,
    propertyKey?: string,
    descriptor?: PropertyDescriptor,
  ): any {
    if (propertyKey === undefined) {
      // Décorateur de classe → constructeur.
      Reflect.defineMetadata(DOMAIN_CLASS_METADATA, list, target);
      return target;
    }
    // Décorateur de méthode → clé (constructeur, propertyKey).
    Reflect.defineMetadata(
      DOMAIN_METHOD_METADATA,
      list,
      target.constructor,
      propertyKey,
    );
    return descriptor;
  };
}

// ── BypassFirewall decorator (classe + méthode) ─────────────────────────────

/**
 * Déclare une route (décorateur de **méthode**) ou tout un contrôleur
 * (décorateur de **classe**) comme **PUBLIQUE** : le firewall ne s'exécute pas
 * (`Route.bypassFirewall`). Pour la **liveness** (`/health`, `/info` — sondes
 * k8s/monitoring NON authentifiées, ping pré-login), les **webhooks signés**, ou
 * un endpoint d'auth (login). Sucre déclaratif sur l'option
 * `RouteOptions.bypassFirewall` (les deux coexistent ; l'option l'emporte).
 *
 * Précédence : `@Get({ bypassFirewall })` > `@BypassFirewall` méthode > classe.
 * Lu au montage `@controller` (ordre des décorateurs indifférent). **Fail-closed** :
 * un oubli laisse la route GATÉE (401), jamais ouverte par erreur.
 *
 * ⚠️ En décorateur de **classe**, placer `@BypassFirewall` SOUS `@controller`
 * (décorateurs de classe appliqués de bas en haut). Préfigure `@Public`/
 * `@Anonymous` (P6.8b) — sémantique « pas d'auth », qui s'appuiera sur ce primitif.
 *
 * Décorateur SANS argument → **simple, SANS parenthèses** (`@BypassFirewall`,
 * pas `@BypassFirewall()`) : c'est un DRAPEAU, pas une option paramétrée. Une
 * factory (`()`) ne se justifie que pour passer des arguments (cf `@Get("/x")`,
 * `@Domain("host")`).
 *
 * @example
 * \@controller("/nodefony")
 * class StudioController extends Controller {
 *   \@BypassFirewall
 *   \@Get("/studio/api/health") health() {} // public (liveness)
 *   \@Get("/studio/api/stats") stats() {}    // gaté par l'aire data plane
 * }
 */
// Décorateur DUAL classe+méthode, SANS argument (pas une factory). `target` =
// constructeur (classe) ou prototype (méthode). `any` = idiome TS sanctionné
// pour un décorateur polymorphe (cf @Domain).
function BypassFirewall(
  target: any,
  propertyKey?: string,
  descriptor?: PropertyDescriptor,
): any {
  if (propertyKey === undefined) {
    // Classe → toutes les routes du contrôleur publiques.
    Reflect.defineMetadata(BYPASS_FIREWALL_CLASS_METADATA, true, target);
    return target;
  }
  // Méthode → clé (constructeur, propertyKey), lue au montage `@controller`.
  Reflect.defineMetadata(
    BYPASS_FIREWALL_METHOD_METADATA,
    true,
    target.constructor,
    propertyKey,
  );
  return descriptor;
}

// ── Scope decorator (classe) ────────────────────────────────────────────────

/**
 * Déclare le scope d'instanciation d'un controller (V4.3) — pose le statique
 * `scope` de la classe (hérité de `Controller`, défaut `"request"`). Lu par le
 * constructor de `Controller` (`new.target`) et par le `Resolver` : 0 Reflect.
 *
 * `@Scope("singleton")` : UNE instance partagée par toutes les requêtes
 * (cache kernel-scoped sur le Router, `initialize()` appelé 1× à la création).
 * **Contrat stateless strict** : l'action ne lit/n'écrit AUCUN état par requête
 * sur `this` — tout passe par les arguments décorés (`@Param`/`@Body`…) et les
 * helpers, qui retrouvent la requête courante via l'ALS (V4.1). Un champ muté
 * par requête sur un singleton = data race silencieuse entre deux requêtes
 * concurrentes. Le défaut per-request reste inchangé (0 breaking legacy).
 *
 * ⚠️ Homonyme : le core `nodefony` exporte aussi `Scope` (le scope DI du
 * `Container`) — celui-ci s'importe depuis `@nodefony/framework`.
 *
 * @example
 * \@Scope("singleton")
 * \@controller("/api/books")
 * class BookController extends ResourceController { ... }
 */
function Scope(scope: ControllerScope) {
  return function <T extends { scope?: ControllerScope }>(target: T): void {
    target.scope = scope;
  };
}

// ── UseSession decorator (classe + méthode) ─────────────────────────────────

/** Options déclaratives de `@UseSession` (= forme de l'intent runtime). */
export type UseSessionOptions = SessionIntent;

/**
 * Déclare qu'une route (décorateur de **méthode**) ou tout un contrôleur
 * (décorateur de **classe**) a besoin d'une **session serveur**. C'est l'unique
 * façon d'activer une session (avec la reprise auto d'un cookie existant — L1) :
 * il n'y a plus de `sessionAutoStart` global « démarre partout » (le moteur du
 * ×23). Lazy par défaut — aucune session pour une route qui n'en déclare pas.
 *
 * Précédence : `@UseSession` méthode > `@UseSession` classe. La simple présence
 * d'un paramètre `@Session` sur l'action suffit aussi (intent implicite).
 *
 * - `{ readOnly }` : session lue/reprise mais **jamais persistée** (0 write storage).
 * - `{ eager }` : active tôt (seam P6 — régénération d'ID post-authentification).
 *
 * ⚠️ En décorateur de **classe**, placer `@UseSession` SOUS `@controller`.
 *
 * @example
 * \@controller("/account")
 * \@UseSession()
 * class AccountController extends Controller {
 *   \@Get("/me") @UseSession({ readOnly: true }) me() {} // lecture seule → 0 write
 * }
 */
function UseSession(options: UseSessionOptions = {}) {
  // Décorateur DUAL classe+méthode : `any` est l'idiome TS sanctionné pour un
  // décorateur polymorphe (cf @Domain) — un type concret casse l'assignabilité
  // au générique `ClassDecorator`/`MethodDecorator`. Pas de la dette.
  return function (
    target: any,
    propertyKey?: string,
    descriptor?: PropertyDescriptor,
  ): any {
    if (propertyKey === undefined) {
      // Décorateur de classe → constructeur.
      Reflect.defineMetadata(USE_SESSION_CLASS_METADATA, options, target);
      return target;
    }
    // Décorateur de méthode → clé (constructeur, propertyKey).
    Reflect.defineMetadata(
      USE_SESSION_METHOD_METADATA,
      options,
      target.constructor,
      propertyKey,
    );
    return descriptor;
  };
}

/**
 * Résout l'intent de session effectif d'une action — lu par le `Resolver` au
 * match, posé sur `context.sessionIntent`, consommé au point d'activation unique
 * (`HttpKernel.startSession`). Combine `@UseSession` classe + méthode (méthode
 * prioritaire) ; à défaut, un paramètre `@Session` déclare un intent implicite.
 *
 * @returns l'intent, ou `null` si la route ne requiert aucune session.
 */
function resolveSessionIntent(
  ctor: ControllerConstructor,
  actionName: string,
): SessionIntent | null {
  const classMeta = Reflect.getMetadata(USE_SESSION_CLASS_METADATA, ctor) as
    | UseSessionOptions
    | undefined;
  const methodMeta = Reflect.getMetadata(
    USE_SESSION_METHOD_METADATA,
    ctor,
    actionName,
  ) as UseSessionOptions | undefined;
  if (classMeta || methodMeta) {
    // Précédence : @UseSession méthode > @UseSession classe.
    return { ...(classMeta ?? {}), ...(methodMeta ?? {}) };
  }
  // Intent implicite : un paramètre @Session sur l'action déclare le besoin.
  const params = Reflect.getMetadata(
    PARAM_ARGS_METADATA,
    ctor.prototype,
    actionName,
  ) as ParamMeta[] | undefined;
  if (params?.some((p) => p.source === "session")) {
    return {};
  }
  return null;
}

// ── Security decorators (autorisation déclarative, P6 J7) ───────────────────

/**
 * Exige une autorisation pour l'action (décorateur de **méthode**) ou tout le
 * contrôleur (décorateur de **classe**).
 *
 * - `@IsGranted("ROLE_ADMIN")` — un attribut (rôle `ROLE_*`, permission, ou
 *   attribut métier résolu par un voter).
 * - `@IsGranted(["ROLE_ADMIN", "ROLE_AUDITOR"])` — **OR** : un seul suffit.
 * - empiler plusieurs `@IsGranted` — **AND** : toutes les clauses doivent passer.
 * - `@IsGranted("doc.edit", { subject: "id" })` — le paramètre de route `id` est
 *   passé comme `subject` au voter (ownership, multi-tenant).
 *
 * Classe + méthode fusionnent en AND. L'évaluation a lieu dans le `Resolver`
 * AVANT l'instanciation du controller (403 court-circuite — Zero Trust). N'écrit
 * QUE des métadonnées (zéro logique sécu ici → 0 import `@nodefony/security`,
 * 0 cycle ; le moteur `authorization` est appelé par nom au runtime).
 */
function IsGranted(
  attribute: string | readonly string[],
  options?: { subject?: string },
) {
  const clause: SecurityClause = {
    anyOf: Array.isArray(attribute)
      ? [...(attribute as readonly string[])]
      : [attribute as string],
    ...(options?.subject !== undefined
      ? { subjectParam: options.subject }
      : {}),
  };
  // Dual classe+méthode (idiome `any` du module, cf @Domain/@BypassFirewall).
  return function (
    target: any,
    propertyKey?: string,
    descriptor?: PropertyDescriptor,
  ): any {
    if (propertyKey === undefined) {
      // Classe → clauses sur le constructeur (défaut de toutes les actions).
      const existing: SecurityClause[] =
        Reflect.getMetadata(SECURITY_CLAUSES_METADATA, target) || [];
      existing.push(clause);
      Reflect.defineMetadata(SECURITY_CLAUSES_METADATA, existing, target);
      return target;
    }
    // Méthode → clauses sur le prototype, keyées par nom (comme PARAM_ARGS).
    const existing: SecurityClause[] =
      Reflect.getMetadata(SECURITY_CLAUSES_METADATA, target, propertyKey) || [];
    existing.push(clause);
    Reflect.defineMetadata(
      SECURITY_CLAUSES_METADATA,
      existing,
      target,
      propertyKey,
    );
    return descriptor;
  };
}

/**
 * Déclare une action (méthode) ou un contrôleur (classe) **publique** : skip
 * l'autorisation (override un `@IsGranted` de classe sur cette méthode) ET skip
 * l'authentification (réutilise le mécanisme `@BypassFirewall` → pas de 401 en
 * zone protégée). L'alias lisible de « permitAll » (mental model Spring). Pour un
 * login, une sonde de liveness, une page publique d'un contrôleur par ailleurs
 * protégé.
 */
function Anonymous() {
  // Dual classe+méthode (idiome `any` du module).
  return function (
    target: any,
    propertyKey?: string,
    descriptor?: PropertyDescriptor,
  ): any {
    if (propertyKey === undefined) {
      Reflect.defineMetadata(SECURITY_ANONYMOUS_METADATA, true, target);
      Reflect.defineMetadata(BYPASS_FIREWALL_CLASS_METADATA, true, target);
      return target;
    }
    Reflect.defineMetadata(
      SECURITY_ANONYMOUS_METADATA,
      true,
      target.constructor,
      propertyKey,
    );
    Reflect.defineMetadata(
      BYPASS_FIREWALL_METHOD_METADATA,
      true,
      target.constructor,
      propertyKey,
    );
    return descriptor;
  };
}

/**
 * Exige un **scope** (`api:action`) pour l'action (décorateur de **méthode**) ou
 * tout le contrôleur (décorateur de **classe**). Axe d'autorisation **distinct des
 * rôles** (`@IsGranted`) : un scope **downscope** un jeton MACHINE délégué (clé
 * API, JWT d'agent, OAuth) — il est un **no-op** pour une session humaine, dont
 * les droits sont portés par ses rôles (cf {@link ScopeVoter}).
 *
 * - `@RequireScope("orders:read")` — le jeton doit porter ce scope.
 * - `@RequireScope(["orders:read", "orders:admin"])` — **OR** : un seul suffit.
 * - empiler plusieurs `@RequireScope` — **AND** : tous les scopes requis.
 *
 * Convention d'espace **plat** `api:action` (modèle GitHub PAT classic) : le
 * préfixe avant `:` EST l'API → la découverte au boot regroupe les scopes par API
 * sans catalogue séparé. Classe + méthode fusionnent en AND, et fusionnent AUSSI
 * avec les clauses `@IsGranted` dans le même `SecurityRequirement` (rôle ET scope).
 *
 * N'écrit QUE des métadonnées (zéro logique sécu ici → 0 import `@nodefony/security`,
 * 0 cycle) : la décision est rendue par le `ScopeVoter` au runtime (par nom). La
 * metadata est **dédiée** (≠ `@IsGranted`) pour que la découverte au boot puisse
 * lister les scopes déclarés par route sans les confondre avec les rôles.
 */
function RequireScope(scope: string | readonly string[]) {
  const clause: SecurityClause = {
    anyOf: Array.isArray(scope)
      ? [...(scope as readonly string[])]
      : [scope as string],
  };
  // Dual classe+méthode (idiome `any` du module, cf @IsGranted/@Domain).
  return function (
    target: any,
    propertyKey?: string,
    descriptor?: PropertyDescriptor,
  ): any {
    if (propertyKey === undefined) {
      // Classe → scopes sur le constructeur (s'appliquent à toutes les actions).
      const existing: SecurityClause[] =
        Reflect.getMetadata(SECURITY_SCOPES_METADATA, target) || [];
      existing.push(clause);
      Reflect.defineMetadata(SECURITY_SCOPES_METADATA, existing, target);
      return target;
    }
    // Méthode → scopes sur le prototype, keyés par nom (comme SECURITY_CLAUSES).
    const existing: SecurityClause[] =
      Reflect.getMetadata(SECURITY_SCOPES_METADATA, target, propertyKey) || [];
    existing.push(clause);
    Reflect.defineMetadata(
      SECURITY_SCOPES_METADATA,
      existing,
      target,
      propertyKey,
    );
    return descriptor;
  };
}

/**
 * Fusion ADDITIVE de deux jeux de directives CSP : les sources d'une même
 * directive sont concaténées (dédupliquées, ordre `a` puis `b`). Pure, sans
 * mutation des entrées. Sert au stacking de `@Csp` et à la fusion classe+méthode.
 */
function mergeCspDirectives(
  a?: CspDirectives,
  b?: CspDirectives,
): CspDirectives {
  const out: Record<string, string[]> = {};
  for (const src of [a, b]) {
    if (!src) continue;
    for (const name in src) {
      const list = (out[name] ??= []);
      for (const v of src[name]) if (!list.includes(v)) list.push(v);
    }
  }
  return out;
}

/**
 * `@Csp({ "frame-src": [...] })` — déclare des directives CSP **additionnelles**
 * pour l'action (méthode) ou tout le contrôleur (classe). Distinct de
 * `registerCspOrigins` (besoins PERMANENTS d'un module, ex. Vite) : ici c'est le
 * besoin ponctuel d'UNE réponse (embarquer une iframe YouTube, autoriser une CDN).
 *
 * Classe + méthode fusionnent additivement (sources concaténées par directive).
 * Empiler plusieurs `@Csp` fusionne aussi. N'écrit QUE des métadonnées : le merge
 * dans le CSP de la réponse est fait par le firewall, hors hot-path, UNIQUEMENT
 * sur les routes décorées. Calque `@IsGranted` (0 import `@nodefony/security`).
 */
function Csp(directives: CspDirectives) {
  // Dual classe+méthode (idiome `any` du module, cf @IsGranted/@Domain).
  return function (
    target: any,
    propertyKey?: string,
    descriptor?: PropertyDescriptor,
  ): any {
    if (propertyKey === undefined) {
      const existing = Reflect.getMetadata(CSP_DIRECTIVES_METADATA, target) as
        | CspDirectives
        | undefined;
      Reflect.defineMetadata(
        CSP_DIRECTIVES_METADATA,
        mergeCspDirectives(existing, directives),
        target,
      );
      return target;
    }
    const existing = Reflect.getMetadata(
      CSP_DIRECTIVES_METADATA,
      target,
      propertyKey,
    ) as CspDirectives | undefined;
    Reflect.defineMetadata(
      CSP_DIRECTIVES_METADATA,
      mergeCspDirectives(existing, directives),
      target,
      propertyKey,
    );
    return descriptor;
  };
}

/**
 * Fabrique d'un marqueur booléen dual classe+méthode (idiome `any` du module).
 * Pose `true` sur le ctor (classe) ou le prototype keyé par nom (méthode).
 */
function booleanMarkerDecorator(metadataKey: string) {
  return function () {
    return function (
      target: any,
      propertyKey?: string,
      descriptor?: PropertyDescriptor,
    ): any {
      if (propertyKey === undefined) {
        Reflect.defineMetadata(metadataKey, true, target);
        return target;
      }
      Reflect.defineMetadata(metadataKey, true, target, propertyKey);
      return descriptor;
    };
  };
}

/**
 * `@CsrfProtect()` — opt-IN à la défense CSRF **synchronizer token** (double-submit
 * signé HMAC) EN PLUS de la défense globale Fetch Metadata/Origin (étape 1, toujours
 * active). Pour les mutations à haute valeur (changement de mot de passe, virement) :
 * une requête sûre vers la route SÈME le cookie lisible `csrf-token` ; la mutation
 * DOIT rejouer ce token dans l'en-tête `x-csrf-token` (sinon 403). Classe = toutes
 * les actions. N'écrit qu'un marqueur (0 import `@nodefony/security`, 0 cycle).
 */
const CsrfProtect = booleanMarkerDecorator(CSRF_PROTECT_METADATA);

/**
 * `@CsrfExempt()` — opt-OUT de la défense CSRF pour une route, **en conservant
 * l'authentification et l'autorisation** (≠ `@Anonymous`/`@BypassFirewall` qui
 * coupent l'auth). Pour un webhook ou une API recevant un POST cross-origin
 * légitime, dont la requête est authentifiée autrement (signature HMAC du provider,
 * clé API). Classe = toutes les actions. Marqueur seul (0 logique sécu ici).
 */
const CsrfExempt = booleanMarkerDecorator(CSRF_EXEMPT_METADATA);

// ── Parameter decorators ────────────────────────────────────────────────────
function paramDecoratorFactory(source: ParamSource) {
  return function (key?: string) {
    return function (
      target: object,
      propertyKey: string,
      parameterIndex: number,
    ): void {
      const existing: ParamMeta[] =
        Reflect.getMetadata(PARAM_ARGS_METADATA, target, propertyKey) || [];
      existing.push({ source, key, index: parameterIndex });
      Reflect.defineMetadata(
        PARAM_ARGS_METADATA,
        existing,
        target,
        propertyKey,
      );
    };
  };
}

const Param = paramDecoratorFactory("param");
const Query = paramDecoratorFactory("query");

/**
 * Décorateur de paramètre `@Body` :
 * - `@Body()` → body parsé entier · `@Body("field")` → un champ du body parsé.
 * - `@Body({ stream: true })` → **flux brut** de la requête (`Readable`), sans
 *   parse en mémoire (P2.9 — gros uploads sans pic RAM ; le pipeline saute le
 *   parse busboy/JSON pour cette route).
 */
function Body(keyOrOptions?: string | { stream?: boolean }) {
  const isOptions = typeof keyOrOptions === "object" && keyOrOptions !== null;
  const key = isOptions ? undefined : (keyOrOptions as string | undefined);
  const stream = isOptions
    ? (keyOrOptions as { stream?: boolean }).stream === true
    : false;
  return function (
    target: object,
    propertyKey: string,
    parameterIndex: number,
  ): void {
    const existing: ParamMeta[] =
      Reflect.getMetadata(PARAM_ARGS_METADATA, target, propertyKey) || [];
    // `stream` n'est posé QUE s'il vaut true → `@Body()`/`@Body("k")` gardent
    // exactement la forme historique `{source,key,index}` (rétro-compat tests).
    const meta: ParamMeta = { source: "body", key, index: parameterIndex };
    if (stream) {
      meta.stream = true;
    }
    existing.push(meta);
    Reflect.defineMetadata(PARAM_ARGS_METADATA, existing, target, propertyKey);
  };
}
const Headers = paramDecoratorFactory("headers");
const Cookie = paramDecoratorFactory("cookie");
const Session = paramDecoratorFactory("session");
/** `@CurrentUser() user: IUser` — injecte l'utilisateur de l'ALS (jamais le credential). */
const CurrentUser = paramDecoratorFactory("user");
const Req = paramDecoratorFactory("req");
const Res = paramDecoratorFactory("res");
const UploadedFile = paramDecoratorFactory("file");
const UploadedFiles = paramDecoratorFactory("files");

// ── Parameter resolution (pure — testable unit hors pipeline HTTP) ───────────
/**
 * Contexte structurel minimal nécessaire pour résoudre les arguments injectés
 * par les décorateurs de paramètre. Volontairement découplé de `HttpContext`
 * (typage par forme) → la résolution est une fonction pure, testable en unit
 * avec un faux contexte, sans démarrer de serveur. Le `Resolver` lui passe le
 * vrai `Context`, qui satisfait cette forme.
 */
export interface IParamArgContext {
  /** Variables de route extraites du path (`{name}` → valeur). */
  paramsMap: Record<string, unknown>;
  /**
   * Query de l'invocation courante quand elle ne vient PAS de l'URL du
   * transport — pont WS-RPC `api.request` (`Resolver.queryOverride`). Prime
   * sur `request.queryGet` pour `@Query` uniquement (`@Req` reste le brut).
   */
  queryOverride?: Record<string, unknown>;
  request?: {
    queryGet?: Record<string, unknown>;
    queryPost?: Record<string, unknown>;
    queryFile?: unknown[];
    headers?: Record<string, unknown>;
    /**
     * P2.9 — `IncomingMessage` brut (un `Readable`) sous-jacent au wrapper
     * `HttpRequest`. Injecté tel quel par `@Body({ stream: true })` (le pipeline
     * n'a pas consommé/parsé ce flux). `undefined` pour les contextes WS.
     */
    request?: NodeJS.ReadableStream;
  } | null;
  response?: unknown;
  session?: { get(key: string): unknown } | null;
  getRequestCookies(name?: string): unknown;
}

/**
 * Résout la valeur d'un unique paramètre décoré depuis le contexte de requête.
 *
 * @param meta - métadonnée posée par le décorateur (source + clé optionnelle)
 * @param ctx - contexte de requête (forme structurelle minimale)
 * @returns la valeur à injecter dans l'argument `meta.index` de l'action
 */
function resolveParamArg(meta: ParamMeta, ctx: IParamArgContext): unknown {
  switch (meta.source) {
    case "param":
      return meta.key !== undefined ? ctx.paramsMap[meta.key] : ctx.paramsMap;
    case "query": {
      const qg = ctx.queryOverride ?? ctx.request?.queryGet;
      return meta.key !== undefined ? qg?.[meta.key] : qg;
    }
    case "body": {
      // P2.9 — `@Body({ stream:true })` → flux brut (Readable), jamais parsé.
      // Le pipeline a sauté le parse pour cette route ; le controller pipe le
      // flux lui-même (gros upload sans pic mémoire).
      if (meta.stream) {
        return ctx.request?.request;
      }
      const qp = ctx.request?.queryPost;
      return meta.key !== undefined ? qp?.[meta.key] : qp;
    }
    case "headers": {
      // Node lowercase les clés de IncomingHttpHeaders → normaliser la lookup.
      const h = ctx.request?.headers;
      return meta.key !== undefined ? h?.[meta.key.toLowerCase()] : h;
    }
    case "cookie":
      return ctx.getRequestCookies(meta.key);
    case "session":
      return meta.key !== undefined ? ctx.session?.get(meta.key) : ctx.session;
    case "req":
      return ctx.request;
    case "res":
      return ctx.response;
    case "file":
      return ctx.request?.queryFile?.[0];
    case "files":
      return ctx.request?.queryFile;
    case "user":
      // @CurrentUser — utilisateur posé par le firewall dans l'ALS (jamais le
      // credential). O(1), 0 alloc. `undefined` si aucune zone n'a authentifié.
      return RequestContext.getUser();
    default:
      return undefined;
  }
}

/**
 * Construit le tableau d'arguments d'une action à partir des métadonnées de
 * paramètres décorés. Chaque valeur est placée à son `index` déclaré (les trous
 * restent `undefined`). Fonction pure — aucun effet de bord, aucune I/O.
 *
 * @param metas - métadonnées de tous les paramètres décorés de l'action
 * @param ctx - contexte de requête (forme structurelle minimale)
 * @returns arguments positionnels à spread dans l'action
 */
function buildParamArgs(metas: ParamMeta[], ctx: IParamArgContext): unknown[] {
  const result: unknown[] = [];
  for (const meta of metas) {
    result[meta.index] = resolveParamArg(meta, ctx);
  }
  return result;
}

/**
 * P2.9 — Indique si l'action d'une route attend le **flux brut** du body
 * (un paramètre `@Body({ stream:true })`). Le résultat est **mémoïsé** sur
 * `route.bodyStream` : lecture `Reflect` au 1er appel, O(1) ensuite → 0 coût
 * hot-path. Lu **en amont** par `handleHttp` (avant le parse) pour décider de
 * sauter le parse busboy/JSON. Typage structurel (pas d'import `Route` → 0 cycle).
 *
 * @param route - route résolue (porte `controller` + `classMethod` à `onBoot`).
 * @returns `true` si l'action déclare un `@Body({ stream:true })`.
 */
function routeExpectsBodyStream(route: {
  controller?: { prototype: object } | null;
  classMethod?: string;
  bodyStream?: boolean;
}): boolean {
  if (route.bodyStream === undefined) {
    let flag = false;
    const ctor = route.controller;
    const method = route.classMethod;
    if (ctor && method) {
      const metas: ParamMeta[] =
        Reflect.getMetadata(PARAM_ARGS_METADATA, ctor.prototype, method) || [];
      flag = metas.some((m) => m.source === "body" && m.stream === true);
    }
    route.bodyStream = flag;
  }
  return route.bodyStream;
}

// ── P5 — Metadata d'action FIGÉES par route (memo, hot path 0 Reflect) ──────

/**
 * Snapshot des métadonnées d'action d'une route (`@HttpCode`/`@Header`/
 * `@Redirect`/paramètres décorés/intent de session), résolu UNE fois par route
 * puis figé sur `route.actionMeta` (cf {@link resolveActionMeta}). Objet
 * **PARTAGÉ entre toutes les requêtes** de la route — ne jamais muter.
 */
export interface RouteActionMeta {
  /** Paramètres décorés (`@Param`/`@Body`/`@Query`…) — `null` si aucun. */
  paramsMeta: ParamMeta[] | null;
  /** `@Redirect` de l'action — `null` si absent. */
  redirectMeta: RedirectMeta | null;
  /** `@HttpCode` de l'action — `null` si absent. */
  httpCode: number | null;
  /** Entrées `@Header` pré-dépliées (`Object.entries` fait 1×) — `null` si aucune. */
  headerEntries: [string, string][] | null;
  /** Intent `@UseSession`/`@Session` — `null` si la route n'en déclare pas. */
  sessionIntent: SessionIntent | null;
  /**
   * Exigence d'autorisation (`@IsGranted`, fusion classe+méthode) — `null` si
   * l'action n'est pas gardée (ou `@Anonymous`). `null` = **0 coût** sur le hot
   * path (ni résolution de service, ni `decide`, ni await). Frozen, partagé.
   */
  security: SecurityRequirement | null;
  /**
   * Directives CSP additionnelles (`@Csp`, fusion classe+méthode) — `null` si
   * l'action n'en déclare pas (cas courant → 0 composition CSP). Frozen, partagé.
   */
  cspDirectives: CspDirectives | null;
  /** `@CsrfProtect` (classe ou méthode) → exige le synchronizer token sur la mutation. */
  csrfProtect: boolean;
  /** `@CsrfExempt` (classe ou méthode) → la route est hors défense CSRF (auth conservée). */
  csrfExempt: boolean;
}

const EMPTY_ACTION_META: RouteActionMeta = {
  paramsMeta: null,
  redirectMeta: null,
  httpCode: null,
  headerEntries: null,
  sessionIntent: null,
  security: null,
  cspDirectives: null,
  csrfProtect: false,
  csrfExempt: false,
};

/**
 * P5 — Calcule le {@link RouteActionMeta} d'un couple (controller, action) par
 * lecture `Reflect`. Fonction PURE (pas de memo) : utilisée par
 * {@link resolveActionMeta} (routes, mémoïsé) et par le `Resolver` pour le
 * chemin froid du forward (`parsePathernController`, pas de route).
 */
/** Lit un tableau de clauses (`@IsGranted`/`@RequireScope`) posé sur une cible Reflect — `[]` si absent. */
function readClauses(target: object, propertyKey?: string): SecurityClause[] {
  const meta = (
    propertyKey === undefined
      ? Reflect.getMetadata(SECURITY_CLAUSES_METADATA, target)
      : Reflect.getMetadata(SECURITY_CLAUSES_METADATA, target, propertyKey)
  ) as SecurityClause[] | undefined;
  return meta ?? [];
}

/** Idem pour les clauses de scope (`@RequireScope`, metadata dédiée) — `[]` si absent. */
function readScopeClauses(
  target: object,
  propertyKey?: string,
): SecurityClause[] {
  const meta = (
    propertyKey === undefined
      ? Reflect.getMetadata(SECURITY_SCOPES_METADATA, target)
      : Reflect.getMetadata(SECURITY_SCOPES_METADATA, target, propertyKey)
  ) as SecurityClause[] | undefined;
  return meta ?? [];
}

/**
 * P6 J7 / P6.8 — Fusionne les clauses `@IsGranted` (rôles) ET `@RequireScope`
 * (scopes) — classe + méthode — en une exigence d'autorisation **figée**, ou
 * `null` si l'action n'est pas gardée. Les deux axes cohabitent dans le même
 * `SecurityRequirement` (clauses en **AND**) → un seul chemin d'enforcement dans
 * le `Resolver`, le bon voter (`RoleVoter`/`ScopeVoter`) répond par attribut.
 * `@Anonymous` (méthode) rend l'action publique (override `@IsGranted`/
 * `@RequireScope` de classe → `null`). Lecture `Reflect` faite UNE fois (via
 * {@link resolveActionMeta} mémoïsé).
 */
function computeSecurityRequirement(
  ctor: { prototype: object },
  method: string,
): SecurityRequirement | null {
  // @Anonymous méthode → action publique, même sous un @IsGranted/@RequireScope de classe.
  if (Reflect.getMetadata(SECURITY_ANONYMOUS_METADATA, ctor, method) === true) {
    return null;
  }
  const proto = ctor.prototype;
  const methodClauses = readClauses(proto, method);
  const methodScopes = readScopeClauses(proto, method);
  // @Anonymous sur la classe → pas de garde héritée ; sinon AND avec la classe.
  const classAnon =
    Reflect.getMetadata(SECURITY_ANONYMOUS_METADATA, ctor) === true;
  const classClauses = classAnon ? [] : readClauses(ctor);
  const classScopes = classAnon ? [] : readScopeClauses(ctor);
  // Rôles puis scopes (l'ordre est indifférent — toutes les clauses sont en AND).
  const all = [
    ...classClauses,
    ...methodClauses,
    ...classScopes,
    ...methodScopes,
  ];
  if (all.length === 0) {
    return null; // aucune garde → 0 coût hot path
  }
  // Figé (objet PARTAGÉ entre requêtes — jamais muté).
  return Object.freeze({
    clauses: Object.freeze(all) as readonly SecurityClause[],
  });
}

/**
 * P6 — Fusionne les directives `@Csp` (classe + méthode) en un jeu figé, ou
 * `null` si l'action n'en déclare aucune (cas courant → 0 alloc/composition).
 * Lecture `Reflect` faite UNE fois (via {@link resolveActionMeta} mémoïsé).
 */
function computeCspDirectives(
  ctor: { prototype: object },
  method: string,
): CspDirectives | null {
  const methodDirectives = Reflect.getMetadata(
    CSP_DIRECTIVES_METADATA,
    ctor.prototype,
    method,
  ) as CspDirectives | undefined;
  const classDirectives = Reflect.getMetadata(CSP_DIRECTIVES_METADATA, ctor) as
    | CspDirectives
    | undefined;
  if (!classDirectives && !methodDirectives) {
    return null; // aucune @Csp → 0 coût
  }
  return Object.freeze(mergeCspDirectives(classDirectives, methodDirectives));
}

function computeActionMeta(
  ctor?: { prototype: object } | null,
  method?: string,
): RouteActionMeta {
  if (!ctor || !method) {
    return EMPTY_ACTION_META;
  }
  const proto = ctor.prototype;
  const params = Reflect.getMetadata(PARAM_ARGS_METADATA, proto, method) as
    | ParamMeta[]
    | undefined;
  const redirect = Reflect.getMetadata(REDIRECT_METADATA, proto, method) as
    | RedirectMeta
    | undefined;
  const httpCode = Reflect.getMetadata(HTTP_CODE_METADATA, proto, method) as
    | number
    | undefined;
  const headers = Reflect.getMetadata(HEADERS_METADATA, proto, method) as
    | Record<string, string>
    | undefined;
  return {
    paramsMeta: params && params.length > 0 ? params : null,
    redirectMeta: redirect ?? null,
    httpCode: httpCode ?? null,
    headerEntries: headers ? Object.entries(headers) : null,
    sessionIntent: resolveSessionIntent(ctor as ControllerConstructor, method),
    security: computeSecurityRequirement(ctor, method),
    cspDirectives: computeCspDirectives(ctor, method),
    // CSRF : marqueur méthode OU classe (true dès qu'un des deux le pose).
    csrfProtect:
      Reflect.getMetadata(CSRF_PROTECT_METADATA, proto, method) === true ||
      Reflect.getMetadata(CSRF_PROTECT_METADATA, ctor) === true,
    csrfExempt:
      Reflect.getMetadata(CSRF_EXEMPT_METADATA, proto, method) === true ||
      Reflect.getMetadata(CSRF_EXEMPT_METADATA, ctor) === true,
  };
}

/**
 * P5 — Metadata d'action d'une route, **mémoïsées au 1er hit** sur
 * `route.actionMeta` (pattern frère de {@link routeExpectsBodyStream}) :
 * `undefined` = pas encore résolu → 1 lecture `Reflect` par route pour la vie
 * du process, O(1) ensuite. Sort `Reflect.getMetadata` (~6 appels/req) du hot
 * path `match`/`executeAction`. Posé APRÈS `generateId()` (1ʳᵉ requête) → le
 * hash de route et l'introspection Studio restent stables. Typage structurel
 * (pas d'import `Route` → 0 cycle).
 */
function resolveActionMeta(route: {
  controller?: { prototype: object } | null;
  classMethod?: string;
  actionMeta?: RouteActionMeta;
}): RouteActionMeta {
  if (route.actionMeta === undefined) {
    route.actionMeta = computeActionMeta(route.controller, route.classMethod);
  }
  return route.actionMeta;
}

export {
  route,
  controller,
  controllers,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Options,
  Head,
  All,
  Domain,
  BypassFirewall,
  IsGranted,
  RequireScope,
  Anonymous,
  Csp,
  CsrfProtect,
  CsrfExempt,
  CurrentUser,
  Scope,
  UseSession,
  resolveSessionIntent,
  HttpCode,
  Header,
  Redirect,
  Param,
  Body,
  Query,
  Headers,
  Cookie,
  Session,
  Req,
  Res,
  UploadedFile,
  UploadedFiles,
  resolveParamArg,
  buildParamArgs,
  routeExpectsBodyStream,
  computeActionMeta,
  resolveActionMeta,
};
