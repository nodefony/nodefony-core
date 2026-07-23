# MEMORY.md — @nodefony/redis (audience IA)

## Purpose

Accès Redis générique. Module = fournisseur de connexions + client brut. 0 logique métier.

## Core Components

- `Redis` (index.ts): Module. `@services([RedisService])`. `onKernelRegister` → `defineRedisConfig` → `set("redisConfig")`.
- `RedisService` (service/redis.ts): `initialize()` ouvre les connexions ; `getClient(name)`, `getConnection(name)`, `createConnection(name)`, `closeConnections()`. Map `#connections` lazy (null).
- `scanCursor.ts` (src/): règle UNIQUE de curseur `SCAN` des 3 stores — `encodeCursor`/`decodeCursor`/`scanOrZero`/`MAX_SCAN`. Ne PAS recopier dans un store (c'est l'origine de l'asymétrie de durcissement).
- `Connection` (src/Connection.ts): wrap `createClient` v6. Handlers `#onError/#onConnect/#onReady/#onEnd/#onReconnecting` stockés → `removeListener` à `close()`.
- `buildClientOptions` (src/buildClientOptions.ts): config → `RedisClientOptions`. Merge global+override. `url` prioritaire. Construit `reconnectStrategy` fn.
- `config.ts`: Zod source de vérité. `defineRedisConfig`: validate+env+freeze. `redisConfigJsonSchema()`: JSON Schema Studio.
- `RedisSessionStorage` (src/SessionStorage.ts): `ISessionStorage` de `@nodefony/http`, auto-register IoC `"redis"`. Clés `<prefix>:<id>` (cf cloison ci-dessous ; `nf:sess` sans cloison), TTL natif (`SET … EX` = idle glissant, `touch`=`EXPIRE`) → `gc()` no-op. `listPage` = curseur SCAN ; `countSessions` = **-1** (compter exigerait un SCAN complet ; un compteur `INCR` dériverait — le TTL efface sans passer par notre code). `listAll` = dump plafonné `MAX_SCAN`.

## Config

- Source: `config/config.ts`. Défauts: `enabled=true`, `localhost:6379`, family 0, connectTimeout 5000, tls false, reconnect `{baseMs:100,maxMs:10000,maxRetries:0}`.
- 3 connexions défaut: `main`/`publish`/`subscribe`. database 0.
- Env (dans builder, après parse): `REDIS_URL`>host/port/auth, `REDIS_HOST`, `REDIS_PORT` (validé), `REDIS_PASSWORD`.
- Surcharge app: clé `module-redis`.

## Behaviors

- Module désactivé (`enabled=false`) → 0 connexion, 0 socket.
- Connexion en échec à l'init → loguée, n'arrête pas les autres.
- reconnect: `min((retries+1)*baseMs, maxMs)` ; `>=maxRetries` (si >0) → Error (abandon).
- `onTerminate` → `closeConnections()` (QUIT + removeListener + map=null).

## Gotchas

- **`socketSchema.partial()` ré-applique les `.default()`** → override connexion clobberait le global (port 6379). FIX: `socketOverrideSchema` = champs `.optional()` SANS défaut. Ne pas régresser.
- pub/sub Redis est GLOBAL (ignore `database`) ; database n'isole que le storage clé-valeur.
- client abonné (SUBSCRIBE) ne peut plus émettre de commandes → d'où 3 connexions.
- `prefix` legacy supprimé (pas natif redis v6).
- config.ts PUR : pas de `process.env` (sinon non sérialisable JSON Schema). Env = builder.
- zod ajouté à `rolldown.config.ts external` + `nodefony/tests` exclu du tsconfig.
- **redis v6 (bump, depuis v5.12.1)** : RESP3 = défaut v6 (API set/get/pub/sub inchangée). `maintNotifications:"disabled"` forcé dans `buildClientOptions` (Redis OSS → pas de push frames maintenance + timeouts déterministes). `client.close()` remplace `quit()` (déprécié) dans `Connection.close()`. v6 exige Node >= 20 (on est 26 ; engines racine ">=18" = dette). Fallback si pub/sub casse sous RESP3 : `RESP:2` dans options.
- **Cloison des clés par APPLICATION** (`src/keyNamespace.ts`, `resolveKeyPrefix`) : `config.keyNamespace` sinon `kernel.projectName` → préfixe `nf:<app>:<type>` (l'app EN TÊTE : un opérateur peut voir/purger une app entière d'un motif). Sans cloison résolue → préfixe historique (`nf:sess`/`nf:tok`/`nf:wac`), une app seule n'a rien à séparer. Env `NF_REDIS_KEY_NAMESPACE` prioritaire (une cloison distingue des DÉPLOIEMENTS — préprod/prod portent le même `projectName`). Résolue via `RedisService.keyPrefix(base)`, **mémoïsée** par store (lue à chaque clé) et **tolérante** (`typeof service?.keyPrefix === "function"` : un service ancien ou un double de test retombe sur l'historique, jamais un crash). ⚠️ **Sépare des APPLICATIONS, PAS des instances** : tous les pods d'une app calculent la même cloison (`projectName` vient du code) → les sessions restent partagées derrière un load-balancer. La dériver du hostname/PID déconnecterait l'utilisateur à chaque changement de pod — c'est ce que fait `originId` du backplane, pour l'anti-écho, un besoin opposé. POURQUOI : `database` vaut 0 par défaut et n'isole rien de plus → deux apps partageaient l'espace de clés, et le `SCAN nf:sess:*` de l'écran Sessions de l'une **listait les sessions de l'autre**.
- **`SCAN` cursor = STRING opaque, JAMAIS un `number`** : node-redis v6 refuse un number en argument de commande (erreur `encodeCommand`). `RedisTokenStore.listAll`/`listPage` normalisent `String(res.cursor)` en boucle et comparent `!== "0"`. Le `FakeRedis` des tests DOIT typer `scan(cursor: string): {cursor: string}` (un fake typé `number` masque le bug). Prouvé sur vrai serveur (`REDIS_TEST_URL`).
- **`RedisTokenStore.listPage`** (`ITokenStore`, pagination) = **curseur SCAN** (1 passe/appel, `nextCursor`, filtres subjectId/kind/revoked sur le batch, PAS de total/ordre global — capacité réduite assumée) ; `countTokens` = `-1` (comptage O(N) refusé). `listAll` = dump incident cold-path.
- **`SCAN COUNT` est un INDICE d'effort, PAS un plafond** : Redis peut rendre plus de clés que demandé (petit keyspace en listpack → tout d'un coup) → une page nue déborderait `limit` et violerait `IPage`. Les deux stores (`RedisSessionStorage`, `RedisTokenStore`) utilisent donc un **curseur composite** `"<skip>:<curseurRedis>"` : on tronque à `limit`, on mémorise les clés consommées du batch, la page suivante rejoue le MÊME `SCAN` et reprend. Un curseur nu reçu de l'extérieur reste honoré (`skip=0`). ⚠️ Invisible contre un double : ce débordement ne sort que sur un VRAI serveur.
- **Un banc qui purge (`flushDb`) doit avoir sa BASE dédiée** (`tests/helpers/redisTestUrl(db)`, calqué sur `mongoTestUri`) : deux fichiers sur la même base s'effacent mutuellement en parallèle → vert en isolation, rouge en suite (symptôme qui fait suspecter le code). Bases : session-resilience 8, key-namespace 9, webauthn-pagination 10, token-store 11, token-pagination 12, session-store 13, session-pagination 14 ; **15 réservée** à `REDIS_TEST_URL` nu. La règle est **tenue par une sentinelle** (`tests/unit/testDbAllocation.test.ts`) qui relit les bancs et refuse un doublon — un commentaire ne garde rien (la 12 a été prise deux fois).
- **`getClient(name)` ne rend un client que s'il est OUVERT** (`isOpen`), sinon `null` : `createClient()` rend un objet AVANT `connect()` et une connexion dont l'ouverture a échoué **reste inscrite** dans `#connections` → sans ce filtre les consommateurs reçoivent un client fermé et prennent un `ClientClosedError` là où leur contrat promet un repli. `isOpen` et pas `isReady` : pendant une reconnexion node-redis met les commandes en file, ce qui est la résilience voulue. L'indisponibilité est journalisée **à la transition** (`#unavailable` lazy, WARNING à la bascule / INFO au retour) — une par requête noierait le journal, zéro contredirait « pas de dégradation silencieuse ».
- **`listAll()` (sessions ET jetons) est plafonné à `MAX_SCAN` et journalise le listing partiel.** Le store de jetons n'a ni kernel ni logger : son 5ᵉ paramètre de constructeur `notify` est câblé par `RedisTokenStore.from()` vers `service.log(…, "WARNING")`.

## Commandes CLI

Aucune pour l'instant (à exposer en Phase 11 si besoin : `redis:info`, `redis:flush`…).

## Tests

`npx vitest run` (gate serveur réel : `REDIS_TEST_URL=redis://:<pass>@127.0.0.1:6379/15`) — compte réel = `npx vitest run 2>&1 | tail -3`. Couverture par fichier :

- **unit/config.test.ts** (10) : schema défauts, env layering, buildClientOptions merge/url/reconnect. Sans serveur. **Purge REDIS\_\* env au chargement** (isolation, sinon `REDIS_PASSWORD=... vitest` casse le test password).
- **integration/connection.test.ts** (5) : Redis RÉEL (3 connexions, set/get main, pub/sub publish↔subscribe, close idempotent, enabled=false). **Auto-skip** (`describe.skipIf`) si Redis injoignable (probe PING au chargement). Module factice (`{container, kernel:null, options, get}`) suffit à instancier RedisService — pas de kernel requis.
- **integration/session-store.test.ts** : banc de contrat comportemental de `@nodefony/http` (`tests/support/sessionStoreContract`, capacité `native-ttl`) + TTL propre à Redis — `write` pose TOUJOURS un `EX` (une clé sans TTL = session immortelle), `touch` repousse, clé expirée absente de l'énumération. **Gate serveur réel obligatoire** (un double « valide » toujours un TTL).
- **integration/session-pagination.test.ts** : banc de contrat de pagination de `@nodefony/http` en mode **curseur**. Double déterministe par défaut, vrai serveur si `REDIS_TEST_URL`.
- **integration/{token-store,token-pagination,webauthn-credential-store}.test.ts** : stores security.

Infra : `docker compose -f docker/docker-compose.yml up -d` (password `nodefony-dev`). Lancer : `REDIS_PASSWORD=nodefony-dev npx vitest run` (ou défaut nodefony-dev si env absent).

## Tests — résilience du SessionStorage

- `session-resilience.test.ts` couvre ce que le banc comportemental ne PEUT pas exercer (il suppose un backend sain) : **connexion absente** (fail-soft de chaque verbe, sans infra) et **donnée hostile** (valeur corrompue ignorée sans emporter les sessions saines, curseur étranger). `destroy` rend `true` même sans client — idempotence VOULUE (l'appelant est un logout) ; `gc` est un no-op qui ne journalise rien (rien à dégrader : l'idle est porté par le TTL, l'absolute refusé à la lecture).
- **`decodeCursor` ne validait que le `skip`** : le curseur SCAN partait vers Redis tel quel → un `?cursor=`
  arbitraire faisait LEVER la lecture, alors que le TSDoc promettait de tolérer un curseur « malformé ». `scanOrZero` impose `/^\d+$/` → repli sur `"0"` (faux au pire d'une page ; jeter était faux à coup sûr).

## Tests — gates d'infra (⚠️ DEUX variables)

- `REDIS_URL` = bancs de pagination (fake intégré si absente) · `REDIS_TEST_URL` = banc **comportemental** sur index dédié (`/15`). Les deux portent le **mot de passe** : le serveur du compose tourne en `requirepass` → sans lui, `NOAUTH` (et non un skip).
- N'en fournir qu'une laissait **14 tests skippés, suite VERTE, sans un mot** → `vitest.config.ts` monte `gateReporter([REDIS_GATE])` (source unique `vitest.gates.ts` racine) : la fin de run nomme la cible non exercée et sa commande. Complet = **81/81**.
