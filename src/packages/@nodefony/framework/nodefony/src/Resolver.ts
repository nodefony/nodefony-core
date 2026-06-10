import {
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
  buildParamArgs,
  resolveSessionIntent,
  resolveActionMeta,
  computeActionMeta,
  type RouteActionMeta,
  type RedirectMeta,
  type ParamMeta,
  type IParamArgContext,
} from "../decorators/routerDecorators.js";

//import { ServiceWithInit } from "nodefony";
//import { ServiceConstructor } from "nodefony";

/**
 * Interface-marqueur du hook **per-request** d'un {@link Controller} : `initialize`
 * est appelé par le {@link Resolver} à CHAQUE requête, avant l'action (hot path —
 * jamais gardé/borné, contrairement au boot des services). Distinct du hook de boot
 * `ServiceWithInit` (singleton, 1× au démarrage).
 *
 * @remarks Signature alignée sur l'appel réel `controller.initialize()` (sans arg) ;
 *   retour `Promise<this>` — le controller renvoie son instance.
 */
export interface ControllerWithInitialize {
  initialize(): Promise<this>;
}

/**
 * Résout une route vers son couple controller/action et exécute l'action —
 * UN Resolver est alloué par requête HTTP (et par connexion WS, réutilisé
 * par message). **POJO volontaire** (V3.1) : n'étend PAS `Service` — le
 * plumbing Service (Map de listeners trackés, spread d'options, lookups
 * kernel/syslog) coûtait par requête sans aucun consommateur (jamais écouté,
 * jamais loggé, jamais dans le container). Le DI per-request passe par
 * `context.container` (le cache `"controller"` y survit au Resolver : un
 * forward ou un 2ᵉ Resolver WS sur la MÊME connexion retrouve l'instance).
 */
class Resolver implements IResolver {
  injector?: Injector | null;
  controller: ControllerConstructor | null = null;
  actionName?: string;
  action?: (...args: unknown[]) => unknown;
  context: ContextType;
  route: Route | null = null;
  resolve: boolean = false;
  variables: unknown[] = [];
  exception?: HttpError | Error | null;
  acceptedProtocol: string | null = null;
  bypassFirewall: boolean = false;
  constructor(context: ContextType) {
    this.context = context;
    this.injector = context.container?.get<Injector>("injector") ?? null;
  }

  match(route: Route, context: ContextType, cleanPath?: string) {
    try {
      const match = route.match(context, cleanPath);
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
        // Intent de session de la route (depuis `@UseSession` / paramètre
        // `@Session`) → pilote le point d'activation unique (HttpKernel.startSession).
        // P5 : lu depuis le memo de route (0 Reflect par requête).
        this.context.sessionIntent = resolveActionMeta(route).sessionIntent;
      }
      return match;
    } catch (e) {
      throw e;
    }
  }

  /**
   * Snapshot per-requête des variables de route matchées (`{name}` → valeur,
   * + wildcard `*` éventuel). Construit depuis les valeurs de CETTE requête
   * (`this.variables`, posées par `match()`) zippées avec les noms de
   * `route.variables`. Remplace l'ancien `Route.variablesMap` qui vivait sur
   * l'instance `Route` partagée (statique) → écrasé par toute requête/connexion
   * concurrente sur la même route (bleed inter-requêtes). Lu par
   * `Context.setMetaData()` pour exposer `msg.nodefony.route.variablesMap`.
   */
  getMatchedParams(): Record<string, unknown> {
    const names = (this.route?.variables ?? []) as string[];
    const params: Record<string, unknown> = {};
    for (let i = 0; i < names.length; i++) {
      params[names[i]] = this.variables[i];
    }
    const wildcard = (this.variables as unknown as Record<string, unknown>)[
      "*"
    ];
    if (wildcard !== undefined) {
      params["*"] = wildcard;
    }
    return params;
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
    module = this.context.kernel?.getModule(tab[0]) as Module | undefined;
    if (!module) {
      throw new Error(`Module not found: ${tab[0]}`);
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
    // Forward interne : même résolution d'intent de session que le match direct.
    if (this.controller) {
      this.context.sessionIntent = resolveSessionIntent(
        this.controller as ControllerConstructor,
        this.actionName,
      );
    }
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
        // Cache per-CONTEXT (pas per-Resolver) : un message WS suivant ou un
        // forward (`reload`) retrouve l'instance via le container partagé.
        this.context.container?.set("controller", controller);
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

  /**
   * Exécute l'action résolue et retourne sa **valeur brute**, SANS la rendre sur
   * le transport (pas de `returnController`/`send`). Découple « exécuter → valeur »
   * de « rendre la valeur » : un appelant multi-transport (WS-RPC `invoke`, futur
   * GraphQL) réutilise la MÊME action puis emballe le résultat à sa façon
   * (`{ id, result }`, champ GraphQL…). Le pipeline HTTP/WS normal passe par
   * {@link callController} (= `executeAction` + rendu).
   *
   * @param data - args supplémentaires (message WS brut legacy) concaténés aux variables de route.
   * @param reload - force `newController()` (le container peut déjà porter un AUTRE controller).
   * @returns la valeur retournée par l'action + son `RedirectMeta` éventuel.
   */
  async executeAction(
    data?: unknown[],
    reload: boolean = false,
  ): Promise<{ result: unknown; redirectMeta: RedirectMeta | undefined }> {
    let controller = this.context.container?.get("controller") as Controller;
    if (!controller || reload) {
      controller = await this.newController();
    }
    if (this.controller?.prototype.module) {
      controller.module = this.controller?.prototype.module;
    }
    controller.setRoute(this.route!);
    const methodKey = this.actionName as keyof typeof controller;
    // P5 : metadata d'action figées sur la route (memo, 0 Reflect/req). Forward
    // (`parsePathernController`, pas de route) → calcul direct (chemin froid).
    const meta = this.route
      ? resolveActionMeta(this.route)
      : computeActionMeta(this.controller, this.actionName);
    let args: unknown[];
    if (meta.paramsMeta) {
      args = this._buildParamArgs(meta.paramsMeta);
    } else if (data) {
      args = [...this.variables, ...data];
    } else {
      args = [...this.variables];
    }
    this._applyResponseMeta(controller, meta);
    const redirectMeta: RedirectMeta | undefined =
      meta.redirectMeta ?? undefined;
    if (typeof controller[methodKey] === "function") {
      return {
        result: (controller[methodKey] as (...a: unknown[]) => unknown)(
          ...args,
        ),
        redirectMeta,
      };
    }
    if (this.action) {
      return { result: this.action(...args), redirectMeta };
    }
    throw new Error(`Route Action not found`);
  }

  async callController(data?: unknown[], reload: boolean = false) {
    // Pas de try/catch re-throw (no-op) : les erreurs de l'action remontent
    // seules jusqu'à HttpKernel.onError. Pas de `await` superflu — le rejet se
    // propage via la promesse retournée. callController = exécuter PUIS rendre.
    const { result, redirectMeta } = await this.executeAction(data, reload);
    return this._handleRedirect(result, redirectMeta);
  }

  private _buildParamArgs(metas: ParamMeta[]): unknown[] {
    const httpCtx = this.context as HttpContext;
    const varNames: string[] = this.route?.variables ?? [];
    const paramsMap: Record<string, unknown> = {};
    for (let i = 0; i < varNames.length; i++) {
      paramsMap[varNames[i]] = this.variables[i];
    }
    // Le `Context` (HTTP comme WS) satisfait la forme `IParamArgContext`
    // (request/response/session/getRequestCookies). La résolution elle-même est
    // une fonction pure testée en unit (voir paramDecorators.test.ts).
    const ctx = this.context as unknown as IParamArgContext;
    return buildParamArgs(metas, {
      paramsMap,
      request: httpCtx?.request as IParamArgContext["request"],
      response: httpCtx?.response,
      session: ctx?.session,
      getRequestCookies: (name?: string) =>
        ctx?.getRequestCookies ? ctx.getRequestCookies(name) : undefined,
    });
  }

  /**
   * Applique `@HttpCode` + `@Header` depuis le snapshot figé de la route
   * (P5) — plus aucune lecture `Reflect` ni `Object.entries` par requête.
   */
  private _applyResponseMeta(
    controller: Controller,
    meta: RouteActionMeta,
  ): void {
    if (meta.httpCode !== null) {
      controller.response?.setStatusCode(meta.httpCode);
    }
    const entries = meta.headerEntries;
    if (entries) {
      for (let i = 0; i < entries.length; i++) {
        (controller.response as HttpResponse | Http2Response | null)?.setHeader(
          entries[i][0],
          entries[i][1],
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

  async returnController(result: unknown): Promise<unknown> {
    const type = typeOf(result);
    switch (true) {
      case result instanceof Promise:
      case result instanceof BlueBird:
      case isPromise(result):
        // Unwrap puis re-dispatch. Pas de `.catch(e => throw e)` (no-op qui
        // ajoute une microtask par requête) — le rejet se propage seul.
        // `switch(true)` ne narrow pas `result` → cast localisé sur le thenable.
        return (result as PromiseLike<unknown>).then((myresult: unknown) =>
          this.returnController(myresult),
        );
      case type === "string":
      case result instanceof String:
        return (this.context as HttpContext | WebsocketContext).send(
          result as string,
        );
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
