# @nodefony/orm-core

Fondation **multi-ORM** de Nodefony. Définit les contrats abstraits permettant de
charger **plusieurs ORM simultanément** dans le même process (ex. Drizzle pour
SQL + Mongoose pour MongoDB + Redis pour le cache), avec une API portable et une
trappe vers le driver natif pour les cas avancés.

> Package **lib pure** : il n'expose pas de `Module` runtime et n'est pas listé
> dans `@modules()`. Ce sont les **drivers** (`@nodefony/sequelize`,
> `@nodefony/mongoose`, `@nodefony/drizzle`...) qui sont des modules Nodefony et
> qui s'enregistrent eux-mêmes dans le `OrmRegistry`.

## Architecture

```
@nodefony/orm-core   ← IOrm, IEntity, IRepository, ITransaction + OrmRegistry (P5.2)
   ↑           ↑              ↑                ↑
sequelize   mongoose      drizzle          mikroorm        (drivers = Modules)
   └───────────┴────────────────┴──────────────┘
            consommés par : @nodefony/user, session storage, security, app
```

## Contrats exposés

| Interface           | Rôle                                                                 |
| ------------------- | ------------------------------------------------------------------- |
| `IOrm`              | Instance ORM (connexion logique) : connect, repository, transaction |
| `IEntity<S,M>`      | Entité enregistrée : nom logique, ORM cible, schéma, modèle natif    |
| `IRepository<T>`    | CRUD portable : `find/findOne/create/update/delete/count`           |
| `ITransaction`      | Unité de travail : `commit/rollback/savepoint/rollbackTo`           |
| `OrmCriteria`       | Filtre abstrait (`Record<string, unknown>`)                         |

### Trappe SQL brut

`IOrm.getNativeConnection<C>()` expose la connexion native du driver pour toute
requête non couverte par l'abstraction (tag `sql` de Drizzle, `connection`
Mongoose, etc.) — anti-blocage indispensable.

## Exemple (cible, après P5.2)

```typescript
import { OrmRegistry } from "@nodefony/orm-core";
import type { IRepository } from "@nodefony/orm-core";

interface User {
  id: number;
  email: string;
}

const orm = OrmRegistry.get("db_principale");
const users: IRepository<User> = orm.getRepository<User>("User");

const created = await users.create({ email: "a@b.c" });
const found = await users.findOne({ email: "a@b.c" });

await orm.transaction(async (tx) => {
  await users.update({ id: created.id }, { email: "x@y.z" });
  // commit auto si la closure résout, rollback si elle rejette
});
```

## Décorateurs `@entity` / `@repository` (P5.3)

Déclaration d'entités et de repositories par décorateur de classe. Le décorateur
s'exécute **au chargement du module** (sur la classe, pas sur une instance) — il
connaît donc `name`/`orm` sans rien instancier et enregistre directement l'entité.

```typescript
import { entity, repository } from "@nodefony/orm-core";
import type { IRepository } from "@nodefony/orm-core";

// `name` par défaut = nom de la classe ; ici forcé à "User".
@entity({
  orm: "db_principale",
  name: "User",
  schema: { id: { type: "uuid", primaryKey: true }, email: { type: "string" } },
  relations: [{ type: "one-to-many", target: "Room", field: "rooms" }],
})
class UserEntity {}

@repository("repository.user", { entity: "User", orm: "db_principale" })
class UserRepository implements IRepository<UserEntity> {
  /* find/findOne/create/... fournis par l'adapter ORM */
}
```

> **Sans `reflect-metadata`.** Les métadonnées sont stockées dans un `WeakMap`
> interne (helpers `getEntityMeta` / `getRepositoryMeta`). orm-core reste une lib
> pure sans dépendance runtime : il ne fait pas d'injection par type de
> constructeur (`design:paramtypes`), donc le polyfill Reflect est inutile.

## État

- ✅ Interfaces (`IOrm`, `IEntity`, `IRepository`, `ITransaction`) — P5.1.
- ✅ `OrmRegistry`, `EntityRegistry`, `Orm`/`Entity` base classes — P5.2.
- ✅ Décorateurs `@entity` / `@repository` — P5.3.
- ⏳ Tests intégration multi-ORM + 1 adapter (Sequelize) — P5.4.

## Licence

CeCILL-B — Christophe CAMENSULI.
