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

## Roadmap

- ✅ P7.4 adapter orm-core + ADR-0003 risque #3 résolu.
- ✅ **P5.9 entité `User` Drizzle** (8 tests : CRUD + finders + tx + défauts). ORM par défaut → fait EN PREMIER (avant Mongoose P5.8).
- ⬜ Postgres/MySQL drivers (changer le client + le dialecte de table).
