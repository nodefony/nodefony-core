# INJECTION_PLAN.md — Plan d'amélioration du système DI

> État actuel : `injector.ts` + `kernelDecorator.ts` — branche `claude-ts`.
> Ce document est un plan de travail pour les sessions futures.

---

## État actuel ✅ (implémenté)

| Feature | Fichier | Statut |
|---|---|---|
| `@injectable(name?)` | `kernelDecorator.ts` | ✅ |
| `@injectable({ name?, scope? })` | `kernelDecorator.ts` | ✅ |
| `@inject("name")` parameter decorator | `kernelDecorator.ts` | ✅ |
| Auto-injection via `design:paramtypes` | `injector.ts` | ✅ |
| Scope `singleton` (défaut) | `injector.ts` | ✅ |
| Scope `transient` (toujours new) | `injector.ts` | ✅ |
| `Injector.getScope(name)` | `injector.ts` | ✅ |
| Résolution depuis container kernel | `injector.ts` | ✅ |
| `@modules / @services / @entities` | `kernelDecorator.ts` | ✅ |

---

## Phase A — Property Injection (priorité haute)

### Objectif

Permettre l'injection sur les propriétés d'une classe, pas seulement dans le constructeur.

```typescript
class MyController extends Service {
  @Inject("AuthService")
  private auth!: AuthService;   // injecté après construction

  @Inject()
  private logger!: Syslog;     // nom déduit du type
}
```

### Implémentation

1. Nouveau decorator `@Inject(name?)` (majuscule — distinct de `@inject` param).
2. Stocker en metadata : `Reflect.defineMetadata("inject:properties", [{key, name}], target)`.
3. Dans `Injector.instantiate` : après `Reflect.construct`, itérer les property metas et assigner.

```typescript
// kernelDecorator.ts
function Inject(name?: string): PropertyDecorator {
  return (target, propertyKey) => {
    const type = Reflect.getMetadata("design:type", target, propertyKey);
    const resolvedName = name || type?.name;
    if (!resolvedName) throw new Error(`@Inject requires a name on ${String(propertyKey)}`);
    const existing = Reflect.getMetadata("inject:properties", target) || [];
    existing.push({ key: propertyKey, name: resolvedName });
    Reflect.defineMetadata("inject:properties", existing, target);
  };
}
```

```typescript
// injector.ts — après Reflect.construct(constructor, resolvedArgs)
const propMetas: Array<{ key: string; name: string }> =
  Reflect.getMetadata("inject:properties", constructor.prototype) || [];
for (const { key, name } of propMetas) {
  instance[key] = Injector._resolve(name, []);
}
```

### Gotchas
- `design:type` nécessite `emitDecoratorMetadata: true` (OK en prod rollup, pas en tests tsx).
- Les champs `!` (definite assignment) ne posent pas problème — on assigne post-construction.
- Circular : A injecte B via property, B injecte A → stack overflow. Besoin d'un cycle guard (Phase C).

---

## Phase B — Scope `scoped` (request-scoped)

### Objectif

Une instance par scope (ex : une par requête HTTP), pas par kernel.

```typescript
@injectable({ scope: "scoped" })
class RequestContext extends Service {}
```

### Implémentation

1. Ajouter `"scoped"` à `DIScope`.
2. `_resolve` avec scope scoped : cherche dans le scope actif (Container.Scope), sinon crée et enregistre.
3. Le scope actif doit être passé via un contexte (thread-local via `AsyncLocalStorage`).

```typescript
// AsyncLocalStorage pour le scope courant
import { AsyncLocalStorage } from "node:async_hooks";
const scopeStorage = new AsyncLocalStorage<Container>();

// Dans le handler HTTP :
const scope = kernel.container.enterScope("request");
scopeStorage.run(scope, () => handleRequest(req, res));
```

```typescript
// Dans _resolve :
if (scope === "scoped") {
  const currentScope = scopeStorage.getStore();
  if (!currentScope) return Injector.instantiate(Ctor, ...argsClass); // fallback transient
  const existing = currentScope.get(serviceName);
  if (existing) return existing;
  const inst = Injector.instantiate(Ctor, ...argsClass);
  currentScope.set(serviceName, inst);
  return inst;
}
```

### Gotchas
- `AsyncLocalStorage` disponible depuis Node.js 16.4 — OK pour notre target.
- Pas de scope storage → comportement transient (safe fallback).
- Nécessite `kernel.container.enterScope("request")` dans le handler HTTP.

---

## Phase C — Détection de dépendances circulaires

### Objectif

Lever une erreur claire plutôt qu'un stack overflow silencieux.

```
Error: Circular dependency detected: A → B → A
```

### Implémentation

Stack de résolution dans `instantiate` :

```typescript
const resolutionStack: string[] = [];

static instantiate(Ctor, ...args) {
  const name = Ctor.name;
  if (resolutionStack.includes(name)) {
    throw new Error(
      `Circular dependency: ${[...resolutionStack, name].join(" → ")}`
    );
  }
  resolutionStack.push(name);
  try {
    // ... logique actuelle ...
    return instance;
  } finally {
    resolutionStack.pop();
  }
}
```

### Gotchas
- Stack must be per-call-tree, not global (async safe via closure ou AsyncLocalStorage).
- Les singletons déjà résolus ne déclenchent pas de circular (kernel.get() retourne l'instance).

---

## Phase D — Registry par module (isolation)

### Objectif

Éviter les collisions de noms entre modules. Chaque module a son propre registre.

```typescript
// Aujourd'hui — global
Injector.register("MyService", MyService); // collision si deux modules ont "MyService"

// Demain — par module
@injectable({ scope: "singleton", module: "my-module" })
class MyService extends Service {}
```

### Implémentation

Remplacer `injectables: Record<string, Ctor>` par `Record<string, Record<string, Ctor>>` :

```typescript
const injectables: Record<string, Record<string, ServiceConstructor>> = {
  global: {},
};

static register(name, Ctor, module = "global") {
  if (!injectables[module]) injectables[module] = {};
  injectables[module][name] = Ctor;
}

static get(name, module = "global") {
  return injectables[module]?.[name] ?? injectables["global"][name];
}
```

### Gotchas
- Rétro-incompatible sur `Injector.injectables` (accès direct dans les tests). Migrer.
- `module` context doit être propagé à `_resolve` → signature change.
- À faire APRÈS Phase A et B — impact architectural élevé.

---

## Phase E — Lazy injection (optionnelle, priorité basse)

### Objectif

Injecter un provider plutôt qu'une instance — l'instance est créée à la première utilisation.

```typescript
class MyService extends Service {
  @InjectLazy("HeavyService")
  private heavy!: () => HeavyService;  // factory

  doWork() {
    this.heavy().compute(); // HeavyService créé ici, pas au boot
  }
}
```

Utile pour les services coûteux (connexions DB, clients HTTP) qui ne sont pas toujours utilisés.

---

## Ordre recommandé des phases

```
Phase A — Property Injection   → 1 session, impact pratique immédiat
Phase C — Circular detection   → 0.5 session, debuggabilité
Phase B — Scoped lifetime      → 1.5 sessions, dépend du handler HTTP (Phase 4)
Phase D — Registry par module  → 2 sessions, après Phase B
Phase E — Lazy injection       → optionnel, après Phase D
```

---

## Décisions techniques figées

- `DIScope = "singleton" | "transient" | "scoped"` — pas d'autres scopes.
- Pas de XML/JSON config — tout par decorators TypeScript.
- `Injector` reste statique + une instance kernel — pas de conteneur d'injection dédié.
- Property injection via `@Inject` (majuscule) distinct de `@inject` param (minuscule).
