# CLAUDE.md — @nodefony/orm-core

## Rôle

Fondation **multi-ORM** de Nodefony : contrats abstraits + registre + classes de base.
Consommé par les **deux** drivers existants (`@nodefony/drizzle` — défaut — et `@nodefony/mongoose`) et par `@nodefony/user`, session storage, security.

## Nature : LIB PURE (pas un Module runtime)

- **PAS** de classe `Module`, **PAS** d'enregistrement dans `@modules()` racine.
- C'est une dépendance lib : les **drivers** sont les Modules ; ils s'enregistrent eux-mêmes dans le `OrmRegistry` (singleton process-wide) à leur boot.
- Pourquoi : le registre est un singleton ; faire d'orm-core un Module runtime ajouterait de l'ordering pour zéro bénéfice.

## Décisions figées

- **Archi = Repository multi-ORM (pas Active Record)** — risques documentés dans [`docs/adr/0003`](../../../../docs/adr/0003-orm-core-abstraction-repository-multi-orm.md). Les **4 risques de l'ADR sont traités** sur les adapters (Mongoose/Drizzle) : (1) jointure → eager-load portable (`{relations}`) + trappe native ; (2) multi-ORM simultané = YAGNI (la valeur est le swap d'ORM, pas la cohabitation) ; (3) criteria typé + opérateurs riches ; (4) repo tx-aware (`withTransaction`). ADR clôturé côté design.
- Interfaces : `IOrm`, `IEntity` (+ `IEntityRelation`), `IRepository<T>` (+ `OrmCriteria`), `ITransaction`.
- **`IOrm.getNativeConnection<C>()`** = trappe SQL/commandes brutes — **indispensable** (anti-blocage requêtes non couvertes par l'abstraction).
- Multi-managers : chaque ORM enregistré sous un nom (`db_principale`, `db_logs`...). Controller via DI pur (`@Inject('repository.user.drizzle')`), JAMAIS l'ORM en dur.
- Transactions cross-ORM (2PC) **non garanties** — une tx = un ORM.
- Critères = `Criteria<T>` typé par champ + **opérateurs riches** `$`-préfixés.
  **Lecture** — `FieldOperators<V>` : `$eq $ne $gt $gte $lt $lte $in $nin $like $null`
  (helpers `OPERATOR_KEYS`/`isFieldOperators`). `$null` est celui qui désamorce le piège
  `= NULL` en SQL — ne pas l'oublier en écrivant un adapter.
  **Écriture** — `UpdateOperators` : `$max $min` (`UPDATE_OPERATOR_KEYS`/`isUpdateOperators`),
  reconnus dans le `update` d'un `upsert`.
  Source unique des deux familles : `nodefony/src/criteria.ts`. `OrmCriteria`
  (`Record<string,unknown>`) reste l'échappatoire. Chaque adapter traduit
  (`Op.*` / `$`+`$regex` / `eq()/inArray()`). `$like` = SQL, **échappement `\`**
  (`LIKE_ESCAPE_CHAR`) : neutraliser un littéral = `escapeLikeTerm`, le lire sans
  SQL = `likePatternToRegExp` (Mongo, mémoire). Un adapter SQL DOIT émettre la
  clause `ESCAPE` — sans elle, PG/MySQL appliquent déjà `\` et SQLite non, soit
  trois sémantiques pour un opérateur portable.

## Interdits

- Importer un driver concret (mongoose, drizzle...) — inversion de dép : orm-core ne connaît AUCUN driver.
- Importer `@nodefony/http` ou `@nodefony/framework`.
- Logique métier. `any`. `@ts-ignore`. `require()`.

## Perf

- `OrmRegistry` (P5.2) : structure lazy, pas d'alloc au boot tant qu'aucun ORM enregistré.
- Interfaces = effacées à la compilation (zéro coût runtime).

## Ce que le module contient

- Contrats : `nodefony/interfaces/` (`IOrm`, `IEntity`, `IRepository<T>`, `ITransaction`).
- Registres : `OrmRegistry` + `EntityRegistry` ; classes de base `Orm`/`Entity` (extends `Service`,
  event `onOrmReady`).
- Décorateurs `@entity` / `@repository` : métadonnées en `WeakMap` (`metadataStore`), **sans
  reflect-metadata** — le module reste une lib pure ; le descripteur s'auto-enregistre.
- `AbstractCrudService<T, R extends IRepository<T>>` (`nodefony/src/AbstractCrudService.ts`) : socle
  CRUD. Lectures = délégation pure (hot path, 0 hook/event) ; mutations = hooks template-method +
  events `onCreated`/`onUpdated`/`onDeleted`. Pattern canonique : le service est la source de vérité,
  REST/WS/GraphQL/CLI ne sont que des adaptateurs minces. Cf `project_crud_pattern_decision`.
- Adapters concrets : **hors de ce module** (`@nodefony/drizzle` par défaut, `@nodefony/mongoose`).

> Avancement des phases → `MIGRATION_STATUS.md` (source unique). Historique → `git log`.

## Build / types

- Standard conforme : `dist/types/` + `exports` (généré par tsgo, jamais de `.d.ts` manuel).
- `npm run build` (rolldown preserveModules).
