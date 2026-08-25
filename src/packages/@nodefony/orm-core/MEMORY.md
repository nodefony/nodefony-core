# MEMORY.md — @nodefony/orm-core

## Purpose

Fondation multi-ORM. Contrats + registre + base classes. Lib pure (pas Module, pas @modules()).

## Core Components

- `IOrm`: name, connect/disconnect, isConnected, getRepository<T>(name), transaction<R>(work), `getNativeConnection<C>()` (trappe SQL brut).
- **Résilience de connexion — contrat porté par `Orm`, PAS par les adapters.** `isConnected()` est CONCRET dans la classe de base (état `protected alive`) ; un adapter ne le réimplémente pas. Deux hooks `protected` qu'il APPELLE depuis les événements de SON driver : `connectionLost(reason)` / `connectionRestored()`. Tous deux IDEMPOTENTS (un pool de N connexions émet N erreurs pour 1 coupure ; `pg` émet `connect` à chaque client même sans incident). Événements `Service` émis : `onOrmLost` (avec la raison), `onOrmRestored`.
- **`connectionMonitor`** : `recordLost`/`recordReconnect` = compteurs CONSTATÉS. `reconnectCount` n'est PLUS dérivé de `connectCount-1` (une reprise de driver ne repasse jamais par `connect()`, et 2 connecteurs comptaient une reconnexion fantôme). `connectedSince` retombe à `null` à la perte — un uptime qui court pendant une coupure se lit comme une preuve de santé.
- **Battement de cœur** (`heartbeatMs`, défaut 30 s, `NF_ORM_HEARTBEAT_MS`, `0` = éteint) : sonde `IOrm.ping()` périodiquement, minuterie `unref()` (ne retient jamais le process), auto-arrêt si déconnecté sans perte en souffrance. 🔴 **`heartbeatTimeoutMs` (5 s) n'est pas un détail** : sans montre propre, `ping()` PEND sur une base gelée et le battement pend avec elle (mesuré : 30 s de `docker pause`, zéro détection). Raison d'être : `pg`/`mysql2` n'ont AUCUNE surveillance de serveur — seul le driver Mongo en a une (SDAM) —, donc une coupure sous trafic leur restait invisible. **`beatNow()`** (`protected`) déclenche un battement HORS période : pour un adapter dont le driver émet un signal suspect mais non concluant (fermeture d'un socket du pool — indistinguable d'un recyclage de connexion inactive). Il ne tranche pas à la place du battement, il l'avance : sans lui un dialecte muet reste marqué connecté jusqu'à 30 s après la coupure, quand `pg` bascule aussitôt. La garde `#beating` fait qu'un pool dont N connexions tombent ensemble ne sonde qu'une fois.
- **`liveness`** (`"events" | "assumed"`, getter, défaut **`"assumed"`**) : ce que l'adapter SAIT de son état. Pas abstrait — l'imposer casserait la compilation de tout adapter tiers ; le défaut prudent dit la vérité d'un adapter qui ne câble rien. `buildOrmLeanHealth().assumed` compte les connecteurs « supposés vivants », et la somme voyage jusqu'à l'agrégat cross-pod.
- **`connect()` REJOUABLE** : le dépôt s'en sert (rejouer un DDL sur une base existante). L'adapter doit reprendre ses ressources en tête d'`onConnect()`, sinon pool fuité + écoutes zombies.
- **Contrat de test portable** : `tests/unit/ormResilience.test.ts` (sans driver, sans infra) — tout adapter futur doit le passer. La TRADUCTION driver→contrat se prouve chez chaque adapter (`tests/integration/outage.test.ts`), la coupure RÉELLE au banc `NF_RUN_DB_OUTAGE=1` (+ `NF_DB_OUTAGE_{PG,MYSQL,MONGO}_CONTAINER`).
- `IEntity<S,M>`: name, orm, schema, model? (post-connect), relations? `IEntityRelation` (type/target/field).
- `IRepository<T>` — **il n'y a PAS de `update()`** (piège : le tutoriel historique l'enseignait).
  Lecture : `find`/`findOne`/`count`/`countDistinct`/`exists`. Écriture : `create`/`createMany`/`updateOne`/
  `updateMany`/`upsert`/`increment`. Suppression : `delete`/`deleteOne`/`findOneAndDelete`.
  Plus **`withTransaction(tx)`** (vue liée à une tx, résout la fuite repo-non-tx-aware).
  **`$or`** dans `Criteria` : disjonction de critères complets (`{a:1, $or:[x,y]}` = `a=1 AND (x OR y)`),
  traduite par `or()` en Drizzle et `$or` en Mongo. Existe parce que certaines questions du domaine ne
  sont PAS des conjonctions — « un jeton utilisable » = _sans échéance_ OU _échéance à venir_ ; sans
  elle chaque store descendait à son SQL natif, donc la même règle écrite N fois. Limitée à `$or`
  (`$and` = déjà le défaut ; `$not` demanderait de définir la négation d'un `NULL` sur 3 dialectes).
  **`countDistinct(champ, critère?)`** = `COUNT(DISTINCT col)` SQL / `$match`+`$group`+`$count` Mongo
  / `Set` en mémoire — la déduplication reste dans le moteur (compter côté appelant supposerait de
  rapatrier la colonne entière). **`NULL`/absent non compté**, comme en SQL : l'absence de valeur
  n'est pas une valeur distincte. Répond à « combien de personnes derrière ces sessions ? », que
  `count` ne sait pas poser. Garde dans le banc de contrat des 3 dialectes (`repository-contract.ts`).
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

## Data plane ORM — graphe canonique IA-first (`OrmAdminApi.ts`)

- **But** : 1 représentation canonique sérialisable du modèle (ORMs+entités+colonnes+relations) qui sert ERD Studio (**React Flow** choisi) + **contexte IA** (text-to-SQL/RAG) + interop. Le diagramme = projection ; la DONNÉE = la pièce maîtresse.
- **Types** (`interfaces/IOrmGraph.ts`) : `IColumnInfo` (name/type/primaryKey/nullable/unique), `IRelationInfo`, `IEntityGraphNode` (name/orm/columns/relations), `IOrmSummary` (name/default/connected/entityCount), `IOrmGraph`.
- **`IOrm.describeEntity?(name): IColumnInfo[]`** — OPTIONNEL ; base `Orm` retourne `[]` (relations seules), adapters surchargent. **Drizzle FAIT** (`getTableConfig`). Mongoose = TODO (`schema.paths`).
- **`buildOrmGraph(ormFilter?)`** lit `ormRegistry`+`entityRegistry`. **`toDbml(graph)`** = export DBML (Refs dérivés des relations, convention FK `<source>Id`/`<target>Id`). SQL DDL / JSON Schema = TODO.
- **`createOrmAdminApi()`** : endpoints `orms`/`entities`/`entity/{name}`/`graph`/`export/{format}` (`?connector=` filtre). Succès=donnée brute ; 400(format)/404(entité) via `IAdminResponse`.
- **`registerOrmAdminApi(broker)`** idempotent (`has("orm")`). orm-core=lib pure → monté par module driver (**Drizzle `onKernelBoot`**), lit registres globaux → couvre tous les ORM. Runtime OK : `/nodefony/orm/api/*`.
- Tests : `tests/unit/OrmAdminApi.test.ts` (6, **vitest** ; singleton+cleanup afterEach ; relations+DBML Refs).

## Sonde FLUX ORM — débit/latence/slow (`QueryFlowMonitor.ts` + endpoint `flow`)

- **But** : observer le DÉBIT réel de requêtes (queries/s, latence moy+EWMA, requêtes lentes) en supervision — distinct du **profiler par-requête** (debug bar, buffer ALS dev-only) ET de la **santé** (`connection/health` : ping/stockage/pool). Patron sondes+hub.
- **`queryFlowMonitor`** (singleton, `nodefony/src/QueryFlowMonitor.ts`) : process-wide, **indépendant de l'ALS**, **lazy** (Map au 1ᵉʳ record, ring slow au 1ᵉʳ lent). API : `enabled` (**OFF défaut** → coût nul prod/bancs), `slowMs` (défaut 50), `setEnabled`, `record(connector, durationMs, sql?)`, `snapshot(connector, vendor): IQueryFlow`. EWMA α=0.2 ; ring slow borné **20** (newest-first). Le `sql` n'est fourni par le tap que sur le **chemin lent** (rare) → **jamais `toSQL()` au cas nominal**.
- **Débit/s NON stocké** : dérivé côté lecteur (delta `total`/`ts` entre 2 rapports, comme CPU%) → 0 état mutable à la lecture, robuste sous saturation event-loop. **0 persistance** (RAM only, reset au restart — une sonde n'écrit jamais dans la base qu'elle observe).
- **`buildOrmFlow(filter?): IOrmFlowReport`** (`OrmAdminApi.ts`) : `{enabled, ts, instanceId, slowMs, connectors[]}`. Lecture pure (n'émet AUCUNE requête, ≠ `buildConnectionHealth` qui ping). Endpoint `GET /nodefony/orm/api/flow` (`?connector=`).
- **Types** `interfaces/IOrmFlow.ts` : `ISlowQuery`/`IQueryFlow`/`IOrmFlowReport`. Exportés (+ `queryFlowMonitor`).
- **Gating** = job du driver (orm-core ignore l'env) : Drizzle `DrizzleService.onBoot` → `setEnabled(env!==production)` (override `NF_ORM_FLOW=1/0`).
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
