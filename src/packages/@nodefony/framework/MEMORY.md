# @nodefony/framework MEMORY

## Docs liées

- [`CLAUDE.md`](./CLAUDE.md) — instructions module
- [`../http/MEMORY.md`](../http/MEMORY.md) — Context/Request/Response (dépendance bas-niveau)
- [`../../../modules/test/MEMORY.md`](../../../modules/test/MEMORY.md) — controllers d'intégration
- Core : [`../../../nodefony/MEMORY.md`](../../../nodefony/MEMORY.md) (Service) | [`../../../nodefony/src/kernel/injector/MEMORY.md`](../../../nodefony/src/kernel/injector/MEMORY.md) (DI/Injector — `Injector.instantiate` utilisé par `Resolver.newController()`)

## Purpose

Module Nodefony : routeur HTTP+WS, Controller, Resolver, décorateurs `@route`/`@controller`/`@controllers` + NestJS-inspired HTTP method + response decorators, templates Twig/EJS.

## Core Components

| Classe/Fichier          | Lignes | Rôle                                                                                                            |
| ----------------------- | ------ | --------------------------------------------------------------------------------------------------------------- |
| `Controller`            | 514    | Extends Service. Props: `route`, `request`, `response`, `context`, `session`, `queryGet/Post/File`. API: `renderJson/View/Twig/Ejs/FileDownload/MediaStream`, `redirect`, `forward`, `startSession`, `getFlashBag/setFlashBag`. **⚠ méthodes: ne pas nommer une méthode `session` (conflit avec prop Controller.session).** |
| `Resolver`              | 290    | Extends Service. `match(route, ctx)` → `_applyResponseDecorators()` → `callController()` → `_handleRedirect()` → `returnController()`. `newController()` via Injector. |
| `Route`                 | 440    | `name`, `path`, `pattern` (RegExp compilé), `variables[]`, `defaults`, `requirements`. `match(ctx)` → vérifie url+requirements. `matchRequirements` vérifie `requirements.methods` (pas `route.method`). |
| `Router` (service)      | 131    | Tableau statique `routes: Route[]` partagé process-wide. `resolve(ctx)` → Resolver. `createRoute(name, opts)` static. |
| `routerDecorators`      | 290    | `@controllers`, `@controller(prefix)`, `@route(name, opts)` + **`@Get/@Post/@Put/@Delete/@Patch`** (requirements.methods) + **`@HttpCode/@Header/@Redirect`** + **`@Param/@Body/@Query`** (Reflect metadata). |
| `Twig` / `Ejs`          | 118/43 | Services template. `render(file, params)` → Promise\<string\>. |

## Interfaces

| Interface    | Fichier                              | Implémentée par |
| ------------ | ------------------------------------ | --------------- |
| `IController`| `nodefony/interfaces/IController.ts` | `Controller` — `route` est `readonly` dans l'interface (covariance) |
| `IRoute`     | `nodefony/interfaces/IRoute.ts`      | `Route` |
| `IResolver`  | `nodefony/interfaces/IResolver.ts`   | `Resolver` |
| `IAdminBroker`| `nodefony/interfaces/IAdminBroker.ts` | `AdminBroker` — étend `IAdminRegistry` (core) |

## Admin data plane — `IAdminApi` / `AdminBroker` (P10.2-P10.3, 2026-05-20)

Contrat d'exposition admin pour Studio. **Inversion de dépendance** : contrat producteur dans le core, transport dans framework.

- **Core (`nodefony`)** : `IAdminApi` (`adminNamespace`, `adminDescriptor()`, `adminEndpoints()`), `IAdminEndpoint` (`path` relatif, `method`, `role`, `handler`), `IAdminRequest`/`IAdminResponse` (abstraction du Context → core ne dépend pas de http), `IAdminRegistry` (façade minimale `register/unregister/has/getApi/list`).
- **Framework** : `IAdminBroker extends IAdminRegistry` (+ `mountAll`, `resolvePath`, `resolve` O(1), `routes`). `AdminBroker` (Service `"adminBroker"`), `AdminApiController` (controller pont unique), `createKernelAdminApi(kernel)`.

**Flux** : producteur `register(api)` en `onKernelBoot` → `Framework.onKernelReady` enregistre le kernel + `broker.mountAll()` → `Router.createRoute` 1 route/endpoint vers `AdminApiController.dispatch` + `setController` once → dispatch `resolve(route.name)` O(1) → `Context→IAdminRequest` → RBAC → `handler` → `renderJson`.

**Producteur externe (http/security…)** : importe SEULEMENT `IAdminApi`/`IAdminRegistry` depuis `"nodefony"` (jamais framework — dép. circulaire). `container.get("adminBroker") as IAdminRegistry` → `.register(api)`.

**Gotchas** :
- `AdminBroker extends Service` → `Service.get()` existe : le getter producteur s'appelle **`getApi`** (pas `get`).
- **RBAC différé** : `request.roles` vide tant que P6 absent → 403 inactif (mode mock). S'active dès que le firewall peuple les rôles, sans changer le code.
- `mountAll()` à `onKernelReady` → producteurs s'enregistrent en `onKernelBoot`.
- Routes admin **≥3 segments** `/nodefony/<ns>/api/*` (jamais mono-segment → collision SPA Studio).
- **Params `{x}`** : `route.variables` = `string[]` de NOMS ; les valeurs arrivent en args positionnels à l'action (`dispatch(...args)`), alignées sur `route.variables` (cf `Resolver._buildParamArgs`). `buildRequest` zippe noms↔args → `request.params`. `{x}` = mono-segment (`[^/]+`) → pas de `/` dans la valeur (ex `module/{name}` : utiliser la clé `http`, pas `@nodefony/http`).
- **Enveloppe `IAdminResponse`** reconnue par `normalize()` SEULEMENT si `status` OU `headers` présent. Un `{ body }` seul = traité comme donnée brute → **double-wrap** `{body:{body:...}}`. Règle producteur : succès défaut 200 = renvoyer la donnée BRUTE ; n'utiliser l'enveloppe que pour piloter status/headers (ex 404).

**Producteurs migrés ✅** (runtime 2026-05-20) :
- **kernel** : `GET /nodefony/kernel/api/{health,info,modules}` — `createKernelAdminApi(kernel)` (le kernel ne peut pas s'auto-enregistrer → framework le wrappe).
- **framework** : `GET /nodefony/framework/api/{routes,info}` — `createFrameworkAdminApi()` dump `Router.routes` (équivalent web `router:dump`, source vue Routes Studio P10.8). Le framework héberge le broker → register direct dans `onKernelReady` avant `mountAll`.
- **http** : `GET /nodefony/http/api/{servers,info}` (cf http MEMORY.md).
- **syslog** : `GET /nodefony/syslog/api/{logs,info}` — `createSyslogAdminApi(kernel.syslog)` lit `ISyslog.ringStack` (FIFO). `logs` supporte `?severity=ERROR&limit=N`. Wrappé par framework (syslog est dans le core).
- **+ endpoint paramétré témoin** : `GET /nodefony/kernel/api/module/{name}` (détail module — exerce la regexp `{x}`).

## Route Registration Flow

```
@route("name", opts)     → Reflect.defineMetadata(routes:definitions, metadata, Ctor)
@Get/Post/etc(path, opts)→ idem avec auto-name ClassName::methodName + requirements.methods
@controller("/prefix")   → Reflect.getMetadata → Router.createRoute(name, opts) pour chaque route
@controllers([MyCtrl])   → onBoot → Router.setController(MyCtrl, module)
```

**Ordre critique** : `@route`/`@Get/etc` avant `@controller` (metadata collectée avant que `@controller` la lise).

## Decorators NestJS-inspired

### HTTP method decorators

```typescript
@Get(path?, options?)    // → requirements: { methods: ["GET"] }
@Post(path?, options?)   // → requirements: { methods: ["POST"] }
@Put / @Delete / @Patch  // idem
```

Auto-name : `ClassName::methodName` — déterministe, unique par (classe, méthode).

**Clé** : stocke `requirements: { methods }` pas `method: [...]` — sinon `matchRequirements()` ne filtre pas.

### Parameter decorators

```typescript
@Param("id")   // route path variable — this.variables[i] (captures sans full-match)
@Param()       // tous les params nommés comme Record<string, unknown>
@Body("field") // champ du body parsé (queryPost)
@Body()        // body complet
@Query("q")    // paramètre query string (queryGet)
@Query()       // query string complet
```

**Activation** : dès qu'au moins 1 décorateur est présent sur la méthode → `Resolver._buildParamArgs()` remplace les args positionnels.

**Gotcha `@Param`** : `route.match()` retourne `map = res.slice(1)` (captures SANS le full-match). Donc `this.variables[0]` = 1ère capture. Index `i`, pas `i+1`.

### Response decorators

```typescript
@HttpCode(201)          // Reflect metadata route:httpCode — appliqué par Resolver avant action
@Header("X-Foo", "bar") // Reflect metadata route:responseHeaders — accumulable, appliqué avant action
@Redirect("/url", 302)  // Reflect metadata route:redirect — appliqué si action retourne void/null
```

Ordre lecture dans Resolver : `_applyResponseDecorators(controller, proto)` → `Reflect.getMetadata(key, proto, actionName)`.

**`@Redirect` flow** : action retourne void → `context.redirect(url, code)` → `returnController(undefined)` → `isRedirect=true` → `context.send()`.

**Metadata keys exportées** : `HTTP_CODE_METADATA`, `HEADERS_METADATA`, `REDIRECT_METADATA`, `PARAM_ARGS_METADATA`, `RedirectMeta`, `ParamMeta`, `ParamSource`.

## Resolver Pipeline (détail)

```
callController()
  → _applyResponseDecorators(controller, proto)  // @HttpCode + @Header
  → Reflect.getMetadata(REDIRECT_METADATA, proto, actionName)
  → action(...args)
  → _handleRedirect(actionResult, redirectMeta)
    → si redirectMeta + void → context.redirect() → returnController(undefined)
    → sinon → returnController(actionResult)
  → returnController()
    → Promise → unwrap récursif
    → string → context.send()
    → HttpResponse/Http2Response/WebsocketResponse → retourner direct
    → void + isRedirect → context.send()
    → void → waitAsync = true
```

## Gotchas

**Router.routes est statique** : module-level — une seule liste pour tout le process. `removeRoutes()` affecte tout le monde.

**`Route.match()` attend `URL` object** — pas de string pour `context.request.url`.

**`requirements.methods` vs `route.method`** : seul `requirements.methods` est vérifié par `matchRequirements()`. `@Get/@Post/etc` utilisent `requirements.methods`. L'ancien champ `route.method` n'est plus utilisé pour le filtrage.

**`Controller.session` prop écrase la méthode** : si une méthode de controller s'appelle `session()`, `controller["session"]` retourne la Session (prop instance) pas la méthode. Bug subtil : `Resolver.callController` → "Route Action not found". **Règle : ne jamais nommer une action `session`, `request`, `response`, `context`, `method`.**

**queryGet first param bug** : `qs.parse(url.search)` sans `ignoreQueryPrefix:true` → premier param = `"?name"` au lieu de `"name"`. Bug pré-existant `@nodefony/http`. Les tests d'intégration testent seulement le 2ème param.

**`extractControllerFilePath`** dans routerDecorators : stack trace regex `controllers?/.*\.js` — fonctionne uniquement avec fichiers compilés en `.js`.

**`bluebird`** dans Resolver : `returnController` gère `BlueBird` + native Promise + `isPromise()`. Ne pas supprimer.

**`@Redirect` envoie via `returnController(undefined)`** — ne jamais `return` directement après `context.redirect()` dans Resolver, sinon la réponse n'est pas envoyée.

**`Response.redirect()` default = 301** — sans status explicite, la réponse est 301 (pas 302). Toujours passer le code explicitement : `this.redirect(url, 302)`.

## Types exportés (index.ts)

```typescript
export default Framework;
export { Controller, Route, Router, Resolver, Twig, Ejs };
// decorators
export { route, controller, controllers, Get, Post, Put, Delete, Patch, HttpCode, Header, Redirect, Param, Body, Query };
// types only
export type { IController, IRoute, IResolver };
export { graphql };
```

## Tests

| Suite | Fichier | Nb | Scope |
|-------|---------|-----|-------|
| Route | `unit/Route.test.ts` | 28 | constructor, compile, match, variables, defaults, matchRequirements, setPrefix, toObject, requirements API |
| Router | `unit/Router.test.ts` | 11 | createRoute, getRoutes, removeRoutes, matchRoutes |
| @route/@controller | `unit/routerDecorators.test.ts` | 10 | route registered, prefix, multi-route, metadata cleanup, pattern + @Param/@Body/@Query metadata storage |
| @Get/Post/etc + @HttpCode/@Header/@Redirect | `unit/httpMethodDecorators.test.ts` | 23 | auto-naming, requirements.methods, metadata storage, combined |
| Controller intégration | `integration/controller.test.ts` | 23 | renderJson, @HttpCode, @Header, redirect(), @Redirect, errors, queryGet, method constraints, context, session |
| @Param/@Body/@Query intégration | `http/decorators.test.ts` | 10 | @Param clé unique/multiple/sans clé, @Query avec/sans, @Body complet/champ/absent, combinés |
| **AdminBroker** | `unit/AdminBroker.test.ts` | 10 | register/dup throw/has/getApi/list/unregister, resolvePath, mountAll (routes+resolve O(1)+idempotent), register-after-mount throw |
| **Admin data plane** | `integration/admin-dataplane.test.ts` | 14 | kernel/http/framework/syslog endpoints, **param `{name}` (regexp)**, **404 enveloppe**, **non double-wrap**, header x-nodefony-instance, 405 |
| **TOTAL** | | **136** | **92 unit + 44 intégration** (server requis pour intégration) |

Lancer : `npm test` (unit) — `npm run test:integration` (unit + intégration, serveur requis 5151/5152). Tests admin = régression des 2 bugs trouvés (params/enveloppe).

## État

- `dist/types/index.d.ts` généré par Rollup ✅ (2026-05-15)
- `package.json` : `exports` + `types` ✅ (2026-05-15)
- `IController`/`IRoute`/`IResolver` créées + `implements` sur les 3 classes ✅ (2026-05-15)
- NestJS decorators `@Get/@Post/etc` + `@HttpCode/@Header/@Redirect` ✅ (2026-05-16)
- Parameter decorators `@Param/@Body/@Query` ✅ (2026-05-16)
- Fix `queryGet ?-prefix` dans `@nodefony/http` Request.ts ✅ (2026-05-16)
- 100 tests (72 unit + 28 intégration), 0 failing ✅ (2026-05-16)

## `any` restants (à typer progressivement)

| Fichier          | Ligne | Symbole              |
| ---------------- | ----- | -------------------- |
| `Controller.ts`  | 71-73 | `queryGet/Post/File` |
| `Resolver.ts`    | 41    | `variables: any[]`   |
| `Route.ts`       | 118   | `variables: any[]`   |
| `routerDecorators.ts` | 65 | `mycontroller: any` |
