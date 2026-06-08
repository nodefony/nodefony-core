---
module: "@nodefony/orm-core"
topic: orm-core
audience: [human, ai]
tags: [orm, repository, multi-orm, criteria, operators, transaction, entity]
status: stable
last-updated: 2026-05-21
---

# @nodefony/orm-core — fondation multi-ORM

> Contrats abstraits (`IOrm`, `IEntity`, `IRepository`, `ITransaction`) + registres
>
> - classes de base, partagés par les drivers (`@nodefony/mongoose`,
>   `@nodefony/drizzle`…). **Lib pure** : pas de `Module`
>   runtime, pas dans `@modules()` — ce sont les drivers qui sont des modules.

## Quel ORM par défaut ?

**Aucun n'est imposé** : orm-core est une abstraction _Repository_. On choisit l'ORM
par application via l'injection de dépendances (`@Inject('repository.<entité>.<orm>')`),
jamais en dur. La valeur recherchée est de **pouvoir changer d'ORM dans le temps**
sans réécrire le métier (le multi-ORM simultané n'est pas l'objectif).

| Besoin                   | ORM recommandé | Pourquoi                                           |
| ------------------------ | -------------- | -------------------------------------------------- |
| **SQL** (défaut)         | **Drizzle**    | Type-safe-first, léger, SQL brut via tag `sql`     |
| **NoSQL / documentaire** | **Mongoose**   | Standard MongoDB, schémas + populate               |
| Apps très complexes      | MikroORM       | Data Mapper + Unit of Work + Identity Map (option) |

> Les transactions **cross-ORM (2PC) ne sont pas garanties** : une transaction
> porte sur un seul ORM / une seule connexion.

## Contrats

| Interface        | Rôle                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------ |
| `IOrm`           | Instance ORM (connexion logique) : `connect/getRepository/transaction/getNativeConnection` |
| `IEntity<S,M>`   | Entité enregistrée : nom logique, ORM cible, schéma, modèle natif                          |
| `IRepository<T>` | CRUD portable : `find/findOne/create/update/delete/count` + `withTransaction`              |
| `ITransaction`   | `commit/rollback/savepoint/rollbackTo/getNative`                                           |

### Trappe SQL brut

`IOrm.getNativeConnection<C>()` expose la connexion native du driver pour toute
requête non couverte par l'abstraction (tag `sql` Drizzle, `connection` Mongoose…)
— jointures arbitraires, CTE, fonctions fenêtre. **Anti-blocage indispensable.**

## Critères : égalité + opérateurs riches typés

`Criteria<T>` type-vérifie chaque champ et accepte des **opérateurs `$`-préfixés**
typés (`FieldOperators<V>`), forme **portable identique sur les 3 drivers** (mappée
en `---
module: "@nodefony/orm-core"
topic: orm-core
audience: [human, ai]
tags: [orm, repository, multi-orm, criteria, operators, transaction, entity]
status: stable
last-updated: 2026-05-21

---

# @nodefony/orm-core — fondation multi-ORM

> Contrats abstraits (`IOrm`, `IEntity`, `IRepository`, `ITransaction`) + registres
>
> - classes de base, partagés par les drivers (`@nodefony/mongoose`,
>   `@nodefony/drizzle`…). **Lib pure** : pas de `Module`
>   runtime, pas dans `@modules()` — ce sont les drivers qui sont des modules.

## Quel ORM par défaut ?

**Aucun n'est imposé** : orm-core est une abstraction _Repository_. On choisit l'ORM
par application via l'injection de dépendances (`@Inject('repository.<entité>.<orm>')`),
jamais en dur. La valeur recherchée est de **pouvoir changer d'ORM dans le temps**
sans réécrire le métier (le multi-ORM simultané n'est pas l'objectif).

| Besoin                   | ORM recommandé | Pourquoi                                           |
| ------------------------ | -------------- | -------------------------------------------------- |
| **SQL** (défaut)         | **Drizzle**    | Type-safe-first, léger, SQL brut via tag `sql`     |
| **NoSQL / documentaire** | **Mongoose**   | Standard MongoDB, schémas + populate               |
| Apps très complexes      | MikroORM       | Data Mapper + Unit of Work + Identity Map (option) |

> Les transactions **cross-ORM (2PC) ne sont pas garanties** : une transaction
> porte sur un seul ORM / une seule connexion.

## Contrats

| Interface        | Rôle                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------ |
| `IOrm`           | Instance ORM (connexion logique) : `connect/getRepository/transaction/getNativeConnection` |
| `IEntity<S,M>`   | Entité enregistrée : nom logique, ORM cible, schéma, modèle natif                          |
| `IRepository<T>` | CRUD portable : `find/findOne/create/update/delete/count` + `withTransaction`              |
| `ITransaction`   | `commit/rollback/savepoint/rollbackTo/getNative`                                           |

### Trappe SQL brut

`IOrm.getNativeConnection<C>()` expose la connexion native du driver pour toute
requête non couverte par l'abstraction (tag `sql` Drizzle, `connection` Mongoose…)
— jointures arbitraires, CTE, fonctions fenêtre. **Anti-blocage indispensable.**

## Critères : égalité + opérateurs riches typés

`Criteria<T>` type-vérifie chaque champ et accepte des **opérateurs `$`-préfixés**
typés (`FieldOperators<V>`), forme **portable identique sur les 3 drivers** (mappée
/`$regex` Mongoose, `eq()/gt()/inArray()/like()` Drizzle) :

```typescript
await users.find({ email: "a@b.c" }); // égalité (valeur nue)
await users.find({ age: { $gte: 18, $lt: 65 } }); // plusieurs opérateurs = AND
await users.find({ id: { $in: ids } });
await users.find({ email: { $like: "a%" } }); // sémantique SQL (`%`, `_`)
```

Opérateurs : `$eq $ne $gt $gte $lt $lte $in $nin $like`. Le helper
`isFieldOperators(value)` (lib pure) considère une valeur comme un filtre riche
**uniquement si toutes ses clés sont des opérateurs** (sinon = égalité, ex. colonne JSON).

> `$like` est une **sémantique SQL** : native pour Drizzle, traduite en
> RegExp ancrée côté Mongoose. Le critère métier reste identique.

## Eager-load portable

`find/findOne(criteria, { relations: ["rooms"] })` charge les associations
**déclarées** dans `@entity` (`populate` Mongoose /
chargement manuel Drizzle), API identique côté métier. Aussi : `limit`, `offset`,
`order`.

## Transactions tx-aware

`repo.withTransaction(tx)` renvoie une vue du repository liée à la transaction
(toutes ses opérations passent dans `tx`), **sans état global ni CLS** :

```typescript
await orm.transaction(async (tx) => {
  const owner = await users.withTransaction(tx).create({ email: "x@y.z" });
  await rooms.withTransaction(tx).create({ name: "general", userId: owner.id });
  // throw ⇒ rollback de TOUT ; sinon commit automatique
});
```

## Décorateurs `@entity` / `@repository`

Déclaration par décorateur de classe, **sans `reflect-metadata`** (métadonnées en
`WeakMap`). Le décorateur s'exécute au chargement (sur la classe) → enregistre
l'entité dans le registre process-wide. Voir le `README.md` du module pour les exemples.

## Registres

`ormRegistry` (ORM par nom) et `entityRegistry` (entités par nom) sont des
singletons lazy. Chaque ORM s'auto-enregistre à sa construction (`Orm extends Service`,
émet `onOrmReady` une fois connecté).

## État

Contrats (P5.1), registres + classes de base (P5.2), décorateurs (P5.3), 3 adapters
(Mongoose/Drizzle, P5.4 + P7.4), opérateurs riches (P7.4). Les **4 risques
ADR-0003 sont traités** (cf [`docs/adr/0003`](../../../../../docs/adr/0003-orm-core-abstraction-repository-multi-orm.md)).
