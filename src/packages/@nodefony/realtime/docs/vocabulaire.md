---
slug: realtime-module/vocabulaire
title: "Vocabulaire — les 12 mots de la Socket Nodefony"
section: realtime-module
audience: developer,architect,devops,supervisor,admin
version: v0.1
status: draft
updated: 2026-05-28
source: src/packages/@nodefony/realtime/docs/vocabulaire.md
module: "@nodefony/realtime"
topic: vocabulary
tags:
  [
    vocabulary,
    glossary,
    socket,
    hub,
    backplane,
    peer,
    transport,
    frame,
    channel,
    fan-out,
    dispatch,
    aimd,
    probe,
    seam,
  ]
---

# Vocabulaire figé — les 12 mots de la Socket Nodefony

> Cette page est ton **dictionnaire**. Une fois ces 12 mots cassés, tout le reste devient
> évident. Chaque mot vient avec :
>
> 1. **Une analogie physique** (le terme tangible qui te parle d'abord)
> 2. **Le terme technique exact** (le nom dans le code)
> 3. **Une définition courte** (ce qu'il fait vraiment)
> 4. **Où on le rencontre** (le fichier ou le contexte d'usage)

> [!IMPORTANT]
> **Mantra de recadrage** : quand tu te perds dans une discussion realtime, demande-toi
> systématiquement : « on parle de **prise**, d'**autocom**, ou de **fond de panier** ? ».
> 9 fois sur 10 ça remet les idées en place.

## Les 12 mots

### 1. Socket — la prise murale

|                     |                                                                                                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Analogie**        | La prise électrique murale (ou ta prise téléphonique RJ11)                                                                                                                                                                           |
| **Terme technique** | `IRealtimeSocket`                                                                                                                                                                                                                    |
| **Définition**      | Le **handle** que ton code applicatif manipule. 4 verbes : `subscribe`, `on`, `publish`, `request`. Côté client, c'est `RealtimeClient`. Côté serveur (consommateur du hub depuis un service métier), c'est aussi `IRealtimeSocket`. |
| **Où**              | Côté client : `nodefony/realtime` (subpath du core). Côté serveur : façade `RealtimeService` (P13.4 à coder).                                                                                                                        |

### 2. Hub — l'autocom du standardiste

|                     |                                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Analogie**        | Le standard téléphonique (autocom) qui aiguille les appels DANS un même immeuble                                                                                               |
| **Terme technique** | `RealtimeHub`                                                                                                                                                                  |
| **Définition**      | Le **broker** côté serveur. Maintient la table « canal → liste des peers locaux abonnés ». Fait le **fan-out local** quand un message arrive. 1 hub par process serveur (pod). |
| **Où**              | `@nodefony/realtime/nodefony/src/server/RealtimeHub.ts` (après rapatriement P13.0). Aujourd'hui : `@nodefony/framework/nodefony/src/RealtimeHub.ts`.                           |

> [!NOTE]
> **Attention au piège vocabulaire** : avant 2026-05-24, le terme « hub » désignait
> AUSSI le contrat client (renommé depuis en `IRealtimeSocket`). Aujourd'hui, **hub = serveur
> uniquement**, **socket = le handle (client OU serveur via la façade)**. C'est figé.

### 3. Peer — le combiné des deux côtés du fil

|                     |                                                                                                                                                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Analogie**        | Le combiné téléphonique (qui parle ET écoute) des 2 côtés de la conversation                                                                                                                                                                   |
| **Terme technique** | `JsonRpcPeer`                                                                                                                                                                                                                                  |
| **Définition**      | L'objet qui parle **JSON-RPC 2.0** des 2 côtés (client et serveur en miroir). **Isomorphe** : la même classe tourne dans le navigateur ET dans Node. Gère : sérialisation des frames, corrélation `id` ↔ Promise, dispatch entrant, heartbeat. |
| **Où**              | `nodefony/src/client/realtime/RealtimeClient.ts` (core, isomorphe). Le serveur le réutilise via subpath.                                                                                                                                       |

### 4. Transport — le câble

|                     |                                                                                                                                                                                                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Analogie**        | Le câble RJ45 / fibre / téléphonique entre ta prise et le standard                                                                                                                                                                                                                      |
| **Terme technique** | `IRealtimeTransport`                                                                                                                                                                                                                                                                    |
| **Définition**      | La **techno réseau** qui transporte les frames. Interchangeable. Aujourd'hui : `WsConnectionTransport` (serveur sur `ws` natif Node) + `BrowserWsTransport` (navigateur sur `WebSocket` DOM). Demain : `HttpLongPollingTransport` (P13.7) pour proxies hostiles + TCP/UDP/Unix (P13.1). |
| **Où**              | `nodefony/src/realtime/IRealtimeTransport.ts` (core, contrat). Impls dans core (client/serveur) et futur module.                                                                                                                                                                        |

### 5. Frame — l'enveloppe

|                     |                                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Analogie**        | L'enveloppe postale (ou la trame Ethernet) qui transporte une donnée d'un point à un autre                                                                                                        |
| **Terme technique** | Frame JSON-RPC 2.0                                                                                                                                                                                |
| **Définition**      | L'**unité atomique** qui passe sur le câble. 3 formes : `request` (avec `id` numérique), `response` (avec `id` correspondant + `result` OU `error`), `notification` (sans `id`, fire-and-forget). |
| **Où**              | Format défini par la [RFC JSON-RPC 2.0](https://www.jsonrpc.org/specification). Parsée et émise par `JsonRpcPeer`.                                                                                |

### 6. Channel — la conférence téléphonique

|                     |                                                                                                                                                                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Analogie**        | Une conférence téléphonique (room) à laquelle plusieurs personnes peuvent écouter                                                                                                                                                                        |
| **Terme technique** | Channel (juste un nom de string)                                                                                                                                                                                                                         |
| **Définition**      | Un **nom de canal** (ex. `"chat:room-42"`, `"orm:health"`, `"dashboard:supervision"`). Convention de namespacing avec `:`. Plusieurs peers peuvent souscrire au même canal → ils recevront tous les messages publiés dessus (= **fan-out automatique**). |
| **Où**              | API : `socket.subscribe(channel)`, `socket.publish(channel, payload)`. Pas de classe — c'est juste un string indexé par le hub.                                                                                                                          |

### 7. Fan-out — le ventilateur

|                     |                                                                                                                                                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Analogie**        | Un ventilateur qui souffle de 1 source vers N directions                                                                                                                                                                               |
| **Terme technique** | Fan-out                                                                                                                                                                                                                                |
| **Définition**      | Quand `publish(channel, msg)` arrive au hub, ce dernier envoie la frame à **TOUS les peers locaux** abonnés au canal. C'est le pattern pub/sub de base. En cluster, le fan-out se fait aussi cross-pod via le **backplane** (Étage 1). |
| **Où**              | Code : `RealtimeHub.publish(channel, payload)` → boucle synchrone sur la table des abonnés.                                                                                                                                            |

### 8. Backplane — le fond de panier du rack

|                     |                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Analogie**        | Le **fond de panier** d'un rack serveur (le PCB qui relie toutes les cartes) — ou le central téléphonique qui relie les autocoms de plusieurs étages d'un même immeuble                                                                                                                                                                                                                                                   |
| **Terme technique** | `IBackplane`                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Définition**      | Le **bus de transport cross-pod** qui propage les messages entre les pods d'un cluster. Contrat **pluggable** avec 4 drivers natifs : `LoopbackBackplane` (mono-process, rien à transporter), `ClusterBackplane` (Node cluster IPC, gratuit), `RedisBackplane` (multi-host, pub/sub), `KafkaBackplane` (persistence + at-least-once). N'importe quel utilisateur peut écrire son propre driver (NATS, Pulsar, RabbitMQ…). |
| **Où**              | Contrat : `nodefony/interfaces/IBackplane.ts` (après rapatriement). Impls : `nodefony/src/backplane/{Loopback,Cluster,Redis,Kafka}Backplane.ts`.                                                                                                                                                                                                                                                                          |

> [!TIP]
> **Le backplane est l'objet le PLUS magique du module**. C'est lui qui rend possible la
> promesse « 1 ligne de config change tout ». Le `RealtimeHub` ne sait pas qu'il est en
> cluster — il appelle `backplane.publish()` et laisse faire. Toute la complexité du cluster
> est cachée derrière le contrat `IBackplane`.

### 9. Dispatch — l'aiguilleur central

|                     |                                                                                                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Analogie**        | L'aiguilleur du standard téléphonique qui décide « cet appel va vers le poste X »                                                                                                                                                                            |
| **Terme technique** | `JsonRpcPeer.dispatch(frame)`                                                                                                                                                                                                                                |
| **Définition**      | La **méthode** qui décide quoi faire d'une frame entrante : extraire la method name → trouver le handler du controller → l'appeler → renvoyer la réponse (si c'est une request). **Point de greffe** privilégié pour la sécurité (seam #1 `beforeDispatch`). |
| **Où**              | `nodefony/src/client/realtime/RealtimeClient.ts` (méthode `dispatch` du `JsonRpcPeer` interne, isomorphe).                                                                                                                                                   |

### 10. AIMD — le régulateur de débit auto-ajusté

|                     |                                                                                                                                                                                                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Analogie**        | Le **régulateur de débit** style TCP : il accélère doucement (Additive Increase) quand tout va bien, et freine fortement (Multiplicative Decrease) à la moindre congestion observée                                                                                              |
| **Terme technique** | `AdaptiveRate` (algorithme AIMD = Additive Increase, Multiplicative Decrease)                                                                                                                                                                                                    |
| **Définition**      | Mécanisme qui **auto-ajuste la cadence d'envoi** par canal en fonction du backpressure observé (`bufferedAmount` du WebSocket). Évite de noyer un client lent. Spec : `subscribe(base, {intervalMs})` ou suffixe `:<ms>` dans le nom du canal. Le client peut désactiver via UI. |
| **Où**              | `nodefony/src/realtime/AdaptiveRate.ts` (core, isomorphe). Hooks React `useNodefonyAdaptiveChannel` / `useNodefonyAdaptiveChannelData`. ✅ livré (P13.10).                                                                                                                       |

### 11. Sonde (probe) — l'oscilloscope branché sur le circuit

|                     |                                                                                                                                                                                                                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Analogie**        | L'**oscilloscope** que le technicien branche sur la carte pour lire en live les signaux                                                                                                                                                                                                         |
| **Terme technique** | `IRealtimeProbe.probe()`                                                                                                                                                                                                                                                                        |
| **Définition**      | Interface qui dit « voici mon état de santé actuel, au format JSON ». Le `RealtimeHub` a une sonde, l'ORM a une sonde, etc. Le pod publie tous les `sampleEveryMs` ms un snapshot sur le canal `realtime:health` (et expose un endpoint HTTP `GET /nodefony/realtime/api/health` pour le pull). |
| **Où**              | Contrat : `nodefony/interfaces/IRealtimeProbe.ts`. Source de vérité : `RealtimeHub.probe()`. ✅ livré (P13.11).                                                                                                                                                                                 |

### 12. Seam — le point de greffe (prise pour une couche supérieure)

|                     |                                                                                                                                                                                                                                                                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Analogie**        | La **prise électrique murale** : préparée à l'avance pour qu'un grille-pain (= une couche supérieure comme security) puisse s'y brancher sans casser le mur                                                                                                                                                                                     |
| **Terme technique** | Seam (litt. « couture », « jointure »)                                                                                                                                                                                                                                                                                                          |
| **Définition**      | Un **hook** prévu dans une couche basse pour qu'une couche haute puisse y greffer du comportement **sans modifier la couche basse**. Concept popularisé par Michael Feathers (_Working Effectively with Legacy Code_, 2004). Dans `@nodefony/realtime`, **5 seams sécurité** sont prévus pour que `@nodefony/security` (P6) se branche en plug. |
| **Où**              | Liste figée dans [`../CLAUDE.md`](../CLAUDE.md) (section « 5 seams sécurité »). Coût total des 5 seams = ~1,2 ses.                                                                                                                                                                                                                              |

## Tableau récap (à imprimer et coller à côté de l'écran)

| Mot           | Analogie                                | Code                                 | Côté                         |
| ------------- | --------------------------------------- | ------------------------------------ | ---------------------------- |
| **Socket**    | prise murale                            | `IRealtimeSocket` / `RealtimeClient` | client + serveur (handle)    |
| **Hub**       | autocom                                 | `RealtimeHub`                        | serveur (1 par pod)          |
| **Peer**      | combiné                                 | `JsonRpcPeer`                        | client + serveur (isomorphe) |
| **Transport** | câble                                   | `IRealtimeTransport`                 | client + serveur             |
| **Frame**     | enveloppe                               | message JSON-RPC 2.0                 | —                            |
| **Channel**   | conférence                              | nom de string                        | —                            |
| **Fan-out**   | ventilateur                             | `RealtimeHub.publish`                | serveur                      |
| **Backplane** | fond de panier                          | `IBackplane`                         | serveur cluster              |
| **Dispatch**  | aiguilleur                              | `JsonRpcPeer.dispatch(frame)`        | client + serveur             |
| **AIMD**      | régulateur TCP                          | `AdaptiveRate`                       | client surtout               |
| **Sonde**     | oscilloscope                            | `IRealtimeProbe.probe()`             | serveur                      |
| **Seam**      | prise murale (pour 1 couche supérieure) | hook prévu                           | toutes couches               |

## Quand utiliser quel mot

- Tu parles de **ce que ton code applicatif voit** → dis **socket**.
- Tu parles de **ce que fait le serveur en local au pod** → dis **hub** (et `fan-out` pour
  l'action de diffuser).
- Tu parles de **ce qui se passe entre pods cluster** → dis **backplane**.
- Tu parles de **la techno réseau utilisée** (WS, long-polling, TCP) → dis **transport**.
- Tu parles **du protocole** (les frames, le dispatch) → dis **peer** ou **dispatch**.
- Tu parles de **gérer un client lent** → dis **AIMD** / cadence adaptative.
- Tu parles **d'observabilité** → dis **sonde** ou canal `realtime:health`.
- Tu parles de **prévoir un crochet pour security/audit** → dis **seam**.

## Liens

- [`index.md`](./index.md) — Vue d'ensemble + promesse DX
- [`architecture.md`](./architecture.md) — Pile 5 étages + flot d'une frame
- [`configuration.md`](./configuration.md) — Config Loopback / IPC / Redis / Kafka
