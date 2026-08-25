# Injection de dépendances — Nodefony DI

Résolution automatique des dépendances entre services via decorators TypeScript.

---

## Vue d'ensemble

| Decorator                    | Cible                  | Rôle                                          |
| ---------------------------- | ---------------------- | --------------------------------------------- |
| `@injectable(name?, scope?)` | Classe                 | Enregistre le service dans le registre global |
| `@inject("name")`            | Paramètre constructeur | Injection explicite par nom                   |
| `@Inject("name")`            | Propriété de classe    | Injection post-construction par nom           |

Deux fichiers :

- `injector/injector.ts` — moteur (`Injector`, algorithme, circular detection)
- `kernel/decorators/kernelDecorator.ts` — decorators (`@injectable`, `@inject`, `@Inject`)

---

## 1. Enregistrer un service — `@injectable`

```typescript
import { injectable } from "@nodefony/core/decorators";
import Service from "@nodefony/core/Service";
import Container from "@nodefony/core/Container";

@injectable()
class AuthService extends Service {
  constructor() {
    super("AuthService", new Container());
  }
  verify(token: string): boolean {
    return token === "secret";
  }
}
```

Options disponibles :

```typescript
@injectable()                          // nom = nom de la classe, scope = singleton
@injectable("MonNom")                  // nom explicite
@injectable({ name: "MonNom", scope: "transient" })  // objet complet
```

| Scope                  | Comportement                                             |
| ---------------------- | -------------------------------------------------------- |
| `"singleton"` (défaut) | Réutilise l'instance du container kernel si présente     |
| `"transient"`          | Crée toujours une nouvelle instance, ignore le container |

---

## 2. Injection dans le constructeur — `@inject`

Injection explicite par nom à une position donnée dans le constructeur.

```typescript
@injectable()
class UserService extends Service {
  private auth: AuthService;

  constructor(@inject("AuthService") auth: AuthService) {
    super("UserService", new Container());
    this.auth = auth;
  }

  login(token: string): boolean {
    return this.auth.verify(token);
  }
}

const user = Injector.instantiate(UserService);
user.login("secret"); // true
```

> **Tests tsx** — `emitDecoratorMetadata` inactif dans tsx/esbuild.
> Appeler `inject()` comme fonction :
>
> ```typescript
> (inject("AuthService") as Function)(UserService, undefined, 0);
> ```

---

## 3. Injection sur une propriété — `@Inject`

Injecte après la construction — utile quand le constructeur ne doit pas être surchargé.

```typescript
@injectable()
class OrderService extends Service {
  @Inject("AuthService")
  private auth!: AuthService;

  @Inject("UserService")
  private users!: UserService;

  constructor() {
    super("OrderService", new Container());
    // this.auth est undefined ICI — l'injection arrive après Reflect.construct
  }

  createOrder(token: string): string {
    if (!this.auth.verify(token)) throw new Error("Unauthorized");
    return "order-123";
  }
}

const order = Injector.instantiate(OrderService);
order.createOrder("secret"); // "order-123"
```

Séquence interne :

```
1. Reflect.construct(OrderService, [])   ← constructeur
2. order.auth  = resolve("AuthService")  ← property injection
3. order.users = resolve("UserService")  ← property injection
```

> **Nom obligatoire** si `emitDecoratorMetadata` est inactif.
> `@Inject()` sans nom et sans `design:type` → throw immédiat.

---

## 4. Auto-injection par type (rollup/prod uniquement)

Quand `emitDecoratorMetadata: true`, TypeScript émet les types des paramètres.
Injector les lit via `design:paramtypes` — aucun `@inject` nécessaire.

```typescript
@injectable()
class ReportService extends Service {
  constructor(
    private auth: AuthService, // auto-injecté si AuthService est @injectable
    private users: UserService, // idem
  ) {
    super("ReportService", auth.container as Container);
  }
}
```

| Environnement                   | `design:paramtypes` | Auto-injection                  |
| ------------------------------- | ------------------- | ------------------------------- |
| Rollup (prod, rollup.config.ts) | ✅ émis             | ✅ fonctionne                   |
| tsx (tests)                     | ❌ absent           | ❌ utiliser `@inject` explicite |

---

## 5. Exemple bout en bout — 3 services chaînés

```typescript
// ── Couche données ─────────────────────────────────────────────
@injectable()
class TokenRepository extends Service {
  private tokens = new Set(["tok-abc", "tok-xyz"]);
  constructor() {
    super("TokenRepository", new Container());
  }
  exists(token: string): boolean {
    return this.tokens.has(token);
  }
}

// ── Couche métier ──────────────────────────────────────────────
@injectable()
class AuthService extends Service {
  @Inject("TokenRepository")
  private repo!: TokenRepository;

  constructor() {
    super("AuthService", new Container());
  }
  verify(token: string): boolean {
    return this.repo.exists(token);
  }
}

// ── Couche applicative ─────────────────────────────────────────
@injectable()
class ApiGateway extends Service {
  constructor(@inject("AuthService") private auth: AuthService) {
    super("ApiGateway", auth.container as Container);
  }

  handle(token: string): string {
    if (!this.auth.verify(token)) return "401 Unauthorized";
    return "200 OK";
  }
}

// ── Résolution ─────────────────────────────────────────────────
const gateway = Injector.instantiate(ApiGateway);
gateway.handle("tok-abc"); // "200 OK"
gateway.handle("bad"); // "401 Unauthorized"
```

Ordre de résolution interne :

```
instantiate(ApiGateway)
  → resolve("AuthService")
      → instantiate(AuthService)
          → Reflect.construct(AuthService, [])
          → property: resolve("TokenRepository")
              → instantiate(TokenRepository)
  → Reflect.construct(ApiGateway, [authInstance])
```

---

## 6. Algorithme de résolution

Pour chaque paramètre du constructeur à la position `i` :

```
@inject:services[i] défini ?
  → oui → resolve par nom (priorité absolue)
  → non → design:paramtypes[i] enregistré dans injectables ?
      → oui → auto-injection par type
      → non → argsClass[explicitIdx++]  (arg explicite passé à instantiate())
```

Après construction :

```
Pour chaque entrée dans inject:properties du prototype :
  → instance[key] = resolve(name)
```

---

## 7. Détection de dépendances circulaires

```typescript
@injectable()
class A extends Service {
  constructor(@inject("B") b: B) {
    super("A", new Container());
  }
}
@injectable()
class B extends Service {
  constructor(@inject("A") a: A) {
    super("B", new Container());
  }
}

Injector.instantiate(A);
// → Error: Circular dependency detected: A → B → A
```

La stack de résolution est propagée **par valeur** à chaque niveau (`[...stack, name]`).
Deux résolutions en parallèle ne se polluent jamais — async-safe.

Les singletons déjà présents dans le container kernel court-circuitent la résolution
avant la vérification circulaire — pas de faux positif.

---

## 8. API statique — `Injector`

```typescript
Injector.register("MyService", MyService); // enregistre manuellement
Injector.isRegistered("MyService"); // boolean
Injector.get("MyService"); // retourne le constructeur, throw si absent
Injector.getScope("MyService"); // "singleton" | "transient"
Injector.instantiate(MyService, ...args); // instancie avec injection
Injector.inject(MyService, ...args); // alias de instantiate
Injector.injectables; // Record<string, ServiceConstructor>
```

---

## 9. Roadmap

| Phase | Feature                                                | Statut        | Prérequis              |
| ----- | ------------------------------------------------------ | ------------- | ---------------------- |
| A     | Property injection `@Inject`                           | ✅ 2026-05-14 | —                      |
| C     | Circular dependency detection                          | ✅ 2026-05-14 | —                      |
| B     | Scope `scoped` (1 instance/requête, AsyncLocalStorage) | ⬜            | Handler HTTP (Phase 4) |
| D     | Registry par module (isolation namespace)              | ⬜            | Après B                |
| E     | `@InjectLazy` (factory, instanciation différée)        | ⬜            | Après D                |

---

## 10. Gotchas

- `@inject` (paramètre) ≠ `@Inject` (propriété) — ne pas confondre la casse
- `@Inject()` sans nom et sans `design:type` → throw au moment du decorator, pas à l'instantiation
- `design:paramtypes` nécessite `emitDecoratorMetadata: true` + au moins un decorator sur la classe
- `Injector.get("X")` throw si `X` absent — uncaught dans `_resolveWithStack` → propagé à `instantiate`
- `Fetch` est auto-enregistré dans `new Injector(kernel)` — pas avant
- Les champs `!` (definite assignment assertion) sont nécessaires sur les propriétés injectées — TypeScript ne sait pas qu'elles seront assignées post-construction
- `Injector.injectables` est un Record statique global — isolation entre tests nécessaire si on teste l'enregistrement
