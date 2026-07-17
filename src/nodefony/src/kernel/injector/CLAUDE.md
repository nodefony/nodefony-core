# CLAUDE.md — Injector (DI Decorators)

> Sous-module `src/nodefony/src/kernel/injector/` du workspace `@nodefony/core`.
> Pour audience IA en cours de session. Complète [`MEMORY.md`](./MEMORY.md) et [`README.md`](./README.md).

## Rôle

Système d'injection de dépendances décorateur-driven de Nodefony. Stocke les métadonnées via `Reflect.metadata`, résout au boot. Inspiré de NestJS (decorators TS) + Symfony (services.yaml mental model).

## Décorateurs

### Constructor parameter

```typescript
import { injectable, inject } from "nodefony";

@injectable("user-service") // ⚠️ `singleton: true` N'EXISTE PAS (ignoré) — options = { name?, scope? }
export class UserService {
  constructor(
    @inject("database") private db: Database,
    @inject("syslog") private log: Syslog,
  ) {}
}
```

### Property (Phase A — partielle)

```typescript
@injectable()
export class ReportService {
  @Inject("database") private db!: Database; // ! definite assignment
  @Inject("syslog") private log!: Syslog;
}
```

⚠️ Phase A en cours — confirmer comportement actuel avant usage en prod.

### Module-level (auto-discovery)

```typescript
import { services, entities } from "nodefony";

// Chargement de MODULES : plus de @modules (RETIRÉ 2026-06-03). La liste vit dans
// config.modules (manifeste ordonné), orchestrée par le Kernel à onPreRegister.
// Cf mémoire IA project_module_loading_architecture.

@services([UserService, DatabaseService]) // → onPreBoot
class MyModule extends Module {}

@entities([UserEntity, OrderEntity]) // → onBoot
class MyOrmModule extends Module {}
```

## Métadonnées stockées (`Reflect.metadata`)

| Clé                 | Cible               | Posée par                 | Contenu                        |
| ------------------- | ------------------- | ------------------------- | ------------------------------ |
| `inject:services`   | Constructeur classe | `@inject(name)` paramètre | `[{ index, name }]`            |
| `inject:properties` | Prototype classe    | `@Inject(name)` propriété | `{ key: name }`                |
| `di:scope`          | Classe              | `@injectable(opts)`       | `"singleton"` \| `"transient"` |

⚠️ **CRITIQUE** : `inject:services` sur le **constructeur**, `inject:properties` sur le **prototype**. Confondre = bug silencieux (résolution échoue, classe instanciée avec `undefined`).

## Résolution au boot

```
1. Kernel boot → décorateurs lifecycle (@services, @entities) firent les hooks
   correspondants (onPreBoot, onBoot) ; les MODULES sont chargés depuis
   config.modules par le Kernel à onPreRegister (manifeste, plus de @modules)

2. Injector.instantiate(Ctor, parent, ...args)
   ├── _instantiateWithStack(Ctor, [], args)
   │   ├── Détecte circular dans `stack` (Phase C ✅)
   │   ├── Si singleton + déjà dans Container → court-circuit
   │   ├── Lire Reflect.metadata("inject:services", Ctor)
   │   ├── Pour chaque param @inject : récupérer du container
   │   ├── new Ctor(...resolvedArgs, ...args)
   │   ├── Property injection (Phase A) : lire metadata sur prototype, set props
   │   └── Si .initialize() existe : appeler
   └── Container.set(name, instance)

3. Phase D (futur) : registry par module — isolation namespace
```

## Stack par valeur — async-safe

```typescript
_instantiateWithStack(Ctor, stack, args) {
  const name = Ctor.name;
  if (stack.includes(name)) throw new Error(`Circular: ${[...stack, name].join(" → ")}`);
  // ...
  return _instantiateWithStack(NestedCtor, [...stack, name], args);  // ← spread, pas push
}
```

Spread `[...stack, name]` (pas mutation) → safe pour async parallel resolution.

## Singleton — résolution par la CLASSE

Scope `"singleton"` (défaut) : le nom écrit dans `@inject` retrouve la **CLASSE**, et c'est elle qui
dit où l'instance vit — `containerKeyOf(Ctor) ?? nom` → `kernel.get(clé)`. Absent du container →
instancié **sans argument**, mémoïsé sous sa clé **canonique** (`instance.name`), et la clé est
apprise pour la suite.

⚠️ **Deux annuaires** : `@injectable(nom)` indexe des CLASSES, `super(nom, …)` indexe des INSTANCES
— le décorateur ne peut pas connaître la seconde (chargement vs construction). D'où l'apprentissage
dans `addService` (`rememberContainerKey`). Sans lui, `@inject("Router")` cherchait `"Router"` dans
un container qui ne connaît que `"router"` → service reconstruit, cache vide, en silence.

## tsx — pas de `design:paramtypes`

⚠️ Quand on tourne avec `tsx` (ts-node alternative), TypeScript émet PAS `design:paramtypes` (metadata auto sur types des params). Donc le pattern habituel `@inject()` sans nom (auto-discovery par type) NE MARCHE PAS sous tsx.

**Workaround** : toujours passer le nom explicite :

```typescript
constructor(@inject("database") db: Database) {}    // ✅ marche partout
constructor(@inject() db: Database) {}              // ❌ ne marche pas sous tsx
```

C'est un appel fonctionnel `(inject("X") as Function)(Cls, undefined, 0)` côté injector pour contourner.

## Decorators module — pattern `prependOnceListener`

```typescript
// Module.setEvents() ordre des listeners :
//   index 0 (prepend) : decorator @services/@entities handler
//   index 1+          : hooks user (onKernelRegister, onKernelBoot, onKernelReady)
```

→ Les decorators tournent AVANT les hooks user (ordre déterministe).

## Catches d'erreur par décorateur

| Décorateur  | Phase     | Erreur catch ?        | Note                                            |
| ----------- | --------- | --------------------- | ----------------------------------------------- |
| `@services` | onPreBoot | ✅ Catché + log ERROR | Service brisé → service skip mais boot continue |
| `@entities` | onBoot    | ✅ Catché + log ERROR | Idem                                            |

→ Conséquence : si un service crash dans `@services`, le boot continue mais le service est absent du container. Détection via `container.has("foo")` après boot, ou via les logs ERROR au démarrage.

## Plan d'évolution — 5 phases

Cf [`../../INJECTION_PLAN.md`](../../INJECTION_PLAN.md) workspace racine pour détail.

| Phase | Sujet                                 | État                     |
| ----- | ------------------------------------- | ------------------------ |
| **A** | `@Inject` property                    | ✅ partial (à confirmer) |
| **C** | Circular detection (stack-based)      | ✅ done                  |
| **B** | Scoped via AsyncLocalStorage officiel | ⬜ Planned               |
| **D** | Registry par module (namespace)       | ⬜ Planned               |
| **E** | Lazy injection (Promise-wrapped)      | ⬜ Planned               |

## Options `@injectable`

| Option      | Type      | Défaut                      | Effet                                    |
| ----------- | --------- | --------------------------- | ---------------------------------------- |
| `singleton` | `boolean` | `true`                      | 1 instance partagée OR new par injection |
| `name`      | `string`  | nom de classe (lowercase ?) | Identifiant Container                    |
| `scope`     | `string`  | `"global"`                  | `"global"` / `"request"` / `"transient"` |

⚠️ **TODO: vérifier** le naming exact (camelCase ? kebab-case ?) et le default pour `scope` dans le code actuel.

## ⚠️ Gotchas

| Symptôme                               | Cause                                               | Fix                                              |
| -------------------------------------- | --------------------------------------------------- | ------------------------------------------------ |
| `Service not found in container`       | `@injectable` oublié OR nom incorrect               | Vérifier metadata + Container.has()              |
| `Cannot read 'X' of undefined` au boot | Cycle non détecté (avant Phase C)                   | Avec Phase C → erreur explicite avec stack       |
| `@inject()` sans nom ne marche pas     | Sous tsx — pas de `design:paramtypes`               | Toujours passer le nom explicite                 |
| Property `@Inject` reste `undefined`   | Phase A partielle, init post-construct pas appliqué | Utiliser constructor injection pour l'instant    |
| Service tiré dans le mauvais scope     | Container hiérarchique remonte au parent            | Vérifier que le scope est ouvert avant injection |
| @services silencieux                   | Erreur catchée dans Module.setEvents                | Lire les logs ERROR au boot                      |
| Decorator handler appelé 2×            | `setEvents()` appelé 2×                             | Guard `eventsRegistered` ajouté 2026-05-14       |

## Pattern type — service avec dépendances

```typescript
import { injectable, inject } from "nodefony";

@injectable("user-service") // ⚠️ `singleton: true` N'EXISTE PAS (ignoré) — options = { name?, scope? }
export class UserService {
  constructor(
    @inject("database") private db: Database,
    @inject("syslog") private log: Syslog,
  ) {}

  async findById(id: string): Promise<User | null> {
    this.log.log(`Lookup user ${id}`, "DEBUG");
    return await this.db.query<User>("SELECT * FROM users WHERE id = ?", [id]);
  }
}

// Module qui déclare :
@services([UserService])
export class MyModule extends Module {
  static readonly path: string = import.meta.url;
}

// Usage runtime :
const userService = kernel.get<UserService>("user-service");
await userService.findById("123");
```

## Tests

```bash
cd src/nodefony && npm run test 2>&1 | grep -A 3 "injectable\|inject\|injector"
```

Tests existants couvrent : property injection, circular detection, singleton, scopes. Mais Phase B/D/E à venir → tests futurs aussi.

## Liens

- [`MEMORY.md`](./MEMORY.md) — internals IA détaillés
- [`README.md`](./README.md) — doc humaine
- [`../CLAUDE.md`](../CLAUDE.md) — Kernel/Module
- [`../../INJECTION_PLAN.md`](../../INJECTION_PLAN.md) — plan 5 phases
- [`../../../CLAUDE.md`](../../../CLAUDE.md) — workspace core
- [`../../../docs/injection.md`](../../../docs/injection.md) — vision architecturale (relocalisé `src/nodefony/docs/`, ADR-0001)
- `project_injection_plan` (mémoire IA) — plan détaillé
