# @nodefony/framework

Couche **Router / Controller / décorateurs** de Nodefony. S'appuie sur `@nodefony/http`
(serveurs + contextes) et expose le modèle de programmation applicatif : un controller
sert **HTTP et WebSocket dans le même contexte**, nativement.

> Docs IA : [`CLAUDE.md`](./CLAUDE.md) (instructions session) · [`MEMORY.md`](./MEMORY.md)
> (internals concis) · [`docs/`](./docs) (concepts). `@nodefony/http` ne peut PAS importer
> ce module (dépendance circulaire) — l'accès se fait via `(context as any)?.resolver`.

## Rôle

- **Router** : matching de routes (path + méthode + domaine), `Route.match()`.
- **Resolver** : résout route → controller → action, injecte les paramètres décorés.
- **Controller** : classe de base ; cycle `initialize()` → action ; HTTP + WS.
- **Décorateurs** : `@controller`, `@route`, `@Get/@Post/...`, `@Param/@Body/@Query/@Headers`,
  `@Domain`, etc.
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

CeCILL-B — Christophe CAMENSULI.
