# @nodefony/framework

Couche **Router / Controller / décorateurs** de Nodefony. S'appuie sur `@nodefony/http`
(serveurs + contextes) et expose le modèle de programmation applicatif : un controller
sert **HTTP et WebSocket dans le même contexte**, nativement.

> Docs IA (dans le dépôt) : [`CLAUDE.md`](https://github.com/nodefony/nodefony-core/blob/main/src/packages/@nodefony/framework/CLAUDE.md) (instructions session) · [`MEMORY.md`](https://github.com/nodefony/nodefony-core/blob/main/src/packages/@nodefony/framework/MEMORY.md)
> (internals concis) · [`docs/`](./docs) (concepts). `@nodefony/http` ne peut PAS importer
> ce module (dépendance circulaire) — l'accès se fait via `context.resolver`, typé par le contrat `IRouteResolver` (défini par http, implémenté par framework).

## ⚡ Le geste — un contrôleur ne s'écrit pas à la main

Dans une application, les générateurs posent le contrôleur, l'inscrivent dans `index.ts` et
écrivent son test. Depuis la racine de l'application :

```bash
# une ressource REST adossée à une table : entité, service CRUD, contrôleur, tests, migration
npx nodefony create entity Post title:string content:text --route /api/posts
# un contrôleur seul : hello (GET + écho WebSocket, défaut), rest (CRUD) ou realtime (canal)
npx nodefony create controller Facture --kind rest --route /api/factures
```

`--module <nom>` cible un module de l'application au lieu de sa racine. La suite de ce README
décrit ce que ces fichiers contiennent — de quoi les lire et les retoucher.

## Rôle

- **Router** : matching de routes (path + méthode + domaine), `Route.match()`.
- **Resolver** : résout route → controller → action, injecte les paramètres décorés.
- **Controller** : classe de base ; cycle `initialize()` → action ; HTTP + WS. Singleton par défaut :
  une instance partagée par toutes les requêtes, sans état sur `this`, qui ne peut donc pas injecter
  un service `@injectable({ scope: "request" })` — refusé au démarrage. `@Scope("request")` rend une
  instance par requête (par connexion en WebSocket). `RealtimeController` est par connexion.
- **Décorateurs** : `@controller`, `@route`, `@Get/@Post/...`, `@Param/@Body/@Query/@Headers`,
  `@Domain`, etc.
- **Routes à schéma** : `@Post("/posts", { schema: { body } })` — l'entrée est validée avant
  l'action (422 qui nomme chaque champ, sur HTTP comme par la socket) et reçue typée en un seul
  argument, `input: RouteInput<S>`. Zod, Valibot, ArkType : tout Standard Schema. Détail :
  [`docs/decorateurs.md`](docs/decorateurs.md).
- **Data plane admin** : `AdminApiController` + `IAdminBroker` (surface `/nodefony/<module>/api/*`).

## Exemple

```typescript
import { controller, route, Get, Param, Controller } from "@nodefony/framework";
import { ContextType } from "@nodefony/http";

@controller("/users")
class UsersController extends Controller {
  constructor(context: ContextType) {
    super("users", context);
  }

  @Get("/{id}")
  async show(@Param("id") id: string) {
    return this.render({ id });
  }
}

export default UsersController;
```

## Tests

```bash
npm test                 # unit (vitest, sans serveur)
npm run test:integration # intégration (vitest, serveur dev requis : 5151/5152)
```

## Licence

Apache 2.0 — Christophe CAMENSULI.
