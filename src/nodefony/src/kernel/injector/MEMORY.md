# MEMORY.md — Injector + Decorators DI

> IA uniquement — ultra-concis. Voir README.md pour exemples humains.

## Docs liées

- [`../MEMORY.md`](../MEMORY.md) — Kernel/Module (utilise Injector pour `addService`/`addModule`)
- [`../../../MEMORY.md`](../../../MEMORY.md) — workspace core (Container/Service)
- Consommateur : [`../../../../packages/@nodefony/framework/MEMORY.md`](../../../../packages/@nodefony/framework/MEMORY.md) — `Resolver.newController()` utilise `Injector.instantiate()`
- [`../../../../../CLAUDE.md`](../../../../../CLAUDE.md) — règles projet

---

## Fichiers

| Fichier                                | Rôle                                                                                                              |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `injector/injector.ts`                 | Moteur DI — registre, résolution, circular detection                                                              |
| `kernel/decorators/kernelDecorator.ts` | Decorators — `@injectable`, `@inject`, `@Inject`, `@services`, `@entities` (`@modules` RETIRÉ → `config.modules`) |

---

## Registre statique

```
injectables = Object.create(null)                 ← module-level, partagé, SANS prototype
Injector.injectables                              ← même référence (accès direct OK)
Injector.register(name, Ctor)                     ← throw si name vide ou Ctor null
Injector.isRegistered(name)                       ← O(1), `name in injectables`
Injector.get(name)                                ← throw "not found or not injectable" si absent
Injector.getScope(name)                           ← lit "di:scope" metadata | défaut "singleton"
Injector.inject(Ctor, ...args)                    ← alias instantiate
```

⚠️ `Object.create(null)` est **structurel, pas cosmétique** : un objet littéral hérite de
`Object.prototype` → `isRegistered("toString"|"constructor"|"valueOf"|"hasOwnProperty")` répondait
**true** (services fantômes), `get("toString")` rendait `Object.prototype.toString` comme
constructeur, et `register("__proto__", X)` **déracinait le registre** (`call`/`apply`/`bind`
devenaient injectables). Couvert par `tests/injector.attack.test.ts` (section B).

**Override assumé** : `register` sur un nom pris **écrase** (le dernier gagne) — c'est un contrat
(une app surcharge un service du framework), gravé par `Injector.test.ts` + sentinelle A1. Pas une
faille : qui appelle `@injectable` exécute déjà du code arbitraire dans le process. Le risque réel
est la collision ACCIDENTELLE, silencieuse (le registre n'a pas de logger — `Module.addService`, lui,
WARN quand il écrase une clé du container).

---

## DIScope

```
"singleton"  défaut — kernel.get(name) si présent, sinon instancie PUIS mémoïse (kernel.set)
"transient"  toujours new — ignore container kernel
```

Stocké : `Reflect.defineMetadata("di:scope", scope, Ctor)` par `@injectable`.

**La mémoïsation range dans le container du KERNEL** (pas un cache statique : il fuirait d'un kernel
à l'autre, tests compris). Corollaire assumé : **sans kernel, pas de mémoïsation possible** (aucun
endroit où ranger) → deux résolutions = deux instances.

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
      injectExplicit[i] → _resolveWithStack(name, nextStack)  ← priorité, SANS args
      paramTypes[i].name in injectables → _resolveWithStack(type, nextStack)  ← SANS args
      sinon → argsClass[explicitIdx++]
    append argsClass restants

    → Reflect.construct(Ctor, resolvedArgs)
    → _applyPropertyInjection(Ctor, instance, nextStack)
```

🔑 **`argsClass` appartient à la classe construite, JAMAIS à ses dépendances** : une dépendance se
RÉSOUT (container/registre), elle ne s'HÉRITE pas. Les propager donnait à une dépendance les args de
son parent → un service recevait un objet d'un type qu'il n'attend pas, sans que TS ne voie rien
(vécu : `Fetch(module: Module)` construit avec un `HttpContext` — ne tenait que par duck-typing sur
`.container`). C'est aussi ce qui **interdisait toute mémoïsation** (on ne cache pas une instance
dont les args varient). Couvert : `injector.attack.test.ts` section D.

---

## `_resolveWithStack(name, stack)` — pas d'`argsClass` (cf. ci-dessus)

```
isRegistered(name) ?
  scope === "transient" → _instantiateWithStack(Ctor, stack, [])
  kernel && kernel.get(name) → retourne instance container  ← singleton court-circuit
  sinon → inst = _instantiateWithStack(Ctor, stack, []) ; kernel?.set(name, inst) ; retourne inst
sinon:
  kernel.get(name) existe → retourne                        ← fallback container
  sinon → throw "not found or not injectable"
```

**Le container est interrogé avec le nom ÉCRIT dans `@inject`**, jamais avec le nom réel de
l'instance → cf. Gotchas (divorce registre/container).

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

> `@modules` RETIRÉ → chargement de modules via `config.modules` (manifeste,
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
- `design:paramtypes` : tsx/esbuild → absent. build rolldown (oxc) → présent si ≥ 1 decorator sur la classe.
  ⚠️ **Le runtime buildé l'ÉMET** (`emitDecoratorMetadata: true` partout) → l'auto-injection par TYPE
  est vivante en prod, même si 0 usage aujourd'hui dans le repo.
- `Fetch` est **DÉCLARÉ ET POSÉ** dans `new Injector(kernel)` : `register("Fetch")` +
  `kernel.set("Fetch", new Fetch(kernel))`. Déclarer sans poser laissait `kernel.get("Fetch")` vide
  → `new Fetch()` à CHAQUE `@inject("Fetch")` (mesuré : 10 requêtes = 10 instances). Son ctor prend
  `owner: Module | Kernel` — seul `.container` est utilisé.
- 🔴 **DETTE — deux annuaires, un seul nom** : `@injectable(nom)` → clé du **registre** (classes) ;
  `super(nom, container)` → `inst.name` → clé du **container** (instances, posée par `addService`).
  Rien ne les relie : le décorateur tourne au CHARGEMENT de la classe, `super()` à la CONSTRUCTION.
  1 seul des 7 `@injectable` round-trippe (`HttpKernel`) ; `Router`→`"router"`, `AdminBroker`→
  `"adminBroker"`, `SessionsService`→`"sessions"`, `FrontendService`→`"frontend"`,
  `MemoryIdempotencyStore`→`"idempotencyStore"` divergent. Conséquence contre-intuitive :
  **être au registre est PIRE que ne pas y être** — `@inject("router")` marche (inconnu du registre →
  fallback container), `@inject("Router")` non (registre → `get("Router")` → null). Cible = **token
  = la CLASSE** (cf. NestJS/Angular/tsyringe), pas une chaîne. Gravé : `injector.attack.test.ts` C3
  en `it.fails` → passera au vert tout seul quand la dette sera soldée (retirer le `.fails`).
- 🔴 **DI ordre-dépendant** : les 6 `@inject("HttpKernel")` ne résolvent que parce que `HttpKernel`
  est **1er** dans `@services([...])` de `http/index.ts` (instanciation séquentielle → posé au
  container avant ses consommateurs). Le descendre dans la liste = 6 services reçoivent chacun un
  HttpKernel privé — en silence. Aucun test ne l'attrape.
- `Injector.injectables` global → isolation entre tests si on teste register/doublon
- Property `!` (definite assignment) obligatoire — TS ne sait pas qu'elle sera assignée post-ctor
- Stack `[...stack, name]` → jamais muter le tableau parent

---

## Roadmap

```
✅ A — @Inject property injection
✅ C — Circular detection async-safe
⬜ B — Scope "scoped" AsyncLocalStorage    (prérequis: Phase 4 HTTP handler)
⬜ D — Registry par module (namespace)     (après B)
⬜ E — @InjectLazy factory                 (après D)
```
