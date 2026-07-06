# MEMORY.md — @nodefony/drizzle

Purpose: 3e adapter orm-core + module bootable. Drizzle + better-sqlite3. Type-safe-first. P7.4.

## Module bootable (2026-05-21)

- `index.ts` default export = `Drizzle extends Module` + `@services([DrizzleService])`. Ajouté à `@modules()` app. ORM SQL par défaut.
- `nodefony/service/DrizzleService.ts` : ctor `super(name, module.container, module.notificationsCenter, module.options)` ; `kernel.once("onBoot")` → `connectAll()` lit la config VALIDÉE `this.module.get("drizzleConfig")` (1 DrizzleOrm/connecteur) ; `#defaultFilename(name)` résout le chemin SQLite **AU BOOT** (kernel présent) si `filename` omis : `<root>/var/databases/nodefony-<x>.db` (sous `kernel.varDir` ; default → `nodefony-drizzle.db`) ; `onTerminate` → disconnectAll. `getOrm(name="default")`.
- **Config Zod (alignement famille ORM)** : `nodefony/config/config.ts` = source de vérité (`filename` **optionnel SANS défaut** — schéma pur, pas de deref kernel) → `defineDrizzleConfig` (parse + infra database `NF_DATABASE_URL`/`DATABASE_URL` : dialecte déduit du scheme, `sqlite:`→`filename`, `postgres://`/`mysql://`→`url`, `mongodb://` ignorée → freeze) → validée au `onKernelRegister`, exposée `this.set("drizzleConfig")`. Augmente `NodefonyModuleConfig` → `use("@nodefony/drizzle", …)` typé. Même pattern que `@nodefony/mongoose`. Cf audit `docs/audits/orm-config-pattern-2026-06.md`.
- `DrizzleService.#connectOne` propage `dialect`/`url` à `DrizzleOrm` ; `#defaultFilename`+`mkdirSync` UNIQUEMENT en sqlite ; log de boot = URL rédigée (`redactUrl`, jamais de password).
- better-sqlite3 = **dependencies** (runtime), pas devDeps.
- Boot vérifié : `MODULE ADD : drizzle` + `Drizzle ORM "default" connected` + db créée, 4 serveurs UP, health 200.

## Adapter User (P5.9 — ORM par défaut, fait EN PREMIER)

- `nodefony/src/user/` : `userTable` (sqliteTable, JSON+boolean modes), `createUserEntity(orm)`/`registerUserEntity(orm)` (binding ORM dynamique, **avant** connect), `DrizzleUserRepository implements IUserRepository` (`from(orm)`).
- Mappe ligne ↔ `BaseUser` (comportement). `findByIdentifier` + `findBySocialProvider` (json_each **bindé**, Shadow User). peerDep `@nodefony/user` ajoutée + externalisée rollup (sinon bundle → casse sur @node-rs/bcrypt natif).
- ⚠️ **Défauts via `$defaultFn` (JS), PAS `.default()` SQL** : le DDL dérivé n'émet pas les DEFAULT → NOT NULL casserait.
- ⚠️ Test cleanup : `entityRegistry.unregister("User", ORM)` **scopé** (sans orm = efface le bucket entier = contamine le banc P7.4).

## Store idempotence Drizzle (axe 3, P6.8 — 2026-06-26)

- `nodefony/entity/idempotencyEntity.ts` : `idempotencyKeyTable` (sqlite : `key` PK, `fingerprint`, `state` `if|done`, `response` text-json nullable, `expiresAt` int + index) + **factory `createIdempotencyTable(dialect)`** (sqlite|postgres ; variante PG = `jsonb` + `bigint mode:number` car `integer` PG 32-bit déborde sur epoch ms ; MÊMES noms de colonnes) + `createIdempotencyEntities(orm, dialect)`/`registerIdempotencyEntities(orm, dialect)` (binding dynamique, **avant** connect) + `IdempotencyKeyRow` + `IDEMPOTENCY_ENTITY_NAME`. `module:"framework"` (ERD).
- `nodefony/src/DrizzleIdempotencyStore.ts implements IIdempotencyStore` (contrat CORE `nodefony`, `import type` → 0 cycle). **Dialect-agnostique** (référence `table.key`/`.expiresAt` via `eq`/`lt`) : `#table` injectable (5e arg, défaut sqlite) ; `.from(orm)` lit `orm.dialect` → injecte `createIdempotencyTable(orm.dialect)`.
- **begin = réservation ATOMIQUE = `SET NX PX` SQL** : `insert(...).onConflictDoUpdate({ target:key, set:{…if…}, setWhere: lt(expiresAt, now) }).returning({key})`. `returning.length>0` ⇒ **fresh** (INSERT clé neuve OU **vol** d'une entrée morte via le DO UPDATE WHERE expiré) ; `===0` ⇒ contention (clé vivante) → SELECT → in-flight/replayed/mismatch. **JAMAIS fresh hors réservation** = anti double-effet (l'invariant). Cf le `RETURNING` SQLite/PG ne rend une ligne QUE si insert/update a eu lieu.
- complete = UPDATE `set done,response,expiresAt=now+ttl` WHERE `key AND state='if'` (**fingerprint NON touché** = préservé → mismatch 422 post-complétion). abort = DELETE WHERE `key AND state='if'`. gc(now) = DELETE `expiresAt<=now` → count (**pas de TTL natif SQL** → GC applicatif, à mutualiser GC session). size = `#pending` local best-effort (≠ cross-pod).
- **Résolution LAZY** (calqué `RedisIdempotencyStore`) : ctor prend `() => DrizzleDb|null` ; `.from` = `() => orm.isConnected() ? orm.getNativeConnection<DrizzleDb>() : null`. Résout l'**ordre de boot** (framework résout le store à onKernelBoot, orm connecte à onBoot) + **shutdown** (gotcha SessionStorage). null → begin=fresh (sans dédup), complete/abort/gc=no-op.
- **AUTO-REGISTER** (`nodefony/registerStores.ts`, appelé par `Drizzle.onKernelRegister`) : entité (variante du dialecte du connecteur `default`) + fabrique (registre @nodefony/framework) déclarées par le module. Sélection = `NF_IDEMPOTENCY_STORE=drizzle` SEUL. Framework `onKernelBoot` résout → override service `idempotencyStore` (prod fatal / dev fallback mémoire). Guards : entité `has`-guarded + fabrique `get`-guarded (l'app garde la main) ; opt-out `frameworkEntities:false`.
- **Preuves 2 niveaux** : (1) **SQLite** `tests/integration/idempotency-store.test.ts` **12** = sémantique séquentielle (verdicts, mismatch post-complétion, vol d'expiré in-flight+done, gc, size, fail-soft) — mono-fichier ne prouve PAS le multi-pod ; (2) **Postgres** `.claude/skills/nodefony-load-test/scripts/idempotency-postgres-e2e.mjs` **7/7** = atomicité cross-pod RÉELLE (2 pools × 20 rounds × 10 begin concurrents → 1 fresh + 9 in-flight/round, 0 race ; replay/mismatch/in-flight cross-pod). `docker compose --profile postgres up -d postgres`.

## Journal d'audit (P6.18 — persistant)

- `nodefony/entity/auditEventEntity.ts` : `auditEventTable` (sqlite : `id` PK, `ts` int, `category`/`outcome` `$type`, `action`, contexte NULLABLE `actor`/`resource`/`reason`/`ip`/`userAgent`/`requestId`, `flags`/`metadata` text-json) + index `ts`/`category`/`actor`/`requestId` + `createAuditEntities(orm)`/`registerAuditEntities(orm)` (binding dynamique, **avant** connect) + `AuditEventRow` + `AUDIT_ENTITY_NAMES`. `module:"security"` (ERD).
- `nodefony/src/DrizzleAuditStore.ts implements IAuditStore` (contrat `@nodefony/security`, `import type` pour le contrat → 0 cycle). **Append-only** : `append`=INSERT (optionnels→NULL) ; `gc(now)`=DELETE `ts<now-retention`→count (pas de TTL SQL) ; **`query`=trappe native** (query builder dialect-agnostique) : ordre `(ts DESC, id DESC)`, curseur **composite** `or(lt(ts,cTs), and(eq(ts,cTs), lt(id,cId)))` (résout `before` par 1 SELECT ts/id), `limit+1`=garde `nextBefore`, `count()`=total (hors curseur). Filtres AND `#buildFilter` (category/outcome/actor/action/requestId/since/until).
- **Résolution LAZY** (`() => DrizzleDb|null`, garde `isConnected()`) → `null`=fail-soft (append no-op best-effort — l'audit ne bloque jamais le flux —, query page vide, gc 0). `.from(orm, now?, retentionMs?)` (défaut rétention 365j).
- **AUTO-REGISTER** (`registerStores.ts`) : entité + fabrique (registre @nodefony/security) déclarées par le module. Sélection = `security.audit.store="drizzle"` SEUL (rétention lue de `config.audit.retentionDays`). Défaut `memory` (registry `auditStoreRegistry`).
- **Preuve** : `tests/integration/audit-store.test.ts` **7/7** SQLite = sémantique (append/query récent→ancien, JSON flags/metadata, pagination curseur+nextBefore+total, collision ms ordre `id DESC`, filtres AND, gc rétention, dégradation db null). Multi-pod pg cross-pod = slice multi-dialecte P7 (entité `sqliteTable` pour l'instant, query builder porte tel quel).

## Multi-dialecte (chantier portabilité, Slice 0 ✅ 2026-06-26)

- **Pourquoi** : Drizzle = schema-as-code dialect-spécifique (`sqliteTable`≠`pgTable`, colonnes typées par dialecte) → ≠ Sequelize, on NE peut PAS « juste changer le dialect ». On reconstruit l'abstraction au niveau Nodefony (factory par entité = le `dialect` Sequelize, porté par le framework). Choix Drizzle figé P7.4 (type-safety > portabilité native).
- **`connector.dialect`** (`sqlite|postgres|mysql`, défaut sqlite) + `url` (pg/mysql) dans `config/config.ts`. Type `SqlDialect` exporté. `DrizzleOrmOptions` += `dialect`/`url`.
- **`DrizzleOrm` dialect-aware** : `onConnect` route `#connectSqlite` (better-sqlite3 sync) / `#connectPostgres` (driver `pg` **LAZY** `await import("pg")`+`drizzle-orm/node-postgres`, `optionalDependency`, externalisé rollup ; échec → message `npm i pg`). DDL partagé `#buildCreateTable` (le bon `getTableConfig` selon dialecte ; `getSQLType()` rend les types natifs). `disconnect`(pool.end)/`ping`/`describeConnection`(driver+host sans creds)/`describeEntity` routés. `get dialect`.
- **Dette Slice 0** : `#tables`/`#db` typés SQLite ; en PG les `PgTable`/`NodePgDatabase` stockés via cast (runtime OK, API commune). `getRepository` PG typé = avec portage `DrizzleRepository` (slice ultérieur ; le store idempotence consomme `getNativeConnection`, pas le repo).
- **Reste (1 entité/session)** : user (⚠️ `findBySocialProvider` json_each→jsonb), token, session, webauthn ; puis mysql (`mysql2`) + DDL prod drizzle-kit. Évaluer un `colKit(dialect)` partagé si la duplication des factory monte.

## Core Components

- `DrizzleOrm extends Orm` : onConnect **route selon `dialect`** (sqlite better-sqlite3 sync / postgres `pg` lazy) ; `new BetterSqlite3(filename)` + `drizzle(client)` (sqlite). Schema-as-code (entity.schema = table). DDL via `getTableConfig()`. tx manuelle. **`describeEntity(name)` (2026-05-22)** : colonnes normalisées via `getTableConfig().columns` (`name/getSQLType()/primary/!notNull/isUnique`) → alimente le data plane ORM/ERD/IA (orm-core). Le **module Drizzle** (`index.ts onKernelBoot`) appelle `registerOrmAdminApi(broker)` (idempotent) → monte `/nodefony/orm/api/*` (orm-core étant lib pure).
- `DrizzleRepository<T>` : CRUD + `#where` (criteria → eq/and/gt/inArray/like) + eager-load manuel (`#populate`, 1 req IN par relation) + `withTransaction`.
- `DrizzleTransaction` : BEGIN/COMMIT/ROLLBACK sur client (managée). `getNative()` = même db (1 connexion). savepoint = SQL brut.
- `DrizzleOrmOptions { filename }` (`:memory:` par défaut).

## Behaviors

- **Profiler tap `#prof(builder)` (2026-05-22, étendu 2026-05-23)** : chaque exécution (find/create/update/delete/count + eager-load) passe par `#prof`. Alimente **2 sondes** indépendantes, gardées toutes deux par un drapeau (coût nul si les 2 OFF — `if (!buf && !flow) return builder`) : (1) **profiler par-requête** = `RequestContext.get()?.queries` (dev/ALS) → pousse `{sql,durationMs,rows,connector:"drizzle"}` ; (2) **flux agrégé** = `queryFlowMonitor.enabled` → `record(this.#ormName, durationMs, sql?)`. **Lecture ALS directe** (≠ closure d'un ORM async) : better-sqlite3 **synchrone** sans pool → ALS valide pendant `await builder`. **Sécu** : `builder.toSQL().sql` = SQL **paramétré** (`?`, jamais les valeurs) ; `redactSecrets` en plus (défense). ⚠️ les finders natifs `sql\`…\`` (`findBySocialProvider`) NE passent PAS par `#prof`(raw`db.all`).
- **Sonde flux ORM (2026-05-23)** : le repo connaît son **connecteur** via le 4ᵉ arg ctor `ormName` (passé par `DrizzleOrm.getRepository(name)` = `this.name`, propagé dans `withTransaction`) → `record` tague par connecteur (≠ vendor). `toSQL()` appelé **UNIQUEMENT sur le chemin lent** (`durationMs >= queryFlowMonitor.slowMs`, défaut 50) via helper `#safeSql` → l'agrégat ne paie jamais la sérialisation au cas nominal. **Gating** : `DrizzleService.onBoot` → `queryFlowMonitor.setEnabled(env!==production)` (override `NODEFONY_ORM_FLOW=1/0`). Les bancs `test:load` instancient `DrizzleOrm` **hors kernel** → flux reste OFF → **0 régression** (vérifié : insert 16k ops/s, scan 1M ops/s inchangés). Détail moniteur → orm-core MEMORY.
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

- peerDeps: nodefony, @nodefony/http, @nodefony/orm-core, @nodefony/user. deps: drizzle-orm, better-sqlite3, **zod** (^4.4.3, ajouté à `external` rollup 2026-06-08). **optionalDeps: pg** (^8.13, driver postgres LAZY, externalisé rollup) ; devDeps += @types/pg. mysql2 suivra.
- Tests (vitest) : `npm test` = **84** (10 fichiers) — config Zod, banc orm-core, jointure complexe, SessionStorage IoC/CRUD, User P5.9, token store, webauthn store, **idempotency store (12, 2026-06-26)**. Banc ADR-0002 User↔Room + age.
- Load: `npm run test:load` (.mocharc.load.json, expose-gc) = 8 (charge/limites/mémoire). Insert 20k ~15k ops/s, scan ~1M/s, 30k cycles heapΔ 0.3MB, 300 conn heapΔ 0.1MB (0 fuite).
- Charge SESSION runtime (skill load-test, route `/nodefony/test/rest/session/set/k/v`, HTTP/2) : 3000/80 = 409 RPS p99 282ms ; 5000/150 = 408 RPS p99 562ms ; 100% 200, delta sessions EXACT (0 perte/doublon), 0 erreur. **Plafond ~408 RPS = better-sqlite3 SYNCHRONE mono-connexion** (writes sérialisés) — pas un bug, Postgres/MySQL paralléliserait. Concurrence ↑ = latence ↑, pas débit.
