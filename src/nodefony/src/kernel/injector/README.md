# Injection de dépendances — Nodefony DI

Résolution automatique des dépendances entre services via decorators TypeScript.

---

## Vue d'ensemble

| Decorator                     | Cible                  | Rôle                                          |
| ----------------------------- | ---------------------- | --------------------------------------------- |
| `@injectable(nameOrOptions?)` | Classe                 | Enregistre le service dans le registre global |
| `@Inject("name")`             | Paramètre constructeur | Injection explicite par nom                   |

Deux fichiers :

- `injector/injector.ts` — moteur (`Injector`, algorithme, circular detection)
- `kernel/decorators/kernelDecorator.ts` — decorators (`@injectable`, `@Inject`)

---

## 1. Enregistrer un service — `@injectable`

```typescript
import { injectable, Service, Container } from "nodefony";

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
@injectable({ name: "Tenant", scope: "request" })   // une instance par requête
```

| Scope                  | Comportement                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `"singleton"` (défaut) | Réutilise l'instance du container kernel si présente                                   |
| `"transient"`          | Crée toujours une nouvelle instance, ignore le container                               |
| `"request"`            | Une instance par requête HTTP (par connexion WebSocket), nettoyée à la fin de celle-ci |

### Portée `request`

```typescript
import { Service, injectable, type Scope } from "nodefony";

@injectable({ name: "Tenant", scope: "request" })
export class Tenant extends Service {
  constructor(scope: Scope) {
    // 1ᵉʳ argument : le scope de la requête. `false` : pas de bus d'événements
    // par requête.
    super("tenant", scope, false);
  }
  override clean(syslog = false): void {
    // appelé à la fermeture du scope — libérer ici ce que la requête a ouvert
    super.clean(syslog);
  }
}
```

- **Création paresseuse** : l'instance naît à sa première résolution dans la requête, puis
  est rangée sur le scope de celle-ci (clé = le nom de son `super()`). Une requête qui ne
  résout aucun service `request` ne paie rien.
- **Nettoyage** : à la fermeture du scope, le `clean()` de chaque instance est appelé une fois,
  de la dernière créée à la première. Un `clean()` qui lève est journalisé sans empêcher les
  suivants. Il n'est pas **attendu** : un `async clean()` part en arrière-plan (son échec est
  journalisé) — un `COMMIT` se fait dans l'action, `clean()` n'est que le filet. En HTTP, il
  tourne **hors** de la bulle de la requête : y lire le scope par `this.container`, jamais par
  `RequestContext`.
- **WebSocket** : le scope est celui de la **connexion**. Une instance `request` vit donc toute
  la connexion, partagée par tous ses messages — y compris par des invocations concurrentes
  sur la même socket.
- **Déclaration** : la lister dans `@services([...])` la déclare sans l'instancier au démarrage
  (il n'y a pas de requête au démarrage). `addService()` la refuse.
- **Dépendance captive refusée** : un singleton qui dépend d'un service `request` garderait
  l'instance de la première requête pour toutes les suivantes. Refus en `BootConfigurationError`
  qui nomme les deux et le chemin, **au démarrage** : le graphe des dépendances déclarées de
  chaque contrôleur (`@controllers`) et de chaque service `request` déclaré est analysé, sans
  rien instancier — un contrôleur (singleton par défaut, sauf `@Scope("request")`) ou un singleton paresseux qu'ils
  atteignent arrête le boot. La même règle refuse encore à la résolution ce qu'aucune
  déclaration ne montrait. Un service `transient` prend la durée de vie de celui qui le
  détient ; une classe **sans portée déclarée est un singleton**.
- **Hors requête** (démarrage, commande CLI, minuterie, promesse qui survit à la réponse) :
  la résolution lève, en nommant le service et la cause.
- **Clé du scope** : le pipeline range ses propres objets sur le scope (`context`,
  `controller`…), et le scope hérite des services du kernel (`sessions`, `router`…). Un
  service dont le nom en reprend un est refusé plutôt que de le masquer pour toute la requête.
  Un remplacement voulu pour une requête s'écrit explicitement :
  `RequestContext.requireScope().set(clé, objet)`.
- **Limites** : `Injector.instantiate(ClasseRequest)` construit HORS du scope (ni rangée, ni
  nettoyée) — toujours l'injecter. Un scope enfant (`enterScope` sur un scope) ne voit pas
  les services `request` de son parent.

---

## 2. Injection dans le constructeur — `@Inject`

Une dépendance se **nomme** : `@Inject("nom")` à la position du paramètre.

```typescript
@injectable()
class UserService extends Service {
  private auth: AuthService;

  constructor(@Inject("AuthService") auth: AuthService) {
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

> **Le type d'un paramètre ne résout rien** (ADR-0018). Un paramètre sans `@Inject` reçoit
> l'argument positionnel suivant passé à `instantiate()`, ou `undefined` — même si son type
> est un service inscrit. Le framework ne lit aucune métadonnée émise par le compilateur
> (`emitDecoratorMetadata: false`) : un type importé par `import type`, ou dont le bundler a
> élidé l'import, y devenait `Object`, et le service recevait un argument faux sans un mot.
>
> Sans syntaxe de décorateur (test, fabrique), l'appel direct pose la même métadonnée :
>
> ```typescript
> Inject("AuthService")(UserService, undefined, 0);
> ```

---

## 3. Exemple bout en bout — 3 services chaînés

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
  constructor(@Inject("TokenRepository") private repo: TokenRepository) {
    super("AuthService", new Container());
  }
  verify(token: string): boolean {
    return this.repo.exists(token);
  }
}

// ── Couche applicative ─────────────────────────────────────────
@injectable()
class ApiGateway extends Service {
  constructor(@Inject("AuthService") private auth: AuthService) {
    super("ApiGateway", new Container());
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
          → resolve("TokenRepository")
              → instantiate(TokenRepository)
          → Reflect.construct(AuthService, [repo])
  → Reflect.construct(ApiGateway, [authInstance])
```

---

## 4. Algorithme de résolution

Pour chaque paramètre du constructeur à la position `i` :

```
@Inject("nom") à la position i ?
  → oui → resolve par nom
  → non → argsClass[explicitIdx++]  (arg explicite passé à instantiate(), ou undefined)
Les arguments explicites restants sont transmis à la suite.
```

---

## 5. Détection de dépendances circulaires

```typescript
@injectable()
class A extends Service {
  constructor(@Inject("B") b: B) {
    super("A", new Container());
  }
}
@injectable()
class B extends Service {
  constructor(@Inject("A") a: A) {
    super("B", new Container());
  }
}

Injector.instantiate(A);
// → Error: Circular dependency detected: A → B → A
```

La stack de résolution est propagée **par valeur** à chaque niveau (`[...stack, Ctor]`).
Deux résolutions en parallèle ne se polluent jamais — async-safe.

Les singletons déjà présents dans le container kernel court-circuitent la résolution
avant la vérification circulaire — pas de faux positif.

---

## 6. API statique — `Injector`

```typescript
Injector.register("MyService", MyService); // enregistre manuellement
Injector.isRegistered("MyService"); // boolean
Injector.get("MyService"); // retourne le constructeur, throw si absent
Injector.getScope("MyService"); // "singleton" | "transient" | "request"
Injector.scopeOf(MyService); // idem, depuis la classe
Injector.dependencyNamesOf(MyService); // noms déclarés par @Inject, dans l'ordre
Injector.instantiate(MyService, ...args); // instancie avec injection
Injector.inject(MyService, ...args); // alias de instantiate
Injector.injectables; // Partial<Record<string, ServiceConstructor>> — une clé absente vaut undefined
```

---

## 7. Roadmap

| Phase | Feature                                                  | Statut | Prérequis |
| ----- | -------------------------------------------------------- | ------ | --------- |
| C     | Circular dependency detection                            | ✅     | —         |
| B     | Portée `request` (1 instance/requête, AsyncLocalStorage) | ✅     | —         |
| D     | Registry par module (isolation namespace)                | ⬜     | Après B   |
| E     | `@InjectLazy` (factory, instanciation différée)          | ⬜     | Après D   |

L'injection de propriété et l'injection par type sont retirées (ADR-0018).

---

## 8. Gotchas

- Un paramètre reçu `undefined` = un paramètre sans `@Inject("nom")` : le type ne résout rien
- `@Inject("")` → throw au moment du decorator, pas à l'instantiation
- `Injector.get("X")` throw si `X` absent — uncaught dans `_resolveWithStack` → propagé à `instantiate`
- `Fetch` est auto-enregistré dans `new Injector(kernel)` — pas avant
- `Injector.injectables` est un Record statique global — isolation entre tests nécessaire si on teste l'enregistrement
