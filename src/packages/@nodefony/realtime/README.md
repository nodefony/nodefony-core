# @nodefony/realtime

Couche realtime serveur Nodefony — **la Socket Nodefony** : hub WebSocket fan-out, protocole
JSON-RPC 2.0 (peer isomorphe partagé avec le client du cœur) et backplane cluster interchangeable
(`loopback`, `cluster` IPC, `redis`) ouvert aux drivers écrits par l'application.

> 📖 **La doc complète est dans [`docs/`](./docs/)** — vulgarisée, avec analogies physiques,
> schémas et exemples. Lis-la dans Studio (`/nodefony/documentation` → section Realtime) pour le
> rendu Mermaid + admonitions + blocs de code copiables.

## Installation

Workspace npm — déjà inclus dans `nodefony-core`. Dans une application, le module se déclare dans
le manifeste `modules` de `nodefony.config.ts` :

```typescript
import { defineConfig, use } from "nodefony";

export default defineConfig(() => ({
  modules: [
    "@nodefony/http",
    "@nodefony/framework",
    use("@nodefony/realtime", { backplane: { driver: "loopback" } }),
  ],
}));
```

## Usage côté client

Le client navigateur **n'est pas dans ce module** : il vit dans le cœur, importable sans dépendre
du serveur (isomorphisme). Le subpath est **`nodefony/client`**.

```typescript
import { RealtimeClient } from "nodefony/client";

const socket = RealtimeClient.shared({ url: "wss://app.com/realtime" });

await socket.subscribe("chat:room");
socket.on("chat:room", (msg) => console.log(msg));

// RPC bidirectionnel
const pong = await socket.request("nodefony:kernel:ping");
```

En React, les hooks sont sous `nodefony/react` (`useNodefony`, `useNodefonyChannel`…).

## Usage côté serveur

Un controller realtime est un controller Nodefony ordinaire qui étend la classe abstraite
`RealtimeController`. Le protocole (poignée de main, découpage des frames, abonnements, nettoyage)
est porté par la base ; le controller ne déclare que son métier.

```typescript
import { controller, route } from "@nodefony/framework";
import {
  RealtimeController,
  RealtimeChannel,
  RealtimeInbound,
} from "@nodefony/realtime";
import type { RealtimePublish } from "@nodefony/realtime";
import type { ContextType } from "@nodefony/http";

@controller("/chat")
class ChatController extends RealtimeController {
  constructor(context: ContextType) {
    super("chat", context);
  }

  /** La porte : l'URL WebSocket que le navigateur ouvre. */
  @route("chat-realtime", {
    path: "/realtime",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async realtime(message: string | Buffer | null): Promise<void> {
    this.handleRealtime(message);
  }

  /** Un canal sortant : appelé au PREMIER abonné, rend sa fonction de nettoyage. */
  @RealtimeChannel("chat:room", { authenticated: true })
  room(_channel: string, _publish: RealtimePublish): () => void {
    return () => {};
  }

  /** Un canal entrant : le client pousse vers le serveur. Rien n'est ouvert par défaut. */
  @RealtimeInbound("chat:send", { authenticated: true })
  onSend(params: unknown, reply: (payload: unknown) => void): void {
    // `params` vient du réseau : le valider avant toute chose.
    reply({ ok: true });
  }
}
```

Les trois décorateurs prennent `(nom, policy?)` — la politique déclare qui a le droit
(`authenticated`, `roles`). Une action sans politique reste fermée par défaut.

Recette complète (salon, présence, historique, upload) : [`docs/cookbook-chat.md`](./docs/cookbook-chat.md).

## Backplane

Le backplane est le fond de panier qui relie les pods entre eux. Trois drivers sont livrés avec le
module, et le registre est ouvert : une application peut brancher le sien.

| Driver              | Usage                                                            |
| ------------------- | ---------------------------------------------------------------- |
| `loopback` (défaut) | mono-process — aucun transport, fan-out local                    |
| `cluster`           | multi-worker sur une machine (IPC Node, `nodefony cluster -w N`) |
| `redis`             | multi-hôte (pub/sub cross-pod, enveloppe scellée HMAC)           |

```typescript
import { registerBackplaneDriver } from "@nodefony/realtime";

registerBackplaneDriver("nats", (config) => new MyNatsBackplane(config));
```

Détail des réglages : [`docs/configuration.md`](./docs/configuration.md).

## API

| Symbole                                                                   | Type       | Rôle                                              |
| ------------------------------------------------------------------------- | ---------- | ------------------------------------------------- |
| `RealtimeController`                                                      | class      | Base abstraite des controllers WebSocket          |
| `RealtimeHub` / `getRealtimeHub`                                          | class / fn | Broker fan-out serveur                            |
| `RealtimeService`                                                         | class      | Service injectable (authenticators, cycle de vie) |
| `ServerRealtimeSocket` / `serverSocket`                                   | class / fn | Façade « la socket » côté serveur                 |
| `@RealtimeChannel` / `@RealtimeInbound` / `@RealtimeAction`               | decorators | Canal sortant · canal entrant · action RPC        |
| `@RealtimeBroadcast`                                                      | decorator  | Déclare les préfixes propagés au cluster          |
| `defineRealtimeConfig` / `realtimeConfigJsonSchema`                       | functions  | Builder de config + JSON Schema (Studio)          |
| `LoopbackBackplane` / `ClusterBackplane` / `RedisBackplane`               | classes    | Les 3 drivers natifs                              |
| `registerBackplaneDriver` / `getBackplaneDriver` / `listBackplaneDrivers` | functions  | Registre ouvert de drivers                        |
| `IBackplane`                                                              | interface  | Contrat d'un fond de panier                       |
| `IRealtimeAuthenticator` / `IRealtimeToken` / `IRealtimeHandshake`        | interfaces | Seams sécurité du handshake                       |
| `RealtimeError`                                                           | class      | Erreur de base (code + contexte)                  |
| `ANONYMOUS_REALTIME_TOKEN`                                                | const      | Jeton anonyme gelé — fallback Zero Trust          |

## Doc complète

| Page                                               | Description                                   |
| -------------------------------------------------- | --------------------------------------------- |
| [`docs/index.md`](./docs/index.md)                 | Vue d'ensemble + promesse DX                  |
| [`docs/vocabulaire.md`](./docs/vocabulaire.md)     | 12 mots avec analogies physiques              |
| [`docs/architecture.md`](./docs/architecture.md)   | Pile 5 étages + trajet d'une frame en cluster |
| [`docs/protocole.md`](./docs/protocole.md)         | Grammaire des frames, codes d'erreur réels    |
| [`docs/actions.md`](./docs/actions.md)             | RPC : appeler et savoir si ça a marché        |
| [`docs/configuration.md`](./docs/configuration.md) | Les 3 backplanes + driver custom              |
| [`docs/securite.md`](./docs/securite.md)           | Autorisation des canaux, zones, plafonds      |
| [`docs/observabilite.md`](./docs/observabilite.md) | Sonde, canaux de santé, écrans                |
| [`docs/cookbook-chat.md`](./docs/cookbook-chat.md) | Exemple de chat de bout en bout               |

## Licence

CeCILL-B — Christophe CAMENSULI.
