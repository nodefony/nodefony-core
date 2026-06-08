---
slug: realtime-module/cookbook-chat
title: "Cookbook — un chat de bout en bout"
section: realtime-module
audience: developer,architect,devops,supervisor,admin
version: v0.1
status: draft
updated: 2026-05-28
source: src/packages/@nodefony/realtime/docs/cookbook-chat.md
module: "@nodefony/realtime"
topic: cookbook-chat
tags:
  [cookbook, chat, example, end-to-end, tutorial, redis-deploy, client-server]
---

# Cookbook — un chat de bout en bout (Alice + Bob, dev → prod Redis)

> Ce cookbook est l'**exemple intégrateur** : tu y vois TOUT ensemble — config, controller
> serveur, code client, vérification cluster, déploiement prod. Tu le lis en 15 minutes,
> tu peux le copier-coller dans ton projet, et tu as un chat fonctionnel.

> [!IMPORTANT]
> Ce cookbook utilise l'API **cible** (post Bloc A : `@RealtimeController`,
> `defineRealtimeConfig`). Aujourd'hui (2026-05-28), seuls le client et le hub serveur
> brut sont disponibles. La forme exacte de l'API serveur sera figée à la fin du Bloc A.

## Cahier des charges

- Application **Nodefony 10** avec frontend Studio ou React custom.
- Un canal de chat par « room » : `chat:room-{N}`.
- Auth requise (`ROLE_USER` — sera branchée par P6 plus tard, en plug).
- Fan-out cross-pod en prod (plusieurs replicas k8s).
- Marche en dev sur le poste local (1 process, pas de docker).

## Le fichier de config

```typescript
// app/config/realtime.config.ts
import { defineRealtimeConfig } from "@nodefony/realtime";

export default defineRealtimeConfig({
  backplane:
    process.env.NODE_ENV === "production" && process.env.REDIS_URL
      ? "redis"
      : process.env.NODE_ENV === "staging"
        ? "cluster-ipc"
        : "loopback",

  redis: process.env.REDIS_URL
    ? { url: process.env.REDIS_URL, keyPrefix: "chat:rt:" }
    : undefined,

  hub: {
    maxBufferedAmount: 1_048_576, // 1 MB par peer
    pingIntervalMs: 30_000,
    adaptiveCadence: true,
  },

  probe: {
    enabled: true,
    sampleEveryMs: 5_000,
  },
});
```

## Le service métier (logique pure, transport-agnostic)

```typescript
// app/src/chat/ChatService.ts
import { Service, injectable } from "nodefony";
import type { Container } from "nodefony";

export interface ChatMsg {
  roomId: string;
  text: string;
  authorId: string; // user.id
  createdAt: number;
}

@injectable()
export class ChatService extends Service {
  constructor(container: Container) {
    super("chatService", container);
  }

  /** Persiste un message (DB via ORM). Renvoie le message complet avec id/createdAt. */
  async save(input: Omit<ChatMsg, "createdAt">): Promise<ChatMsg> {
    const full: ChatMsg = { ...input, createdAt: Date.now() };
    // … votre ORM (Drizzle / Mongoose) — délégué au repository
    // await this.repo.insert(full);
    return full;
  }

  /** Liste les N derniers messages d'une room (pour le history initial). */
  async history(roomId: string, limit = 50): Promise<ChatMsg[]> {
    // return this.repo.find({ where: { roomId }, orderBy: { createdAt: "desc" }, limit });
    return [];
  }
}
```

> [!NOTE]
> **Le service métier ne sait rien du realtime.** C'est pur métier (sauvegarde, history).
> C'est le contrôleur (couche transport) qui orchestre le metier + le hub. Pattern figé
> Nodefony (cf [[project_crud_pattern_decision]]).

## Le controller realtime (cible — post Bloc A)

```typescript
// app/src/chat/ChatController.ts
import { RealtimeController, RealtimeEvent } from "@nodefony/realtime";
import { Body, CurrentUser, Param } from "@nodefony/framework";
import { IsGranted } from "@nodefony/security"; // ← branché par P6
import type { IUser } from "@nodefony/user";
import { ChatService, type ChatMsg } from "./ChatService.ts";

@RealtimeController("/chat")
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  /** Reçoit un nouveau message du client + publie aux abonnés du canal. */
  @RealtimeEvent("send")
  @IsGranted("ROLE_USER")
  async onSend(
    @Body() input: { roomId: string; text: string },
    @CurrentUser() user: IUser,
  ): Promise<{ ok: true; id: string }> {
    const msg = await this.chat.save({
      roomId: input.roomId,
      text: input.text,
      authorId: user.id,
    });

    // Fan-out à tous les abonnés du canal de la room (local + cross-pod via backplane)
    this.hub.publish(`chat:room-${msg.roomId}`, {
      type: "new-message",
      author: { id: user.id, name: user.identifier },
      text: msg.text,
      createdAt: msg.createdAt,
    });

    return { ok: true, id: `${msg.createdAt}` };
  }

  /** Lit l'historique d'une room (RPC request → Promise côté client). */
  @RealtimeEvent("history")
  @IsGranted("ROLE_USER")
  async onHistory(
    @Param("roomId") roomId: string,
  ): Promise<{ messages: ChatMsg[] }> {
    return { messages: await this.chat.history(roomId, 50) };
  }
}
```

## Le client (navigateur — utilisable AUJOURD'HUI)

```typescript
// frontend/src/chat/useChat.ts
import { useEffect, useState } from "react";
import { RealtimeClient } from "nodefony/realtime"; // subpath core

export interface ChatLine {
  author: { id: string; name: string };
  text: string;
  createdAt: number;
}

export function useChat(roomId: string) {
  const [messages, setMessages] = useState<ChatLine[]>([]);

  useEffect(() => {
    const socket = RealtimeClient.shared({ url: "wss://app.com/realtime" });
    const channel = `chat:room-${roomId}`;

    // 1) Charger l'historique (RPC request → Promise)
    let cancelled = false;
    socket.request("chat:history", { roomId }).then((res) => {
      if (!cancelled) setMessages(res.messages);
    });

    // 2) S'abonner aux nouveaux messages (notifications)
    socket.subscribe(channel);
    const handler = (msg: {
      type: string;
      author: { id: string; name: string };
      text: string;
      createdAt: number;
    }) => {
      if (msg.type === "new-message") {
        setMessages((prev) => [
          ...prev,
          { author: msg.author, text: msg.text, createdAt: msg.createdAt },
        ]);
      }
    };
    socket.on(channel, handler);

    return () => {
      cancelled = true;
      socket.off(channel, handler);
      socket.unsubscribe(channel);
    };
  }, [roomId]);

  async function send(text: string) {
    const socket = RealtimeClient.shared({ url: "wss://app.com/realtime" });
    await socket.request("chat:send", { roomId, text });
  }

  return { messages, send };
}
```

```tsx
// frontend/src/chat/ChatRoom.tsx
import { useState } from "react";
import { useChat } from "./useChat.ts";

export function ChatRoom({ roomId }: { roomId: string }) {
  const { messages, send } = useChat(roomId);
  const [text, setText] = useState("");

  return (
    <div>
      <ul>
        {messages.map((m, i) => (
          <li key={i}>
            <strong>{m.author.name}</strong> : {m.text}
          </li>
        ))}
      </ul>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (text) {
            await send(text);
            setText("");
          }
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} />
        <button type="submit">Envoyer</button>
      </form>
    </div>
  );
}
```

## Démarrage en local (dev mono-process)

```bash
# 1) Pas besoin d'installer Redis : backplane = "loopback" auto en dev
# 2) Lance le serveur Nodefony
nodefony dev

# 3) Ouvre 2 onglets navigateur sur la même URL (ex http://localhost:5151/chat?room=42)
# 4) Tape un message dans l'onglet A — il apparaît dans l'onglet B en temps réel
```

> [!TIP]
> **Pourquoi ça marche en mono-process** : les 2 onglets parlent au **même** pod serveur,
> qui a un `RealtimeHub` local avec une table d'abonnements partagée. Le `LoopbackBackplane`
> ne fait rien (pas besoin de transporter cross-pod).

## Tester en cluster IPC (multi-worker, toujours sans infra)

```bash
# Lance 4 workers Node, le master fait le relai IPC
nodefony cluster -w 4

# Ouvre 4 onglets, chaque connexion WS atterrit sur 1 worker au hasard (round-robin reusePort)
# Tape un message dans un onglet → tous les autres le reçoivent
```

> [!TIP]
> **C'est LA démo magique du module** : tu vois en LIVE que les 4 workers se parlent via
> `ClusterBackplane` (IPC Node natif), sans Redis, sans rien à installer. Le filtre
> anti-écho est testé naturellement (un worker ne se renvoie pas son propre message).

## Déployer en prod (cluster k8s, Redis backplane)

### 1) Variables d'environnement du pod

```yaml
# k8s deployment.yaml — extrait
env:
  - name: NODE_ENV
    value: production
  - name: REDIS_URL
    valueFrom:
      secretKeyRef:
        name: redis-credentials
        key: url
```

### 2) Redis externe

```yaml
# Bitnami Helm chart, ElastiCache, Upstash, etc.
# L'URL DOIT être atteignable depuis tous les pods Nodefony
```

### 3) Vérification

Une fois le déploiement up, vérifier le bon fonctionnement :

```bash
# Sur ton poste (avec kubectl port-forward sur le service Nodefony)
curl -s https://app.com/nodefony/realtime/api/health | jq .

# Sortie attendue :
# {
#   "channels": [...],
#   "totals": { "channels": 47, "peers": 1342, "fanout": 12480 },
#   "backpressure": { "bufferedAmount": 0, "slowConsumers": 0 },
#   "cluster": { "podId": "chat-7d4f9-2x", "podCount": 6 }
# }
```

→ Si `cluster.podCount` > 1 et que les messages d'Alice (pod A) arrivent à Bob (pod B),
le `RedisBackplane` fonctionne.

## Sécurité (cible post-P6)

Avec les 5 seams en place dans P13 + P6 livré, voilà ce qui est greffé sans modifier le code
ci-dessus :

| Greffe P6                                                     | Effet                                                            |
| ------------------------------------------------------------- | ---------------------------------------------------------------- |
| `JwtAuthenticator` sur handshake WS (seam #2)                 | Le cookie JWT du browser → `peer.user` = `IUser` réel            |
| `@IsGranted("ROLE_USER")` lu via seam #1 `beforeDispatch`     | Frame refusée 403 si user pas authentifié                        |
| Area WS `{pattern: "chat:*", roles: ["ROLE_USER"]}` (seam #3) | Refus de subscribe pour les anonymes                             |
| Origin check (seam #4)                                        | Refus upgrade WS depuis un domaine non whitelisté (CSRF defense) |
| `onFrameAudit` (seam #5) → `AuditEventEntity` (P6.14)         | Toute frame refusée loggée pour audit                            |

> [!IMPORTANT]
> **TOUT ça est branché en plug** sans modifier ton `ChatController`, ton `ChatService`,
> ni ton client. C'est précisément la raison d'être des seams.

## Aller plus loin

- **Cadence adaptative par room** : `socket.subscribe("chat:room-42:1000")` (1 push/s max)
  ou `socket.adaptiveChannel("chat:room-42", { intervalMs: 200 })`.
- **Présence (qui est dans la room)** : canal additionnel `chat:room-42:presence` + publish
  périodique des onlines depuis chaque pod.
- **Typing indicator** : `socket.publish("chat:room-42:typing", { user })` — pas de
  persistence, fire-and-forget.
- **Read receipts** : RPC `socket.request("chat:mark-read", { roomId, until })` →
  persiste + publie `chat:room-42:read-receipt`.
- **Reconnexion auto** : déjà géré par `RealtimeClient` (backoff exponentiel, re-subscribe
  automatique des canaux après reconnect).

## Liens

- [`index.md`](./index.md) — Vue d'ensemble + promesse DX
- [`architecture.md`](./architecture.md) — Pile 5 étages (pour comprendre ce qui se passe sous le capot)
- [`configuration.md`](./configuration.md) — Détails config Loopback / IPC / Redis / Kafka
- [`etat-actuel.md`](./etat-actuel.md) — Quoi marche aujourd'hui (cookbook fonctionnel à 70 %)
