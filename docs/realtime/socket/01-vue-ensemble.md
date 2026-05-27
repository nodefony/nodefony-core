---
slug: socket/vue-ensemble
title: La Socket Nodefony — vue d'ensemble
section: realtime
audience: developer,architect
version: v1.0
status: stable
updated: 2026-05-28
source: docs/realtime/socket/01-vue-ensemble.md
---

## La multiprise intelligente

**La Socket Nodefony**, c'est une **multiprise** : une seule prise côté client, une seule côté serveur, et tu y branches autant de **canaux** que tu veux. Tu ne changes jamais la prise — seulement le **fond de panier** (mono-process, cluster IPC, ou Redis) derrière.

> [!NOTE]
> **Vocabulaire fixé.** `socket` (minuscule) = la prise — l'interface `IRealtimeSocket`. _La Socket Nodefony_ (avec majuscule) = le concept entier (prise + protocole + broker + backplane). Un **canal** = un flux nommé partagé entre N abonnés.

## Pourquoi pas deux WebSockets ?

Un seul WebSocket **multiplexe N canaux** = 1 handshake, 1 keepalive, 1 fenêtre de backpressure. Ouvrir N WebSockets dégrade la RAM serveur, la batterie client, et complique la cohérence (qui reconnecte en premier ?).

> [!TIP]
> Le multiplexing **JSON-RPC 2.0** est ce qui transforme le « WS brut » en _Socket_. Côté code, c'est `JsonRpcPeer` (isomorphe, partagé client/serveur), et côté serveur la map canal → abonnés s'appelle `RealtimeHub`.

## Exemple — s'abonner à un canal

```ts
// Côté navigateur (subpath isomorphe du core)
import { RealtimeClient } from "nodefony/realtime";

const client = RealtimeClient.shared({
  url: "wss://localhost:5152/nodefony/studio/api/realtime",
});
client.subscribe("syslog:stream", (pdu) => console.log(pdu));
```

> [!WARNING]
> `RealtimeClient.shared({url})` retourne un **singleton par URL** (`globalThis`). NE JAMAIS faire `new RealtimeClient()` dans une page Studio : Studio et la debug bar partagent la même socket — créer la tienne **coupera leurs canaux** quand ta page se démontera.

## Direction de flux

Pas que de la lecture. Une frame **avec `id`** = une **requête RPC** (`request` côté client, `result`/`error` côté serveur) — c'est la direction « contrôle » : reconnecter, vacuum, purger, forcer un GC. La frame **sans `id`** = notification (`subscribe`/`unsubscribe`/`publish`).

> [!IMPORTANT]
> Les actions disponibles sont **annoncées** au handshake via `realtime:welcome.methods` (découvrables côté client). Pas de hard-coding — Studio interroge la socket pour savoir ce qu'elle sait faire.

## Continuer

La suite : [Architecture en couches](./02-architecture.md) — le voyage d'un message du navigateur jusqu'aux workers (avec un graphe qui respire en temps réel).
