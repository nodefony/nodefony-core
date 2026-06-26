# CLAUDE.md — @nodefony/drizzle

## Rôle

**adapter concret** de `@nodefony/orm-core` (avec `@nodefony/mongoose`). Driver SQL **type-safe-first** (choix #1 SQL moderne 2026).
Implémente `Orm`/`IOrm`, `IRepository<T>`, `ITransaction` au-dessus de Drizzle ORM

- `better-sqlite3` (test) — Postgres/MySQL par simple changement de driver.

## Nature : module bootable + adapter lib

Deux usages :

1. **Module bootable** (depuis 2026-05-21) : `index.ts` exporte par défaut une
   classe `Drizzle extends Module` (`@services([DrizzleService])`). Ajouté à
   `@modules()` de l'app → `DrizzleService` connecte au boot (`onBoot`) un
   `DrizzleOrm` **par connecteur** de la config (`nodefony/config/config.ts`,
   défaut : connecteur `default` sur `<root>/nodefony/databases/nodefony-drizzle.db`).
   Ferme à `onTerminate`. C'est l'**ORM SQL par défaut recommandé** de l'app dev.
2. **Adapter lib** : les classes `DrizzleOrm`/`Repository`/`Transaction` restent
   exportées (named) pour un usage direct / banc-test (`new DrizzleOrm(name, {filename})`,
   auto-register dans `ormRegistry`).

> `better-sqlite3` est en **`dependencies`** (driver runtime du module bootable),
> pas en devDeps. Service pattern calqué sur `FrontendService` :
> `super(name, module.container, module.notificationsCenter, module.options)` +
> hooks `kernel.once("onBoot"|"onTerminate")` dans le constructeur.

## Décisions figées (P7.4)

- **Schema-as-code** : `entity.schema` EST une table Drizzle (`sqliteTable(...)`).
  Pas de `define()`. L'adapter dérive le **DDL** via `getTableConfig()` (dev/test) ;
  la **prod = `drizzle-kit`** (migrations).
- **Opérateurs riches** (ADR-0003 risque #3 — tranché ici) : objet `$`-préfixé
  typé (`FieldOperators<V>` de orm-core) → traduit en `eq()/gt()/inArray()/like()`.
  `$like` reste sémantique **SQL** (`%`/`_`), natif Drizzle.
- **Eager-load manuel** (`options.relations`) : 1 requête `IN (...)` par relation
  déclarée + regroupement mémoire. Volontairement **sans** la couche `relations()`
  de Drizzle (générique cross-entités, pas de double déclaration).
- **Transaction manuelle** `BEGIN`/`COMMIT`/`ROLLBACK` : `better-sqlite3` est
  **synchrone** → son helper `db.transaction()` committe au `return`, avant les
  `await` du contrat async. Connexion unique → encadrer = atomique.
  `withTransaction(tx)` réutilise le **même** db.
- **Trappe SQL brut** : `getNativeConnection()` renvoie le db Drizzle (tag `sql`).
- **Config = Zod (2026-06-08, alignement famille ORM)** : `nodefony/config/schema.ts`
  (source de vérité) → `defineDrizzleConfig` (parse + env `DRIZZLE_DB_FILE` + freeze)
  → validée au `onKernelRegister`, exposée `this.set("drizzleConfig")`. Augmente
  `NodefonyModuleConfig` (typage `use()`). ⚠️ `filename` **optionnel SANS défaut**
  dans le schéma (pur) : le chemin SQLite (kernel-dépendant) est résolu **au boot**
  par `DrizzleService` (`#defaultFilename`), jamais au top-level. Même pattern que
  `@nodefony/mongoose`. Réf : [`docs/audits/orm-config-pattern-2026-06.md`](../../../../docs/audits/orm-config-pattern-2026-06.md).

## Interdits

- `any`, `@ts-ignore`, `require()`. ESM only, préfixe `node:`.
- Importer `@nodefony/http`/`@nodefony/framework` (orm = couche basse).
- Logique métier.

## Gotchas

- `better-sqlite3` = natif (compile via node-gyp) ; OK sur Node 26 (prebuild 12.x).
- `db.query.*` (API relationnelle Drizzle) **non** utilisée → typage générique
  sans schéma (`BetterSQLite3Database<Record<string, never>>`), eager-load manuel.
- Colonne d'une table : `(table as unknown as Record<string,SQLiteColumn>)[name]`.
- `OFFSET` SQLite exige un `LIMIT` → `limit(-1)` si seul l'offset est posé.
- **Runner = Vitest** (migré de Mocha le 2026-05-28, cf `feedback_test_framework_vitest`).
  `vitest` vient de la **racine** ; tests en `globals:true` + `node:assert` (aucun import
  vitest ni chai). Ne pas réintroduire mocha/`.mocharc`.
- **`SessionStorage` tolère le shutdown** (fix 2026-05-22, commit `ce181ba`) : `#repo()`
  renvoie `null` si `!orm.isConnected()` (l'ORM se déconnecte au `onTerminate` avant le
  drain des serveurs http → requête Twig en vol qui retouchait l'ORM mort = `unhandledRejection`
  « no entity table registered under session »). read→session vide, write/gc/destroy/open→no-op.
  NE PAS « simplifier » en rappelant `getRepository` direct. Cf RETEX skill `nodefony-framework-dev` §11.

## Build / types / test

- `npm run build` (rollup preserveModules) → `dist/` + `dist/types/` + `exports`
  (standard conforme, pas de `.d.ts` manuel).
- `npm test` (`vitest.config.ts`) → `tests/integration/` : banc orm-core,
  jointure très complexe (CTE+window+sous-requêtes corrélées via trappe native,
  LEFT JOIN typé), user-drizzle, session-storage. **27 tests**.
- `npm run test:load` (`vitest.config.load.ts`, pool forks `--expose-gc`) → `tests/load/` :
  charge/limites/mémoire (8 tests). Mesures 2026-05-21 (Node 26, :memory:) :
  insert 20k ≈ 15k ops/s, scan 20k ≈ 1M ops/s, $in(5000) 23ms, 30k cycles
  create/find/delete heapΔ 0.3MB, 300 connexions heapΔ 0.1MB (**0 fuite**).

## Adapter User (P5.9 ✅ — ORM SQL par défaut)

Convention structure (figée 2026-06-08) : **`nodefony/entity/` = schéma, `nodefony/src/` = repository** (idem `@nodefony/mongoose`). Implémente le contrat `@nodefony/user` (peerDep) :

- **`userTable`** (`entity/userTable.ts`) : `sqliteTable("User")` schema-as-code. Colonnes JSON
  (`roles`/`socialProviders`/`metadata`, `mode:"json"`) + booléens (`enabled`/`locked`,
  `integer mode:"boolean"`). ⚠️ **Défauts en `$defaultFn` (JS-level), PAS `.default()`** :
  le DDL dérivé (`getTableConfig`) n'émet pas les `DEFAULT` SQL → une colonne `NOT NULL`
  sans valeur casserait l'INSERT. `$defaultFn` : id UUID, roles/socialProviders `[]`, metadata `{}`,
  enabled `true`, locked `false`, `createdAt`/`updatedAt` (`now` ; `updatedAt` régénéré à chaque update via `$onUpdateFn` — pendant SQL du `timestamps:true` Mongoose).
- **`createUserEntity(orm)` / `registerUserEntity(orm)`** : binding ORM **dynamique** (nom de
  connecteur, ex. `"default"`) — la table est statique mais sa liaison dépend de la config, donc
  pas d'`@entity` figé. Enregistrer **avant** `orm.connect()`.
- **`DrizzleUserRepository`** (`src/DrizzleUserRepository.ts`) `implements IUserRepository` : décore `IRepository<UserRow>` ; mappe
  ligne ↔ `BaseUser` (les consommateurs reçoivent le comportement `hasRole`/`isActive`/`isLocked`).
  `findByIdentifier` (findOne) + `findBySocialProvider` (scan JSON `json_each` **bindé**, Shadow User
  OAuth). `DrizzleUserRepository.from(orm)` = factory. `withTransaction(tx)` rebind base + db.
- Sécurité : requêtes **paramétrées** (drizzle `sql\`…${x}\``, jamais de concat). Le credential
  (hash) transite par le repo = frontière de persistance assumée.

## Store d'idempotence Drizzle (axe 3 P6.8 ✅ — 2026-06-26)

Implémente `IIdempotencyStore` (contrat au **CORE** `nodefony`, `import type` → 0 cycle) :
dédup des **mutations** rejouées PARTAGÉE cross-pod, sans Redis (pour un cluster qui a déjà
une base). Convention-frère = `DrizzleTokenStore` (approche B) + `RedisIdempotencyStore` (logique idempotence).

- **`nodefony/entity/idempotencyEntity.ts`** : `idempotencyKeyTable` (`key` PK, `fingerprint`,
  `state` `if|done`, `response` json nullable, `expiresAt` int NOT NULL + index) + `createIdempotencyEntities(orm)`/
  `registerIdempotencyEntities(orm)` (binding **dynamique**, **avant** connect) + `IdempotencyKeyRow`.
- **`nodefony/src/DrizzleIdempotencyStore.ts`** : `begin` = **réservation atomique** =
  `insert(...).onConflictDoUpdate({ target:key, set:{…if…}, setWhere: lt(expiresAt, now) }).returning({key})`.
  Le `RETURNING` ne rend une ligne QUE si l'INSERT (clé neuve) ou le DO UPDATE (vol d'une entrée
  **morte**) a eu lieu → `length>0` ⇒ `fresh` ; `===0` ⇒ contention (clé vivante) → SELECT →
  `in-flight`/`replayed`/`mismatch`. **Jamais `fresh` hors réservation atomique = anti double-effet**
  (= le `SET NX PX` Redis, en une instruction). `complete`/`abort` = UPDATE/DELETE conditionnels
  `WHERE state='if'` (atomiques, `fingerprint` préservé). `gc(now)` = DELETE des expirées (pas de TTL
  natif SQL → GC applicatif). **Résolveur LAZY** (`() => DrizzleDb|null`, garde `isConnected()`) →
  ordre de boot + shutdown gérés ; `null` → fail-soft (begin=fresh sans dédup, reste no-op).

**Câblage (approche B — l'app, comme le token store) — NON câblé par défaut** : activation =
décision de déploiement (cluster multi-pod). Recette :

```typescript
// 1) sélection : NF_IDEMPOTENCY_STORE=drizzle (knob framework `idempotency.store`)
//    + connecteur multi-pod : use("@nodefony/drizzle", { connectors: { default:
//      { dialect: "postgres", url: ctx.env.PG_URL } } })
// 2) entité (avant orm.connect()) — le dialecte doit matcher celui du connecteur :
import {
  registerIdempotencyEntities,
  DrizzleIdempotencyStore,
} from "@nodefony/drizzle";
import { registerIdempotencyStore } from "@nodefony/framework";
registerIdempotencyEntities("default", "postgres");
// 3) fabrique (registre framework) — résout l'ORM par NOM, lazy via .from
//    (`from` lit `orm.dialect` → injecte la variante de table du dialecte) :
registerIdempotencyStore("drizzle", ({ module }) => {
  const drizzle = module.kernel?.container?.get("drizzle"); // DrizzleService
  const orm = drizzle?.getOrm("default");
  if (!orm) throw new Error("@nodefony/drizzle not loaded");
  return DrizzleIdempotencyStore.from(orm); // résolveur lazy → tolère l'ordre de boot
});
```

> **Multi-dialecte (2026-06-26)** : `createIdempotencyTable(dialect)` produit la variante `sqlite`
> OU `postgres` ; `registerIdempotencyEntities(orm, dialect)` et `DrizzleIdempotencyStore.from(orm)`
> (qui lit `orm.dialect`) la sélectionnent. Le store est **dialect-agnostique** (référence
> `table.key`/`.expiresAt` via `eq`/`lt`). **Deux niveaux de preuve** :
>
> - **SQLite** (`tests/integration/idempotency-store.test.ts`, 12) = **sémantique séquentielle**
>   (verdicts, mismatch post-complétion, vol d'expiré, gc, size, fail-soft). Mono-fichier → ne prouve
>   PAS la concurrence multi-pod.
> - **Postgres** (`.claude/skills/nodefony-load-test/scripts/idempotency-postgres-e2e.mjs`, **7/7**) =
>   **atomicité cross-pod RÉELLE** : 2 pods (2 pools PG) × 20 rounds × 10 `begin` concurrents → exactement
>   **1 fresh + 9 in-flight**/round (0 race) + replay/mismatch/in-flight cross-pod. C'est la preuve que
>   SQLite ne peut pas donner. Prérequis : `docker compose --profile postgres up -d postgres`.

## Portabilité multi-dialecte (chantier — Slice 0 ✅ 2026-06-26)

> **Pourquoi** : un framework doit porter ses entités sur les bases majeures (sqlite dev/test,
> postgres + mysql prod). Drizzle est **schema-as-code dialect-spécifique** (`sqliteTable` ≠ `pgTable`,
> colonnes typées par dialecte) → contrairement à Sequelize, on **ne peut pas « juste changer le
> dialect »**. On reconstruit cette abstraction au niveau Nodefony : une **factory par entité**
> (`createXTable(dialect)`) = l'équivalent du `dialect` Sequelize, porté par le framework. L'utilisateur
> final écrit `dialect: "postgres"` dans la config et ça marche ; le coût (vs Sequelize natif) = une
> factory par entité, en échange de la **type-safety** Drizzle (choix figé P7.4/ADR-0003).

**Mécanisme (le patron à dérouler)** :

- **`connector.dialect`** (`"sqlite" | "postgres" | "mysql"`, défaut `sqlite`) dans `schema.ts`
  (+ `url` pour pg/mysql). Type `SqlDialect` exporté.
- **`DrizzleOrm` dialect-aware** : `onConnect` route `#connectSqlite` (better-sqlite3, sync) /
  `#connectPostgres` (driver `pg` **lazy** `await import`, `optionalDependency`, externalisé rollup).
  DDL dérivé partagé `#buildCreateTable` (le bon `getTableConfig` selon dialecte ; `col.getSQLType()`
  rend `text`/`integer` SQLite, `text`/`bigint`/`jsonb` PG). `disconnect`/`ping`/`describeConnection`/
  `describeEntity` routés. `getNativeConnection<DrizzleDb>()` inchangé.
- **Factory d'entité** `createXTable(dialect)` : switch → table du dialecte. Divergences typiques :
  `expiresAt` `integer` (SQLite 64-bit) → `bigint mode:number` (PG ; `integer` PG 32-bit déborde sur
  epoch ms), `text mode:json` → `jsonb`. **Mêmes NOMS de colonnes** → le store/repo reste agnostique.
- **Drivers** : `pg` `optionalDependencies` (+ `@types/pg` dev) ; `mysql2` suivra. `better-sqlite3`
  reste `dependencies` (défaut bootable).

**Dette assumée du Slice 0** (typage cross-dialecte Drizzle = pénible) : `#tables`/`#db` typés SQLite ;
en postgres les `PgTable`/`NodePgDatabase` y sont stockés via cast (runtime correct, API commune). Le
typage `getRepository` postgres viendra avec le **portage du `DrizzleRepository`** (le store d'idempotence
consomme `getNativeConnection`, pas le repository → non bloquant pour le Slice 0).

**Reste (slices suivants, 1 entité = 1 session)** : `userTable` (⚠️ `findBySocialProvider` =
`json_each` SQLite → `jsonb` PG), `tokenEntity`, `sessionEntity`, `webAuthnCredentialEntity` ; puis
**mysql** (`mysql2`) + DDL prod drizzle-kit. Décider à ce moment d'un **kit de colonnes partagé**
(`colKit(dialect)`) si la duplication des factory devient sensible (prototype d'abord, mesurer).

## Roadmap

- ✅ P7.4 adapter orm-core + ADR-0003 risque #3 résolu.
- ✅ **P5.9 entité `User` Drizzle** (8 tests : CRUD + finders + tx + défauts). ORM par défaut → fait EN PREMIER (avant Mongoose P5.8).
- ✅ **Store d'idempotence Drizzle (axe 3 P6.8, 2026-06-26)** — `IIdempotencyStore` SQL, `begin` atomique `ON CONFLICT DO UPDATE`, GC applicatif, 12 tests SQLite + **e2e Postgres cross-pod 7/7** (atomicité réelle prouvée).
- 🚧 **Portabilité multi-dialecte (chantier, Slice 0 ✅ 2026-06-26)** — `connector.dialect` + `DrizzleOrm` lazy pg + factory d'entité ; **idempotency porté + prouvé sur PG**. Reste : `user`/`token`/`session`/`webauthn` (1 entité/session) puis **mysql** + DDL prod drizzle-kit. Cf section « Portabilité multi-dialecte ».
