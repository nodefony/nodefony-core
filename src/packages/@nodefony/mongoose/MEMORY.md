# MEMORY.md — @nodefony/mongoose

## Purpose

Driver **NoSQL Mongoose** sur `@nodefony/orm-core` — adapter documentaire hétérogène (parité de contrat avec le driver SQL Drizzle). **Refonte Ph.2 (2026-06-08, virage ORM)** : plus aucun `extends Orm` core legacy. Le module est un **Module bootable** dont le service `extends Service` orchestre des adapters orm-core autonomes (modèle `DrizzleService`). Le core ne connaît plus l'ORM.

## Core Components

- **`MongooseService extends Service`** (`nodefony/service/MongooseService.ts`) : au `onBoot`, instancie un `MongooseOrm` **par connecteur** (config) + le connecte ; active `queryFlowMonitor` (ON hors prod, override `NODEFONY_ORM_FLOW`) ; `mongoose.set("debug")` si `config.debug`. `onTerminate` → `disconnectAll`. `buildUri(cfg)` = `uri` brute OU `mongodb://host:port/dbname`.
- **`MongooseOrm extends Orm`** (orm-core) : `onConnect()` = `mongoose.createConnection(uri, options?)` (connexion **isolée**, PAS le singleton global → multi-ORM) + compile schémas/modèles depuis `entityRegistry` (relations sans FK : refs ObjectId + virtual populate). Ctor `(name, uri, options?)`. Sondes Studio : `ping`(`admin().command({ping:1})`) · `probe`(`serverStatus` → pool) · `describeEntity`(`schema.paths`, `_id`=PK) · **`describeConnection`**(`driver:"mongodb"` + `safeTarget()` SANS credentials + `ormVersion` mongoose résolu).
- **`MongooseRepository<T>`** : CRUD portable, `id`→`_id`, sortie `toObject({virtuals:true})`. `options.relations`→`populate()`, `$like`→`$regex`. **Flow tap** : chaque op (`find/findOne/create/update/delete/count`) instrumentée via `#prof` (timing → `queryFlowMonitor.record` + buffer ALS `RequestContext`), descripteur `Model.op {filtre}` redacté ; **coût nul** quand ni buffer ni flow actif (prod). Ctor `(model, ormName, session?)`.
- **`MongooseTransaction`** : wrap `ClientSession`. savepoint/rollbackTo = no-op (Mongo n'a pas de savepoints).
- **`SessionStorage implements ISessionStorage`** (`nodefony/src/SessionStorage.ts`) : store de session portable via `ormRegistry.get(SESSION_ORM).getRepository("session")`. **Logique identique au store Drizzle** (timestamps ms, GC `$lt`). `#repo()`→`null` si ORM déconnecté (dégradation gracieuse au shutdown). Auto-register `SessionsService.registerStorage("mongoose", …)`.
- **`sessionEntity`** : `@entity({ orm: SESSION_ORM, name:"session", schema })`. `SESSION_ORM = "nodefony"` (≠ `"default"` de Drizzle → 0 collision `entityRegistry` si les 2 modules cohabitent). Horodatages = `Number`.
- **`index.ts`** `@services([MongooseService])` + `onKernelBoot` : monte le data plane ORM (`registerOrmAdminApi`) + `setOrmHealthProvider`/`setOrmRichProvider` (GLOBAUX, couvrent tous les ORM → **app Mongoose-only n'a plus un Studio ORM muet**, dette C5 atténuée ; factorisation `wireOrmAdminPlane` = Ph.4) + `registerMongooseAdapter` (détection erreurs Mongoose dans `nodefonyError`, jusqu'ici dormante).

## Config / Build / Test

- deps : `mongoose` 9.6.3, `mongodb` 7.2.0. peerDeps : `@nodefony/http`/`@nodefony/orm-core`/`nodefony`. devDep test : `mongodb-memory-server` 11.x + **`vitest` 4.1.8**.
- Config (`nodefony/config/config.ts`) : `MongooseModuleConfig { debug?, connectors }` + `MongooseConnectorConfig { uri? | host/port/dbname, options? }`. Défaut : connecteur `nodefony` → `localhost:27017/nodefony`.
- Manifeste app : **opt-in** (commenté dans `nodefony.config.ts` ; Drizzle = ORM SQL par défaut).
- **Test = `vitest run`** (`tests/integration/`, `globals:true`, timeout 120s — 1ᵉʳ run télécharge le binaire mongod). **2 bancs, 17 tests** : `orm-core-mongoose` (CRUD/relations/tx via `MongoMemoryReplSet`) + `session-storage` (IoC + CRUD + GC + sondes, **hybride**).
- **Mongo de test portable (`MONGO_TEST_URI`)** : si défini → on tape ce serveur (conteneur de service CI GitHub/GitLab, ou `docker run -p 27017:27017 mongo:7`) = **0 download** ; sinon → `mongodb-memory-server` in-process (dev local). ⚠️ Le banc orm-core exige un **replica set** (transactions) → reste sur `MongoMemoryReplSet` (un service standalone ne suffit pas).

## Gotchas (vs SQL)

- **PK `_id` (ObjectId) ≠ `id`** : critère `{id}`→`{_id}`, sortie expose le virtuel `id` (hex string) → contrat `id:string` respecté.
- **Relations sans FK** : `one-to-many` = réf ObjectId sur l'enfant + virtual populate sur le parent ; `many-to-one`/`one-to-one` = réf sur la source ; `many-to-many` → native (throw, déclarer via `getNativeConnection`).
- **Transactions = replica set obligatoire** (`session.withTransaction`, managé). Standalone = pas de tx.
- **virtuals** : schéma `{toObject:{virtuals:true}, toJSON:{virtuals:true}}` pour exposer `id` + populates.
- `describeConnection` est **sync** → `safeTarget()` nettoie l'URI (`new URL` → strip `user:pass`, fallback regex pour `mongodb://h1,h2/db`) ; version serveur indispo en sync (dispo via `probe().extra.serverVersion`).

## Liens

- ADR : `docs/adr/0003` (P5.4 + portabilité 2 adapters). Audit : `docs/audits/orm-state-and-hardening-2026-06.md`.
- `@nodefony/orm-core` (contrats), `@nodefony/drizzle` (adapter SQL référence, parité du test/SessionStorage).
- Mémoires : `project_orm_hardening_kit` (3 décisions virage), `project_orm_audit_state` (boussole).
