import {
  typeOf,
  isPromise,
  isPlainObject,
  isArray,
  Injector,
  Module,
  RequestContext,
  nodefonyError,
  //inject,
} from "nodefony";
import type { IIdempotencyStore } from "nodefony";
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
  type SecurityRequirement,
} from "../decorators/routerDecorators.js";
import {
  evaluateIdempotency,
  resolveIdempotencyKey,
  resolveIdentity,
  computeFingerprint,
  isMutationMethod,
} from "./idempotency.js";

/**
 * Surface MINIMALE du service `authorization` (@nodefony/security) consommée par
 * le Resolver — résolu **par nom** via le container, jamais importé (security
 * dépend de framework, pas l'inverse → 0 cycle). Duck-typing : le service réel
 * implémente `IAuthorizationService`.
 */
interface IAuthorizer {
  decide(
    token: unknown,
    attribute: string,
    subject?: unknown,
  ): Promise<boolean>;
}

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
  /**
   * Query d'une invocation **par message** (pont WS-RPC `api.request`) — pendant
   * de `cleanPathOverride` pour le `?…` du path invoqué. Le contexte WS étant
   * PARTAGÉ par la connexion (sa `queryGet` = celle du handshake), la query
   * per-invocation vit ici (le Resolver est per-invocation → zéro bleed entre
   * requêtes concurrentes d'une même socket). `null` (hot path HTTP) = ignoré.
   * Consommé par `@Query` (`_buildParamArgs`) et copié sur le controller
   * per-request (`executeAction`).
   */
  queryOverride: Record<string, unknown> | null = null;
  /**
   * Méthode HTTP **logique** d'une invocation par le pont WS-RPC `api.request`
   * quand c'est une MUTATION (POST/PUT/PATCH/DELETE). Posée par
   * `Router.resolve(ctx, cleanPath, methodOverride)` → consommée par `match()`
   * pour désambiguïser, sur le transport WEBSOCKET unique, la route logique
   * visée (cf `Route.matchRequirements`). `null` (GET/HTTP) = match historique
   * sur `context.method`.
   */
  methodOverride: string | null = null;
  constructor(context: ContextType) {
    this.context = context;
    this.injector = context.container?.get<Injector>("injector") ?? null;
  }

  match(route: Route, context: ContextType, cleanPath?: string) {
    const match = route.match(
      context,
      cleanPath,
      this.methodOverride ?? undefined,
    );
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
      const actionMeta = resolveActionMeta(route);
      this.context.sessionIntent = actionMeta.sessionIntent;
      // CSP per-route (`@Csp`) → directives additionnelles posées sur le
      // contexte, lues par `Firewall.applySecurityHeaders` APRÈS le resolve.
      // `null` en l'absence de `@Csp` (99 %) → on n'écrit pas (champ déjà null).
      if (actionMeta.cspDirectives !== null) {
        this.context.cspDirectives = actionMeta.cspDirectives;
      }
      // CSRF per-route (`@CsrfProtect`/`@CsrfExempt`) → lus par `Firewall.enforceCsrf`
      // (post-resolve, dans `onRequestEnd`). `false` par défaut → on n'écrit que si posé.
      if (actionMeta.csrfProtect) this.context.csrfProtect = true;
      if (actionMeta.csrfExempt) this.context.csrfExempt = true;
    }
    return match;
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
    if (!this.controller) {
      throw new Error(`Route Controller not found`);
    }
    // V4.3 — scope statique de la classe (posé par `@Scope`, hérité de
    // Controller) : lecture directe, 0 Reflect. Singleton → instance partagée
    // depuis le cache kernel-scoped du Router (la promesse est cachée AVANT le
    // 1er await : les requêtes concurrentes de la création n'instancient pas).
    if (
      (this.controller as unknown as typeof Controller).scope === "singleton"
    ) {
      const router = this.context.router;
      const controller = router
        ? await router.getSingletonController(this.controller, () =>
            this._createController(context),
          )
        : // Pas de Router (harness de test) → dégradé per-request, sans cache.
          await this._createController(context);
      // Pointeur posé sur le container de REQUÊTE : un message WS suivant ou
      // un forward (`reload`) retrouve l'instance par le chemin existant.
      this.context.container?.set("controller", controller);
      return controller;
    }
    const controller = await this._createController(context);
    // Cache per-CONTEXT (pas per-Resolver) : un message WS suivant ou un
    // forward (`reload`) retrouve l'instance via le container partagé.
    this.context.container?.set("controller", controller);
    return controller;
  }

  /**
   * Instancie la classe controller résolue (DI) + hooks de création : `module`
   * (constante de classe, shadow d'instance posé 1× ici — plus de write par
   * requête dans `executeAction`) puis `initialize()`. Pour un singleton,
   * `initialize()` n'est donc appelé qu'UNE fois, à la création (sémantique
   * boot) — le per-request y lit l'ALS s'il a besoin de la requête.
   */
  private async _createController(context?: ContextType): Promise<Controller> {
    // Phase `initialize` — la MISE EN PLACE du controller : résolution DI
    // (dépendances du constructeur) + hook `initialize()` (où les controllers
    // ouvrent leur session, chargent un contexte métier…). C'est du temps réel,
    // qui n'était imputé à personne : il disparaissait dans le bloc opaque
    // `action`. Un singleton ne la paie qu'à sa première requête — la phase
    // n'apparaîtra donc que là, ce qui est la vérité.
    const ctx = context || this.context;
    ctx.phaseStart("initialize");
    try {
      const controller = this.injector?.instantiate<Controller>(
        this.controller as ControllerConstructor,
        ctx,
      );
      if (!controller) {
        throw new Error(`Route Controller not found`);
      }
      if (this.controller?.prototype.module) {
        controller.module = this.controller.prototype.module;
      }
      if (
        "initialize" in controller &&
        typeof controller.initialize === "function"
      ) {
        await controller.initialize();
      }
      return controller as Controller;
    } finally {
      ctx.phaseEnd("initialize");
    }
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
    metaArg?: RouteActionMeta,
  ): Promise<{ result: unknown; redirectMeta: RedirectMeta | undefined }> {
    // P5 : metadata d'action figées (memo, 0 Reflect/req) — hoisté en tête car
    // la GARDE d'autorisation (P6 J7) s'évalue AVANT toute instanciation.
    // `metaArg` : si `callController` l'a DÉJÀ résolu (hot path), on le réutilise
    // → zéro double résolution (un `resolveActionMeta` redondant par requête).
    const meta =
      metaArg ??
      (this.route
        ? resolveActionMeta(this.route)
        : computeActionMeta(this.controller, this.actionName));
    // SECURITY — @IsGranted AVANT newController : un 403 court-circuite
    // l'instanciation DI + initialize() (Zero Trust). `security === null`
    // (route non gardée, 99 %) → 0 lookup, 0 await, 0 alloc.
    //
    // ⚠️ Vrai du trajet HTTP SEULEMENT. Le kernel y arme la route sans instancier
    // (`http-kernel.ts` `prepareFrontController`), donc ce court-circuit est celui
    // de bout en bout. En **WebSocket**, le controller est instancié au HANDSHAKE
    // — avant qu'une frame ne soit gardée : sur ce transport, un refus n'évite
    // ni la DI ni `initialize()`, qui ont déjà tourné.
    if (meta.security !== null) {
      await this._enforceSecurity(meta.security);
    }
    let controller = this.context.container?.get("controller") as Controller;
    // Le pointeur "controller" du container est PARTAGÉ par la connexion (WS)
    // et réécrit par tout re-routage (invoke, forward). S'il porte une AUTRE
    // classe que celle de la route courante (connexion WS dont un message a
    // invoké une autre action), le réutiliser chercherait `actionName` sur la
    // mauvaise instance → "Route Action not found". Court-circuité par
    // `!controller` sur le hot path HTTP (container de requête vierge) → 0 coût.
    if (
      !controller ||
      reload ||
      (this.controller && !(controller instanceof this.controller))
    ) {
      controller = await this.newController();
    }
    // V4.3 — `module` est posé à la création (`_createController`), plus par
    // requête. `setRoute` (write per-request sur l'instance) est SKIPPÉ pour
    // un singleton — data race sinon ; son getter `route` dérive du Resolver
    // de la requête courante (`context.resolver.route`, V4.1).
    if (
      (this.controller as unknown as typeof Controller | null)?.scope !==
      "singleton"
    ) {
      controller.setRoute(this.route!);
      // Pont WS-RPC : la query du path invoqué remplace celle du handshake
      // pour les getters d'instance (`this.query`/`this.queryGet` — ex.
      // `AdminApiController.buildRequest`). Per-instance → zéro bleed. Les
      // singletons n'ont pas ce shadow (stateless : `@Query` seul, via le bag).
      if (this.queryOverride !== null) {
        controller.queryGet = this.queryOverride;
        controller.query = this.queryOverride;
      }
    }
    const methodKey = this.actionName as keyof typeof controller;
    // `meta` résolu en tête de méthode (hoisté pour la garde @IsGranted) — réutilisé.
    let args: unknown[];
    if (meta.paramsMeta) {
      args = this._buildParamArgs(meta.paramsMeta);
    } else if (data) {
      args = [...this.variables, ...data];
    } else {
      args = [...this.variables];
    }
    this._applyResponseMeta(meta);
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
    // P5/P6.8 — meta d'action résolu UNE seule fois ici (memo O(1) : lecture du
    // champ figé `route.actionMeta`) puis PASSÉ à `executeAction` → zéro double
    // résolution sur le hot path. `idempotent === null` sur la quasi-totalité des
    // routes → 1 comparaison, flux normal (0 lookup store, 0 alloc). Seules les
    // actions `@Idempotent` dévient vers la porte d'idempotence.
    const meta = this.route
      ? resolveActionMeta(this.route)
      : computeActionMeta(this.controller, this.actionName);
    // Pas de try/catch re-throw (no-op) : les erreurs de l'action remontent
    // seules jusqu'à HttpKernel.onError. callController = exécuter PUIS rendre.
    const { result, redirectMeta } =
      meta.idempotent !== null
        ? await this._callWithIdempotency(meta, data, reload)
        : await this.executeAction(data, reload, meta);
    return this._handleRedirect(result, redirectMeta);
  }

  /**
   * Exécute l'action AVEC la porte d'idempotence mais SANS rendu
   * (`returnController`) — le chemin du **pont `api.request`** (WS) : la valeur
   * nue est enveloppée `{id, result}` par le peer, jamais rendue sur le
   * transport. La méthode HTTP logique d'une mutation du pont voyage dans
   * {@link methodOverride} ; sans porte ici, un rejeu `socket.mutate` (socket
   * qui reconnecte) ré-exécuterait la mutation (doublon — vécu au banc duplex).
   *
   * @returns `{ result }` — la valeur retournée par l'action (ou la réponse
   *   mémorisée rejouée pour une clé d'idempotence déjà servie).
   */
  async executeActionGuarded(
    data?: unknown[],
    reload: boolean = false,
  ): Promise<{ result: unknown }> {
    const meta = this.route
      ? resolveActionMeta(this.route)
      : computeActionMeta(this.controller, this.actionName);
    const { result } =
      meta.idempotent !== null
        ? await this._callWithIdempotency(meta, data, reload)
        : await this.executeAction(data, reload, meta);
    return { result };
  }

  /**
   * Applique la porte d'idempotence d'une action `@Idempotent` (mutations), via le
   * helper partagé `idempotency.ts` (la MÊME sémantique que le data plane admin) et
   * le service `idempotencyStore`. Conforme `draft-ietf-httpapi-idempotency-key-header`.
   *
   * Cycle (anti double-effet) : `evaluateIdempotency` rend un verdict neutre →
   *  - `reject` → `nodefonyError` (400 clé requise / 409 concurrent / 422 mismatch) ;
   *  - `replay` → réponse mémorisée rejouée SANS ré-exécuter l'action ;
   *  - `execute` → exécution directe (mode souple sans clé / store absent) ;
   *  - `guarded` → exécuter, puis `complete()` (succès, réponse rejouable) ou
   *    `abort()` (échec/403 — la clé reste réessayable, un échec ne se mémorise pas).
   *
   * No-op sur les méthodes sûres (GET…). La réponse mémorisée est
   * le **résultat retourné** par l'action (`return data`) + son statut : une action
   * qui pilote la response manuellement (`this.render`/stream) n'est pas rejouée
   * fidèlement (le double-effet reste évité, mais le corps rejoué est vide).
   *
   * Retourne la forme BRUTE `{ result, redirectMeta }` (comme `executeAction`) :
   * le rendu appartient à l'appelant — `callController` rend (`_handleRedirect`),
   * le pont (`executeActionGuarded`) enveloppe la valeur nue.
   */
  private async _callWithIdempotency(
    meta: RouteActionMeta,
    data?: unknown[],
    reload: boolean = false,
  ): Promise<{ result: unknown; redirectMeta: RedirectMeta | undefined }> {
    const context = this.context;
    // No-op sur méthode sûre → flux normal (l'action décorée peut être un GET
    // si `@Idempotent` est posé sur la classe : seules les mutations sont gatées).
    // En WS, la méthode LOGIQUE d'une mutation du pont `api.request` voyage dans
    // `methodOverride` (posé par `router.resolve(ctx, path, method)`) — sans elle
    // `context.method` = transport WEBSOCKET → la porte serait SAUTÉE et le rejeu
    // d'une frame `socket.mutate` créerait un DOUBLON (vécu au banc duplex).
    // `meta` est repassé à `executeAction` (pas de re-résolution).
    if (!isMutationMethod(this.methodOverride ?? context.method)) {
      return this.executeAction(data, reload, meta);
    }
    const als = RequestContext.get();
    const paramCtx = context as unknown as IParamArgContext;
    const httpReq = paramCtx.request;
    // Params de route (noms → valeurs) pour le fingerprint du payload.
    const names = (this.route?.variables ?? []) as string[];
    const params: Record<string, unknown> = {};
    for (let i = 0; i < names.length; i++) {
      params[names[i]] = this.variables[i];
    }
    // Corps : posé dans l'ALS par le pont WS, sinon body HTTP parsé (queryPost).
    const body =
      als?.body !== undefined ? als.body : (httpReq?.queryPost ?? null);
    const store = context.container?.get("idempotencyStore") as
      IIdempotencyStore | undefined;
    const verdict = await evaluateIdempotency({
      store,
      identity: resolveIdentity(als?.user),
      clientKey: resolveIdempotencyKey(
        als?.idempotencyKey,
        httpReq?.headers?.["idempotency-key"],
      ),
      fingerprint: computeFingerprint([
        this.route?.name ?? this.actionName,
        params,
        body,
      ]),
      isWs: Boolean(
        (context.type as string | undefined)?.startsWith("websocket"),
      ),
      required: meta.idempotent?.required ?? true,
    });
    if (verdict.kind === "reject") {
      throw new nodefonyError(verdict.message, verdict.status);
    }
    if (verdict.kind === "replay") {
      const { status, headers, body: memo } = verdict.response;
      const response = context.response;
      response?.setStatusCode(status);
      if (headers) {
        for (const k in headers) {
          (response as HttpResponse | Http2Response | null)?.setHeader(
            k,
            headers[k] as string,
          );
        }
      }
      return { result: memo, redirectMeta: undefined };
    }
    if (verdict.kind === "execute") {
      return this.executeAction(data, reload, meta);
    }
    // guarded : exécuter puis mémoriser le succès (rejouable) / libérer l'échec.
    try {
      const { result, redirectMeta } = await this.executeAction(
        data,
        reload,
        meta,
      );
      const resolved = await result; // unwrap promesse éventuelle de l'action
      const status =
        (context.response as HttpResponse | Http2Response | null)?.statusCode ??
        200;
      try {
        await store?.complete(verdict.key, { status, body: resolved });
      } catch {
        // Corps non mémorisable — typiquement une action qui a retourné la
        // Response (`return this.renderJson(...)`, structure circulaire) au
        // lieu de son payload : un store sérialisant (SQL/Redis) throw au
        // stringify. La réponse est DÉJÀ partie → l'erreur remonterait dans le
        // vide et l'abort effacerait la clé : le rejeu RÉ-EXÉCUTERAIT la
        // mutation (perte de la dédup, silencieuse). On mémorise donc le
        // statut avec un corps vide (le double-effet reste évité) et on le
        // DIT — une action `@Idempotent` doit retourner son payload brut.
        try {
          (context as unknown as { log: (m: string, s: string) => void }).log(
            `@Idempotent ${this.route?.name ?? this.actionName}: réponse non ` +
              `mémorisable (corps non sérialisable — retourne le payload brut, ` +
              `pas renderJson) ; dédup conservée avec un corps de rejeu vide`,
            "WARNING",
          );
        } catch {
          // le log ne casse jamais la dédup (harnais sans syslog)
        }
        await store?.complete(verdict.key, { status, body: null });
      }
      return { result: resolved, redirectMeta };
    } catch (e) {
      await store?.abort(verdict.key);
      throw e;
    }
  }

  /**
   * Évalue l'exigence d'autorisation (`@IsGranted`) d'une action via le service
   * `authorization` (par nom, 0 import security). Clauses en **AND**, attributs
   * d'une clause en **OR**. Refus (ou moteur/identité absents) → 403 (Zero Trust,
   * fail-closed). Cold path : n'est appelé que sur une route gardée.
   *
   * @throws nodefonyError 403 si l'accès est refusé.
   */
  private async _enforceSecurity(req: SecurityRequirement): Promise<void> {
    const authz = this.context.container?.get("authorization") as
      IAuthorizer | undefined;
    const token = RequestContext.get()?.token;
    // Fail-closed : route gardée mais moteur d'autz absent (module security non
    // chargé) ou aucune identité résolue (pas de zone firewall) → refus.
    if (!authz || token === undefined) {
      throw new nodefonyError("Access denied", 403);
    }
    const clauses = req.clauses;
    for (let i = 0; i < clauses.length; i++) {
      const clause = clauses[i]!;
      const subject =
        clause.subjectParam !== undefined
          ? this._resolveSubject(clause.subjectParam)
          : undefined;
      // OR interne : un seul attribut accordé valide la clause.
      let ok = false;
      const anyOf = clause.anyOf;
      for (let j = 0; j < anyOf.length; j++) {
        if (await authz.decide(token, anyOf[j]!, subject)) {
          ok = true;
          break;
        }
      }
      // AND : une clause non satisfaite → refus immédiat.
      if (!ok) {
        throw new nodefonyError("Access denied", 403);
      }
    }
  }

  /**
   * Résout un paramètre de route NOMMÉ (`@IsGranted(..., { subject: "id" })`) vers
   * sa valeur, depuis `route.variables` (noms) + `this.variables` (valeurs déjà
   * parsées). 0 alloc (indexOf + accès tableau).
   */
  private _resolveSubject(name: string): unknown {
    const names = this.route?.variables ?? [];
    const idx = names.indexOf(name);
    return idx === -1 ? undefined : this.variables[idx];
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
      // Pont WS-RPC : query du path INVOQUÉ (jamais celle du handshake).
      // `?? undefined` : null (hot path) → clé absente pour `resolveParamArg`.
      queryOverride: this.queryOverride ?? undefined,
      getRequestCookies: (name?: string) =>
        ctx?.getRequestCookies ? ctx.getRequestCookies(name) : undefined,
    });
  }

  /**
   * Applique `@HttpCode` + `@Header` depuis le snapshot figé de la route
   * (P5) — plus aucune lecture `Reflect` ni `Object.entries` par requête.
   * V4.3 : cible la response du CONTEXT (per-request : identique à
   * `controller.response` ; singleton : la seule source correcte — l'instance
   * partagée ne porte aucune response).
   */
  private _applyResponseMeta(meta: RouteActionMeta): void {
    const response = this.context.response;
    if (meta.httpCode !== null) {
      response?.setStatusCode(meta.httpCode);
    }
    const entries = meta.headerEntries;
    if (entries) {
      for (let i = 0; i < entries.length; i++) {
        (response as HttpResponse | Http2Response | null)?.setHeader(
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
      case isPromise(result):
        // Unwrap puis re-dispatch. `isPromise` duck-type tout thenable
        // (Promise natif, ex-Bluebird userland, Q…) via `.then` → couvre les
        // promesses tierces sans dépendance dédiée.
        // Pas de `.catch(e => throw e)` (no-op qui ajoute une microtask par
        // requête) — le rejet se propage seul.
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
      case type === "buffer":
        // Buffer brut retourné par l'action → envoi direct (parité avec le
        // `case string`). ⚠️ `typeOf(Buffer)` = "buffer" (pas "object") : sans
        // ce case dédié il tombait dans le default → AUCUN envoi → requête
        // pendue jusqu'au timeout 408.
        if ((this.context as HttpContext).sended) {
          return;
        }
        return (this.context as HttpContext | WebsocketContext).send(
          result as Buffer,
        );
      case type === "number":
      case type === "boolean":
        // RFC 8259 §2 : un scalaire JSON est un document valide top-level.
        // Parité DX avec string/object/array (NestJS/Fastify font pareil) :
        // `return 42` / `return true` répondent "42"/"true" en
        // application/json — avant : valeur « non rendable » → hang → 408.
        // undefined/null restent « l'action a géré elle-même » (default).
        if ((this.context as HttpContext).sended) {
          return;
        }
        this.context.setContextJson();
        return (this.context as HttpContext | WebsocketContext).render(result);
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
        // ReadStream / instances de classe → NON sérialisés (un stream est déjà
        // pipé par streamFile → `sended` ci-dessus), jamais `JSON.stringify`.
        if (isPlainObject(result) || isArray(result)) {
          this.context.setContextJson();
          return (this.context as HttpContext | WebsocketContext).render(
            result,
          );
        }
        // Instance de classe jamais envoyée (entité ORM Mongoose, DTO…) : valeur
        // non rendable — même traitement que number/boolean (default) : poser
        // `waitAsync` pour que le warning dev du teardown signale le hang au
        // lieu d'un timeout muet. (WS : pas de teardown → no-op.)
        switch (this.context.type) {
          case "http":
          case "http2":
          case "http3":
          case "https":
            this.context.waitAsync = true;
            break;
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
            // Statut SANS CORPS (RFC 9110 §15.3.5 / §15.4.5) : `204 No Content`,
            // `205 Reset Content`, `304 Not Modified`. Ici, un retour `null` ne veut
            // PAS dire « l'action enverra elle-même » — il veut dire « il n'y a rien à
            // dire ». Sans ce cas, un `@Delete @HttpCode(204) { …; return null; }`
            // laissait la requête pendue jusqu'au timeout, alors que la suppression
            // avait bien eu lieu (vécu sur une ressource générée).
            if (NO_BODY_STATUS.has(this.getResponseStatus())) {
              return (this.context as HttpContext).send();
            }
            this.context.waitAsync = true;
            break;
        }
    }
  }

  /** Statut courant de la réponse (0 si le transport n'en porte pas). */
  private getResponseStatus(): number {
    return (
      (this.context.response as HttpResponse | Http2Response | null)
        ?.statusCode ?? 0
    );
  }
}

/** Statuts dont la réponse n'a, par définition, pas de corps (RFC 9110). */
const NO_BODY_STATUS = new Set([204, 205, 304]);

export default Resolver;
