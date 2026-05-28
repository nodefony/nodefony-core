---
slug: redis-module/configuration
title: "Configuration — schéma Zod, env layering, exemples"
section: redis-module
audience: developer,architect,devops,supervisor,admin
version: v0.1
status: draft
updated: 2026-05-28
source: src/packages/@nodefony/redis/docs/configuration.md
module: "@nodefony/redis"
topic: configuration
tags: [redis, config, zod, env, connections, tls, reconnect]
---

# Configuration de @nodefony/redis

## Source de vérité unique

Tout part de `nodefony/config/schema.ts` (Zod). Le type TS, les défauts, et la
documentation des champs (`.describe()`) en dérivent. **Ne jamais éditer les valeurs à la
main** ailleurs : on modifie les `.default(...)` du schéma.

Trois niveaux, par ordre de précédence croissant :

1. **Défauts du schéma** — sûrs (`localhost:6379`, 3 connexions, pas de secret).
2. **Config de l'app** — clé `module-redis` dans le `config.ts` racine (fusion récursive).
3. **Environnement** — appliqué dans `defineRedisConfig` APRÈS le parse (gagne sur tout).

## Variables d'environnement

| Variable         | Cible                              | Note                                            |
| ---------------- | ---------------------------------- | ----------------------------------------------- |
| `REDIS_URL`      | `url` (toutes connexions)          | `redis[s]://[[user][:pass]@]host[:port][/db]`   |
| `REDIS_HOST`     | `globalOptions.socket.host`        |                                                 |
| `REDIS_PORT`     | `globalOptions.socket.port`        | ignoré si non numérique / hors 1-65535          |
| `REDIS_PASSWORD` | `globalOptions.password`           | secret — **jamais** dans la config versionnée   |

> `url` prend précédence sur `host`/`port`/`auth` : pratique pour les PaaS (Upstash,
> Heroku Redis) qui ne fournissent qu'une URL.

## Surcharge par l'application

```typescript
// src/modules/app/nodefony/config/config.ts
export default {
  "module-redis": {
    globalOptions: {
      socket: { host: "redis.internal", tls: true },
      // password : préférer l'env REDIS_PASSWORD
    },
    connections: {
      // ajoute une 4ᵉ connexion dédiée au cache, base 1
      cache: { name: "cache", database: 1 },
    },
  },
};
```

## Référence des champs

### `enabled` (bool, défaut `true`)

`false` = module chargé mais inerte : aucune connexion ouverte, 0 socket. Pratique en CI
quand Redis n'est pas disponible.

### `globalOptions` (fusionné dans chaque connexion)

- **`socket.host`** (`localhost`) · **`socket.port`** (`6379`) · **`socket.family`**
  (`0` auto / `4` / `6`) · **`socket.connectTimeout`** (`5000` ms) · **`socket.tls`**
  (`false` — mettre `true` sur réseau non fiable).
- **`socket.reconnectStrategy`** : `{ baseMs: 100, maxMs: 10000, maxRetries: 0 }`.
  Back-off linéaire borné ; `maxRetries: 0` = illimité.
- **`username`** / **`password`** : auth ACL Redis 6+ ou `requirepass` legacy.

### `connections` (record nommé)

Chaque entrée : `{ name, database?, socket? }`. Le `socket` d'une connexion **surcharge
seulement les champs posés** (les autres héritent du global — pas de défaut local qui
clobberait). Défaut : `main` / `publish` / `subscribe`.

> ⚠️ Le pub/sub Redis est **global** (ignore le numéro de base) ; `database` n'isole que
> les commandes clé-valeur (storage).

## Validation au boot

`onKernelRegister` appelle `defineRedisConfig`. Si la config est invalide, le boot
s'arrête avec un message du type :

```
[@nodefony/redis] Invalid config: globalOptions.socket.port: Number must be less than or equal to 65535
```

Pas d'`undefined.x` silencieux en runtime — la convention Zod du framework (figée
2026-05-28).

## Infra de dev

```bash
docker compose -f docker/docker-compose.yml up -d
# Redis 7-alpine, auth --requirepass nodefony-dev, bindé 127.0.0.1:6379
export REDIS_PASSWORD=nodefony-dev
```
