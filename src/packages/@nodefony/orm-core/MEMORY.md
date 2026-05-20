# MEMORY.md — @nodefony/orm-core

## Purpose

Fondation multi-ORM. Contrats + registre + base classes. Lib pure (pas Module, pas @modules()).

## Core Components

- `IOrm`: name, connect/disconnect, isConnected, getRepository<T>(name), transaction<R>(work), `getNativeConnection<C>()` (trappe SQL brut).
- `IEntity<S,M>`: name, orm, schema, model? (post-connect), relations? `IEntityRelation` (type/target/field).
- `IRepository<T>`: find/findOne/create/update/delete/count. `OrmCriteria` = Record<string,unknown>.
- `ITransaction`: commit/rollback/savepoint/rollbackTo/getNative<C>.
- ✅ (P5.2, `nodefony/src/`) `OrmRegistry` class + instance `ormRegistry` (singleton process-wide, Map lazy): register/get/has/list/unregister, doublon=throw. `EntityRegistry` class + `entityRegistry` (lazy `Object.create(null)`, `entities[name][orm]`): get(name,orm?) ambigu si multi-ORM sans orm. `Orm` abstract extends Service: template `connect()`=`onConnect()`+`fire('onOrmReady',this)`, auto-register au ctor (`ormRegistry.register(this.name,this)`); abstract = onConnect/disconnect/isConnected/getRepository/transaction/getNativeConnection. `Entity` abstract: abstract name/orm/getSchema(), getter `schema`=getSchema(), `register()` (PAS auto au ctor).
- (P5.3) `@entity({orm,name,schema})` + `@repository(name,{entity})` — Reflect metadata, auto-register au boot.

## Config / Build

- `dist/types/` + `exports` (conforme standard). peerDep: `nodefony`.
- rollup preserveModules, external = [nodefony, tslib].

## Behaviors

- Drivers s'auto-enregistrent dans OrmRegistry à leur boot. orm-core ne charge aucun driver.
- Multi-managers : `db_principale`/`db_logs`. DI `@Inject('repository.user.drizzle')`.
- Tous ORM emit `onOrmReady` AVANT Kernel onReady (P5.2).

## Gotchas

- **Entity NE s'auto-register PAS au ctor** : en TS, ctor base s'exécute AVANT les initialiseurs de champs de la sous-classe → `this.name`/`this.orm` seraient `undefined`. Auto-register = job du décorateur `@entity` (P5.3, métadonnées de classe). En attendant : `entity.register()` explicite. `Orm` lui s'auto-register au ctor car `name` arrive de `Service` (super early).
- `Orm.connect()` est une **template method** — surcharger `onConnect()`, pas `connect()` (sinon `onOrmReady` plus émis).
- Registres = **classes pures sans import nodefony** (testables tsx isolé) ; `Orm` seul importe `Service`. Erreurs = `Error` natif (throws config-time, pas hot path).
- Tests unit : `npx mocha --config .mocharc.json` (mocha+tsx, `node:assert`). Pas dans le `test` script package.json (placeholder legacy `node -e`).
- P5.1 = interfaces only → `index.js` quasi vide (tout en `export type`). Normal. Runtime arrive en P5.2.
- Tx cross-ORM (2PC) NON gérée — limite documentée.
- Inversion de dép STRICTE : orm-core n'importe jamais un driver concret ni http/framework.
