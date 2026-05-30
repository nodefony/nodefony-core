# CLAUDE.md — @nodefony/framework

## Docs liées

- [`MEMORY.md`](./MEMORY.md) — internals IA (Resolver pipeline, decorators NestJS, gotchas)
- [`../http/CLAUDE.md`](../http/CLAUDE.md) — module fournissant Context / Request / Response (dépendance bas-niveau)
- [`../../../modules/test/CLAUDE.md`](../../../modules/test/CLAUDE.md) — controllers d'intégration consommant les décorateurs
- [`../../../../CLAUDE.md`](../../../../CLAUDE.md) — règles globales projet
- Core : [`../../../nodefony/MEMORY.md`](../../../nodefony/MEMORY.md) (Service) | [`../../../nodefony/src/kernel/injector/MEMORY.md`](../../../nodefony/src/kernel/injector/MEMORY.md) — DI (Injector + decorators)

## Rôle

Routeur HTTP+WS + Controller de base + décorateurs `@route`/`@controller`/`@controllers` + templates Twig/EJS.

---

## Structure

```
nodefony/
├── config/config.ts
├── decorators/routerDecorators.ts   ← @route, @controller, @controllers
├── service/
│   ├── router.ts                    ← Router extends Service (routes[] statique)
│   ├── Twig.ts
│   └── Ejs.ts
└── src/
    ├── Controller.ts                ← classe de base controllers userland
    ├── Resolver.ts                  ← instancie + appelle le controller
    └── Route.ts                     ← définition + compilation + matching
```

---

## Architecture clé

### Pipeline Controller

```
Router.resolve(ctx)
  → Resolver.match(route, ctx)       // trouve la route
  → Resolver.newController()         // Injector.instantiate(ControllerCtor, ctx)
  → controller.initialize()          // hook optionnel (async)
  → Resolver.callController(data)    // appelle l'action
  → Resolver.returnController(res)   // normalise la réponse
```

### Enregistrement des routes (décorateurs)

```
@route("name", opts)         → Reflect.defineMetadata sur le constructeur
@controller("/prefix")       → lit metadata → Router.createRoute() pour chaque @route
@controllers([MyCtrl])       → hook onBoot → Router.setController(cls, module)
```

**Ordre** : `@route` est évalué avant `@controller` (décorateurs bottom-up en TS).

---

## Décisions figées

| Sujet            | Décision                                                                |
| ---------------- | ----------------------------------------------------------------------- |
| Routes storage   | `const routes: Route[]` module-level statique — une seule liste globale |
| Template engines | Twig (twig@1) + EJS (ejs@3) — jamais remplacer sans accord              |
| DI               | `Injector.instantiate()` — jamais `new Controller()` direct             |
| Decorators       | `reflect-metadata` — `experimentalDecorators: true` requis              |

---

## Gotchas

- **`Router.routes` est statique** : `removeRoutes()` affecte toutes les instances dans le process.
- **`Route.match()` nécessite `URL` object** — pas de string pour `context.request.url`.
- **`@controllers` s'enregistre sur `onBoot`** — controllers absents avant le boot kernel.
- **`forward("mod:ctrl:action")`** — format 3 parties séparées par `:`.
- **`bluebird` dans `Resolver.returnController()`** — dépendance legacy, ne pas supprimer.

---

## État actuel

| Aspect           | État                                                                                                                                                                                                                                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Types exports    | ✅ `exports.types` → `./index.ts` (source, comme http/frontend) — évite la race TS2307 quand http type-check framework avant son build. Top-level `types` reste `dist/types/`.                                                                                                                                    |
| Interfaces       | ✅ `IController`/`IRoute`/`IResolver`/`IAdminBroker` (`nodefony/interfaces/`)                                                                                                                                                                                                                                     |
| Tests            | ✅ 118 vitest (6 fichiers), 0 failing (2026-05-30)                                                                                                                                                                                                                                                                |
| Admin data plane | ✅ `IAdminApi`/`AdminBroker`/`AdminApiController` + producteurs kernel/http/framework/syslog (P10.2/P10.3) — cf MEMORY.md                                                                                                                                                                                         |
| `any` restants   | ✅ F1 fait (2026-05-30) : 0 `any` de dette. 6 `any` idiomatiques **documentés inline** : 3 signatures de constructeur mixin/DI (`Constructor`, `TypeController`, `ControllerConstructor`), le `constructor(...args)` du mixin `@controllers`, et le décorateur **dual** classe+méthode `@Domain` (target+retour). |

---

## Ce qu'il ne faut JAMAIS faire sans accord

- Modifier `rollup.config.ts` ou `tsconfig.json`
- Changer la structure `routes[]` statique (casse tous les controllers enregistrés)
- Remplacer `bluebird` dans `Resolver` sans tester les controllers userland
- Supprimer `reflect-metadata` (casse tous les décorateurs)
