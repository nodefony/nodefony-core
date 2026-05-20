# CLAUDE.md — @nodefony/orm-core

## Rôle

Fondation **multi-ORM** de Nodefony : contrats abstraits + registre + classes de base.
Consommé par les drivers (`@nodefony/sequelize`, `@nodefony/mongoose`, `@nodefony/drizzle`, `@nodefony/mikroorm`) et par `@nodefony/user`, session storage, security.

## Nature : LIB PURE (pas un Module runtime)

- **PAS** de classe `Module`, **PAS** d'enregistrement dans `@modules()` racine.
- C'est une dépendance lib : les **drivers** sont les Modules ; ils s'enregistrent eux-mêmes dans le `OrmRegistry` (singleton process-wide) à leur boot.
- Pourquoi : le registre est un singleton ; faire d'orm-core un Module runtime ajouterait de l'ordering pour zéro bénéfice.

## Décisions figées

- Interfaces : `IOrm`, `IEntity` (+ `IEntityRelation`), `IRepository<T>` (+ `OrmCriteria`), `ITransaction`.
- **`IOrm.getNativeConnection<C>()`** = trappe SQL/commandes brutes — **indispensable** (anti-blocage requêtes non couvertes par l'abstraction).
- Multi-managers : chaque ORM enregistré sous un nom (`db_principale`, `db_logs`...). Controller via DI pur (`@Inject('repository.user.drizzle')`), JAMAIS l'ORM en dur.
- Transactions cross-ORM (2PC) **non garanties** — une tx = un ORM.
- Critères = `OrmCriteria` (`Record<string, unknown>`) traduit par chaque adapter.

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
- ⬜ P5.4 tests intégration multi-ORM (2 ORM en parallèle) + 1 adapter Sequelize branché.

## Build / types

- Standard conforme : `dist/types/` + `exports` (généré par Rollup, jamais de `.d.ts` manuel).
- `npm run build` (rollup preserveModules).
