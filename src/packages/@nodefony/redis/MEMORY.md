# MEMORY.md — @nodefony/redis (audience IA)

## Purpose

Accès Redis générique. Module = fournisseur de connexions + client brut. 0 logique métier.

## Core Components

- `Redis` (index.ts): Module. `@services([RedisService])`. `onKernelRegister` → `defineRedisConfig` → `set("redisConfig")`.
- `RedisService` (service/redis.ts): `initialize()` ouvre les connexions ; `getClient(name)`, `getConnection(name)`, `createConnection(name)`, `closeConnections()`. Map `#connections` lazy (null).
- `Connection` (src/Connection.ts): wrap `createClient` v5. Handlers `#onError/#onConnect/#onReady/#onEnd/#onReconnecting` stockés → `removeListener` à `close()`.
- `buildClientOptions` (src/buildClientOptions.ts): config → `RedisClientOptions`. Merge global+override. `url` prioritaire. Construit `reconnectStrategy` fn.
- `schema.ts`: Zod source de vérité. `defineRedisConfig`: validate+env+freeze. `redisConfigJsonSchema()`: JSON Schema Studio.

## Config

- Source: `config/schema.ts`. Défauts: `enabled=true`, `localhost:6379`, family 0, connectTimeout 5000, tls false, reconnect `{baseMs:100,maxMs:10000,maxRetries:0}`.
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
- `prefix` legacy supprimé (pas natif redis v5).
- schema.ts PUR : pas de `process.env` (sinon non sérialisable JSON Schema). Env = builder.
- zod ajouté à `rollup.config.ts external` + `nodefony/tests` exclu du tsconfig (2026-05-28).

## Commandes CLI

Aucune pour l'instant (à exposer en Phase 11 si besoin : `redis:info`, `redis:flush`…).

## Tests

`npx vitest run` — 10 tests unitaires (schema défauts, env layering, buildClientOptions merge/url/reconnect). Pas de serveur requis. Intégration (connexion réelle) = TODO `tests/integration/` + docker.
