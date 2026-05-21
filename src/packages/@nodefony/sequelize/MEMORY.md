# MEMORY.md — @nodefony/sequelize

## Purpose

Driver Sequelize (v6, **figé** — legacy maintenance, cf MIGRATION_STATUS P7.1). Deux socles cohabitent :

- **Legacy** (`nodefony/service/orm.ts`) : `class Sequelize extends Orm` où `Orm`/`Entity`/`Connector` viennent du **core `nodefony`** (ancien ORM : `connections`/`entities`/`Connector`, SessionStorage, `boot()` sur `onBoot`). C'est le driver de prod actuel. Refonte sur orm-core = **P7.1**, NE PAS toucher hors de cette phase.
- **orm-core adapter** (`nodefony/src/orm-core/`, P5.4 ✅) : implémentation **propre et minimale** sur `@nodefony/orm-core`, indépendante du legacy. Banc de validation de l'abstraction multi-ORM.

## Core Components (adapter orm-core, P5.4)

- `SequelizeOrm extends Orm` (orm-core) : `onConnect()` = `new Sequelize(options)` + compile les entités de `entityRegistry` (filtre `entity.orm === this.name`) via `sequelize.define(name, entity.schema)`, câble les relations, `sync()` (dev/test). `getRepository(name)` (lazy, mémoïsé), `transaction(work)` (managée), `getNativeConnection<Sequelize>()`.
- `SequelizeRepository<T> implements IRepository<T>` : wrap `ModelStatic`, renvoie des **objets plats** (`get({plain:true})`), jamais des `Model`. Supporte `options.relations` (→ `include` via `model.associations[name]`, eager-load portable) + `limit/offset/order`, et `withTransaction(tx)` (→ nouvelle instance liée, `{transaction}` sur toutes les ops).
- **Profiler tap `#prof(opts)` (2026-05-21)** : sur chaque op, si `RequestContext.get()?.queries` existe (dev, lu **en synchrone** à l'entrée de la méthode), ajoute `benchmark:true` + un `logging` **par requête** qui pousse `{sql,durationMs,connector:"sequelize"}` dans le buffer capturé (closure). Hors dev/scope → opts inchangées (0 benchmark, coût = 1 lecture ALS). **⚠️ Redaction (2026-05-22)** : Sequelize `logging` donne le SQL **interpolé** (valeurs inline) → un INSERT/UPDATE User y mettrait le hash. `sql` passe par `redactSecrets(...)` (core) AVANT troncature/push (masque password/token/Bearer/cookie). Contrat : **tout adapter qui pousse au profiler redacte d'abord** (Drizzle, lui, pousse du SQL paramétré `?` → déjà credential-free).
- `SequelizeTransaction implements ITransaction` : wrap `Transaction`, savepoint = SQL brut.
- Exports : `index.ts` racine du module → `{ SequelizeOrm, SequelizeRepository, SequelizeTransaction }` (via `nodefony/src/orm-core/index`).

## Config / Build

- peerDep ajoutée P5.4 : `@nodefony/orm-core: "*"` (singletons partagés). + `nodefony`, `@nodefony/http`.
- `npm run build` (rollup preserveModules). `types` legacy = `nodefony/types/index.d.ts` (à migrer vers `dist/types` — dette).

## Behaviors / Tests

- Tests intégration adapter : `npx mocha --config .mocharc.json` (mocha+tsx, `node:assert`), sqlite `::memory:`. **10 verts** (`tests/integration/orm-core-sequelize.test.ts`) — dont 2 profiler (push dans buffer ALS + coût nul hors profiling).
- `test` script package.json = placeholder legacy `node -e` → lancer via mocha direct.

## Gotchas

- **FK Sequelize = PascalCase par défaut** (`UserId`). L'adapter force le camelCase (`#foreignKey` → `userId`) pour que le critère portable `{ userId }` matche la colonne. sqlite est **case-insensitive sur les identifiants** → un mismatch FK ne lève pas d'erreur SQL, il renvoie juste 0 ligne (piège silencieux).
- **Eager-load des assos déclarées = PORTABLE** : `repo.findOne(criteria, {relations:["rooms"]})` (→ `include`). Jointures **arbitraires** seulement → `getNativeConnection<Sequelize>().models.X.findOne({include})` (ADR-0003 risque #1, résolu pour le cas commun).
- **Repository tx-aware** : `repo.withTransaction(tx).create(...)` dans `transaction(work)` → toutes les ops dans la tx (rollback annule tout). Plus besoin de `getNativeConnection()` pour les écritures transactionnelles (ADR-0003 risque #4 résolu).
- FK **appliquée** sous sqlite (SequelizeForeignKeyConstraintError) — un userId inexistant fait rollback la tx.
- Service base : `new SequelizeOrm("db")` marche sans kernel (Container auto). S'auto-register dans `ormRegistry` au ctor → unregister en teardown de test (sinon doublon au re-run).
- **⚠️ ALS perdue dans le pool Sequelize** : un `logging` **global** sur l'instance lit l'ALS dans un contexte async **détaché** (pool de connexions) → `RequestContext.isProfiling()` y est toujours `false` (même piège que BUG-001/002). C'est pourquoi le profiler tape **par requête** (`#prof`, closure qui capture le buffer au boundary où l'ALS est valide), JAMAIS via `logging` global.

## Liens

- ADR : `docs/adr/0003-orm-core-abstraction-repository-multi-orm.md` (verdict P5.4), `0002` (schéma banc-test).
- `@nodefony/orm-core` (contrats `Orm`/`IRepository`/`ITransaction`, registres).
