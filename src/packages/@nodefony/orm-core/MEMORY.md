# MEMORY.md — @nodefony/orm-core

## Purpose

Fondation multi-ORM. Contrats + registre + base classes. Lib pure (pas Module, pas @modules()).

## Core Components

- `IOrm`: name, connect/disconnect, isConnected, getRepository<T>(name), transaction<R>(work), `getNativeConnection<C>()` (trappe SQL brut).
- `IEntity<S,M>`: name, orm, schema, model? (post-connect), relations? `IEntityRelation` (type/target/field).
- `IRepository<T>` — **il n'y a PAS de `update()`** (piège : le tutoriel historique l'enseignait).
  Lecture : `find`/`findOne`/`count`/`exists`. Écriture : `create`/`createMany`/`updateOne`/
  `updateMany`/`upsert`/`increment`. Suppression : `delete`/`deleteOne`/`findOneAndDelete`.
  Plus **`withTransaction(tx)`** (vue liée à une tx, résout la fuite repo-non-tx-aware).
  Contrat : `nodefony/interfaces/IRepository.ts`. `find/findOne(criteria, options?)` avec `RepositoryReadOptions` = `{relations?[], limit?, offset?, order?}` (eager-load portable des assos déclarées). `OrmCriteria` = Record<string,unknown> (brut) ; **`Criteria<T>` = `Partial<T> & OrmCriteria`** (égalité type-checkée + échappatoire ; opérateurs riches → Drizzle P7.4). `IEntityRelation.foreignKey?` optionnel.
- `ITransaction`: commit/rollback/savepoint/rollbackTo/getNative<C>.
- ✅ (P5.2, `nodefony/src/`) `OrmRegistry` class + instance `ormRegistry` (singleton process-wide, Map lazy): register/get/has/list/unregister, doublon=throw. `EntityRegistry` class + `entityRegistry` (lazy `Object.create(null)`, `entities[name][connector]`): get(name,connector?) ambigu si l'entité vit sur plusieurs connecteurs sans `connector`. `Orm` abstract extends Service: template `connect()`=`onConnect()`+`fire('onOrmReady',this)`, auto-register au ctor (`ormRegistry.register(this.name,this)`); abstract = onConnect/disconnect/isConnected/getRepository/transaction/getNativeConnection. `Entity` abstract: abstract name/connector/getSchema(), getter `schema`=getSchema(), `register()` (PAS auto au ctor).
- ✅ (P5.3, `nodefony/src/decorators/`) `@entity({connector,name?,schema?,relations?})` (class deco): `name` défaut = nom de classe ; construit un **descripteur `IEntity` depuis les options** (0 instanciation) → `entityRegistry.register` au chargement du module + stocke métadonnée. `@repository(name,{entity,connector?})` (class deco): **tag pur** lien repo↔entity, AUCUN registre (binding DI = adapter P5.4+). `metadataStore`: **WeakMap** (pas reflect-metadata), accesseurs `get/has EntityMeta`/`RepositoryMeta`. Types: `EntityOptions`/`RepositoryOptions`/`EntityMetadata`/`RepositoryMetadata`/`DecoratedClass`.
- ✅ (P5.3b, `nodefony/src/AbstractCrudService.ts`) **`AbstractCrudService<T, R extends IRepository<T>>` extends Service** (abstract). Socle CRUD générique : `find/findOne/findById/count` = **délégation pure** (hot path, 0 hook/event) ; `create/update/delete` = hooks template-method + events. Hooks protected no-op : `beforeCreate(data)→data`/`afterCreate(e)`/`beforeUpdate(crit,data)→data`/`afterUpdate(e)`/`beforeDelete(crit)`/`afterDelete(crit,n)`. Events fire seulement si mutation effective : `onCreated(entity)`/`onUpdated(entity)`/`onDeleted(criteria,count)`. Ctor `(name, repository, ...wiring: ServiceWiring)` — `ServiceWiring` = tuple `[container?, nc?, options?]` (exporté, `nodefony/src/serviceWiring.ts`) capté en rest-param + forwardé par spread `super(name, ...wiring)` → **fini le tunneling des 3 args de câblage** dans chaque sous-classe (DX niveau 1 ; niveau 2=ctor objet sur Service core=backlog ; niveau 3=DI @Inject = DX pas perf, singleton instancié 1×). 2ᵉ générique `R` = conserve les finders métier dans la sous-classe (ex. `UserService extends AbstractCrudService<IUser, IUserRepository>`). `findById` suppose PK `id` string (override sinon). **Singleton DI légitime** = service stateless (état/requête → ALS/Context, jamais champ). 9 tests.

## Déclarer une entité — 2 voies, frontière NETTE

- **`@entities([...], { orm })`** (`nodefony/src/decorators/entitiesDecorator.ts`) = **LA voie utilisateur**
  (app + module au schéma STATIQUE, écrit ou généré par `create entity`). Mixin `Module`, symétrique de
  `@controllers`. Descripteurs produits par **`defineEntity()`** (`nodefony/src/defineEntity.ts`) =
  `IEntityDefinition` = `IEntity` **sans `orm`** (l'ORM est une donnée de CONFIG, résolue au boot :
  entité > options du décorateur > `"default"`). `defineEntity` = identité typée, **0 effet de bord**
  (importer une entité ne l'inscrit pas). Idempotent (`has()` → skip) : un module instancié 2× ne double
  pas l'inscription ; collision réelle (2 schémas, même nom+orm) = throw du registre. 8 tests.
- **`entityRegistry.register()`** (impératif) = **plomberie de module ORM** — entités dont le schéma ou
  l'existence dépend du RUNTIME : entités framework drizzle (`createUserTable(dialect)` + `wire()` filtre
  les dialectes portés), 410 tables Dolibarr (import massif, connecteur dédié). Aucune liste constante
  possible → `@entities` ne s'y applique pas, et ne les remplacera pas.
- 🔴 **PHASE `onRegister`, JAMAIS `onBoot`** : les connecteurs se branchent à `onBoot` et créent les
  tables (`CREATE TABLE IF NOT EXISTS`). Inscrire à `onBoot` = COURSE avec le `connect()` (table absente
  selon l'ordre des écouteurs). `onRegister` est strictement antérieur. `@controllers`, lui, reste à `onBoot`.

## Config / Build

- `dist/types/` + `exports` (conforme standard). peerDep: `nodefony`.
- rolldown preserveModules, external = [nodefony, tslib].

## Behaviors

- Drivers s'auto-enregistrent dans OrmRegistry à leur boot. orm-core ne charge aucun driver.
- Multi-managers : `db_principale`/`db_logs`. DI `@Inject('repository.user.drizzle')`.
- Tous ORM emit `onOrmReady` AVANT Kernel onReady (P5.2).

## Data plane ORM — graphe canonique IA-first (`OrmAdminApi.ts`, 2026-05-22)

- **But** : 1 représentation canonique sérialisable du modèle (ORMs+entités+colonnes+relations) qui sert ERD Studio (**React Flow** choisi) + **contexte IA** (text-to-SQL/RAG) + interop. Le diagramme = projection ; la DONNÉE = la pièce maîtresse.
- **Types** (`interfaces/IOrmGraph.ts`) : `IColumnInfo` (name/type/primaryKey/nullable/unique), `IRelationInfo`, `IEntityGraphNode` (name/orm/columns/relations), `IOrmSummary` (name/default/connected/entityCount), `IOrmGraph`.
- **`IOrm.describeEntity?(name): IColumnInfo[]`** — OPTIONNEL ; base `Orm` retourne `[]` (relations seules), adapters surchargent. **Drizzle FAIT** (`getTableConfig`). Mongoose = TODO (`schema.paths`).
- **`buildOrmGraph(ormFilter?)`** lit `ormRegistry`+`entityRegistry`. **`toDbml(graph)`** = export DBML (Refs dérivés des relations, convention FK `<source>Id`/`<target>Id`). SQL DDL / JSON Schema = TODO.
- **`createOrmAdminApi()`** : endpoints `orms`/`entities`/`entity/{name}`/`graph`/`export/{format}` (`?connector=` filtre). Succès=donnée brute ; 400(format)/404(entité) via `IAdminResponse`.
- **`registerOrmAdminApi(broker)`** idempotent (`has("orm")`). orm-core=lib pure → monté par module driver (**Drizzle `onKernelBoot`**), lit registres globaux → couvre tous les ORM. Runtime OK : `/nodefony/orm/api/*`.
- Tests : `tests/unit/OrmAdminApi.test.ts` (6, **vitest** ; singleton+cleanup afterEach ; relations+DBML Refs).

## Sonde FLUX ORM — débit/latence/slow (`QueryFlowMonitor.ts` + endpoint `flow`, 2026-05-23)

- **But** : observer le DÉBIT réel de requêtes (queries/s, latence moy+EWMA, requêtes lentes) en supervision — distinct du **profiler par-requête** (debug bar, buffer ALS dev-only) ET de la **santé** (`connection/health` : ping/stockage/pool). Patron sondes+hub.
- **`queryFlowMonitor`** (singleton, `nodefony/src/QueryFlowMonitor.ts`) : process-wide, **indépendant de l'ALS**, **lazy** (Map au 1ᵉʳ record, ring slow au 1ᵉʳ lent). API : `enabled` (**OFF défaut** → coût nul prod/bancs), `slowMs` (défaut 50), `setEnabled`, `record(connector, durationMs, sql?)`, `snapshot(connector, vendor): IQueryFlow`. EWMA α=0.2 ; ring slow borné **20** (newest-first). Le `sql` n'est fourni par le tap que sur le **chemin lent** (rare) → **jamais `toSQL()` au cas nominal**.
- **Débit/s NON stocké** : dérivé côté lecteur (delta `total`/`ts` entre 2 rapports, comme CPU%) → 0 état mutable à la lecture, robuste sous saturation event-loop. **0 persistance** (RAM only, reset au restart — une sonde n'écrit jamais dans la base qu'elle observe).
- **`buildOrmFlow(filter?): IOrmFlowReport`** (`OrmAdminApi.ts`) : `{enabled, ts, instanceId, slowMs, connectors[]}`. Lecture pure (n'émet AUCUNE requête, ≠ `buildConnectionHealth` qui ping). Endpoint `GET /nodefony/orm/api/flow` (`?connector=`).
- **Types** `interfaces/IOrmFlow.ts` : `ISlowQuery`/`IQueryFlow`/`IOrmFlowReport`. Exportés (+ `queryFlowMonitor`).
- **Gating** = job du driver (orm-core ignore l'env) : Drizzle `DrizzleService.onBoot` → `setEnabled(env!==production)` (override `NODEFONY_ORM_FLOW=1/0`).
- **Couverture** : seul **Drizzle** alimente le tap (`DrizzleRepository.#prof`). Mongoose=TODO (pas de tap par-requête → middleware à créer). Connecteurs non câblés → snapshot neutre (0).

## Gotchas

- **Entity NE s'auto-register PAS au ctor** : en TS, ctor base s'exécute AVANT les initialiseurs de champs de la sous-classe → `this.name`/`this.orm` seraient `undefined`. Auto-register = job du décorateur `@entity` (P5.3, métadonnées de classe). Sans décorateur : `entity.register()` explicite. `Orm` lui s'auto-register au ctor car `name` arrive de `Service` (super early).
- **Décorateurs SANS reflect-metadata (P5.3)** : orm-core ne fait pas de DI par type de constructeur (`design:paramtypes`) → pas besoin du polyfill. Métadonnées dans un `WeakMap` maison (`metadataStore.ts`) → lib pure, 0 dep runtime (juste peer `nodefony`). `emitDecoratorMetadata:true` reste OK : le helper `__metadata` est gardé (`typeof Reflect.metadata === "function"`) → no-op si polyfill absent, pas de crash. Diverge volontairement de core/framework (eux ont besoin de reflect pour l'Injector DI).
- **@entity + Entity.register() = doublon** : ne pas appeler les deux pour la même entité (le registre throw sur doublon name+orm). Décorateur OU register() explicite, pas les deux.
- **Décorateur enregistre dans le singleton** `entityRegistry` au chargement du module → tests décorateurs doivent `unregister` en `afterEach`.
- `Orm.connect()` est une **template method** — surcharger `onConnect()`, pas `connect()` (sinon `onOrmReady` plus émis).
- Registres = **classes pures sans import nodefony** (testables tsx isolé) ; `Orm` seul importe `Service`. Erreurs = `Error` natif (throws config-time, pas hot path).
- Tests unit : `npm test` (`vitest run`, convention universelle ; `node:assert`).
- P5.1 = interfaces only → `index.js` quasi vide (tout en `export type`). Normal. Runtime arrive en P5.2.
- Tx cross-ORM (2PC) NON gérée — limite documentée.
- Inversion de dép STRICTE : orm-core n'importe jamais un driver concret ni http/framework.
