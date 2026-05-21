# MEMORY.md — @nodefony/orm-core

## Purpose

Fondation multi-ORM. Contrats + registre + base classes. Lib pure (pas Module, pas @modules()).

## Core Components

- `IOrm`: name, connect/disconnect, isConnected, getRepository<T>(name), transaction<R>(work), `getNativeConnection<C>()` (trappe SQL brut).
- `IEntity<S,M>`: name, orm, schema, model? (post-connect), relations? `IEntityRelation` (type/target/field).
- `IRepository<T>`: find/findOne/create/update/delete/count + **`withTransaction(tx)`** (vue liée à une tx, résout fuite repo-non-tx-aware). `find/findOne(criteria, options?)` avec `RepositoryReadOptions` = `{relations?[], limit?, offset?, order?}` (eager-load portable des assos déclarées). `OrmCriteria` = Record<string,unknown> (brut) ; **`Criteria<T>` = `Partial<T> & OrmCriteria`** (égalité type-checkée + échappatoire ; opérateurs riches → Drizzle P7.4). `IEntityRelation.foreignKey?` optionnel.
- `ITransaction`: commit/rollback/savepoint/rollbackTo/getNative<C>.
- ✅ (P5.2, `nodefony/src/`) `OrmRegistry` class + instance `ormRegistry` (singleton process-wide, Map lazy): register/get/has/list/unregister, doublon=throw. `EntityRegistry` class + `entityRegistry` (lazy `Object.create(null)`, `entities[name][orm]`): get(name,orm?) ambigu si multi-ORM sans orm. `Orm` abstract extends Service: template `connect()`=`onConnect()`+`fire('onOrmReady',this)`, auto-register au ctor (`ormRegistry.register(this.name,this)`); abstract = onConnect/disconnect/isConnected/getRepository/transaction/getNativeConnection. `Entity` abstract: abstract name/orm/getSchema(), getter `schema`=getSchema(), `register()` (PAS auto au ctor).
- ✅ (P5.3, `nodefony/src/decorators/`) `@entity({orm,name?,schema?,relations?})` (class deco): `name` défaut = nom de classe ; construit un **descripteur `IEntity` depuis les options** (0 instanciation) → `entityRegistry.register` au chargement du module + stocke métadonnée. `@repository(name,{entity,orm?})` (class deco): **tag pur** lien repo↔entity, AUCUN registre (binding DI = adapter P5.4+). `metadataStore`: **WeakMap** (pas reflect-metadata), accesseurs `get/has EntityMeta`/`RepositoryMeta`. Types: `EntityOptions`/`RepositoryOptions`/`EntityMetadata`/`RepositoryMetadata`/`DecoratedClass`.

## Config / Build

- `dist/types/` + `exports` (conforme standard). peerDep: `nodefony`.
- rollup preserveModules, external = [nodefony, tslib].

## Behaviors

- Drivers s'auto-enregistrent dans OrmRegistry à leur boot. orm-core ne charge aucun driver.
- Multi-managers : `db_principale`/`db_logs`. DI `@Inject('repository.user.drizzle')`.
- Tous ORM emit `onOrmReady` AVANT Kernel onReady (P5.2).

## Gotchas

- **Entity NE s'auto-register PAS au ctor** : en TS, ctor base s'exécute AVANT les initialiseurs de champs de la sous-classe → `this.name`/`this.orm` seraient `undefined`. Auto-register = job du décorateur `@entity` (P5.3, métadonnées de classe). Sans décorateur : `entity.register()` explicite. `Orm` lui s'auto-register au ctor car `name` arrive de `Service` (super early).
- **Décorateurs SANS reflect-metadata (P5.3)** : orm-core ne fait pas de DI par type de constructeur (`design:paramtypes`) → pas besoin du polyfill. Métadonnées dans un `WeakMap` maison (`metadataStore.ts`) → lib pure, 0 dep runtime (juste peer `nodefony`). `emitDecoratorMetadata:true` reste OK : le helper `__metadata` est gardé (`typeof Reflect.metadata === "function"`) → no-op si polyfill absent, pas de crash. Diverge volontairement de core/framework (eux ont besoin de reflect pour l'Injector DI).
- **@entity + Entity.register() = doublon** : ne pas appeler les deux pour la même entité (le registre throw sur doublon name+orm). Décorateur OU register() explicite, pas les deux.
- **Décorateur enregistre dans le singleton** `entityRegistry` au chargement du module → tests décorateurs doivent `unregister` en `afterEach`.
- `Orm.connect()` est une **template method** — surcharger `onConnect()`, pas `connect()` (sinon `onOrmReady` plus émis).
- Registres = **classes pures sans import nodefony** (testables tsx isolé) ; `Orm` seul importe `Service`. Erreurs = `Error` natif (throws config-time, pas hot path).
- Tests unit : `npx mocha --config .mocharc.json` (mocha+tsx, `node:assert`). Pas dans le `test` script package.json (placeholder legacy `node -e`).
- P5.1 = interfaces only → `index.js` quasi vide (tout en `export type`). Normal. Runtime arrive en P5.2.
- Tx cross-ORM (2PC) NON gérée — limite documentée.
- Inversion de dép STRICTE : orm-core n'importe jamais un driver concret ni http/framework.
