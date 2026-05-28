---
slug: realtime-module/configuration
title: "Configuration — Redis / Kafka / driver custom"
section: realtime-module
audience: developer,architect,devops,supervisor,admin
version: v0.1
status: draft
updated: 2026-05-28
source: src/packages/@nodefony/realtime/docs/configuration.md
module: "@nodefony/realtime"
topic: configuration
tags:
  [
    configuration,
    backplane,
    loopback,
    cluster-ipc,
    redis,
    kafka,
    custom-driver,
    defineRealtimeConfig,
    builder,
    zod,
  ]
---

# Configuration — comment l'utilisateur configure Redis / Kafka dans son app

> Cette page répond à **LA** question : « si je veux utiliser le realtime dans mon app,
> comment je passe de dev local à prod cluster Redis sans tout réécrire ? ».
> Tu y trouveras les 4 modes (Loopback / Cluster IPC / Redis / Kafka), un exemple par
> mode, et la procédure pour écrire ton **propre driver custom** (NATS, Pulsar, RabbitMQ, …).

> [!IMPORTANT]
> **État aujourd'hui (2026-05-28)** : le builder `defineRealtimeConfig()` **n'est pas encore
> codé** — il fait partie du Bloc A étape 5 du plan P13. Cette page documente la **cible
> figée** : c'est ce à quoi ressemblera la config quand on l'aura livrée. Les modes
> `loopback` et `cluster-ipc` MARCHENT déjà (drivers livrés), mais sans le builder leur
> usage passe par les services Nodefony existants — pas l'API publique propre.

## Le builder `defineRealtimeConfig()` (cible)

Pattern figé Nodefony, style Vite — identique à `defineSecurityConfig()` côté `@nodefony/security`.

```typescript
// app/config/realtime.config.ts
import { defineRealtimeConfig } from "@nodefony/realtime";

export default defineRealtimeConfig({
  // 1) Quel "fond de panier" on utilise (= comment les pods se parlent)
  backplane: "redis", // "loopback" | "cluster-ipc" | "redis" | "kafka" | IBackplane custom

  // 2) Config du driver choisi (validée par Zod au boot, plante propre si mal formé)
  redis: {
    url: process.env.REDIS_URL!, // redis://user:pwd@host:6379
    keyPrefix: "myapp:rt:", // namespace si Redis partagé avec autres apps
    cluster: false, // ou true si Redis Cluster (sharding)
  },

  // 3) Options globales du hub (toutes optionnelles, défauts sains)
  hub: {
    maxBufferedAmount: 1_048_576, // backpressure 1 MB par peer (deconnecte au-delà)
    pingIntervalMs: 30_000, // keep-alive WS
    adaptiveCadence: true, // AIMD ON par défaut
  },

  // 4) Sondes / observabilité
  probe: {
    enabled: true, // canal realtime:health publié
    sampleEveryMs: 5_000, // fréquence du snapshot santé
  },
});
```

### Validation Zod au boot

Le builder valide la config avec un schéma Zod **avant** que le hub démarre. Si tu écris :

```typescript
defineRealtimeConfig({
  backplane: "redis",
  // ❌ oubli : pas de redis: {...}
});
```

Le boot **plante propre** avec un message clair :

```
[REALTIME_CONFIG] Invalid config:
  - redis.url: Required (when backplane === "redis")
```

Pas de surprise en runtime. Pas de `undefined.url`. Pas de plantage différé 3 minutes plus tard.

## Les 4 modes (un par environnement type)

### Mode 1 — `loopback` (dev mono-process)

**Quand** : développement local, tests unitaires, démos qui tournent dans 1 seul process Node.

```typescript
export default defineRealtimeConfig({
  backplane: "loopback",
});
```

| Critère            | Valeur                      |
| ------------------ | --------------------------- |
| Dépendance externe | aucune ✅                   |
| Latence            | ~0 ns (in-memory synchrone) |
| Multi-pod          | non (1 seul process)        |
| Persistence        | non (perdu au crash)        |
| Cas d'usage        | dev, tests, démos           |

> [!TIP]
> **C'est le défaut implicite.** Si tu ne configures pas le backplane, c'est ce que tu auras.

### Mode 2 — `cluster-ipc` (staging multi-worker, sans infra)

**Quand** : tu veux tester en cluster sur ta machine de dev, ou en staging sur un serveur
unique mais avec plusieurs workers Node (multi-core).

```typescript
export default defineRealtimeConfig({
  backplane: "cluster-ipc",
});
```

Lancement : `nodefony cluster -w 4` → 4 workers Node, le master leur sert de relai IPC.

| Critère            | Valeur                                 |
| ------------------ | -------------------------------------- |
| Dépendance externe | aucune ✅                              |
| Latence            | ~50 µs (IPC Node natif)                |
| Multi-pod          | oui (multi-worker sur 1 machine)       |
| Multi-host         | non (même OS)                          |
| Persistence        | non                                    |
| Cas d'usage        | staging, validation cluster sans infra |

> [!NOTE]
> **C'est le mode magique pour tester ton cluster sans rien installer.** Ton `ChatController`
> et ton `ChatClient` voient un VRAI cluster avec fan-out cross-process — il manque juste le
> multi-host (= Redis/Kafka).

### Mode 3 — `redis` (prod web multi-host)

**Quand** : prod web standard (chat, notifications, dashboards live), déployée en cluster
k8s ou Docker Swarm avec plusieurs replicas (pods) éventuellement sur plusieurs nodes.

```typescript
export default defineRealtimeConfig({
  backplane: "redis",
  redis: {
    url: process.env.REDIS_URL!,
    keyPrefix: "myapp:rt:",
  },
});
```

| Critère            | Valeur                                            |
| ------------------ | ------------------------------------------------- |
| Dépendance externe | Redis (`>= 6.x`, peerDep `redis`)                 |
| Latence            | ~1-3 ms (pub/sub)                                 |
| Multi-pod          | oui                                               |
| Multi-host         | oui ✅                                            |
| Persistence        | non (Redis pub/sub = fire-and-forget)             |
| Throughput         | très élevé (>100k msg/s par pod)                  |
| Cas d'usage        | chat, notifs live, dashboards, broadcast standard |

> [!WARNING]
> **Redis pub/sub n'est PAS persistant**. Si un pod est down 30 s, il rate les messages
> publiés pendant ce temps. C'est ACCEPTABLE pour du chat (le message est en DB de toute
> façon) mais PAS pour un bus events agents IA critique → utiliser Kafka pour ces cas (mode 4).

#### Bonus : si tu fais Redis Cluster (sharding)

```typescript
defineRealtimeConfig({
  backplane: "redis",
  redis: {
    url: ["redis://node1:6379", "redis://node2:6379", "redis://node3:6379"],
    cluster: true,
  },
});
```

### Mode 4 — `kafka` (prod massive, persistence, IA bus)

**Quand** : prod massive (banking, IoT M2M, e-commerce hyper-trafic), ou bus events agents
IA où tu veux **rejouer** une décision qui a planté.

```typescript
export default defineRealtimeConfig({
  backplane: "kafka",
  kafka: {
    brokers: ["k1:9092", "k2:9092", "k3:9092"],
    clientId: "myapp",
    topic: "myapp.realtime", // 1 topic, partitions = hash(channel)
    persistence: {
      retentionMs: 7 * 86_400_000, // 7 jours d'historique rejouable
      compressionType: "lz4",
    },
  },
});
```

| Critère            | Valeur                                                                             |
| ------------------ | ---------------------------------------------------------------------------------- |
| Dépendance externe | Kafka (`>= 3.x`, peerDep `kafkajs`)                                                |
| Latence            | ~5-20 ms (write + replication)                                                     |
| Multi-pod          | oui                                                                                |
| Multi-host         | oui ✅                                                                             |
| Persistence        | OUI (rejouable jusqu'à `retentionMs`)                                              |
| Garantie           | at-least-once (un message peut arriver 2× — dédup côté hub via `messageId` opt-in) |
| Throughput         | massif (millions msg/s avec partitions)                                            |
| Cas d'usage        | bus events critiques, audit, IA, IoT M2M                                           |

> [!IMPORTANT]
> **Garantie « at-least-once »** : Kafka assure qu'un message arrive AU MOINS une fois,
> mais peut arriver 2 fois (réessais). Soit ton handler est **idempotent** (recommandé),
> soit tu actives la **dédup** côté hub via un `messageId` unique dans le payload.

## La magie « passer de dev à prod » sans toucher au code

C'est LE scénario qui justifie le contrat `IBackplane`. Voilà comment ton projet doit le
structurer :

```typescript
// app/config/realtime.config.ts — pilote par variables d'env
import { defineRealtimeConfig } from "@nodefony/realtime";

const env = process.env.NODE_ENV ?? "development";

export default defineRealtimeConfig({
  backplane:
    env === "production" && process.env.KAFKA_BROKERS
      ? "kafka"
      : env === "production" && process.env.REDIS_URL
        ? "redis"
        : env === "staging"
          ? "cluster-ipc"
          : "loopback",

  redis: process.env.REDIS_URL
    ? { url: process.env.REDIS_URL, keyPrefix: "myapp:rt:" }
    : undefined,

  kafka: process.env.KAFKA_BROKERS
    ? { brokers: process.env.KAFKA_BROKERS.split(","), topic: "myapp.realtime" }
    : undefined,
});
```

→ `npm run dev` (sans env) → loopback.
→ `NODE_ENV=staging npm start` → cluster-ipc (multi-worker).
→ `NODE_ENV=production REDIS_URL=... npm start` → Redis.
→ `NODE_ENV=production KAFKA_BROKERS=... npm start` → Kafka.

Ton `ChatController` n'a JAMAIS bougé. Ton client `socket.subscribe()` n'a JAMAIS bougé.

## Écrire son propre driver (custom `IBackplane`)

Le contrat `IBackplane` étant publié et stable, n'importe quel utilisateur peut écrire son
driver pour le bus de son choix.

### Exemple — driver NATS

```typescript
// son-app/src/MyNatsBackplane.ts
import type { IBackplane } from "@nodefony/realtime";
import { connect, NatsConnection } from "nats";

export class MyNatsBackplane implements IBackplane {
  private nc!: NatsConnection;

  constructor(private readonly opts: { servers: string[] }) {}

  async connect(): Promise<void> {
    this.nc = await connect({ servers: this.opts.servers });
  }

  async disconnect(): Promise<void> {
    await this.nc.close();
  }

  async subscribe(
    channel: string,
    onMessage: (channel: string, payload: unknown, originPodId: string) => void,
  ): Promise<void> {
    const sub = this.nc.subscribe(channel);
    (async () => {
      for await (const m of sub) {
        const payload = JSON.parse(m.string());
        const originPodId = m.headers?.get("podId") ?? "";
        onMessage(channel, payload, originPodId);
      }
    })();
  }

  async unsubscribe(channel: string): Promise<void> {
    // NATS gère via close de l'iterator ; à implémenter selon ton design
  }

  async publish(
    channel: string,
    payload: unknown,
    originPodId: string,
  ): Promise<void> {
    const headers = { podId: originPodId };
    this.nc.publish(channel, JSON.stringify(payload), { headers });
  }
}
```

### Le brancher

```typescript
// app/config/realtime.config.ts
import { defineRealtimeConfig } from "@nodefony/realtime";
import { MyNatsBackplane } from "./MyNatsBackplane.ts";

export default defineRealtimeConfig({
  backplane: new MyNatsBackplane({ servers: ["nats://nats.example.com:4222"] }),
});
```

> [!TIP]
> **AUCUN code Nodefony à modifier.** Même mécanisme que NestJS pour ses adapters Redis,
> mais ouvert dès le départ. Ton driver vit dans TON projet, peut être publié comme package
> `@maboite/nodefony-realtime-nats` si tu veux le partager.

## Options globales du hub (toutes optionnelles)

### `hub.maxBufferedAmount`

Limite de backpressure par peer. Si le `WebSocket.bufferedAmount` d'un peer dépasse cette
valeur, le hub déconnecte le peer pour libérer la mémoire serveur.

| Valeur                     | Quand                                                              |
| -------------------------- | ------------------------------------------------------------------ |
| `1_048_576` (1 MB, défaut) | Standard web                                                       |
| `4_194_304` (4 MB)         | App qui pousse des payloads lourds (live video, dashboard binaire) |
| `262_144` (256 KB)         | App pur texte (chat, notifs) — anti-DoS strict                     |

### `hub.pingIntervalMs`

Fréquence du ping de keep-alive (frame WebSocket ping native). Côté serveur, ferme la
connexion si pas de pong dans `2× pingIntervalMs`.

| Valeur                  | Quand                                                      |
| ----------------------- | ---------------------------------------------------------- |
| `30_000` (30 s, défaut) | Standard web (compatible derrière la majorité des proxies) |
| `15_000` (15 s)         | Proxies agressifs qui coupent à 30 s                       |
| `120_000` (2 min)       | LAN privé, économie batterie mobile                        |

### `hub.adaptiveCadence`

Active l'AIMD (cadence client auto-ajustée). Tu peux désactiver globalement, ou seulement
sur certains canaux via le client.

```typescript
// Global OFF
defineRealtimeConfig({
  backplane: "redis",
  redis: { url: ... },
  hub: { adaptiveCadence: false },
});

// Par canal côté client : passer intervalMs explicite
await socket.subscribe("dashboard:supervision", { intervalMs: 500, adaptive: false });
```

### `probe.enabled` / `probe.sampleEveryMs`

Contrôle la sonde `realtime:health` (canal + endpoint HTTP).

| Valeur                                         | Quand                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| `enabled: true, sampleEveryMs: 5_000` (défaut) | Standard — utilisé par Studio + observabilité                      |
| `enabled: true, sampleEveryMs: 1_000`          | Debug fin, monitoring temps réel                                   |
| `enabled: false`                               | Tests, ou prod où tu utilises un APM externe et tu veux 0 overhead |

## Schéma Zod de validation (cible — à coder en P13.4)

Pour info, voici à quoi ressemblera le schéma Zod (Bloc A étape 5) :

```typescript
import { z } from "zod";

const RedisOptionsSchema = z.object({
  url: z.union([z.string().url(), z.array(z.string().url())]),
  keyPrefix: z.string().optional(),
  cluster: z.boolean().optional(),
});

const KafkaOptionsSchema = z.object({
  brokers: z.array(z.string()).min(1),
  clientId: z.string(),
  topic: z.string(),
  persistence: z
    .object({
      retentionMs: z.number().positive(),
      compressionType: z
        .enum(["none", "gzip", "snappy", "lz4", "zstd"])
        .optional(),
    })
    .optional(),
});

const HubOptionsSchema = z.object({
  maxBufferedAmount: z.number().int().positive().default(1_048_576),
  pingIntervalMs: z.number().int().positive().default(30_000),
  adaptiveCadence: z.boolean().default(true),
});

const ProbeOptionsSchema = z.object({
  enabled: z.boolean().default(true),
  sampleEveryMs: z.number().int().positive().default(5_000),
});

export const RealtimeConfigSchema = z
  .object({
    backplane: z.union([
      z.literal("loopback"),
      z.literal("cluster-ipc"),
      z.literal("redis"),
      z.literal("kafka"),
      z.custom<IBackplane>(
        (v) => typeof v === "object" && v !== null && "publish" in v,
      ),
    ]),
    redis: RedisOptionsSchema.optional(),
    kafka: KafkaOptionsSchema.optional(),
    hub: HubOptionsSchema.optional(),
    probe: ProbeOptionsSchema.optional(),
  })
  .refine((cfg) => cfg.backplane !== "redis" || cfg.redis, {
    message: "redis options are required when backplane is 'redis'",
  })
  .refine((cfg) => cfg.backplane !== "kafka" || cfg.kafka, {
    message: "kafka options are required when backplane is 'kafka'",
  });
```

## Liens

- [`index.md`](./index.md) — Vue d'ensemble + promesse DX
- [`architecture.md`](./architecture.md) — Pile 5 étages (l'Étage 1 backplane est ici détaillé)
- [`etat-actuel.md`](./etat-actuel.md) — Quoi marche / quoi manque
- [`cookbook-chat.md`](./cookbook-chat.md) — Exemple complet
