# MEMORY.md — @nodefony/redis (audience IA)

## Purpose

Accès Redis générique. Module = fournisseur de connexions + client brut. 0 logique métier.

## Core Components

- `Redis` (index.ts): Module. `@services([RedisService])`. `onKernelRegister` → `defineRedisConfig` → `set("redisConfig")`.
- `RedisService` (service/redis.ts): `initialize()` ouvre les connexions ; `getClient(name)`, `getConnection(name)`, `createConnection(name)`, `closeConnections()`. Map `#connections` lazy (null).
- `Connection` (src/Connection.ts): wrap `createClient` v6. Handlers `#onError/#onConnect/#onReady/#onEnd/#onReconnecting` stockés → `removeListener` à `close()`.
- `buildClientOptions` (src/buildClientOptions.ts): config → `RedisClientOptions`. Merge global+override. `url` prioritaire. Construit `reconnectStrategy` fn.
- `config.ts`: Zod source de vérité. `defineRedisConfig`: validate+env+freeze. `redisConfigJsonSchema()`: JSON Schema Studio.
- `RedisSessionStorage` (src/SessionStorage.ts): `ISessionStorage` de `@nodefony/http`, auto-register IoC `"redis"`. Clés `nf:sess:<id>`, TTL natif (`SET … EX` = idle glissant, `touch`=`EXPIRE`) → `gc()` no-op. `listPage` = curseur SCAN ; `countSessions` = **-1** (compter exigerait un SCAN complet ; un compteur `INCR` dériverait — le TTL efface sans passer par notre code). `listAll` = dump plafonné `MAX_SCAN`.

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
- zod ajouté à `rolldown.config.ts external` + `nodefony/tests` exclu du tsconfig (2026-05-28).
- **redis v6 (bump 2026-05-28, depuis v5.12.1)** : RESP3 = défaut v6 (API set/get/pub/sub inchangée). `maintNotifications:"disabled"` forcé dans `buildClientOptions` (Redis OSS → pas de push frames maintenance + timeouts déterministes). `client.close()` remplace `quit()` (déprécié) dans `Connection.close()`. v6 exige Node >= 20 (on est 26 ; engines racine ">=18" = dette). Fallback si pub/sub casse sous RESP3 : `RESP:2` dans options.
- **`SCAN` cursor = STRING opaque, JAMAIS un `number`** : node-redis v6 refuse un number en argument de commande (erreur `encodeCommand`). `RedisTokenStore.listAll`/`listPage` normalisent `String(res.cursor)` en boucle et comparent `!== "0"`. Le `FakeRedis` des tests DOIT typer `scan(cursor: string): {cursor: string}` (un fake typé `number` masque le bug). Prouvé sur vrai serveur (`REDIS_TEST_URL`).
- **`RedisTokenStore.listPage`** (`ITokenStore`, pagination) = **curseur SCAN** (1 passe/appel, `nextCursor`, filtres subjectId/kind/revoked sur le batch, PAS de total/ordre global — capacité réduite assumée) ; `countTokens` = `-1` (comptage O(N) refusé). `listAll` = dump incident cold-path.
- **`SCAN COUNT` est un INDICE d'effort, PAS un plafond** : Redis peut rendre plus de clés que demandé (petit keyspace en listpack → tout d'un coup) → une page nue déborderait `limit` et violerait `IPage`. Les deux stores (`RedisSessionStorage`, `RedisTokenStore`) utilisent donc un **curseur composite** `"<skip>:<curseurRedis>"` : on tronque à `limit`, on mémorise les clés consommées du batch, la page suivante rejoue le MÊME `SCAN` et reprend. Un curseur nu reçu de l'extérieur reste honoré (`skip=0`). ⚠️ Invisible contre un double : ce débordement ne sort que sur un VRAI serveur.
- **Un banc qui purge (`flushDb`) doit avoir sa BASE dédiée** (`tests/helpers/redisTestUrl(db)`, calqué sur `mongoTestUri`) : deux fichiers sur la même base s'effacent mutuellement en parallèle → vert en isolation, rouge en suite (symptôme qui fait suspecter le code). Bases : session-store 13, session-pagination 14, token-pagination 12, token-store 11.

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

## Tests — gates d'infra (⚠️ DEUX variables)

- `REDIS_URL` = bancs de pagination (fake intégré si absente) · `REDIS_TEST_URL` = banc **comportemental** sur index dédié (`/15`). Les deux portent le **mot de passe** : le serveur du compose tourne en `requirepass` → sans lui, `NOAUTH` (et non un skip).
- N'en fournir qu'une laissait **14 tests skippés, suite VERTE, sans un mot** → `vitest.config.ts` monte `gateReporter([REDIS_GATE])` (source unique `vitest.gates.ts` racine) : la fin de run nomme la cible non exercée et sa commande. Complet = **81/81**.
