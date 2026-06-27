# Recettes ORM — Entity, Repository, Service CRUD, transactions

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
