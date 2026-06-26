# MEMORY.md — @nodefony/drizzle

Purpose: 3e adapter orm-core + module bootable. Drizzle + better-sqlite3. Type-safe-first. P7.4.

## Module bootable (2026-05-21)

- `index.ts` default export = `Drizzle extends Module` + `@services([DrizzleService])`. Ajouté à `@modules()` app. ORM SQL par défaut.
- `nodefony/service/DrizzleService.ts` : ctor `super(name, module.container, module.notificationsCenter, module.options)` ; `kernel.once("onBoot")` → `connectAll()` lit la config VALIDÉE `this.module.get("drizzleConfig")` (1 DrizzleOrm/connecteur) ; `#defaultFilename(name)` résout le chemin SQLite **AU BOOT** (kernel présent) si `filename` omis : `<root>/nodefony/databases/nodefony-<x>.db` (default → `nodefony-drizzle.db`) ; `onTerminate` → disconnectAll. `getOrm(name="default")`.
- **Config Zod (2026-06-08, alignement famille ORM)** : `nodefony/config/schema.ts` = source de vérité (`filename` **optionnel SANS défaut** — schéma pur, pas de deref kernel) → `defineDrizzleConfig` (parse + env `DRIZZLE_DB_FILE` + freeze) → validée au `onKernelRegister`, exposée `this.set("drizzleConfig")`. Augmente `NodefonyModuleConfig` → `use("@nodefony/drizzle", …)` typé. `config.ts` = `schema.parse({})`. Même pattern que `@nodefony/mongoose`. Cf audit `docs/audits/orm-config-pattern-2026-06.md`.
- better-sqlite3 = **dependencies** (runtime), pas devDeps.
- Boot vérifié : `MODULE ADD : drizzle` + `Drizzle ORM "default" connected` + db créée, 4 serveurs UP, health 200.

## Adapter User (P5.9 — ORM par défaut, fait EN PREMIER)

- `nodefony/src/user/` : `userTable` (sqliteTable, JSON+boolean modes), `createUserEntity(orm)`/`registerUserEntity(orm)` (binding ORM dynamique, **avant** connect), `DrizzleUserRepository implements IUserRepository` (`from(orm)`).
- Mappe ligne ↔ `BaseUser` (comportement). `findByIdentifier` + `findBySocialProvider` (json_each **bindé**, Shadow User). peerDep `@nodefony/user` ajoutée + externalisée rollup (sinon bundle → casse sur @node-rs/bcrypt natif).
- ⚠️ **Défauts via `$defaultFn` (JS), PAS `.default()` SQL** : le DDL dérivé n'émet pas les DEFAULT → NOT NULL casserait.
- ⚠️ Test cleanup : `entityRegistry.unregister("User", ORM)` **scopé** (sans orm = efface le bucket entier = contamine le banc P7.4).

## Store idempotence Drizzle (axe 3, P6.8 — 2026-06-26)

- `nodefony/entity/idempotencyEntity.ts` : `idempotencyKeyTable` (`key` PK, `fingerprint`, `state` `if|done`, `response` json nullable, `expiresAt` int NOT NULL + index) + `createIdempotencyEntities(orm)`/`registerIdempotencyEntities(orm)` (binding dynamique, **avant** connect) + `IdempotencyKeyRow` + `IDEMPOTENCY_ENTITY_NAME="idempotency_key"`. `module:"framework"` (ERD).
- `nodefony/src/DrizzleIdempotencyStore.ts implements IIdempotencyStore` (contrat CORE `nodefony`, `import type` → 0 cycle). `.from(orm, now?, lease?, ttl?)`.
- **begin = réservation ATOMIQUE = `SET NX PX` SQL** : `insert(...).onConflictDoUpdate({ target:key, set:{…if…}, setWhere: lt(expiresAt, now) }).returning({key})`. `returning.length>0` ⇒ **fresh** (INSERT clé neuve OU **vol** d'une entrée morte via le DO UPDATE WHERE expiré) ; `===0` ⇒ contention (clé vivante) → SELECT → in-flight/replayed/mismatch. **JAMAIS fresh hors réservation** = anti double-effet (l'invariant). Cf le `RETURNING` SQLite/PG ne rend une ligne QUE si insert/update a eu lieu.
- complete = UPDATE `set done,response,expiresAt=now+ttl` WHERE `key AND state='if'` (**fingerprint NON touché** = préservé → mismatch 422 post-complétion). abort = DELETE WHERE `key AND state='if'`. gc(now) = DELETE `expiresAt<=now` → count (**pas de TTL natif SQL** → GC applicatif, à mutualiser GC session). size = `#pending` local best-effort (≠ cross-pod).
- **Résolution LAZY** (calqué `RedisIdempotencyStore`) : ctor prend `() => DrizzleDb|null` ; `.from` = `() => orm.isConnected() ? orm.getNativeConnection<DrizzleDb>() : null`. Résout l'**ordre de boot** (framework résout le store à onKernelBoot, orm connecte à onBoot) + **shutdown** (gotcha SessionStorage). null → begin=fresh (sans dédup), complete/abort/gc=no-op.
- **Approche B** (PAS d'auto-register) : l'app câble `registerIdempotencyStore("drizzle", ({module})=>DrizzleIdempotencyStore.from(module.kernel.container.get("drizzle").getOrm("default")))` (registre @nodefony/framework) + `registerIdempotencyEntities("default")` avant connect + knob `NF_IDEMPOTENCY_STORE=drizzle`. Framework `onKernelBoot` résout → override service `idempotencyStore` (prod fatal / dev fallback mémoire).
- ⚠️ **SQLite = banc sémantique** (mono-fichier ≠ multi-pod). Cible réelle = **Postgres/MySQL**. Preuve cross-pod réelle = e2e Postgres (à faire). Test intégration **12** (verdicts, mismatch post-complétion, vol d'expiré in-flight+done, gc count, size, fail-soft handle null).

## Core Components

- `DrizzleOrm extends Orm` : onConnect → `new BetterSqlite3(filename)` + `drizzle(client)`. Schema-as-code (entity.schema = table). DDL via `getTableConfig()`. tx manuelle. **`describeEntity(name)` (2026-05-22)** : colonnes normalisées via `getTableConfig().columns` (`name/getSQLType()/primary/!notNull/isUnique`) → alimente le data plane ORM/ERD/IA (orm-core). Le **module Drizzle** (`index.ts onKernelBoot`) appelle `registerOrmAdminApi(broker)` (idempotent) → monte `/nodefony/orm/api/*` (orm-core étant lib pure).
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

- peerDeps: nodefony, @nodefony/http, @nodefony/orm-core, @nodefony/user. deps: drizzle-orm, better-sqlite3, **zod** (^4.4.3, ajouté à `external` rollup 2026-06-08).
- Tests (vitest) : `npm test` = **84** (10 fichiers) — config Zod, banc orm-core, jointure complexe, SessionStorage IoC/CRUD, User P5.9, token store, webauthn store, **idempotency store (12, 2026-06-26)**. Banc ADR-0002 User↔Room + age.
- Load: `npm run test:load` (.mocharc.load.json, expose-gc) = 8 (charge/limites/mémoire). Insert 20k ~15k ops/s, scan ~1M/s, 30k cycles heapΔ 0.3MB, 300 conn heapΔ 0.1MB (0 fuite).
- Charge SESSION runtime (skill load-test, route `/nodefony/test/rest/session/set/k/v`, HTTP/2) : 3000/80 = 409 RPS p99 282ms ; 5000/150 = 408 RPS p99 562ms ; 100% 200, delta sessions EXACT (0 perte/doublon), 0 erreur. **Plafond ~408 RPS = better-sqlite3 SYNCHRONE mono-connexion** (writes sérialisés) — pas un bug, Postgres/MySQL paralléliserait. Concurrence ↑ = latence ↑, pas débit.
