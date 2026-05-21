# MEMORY.md — @nodefony/drizzle

Purpose: 3e adapter orm-core + module bootable. Drizzle + better-sqlite3. Type-safe-first. P7.4.

## Module bootable (2026-05-21)

- `index.ts` default export = `Drizzle extends Module` + `@services([DrizzleService])`. Ajouté à `@modules()` app (après sequelize). ORM SQL par défaut.
- `nodefony/service/DrizzleService.ts` : ctor `super(name, module.container, module.notificationsCenter, module.options)` ; `kernel.once("onBoot")` → `connectAll()` (1 DrizzleOrm/connecteur, mkdir dossier db) ; `onTerminate` → disconnectAll. `getOrm(name="default")`.
- `nodefony/config/config.ts` : `{ connectors: { default: { filename: <root>/nodefony/databases/nodefony-drizzle.db } } }`. Surcharge app possible via `config/modules/drizzle-config.ts`.
- better-sqlite3 = **dependencies** (runtime), pas devDeps.
- Boot vérifié : `MODULE ADD : drizzle` + `Drizzle ORM "default" connected` + db créée, 4 serveurs UP, health 200.

## Adapter User (P5.9 — ORM par défaut, fait EN PREMIER)

- `nodefony/src/user/` : `userTable` (sqliteTable, JSON+boolean modes), `createUserEntity(orm)`/`registerUserEntity(orm)` (binding ORM dynamique, **avant** connect), `DrizzleUserRepository implements IUserRepository` (`from(orm)`).
- Mappe ligne ↔ `BaseUser` (comportement). `findByIdentifier` + `findBySocialProvider` (json_each **bindé**, Shadow User). peerDep `@nodefony/user` ajoutée + externalisée rollup (sinon bundle → casse sur @node-rs/bcrypt natif).
- ⚠️ **Défauts via `$defaultFn` (JS), PAS `.default()` SQL** : le DDL dérivé n'émet pas les DEFAULT → NOT NULL casserait.
- ⚠️ Test cleanup : `entityRegistry.unregister("User", ORM)` **scopé** (sans orm = efface le bucket entier = contamine le banc P7.4).

## Core Components

- `DrizzleOrm extends Orm` : onConnect → `new BetterSqlite3(filename)` + `drizzle(client)`. Schema-as-code (entity.schema = table). DDL via `getTableConfig()`. tx manuelle.
- `DrizzleRepository<T>` : CRUD + `#where` (criteria → eq/and/gt/inArray/like) + eager-load manuel (`#populate`, 1 req IN par relation) + `withTransaction`.
- `DrizzleTransaction` : BEGIN/COMMIT/ROLLBACK sur client (managée). `getNative()` = même db (1 connexion). savepoint = SQL brut.
- `DrizzleOrmOptions { filename }` (`:memory:` par défaut).

## Behaviors

- Opérateurs riches: `FieldOperators` (orm-core) `$eq $ne $gt $gte $lt $lte $in $nin $like`. `isFieldOperators()` détecte. `$like`=SQL natif.
- DDL dérivé: `col.name/getSQLType()/primary/notNull/isUnique`. CREATE TABLE IF NOT EXISTS.
- Relations: one-to-many FK=`<source>Id` sur target; many/one-to-one FK=`<target>Id` sur source. localKey/targetKey='id'.
- Native: `getNativeConnection<DrizzleDb>()` → `db.all(sql\`...\`)`.

## Gotchas

- better-sqlite3 SYNCHRONE → pas `db.transaction(asyncCb)` (committe avant await). → BEGIN/COMMIT manuel, connexion unique.
- mocha/tsx = RACINE (pas de devDeps locales → sinon CJS resolve ERR_PACKAGE_PATH_NOT_EXPORTED sur orm-core import-only exports).
- db typé `BetterSQLite3Database<Record<string,never>>` (pas de `db.query`, eager-load manuel).
- OFFSET sans LIMIT → `limit(-1)`.
- Node 26: better-sqlite3 12.10 OK (prebuild). drizzle-orm 0.45.2.

## Config

- peerDeps: nodefony, @nodefony/http, @nodefony/orm-core. deps: drizzle-orm. devDep: better-sqlite3.
- Tests: `npm test` integration = banc orm-core (8) + jointure très complexe (2) + SessionStorage IoC/CRUD (8) + **User adapter P5.9 (8)** = 26. Banc ADR-0002 User↔Room + age.
- Load: `npm run test:load` (.mocharc.load.json, expose-gc) = 8 (charge/limites/mémoire). Insert 20k ~15k ops/s, scan ~1M/s, 30k cycles heapΔ 0.3MB, 300 conn heapΔ 0.1MB (0 fuite).
- Charge SESSION runtime (skill load-test, route `/nodefony/test/rest/session/set/k/v`, HTTP/2) : 3000/80 = 409 RPS p99 282ms ; 5000/150 = 408 RPS p99 562ms ; 100% 200, delta sessions EXACT (0 perte/doublon), 0 erreur. **Plafond ~408 RPS = better-sqlite3 SYNCHRONE mono-connexion** (writes sérialisés) — pas un bug, Postgres/MySQL paralléliserait. Concurrence ↑ = latence ↑, pas débit.
