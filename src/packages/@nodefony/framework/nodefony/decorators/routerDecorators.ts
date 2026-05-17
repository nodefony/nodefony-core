import "reflect-metadata";
//import { fileURLToPath } from "url";
import Router, { TypeController } from "../service/router";
import { RouteOptions } from "../src/Route";
import Controller from "../src/Controller";
//import { dirname, join, resolve, relative } from "node:path";
import { Module } from "nodefony";
import { ControllerConstructor } from "../src/Route";
import type { HTTPMethod } from "@nodefony/http";

type Constructor<T = {}> = new (...args: any[]) => T;

const metadataKey = "routes:definitions";

function controllers(
  controller: TypeController<Controller>[] | TypeController<Controller>
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
 *  class OpenApiController extends Controller {
 *    constructor(context: Context) {
 *       super("OpenApiController", context);
 *    }
 *    async initialize(): Promise<this> {
 *      await this.startSession();
 *      return this;
 *    }
 *    \@route("index-openapi", { path: "" })
 *     index() {
 *      this.render({});
 *    }
 *  }
 */
function controller(prefix: string /*, settings: Record<string, any> = {}*/) {
  return function (mycontroller: any) {
    //const constructor = mycontroller.constructor;
    //const className = mycontroller.name;
    mycontroller.prefix = prefix;
    const metadata = Reflect.getMetadata(metadataKey, mycontroller) || {};
    if (metadata && Object.keys(metadata).length !== 0) {
      let hasMagic: boolean | any = false;
      for (const name in metadata) {
        const options = metadata[name];
        options.prefix = prefix;
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
 * method() {
 *   console.log("call method");
 * }
 */
function route(name: string, options: RouteOptions) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
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
          "Fichier de contrôleur non trouvé dans la pile d'appels."
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

export type ParamSource = "param" | "body" | "query";
export interface ParamMeta {
  source: ParamSource;
  key?: string;
  index: number;
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
      descriptor: PropertyDescriptor
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

// ── Response decorators ─────────────────────────────────────────────────────
function HttpCode(statusCode: number) {
  return function (
    target: object,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    Reflect.defineMetadata(HTTP_CODE_METADATA, statusCode, target, propertyKey);
    return descriptor;
  };
}

function Header(key: string, value: string) {
  return function (
    target: object,
    propertyKey: string,
    descriptor: PropertyDescriptor
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
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    const meta: RedirectMeta = { url, statusCode };
    Reflect.defineMetadata(REDIRECT_METADATA, meta, target, propertyKey);
    return descriptor;
  };
}

// ── Parameter decorators ────────────────────────────────────────────────────
function paramDecoratorFactory(source: ParamSource) {
  return function (key?: string) {
    return function (
      target: object,
      propertyKey: string,
      parameterIndex: number
    ): void {
      const existing: ParamMeta[] =
        Reflect.getMetadata(PARAM_ARGS_METADATA, target, propertyKey) || [];
      existing.push({ source, key, index: parameterIndex });
      Reflect.defineMetadata(
        PARAM_ARGS_METADATA,
        existing,
        target,
        propertyKey
      );
    };
  };
}

const Param = paramDecoratorFactory("param");
const Body = paramDecoratorFactory("body");
const Query = paramDecoratorFactory("query");

export {
  route,
  controller,
  controllers,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  HttpCode,
  Header,
  Redirect,
  Param,
  Body,
  Query,
};
