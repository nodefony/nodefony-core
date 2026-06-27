# ORM (orm-core/drizzle/mongoose) — référence complète (recettes + API + internals + gotchas)

> Chargé à la demande par `SKILL.md`. **1 concern = 1 fichier** : recettes copier-coller PUIS API publique + internals + gotchas du module. Vérité courante (édition en place, git = historique).

## ▸ Partie A — Recettes (copier-coller, usage)

> Chargé à la demande par `SKILL.md`. Drizzle = référence. Détail-journal = `git log`.

## Sommaire

- Définir une entité — `@entity` schema-as-code (Drizzle)
- Repository — contrat portable (`IRepository<T>`)
- Service CRUD — `AbstractCrudService<T, R>` (source de vérité métier)
- Transactions (1 tx = 1 ORM ; 2PC cross-ORM non garanti)
- Data plane ORM (Studio/IA)
- Gotchas ORM

---

## 5. ORM — Entity / Repository / Service CRUD

**Archi = Repository multi-ORM (pas Active Record)** — ADR-0003. `@nodefony/orm-core` = **lib pure**
(contrats + registres + base classes, JAMAIS un Module, jamais dans le manifeste `config.modules`). Les **drivers** sont
les Modules et s'auto-enregistrent dans `ormRegistry` à leur boot. **ORM par défaut = Drizzle** (SQL,
schema-as-code) ; Mongoose = NoSQL. Un nouvel adapter → **commencer par Drizzle**.
Contrats (core) : `IOrm` · `IEntity<S,M>` (+`IEntityRelation`) · `IRepository<T>` (+`Criteria<T>`/`FieldOperators`) · `ITransaction`.

### A. Définir une entité — `@entity` schema-as-code (Drizzle, RECOMMANDÉ)

```typescript
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { entity } from "@nodefony/orm-core";

export const articleTable = sqliteTable("Article", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()), // ⚠️ $defaultFn (JS), PAS .default()
  title: text("title").notNull(),
  tags: text("tags", { mode: "json" }).$defaultFn(() => []), // colonnes JSON = mode:"json"
  authorId: text("authorId").notNull(),
  published: integer("published", { mode: "boolean" }).$defaultFn(() => false),
  createdAt: integer("createdAt")
    .notNull()
    .$defaultFn(() => Date.now()),
});
export interface ArticleRow {
  id: string;
  title: string;
  tags: unknown;
  authorId: string;
  published: boolean;
  createdAt: number;
}

@entity({
  orm: "default",
  name: "Article",
  schema: articleTable,
  module: "blog",
  relations: [
    {
      type: "many-to-one",
      target: "User",
      field: "author",
      foreignKey: "authorId",
    },
  ],
})
class ArticleEntity {} // classe VIDE — le descripteur vient des options
export default ArticleEntity;
```

- ⚠️ **Défauts via `$defaultFn` (JS-level), JAMAIS `.default()` SQL** : le DDL est dérivé de
  `getTableConfig()` qui **n'émet pas** les `DEFAULT` → une colonne `NOT NULL` sans valeur casserait l'INSERT.
- `@entity` enregistre le descripteur dans `entityRegistry` **au chargement du module** (0 instanciation) →
  `DrizzleOrm` crée la table à la connexion. `module:` sert au regroupement ERD Studio.
- **Binding ORM dynamique** (nom de connecteur dépend de la config, ex. User) → pas d'`@entity` figé :
  `createXxxEntity(orm)` + `registerXxxEntity(orm)` appelé **avant** `orm.connect()`.

### C. Repository — contrat portable (`IRepository<T>`)

```typescript
const repo = orm.getRepository<ArticleRow>("Article");
await repo.find(
  { published: true, createdAt: { $gte: cutoff } }, // Criteria<T> typé + opérateurs riches
  {
    relations: ["author"],
    order: [["createdAt", "DESC"]],
    limit: 20,
    offset: 0,
  },
); // RepositoryReadOptions
await repo.findOne({ id });
await repo.create({ title: "x", authorId }); // → entité persistée (id/défauts générés)
await repo.update({ id }, { published: true }); // → entité|null
await repo.delete({ id }); // → number supprimé
await repo.count({ published: true });
```

- **Opérateurs riches** (`FieldOperators`, combinés en AND) : `$eq $ne $gt $gte $lt $lte $in $nin $like`
  (`$like` = SQL `%`/`_`). `{ age: { $gte: 18, $lt: 65 } }`. Échappatoire : `OrmCriteria` (`Record<string,unknown>`).
- **Eager-load** = `options.relations` (assos **déclarées** dans `@entity`). Jointure arbitraire →
  trappe native `orm.getNativeConnection<C>()` (SQL/commandes brutes — anti-blocage).
- Tout est **bindé/paramétré** (jamais de concat de valeurs).

### D. Service CRUD — `AbstractCrudService<T, R>` (la source de vérité métier)

```typescript
import { AbstractCrudService, type ServiceWiring } from "@nodefony/orm-core";
import { injectable, inject } from "nodefony";

@injectable({ singleton: true, name: "article-service" })
export class ArticleService extends AbstractCrudService<
  ArticleRow,
  IArticleRepository
> {
  constructor(
    @inject("repository.article") repository: IArticleRepository,
    ...wiring: ServiceWiring
  ) {
    super("articles", repository, ...wiring); // ServiceWiring = [container?, nc?, options?] forwardé (fin du tunneling)
  }
  // hérité : find/findOne/findById/count (délégation pure, hot path) · create/update/delete (hooks + events)
  // override les hooks template-method pour le métier :
  protected override async beforeCreate(data: Partial<ArticleRow>) {
    return { ...data, title: data.title?.trim() };
  }
  // events émis si mutation effective : "onCreated"(entity) / "onUpdated"(entity) / "onDeleted"(criteria, count)
}
```

- **Singleton stateless LÉGITIME** : l'état par requête (user/tenant/tx) vit dans `Context`/ALS, **jamais**
  un champ du service. Service = transport-agnostique → REST/WS/GraphQL/CLI = adaptateurs minces qui l'appellent.
- `findById(id)` suppose **PK `id` string** (override sinon). 2ᵉ générique `R` = garde les finders métier
  (ex. `UserService extends AbstractCrudService<IUser, IUserRepository>`, `super("users", repository, ...wiring)`).
- **DI** : `@inject("repository.<entity>")` (le binding repo↔ORM est fait par l'adapter) — JAMAIS l'ORM en dur.
  `@repository(name, {entity, orm?})` = tag pur lien repo↔entity.

### E. Transactions (une tx = un ORM ; 2PC cross-ORM NON garanti)

```typescript
await orm.transaction(async (tx) => {
  const txRepo = repo.withTransaction(tx);        // vue liée à la tx (résout « repo non tx-aware »)
  await txRepo.create({ ... }); await txRepo.update({ id }, { ... });
});                                                // commit auto au retour, rollback si throw
```

### F. Data plane ORM (Studio/IA)

`describeEntity(name)` (surchargé par Drizzle via `getTableConfig`) alimente le graphe canonique
(`buildOrmGraph` → ERD React Flow + contexte IA + DBML). Monté par le module driver
(`registerOrmAdminApi(broker)` en `onKernelBoot`, idempotent) → `/nodefony/orm/api/{orms,entities,entity/{name},graph,counts,connection/health,flow,export/{format}}`.

**3 sondes ORM, ne pas confondre** (patron sondes+hub) :

- **profiler par-requête** (`RequestContext.queries`, debug bar) : SQL de CHAQUE requête tracée, dev-only, **coût nul hors requête tracée** (buffer ALS absent).
- **santé** (`connection/health` + canal `orm:health`) : état/ping/latence-fenêtre/erreurs/reconnexions + sonde profonde `IOrm.probe()` (storage PRAGMA / pool). Générique (`buildConnectionHealth` itère `ormRegistry`, ping+probe), **émet une requête** (ping).
- **flux** (`flow` + canal `orm:flow`, `queryFlowMonitor`, 2026-05-23) : DÉBIT (queries/s) + latence moy/EWMA + requêtes lentes. **Process-wide, indépendant de l'ALS**, **OFF par défaut** (gaté par le driver : `setEnabled(env!==production)`, override `NODEFONY_ORM_FLOW`). Lazy, ring slow borné 20, `toSQL()` **seulement sur le chemin lent**. **Per-connecteur** : `Map<connecteur>` (clé = nom registre, pas vendor) → le repo passe son `ormName` au tap. Débit/s **dérivé** (delta `total`/`ts`), **0 persistance** (RAM, reset au restart — une sonde n'écrit jamais dans la base qu'elle observe). Câblé : **Drizzle** seul (Mongoose = TODO middleware). Ticker realtime = `createBrokerTicker` générique (réutilisé santé+flux).
- **lean cluster** (`buildOrmLeanHealth()` orm-core, 2026-05-25) : agrégat **per-instance** de TOUS les connecteurs (registre + `queryFlowMonitor` + `connectionMonitor`) → `IOrmLeanHealth` (`connectors/connected/queryTotal/slowTotal/errorTotal/reconnectTotal/maxEwmaMs`). **0 ping / 0 toSQL**, O(N connecteurs). Branché dans le report de sonde cluster via le **seam core** `setOrmHealthProvider(buildOrmLeanHealth)` (driver Drizzle au boot) → **`framework` n'importe PAS `orm-core`**. Lu par `buildOwnHealth` (`IRealtimeHealth.orm`), agrégé pod dans `mergeClusterHealth.totals.orm`. Cf RETEX §11 + [[project_cluster_drilldown_kit]].
- **rich @pid (drill cluster, 2026-05-25)** : diagnostic ORM COMPLET d'UN worker EXACT (`{ health: buildConnectionHealth(), flow: buildOrmFlow() }`) pour la page `/nodefony/orm/<pid>` en cluster. **Calqué `dashboard:supervision@<pid>`** (voie B1 : enrichir le colis broadcast, pas un 2ᵉ flux). Pièces : (1) **facette d'enrich** `ClusterProbeFacet` (`"process"|"orm"`, défaut process) sur `IClusterProbeCtl`/`IClusterProbeEnrich` (core) → 2 drills indépendants, « on paie ce qu'on regarde » par sonde ; (2) **seam core** `setOrmRichProvider(async ()=>blob)`/`readOrmRich()` (driver Drizzle, **async** car `connection/health` ping) — opaque côté core/framework ; (3) `ClusterProbeClient` : facette `"orm"` → **ticker de cache async** `#startOrmRich` (le report sync joint `payload.ormRich`, absent hors drill) ; (4) studio `orm:rich@<pid>` = **canal combiné** (1 canal = 1 enrich = **pas de ref-count**, le hub dédoublonne par nom) → local broker ticker si `pid===process.pid`, sinon `createClusterOrmTicker` (`requestEnrich(pid,true,"orm")` au sub, `false` au dispose). Prouvé e2e cross-process (`cluster-orm-rich-e2e.mjs`). Cf RETEX §11 + [[project_cluster_drilldown_kit]].

### Gotchas ORM

- **`Entity` ne s'auto-register PAS au ctor** (init des champs de la sous-classe APRÈS `super()` → `name`/`orm`
  seraient `undefined`). Auto-register = job du décorateur `@entity` (métadonnée de classe). Sans déco → `entity.register()` explicite.
- **`@entity` OU `register()`, jamais les deux** (registre throw sur doublon `name+orm`). Tests décorateurs → `unregister` (scopé à l'orm) en `afterEach`.
- **orm-core = décorateurs SANS reflect-metadata** (WeakMap maison) → 0 dep runtime ; diverge du DI core/framework (eux ont besoin de reflect).
- `Orm.connect()` = template method → surcharger `onConnect()`, pas `connect()` (sinon `onOrmReady` plus émis).
- `localKey`/`targetKey` figés à `"id"` (entité référencée DOIT avoir PK `id`). FK : one-to-many `<source>Id` sur target ; many/one-to-one `<target>Id` sur source.
- Réfs détail : `@nodefony/orm-core/{CLAUDE,MEMORY}.md`, `@nodefony/drizzle/{CLAUDE,MEMORY}.md`, ADR-0003, mémoires `project_p7_4_kit`/`project_crud_pattern_decision`/`project_orm_default_positioning`.

## ▸ Partie B — API, internals & gotchas

> **Périmètre** : surface d'API publique + internals + gotchas ORM. Autosuffisant pour coder
> l'ORM Nodefony depuis le npm dist seul (sans le source du monorepo).
> **Ne PAS dupliquer** `reference/recipes-orm.md` (recettes d'usage entity/repo/CRUD/tx pas-à-pas) —
> ici = **signatures, contrats, mécanique interne, pièges**. Ancrages `fichier:ligne` vérifiés au source.

## Sommaire

- [1. Purpose](#1-purpose)
- [2. API publique](#2-api-publique)
  - [2.1 Contrats core (`@nodefony/orm-core`)](#21-contrats-core-nodefonyorm-core)
  - [2.2 Classes de base + registres](#22-classes-de-base--registres)
  - [2.3 `AbstractCrudService<T, R>`](#23-abstractcrudservicet-r)
  - [2.4 Décorateurs `@entity` / `@repository`](#24-décorateurs-entity--repository)
  - [2.5 Adapter Drizzle (référence / défaut SQL)](#25-adapter-drizzle-référence--défaut-sql)
  - [2.6 Adapter Mongoose (NoSQL)](#26-adapter-mongoose-nosql)
  - [2.7 Data plane ORM (`describeConnection`, graphe, sondes)](#27-data-plane-orm-describeconnection-graphe-sondes)
  - [2.8 Multi-dialecte (`connector.dialect`)](#28-multi-dialecte-connectordialect)
- [3. Internals](#3-internals)
- [4. Gotchas spécifiques ORM](#4-gotchas-spécifiques-orm)

---

## 1. Purpose

Abstraction **Repository multi-ORM** (PAS Active Record — ADR-0003). Trois packages :

- **`@nodefony/orm-core`** : **lib pure** (contrats `IOrm`/`IEntity`/`IRepository`/`ITransaction`,
  registres singletons, classes de base, `AbstractCrudService`, data plane ORM). **Jamais un Module**,
  jamais dans le manifeste `config.modules` ; n'importe **aucun** driver, ni http/framework (inversion
  de dép stricte). `peerDep: nodefony`.
- **`@nodefony/drizzle`** : adapter SQL **type-safe-first**, **ORM par défaut**. Module bootable
  (`Drizzle extends Module`). Driver `better-sqlite3` (défaut), `pg`/`mysql2` en `optionalDependencies`.
- **`@nodefony/mongoose`** : adapter NoSQL documentaire. Module bootable **opt-in** (`critical = false`).

Les **drivers** sont les Modules ; ils s'auto-enregistrent dans `ormRegistry` à leur boot. Le core ne
connaît plus l'ORM. Valeur de l'abstraction = **swap d'ORM** (un nouvel adapter → commencer par Drizzle).

---

## 2. API publique

### 2.1 Contrats core (`@nodefony/orm-core`)

**`IOrm`** — instance ORM (1 par connexion logique), enregistrée dans `OrmRegistry` sous un nom unique.
`orm-core/nodefony/interfaces/IOrm.ts:12`

| Membre                   | Signature                                                                                       | Ancrage      |
| ------------------------ | ----------------------------------------------------------------------------------------------- | ------------ |
| `name`                   | `readonly string` (clé `OrmRegistry.get`)                                                       | `IOrm.ts:14` |
| `connect`                | `(): Promise<void>` — ouvre + compile les entités                                               | `IOrm.ts:17` |
| `disconnect`             | `(): Promise<void>`                                                                             | `IOrm.ts:20` |
| `isConnected`            | `(): boolean`                                                                                   | `IOrm.ts:23` |
| `getRepository<T>`       | `(name): IRepository<T>` — throw si entité inconnue                                             | `IOrm.ts:33` |
| `transaction<R>`         | `(work: (tx) => Promise<R>): Promise<R>` — commit si résolu, rollback si rejeté                 | `IOrm.ts:41` |
| `getNativeConnection<C>` | `(): C` — **trappe SQL/commandes brutes** (anti-blocage requêtes non couvertes)                 | `IOrm.ts:51` |
| `describeEntity?`        | `(name): IColumnInfo[]` — colonnes normalisées (graphe/ERD/IA)                                  | `IOrm.ts:61` |
| `describeConnection?`    | `(): IConnectionInfo` — driver + cible **sans credential**                                      | `IOrm.ts:71` |
| `ping?`                  | `(): Promise<void>` — round-trip réel (`SELECT 1` / `admin().ping`), **rejette** si injoignable | `IOrm.ts:82` |
| `probe?`                 | `(): Promise<IOrmProbe>` — sonde profonde (storage/pool), best-effort (jamais throw)            | `IOrm.ts:92` |

**`IRepository<T>`** — CRUD portable. `orm-core/nodefony/interfaces/IRepository.ts:101`

| Méthode           | Signature                                                                                               | Ancrage              |
| ----------------- | ------------------------------------------------------------------------------------------------------- | -------------------- |
| `find`            | `(criteria?: Criteria<T>, options?: RepositoryReadOptions): Promise<T[]>`                               | `IRepository.ts:109` |
| `findOne`         | `(criteria: Criteria<T>, options?): Promise<T \| null>`                                                 | `IRepository.ts:117` |
| `create`          | `(data: Partial<T>): Promise<T>` (id/défauts générés)                                                   | `IRepository.ts:127` |
| `updateOne`       | `(criteria, data): Promise<T \| null>` — **atomique** (`UPDATE … RETURNING` / `findOneAndUpdate`)       | `IRepository.ts:144` |
| `updateMany`      | `(criteria, data): Promise<number>` — masse, renvoie le nb modifié                                      | `IRepository.ts:156` |
| `delete`          | `(criteria): Promise<number>`                                                                           | `IRepository.ts:164` |
| `count`           | `(criteria?): Promise<number>`                                                                          | `IRepository.ts:171` |
| `withTransaction` | `(tx: ITransaction): IRepository<T>` — **vue liée à la tx** (résout « repo non tx-aware », ADR-0003 #4) | `IRepository.ts:182` |

> ⚠️ **VÉRITÉ COURANTE** : l'API d'écriture est `updateOne` + `updateMany` (pas un `update` unique —
> les MEMORY/recipes qui écrivent `repo.update(...)` sont **périmés**). `updateOne` est **atomique**
> (une seule requête) : jamais `UPDATE` puis relecture séparée — la relecture renverrait `null` à tort
> dès que le critère porte sur un champ modifié.

**Critères** (`IRepository.ts`) — `Criteria<T>` = `{ [K in keyof T]?: FieldCriteria<T[K]> } & OrmCriteria` :
typé par champ (`{ email }` doit être `string` si `T.email` l'est) **+** échappatoire `OrmCriteria`
(`Record<string,unknown>`, `IRepository.ts:10`). `FieldCriteria<V>` = valeur nue (égalité) **ou**
`FieldOperators<V>` (`IRepository.ts:53`). **Opérateurs riches** `$`-préfixés (combinés en `AND` sur un
même champ) : `$eq $ne $gt $gte $lt $lte $in $nin $like` (`$like` = SQL `%`/`_`) — `IRepository.ts:26`.
Sous-ensemble = intersection portable des 3 ORM. `RepositoryReadOptions` = `{ relations?, limit?,
offset?, order?: Array<[string,"ASC"|"DESC"]> }` (`IRepository.ts:78`) — `relations` = eager-load des
assos **déclarées** dans `@entity`.

**`IEntity<S, M>`** — `orm-core/nodefony/interfaces/IEntity.ts:33`. Champs : `name` (clé logique),
`orm` (nom du connecteur cible), `schema: S` (forme libre, propre au driver), `model?: M` (compilé
**après** connexion), `relations?: IEntityRelation[]`. Deux axes de regroupement Studio/ERD :
`module?` (propriétaire, `IEntity.ts:45`) **distinct de** `domain?` (classification fonctionnelle,
`IEntity.ts:54` — pour une grosse base : grouper/filtrer N tables d'un même module). `timestamps?:
boolean` (`IEntity.ts:68`) : Mongoose l'applique (`timestamps:true`) ; Drizzle (schema-as-code) → **sans
effet** (colonnes explicites). `IEntityRelation` (`IEntity.ts:4`) : `type` (`one-to-one|one-to-many|
many-to-one|many-to-many`), `target`, `field`, `foreignKey?` (omise → dérivée camelCase `<entité>Id`).

**`ITransaction`** — `orm-core/nodefony/interfaces/ITransaction.ts:8` : `commit()`, `rollback()`,
`savepoint(name)`, `rollbackTo(name)`, `getNative<C>()`. **2PC cross-ORM NON garanti** (1 tx = 1 ORM).
Savepoints driver-dépendants (no-op possible : Mongo).

### 2.2 Classes de base + registres

**`Orm` abstract extends Service** — `orm-core/nodefony/src/Orm.ts:29`. **S'auto-register au ctor**
(`ormRegistry.register(this.name, this)`, `Orm.ts:44` — possible car `name` arrive de `Service`, dispo
tôt). `connect()` = **template method** (`Orm.ts:54`) → appelle l'abstrait `onConnect()` (`Orm.ts:74`)
puis `fire("onOrmReady", this)` (`Orm.ts:66`). Abstraits à implémenter : `onConnect`, `disconnect`
(`:77`), `isConnected` (`:80`), `getRepository` (`:87`), `transaction` (`:94`), `getNativeConnection`
(`:97`). `describeEntity` par défaut renvoie `[]` (`Orm.ts:107`, relations seules) → surchargé par
l'adapter.

**`Entity` abstract** — `orm-core/nodefony/src/Entity.ts:22`. Abstraits : `name` (`:26`), `orm` (`:29`),
`getSchema(): S` (`:42`) ; getter `schema` délègue à `getSchema()` (`:45`). **`register()` explicite**
(`Entity.ts:55` → `entityRegistry.register(this)`) — **PAS** auto au ctor (cf §4).

**`OrmRegistry`** + singleton `ormRegistry` — `orm-core/nodefony/src/OrmRegistry.ts:15` / `:88`.
`register(name, orm)` (doublon → **throw**, `:26`/`:30`), `get(name)` (`:45`), `has` (`:58`), `list()`
(`:67`), `unregister` (`:77`). Map lazy (rien alloué tant qu'aucun ORM).

**`EntityRegistry`** + singleton `entityRegistry` — `orm-core/nodefony/src/EntityRegistry.ts:14` / `:146`.
`Object.create(null)` lazy, indexé `entities[name][orm]`. `register(entity)` (`:24`), `get(name, orm?)`
(`:54`) : **ambigu → throw** si `orm` omis et l'entité existe pour plusieurs ORM ; `has`, `unregister`.

### 2.3 `AbstractCrudService<T, R>`

`orm-core/nodefony/src/AbstractCrudService.ts:34` — **extends Service** (abstract). Socle CRUD générique :
service = **source de vérité métier**, REST/WS/GraphQL/CLI = adaptateurs minces. `R extends IRepository<T>`
(2ᵉ générique) conserve les finders métier de la sous-classe.

- **Ctor** `(name, repository: R, ...wiring: ServiceWiring)` (`:46`) — `ServiceWiring` = tuple
  `[container?, nc?, options?]` capté en rest-param et forwardé `super(name, ...wiring)` (fin du tunneling
  des 3 args de câblage). Exporté depuis `@nodefony/orm-core`.
- **Lectures = délégation pure** (hot path, 0 hook/event) : `find` (`:59`), `findOne` (`:69`),
  `findById(id, options?)` (`:84` — suppose **PK `id` string**, override sinon), `count` (`:93`).
- **Mutations = hooks template-method + events** (event émis **seulement si mutation effective**) :
  - `create(data)` (`:105`) : `beforeCreate` → persist → `afterCreate` → `fire("onCreated", entity)` (`:109`).
  - `updateOne(criteria, data)` (`:130`) : `beforeUpdate` → `repository.updateOne` → `afterUpdate` →
    `fire("onUpdated", updated)` (`:135`) — **pas d'event si `null`**. ⚠️ **`updateMany` n'est PAS
    exposée** sur le service (primitive niveau repository ; à remonter quand un usage métier la réclame).
  - `delete(criteria)` (`:147`) : `beforeDelete` → `repository.delete` → `afterDelete` →
    `fire("onDeleted", criteria, count)` (`:152`).
- **Hooks protected no-op** (à surcharger) : `beforeCreate(data)→data` (`:168`), `afterCreate(e)` (`:173`),
  `beforeUpdate(crit,data)→data` (`:182`), `afterUpdate(e)` (`:190`), `beforeDelete(crit)` (`:193`),
  `afterDelete(crit,n)` (`:196`).
- **Singleton DI stateless LÉGITIME** : état par requête (user/tenant/tx) → `Context`/ALS, **jamais** un
  champ du service.

### 2.4 Décorateurs `@entity` / `@repository`

`orm-core/nodefony/src/decorators/`. **SANS reflect-metadata** (WeakMap maison `metadataStore.ts` →
0 dep runtime ; diverge volontairement du DI core/framework qui, lui, a besoin de reflect).

- **`@entity({ orm, name?, schema?, relations?, module?, domain?, timestamps? })`** (`entityDecorator.ts:61`,
  class deco) : `name` défaut = nom de classe ; construit un descripteur `IEntity` **depuis les options**
  (0 instanciation) → `entityRegistry.register(descriptor)` **au chargement du module** (`:83`) + stocke
  la métadonnée. La classe décorée peut être **vide** (le descripteur vient des options).
- **`@repository(name, { entity, orm? })`** (class deco) : **tag pur** du lien repo↔entity, **AUCUN
  registre** (le binding DI est le job de l'adapter).
- Accesseurs métadonnée exportés : `getEntityMeta`/`hasEntityMeta`/`getRepositoryMeta`/`hasRepositoryMeta`.
- Helper critères exporté : `OPERATOR_KEYS` (`criteria.ts:10`), `isFieldOperators()` (`criteria.ts:38`),
  type `OperatorKey`.

### 2.5 Adapter Drizzle (référence / défaut SQL)

Exports : `DrizzleOrm`, `DrizzleRepository`, `DrizzleTransaction` (+ types `DrizzleOrmOptions`,
`DrizzleDb`, `DrizzleResolvedRelation`).

**`DrizzleOrm extends Orm`** — `drizzle/nodefony/src/orm-core/DrizzleOrm.ts:80`. Schema-as-code
(`entity.schema` EST une table Drizzle `sqliteTable(...)`). DDL dérivé via `getTableConfig()`
(`DrizzleOrm.ts:154`, dev/test ; **prod = `drizzle-kit`**). `getRepository(name)` (`:327`) →
`new DrizzleRepository(db, table, relations, ormName)` (`:339`). `transaction` (`:350`) →
`new DrizzleTransaction(db, client)` (`:359`). `getNativeConnection<DrizzleDb>()` (`:370`).
`describeConnection()` (`:468`). `get dialect` (`:114`).

**`DrizzleRepository<T>`** — `DrizzleOrm.ts` voisin, `DrizzleRepository.ts:79`. **Ctor**
`(db, table, relations, ormName="default")` (`:92`). `#where(criteria)` traduit en `eq/and/gt/inArray/
like` (`:186`). `#populate` = eager-load **manuel**, 1 requête `IN(...)` par relation (`:249`). Sortie
= **cast `rows as T[]`** (`:320` — schema-as-code : la ligne EST l'entité, pas de remap générique).
`updateOne` (`:341`) / `updateMany` (`:362`) / `withTransaction` (`:400`).

**`DrizzleTransaction`** : `BEGIN`/`COMMIT`/`ROLLBACK` **manuels** sur la connexion (unique). `getNative()`
= le même `db` (1 connexion). savepoint = SQL brut.

### 2.6 Adapter Mongoose (NoSQL)

Exports : `MongooseOrm`, `MongooseRepository`, `MongooseTransaction`.

**`MongooseOrm extends Orm`** — `mongoose/nodefony/src/orm-core/MongooseOrm.ts:43`. `onConnect()` (`:72`)
= `mongoose.createConnection(uri, options?)` (`:74` — **connexion isolée**, PAS le singleton global →
multi-ORM) puis compile schémas/modèles depuis `entityRegistry` (`connection.model(...)` `:154`,
`entity.model = model` `:159`). `getRepository(name)` (`:179`) → `new MongooseRepository(model, this.name)`
(`:191`). `getNativeConnection<C>()` (`:215`). Sondes Studio : `ping` (`:229`, `admin().command({ping:1})`),
`probe` (`:243`, `serverStatus`→pool), `describeEntity` (`:272`, `schema.paths`, `_id`=PK),
`describeConnection` (`:295`) **sync** → `safeTarget()` (`:307`) strip `user:pass` de l'URI.

**`MongooseRepository<T>`** — `MongooseRepository.ts:42`. **Ctor** `(model, ormName, session?)` (`:53`).
`id`→`_id` en critère, sortie `toObject({ virtuals:true })` (expose le virtuel `id` hex). `relations`→
`populate()`, `$like`→`$regex`. `updateOne` (`:254`)/`updateMany` (`:276`)/`withTransaction` (`:317`).

**`MongooseTransaction`** : wrap `ClientSession` (`session.withTransaction`, managé). savepoint/rollbackTo
= **no-op** (Mongo n'a pas de savepoints). **Transactions = replica set obligatoire** (standalone = pas de tx).

### 2.7 Data plane ORM (`describeConnection`, graphe, sondes)

Représentation canonique sérialisable (ORMs + entités + colonnes + relations) qui sert l'ERD Studio
(React Flow) **+** le contexte IA (text-to-SQL/RAG) **+** l'export. Fonctions (`orm-core/nodefony/src/`) :

| Fonction                                | Rôle                                                                                                                           | Ancrage                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| `buildOrmGraph(ormFilter?)`             | Lit `ormRegistry`+`entityRegistry` → `IOrmGraph` (nœuds/colonnes/relations)                                                    | `OrmAdminApi.ts:114`          |
| `buildConnectionHealth(orm?)`           | État + **ping** + `probe()` (storage/pool) — **émet une requête**                                                              | `OrmAdminApi.ts:136`          |
| `buildOrmFlow(filter?)`                 | Débit/latence/slow — lecture pure (**aucune requête émise**)                                                                   | `OrmAdminApi.ts:238`          |
| `toDbml(graph)` / `toJsonSchema(graph)` | Export DBML / JSON Schema                                                                                                      | `OrmAdminApi.ts:273` / `:376` |
| `createOrmAdminApi()`                   | `IAdminApi` (endpoints `orms`/`entities`/`entity/{name}`/`graph`/`connection/health`/`flow`/`export/{format}`, `?orm=` filtre) | `OrmAdminApi.ts:419`          |
| `registerOrmAdminApi(registry)`         | Monte `/nodefony/orm/api/*` (idempotent)                                                                                       | `OrmAdminApi.ts:541`          |
| `wireOrmAdminPlane(kernel)`             | Câblage GLOBAL factorisé (admin API + providers santé/flux) — appelé par chaque driver à `onKernelBoot`                        | `ormWiring.ts:31`             |
| `buildOrmLeanHealth()`                  | Agrégat per-instance (0 ping/0 toSQL) pour la sonde cluster                                                                    | `src/buildOrmLeanHealth.ts`   |

orm-core étant une **lib pure**, le montage est déclenché par un **module driver** (`Drizzle`/`Mongoose`
`onKernelBoot` → `wireOrmAdminPlane`) ; lit les registres globaux → couvre **tous** les ORM.

> Taxonomie des **3 sondes** (profiler par-requête / santé / flux) + cluster drill : détaillée dans
> `reference/recipes-orm.md` §F (ne pas redupliquer). Ici = signatures + ancrages.

### 2.8 Multi-dialecte (`connector.dialect`)

État factuel (bloqueur release SQL prod). `connector.dialect` ∈ `"sqlite" | "postgres" | "mysql"`
(défaut `sqlite`) + `url` (pg/mysql, porte le secret → jamais loggée). `drizzle/nodefony/config/schema.ts`:
`SQL_DIALECTS` (`:26`), `SqlDialect` (`:29`), `dialect` (`:33`), `url` (`:52`).

`DrizzleOrm` est **dialect-aware** : `onConnect` route `#connectSqlite` (better-sqlite3, sync) /
`#connectPostgres` (driver `pg` **lazy** `await import`, `optionalDependency`, externalisé rollup ;
échec → message `npm i pg`). DDL partagé `#buildCreateTable` (le bon `getTableConfig` selon dialecte ;
`col.getSQLType()` rend les types natifs). `disconnect`/`ping`/`describeConnection`/`describeEntity` routés.

**Patron portage** : une **factory par entité** `createXTable(dialect)` = l'équivalent du `dialect`
Sequelize, porté par le framework (Drizzle est schema-as-code **dialect-spécifique** : `sqliteTable` ≠
`pgTable` → on NE peut PAS « juste changer le dialect »). Divergences typiques : `expiresAt` `integer`
(SQLite 64-bit) → `bigint mode:number` (PG ; `integer` PG 32-bit déborde sur epoch ms) ; `text mode:json`
→ `jsonb`. **Mêmes NOMS de colonnes** → store/repo reste agnostique. État : **idempotency porté + prouvé
PG** ; **reste** `user` (⚠️ `findBySocialProvider` `json_each` SQLite → `jsonb` PG) / `token` / `session`
/ `webauthn` (1 entité/session) puis **mysql** (`mysql2`) + DDL prod drizzle-kit.

---

## 3. Internals

**Enregistrement des entités**

- `@entity` enregistre un **descripteur** (`IEntity`, 0 instanciation) dans `entityRegistry` **au
  chargement du module** (l'`import` exécute le décorateur). `DrizzleOrm.onConnect` / `MongooseOrm.onConnect`
  itèrent `entityRegistry` pour compiler tables (Drizzle) / modèles (Mongoose) **à la connexion**.
- **Binding ORM dynamique** (quand le nom de connecteur dépend de la config : User/token/session/webhook
  stores) → PAS d'`@entity` figé. Pattern : `createXEntity(orm)` + `registerXEntity(orm)` appelé **AVANT**
  `orm.connect()` (sinon la table/le modèle n'est pas compilé). C'est l'**approche B** des stores
  (security/idempotence) : `import type` du contrat + **PAS d'auto-register** → l'app câble explicitement.
- Collision inter-driver évitée par le **nom de connecteur** : Drizzle défaut = `"default"`, Mongoose
  défaut = `"nodefony"` → `entityRegistry[name][orm]` ne collisionne pas si les 2 cohabitent.

**Mapping row → entité**

- **Drizzle** : schema-as-code → la ligne EST l'entité, `DrizzleRepository` fait un **cast** `rows as T[]`
  (`DrizzleRepository.ts:320`) — **aucun remap générique**.
- **Mongoose** : `toObject({ virtuals:true })` + `_id`→`id` (hex string).
- **Stores domaine** (User/token/session) : remap **manuel** ligne ↔ objet métier — ex.
  `DrizzleUserRepository.#toUser(row)` → `new BaseUser({...})` (`DrizzleUserRepository.ts:64`). **C'est ici
  que le danger « colonne oubliée → `undefined` » se joue** (cf §4), pas dans le repo générique.

**Résolution lazy du driver**

- Drizzle `#db`/`#tables` = `null` jusqu'à `onConnect` (`DrizzleOrm.ts:84`/`:92`), remis `null` à
  `disconnect` (`:316`). `pg` chargé **lazily** (`await import("pg")` dans `#connectPostgres`, jamais
  au top-level : un déploiement SQLite n'a pas `pg`).
- Stores branchés (idempotence/token) prennent un **résolveur** `() => Db | null` (garde `isConnected()`)
  → tolère l'ordre de boot (framework résout le store à `onKernelBoot`, l'ORM connecte à `onBoot`) **et**
  le shutdown ; `null` → fail-soft (no-op gracieux au lieu de crash).

**Dialect-aware** : cf §2.8 — `onConnect` route par `connector.dialect`, DDL via le `getTableConfig` du
bon sous-module Drizzle, drivers pg/mysql en `optionalDependencies` lazy.

**Sondes flux** (`QueryFlowMonitor`, `orm-core/nodefony/src/QueryFlowMonitor.ts:58`, singleton `:146`) :
process-wide, **indépendant de l'ALS**, **OFF par défaut** (`enabled = false` `:60` → coût nul prod/bancs).
`record(connector, durationMs, sql?)` (`:101`) : EWMA α=0.2 (`:20`), ring slow borné, `sql` fourni **que
sur le chemin lent** (`durationMs >= slowMs`, défaut 50 `:62`) → jamais `toSQL()` au cas nominal. Débit/s
**dérivé** côté lecteur (delta `total`/`ts`), **0 persistance** (RAM, reset au restart). Gating = job du
driver : `resolveOrmFlowEnabled` (`ormWiring.ts:96`) → `setEnabled(env !== "production")` (override
`NODEFONY_ORM_FLOW=1/0`). Tap : chaque op du repo passe par `#prof` (Drizzle `DrizzleRepository.ts:139`,
Mongoose `MongooseRepository.ts:77`), gardé par les 2 drapeaux (buffer ALS dev + flux) → `if (!buf &&
!flow) return builder`. **Couverture** : Drizzle alimente le tap ; Mongoose aussi (middleware repo) —
les finders natifs `sql\`…\``(ex.`findBySocialProvider`, `db.all`brut) ne passent **pas** par`#prof`.

---

## 4. Gotchas spécifiques ORM

- **`Entity` ne s'auto-register PAS au ctor** : en TS, le ctor de la base s'exécute **avant** les
  initialiseurs de champs de la sous-classe → `this.name`/`this.orm` seraient `undefined`. Auto-register =
  job du décorateur `@entity` (métadonnée de classe). Sans décorateur → `entity.register()` explicite.
  `Orm`, lui, s'auto-register au ctor (`name` vient de `Service`, dispo tôt). (`Orm.ts:44` vs `Entity.ts:55`)
- **`@entity` OU `register()`, jamais les deux** pour la même entité → `entityRegistry` **throw** sur
  doublon `name+orm`. Tests décorateurs → `unregister(name, orm)` **scopé à l'ORM** en `afterEach`
  (sans `orm` = efface le bucket entier = contamine les autres bancs).
- **`entityRegistry.get(name)` ambigu** si l'entité existe pour plusieurs ORM et `orm` omis → **throw**
  (`EntityRegistry.ts:54`). Toujours préciser l'ORM en contexte multi-driver.
- **Mapping qui oublie une colonne → `undefined`/`null` silencieux** : dans un remap manuel ligne↔domaine
  (stores User/token/session), une colonne ajoutée au schéma mais absente du `#toX(row)` ne lève
  **aucune erreur** — le champ devient `undefined`. Synchroniser schéma ↔ mapper ↔ interface du domaine.
  (Le repo générique Drizzle ne souffre pas de ça : cast direct.)
- **Drizzle : défauts via `$defaultFn` (JS), JAMAIS `.default()` SQL** : le DDL dérivé de `getTableConfig`
  **n'émet pas** les `DEFAULT` → une colonne `NOT NULL` sans valeur **casse l'INSERT**.
- **1 transaction = 1 ORM** : 2PC cross-ORM **non garanti** (`ITransaction.ts`). `better-sqlite3` est
  **synchrone** → pas de `db.transaction(asyncCb)` (committe **avant** les `await` du contrat async) →
  `BEGIN/COMMIT/ROLLBACK` manuels, connexion unique. Mongoose tx → **replica set obligatoire**.
- **`Orm.connect()` = template method** : surcharger `onConnect()`, **pas** `connect()` (sinon
  `onOrmReady` n'est plus émis → l'ORM ne signale jamais sa disponibilité). (`Orm.ts:54`/`:66`/`:74`)
- **`SessionStorage` tolère le shutdown** : `#repo()` renvoie `null` si `!orm.isConnected()` (l'ORM ferme
  au `onTerminate` **avant** le drain des serveurs http → une requête en vol qui retouche l'ORM mort =
  `unhandledRejection`). NE PAS « simplifier » en rappelant `getRepository` direct.
- **GC orphelin (stores à TTL applicatif)** : pas de TTL natif SQL → `gc(now)` = `DELETE expiresAt<=now`
  **applicatif**, à brancher sur le scheduler GC mutualisé. Un store dont le `gc()` n'est jamais appelé
  laisse grossir la table (dette mémoire/disque silencieuse) — vérifier le câblage du GC.
- **`sqliteTable` dur = dette multi-dialecte** : une entité écrite directement en `sqliteTable` (sans
  factory `createXTable(dialect)`) n'est **pas portable** pg/mysql. Pour toute nouvelle entité destinée à
  la prod SQL → factory par dialecte dès le départ (cf §2.8). C'est le **bloqueur release** côté `user`/
  `token`/`session`/`webauthn`.
- **orm-core = décorateurs SANS reflect-metadata** (WeakMap maison) → 0 dep runtime ; ne pas y réintroduire
  `reflect-metadata`/`design:paramtypes` (diverge volontairement du DI core/framework).
