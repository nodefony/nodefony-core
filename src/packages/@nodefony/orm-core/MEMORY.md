# MEMORY.md — @nodefony/orm-core

## Purpose

Fondation multi-ORM. Contrats + registre + base classes. Lib pure (pas Module, pas @modules()).

## Core Components

- `IOrm`: name, connect/disconnect, isConnected, getRepository<T>(name), transaction<R>(work), `getNativeConnection<C>()` (trappe SQL brut).
- `IEntity<S,M>`: name, orm, schema, model? (post-connect), relations? `IEntityRelation` (type/target/field).
- `IRepository<T>`: find/findOne/create/update/delete/count. `OrmCriteria` = Record<string,unknown>.
- `ITransaction`: commit/rollback/savepoint/rollbackTo/getNative<C>.
- (P5.2) `OrmRegistry` singleton: register(name,IOrm)/get(name)/list(). `EntityRegistry`: entities[name][orm]. `Orm` abstract extends Service, event `onOrmReady`. `Entity` abstract.
- (P5.3) `@entity({orm,name,schema})` + `@repository(name,{entity})` — Reflect metadata, auto-register au boot.

## Config / Build

- `dist/types/` + `exports` (conforme standard). peerDep: `nodefony`.
- rollup preserveModules, external = [nodefony, tslib].

## Behaviors

- Drivers s'auto-enregistrent dans OrmRegistry à leur boot. orm-core ne charge aucun driver.
- Multi-managers : `db_principale`/`db_logs`. DI `@Inject('repository.user.drizzle')`.
- Tous ORM emit `onOrmReady` AVANT Kernel onReady (P5.2).

## Gotchas

- P5.1 = interfaces only → `index.js` quasi vide (tout en `export type`). Normal. Runtime arrive en P5.2.
- Tx cross-ORM (2PC) NON gérée — limite documentée.
- Inversion de dép STRICTE : orm-core n'importe jamais un driver concret ni http/framework.
