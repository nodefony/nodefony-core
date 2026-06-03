# MEMORY.md — Injector + Decorators DI

> IA uniquement — ultra-concis. Voir README.md pour exemples humains.

## Docs liées

- [`../MEMORY.md`](../MEMORY.md) — Kernel/Module (utilise Injector pour `addService`/`addModule`)
- [`../../../MEMORY.md`](../../../MEMORY.md) — workspace core (Container/Service)
- Consommateur : [`../../../../packages/@nodefony/framework/MEMORY.md`](../../../../packages/@nodefony/framework/MEMORY.md) — `Resolver.newController()` utilise `Injector.instantiate()`
- [`../../../../../CLAUDE.md`](../../../../../CLAUDE.md) — règles projet

---

## Fichiers

| Fichier                                | Rôle                                                                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `injector/injector.ts`                 | Moteur DI — registre, résolution, circular detection                                                                         |
| `kernel/decorators/kernelDecorator.ts` | Decorators — `@injectable`, `@inject`, `@Inject`, `@services`, `@entities` (`@modules` RETIRÉ 2026-06-03 → `config.modules`) |

---

## Registre statique

```
injectables: Record<string, ServiceConstructor>   ← module-level, partagé
Injector.injectables                              ← même référence (accès direct OK)
Injector.register(name, Ctor)                     ← throw si name vide ou Ctor null
Injector.isRegistered(name)                       ← O(1), `name in injectables`
Injector.get(name)                                ← throw "not found or not injectable" si absent
Injector.getScope(name)                           ← lit "di:scope" metadata | défaut "singleton"
Injector.inject(Ctor, ...args)                    ← alias instantiate
```

---

## DIScope

```
"singleton"  défaut — réutilise kernel.get(name) si présent, sinon new
"transient"  toujours new — ignore container kernel
```

Stocké : `Reflect.defineMetadata("di:scope", scope, Ctor)` par `@injectable`.

---

## Metadata keys (Reflect)

| Clé                   | Cible                            | Contenu                                       | Posé par                             |
| --------------------- | -------------------------------- | --------------------------------------------- | ------------------------------------ |
| `"inject:services"`   | constructeur (class-level)       | `(string\|undefined)[]` sparse par paramIndex | `@inject`                            |
| `"inject:properties"` | **prototype** (pas constructeur) | `PropertyInjectMeta[]`                        | `@Inject`                            |
| `"design:paramtypes"` | constructeur                     | `unknown[]` types TS                          | TypeScript (`emitDecoratorMetadata`) |
| `"di:scope"`          | constructeur                     | `DIScope`                                     | `@injectable`                        |

`PropertyInjectMeta = { key: string | symbol; name: string }`

---

## Algorithme `instantiate(Ctor, ...argsClass)`

```
→ _instantiateWithStack(Ctor, [], argsClass)
    si Ctor.name in stack → throw "Circular dependency detected: A → B → A"
    nextStack = [...stack, Ctor.name]           ← copie par valeur, async-safe

    injectExplicit = Reflect.getMetadata("inject:services", Ctor) || []
    paramTypes     = Reflect.getMetadata("design:paramtypes", Ctor) || []

    si aucune metadata → Reflect.construct(Ctor, argsClass)  ← backward compat
    sinon pour i in 0..max(len(paramTypes), len(injectExplicit)):
      injectExplicit[i] → _resolveWithStack(name, argsClass, nextStack)  ← priorité
      paramTypes[i].name in injectables → _resolveWithStack(type, argsClass, nextStack)
      sinon → argsClass[explicitIdx++]
    append argsClass restants

    → Reflect.construct(Ctor, resolvedArgs)
    → _applyPropertyInjection(Ctor, instance, nextStack)
```

---

## `_resolveWithStack(name, argsClass, stack)`

```
isRegistered(name) ?
  scope === "transient" → _instantiateWithStack(Ctor, stack, argsClass)
  kernel && kernel.get(name) → retourne instance container  ← singleton court-circuit
  sinon → _instantiateWithStack(Ctor, stack, argsClass)
sinon:
  kernel.get(name) existe → retourne
  sinon → throw "not found or not injectable"
```

---

## `_applyPropertyInjection(Ctor, instance, stack)`

```
metas = Reflect.getMetadata("inject:properties", Ctor.prototype) || []
pour { key, name } in metas:
  (instance as Record<string,unknown>)[key] = _resolveWithStack(name, [], stack)
```

---

## Decorators

### `@injectable(nameOrOptions?)`

```typescript
@injectable()                          // name = Ctor.name, scope = "singleton"
@injectable("MonNom")                  // name explicite
@injectable({ name?, scope? })         // objet
```

→ `Injector.register(name, Ctor)` + `Reflect.defineMetadata("di:scope", scope, Ctor)`

### `@inject("name")` — paramètre constructeur (minuscule)

```typescript
constructor(@inject("AuthService") auth: AuthService) {}
// ou en test tsx :
(inject("AuthService") as Function)(MyClass, undefined, 0);
```

→ stocke sur **constructeur** (class-level, pas propertyKey) :
`inject:services[paramIndex] = "name"`

### `@Inject("name")` — propriété (MAJUSCULE)

```typescript
@Inject("AuthService") private auth!: AuthService;
// ou en test tsx :
(Inject("AuthService") as Function)(MyClass.prototype, "auth");
```

→ stocke sur **prototype** : `inject:properties.push({ key: "auth", name: "AuthService" })`
→ appliqué POST-construction (this.auth === undefined pendant super())

### `@services` / `@entities` — sur Module

> `@modules` RETIRÉ 2026-06-03 → chargement de modules via `config.modules` (manifeste,
> orchestré par le Kernel à `onPreRegister`). Cf `project_module_loading_architecture`.

```
@services(path|Ctor|array) → kernel.once("onPreBoot") → addService|loadService
@entities(path|Ctor|array) → kernel.once("onBoot")    → addEntity|loadEntity
```

---

## Résolution priorité

```
1. @inject explicite (inject:services[i])     ← priorité absolue
2. Auto-injection design:paramtypes[i]        ← si type enregistré
3. Arg explicite argsClass[explicitIdx++]     ← fallback
```

Property injection : toujours après construction, indépendante des paramètres.

---

## Circular detection

```
Stack : copie par valeur à chaque niveau → async-safe
Singleton déjà dans kernel.get() → court-circuit avant vérification → pas de faux positif
Throw : "Circular dependency detected: A → B → A"
```

---

## Patterns tests (tsx — pas d'emitDecoratorMetadata)

```typescript
// @inject sur paramètre — appel fonctionnel
(inject("ServiceName") as Function)(MyClass, undefined, 0);

// @Inject sur propriété — appel fonctionnel
(Inject("ServiceName") as Function)(MyClass.prototype, "propName");

// design:paramtypes manuel
Reflect.defineMetadata("design:paramtypes", [TypeA, TypeB], MyClass);

// Fake kernel pour _resolveWithStack
const orig = Nodefony.getKernel;
(Nodefony as any).getKernel = () => ({ get: (n: string) => myContainer.get(n) });
try { ... } finally { (Nodefony as any).getKernel = orig; }
```

---

## Gotchas

- `@inject` (param) ≠ `@Inject` (property) — casse différente, métadonnées différentes
- `inject:services` → sur constructeur. `inject:properties` → sur **prototype**. Confusion = bug silencieux.
- `@Inject()` sans nom + sans `design:type` → throw au moment du decorator
- `design:paramtypes` : tsx/esbuild → absent. Rollup prod → présent si ≥ 1 decorator sur la classe.
- `Fetch` auto-enregistré dans `new Injector(kernel)` — registre vide avant
- `Injector.injectables` global → isolation entre tests si on teste register/doublon
- Property `!` (definite assignment) obligatoire — TS ne sait pas qu'elle sera assignée post-ctor
- Stack `[...stack, name]` → jamais muter le tableau parent

---

## Roadmap

```
✅ A — @Inject property injection          (2026-05-14)
✅ C — Circular detection async-safe       (2026-05-14)
⬜ B — Scope "scoped" AsyncLocalStorage    (prérequis: Phase 4 HTTP handler)
⬜ D — Registry par module (namespace)     (après B)
⬜ E — @InjectLazy factory                 (après D)
```
