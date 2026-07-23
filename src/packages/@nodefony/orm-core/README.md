# @nodefony/orm-core

Fondation **multi-ORM** de Nodefony. Définit les contrats abstraits permettant de
charger **plusieurs ORM simultanément** dans le même process (ex. Drizzle pour
SQL + Mongoose pour MongoDB + Redis pour le cache), avec une API portable et une
trappe vers le driver natif pour les cas avancés.

> Package **lib pure** : il n'expose pas de `Module` runtime et n'est pas listé
> dans `@modules()`. Ce sont les **drivers** (`@nodefony/mongoose`,
> `@nodefony/drizzle`...) qui sont des modules Nodefony et
> qui s'enregistrent eux-mêmes dans le `OrmRegistry`.

## Quel ORM par défaut ?

**Par design : aucun.** orm-core est une abstraction Repository — on choisit l'ORM
par application via l'injection de dépendances (`@Inject('repository.<entité>.<orm>')`),
jamais en dur. Le framework ne couple aucun ORM ; la valeur recherchée est de
**pouvoir changer d'ORM dans le temps** sans réécrire le métier (pas de
multi-ORM simultané imposé).

**Recommandations (nouveau développement) :**

| Besoin                   | ORM recommandé | Pourquoi                                                                  |
| ------------------------ | -------------- | ------------------------------------------------------------------------- |
| **SQL** (défaut)         | **Drizzle**    | Type-safe-first (aligné TypeScript strict), léger, SQL brut via tag `sql` |
| **NoSQL / documentaire** | **Mongoose**   | Standard MongoDB, schémas + populate                                      |
| Apps très complexes      | MikroORM       | Data Mapper + Unit of Work + Identity Map (option)                        |

> ⚠️ Les transactions **cross-ORM (2PC) ne sont pas garanties** : une transaction
> porte sur un seul ORM / une seule connexion.

## Architecture

```
@nodefony/orm-core   ← IOrm, IEntity, IRepository, ITransaction + OrmRegistry (P5.2)
       ↑                       ↑
   drizzle (défaut)        mongoose          (drivers = Modules)
       └───────────────────────┘
            consommés par : @nodefony/user, session storage, security, app
```

## Contrats exposés

| Interface        | Rôle                                                                     |
| ---------------- | ------------------------------------------------------------------------ |
| `IOrm`           | Instance ORM (connexion logique) : connect, repository, transaction      |
| `IEntity<S,M>`   | Entité enregistrée : nom logique, connecteur cible, schéma, modèle natif |
| `IRepository<T>` | CRUD portable : `find/findOne/create/update/delete/count`                |
| `ITransaction`   | Unité de travail : `commit/rollback/savepoint/rollbackTo`                |
| `Criteria<T>`    | Filtre typé par champ + opérateurs riches ; `OrmCriteria` = échappatoire |

### Critères riches (opérateurs typés)

`Criteria<T>` type-vérifie chaque champ et accepte des **opérateurs `$`-préfixés**
typés (`FieldOperators<V>`) — forme portable identique sur les 3 drivers (mappée en
`# @nodefony/orm-core

Fondation **multi-ORM** de Nodefony. Définit les contrats abstraits permettant de
charger **plusieurs ORM simultanément** dans le même process (ex. Drizzle pour
SQL + Mongoose pour MongoDB + Redis pour le cache), avec une API portable et une
trappe vers le driver natif pour les cas avancés.

> Package **lib pure** : il n'expose pas de `Module` runtime et n'est pas listé
> dans `@modules()`. Ce sont les **drivers** (`@nodefony/mongoose`,
> `@nodefony/drizzle`...) qui sont des modules Nodefony et
> qui s'enregistrent eux-mêmes dans le `OrmRegistry`.

## Quel ORM par défaut ?

**Par design : aucun.** orm-core est une abstraction Repository — on choisit l'ORM
par application via l'injection de dépendances (`@Inject('repository.<entité>.<orm>')`),
jamais en dur. Le framework ne couple aucun ORM ; la valeur recherchée est de
**pouvoir changer d'ORM dans le temps** sans réécrire le métier (pas de
multi-ORM simultané imposé).

**Recommandations (nouveau développement) :**

| Besoin                   | ORM recommandé | Pourquoi                                                                  |
| ------------------------ | -------------- | ------------------------------------------------------------------------- |
| **SQL** (défaut)         | **Drizzle**    | Type-safe-first (aligné TypeScript strict), léger, SQL brut via tag `sql` |
| **NoSQL / documentaire** | **Mongoose**   | Standard MongoDB, schémas + populate                                      |
| Apps très complexes      | MikroORM       | Data Mapper + Unit of Work + Identity Map (option)                        |

> ⚠️ Les transactions **cross-ORM (2PC) ne sont pas garanties** : une transaction
> porte sur un seul ORM / une seule connexion.

## Architecture

```
@nodefony/orm-core   ← IOrm, IEntity, IRepository, ITransaction + OrmRegistry (P5.2)
       ↑                       ↑
   drizzle (défaut)        mongoose          (drivers = Modules)
       └───────────────────────┘
            consommés par : @nodefony/user, session storage, security, app
```

## Contrats exposés

| Interface        | Rôle                                                                     |
| ---------------- | ------------------------------------------------------------------------ |
| `IOrm`           | Instance ORM (connexion logique) : connect, repository, transaction      |
| `IEntity<S,M>`   | Entité enregistrée : nom logique, connecteur cible, schéma, modèle natif |
| `IRepository<T>` | CRUD portable : `find/findOne/create/update/delete/count`                |
| `ITransaction`   | Unité de travail : `commit/rollback/savepoint/rollbackTo`                |
| `Criteria<T>`    | Filtre typé par champ + opérateurs riches ; `OrmCriteria` = échappatoire |

### Critères riches (opérateurs typés)

`Criteria<T>` type-vérifie chaque champ et accepte des **opérateurs `$`-préfixés**
typés (`FieldOperators<V>`) — forme portable identique sur les 3 drivers (mappée en
/`$regex` Mongoose, `eq()/gt()/inArray()` Drizzle) :

```typescript
await users.find({ age: { $gte: 18, $lt: 65 } }); // plusieurs opérateurs = AND
await users.find({ id: { $in: ids } });
await users.find({ email: { $like: "a%" } }); // sémantique SQL (`%`, `_`)
```

Opérateurs : `$eq $ne $gt $gte $lt $lte $in $nin $like`. Une valeur nue = égalité.
Helper `isFieldOperators(value)` (lib pure) : une valeur n'est un filtre riche que
si **toutes** ses clés sont des opérateurs (sinon = égalité, ex. colonne JSON).

### Trappe SQL brut

`IOrm.getNativeConnection<C>()` expose la connexion native du driver pour toute
requête non couverte par l'abstraction (tag `sql` de Drizzle, `connection`
Mongoose, etc.) — anti-blocage indispensable (jointures arbitraires, CTE, fonctions
fenêtre...).

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
  connector: "db_principale",
  name: "User",
  schema: { id: { type: "uuid", primaryKey: true }, email: { type: "string" } },
  relations: [{ type: "one-to-many", target: "Room", field: "rooms" }],
})
class UserEntity {}

@repository("repository.user", { entity: "User", connector: "db_principale" })
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
- ✅ Adapter Mongoose (CRUD/relations/tx portables) — P5.4.
- ✅ Adapter Drizzle + opérateurs riches typés (`FieldOperators`/`isFieldOperators`)
  — P7.4 ; **4 risques ADR-0003 traités** (cf `docs/adr/0003`).

## Licence

CeCILL-B — Christophe CAMENSULI.
