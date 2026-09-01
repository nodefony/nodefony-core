# MEMORY.md — @nodefony/mongoose

## Purpose

Driver **NoSQL Mongoose** sur `@nodefony/orm-core` — adapter documentaire hétérogène (parité de contrat avec le driver SQL Drizzle). **Refonte Ph.2 (virage ORM)** : plus aucun `extends Orm` core legacy. Le module est un **Module bootable** dont le service `extends Service` orchestre des adapters orm-core autonomes (modèle `DrizzleService`). Le core ne connaît plus l'ORM.

## Core Components

- **`MongooseService extends Service`** (`nodefony/service/MongooseService.ts`) : au `onBoot`, instancie un `MongooseOrm` **par connecteur** (config) + le connecte ; active `queryFlowMonitor` (ON hors prod, override `NF_ORM_FLOW`) ; `mongoose.set("debug")` si `config.debug`. `onTerminate` → `disconnectAll`. `buildUri(cfg)` = `uri` brute OU `mongodb://host:port/dbname`.
- **`MongooseOrm extends Orm`** (orm-core) : `onConnect()` = `mongoose.createConnection(uri, options?)` (connexion **isolée**, PAS le singleton global → multi-ORM) + compile schémas/modèles depuis `entityRegistry` (relations sans FK : refs ObjectId + virtual populate). Ctor `(name, uri, options?)`. Sondes Studio : `ping`(`admin().command({ping:1})`) · `probe`(`serverStatus` → pool) · `describeEntity`(`schema.paths`, `_id`=PK) · **`describeConnection`**(`driver:"mongodb"` + `safeTarget()` SANS credentials + `ormVersion` mongoose résolu).
- **`MongooseRepository<T>`** : CRUD portable, `id`→`_id`, sortie `toObject({virtuals:true})`. `options.relations`→`populate()`. `$like` **lit le motif portable** (`%`/`_`, échappement `\`) via `likePatternToRegExp` d'orm-core → `$regex` ancré — pas une conversion naïve. **Flow tap** : chaque op (`find/findOne/create/update/delete/count`) instrumentée via `#prof` (timing → `queryFlowMonitor.record` + buffer ALS `RequestContext`), descripteur `Model.op {filtre}` redacté ; **coût nul** quand ni buffer ni flow actif (prod). Ctor `(model, connector, session?)`.
- **Tri portable** — `nodefony/src/mongoOrder.ts` : `MONGO_ORDER_ALIASES` (`id`→`_id`) + `mongoOrder()`/`toMongoSort()`. La convention `id`→`_id` vit chez l'ADAPTER, pas dans le vocabulaire de chaque ressource : c'est une propriété de Mongo, pas des jetons de tri.
- **Stores portables** (4, entité dans `nodefony/entity/`) — ⚠️ **deux points d'enregistrement, ne pas les confondre** : `SessionStorage` s'auto-déclare **à l'import** (dernière ligne du fichier, `SessionsService.registerStorage("mongoose", …)`) ; les 3 autres (`MongooseTokenStore`, `MongooseWebAuthnCredentialStore`, `MongooseWebhookStore`) sont posés par `registerMongooseFrameworkStores()` (`nodefony/registerStores.ts`) appelé au **`onKernelRegister`**, AVANT le connect du `onBoot` — désactivable par `frameworkEntities: false` (module data-only). Couverture partielle assumée : ni audit ni idempotence côté mongoose (sélectionner l'un des deux = échec franc, pas de repli muet). ⚠️ `MongooseWebAuthnCredentialStore` échappe encore en regex native — hors contrat `$like` portable.
- **`MongooseTransaction`** : wrap `ClientSession`. savepoint/rollbackTo = no-op (Mongo n'a pas de savepoints).
- **`SessionStorage implements ISessionStorage`** (`nodefony/src/SessionStorage.ts`) : store de session portable via `ormRegistry.get(SESSION_CONNECTOR).getRepository("session")`. **Logique identique au store Drizzle** (timestamps ms, GC `$lt`). `#repo()`→`null` si ORM déconnecté (dégradation gracieuse au shutdown). Auto-register `SessionsService.registerStorage("mongoose", …)`.
- **`sessionEntity`** : `@entity({ connector: SESSION_CONNECTOR, name:"session", schema })`. `SESSION_CONNECTOR = "nodefony"` (≠ `"default"` de Drizzle → 0 collision `entityRegistry` si les 2 modules cohabitent). Horodatages = `Number`.
- **Adapter User** — `entity/userEntity.ts` (`userSchema` **DÉRIVÉ de `USER_COLUMNS`** (`@nodefony/user`) : seules les colonnes `origin:"column"` sont déclarées — `id` vient de `_id`+virtuel, les horodatages de `timestamps:true` ; un défaut structuré est passé en FABRIQUE, jamais en valeur ; parité gardée par `tests/unit/userContractParity.test.ts`. `UserRow` = ré-export de `IUserRow`. + `createUserEntity`/`registerUserEntity`, binding ORM **dynamique**, `timestamps:true`) + `src/MongooseUserRepository.ts` (`implements IUserRepository`, décore `IRepository<UserRow>` + model natif ; **`#toUser` reporte les colonnes hors contrat** via `attachExtraColumns` (`@nodefony/user`, MÊME fonction que drizzle) en taisant `_id`/`__v` (`MONGOOSE_INTERNAL_KEYS`) — donc `createdAt`/`updatedAt` remontent enfin aux DTO admin, ce que ce dépôt ne faisait pas ; banc `tests/integration/user-champs-metier.test.ts` ; `findBySocialProvider` via `$elemMatch` ; `findByIdentifier` ; `withTransaction` ; `listPage`/`countActiveAdmins` natifs = `find(filter).sort().skip().limit(+1)` + `countDocuments`, `roles:role` containment tableau, `$regex/i` substring, `_id` tiebreaker). Éprouvé sur ReplSet + banc de pagination UNIQUE `@nodefony/user` (import cross-package).
- **Convention structure** : `nodefony/entity/` = **schémas** (session, token, user, webAuthnCredential, webhookEndpoint) · `nodefony/src/` = **couche d'accès** (les 4 stores + `MongooseUserRepository` + `mongoOrder`) · `nodefony/src/orm-core/` = **moteur générique** (`MongooseOrm`, `MongooseRepository`, `MongooseTransaction`). Séparation données ↔ comportement (idem `@nodefony/drizzle`).
- **`IEntity.timestamps?: boolean`** (orm-core) : Mongoose l'applique en option Schema (`createdAt`/`updatedAt` auto). Drizzle l'exprime en colonnes (schema-as-code) → flag sans effet côté SQL.
- **`index.ts`** `@services([MongooseService])` + `onKernelBoot` : monte le data plane ORM (`registerOrmAdminApi`) + `setOrmHealthProvider`/`setOrmRichProvider` (GLOBAUX, couvrent tous les ORM → **app Mongoose-only n'a plus un Studio ORM muet**, dette C5 atténuée ; factorisation `wireOrmAdminPlane` = Ph.4) + `registerMongooseAdapter` (détection erreurs Mongoose dans `nodefonyError`, jusqu'ici dormante).

## Config / Build / Test

- deps : `mongoose` 9.x, `mongodb` 7.x (versions exactes = `package.json`, jamais recopiées ici). peerDeps : `@nodefony/http`/`@nodefony/orm-core`/`nodefony`. devDep test : `mongodb-memory-server` + `vitest`.
- Config (`nodefony/config/config.ts`) : `MongooseModuleConfig { debug?, connectors }` + `MongooseConnectorConfig { uri? | host/port/dbname, options? }`. Défaut : connecteur `nodefony` → `localhost:27017/nodefony`.
- Manifeste app : **opt-in** (commenté dans `nodefony.config.ts` ; Drizzle = ORM SQL par défaut).
- **Test = `npx vitest run`** (`globals:true`, timeout 120s — 1ᵉʳ run télécharge mongod). Aucun compte n'est écrit ici (il se périme au premier test ajouté) : `npx vitest run 2>&1 | tail -4`. Couverture par sujet : `orm-core-mongoose` (CRUD/relations/tx `MongoMemoryReplSet`) · `advanced` · `session-storage` · `MongooseService` · `bootHookPolicy` · `user-mongoose` + `user-pagination` · `token-store` + `token-pagination` · `webhook-store` · `webauthn-credential-store` + `webauthn-pagination` · `config` (unit).
- **Mongo de test portable (`NF_MONGO_TEST_URI`)** : si défini → on tape ce serveur (conteneur de service CI GitHub/GitLab, ou `docker run -p 27017:27017 mongo:7`) = **0 download** ; sinon → `mongodb-memory-server` in-process (dev local). ⚠️ Le banc orm-core exige un **replica set** (transactions) → reste sur `MongoMemoryReplSet` (un service standalone ne suffit pas).

## Gotchas

- `verifyIndexes()` : `model.init()` (attend la construction, REJETTE si refusée) → `diffIndexes()`
  (`{toCreate,toDrop}`, dry-run) → `CRITIC` par index manquant. **Ordre imposé** : un `diffIndexes()`
  avant `init()` rend un faux positif (construction en cours — mesuré). Lancé au `connect()`, non
  attendu ; `pendingIndexAudit` = la promesse. Verdict structuré `IIndexAudit {entity, collection,
missing[], extra[], error?}`. **Jamais** `syncIndexes()` (il DROP les index non déclarés).
- `autoIndex` : champ Zod du connecteur, prime sur `options.autoIndex` (`buildConnectOptions`).
  `false` → aucune construction, constat + `CRITIC` maintenus.
- **Mongoose SAIT quand le serveur tombe — encore faut-il écouter.** Le setter de `readyState` émet l'état, piloté par `serverDescriptionChanged` (nœud simple) ou `topologyDescriptionChanged` (replica set : perte du primaire). `#wireLifecycle` traduit `disconnected`/`close`/`error` → `connectionLost`, `reconnected`/`connected` → `connectionRestored`. `error` est écouté AUSSI parce qu'une `Connection` est un EventEmitter : sans auditeur, une erreur émise tue le process.
- **Détacher AVANT `close()`** dans `disconnect()` : `close()` émet `close`, et un arrêt VOLONTAIRE compté comme incident polluerait le tableau de bord à chaque shutdown.
- **`savepoint()`/`rollbackTo()` sont des NO-OP** (MongoDB n’a pas de savepoints) — ⚠️ un banc qui s’en sert pour sonder le serveur ne lui parle JAMAIS et passe au vert sur une base éteinte. Une transaction Mongo se sonde par une **écriture**.
- **Le driver dédoublonne déjà** : le setter de `readyState` n’émet que sur CHANGEMENT d’état. Conséquence pour les tests : un banc de bascule réelle (`replSetStepDown`) ne discrimine PAS notre idempotence (mesuré : il passe même en la débranchant) — elle s’éprouve sur une rafale ÉMISE (`outage.test.ts`).
- **Le banc réel exige `NF_MONGO_TEST_URI`**, pas seulement une URI : le décor peut fournir un `mongod` éphémère, et couper le conteneur en éprouvant l’éphémère donnerait un vert qui n’a rien mesuré.
- **Une requête pendant une coupure pend 30 s** (`serverSelectionTimeoutMS` par défaut du driver) avant `MongoServerSelectionError` — mesuré au banc. Les commandes sont par ailleurs BUFFERISÉES (`bufferTimeoutMS` 10 s) et repartent seules si le serveur revient avant. (vs SQL)

- **PK `_id` (ObjectId) ≠ `id`** : critère `{id}`→`{_id}`, sortie expose le virtuel `id` (hex string) → contrat `id:string` respecté.
- **Relations sans FK** : `one-to-many` = réf ObjectId sur l'enfant + virtual populate sur le parent ; `many-to-one`/`one-to-one` = réf sur la source ; `many-to-many` → native (throw, déclarer via `getNativeConnection`).
- **Transactions = replica set obligatoire** (`session.withTransaction`, managé). Standalone = pas de tx.
- **virtuals** : schéma `{toObject:{virtuals:true}, toJSON:{virtuals:true}}` pour exposer `id` + populates.
- **`find` ET `findOne` gardent `order`** (`assertOrderOption` d'orm-core) et l'APPLIQUENT tous les deux : `findOne` triait auparavant par ordre naturel Mongo, donc rendait un autre document que Drizzle pour le même appel. Deux points d'appel ici parce que `findOne` construit sa propre requête — la LOGIQUE, elle, reste unique dans orm-core.
- `describeConnection` est **sync** → `safeTarget()` nettoie l'URI (`new URL` → strip `user:pass`, fallback regex pour `mongodb://h1,h2/db`) ; version serveur indispo en sync (dispo via `probe().extra.serverVersion`).

## Liens

- ADR : `docs/adr/0003` (P5.4 + portabilité 2 adapters). Audit : mémoire IA `core-dev/audits/orm-state-and-hardening-2026-06.md`.
- `@nodefony/orm-core` (contrats), `@nodefony/drizzle` (adapter SQL référence, parité du test/SessionStorage).
- Mémoires : `project_orm_hardening_kit` (3 décisions virage), `project_orm_audit_state` (boussole).
