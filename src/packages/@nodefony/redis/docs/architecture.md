---
slug: redis-module/architecture
title: "Architecture — Module → Service → Connection → client redis"
section: redis-module
audience: developer,architect,devops,supervisor,admin
version: v0.1
status: draft
updated: 2026-05-28
source: src/packages/@nodefony/redis/docs/architecture.md
module: "@nodefony/redis"
topic: architecture
tags: [redis, architecture, connection, service, lifecycle, reconnect]
---

# Architecture de @nodefony/redis

## Les quatre couches

```
┌───────────────────────────────────────────────────────────┐
│ Redis (Module)            index.ts                          │
│  • valide la config (Zod) au onKernelRegister               │
│  • expose `redisConfig` (gelée) au container                │
└───────────────┬───────────────────────────────────────────┘
                │ @services
┌───────────────▼───────────────────────────────────────────┐
│ RedisService               nodefony/service/redis.ts        │
│  • lit la config validée                                    │
│  • ouvre N connexions à l'init (lazy map)                   │
│  • getClient(name) / getConnection(name)                    │
│  • ferme tout au onTerminate                                │
└───────────────┬───────────────────────────────────────────┘
                │ 1..N
┌───────────────▼───────────────────────────────────────────┐
│ Connection                 nodefony/src/Connection.ts       │
│  • createClient(options) (redis v6)                         │
│  • écoute error/connect/ready/end/reconnecting              │
│  • removeListener explicite à la fermeture (anti-fuite)     │
└───────────────┬───────────────────────────────────────────┘
                │ enveloppe
┌───────────────▼───────────────────────────────────────────┐
│ RedisClientType (lib `redis` v6)                            │
└───────────────────────────────────────────────────────────┘
```

## Le flot au boot

1. **`onKernelRegister`** (Module) : `defineRedisConfig(options)` valide les défauts +
   `module.options.redis` + surcharge env, **gèle** le résultat, le pose dans le
   container sous `redisConfig`. Config invalide → exception claire, le boot s'arrête.
2. **`initialize()`** (Service) : si `enabled`, parcourt `config.connections` et appelle
   `createConnection(name)` pour chacune. Une connexion en échec est **loguée sans bloquer
   les autres** (résilience).
3. **`createConnection`** : `buildClientOptions(config, def)` assemble les options
   `createClient` (fusion `globalOptions` + override de connexion, ou `url` prioritaire),
   instancie `Connection`, attache les listeners, ouvre.

## Reconnexion — back-off linéaire borné

La politique est **déclarative** dans la config (`baseMs`/`maxMs`/`maxRetries`) ; elle est
convertie en fonction `socket.reconnectStrategy` de redis v6 au runtime
(`buildClientOptions`). Délai = `min((tentative+1) × baseMs, maxMs)` ; au-delà de
`maxRetries` (si > 0) → abandon (retourne une `Error`, le client cesse de retenter).
`maxRetries: 0` (défaut) = reconnexion illimitée (résilience prod).

> **Pourquoi déclaratif et pas une fonction dans la config ?** La config est validée par
> Zod et doit rester **sérialisable** (JSON Schema → futur formulaire Studio). Une fonction
> ne se sérialise pas. On décrit donc la politique en nombres, et on fabrique la fonction
> au dernier moment.

## Perf & mémoire (règle absolue du framework)

- **Lazy alloc** : la map de connexions est `null` jusqu'à la 1ʳᵉ connexion ouverte.
- **Cleanup listener** : `Connection` conserve ses handlers et fait `removeListener`
  explicite à `close()` — pas de listener orphelin si une connexion est recréée.
- **Fermeture déterministe** : `kernel.once("onTerminate")` ferme toutes les connexions
  (`QUIT`) et libère les listeners.

## Ce que ce module N'EST PAS

- **Pas le backplane realtime** : `RedisBackplane` (P13.5) implémente `IBackplane` de
  `@nodefony/realtime` en **consommant** ce module (connexions `publish`/`subscribe`).
- **Pas le storage de session** : `RedisSessionStorage` (P5.12) consommera la connexion
  `main`. Tous deux sont des clients de ce module, pas des features internes.
