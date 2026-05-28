# @nodefony/realtime

Couche realtime serveur Nodefony — **la Socket Nodefony** : hub WebSocket fan-out,
protocole JSON-RPC 2.0 (peer isomorphe partagé avec le client core), backplane cluster
interchangeable (Loopback / Cluster IPC / Redis / Kafka) et, à terme, protocoles TCP / UDP /
Unix sockets pour les usages IoT/IPC.

> 📖 **La doc complète est dans [`docs/`](./docs/)** — vulgarisée, avec analogies physiques,
> schémas, et exemples. Lis-la dans Studio (`/nodefony/documentation` → section Realtime)
> pour le rendu Mermaid + admonitions + code blocks copiables.

## État (2026-05-28)

| Couche                                               | État     | Disponible aujourd'hui ?                                             |
| ---------------------------------------------------- | -------- | -------------------------------------------------------------------- |
| Client navigateur isomorphe (`RealtimeClient`)       | ✅ 100 % | Oui — import via `nodefony/realtime` (subpath du core)               |
| Protocole JSON-RPC 2.0 (`JsonRpcPeer`)               | ✅ 80 %  | Oui — core, isomorphe                                                |
| Transport WS                                         | ✅ 100 % | Oui                                                                  |
| Transport long-polling fallback                      | ⬜ 0 %   | Non (P13.7 reste)                                                    |
| Hub local serveur (`RealtimeHub`)                    | ✅ 100 % | Oui — actuellement dans `@nodefony/framework`, rapatrié ici en P13.0 |
| Backplane `Loopback` (mono-process)                  | ✅ 100 % | Oui                                                                  |
| Backplane `Cluster IPC` (Node natif, multi-worker)   | ✅ 100 % | Oui (`nodefony cluster -w N`)                                        |
| Backplane `Redis` (multi-host)                       | ⬜ 0 %   | Non (Bloc B, ~1 ses grâce au contrat)                                |
| Backplane `Kafka` (persistence + at-least-once)      | ⬜ 0 %   | Non (Bloc C, 3 ses)                                                  |
| Décorateurs `@RealtimeController` / `@RealtimeEvent` | ⬜ 0 %   | Non (Bloc A étape 3)                                                 |
| `defineRealtimeConfig()` builder                     | ⬜ 0 %   | Non (Bloc A étape 5)                                                 |
| Cadence adaptative AIMD                              | ✅ 100 % | Oui — différenciateur                                                |
| Sonde `realtime:health`                              | ✅ 100 % | Oui — surfacée dans Studio                                           |
| TCP / UDP / Unix sockets                             | ⬜ 0 %   | Non (Bloc D différable, P13.1)                                       |

## Installation

Workspace npm — déjà inclus dans `nodefony-core`. Pour activer la couche serveur dans une
app : pas d'`@modules()` à ajouter (le wiring serveur est consommé par les services
existants). Après le rapatriement P13.0, la consommation se fera via :

```typescript
import { defineRealtimeConfig } from "@nodefony/realtime";
```

## Usage côté CLIENT (déjà disponible aujourd'hui)

```typescript
import { RealtimeClient } from "nodefony/realtime"; // subpath core

const socket = RealtimeClient.shared({ url: "wss://app.com/realtime" });

await socket.subscribe("chat:room-42");
socket.on("chat:room-42", (msg) => console.log(msg));

// RPC bidirectionnel
const pong = await socket.request("kernel:ping");
```

## Usage côté SERVER (cible — après Bloc A)

```typescript
import {
  defineRealtimeConfig,
  RealtimeController,
  RealtimeEvent,
} from "@nodefony/realtime";
import { Body, CurrentUser } from "@nodefony/framework";

// 1) Config — la seule chose qui change entre dev et prod
export const realtimeConfig = defineRealtimeConfig({
  backplane: process.env.NODE_ENV === "production" ? "redis" : "loopback",
  redis: process.env.REDIS_URL ? { url: process.env.REDIS_URL } : undefined,
});

// 2) Controller — comme un controller HTTP, juste avec @RealtimeController
@RealtimeController("/chat")
export class ChatController {
  @RealtimeEvent("message")
  async onMessage(@Body() msg: ChatMsg, @CurrentUser() user: IUser) {
    await this.chatService.save(msg);
    this.hub.publish(`chat:room-${msg.roomId}`, {
      user: user.name,
      text: msg.text,
    });
  }
}
```

## Configuration

Cf [`docs/configuration.md`](./docs/configuration.md) pour les 4 backplanes
(Loopback / ClusterIPC / Redis / Kafka) + comment écrire son propre driver custom.

## API

| Symbole                        | Type      | Rôle                               |
| ------------------------------ | --------- | ---------------------------------- |
| `RealtimeError`                | class     | Erreur de base (code + context)    |
| _RealtimeHub_ (P13.0)          | class     | Broker fan-out serveur             |
| _RealtimeController_ (P13.0)   | class     | Base class controllers WS          |
| _IBackplane_ (P13.0)           | interface | Contrat cluster (4 drivers)        |
| _defineRealtimeConfig_ (P13.4) | function  | Builder + Zod validation           |
| _@RealtimeController_ (P13.8)  | decorator | Marque une classe controller WS    |
| _@RealtimeEvent_ (P13.8)       | decorator | Marque une méthode d'event handler |

## Doc complète

| Page                                               | Description                              |
| -------------------------------------------------- | ---------------------------------------- |
| [`docs/index.md`](./docs/index.md)                 | Vue d'ensemble + promesse DX             |
| [`docs/vocabulaire.md`](./docs/vocabulaire.md)     | 12 mots avec analogies physiques         |
| [`docs/architecture.md`](./docs/architecture.md)   | Pile 5 étages + flot d'une frame cluster |
| [`docs/configuration.md`](./docs/configuration.md) | Loopback / IPC / Redis / Kafka + custom  |
| [`docs/etat-actuel.md`](./docs/etat-actuel.md)     | État réel + roadmap                      |
| [`docs/cookbook-chat.md`](./docs/cookbook-chat.md) | Exemple chat end-to-end                  |

## License

CECILL-B
