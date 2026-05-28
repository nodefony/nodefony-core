---
slug: realtime-module/index
title: "@nodefony/realtime — vue d'ensemble dev"
section: realtime-module
audience: developer,architect,devops,supervisor,admin
version: v0.1
status: draft
updated: 2026-05-28
source: src/packages/@nodefony/realtime/docs/index.md
module: "@nodefony/realtime"
topic: overview
tags: [realtime, websocket, json-rpc, cluster, hub, backplane, socket, overview]
---

# @nodefony/realtime — la « Socket Nodefony »

> Bienvenue dans la couche temps réel de Nodefony. Cette page t'explique **ce que c'est**,
> **pourquoi c'est différent**, et **comment tu l'utilises dans ton app** — en commençant
> par la cible (ce que tu écris) plutôt que par la plomberie interne.

> [!TIP]
> **Deux corpus de doc pour deux usages — complémentaires** :
>
> - 📘 **Doc dev du module** (ICI, `src/packages/@nodefony/realtime/docs/`) — référence
>   technique exhaustive, archi détaillée, cookbook, état/roadmap. Pour développer.
> - 📊 **Vitrine vivante Studio** (`docs/realtime/socket/*.md`, rendue dans
>   `/nodefony/documentation` → « Realtime / La Socket Nodefony ») — pédagogique courte,
>   avec **live graphs interactifs** qui montrent le système en train de tourner. Pour comprendre.
>
> Les 2 corpus se renvoient l'un à l'autre. Démarre par la vitrine si tu veux **voir avant
> de lire** ; reste ici si tu veux **construire**.

> [!WARNING]
> **Pas encore visible dans Studio `/nodefony/documentation`**. Le `DocumentationController`
> scanne aujourd'hui uniquement `docs/` racine (cf [[project_doc_portal_faisabilite]]).
> Pour que les docs des modules `src/packages/@nodefony/*/docs/` apparaissent dans le menu
> Studio, il faut étendre `#listRootDocSections()` (ou ajouter `#listModuleDocs()`) — c'est
> une dette **ADR-0001** (emplacement hybride : doc d'un module vit DANS le module). À faire
> en P13.0 (rapatriement) ou plus tôt si besoin. En attendant, lis les fichiers directement
> sur disque (`src/packages/@nodefony/realtime/docs/*.md`) ou sur GitHub.

> [!NOTE]
> **Audience cible & switch persona Studio**. Cette doc est **vulgarisée pour le `user`
> apprenant** (analogies physiques, pas de jargon balancé sans contexte) — c'est la posture
> par défaut. Les autres personas Studio (`developer`, `architect`, `devops`, `supervisor`,
> `admin`) **PEUVENT TOUS la consulter** : le système de rôles Studio est un **bitmask**
> (cf [[feedback_studio_layout_rigor]] — un même user peut porter plusieurs rôles
> simultanément, et le switch en haut à droite de Studio bascule entre eux pour voir
> d'autres angles). Le champ `audience` du frontmatter de cette page est donc volontairement
> ouvert à tous : la pédagogie ne se réserve à personne.

## Table des matières — par où entrer

| Tu cherches…                                         | Doc dev (ici)                                  | Vitrine vivante Studio (live graph)                                                                |
| ---------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Vision globale**                                   | Cette page                                     | [`01-vue-ensemble.md`](../../../../../docs/realtime/socket/01-vue-ensemble.md)                     |
| **Le vocabulaire** (socket, hub, backplane, peer, …) | [`vocabulaire.md`](./vocabulaire.md)           | —                                                                                                  |
| **L'archi technique** (5 étages + flot d'une frame)  | [`architecture.md`](./architecture.md)         | [`02-architecture.md`](../../../../../docs/realtime/socket/02-architecture.md)                     |
| **Le protocole JSON-RPC 2.0**                        | [`architecture.md#étage-4`](./architecture.md) | [`03-protocole.md`](../../../../../docs/realtime/socket/03-protocole.md) (📊 `ProtocoleLiveGraph`) |
| **Le fan-out (Étage 2 hub)**                         | [`architecture.md#étage-2`](./architecture.md) | [`04-fan-out.md`](../../../../../docs/realtime/socket/04-fan-out.md) (📊 `FanOutLiveGraph`)        |
| **Les sondes / observabilité**                       | [`architecture.md#sonde`](./architecture.md)   | [`05-sondes.md`](../../../../../docs/realtime/socket/05-sondes.md) (📊 `SondesLiveGraph`)          |
| **Le backplane cluster (Étage 1)**                   | [`configuration.md`](./configuration.md)       | [`06-backplane.md`](../../../../../docs/realtime/socket/06-backplane.md) (📊 `BackplaneLiveGraph`) |
| **RPC bidirectionnel (actions)**                     | [`architecture.md#étage-4`](./architecture.md) | [`07-actions.md`](../../../../../docs/realtime/socket/07-actions.md) (📊 `ActionsLiveGraph`)       |
| **Comment configurer Redis / Kafka**                 | [`configuration.md`](./configuration.md)       | —                                                                                                  |
| **Ce qui marche / ce qui manque**                    | [`etat-actuel.md`](./etat-actuel.md)           | —                                                                                                  |
| **Un exemple complet** (chat de bout en bout)        | [`cookbook-chat.md`](./cookbook-chat.md)       | —                                                                                                  |
| **Vision NORTH STAR transverse**                     | —                                              | [`realtime-socket-nodefony.md`](../../../../../docs/architecture/realtime-socket-nodefony.md)      |

> [!TIP]
> **Si tu n'as jamais touché du realtime de ta vie**, lis dans l'ordre :
> `vocabulaire.md` → cette page → `cookbook-chat.md`. Tu auras la vision en 15 min.

## La promesse en 1 phrase

> **Le code applicatif (controllers serveur + client navigateur) ne change PAS entre
> dev mono-process et prod cluster Redis/Kafka. Seule 1 ligne de config bouge.**

C'est ça qui justifie l'existence de ce module : tu écris ton chat / tes notifications /
ton bus d'events agents IA UNE fois, et tu déplaces le curseur entre 4 modes selon le
contexte (dev, staging, prod web, prod massive) sans toucher au code.

## Analogie physique pour la culture générale

Pense à un **standard téléphonique** d'entreprise :

- La **prise murale** dans ton bureau = ta `socket` (`RealtimeClient` côté code).
- L'**autocom** dans le local technique qui route les appels entre bureaux d'un MÊME étage
  = le `RealtimeHub` (broker fan-out, 1 par pod serveur).
- Le **fond de panier du rack télécom** qui relie les autocoms de plusieurs étages = le
  `IBackplane` (Loopback / Cluster IPC / Redis / Kafka).
- Le **câble** entre ta prise et l'autocom = le `IRealtimeTransport` (WebSocket aujourd'hui ;
  long-polling fallback ou TCP/UDP/Unix sockets demain).

Cette analogie marche partout — quand tu te perdras dans une discussion, demande-toi
toujours « est-ce qu'on parle de prise, d'autocom, ou de fond de panier ? ». 9 fois sur 10
ça te recadre.

## Ce que TU écris dans ton app (cible figée)

### Serveur — un controller realtime, comme un controller HTTP

```typescript
import { RealtimeController, RealtimeEvent } from "@nodefony/realtime";
import { Body, CurrentUser, IsGranted } from "@nodefony/framework";

@RealtimeController("/chat")
export class ChatController {
  @RealtimeEvent("message")
  @IsGranted("ROLE_USER") // ← greffé par P6 plus tard, en plug
  async onMessage(@Body() msg: ChatMsg, @CurrentUser() user: IUser) {
    await this.chatService.save(msg);
    this.hub.publish(`chat:room-${msg.roomId}`, {
      user: user.name,
      text: msg.text,
    });
  }
}
```

### Client — n'importe où (navigateur, mobile, autre serveur)

```typescript
import { RealtimeClient } from "nodefony/realtime"; // subpath du core, isomorphe

const socket = RealtimeClient.shared({ url: "wss://app.com/realtime" });

await socket.subscribe("chat:room-42");
socket.on("chat:room-42", (msg) => render(msg));

// RPC bidirectionnel (Promise)
const pong = await socket.request("kernel:ping");
```

### Config — UNE ligne qui change entre dev et prod

```typescript
// app/config/realtime.config.ts
import { defineRealtimeConfig } from "@nodefony/realtime";

export default defineRealtimeConfig({
  backplane: process.env.NODE_ENV === "production" ? "redis" : "loopback",
  redis: process.env.REDIS_URL ? { url: process.env.REDIS_URL } : undefined,
});
```

> [!NOTE]
> Le `ChatController` ne change **pas d'une virgule** entre dev et prod. Le client
> `RealtimeClient` ne change **pas d'une virgule**. **Seul le fichier de config bouge**.
> C'est le contrat `IBackplane` qui rend ça possible — détails dans
> [`architecture.md`](./architecture.md) (Étage 1).

## Ce que tu n'écris JAMAIS

- Code WebSocket bas niveau (handshake, frames, ping/pong)
- Code JSON-RPC (sérialisation, corrélation request/response)
- Code de reconnexion / heartbeat
- Code de fan-out / table d'abonnements
- Code de pub/sub Redis ou Kafka
- Code de filtrage d'écho cross-pod en cluster

Tout est dans le module. Tu vois 3 verbes côté client (`subscribe`, `on`, `publish`/`request`)
et 2 décorateurs côté serveur (`@RealtimeController`, `@RealtimeEvent`). C'est tout.

## Ce qui rend ce module différent (vs Socket.IO, Pusher, NestJS Gateways)

| Feature                                      | Socket.IO        | NestJS Gateways  | **@nodefony/realtime**                            |
| -------------------------------------------- | ---------------- | ---------------- | ------------------------------------------------- |
| Protocole standard                           | propriétaire     | propriétaire     | **JSON-RPC 2.0 (RFC)**                            |
| Client isomorphe (back + front même classe)  | non              | non              | **oui**                                           |
| Adapter cluster pluggable                    | oui (Redis only) | oui (Redis only) | **oui (Loopback / IPC / Redis / Kafka / custom)** |
| Cadence client adaptative (AIMD)             | non              | non              | **oui**                                           |
| Sonde santé native (canal `realtime:health`) | non              | non              | **oui**                                           |
| Décorateurs controller façon HTTP            | non              | oui              | **oui (cible Bloc A)**                            |
| Subscription full-duplex (RPC bidir)         | request/ack      | non              | **oui (`socket.request()`)**                      |

> [!TIP]
> **Le différenciateur le plus oublié = la cadence adaptative**. En cas de surcharge réseau
> ou de client lent, le module ralentit AUTOMATIQUEMENT l'envoi par canal (algo AIMD style TCP).
> Pas de surcharge à coder, pas de configuration. Détails : [`architecture.md`](./architecture.md)
> (section AIMD).

## La vue d'oiseau (5 étages)

```
┌─────────────────────────────────────────────────────────────────────┐
│  Étage 5 — Code applicatif  (ce que tu écris)                       │
│    Server : @RealtimeController + @RealtimeEvent                    │
│    Client : socket.subscribe + socket.on + socket.request           │
└─────────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────────┐
│  Étage 4 — Protocole        : JsonRpcPeer.dispatch(frame)           │
│    Format : JSON-RPC 2.0 (request / response / notification)        │
└─────────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────────┐
│  Étage 3 — Transport        : IRealtimeTransport                    │
│    WS natif (aujourd'hui) | long-polling (P13.7) | TCP/UDP (P13.1)  │
└─────────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────────┐
│  Étage 2 — Hub local        : RealtimeHub (1 par pod, fan-out)      │
└─────────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────────┐
│  Étage 1 — Backplane        : IBackplane (cross-pod)                │
│    Loopback (mono) | Cluster IPC | Redis | Kafka | custom           │
└─────────────────────────────────────────────────────────────────────┘
```

Détails complets : [`architecture.md`](./architecture.md).

## État du module (résumé — détails dans `etat-actuel.md`)

- ✅ **Aujourd'hui** : tu peux faire un chat / des notifications cross-onglets / une console
  live, en mono-process ou en cluster IPC (multi-workers Node). **Marche.**
- ⬜ **Bloc A en cours** : décorateurs `@RealtimeController` + builder `defineRealtimeConfig()`
  - 5 seams sécurité (pour que P6 se branche en plug plus tard).
- ⬜ **Bloc B prochaine fois** : `RedisBackplane` (cross-host multi-pod) — pour aller en prod
  multi-replica k8s.
- ⬜ **Bloc C ensuite** : `KafkaBackplane` (persistence + at-least-once) — pour le bus
  d'events agents IA (P12).
- ⬜ **Bloc D différable** : protocoles TCP / UDP / Unix sockets (P13.1) — pour les usages
  IoT/IPC.

Lire [`etat-actuel.md`](./etat-actuel.md) pour le détail couche par couche.

## Liens utiles

- 📐 **Décisions d'archi figées** : [`../CLAUDE.md`](../CLAUDE.md) (section « Décisions techniques figées »)
- 🤖 **Internals IA** : [`../MEMORY.md`](../MEMORY.md)
- 🗺️ **Plan d'exécution P13** : mémoire IA `project_p13_realtime_finish_plan`
- 🎓 **Vision DX complète** : mémoire IA `project_p13_realtime_dx_vision`
- 🏛️ **Cluster sans PM2** : mémoire IA `project_cluster_backplane_vision`
