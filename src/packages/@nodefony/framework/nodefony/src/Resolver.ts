import {
  Container,
  Service,
  Event,
  typeOf,
  isPromise,
  isPlainObject,
  isArray,
  Injector,
  Module,
  //inject,
} from "nodefony";
import type { IResolver } from "../interfaces/index.js";
//import Router from "../service/router";
import {
  //Context,
  HttpError,
  ContextType,
  HttpContext,
  Http2Response,
  HttpResponse,
  WebsocketResponse,
  WebsocketContext,
} from "@nodefony/http";
import Route, { ControllerConstructor } from "./Route.js";
import BlueBird from "bluebird";
import Controller from "./Controller";
import {
  HTTP_CODE_METADATA,
  HEADERS_METADATA,
  REDIRECT_METADATA,
  PARAM_ARGS_METADATA,
  type RedirectMeta,
  type ParamMeta,
} from "../decorators/routerDecorators.js";

//import { ServiceWithInitialize } from "nodefony";
//import { ServiceConstructor } from "nodefony";

export interface ControllerWithInitialize {
  initialize(controler: Controller): Promise<Controller>;
}

class Resolver extends Service implements IResolver {
  injector?: Injector | null;
  controller: ControllerConstructor | null = null;
  actionName?: string;
  action?: (...args: unknown[]) => unknown;
  context: ContextType;
  route: Route | null = null;
  resolve: boolean = false;
  variables: any[] = [];
  exception?: HttpError | Error | null;
  acceptedProtocol: string | null = null;
  bypassFirewall: boolean = false;
  constructor(context: ContextType) {
    super(
      "RESOLVER",
      context.container as Container,
      context.notificationsCenter as Event,
    );
    this.context = context;
    this.injector = this.get<Injector>("injector");
  }

  match(route: Route, context: ContextType) {
    try {
      const match = route.match(context);
      if (match) {
        this.variables = match;
        this.route = route;
        this.controller = route.controller as ControllerConstructor;
        this.actionName = route.classMethod;
        this.resolve = true;
        this.bypassFirewall = this.route.bypassFirewall;
        if (route.requirements.protocol) {
          this.acceptedProtocol = route.requirements.protocol.toLowerCase();
        }
      }
      return match;
    } catch (e) {
      throw e;
    }
  }

  parsePathernController(name: string) {
    let module: Module | undefined;
    let tab: string[] = [];
    if (typeof name !== "string") {
      throw new Error(`Invalid name parameter: expected a string`);
    }
    tab = name.split(":");
    if (tab.length !== 3) {
      throw new Error(
        `Invalid name format: expected "module:controller:action"`,
      );
    }
    module = this.kernel?.getModule(tab[0]) as Module | undefined;
    if (!module) {
      throw new Error(`Module not found: ${tab[0]}`);
    }
    if (module.name !== "framework") {
      this.set("module", module);
    }
    this.controller = module.getController(tab[1]);
    if (!this.controller) {
      throw new Error(`Controller not found in module: ${tab[1]}`);
    }
    this.action = this.getAction(tab[2]) as (...args: unknown[]) => unknown;
    if (!this.action) {
      throw new Error(`Action not found in controller ${tab[1]}: ${tab[2]}`);
    }
    this.actionName = tab[2];
    this.resolve = true;
  }

  getAction(name: string): ((...args: unknown[]) => unknown) | null {
    if (!this.controller) {
      throw new Error(`Controller not set`);
    }
    const methodNames = Object.getOwnPropertyNames(this.controller.prototype);
    for (const methodName of methodNames) {
      if (
        typeof this.controller.prototype[methodName] === "function" &&
        methodName === name
      ) {
        return this.controller.prototype[methodName];
      }
    }
    return null;
  }

  async newController(context?: ContextType): Promise<Controller> {
    if (this.controller) {
      const controller = this.injector?.instantiate<Controller>(
        this.controller,
        context || this.context,
      );
      if (controller) {
        this.set("controller", controller);
        if (
          "initialize" in controller &&
          typeof controller.initialize === "function"
        ) {
          await controller.initialize();
          return controller as Controller;
        }
        return controller as Controller;
      }
    }
    throw new Error(`Route Controller not found`);
  }

  async callController(data?: any[], reload: boolean = false) {
    let controller = this.get("controller") as Controller;
    if (!controller || reload) {
      controller = await this.newController();
    }
    if (this.controller?.prototype.module) {
      controller.module = this.controller?.prototype.module;
    }
    this.set("action", this.action);
    this.set("route", this.route);
    controller.setRoute(this.route!);
    const methodKey = this.actionName as keyof typeof controller;
    let args: any[];
    if (data) {
      args = [...this.variables, ...data];
    } else {
      args = [...this.variables];
    }
    const proto = Object.getPrototypeOf(controller);
    const paramsMeta: ParamMeta[] | undefined = Reflect.getMetadata(
      PARAM_ARGS_METADATA,
      proto,
      this.actionName!,
    );
    if (paramsMeta && paramsMeta.length > 0) {
      args = this._buildParamArgs(paramsMeta);
    }
    this._applyResponseDecorators(controller, proto);
    const redirectMeta: RedirectMeta | undefined = Reflect.getMetadata(
      REDIRECT_METADATA,
      proto,
      this.actionName!,
    );
    // Pas de try/catch re-throw (no-op) : les erreurs de l'action remontent
    // seules jusqu'à HttpKernel.onError. Pas de `await` avant return (microtask
    // en moins) — le rejet se propage via la promesse retournée.
    if (typeof controller[methodKey] === "function") {
      const actionResult = (
        controller[methodKey] as (...a: unknown[]) => unknown
      )(...args);
      return this._handleRedirect(actionResult, redirectMeta);
    }
    if (this.action) {
      const actionResult = this.action(...args);
      return this._handleRedirect(actionResult, redirectMeta);
    }
    throw new Error(`Route Action not found`);
  }

  private _buildParamArgs(metas: ParamMeta[]): unknown[] {
    const result: unknown[] = [];
    const httpCtx = this.context as HttpContext;
    const varNames: string[] = this.route?.variables ?? [];
    const paramsMap: Record<string, unknown> = {};
    for (let i = 0; i < varNames.length; i++) {
      paramsMap[varNames[i]] = this.variables[i];
    }
    for (const meta of metas) {
      let val: unknown;
      if (meta.source === "param") {
        val = meta.key !== undefined ? paramsMap[meta.key] : paramsMap;
      } else if (meta.source === "query") {
        const qg = httpCtx?.request?.queryGet;
        val = meta.key !== undefined ? qg?.[meta.key] : qg;
      } else {
        const qp = httpCtx?.request?.queryPost;
        val = meta.key !== undefined ? qp?.[meta.key] : qp;
      }
      result[meta.index] = val;
    }
    return result;
  }

  private _applyResponseDecorators(
    controller: Controller,
    proto: object,
  ): void {
    const httpCode: number | undefined = Reflect.getMetadata(
      HTTP_CODE_METADATA,
      proto,
      this.actionName!,
    );
    if (httpCode !== undefined) {
      controller.response?.setStatusCode(httpCode);
    }
    const headers: Record<string, string> | undefined = Reflect.getMetadata(
      HEADERS_METADATA,
      proto,
      this.actionName!,
    );
    if (headers) {
      for (const [key, value] of Object.entries(headers)) {
        (controller.response as HttpResponse | Http2Response | null)?.setHeader(
          key,
          value,
        );
      }
    }
  }

  private async _handleRedirect(
    actionResult: unknown,
    redirectMeta: RedirectMeta | undefined,
  ): Promise<unknown> {
    if (!redirectMeta) {
      return this.returnController(actionResult);
    }
    const resolved = await Promise.resolve(actionResult);
    if (
      resolved !== null &&
      resolved !== undefined &&
      typeof resolved === "object" &&
      "url" in resolved
    ) {
      const override = resolved as { url: string; statusCode?: number };
      (this.context as HttpContext).redirect(
        override.url,
        override.statusCode ?? redirectMeta.statusCode,
      );
      return this.returnController(undefined);
    }
    if (resolved === undefined || resolved === null) {
      (this.context as HttpContext).redirect(
        redirectMeta.url,
        redirectMeta.statusCode,
      );
      return this.returnController(undefined);
    }
    return this.returnController(resolved);
  }

  async returnController(result: any) {
    const type = typeOf(result);
    switch (true) {
      case result instanceof Promise:
      case result instanceof BlueBird:
      case isPromise(result):
        // Unwrap puis re-dispatch. Pas de `.catch(e => throw e)` (no-op qui
        // ajoute une microtask par requête) — le rejet se propage seul.
        return result.then((myresult: unknown) =>
          this.returnController(myresult),
        );
      case type === "string":
      case result instanceof String:
        return (this.context as HttpContext | WebsocketContext).send(result);
      case result instanceof Http2Response:
      case result instanceof HttpResponse:
      case result instanceof WebsocketResponse:
        return result;
      //return (this.context as HttpContext).send().catch((e: Error) => {
      //  throw e;
      //});
      case type === "array":
      case type === "object": {
        // Réponse déjà envoyée (ex: ReadStream piped par streamFile, send
        // manuel) → ne rien refaire. (`sended` n'existe que sur HttpContext ;
        // undefined pour le WS → on poursuit, le WS peut répondre par message.)
        if ((this.context as HttpContext).sended) {
          return;
        }
        // Objet/array sérialisable → auto-JSON. Contrat moderne, symétrique avec
        // le `case string`, et VALABLE POUR LE REALTIME WS (un handler qui
        // `return { type: "pong" }` envoie désormais au lieu d'être droppé).
        // `render()` sérialise via `isJson` (posé par `setContextJson`).
        // Buffer / ReadStream / instances de classe → NON sérialisés (laissés
        // tels quels : déjà envoyés/gérés ailleurs), jamais `JSON.stringify`.
        if (isPlainObject(result) || isArray(result)) {
          this.context.setContextJson();
          return (this.context as HttpContext | WebsocketContext).render(
            result,
          );
        }
        return;
      }
      default:
        switch (this.context.type) {
          case "http":
          case "http2":
          case "http3":
          case "https":
            if ((this.context as HttpContext).sended) {
              return;
            }
            if ((this.context as HttpContext).isRedirect) {
              return (this.context as HttpContext).send();
            }
            this.context.waitAsync = true;
            break;
        }
    }
  }
}

export default Resolver;
