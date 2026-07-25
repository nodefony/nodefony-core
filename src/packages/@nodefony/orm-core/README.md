# @nodefony/orm-core

Fondation **multi-ORM** de Nodefony. Définit les contrats abstraits qui permettent de charger
plusieurs ORM dans le même processus — par exemple Drizzle pour SQL et Mongoose pour MongoDB —
derrière une API portable, avec une trappe vers le driver natif pour les cas que l'abstraction ne
couvre pas.

> Bibliothèque pure : ce module n'expose pas de classe `Module` et n'est pas listé dans
> `@modules()`. Ce sont les **drivers** (`@nodefony/drizzle`, `@nodefony/mongoose`…) qui sont des
> modules Nodefony et qui s'enregistrent eux-mêmes dans l'`OrmRegistry`.

## Quel ORM par défaut ?

**Par conception : aucun.** `orm-core` est une abstraction de dépôt de données — l'ORM se choisit par
application via l'injection de dépendances (`@Inject('repository.<entité>.<orm>')`), jamais en dur.
La valeur recherchée est de pouvoir **changer d'ORM dans le temps** sans réécrire le métier, pas
d'imposer plusieurs ORM simultanés.

| Besoin                   | ORM recommandé | Pourquoi                                                        |
| ------------------------ | -------------- | --------------------------------------------------------------- |
| **SQL** (défaut)         | **Drizzle**    | Typage strict de bout en bout, léger, SQL brut par le tag `sql` |
| **NoSQL / documentaire** | **Mongoose**   | Standard MongoDB, schémas et `populate`                         |

> ⚠️ Les transactions **entre deux ORM ne sont pas garanties** : une transaction porte sur un seul
> ORM, une seule connexion.

## Architecture

```
@nodefony/orm-core   ← IOrm, IEntity, IRepository, ITransaction + OrmRegistry
       ↑                       ↑
   drizzle (défaut)        mongoose          (les drivers sont des modules)
       └───────────────────────┘
            consommés par : @nodefony/user, stockage de session, security, application
```

## Contrats exposés

| Interface        | Rôle                                                                      |
| ---------------- | ------------------------------------------------------------------------- |
| `IOrm`           | Instance ORM (connexion logique) : `connect`, `repository`, `transaction` |
| `IEntity<S,M>`   | Entité enregistrée : nom logique, connecteur cible, schéma, modèle natif  |
| `IRepository<T>` | CRUD portable : `find`/`findOne`/`create`/`update`/`delete`/`count`       |
| `ITransaction`   | Unité de travail : `commit`/`rollback`/`savepoint`/`rollbackTo`           |
| `Criteria<T>`    | Filtre typé par champ et opérateurs riches ; `OrmCriteria` = échappatoire |

### Critères riches (opérateurs typés)

`Criteria<T>` vérifie le type de chaque champ et accepte des **opérateurs préfixés par `$`**
(`FieldOperators<V>`) — une forme portable, identique sur les deux drivers, que chacun traduit dans
sa langue (`$regex` côté Mongoose, `eq()`/`gt()`/`inArray()` côté Drizzle) :

```typescript
await users.find({ age: { $gte: 18, $lt: 65 } }); // plusieurs opérateurs = ET
await users.find({ id: { $in: ids } });
await users.find({ email: { $like: "a%" } }); // sémantique SQL (`%`, `_`)
```

Opérateurs de lecture : `$eq $ne $gt $gte $lt $lte $in $nin $like $null` — `$null` désamorce le
piège du `= NULL` en SQL. Une valeur nue vaut égalité. Le helper `isFieldOperators(value)` ne
considère une valeur comme un filtre riche que si **toutes** ses clés sont des opérateurs : une
colonne JSON reste donc comparée par égalité.

### Trappe SQL brut

`IOrm.getNativeConnection<C>()` expose la connexion native du driver pour toute requête que
l'abstraction ne couvre pas — jointures arbitraires, expressions de table communes, fonctions de
fenêtrage. C'est le garde-fou qui empêche l'abstraction de devenir un plafond.

## Exemple

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
  // validation automatique si la fonction résout, annulation si elle rejette
});
```

## Décorateurs `@entity` et `@repository`

Déclaration d'entités et de dépôts par décorateur de classe. Le décorateur s'exécute **au chargement
du module**, sur la classe et non sur une instance : il connaît donc son nom et son ORM sans rien
instancier, et enregistre l'entité directement.

```typescript
import { entity, repository } from "@nodefony/orm-core";
import type { IRepository } from "@nodefony/orm-core";

// `name` vaut par défaut le nom de la classe ; ici forcé à "User".
@entity({
  connector: "db_principale",
  name: "User",
  schema: { id: { type: "uuid", primaryKey: true }, email: { type: "string" } },
  relations: [{ type: "one-to-many", target: "Room", field: "rooms" }],
})
class UserEntity {}

@repository("repository.user", { entity: "User", connector: "db_principale" })
class UserRepository implements IRepository<UserEntity> {
  /* find, findOne, create… sont fournis par l'adaptateur ORM */
}
```

> **Sans `reflect-metadata`.** Les métadonnées vivent dans une `WeakMap` interne (helpers
> `getEntityMeta` / `getRepositoryMeta`). Le module reste une bibliothèque pure sans dépendance
> d'exécution : il n'injecte pas par type de constructeur, le polyfill est donc inutile.

## Services CRUD

`AbstractCrudService<T, R extends IRepository<T>>` est le socle des services métier : les lectures
délèguent directement au dépôt — chemin critique, aucun crochet — tandis que les écritures passent
par des crochets et émettent `onCreated`, `onUpdated`, `onDeleted`. Le service est la source de
vérité ; REST, WebSocket, GraphQL et CLI n'en sont que des adaptateurs minces.

## Licence

CeCILL-B — Christophe CAMENSULI.
