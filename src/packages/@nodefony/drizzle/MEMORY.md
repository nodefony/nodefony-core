# MEMORY.md — @nodefony/drizzle

Purpose: 3e adapter orm-core. Drizzle + better-sqlite3. Type-safe-first. P7.4.

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
- Tests: `npm test` integration = banc orm-core (8) + jointure très complexe (2: CTE+window+sous-req corrélées via native, LEFT JOIN typé) = 10. Banc ADR-0002 User↔Room + age.
- Load: `npm run test:load` (.mocharc.load.json, expose-gc) = 8 (charge/limites/mémoire). Insert 20k ~15k ops/s, scan ~1M/s, 30k cycles heapΔ 0.3MB, 300 conn heapΔ 0.1MB (0 fuite).
