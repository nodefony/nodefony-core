---
slug: redis-module/index
title: "@nodefony/redis — vue d'ensemble dev"
section: redis-module
audience: developer,architect,devops,supervisor,admin
version: v0.1
status: draft
updated: 2026-05-28
source: src/packages/@nodefony/redis/docs/index.md
module: "@nodefony/redis"
topic: overview
tags: [redis, cache, pubsub, storage, connection, config, overview]
---

# @nodefony/redis — accès Redis générique

## L'analogie d'abord

Redis, c'est un **carnet ultra-rapide posé à côté de votre application** : au lieu
d'aller chercher une information loin (sur le disque, dans une base SQL), on la note
sur ce carnet en mémoire vive et on la relit en quelques microsecondes. On s'en sert
pour : garder un cache, stocker des sessions, faire la queue d'un traitement, compter
des choses, ou faire passer des messages entre plusieurs process (pub/sub).

Ce module **n'impose rien** : il ouvre et gère proprement les connexions à ce carnet,
puis vous tend le **client Redis brut**. Ce que vous écrivez dessus, c'est votre choix.

## Ce que fait le module (et ce qu'il ne fait pas)

| Fait                                                        | Ne fait PAS                                              |
| ----------------------------------------------------------- | -------------------------------------------------------- |
| Ouvre N connexions nommées (lib `redis` v6)                 | N'impose pas un usage (cache ? sessions ? à vous)        |
| Valide la config au boot (Zod) — plante propre si invalide  | Ne fournit pas de couche storage/ORM par-dessus          |
| Gère le cycle de vie (reconnexion bornée, fermeture propre) | N'est PAS le `RedisBackplane` realtime (ça, c'est P13.5) |
| Expose le client brut via `RedisService.getClient(name)`    | N'est PAS le `RedisSessionStorage` (ça, c'est P5.12)     |
| Surcharge par environnement (`REDIS_URL`, `REDIS_HOST`…)    | Ne stocke aucun secret en dur                            |

## Trois connexions par défaut — pourquoi

`main`, `publish`, `subscribe`. La raison est dans le **protocole Redis** : dès qu'un
client s'abonne (`SUBSCRIBE`), il bascule en mode écoute et **ne peut plus émettre de
commandes normales** (`GET`, `SET`…). Il faut donc des clients séparés :

- **`main`** — vos commandes clé-valeur (cache, compteurs, storage).
- **`publish`** — émet les messages (`PUBLISH`).
- **`subscribe`** — écoute les messages (`SUBSCRIBE`).

Vous pouvez en ajouter (ex. `cache`, `queue`) dans la config — voir [configuration](./configuration.md).

## Usage minimal

```typescript
// Dans un service / controller, le module redis injecté donne le service.
const redisService = kernel.getModule("redis").get("redis"); // RedisService
const client = redisService.getClient("main"); // RedisClientType | null

await client?.set("user:42:lastSeen", Date.now().toString());
const v = await client?.get("user:42:lastSeen");
```

## Démarrer l'infra (dev)

```bash
docker compose -f docker/docker-compose.yml up -d   # Redis 7, password "nodefony-dev"
```

Le module pointe `localhost:6379` par défaut ; le mot de passe vient de l'env
`REDIS_PASSWORD`. Détails : [configuration](./configuration.md).

## Pour aller plus loin

- [Architecture](./architecture.md) — les couches (Module → Service → Connection → client redis).
- [Configuration](./configuration.md) — schéma Zod, env layering, exemples.
