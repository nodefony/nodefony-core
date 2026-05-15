# CLAUDE.md — @nodefony/framework

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

| Sujet              | Décision                                                                |
| ------------------ | ----------------------------------------------------------------------- |
| Routes storage     | `const routes: Route[]` module-level statique — une seule liste globale |
| Template engines   | Twig (twig@1) + EJS (ejs@3) — jamais remplacer sans accord              |
| DI                 | `Injector.instantiate()` — jamais `new Controller()` direct             |
| Decorators         | `reflect-metadata` — `experimentalDecorators: true` requis              |

---

## Gotchas

- **`Router.routes` est statique** : `removeRoutes()` affecte toutes les instances dans le process.
- **`Route.match()` nécessite `URL` object** — pas de string pour `context.request.url`.
- **`@controllers` s'enregistre sur `onBoot`** — controllers absents avant le boot kernel.
- **`forward("mod:ctrl:action")`** — format 3 parties séparées par `:`.
- **`bluebird` dans `Resolver.returnController()`** — dépendance legacy, ne pas supprimer.

---

## État actuel

| Aspect         | État                        |
| -------------- | --------------------------- |
| Types exports  | ✅ `dist/types/` + `exports` |
| Interfaces     | ❌ aucune (`nodefony/interfaces/` absent) |
| Tests          | ❌ zéro tests                |
| `any` restants | 4 emplacements (voir MEMORY.md) |

---

## Ce qu'il ne faut JAMAIS faire sans accord

- Modifier `rollup.config.ts` ou `tsconfig.json`
- Changer la structure `routes[]` statique (casse tous les controllers enregistrés)
- Remplacer `bluebird` dans `Resolver` sans tester les controllers userland
- Supprimer `reflect-metadata` (casse tous les décorateurs)
