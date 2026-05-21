# CLAUDE.md — @nodefony/orm-core

## Rôle

Fondation **multi-ORM** de Nodefony : contrats abstraits + registre + classes de base.
Consommé par les drivers (`@nodefony/sequelize`, `@nodefony/mongoose`, `@nodefony/drizzle`, `@nodefony/mikroorm`) et par `@nodefony/user`, session storage, security.

## Nature : LIB PURE (pas un Module runtime)

- **PAS** de classe `Module`, **PAS** d'enregistrement dans `@modules()` racine.
- C'est une dépendance lib : les **drivers** sont les Modules ; ils s'enregistrent eux-mêmes dans le `OrmRegistry` (singleton process-wide) à leur boot.
- Pourquoi : le registre est un singleton ; faire d'orm-core un Module runtime ajouterait de l'ordering pour zéro bénéfice.

## Décisions figées

- **Archi = Repository multi-ORM (pas Active Record)** — risques documentés dans [`docs/adr/0003`](../../../../docs/adr/0003-orm-core-abstraction-repository-multi-orm.md). **4 risques TRAITÉS (2026-05-21)** sur 3 adapters (Sequelize/Mongoose/Drizzle) : (1) jointure → eager-load portable (`{relations}`) + trappe native ; (2) multi-ORM simultané = YAGNI (valeur = swap d'ORM) ; (3) criteria typé + opérateurs riches **RÉSOLU** (P7.4) ; (4) repo tx-aware (`withTransaction`). ADR clôturé côté design ; reste l'industrialisation (drivers de prod sur orm-core, P7.1/P7.2).
- Interfaces : `IOrm`, `IEntity` (+ `IEntityRelation`), `IRepository<T>` (+ `OrmCriteria`), `ITransaction`.
- **`IOrm.getNativeConnection<C>()`** = trappe SQL/commandes brutes — **indispensable** (anti-blocage requêtes non couvertes par l'abstraction).
- Multi-managers : chaque ORM enregistré sous un nom (`db_principale`, `db_logs`...). Controller via DI pur (`@Inject('repository.user.drizzle')`), JAMAIS l'ORM en dur.
- Transactions cross-ORM (2PC) **non garanties** — une tx = un ORM.
- Critères = `Criteria<T>` typé par champ + **opérateurs riches** `$`-préfixés
  (`FieldOperators<V>` : `$eq $ne $gt $gte $lt $lte $in $nin $like`, helper
  `OPERATOR_KEYS`/`isFieldOperators`). Forme figée P7.4 (ADR-0003 risque #3 RÉSOLU,
  cf 3 adapters). `OrmCriteria` (`Record<string,unknown>`) reste l'échappatoire.
  Chaque adapter traduit (`Op.*` / `$`+`$regex` / `eq()/inArray()`). `$like` = SQL.

## Interdits

- Importer un driver concret (sequelize, mongoose...) — inversion de dép : orm-core ne connaît AUCUN driver.
- Importer `@nodefony/http` ou `@nodefony/framework`.
- Logique métier. `any`. `@ts-ignore`. `require()`.

## Perf

- `OrmRegistry` (P5.2) : structure lazy, pas d'alloc au boot tant qu'aucun ORM enregistré.
- Interfaces = effacées à la compilation (zéro coût runtime).

## Roadmap (MIGRATION_STATUS P5)

- ✅ P5.1 interfaces (`nodefony/interfaces/`).
- ✅ P5.2 `OrmRegistry` + `EntityRegistry` + `Orm`/`Entity` base classes (extends Service, event `onOrmReady`).
- ✅ P5.3 `@entity` + `@repository` decorators (WeakMap `metadataStore`, **sans reflect-metadata** — lib pure ; auto-register descripteur).
- ✅ P5.4 adapters Sequelize + Mongoose branchés (CRUD/relations/tx portables).
- ✅ P7.4 3ᵉ adapter Drizzle + **opérateurs riches** (`FieldOperators`/`isFieldOperators`, `nodefony/src/criteria.ts`) → ADR-0003 risque #3 résolu, rétro-appliqué aux 3 adapters. 26 tests unit.

## Build / types

- Standard conforme : `dist/types/` + `exports` (généré par Rollup, jamais de `.d.ts` manuel).
- `npm run build` (rollup preserveModules).
