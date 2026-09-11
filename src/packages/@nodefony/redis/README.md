# @nodefony/redis

Accès **Redis générique** pour Nodefony. Gère N connexions Redis nommées (lib
[`redis`](https://github.com/redis/node-redis) v6) à partir d'une configuration validée par
Zod, et expose le **client Redis brut** par connexion. Le module n'impose aucun usage : cache,
sessions, files d'attente, compteurs, verrous, pub/sub — c'est vous qui décidez.

> Brique d'infrastructure : d'autres couches la consomment (le `RedisBackplane` du realtime, le
> `RedisSessionStorage` de security). Elle ne contient aucune logique métier.

## Installation

Module workspace du monorepo Nodefony. Déclaré dans `@modules()` racine.

```bash
docker compose -f docker/docker-compose.yml up -d   # Redis 7, password "nodefony-dev"
export NF_REDIS_PASSWORD=nodefony-dev
```

## Usage

```typescript
import type { RedisService } from "@nodefony/redis";

const redis = kernel.getModule("redis").get("redis") as RedisService;
const client = redis.getClient("main"); // RedisClientType | null

// Cache clé-valeur
await client?.set("session:abc", JSON.stringify({ uid: 42 }), { EX: 3600 });
const raw = await client?.get("session:abc");

// Pub/sub (clients dédiés : on ne peut pas mélanger commandes et SUBSCRIBE)
const pub = redis.getClient("publish");
const sub = redis.getClient("subscribe");
await sub?.subscribe("chat:room1", (message) => console.log("reçu:", message));
await pub?.publish("chat:room1", "hello");
```

## Configuration

Source de vérité : `nodefony/config/config.ts` (Zod). Trois niveaux de précédence :
**défauts → config app (`module-redis`) → environnement**.

```typescript
// src/modules/app/nodefony/config/config.ts
export default {
  "module-redis": {
    globalOptions: { socket: { host: "redis.internal", tls: true } },
    connections: { cache: { name: "cache", database: 1 } },
  },
};
```

### Variables d'environnement

| Variable            | Effet                                                    |
| ------------------- | -------------------------------------------------------- |
| `NF_REDIS_URL`      | URL complète `redis[s]://…` — **la forme qui l'emporte** |
| `REDIS_URL`         | même effet, alias posé par les hébergeurs — lu en SECOND |
| `NF_REDIS_HOST`     | hôte du serveur                                          |
| `NF_REDIS_PORT`     | port (validé)                                            |
| `NF_REDIS_PASSWORD` | mot de passe (jamais committé)                           |

Si les deux URL sont posées, **`NF_REDIS_URL` gagne** : c'est votre réglage, il passe
devant celui que la plateforme d'hébergement a injecté.

### Connexions par défaut

| Nom         | Rôle                           |
| ----------- | ------------------------------ |
| `main`      | commandes clé-valeur / storage |
| `publish`   | `PUBLISH` (émission pub/sub)   |
| `subscribe` | `SUBSCRIBE` (écoute pub/sub)   |

Trois connexions car un client Redis abonné ne peut plus émettre de commandes normales
(contrainte du protocole). Ajoutez-en autant que nécessaire dans `connections`.

### Reconnexion

Politique déclarative : `{ baseMs: 100, maxMs: 10000, maxRetries: 0 }`. Délai =
`min((tentative+1) × baseMs, maxMs)` ; `maxRetries: 0` = illimité.

## API

| Méthode (`RedisService`) | Retour                       | Description                         |
| ------------------------ | ---------------------------- | ----------------------------------- |
| `getClient(name)`        | `RedisClientType \| null`    | client redis brut d'une connexion   |
| `getConnection(name)`    | `Connection \| undefined`    | wrapper (état `connected`, options) |
| `createConnection(name)` | `Promise<Connection>`        | ouvre une connexion déclarée        |
| `closeConnections()`     | `Promise<void>`              | ferme tout (auto au `onTerminate`)  |
| `connections`            | `Record<string, Connection>` | connexions ouvertes                 |

## Tests

```bash
npx vitest run            # unitaires + intégration (Redis requis, sautés sinon)
npx vitest run --coverage
```

Les tests d'intégration ouvrent une connexion Redis réelle ; ils sont **automatiquement
sautés** si Redis est injoignable. Pour les exécuter :

```bash
docker compose -f docker/docker-compose.yml up -d
NF_REDIS_PASSWORD=nodefony-dev npx vitest run
```

## Licence

Apache 2.0 — Christophe CAMENSULI.
