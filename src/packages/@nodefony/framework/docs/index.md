---
title: "@nodefony/framework"
module: "@nodefony/framework"
since: "10.0.0"
updated: "2026-05-20"
status: stable
order: 0
---

# @nodefony/framework

> Couche routage + controllers de Nodefony — `Router`, classe `Controller` de base, `Resolver` (instancie et invoque le controller via DI), `Route` (compilation + matching), décorateurs `@controller`/`@route`/`@controllers` inspirés de NestJS, et le **data plane admin** (`IAdminApi` / `AdminBroker`) consommé par Studio.

## Vue d'ensemble

`@nodefony/framework` se branche **au-dessus** de `@nodefony/http` : il fournit le `resolver` que le pipeline HTTP appelle pour transformer un `Context` en réponse de controller. Une seule liste de routes statique (`const routes: Route[]`) est partagée dans le process.

## Pipeline controller

```
Router.resolve(ctx)
  → Resolver.match(route, ctx)      // sélection de la route
  → Resolver.newController()        // Injector.instantiate(Ctor, ctx)  (jamais new direct)
  → controller.initialize()         // hook optionnel async
  → Resolver.callController(...)    // invoque l'action (args = variables de route)
  → Resolver.returnController(res)  // normalise la réponse
```

## Décorateurs

| Décorateur | Effet |
| --- | --- |
| `@route("name", opts)` | `Reflect.defineMetadata` sur le constructeur (évalué **avant** `@controller`). |
| `@controller("/prefix")` | Lit la metadata → `Router.createRoute()` pour chaque `@route`. |
| `@controllers([Ctrl])` | Hook `onBoot` → `Router.setController(cls, module)`. |

`reflect-metadata` + `experimentalDecorators: true` requis.

## Data plane admin — `IAdminApi` / `AdminBroker`

Le contrat producteur **`IAdminApi`** vit dans le **core** (inversion de dépendance : n'importe quel module, même un adapter ORM sous http, peut s'exposer sans importer framework). Le **`AdminBroker`** (ce module) est le seul à posséder le `Router` : il collecte les producteurs au boot et monte `/nodefony/<namespace>/api/*`.

- Producteurs intégrés : `kernel`, `http`, `framework`, `syslog`.
- Un `AdminApiController` unique sert toutes les routes (`dispatch`) — chaque endpoint reste une vraie `Route` (404/405 Router corrects), estampillée `x-nodefony-instance` (per-instance, cloud-native).
- Endpoints d'introspection cross-module portés par le producteur `kernel` : `module/{name}`, `module/{name}/docs`, `module/{name}/docs/{slug}`, `module/{name}/symbols` (alimentent les onglets Docs + API de Studio).

## Gotchas

- `Router.routes` est **statique** : `removeRoutes()` impacte tout le process.
- `Route.match()` exige un objet `URL` (pas une string).
- Variables de route en `{var}` → capture `([^/]+)` ancrée : `module/{name}` ne masque pas `module/{name}/docs` (compte de segments distinct).

## Voir aussi

- `MEMORY.md` — Resolver, décorateurs, AdminBroker, `any` restants.
- `@nodefony/http` — Context/Request/Response (dépendance bas niveau).
- `@nodefony/studio` — consommateur du data plane admin.
