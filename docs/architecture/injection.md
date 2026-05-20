---
module: "@nodefony/core"
topic: dependency-injection
audience: [human, ai]
tags: [di, injection, decorators, injectable, inject, scopes, ioc]
status: draft
last-updated: 2026-05-20
---

# Dependency Injection — `@injectable`, `@inject`

> Système d'injection de dépendances décorateur-driven de Nodefony. Stocke les métadonnées via `Reflect.metadata`, résout au boot via le Container DI hiérarchique. Inspiré de NestJS (decorators) + Symfony (services.yaml mental model).

## Vue d'ensemble

```
   [Source TS avec décorateurs]
        │
        │ tsc + reflect-metadata
        ▼
   [Code compilé + métadonnées attachées]
        │
        │ Kernel.boot()
        ▼
   [Injector — résolution graphe]
        │
        ├─→ Détection cycles (Phase C — à venir)
        ├─→ Tri topologique
        └─→ Instanciation dans le Container
              │
              ▼
        Application prête
```

## Décorateurs disponibles

### `@injectable(options?)`

Marque une classe comme service injectable.

```typescript
import { injectable } from "nodefony";

@injectable({ singleton: true })
export class UserService {
  constructor(private db: Database, private syslog: Syslog) {}
}
```

| Option | Type | Défaut | Effet |
|--------|------|--------|-------|
| `singleton` | `boolean` | `true` | 1 instance partagée vs nouvelle par injection |
| `name` | `string` | nom de classe | Identifiant dans le Container |
| `scope` | `string` | `"global"` | `"global"` / `"request"` / custom |

### `@inject(name)`

Injecte une dépendance par nom depuis le Container.

```typescript
import { injectable, inject } from "nodefony";

@injectable()
export class OrderService {
  constructor(
    @inject("user-service") private users: UserService,
    @inject("database")     private db: Database,
  ) {}
}
```

### `@Inject` (property — Phase A, partiellement implémentée)

```typescript
@injectable()
export class ReportService {
  @Inject("database") private db!: Database;
  @Inject("syslog")   private log!: Syslog;
}
```

Plus concis mais nécessite `!` (definite assignment) et un init post-construct dans le Container.

## Pattern de découverte au boot

```typescript
// 1. Application déclare ses services injectables
@injectable()
class FooService { /* ... */ }

@injectable()
class BarService {
  constructor(@inject("foo") private foo: FooService) {}
}

// 2. Module déclare les services
@Service()
@injectable({ scope: "module" })
export class MyModule extends Module {
  static services = [FooService, BarService];
}

// 3. Kernel boot
//    → @modules() declare MyModule
//    → Injector lit Reflect.metadata sur FooService, BarService
//    → Calcule graphe dépendances
//    → Instancie dans l'ordre topologique (Foo avant Bar)
//    → Container.set("foo", fooInstance), Container.set("bar", barInstance)
```

## Scopes

| Scope | Lifecycle | Use case |
|-------|-----------|----------|
| `global` | Vie du kernel | Service singleton (database, logger, security) |
| `request` | Par requête HTTP/WS | Resolver, session, contexte courant |
| `transient` | Nouvelle instance à chaque injection | Cas rare — DTOs paramétrés, etc. |

**Container hiérarchique** : à chaque requête, `container.enterScope("request")` crée un sous-container héritant du parent (chaîne de prototypes JS). Les services request-scope vivent dans ce sous-container, libérés via `container.leaveScope(scope)` à la fin de la requête.

Voir [`container.md`](./container.md) pour les internals des scopes.

## Plan d'implémentation — 5 phases

Cf [`INJECTION_PLAN.md`](../../src/nodefony/INJECTION_PLAN.md) workspace core pour le détail.

| Phase | Sujet | État |
|-------|-------|------|
| **A** | `@Inject` propriété (vs constructor) | 🔶 Partial |
| **B** | Scoped via `AsyncLocalStorage` officiel | ⬜ Planned |
| **C** | Circular detection + erreur explicite au boot | ⬜ Planned |
| **D** | Registry par module (isolation) | ⬜ Planned |
| **E** | Lazy injection (Promise-wrapped) | ⬜ Planned |

## Pattern factoriel — `@injectable({ factory })`

Pour les services dont l'instanciation nécessite des opérations async (connexion DB, lecture config externe) :

```typescript
// TODO: vérifier — pattern factory à confirmer dans l'implémentation actuelle
@injectable({
  factory: async (container: Container) => {
    const config = await loadFromVault();
    return new Database(config);
  },
})
export class Database { /* ... */ }
```

## Résolution — comment ça marche

```
1. Métadonnées TS — Reflect.metadata
   @injectable                       → "design:paramtypes" sur classe
   @inject("name") constructor param → "inject:name:<paramIndex>"

2. Injector scan toutes les classes décorées
   → buildDependencyGraph()

3. Tri topologique
   → throw si cycle (Phase C)

4. Instanciation séquentielle
   → pour chaque classe :
      - lire paramTypes
      - résoudre les @inject(name) via Container.get()
      - new Klass(...resolvedArgs)
      - Container.set(klass.name OR options.name, instance)
```

## Tests existants

Cf `src/packages/@nodefony/framework/tests/` et `src/nodefony/src/tests/`.

```bash
cd src/nodefony
npm run test 2>&1 | grep -A 5 "injectable\|inject\|injector"
```

## ⚠️ Gotchas connus

| Symptôme | Cause | Fix |
|----------|-------|-----|
| `Cannot read 'X' of undefined` au boot | Cycle de dépendance non détecté | Phase C à venir — pour l'instant, désaccoupler manuellement |
| `Service not found in container` | `@injectable` oublié ou nom incorrect | Vérifier la métadonnée + Container.has() au boot |
| `@inject('foo')` reçoit `null` | Service `foo` pas encore instancié | Vérifier l'ordre topologique — Phase C aidera |
| Service request-scope tiré dans singleton | Inter-scope dependency cassée | Container hiérarchique remonte au parent — vérifier que le scope est bien ouvert |
| Property injection non assignée | Phase A partielle | Utiliser constructor injection pour l'instant |

## Pattern type — service avec dépendances

```typescript
import { injectable, inject } from "nodefony";
import type Database from "./Database";
import type Syslog from "./Syslog";

@injectable({ singleton: true, name: "user-service" })
export class UserService {
  constructor(
    @inject("database") private db: Database,
    @inject("syslog")   private log: Syslog,
  ) {}

  async findByEmail(email: string): Promise<User | null> {
    this.log.log(`Lookup user ${email}`, "DEBUG");
    return await this.db.query<User>("SELECT * FROM users WHERE email = ?", [email]);
  }
}
```

Au boot, `Container.get<UserService>("user-service")` retourne l'instance prête à l'emploi avec ses dépendances injectées.

## Liens

- **Code source** : `src/nodefony/src/kernel/injector/`
- **MEMORY.md** : `src/nodefony/src/kernel/injector/MEMORY.md`
- **README.md** : `src/nodefony/src/kernel/injector/README.md`
- **Plan** : `src/nodefony/INJECTION_PLAN.md`
- **Container** (sur lequel s'appuie l'injector) : [`container.md`](./container.md)
- **Kernel** (qui démarre l'injector au boot) : [`kernel.md`](./kernel.md)
- **Décisions futures** : `project_injection_plan.md` (mémoire IA)
- **Graphe symbolique** : `jq '.symbols.injectable' .ai/symbols.json`
