import "reflect-metadata";
//import { fileURLToPath } from "url";
import Router, { TypeController } from "../service/router";
import { RouteOptions } from "../src/Route";
import Controller from "../src/Controller";
//import { dirname, join, resolve, relative } from "node:path";
import { Module } from "nodefony";
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
  | "files";
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
 * - `{ context }` : aire de session (firewall/route) ; défaut `"default"`.
 * - `{ readOnly }` : session lue/reprise mais **jamais persistée** (0 write storage).
 * - `{ eager }` : active tôt (seam P6 — régénération d'ID post-authentification).
 *
 * ⚠️ En décorateur de **classe**, placer `@UseSession` SOUS `@controller`.
 *
 * @example
 * \@controller("/account")
 * \@UseSession({ context: "account" })
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
      const qg = ctx.request?.queryGet;
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
};
