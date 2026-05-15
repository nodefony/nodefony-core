# @nodefony/framework MEMORY

## Purpose

Module Nodefony : routeur HTTP+WS, Controller, Resolver, décorateurs `@route`/`@controller`/`@controllers`, templates Twig/EJS.

## Core Components

| Classe/Fichier          | Lignes | Rôle                                                                                                            |
| ----------------------- | ------ | --------------------------------------------------------------------------------------------------------------- |
| `Controller`            | 514    | Extends Service. Props: `route`, `request`, `response`, `context`, `session`, `queryGet/Post/File`. API: `renderJson/View/Twig/Ejs/FileDownload/MediaStream`, `redirect`, `forward`, `startSession`, `getFlashBag/setFlashBag`. |
| `Resolver`              | 237    | Extends Service. `match(route, ctx)` → `callController(data?)` → `newController()` via Injector. Props: `controller`, `actionName`, `action`, `variables`, `bypassFirewall`, `acceptedProtocol`. |
| `Route`                 | 440    | `name`, `path`, `pattern` (RegExp compilé), `variables[]`, `defaults`, `requirements`. `match(ctx)` → vérifie url+méthode+scheme+host+requirements. Export: `RouteOptions`, `RouteRequirements`, `ControllerConstructor`. |
| `Router` (service)      | 131    | Extends Service. **Tableau statique** `routes: Route[]` — partagé entre toutes instances. `resolve(ctx)` → Resolver. `createRoute(name, opts)` static. `setController(cls, module)` static → `Module.controllers`. |
| `routerDecorators`      | 173    | `@controllers([...])` → `onBoot` → `Router.setController`. `@controller(prefix)` → `Reflect.getMetadata` → `Router.createRoute`. `@route(name, opts)` → `Reflect.defineMetadata` sur constructeur. |
| `Twig` / `Ejs`          | 118/43 | Services template. `render(file, params)` → Promise\<string\>. |

## Route Registration Flow

```
@route("name", opts)     → Reflect.defineMetadata(routes:definitions, metadata, Ctor)
@controller("/prefix")   → Reflect.getMetadata → Router.createRoute(name, opts) pour chaque route
@controllers([MyCtrl])   → onBoot → Router.setController(MyCtrl, module)
```

**Ordre critique** : `@route` avant `@controller` (metadata collectée avant que `@controller` la lise).

## Gotchas

**Router.routes est statique** : `const routes: Route[]` est module-level — une seule instance pour tout le process. `removeRoutes()` modifie ce tableau pour tout le monde.

**`Route.match()` attend `context.request.url` comme `URL` object** (pas string) — même gotcha que WebsocketContext.

**`Resolver.callController()`** : cherche le controller dans le DI container avant d'en créer un nouveau — éviter de dupliquer.

**`forward(name, param)`** : format `"module:controller:action"` — 3 parties séparées par `:`.

**`@controllers` hook `onBoot`** : les controllers sont enregistrés APRÈS le boot — pas disponibles pendant `onLoad`.

**`extractControllerFilePath`** dans routerDecorators : extrait le chemin via stack trace regex `controllers?/.*\.js` — ne fonctionne qu'avec des fichiers compilés en `.js`.

**`bluebird`** dans Resolver : `returnController` gère `BlueBird` + native Promise + `isPromise()`. Ne pas supprimer sans vérifier les controllers userland.

## Types exportés (index.ts)

```typescript
export default Framework;
export { Controller, Route, Router, Resolver, Twig, Ejs, route, controller, controllers, graphql };
```

`graphql` = `{ mergeSchemas, makeExecutableSchema, mergeResolvers, mergeTypeDefs }`.

## État des types

- `dist/types/index.d.ts` généré par Rollup (`declarationDir: "dist/types"`)
- `package.json` : `exports` + `types → dist/types/index.d.ts` ✅ (2026-05-15)
- Pas de `nodefony/interfaces/` — à créer (`IController`, `IRoute`, `IResolver`)

## Tests

Zéro tests. À créer : unit Controller (renderJson, redirect, startSession mock), unit Route (match/compile), unit Router (resolve, createRoute), décorateurs (metadata reflect).

## `any` restants (à typer progressivement)

| Fichier          | Ligne | Symbole              |
| ---------------- | ----- | -------------------- |
| `Controller.ts`  | 71-73 | `queryGet/Post/File` |
| `Resolver.ts`    | 41    | `variables: any[]`   |
| `Route.ts`       | 118   | `variables: any[]`   |
| `routerDecorators.ts` | 65 | `mycontroller: any` |
