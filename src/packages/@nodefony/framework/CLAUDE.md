# CLAUDE.md — @nodefony/framework

## Docs liées

- [`MEMORY.md`](./MEMORY.md) — internals IA (Resolver pipeline, decorators NestJS, gotchas)
- [`../http/CLAUDE.md`](../http/CLAUDE.md) — module fournissant Context / Request / Response (dépendance bas-niveau)
- [`../../../modules/test/CLAUDE.md`](../../../modules/test/CLAUDE.md) — controllers d'intégration consommant les décorateurs
- [`../../../../CLAUDE.md`](../../../../CLAUDE.md) — règles globales projet
- Core : [`../../../nodefony/MEMORY.md`](../../../nodefony/MEMORY.md) (Service) | [`../../../nodefony/src/kernel/injector/MEMORY.md`](../../../nodefony/src/kernel/injector/MEMORY.md) — DI (Injector + decorators)

## Rôle

Routeur HTTP+WS + Controller de base + décorateurs `@route`/`@controller`/`@controllers` + moteur de vues **Eta** (unique — remplace Twig/EJS, retirés).

---

## Structure

```
nodefony/
├── config/config.ts
├── decorators/routerDecorators.ts   ← @route, @controller, @controllers
├── service/
│   ├── router.ts                    ← Router extends Service (routes[] statique)
│   ├── AdminBroker.ts               ← IAdminApi → routes admin (data plane Studio)
│   ├── IdempotencyStore.ts          ← store idempotence (registre + driver)
│   └── Eta.ts                       ← moteur de vues unique (remplace Twig/EJS)
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
  → Resolver.match(route, ctx)       // trouve la route (pose sessionIntent, bypassFirewall…)
  ── HTTP : CSRF → session → firewall (côté HttpKernel) ──
  → Resolver.callController(data)
      → _enforceSecurity(@IsGranted) // 403 AVANT toute instanciation
      → Resolver.newController()     // Injector.instantiate(ControllerCtor, ctx)
      → controller.initialize()      // constructeur ASYNC, hook optionnel
      → action(...args)
  → Resolver.returnController(res)   // normalise la réponse
```

> **En WS, `newController()` + `initialize()` ont lieu plus tôt** (au handshake, avant `connect()`
> donc avant le firewall) : le controller porte le protocole négocié et c'est la dernière fenêtre
> pour toucher la réponse de handshake. Cf `../http/CLAUDE.md` § Pipeline.

### Enregistrement des routes (décorateurs)

```
@route("name", opts)         → Reflect.defineMetadata sur le constructeur
@controller("/prefix")       → lit metadata → Router.createRoute() pour chaque @route
@controllers([MyCtrl])       → hook onBoot → Router.setController(cls, module)
```

**Ordre** : `@route` est évalué avant `@controller` (décorateurs bottom-up en TS).

---

## Décisions figées

| Sujet          | Décision                                                                |
| -------------- | ----------------------------------------------------------------------- |
| Routes storage | `const routes: Route[]` module-level statique — une seule liste globale |
| Moteur de vues | **Eta** (unique — remplace Twig/EJS, retirés)                           |
| DI             | `Injector.instantiate()` — jamais `new Controller()` direct             |
| Decorators     | `reflect-metadata` — `experimentalDecorators: true` requis              |

---

## Gotchas

- **`Router.routes` est statique** : `removeRoutes()` affecte toutes les instances dans le process.
- **`Route.match()` nécessite `URL` object** — pas de string pour `context.request.url`.
- **`@controllers` s'enregistre sur `onBoot`** — controllers absents avant le boot kernel.
- **`forward("mod:ctrl:action")`** — format 3 parties séparées par `:`.
- **`Resolver.returnController()` unwrap tout thenable via `isPromise` (duck-type `.then`)** — Promise natif, ex-Bluebird userland, Q… sans dépendance dédiée (bluebird retiré).

---

## Points de structure à connaître

<!-- prettier-ignore -->
| Aspect | Fait |
| --- | --- |
| Types exports | `exports.types` → `./index.ts` (la **source**, comme http/frontend) : évite la race TS2307 quand http type-check framework avant son build. Top-level `types` reste `dist/types/`. **Casser ce maillon casse les consommateurs.** |
| Interfaces | `IController`/`IRoute`/`IResolver`/`IAdminBroker` (`nodefony/interfaces/`) |
| Admin data plane | `IAdminApi`/`AdminBroker`/`AdminApiController` + les producteurs kernel/http/framework/syslog — cf MEMORY.md |
| `any` | **0 `any` de dette** — tous ceux qui restent sont la signature IMPOSÉE par TypeScript, sous **deux formes seulement**. (1) Le **type de constructeur** générique : `Constructor`, `TypeController`, `ControllerConstructor`, plus le `constructor(...args)` du mixin `@controllers` — un `unknown[]` casse l'assignabilité des classes concrètes et l'`extends constructor` du mixin. (2) Le **décorateur DUAL classe+méthode** (`@Domain`, `@BypassFirewall`, `@UseSession`, `@IsGranted`, `@Anonymous`…), deux par décorateur (`target` + retour) : `target` est le constructeur OU le prototype selon le site, et un type concret casse l'assignabilité à `ClassDecorator`/`MethodDecorator`. `routerDecorators.ts` porte une dérogation lint de FICHIER (le motif y nomme ces deux formes) ; les autres sites portent une directive par ligne. **Un `any` d'une TROISIÈME forme est de la dette** — le compte exact se demande à l'outil (`npx oxlint <chemin> \| grep no-explicit-any`), jamais à ce tableau. |

---

## Ce qu'il ne faut JAMAIS faire sans accord

- Modifier `rolldown.config.ts` ou `tsconfig.json`
- Changer la structure `routes[]` statique (casse tous les controllers enregistrés)
- Supprimer `reflect-metadata` (casse tous les décorateurs)
