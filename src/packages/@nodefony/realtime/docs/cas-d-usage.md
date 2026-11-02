---
title: "Cas d'usage du temps réel — l'exemple qui correspond à votre besoin"
navTitle: Cas d'usage
lang: fr
module: "@nodefony/realtime"
topic: realtime
section: "Temps réel"
audience: [developer]
tags:
  [cas d'usage, jeu, salon, sonde, notifications, tâche, allow, contre-pression]
version: "doc"
status: stable
updated: 2026-11-02
source: "src/packages/@nodefony/realtime/docs/cas-d-usage.md"
coverageModule: realtime
---

# Cas d'usage du temps réel — l'exemple qui correspond à votre besoin

📍 [Documentation](../../../../../docs/index.md) › [Realtime](index.md) › **Cas d'usage**

> Un jeu, un salon privé, une sonde industrielle, une notification personnelle, le suivi d'une
> tâche longue : chaque besoin a son exemple, court, et le choix qui le justifie. Les décisions du
> temps réel (admission, abonnement imposé, éjection, contre-pression) ne se comprennent
> qu'ensemble ; ici, on part du besoin et on les retrouve en situation.

## 🧠 Le modèle mental

Partez de la ligne qui ressemble à votre besoin, copiez son exemple, puis lisez « le piège » : c'est
l'erreur qui compile, passe les tests, et ne se voit qu'en production.

| Je veux…                                                           | Le cas                                                 | Ce qui décide                           |
| ------------------------------------------------------------------ | ------------------------------------------------------ | --------------------------------------- |
| recevoir 60 positions par seconde et par joueur                    | [Jeu — déplacements](#jeu--déplacements)               | la dernière valeur seule, le tick       |
| placer un joueur dans une partie sans qu'il s'abonne               | [Jeu — recherche de partie](#jeu--recherche-de-partie) | l'abonnement imposé, lu par `allow`     |
| un salon sur invitation, dont on peut exclure quelqu'un            | [Salon privé](#salon-privé-sur-invitation)             | `allow` exclut, l'éjection coupe        |
| des capteurs qui écrivent, des écrans qui lisent                   | [Sonde et supervision](#sonde-et-supervision)          | la portée du jeton, le canal en lecture |
| prévenir une personne, sur tous ses onglets                        | [Notification privée](#notification-privée-userid)     | le canal `user:<id>`, fourni            |
| montrer la progression d'une tâche longue à celui qui l'a demandée | [Tâche d'agent](#tâche-dagent)                         | le serveur nomme le canal et le termine |
| un appel, une conversation à la voix                               | [Appel et voix](#appel-et-voix)                        | en conception                           |

Chaque exemple serveur est le **corps d'un contrôleur temps réel**. Le contrôleur lui-même, sa
route et son câblage naissent d'une commande, et ne sont pas répétés ici :

```bash
npx nodefony create controller Arena --kind realtime
```

Les exemples de cette page sont exécutés tels quels par la suite de tests du module : ce que vous
copiez a tourné.

## 📖 Lexique

- **État** — une valeur dont seule la dernière compte (une position, une jauge). **Événement** — un
  message dont chacun compte (un message de chat). Les deux ne se traitent pas pareil sous charge.
- **Tick** — le rythme propre du serveur : il diffuse l'état à intervalle fixe, quel que soit le
  nombre de messages reçus entre deux.
- **Abonnement imposé** — le serveur abonne une connexion qui n'a rien demandé ; le navigateur
  l'apprend par `realtime:subscribed { imposed: true }` et le rejoue à la reconnexion.
- **Éjection** — retrait d'une connexion d'un canal (`realtime:closed { reason: "evicted" }`) ;
  elle coupe, elle n'interdit pas de revenir. **Fin** — le canal est terminé pour tous (`ended`).
- **Portée** (`scope`) — un droit porté par le jeton d'une machine ou d'une application, là où une
  personne porte un rôle.

## 🚀 Démarrage rapide — un exemple par besoin

### Jeu — déplacements

Soixante coups par seconde et par joueur, un écran qui se redessine vingt fois par seconde.

<!-- example: gameMoves.ts -->

```ts
import type { ContextType } from "@nodefony/http";
import {
  RealtimeChannel,
  RealtimeController,
  RealtimeInbound,
  getRealtimeHub,
} from "@nodefony/realtime";
import type { IRealtimeConnection } from "@nodefony/realtime";

type Point = { x: number; y: number };

/** Dernière position connue de chaque joueur : un coup REMPLACE le précédent. */
export const positions = new Map<string, Point>();

export class ArenaRealtime extends RealtimeController {
  constructor(context: ContextType) {
    super("ArenaRealtime", context);
  }

  // Le rôle est contrôlé au premier coup, puis le verdict est retenu sur la connexion.
  @RealtimeInbound("game:move", { roles: ["ROLE_PLAYER"] })
  move(
    params: unknown,
    _reply: unknown,
    connection: IRealtimeConnection,
  ): void {
    if (connection.userId === null || !isPoint(params)) return;
    positions.set(connection.userId, { x: params.x, y: params.y });
  }

  @RealtimeChannel("game:state", { roles: ["ROLE_PLAYER"] })
  state(): () => void {
    return () => {};
  }
}

/** Le serveur diffuse l'état à SON rythme (`setInterval(tick, 50)`), pas à chaque coup. */
export function tick(): void {
  if (positions.size === 0) return;
  getRealtimeHub().publish("game:state", Object.fromEntries(positions));
}

function isPoint(value: unknown): value is Point {
  return (
    typeof value === "object" &&
    value !== null &&
    "x" in value &&
    "y" in value &&
    typeof value.x === "number" &&
    typeof value.y === "number"
  );
}
```

Côté navigateur, la socket **jette** un coup quand le réseau cale, au lieu de l'empiler :

```ts
import { NodefonySocket } from "nodefony/client";

const socket = NodefonySocket.shared({
  url: "/api/live/realtime",
  maxBufferedAmount: 64 * 1024, // au-delà, le coup est jeté et compté, pas mis en file
});
socket.subscribe("game:state");
socket.on("game:state", (players) => console.log(players));
socket.emit("game:move", { x: 10, y: 4 });
```

Et côté serveur, une borne du nombre de trames qu'un client peut envoyer :

```ts ignore
// nodefony.config.ts
use("@nodefony/http", {
  websocket: { maxFramesPerSecond: 120, frameRateCloseAfterRejects: 1000 },
  websocketSecure: {
    maxFramesPerSecond: 120,
    frameRateCloseAfterRejects: 1000,
  },
});
```

**Pourquoi ce choix.** Le rôle est vérifié au premier coup, puis retenu sur la connexion : le
59ᵉ coup de la seconde ne refait aucun contrôle. Le serveur garde la dernière position et diffuse
à son rythme : N joueurs coûtent 20 diffusions par seconde, pas 60 × N.

**Le piège.** Mettre chaque coup dans une file, ou le rediffuser à la réception : après dix
secondes de tunnel, trois cents positions périmées partent en rafale.

Les positions portent des octets (un `Uint8Array` compact) ? Activez le codec binaire, et la charge
passe par le même canal, sous la même politique — voir [Protocole](protocole.md).

### Jeu — recherche de partie

Le joueur demande une partie ; le serveur la trouve et l'y place, sans qu'il ait à s'abonner.

<!-- example: matchmaking.ts -->

```ts
import type { ContextType } from "@nodefony/http";
import {
  RealtimeChannel,
  RealtimeController,
  RealtimeInbound,
  getRealtimeHub,
} from "@nodefony/realtime";
import type { IRealtimeConnection } from "@nodefony/realtime";

/** Qui joue à quelle partie — en vrai, une table ou un Redis partagé. */
export const players = new Map<string, Set<string>>();

export class MatchRealtime extends RealtimeController {
  constructor(context: ContextType) {
    super("MatchRealtime", context);
  }

  // `allow` lit l'appartenance : au premier abonnement ET à chaque reconnexion.
  @RealtimeChannel("match:*", {
    allow: (channel, who) =>
      who.id !== null && (players.get(channel)?.has(who.id) ?? false),
  })
  match(): () => void {
    return () => {};
  }

  override createRealtimeChannel(channel: string): (() => void) | null {
    return players.has(channel) ? () => {} : null;
  }

  @RealtimeInbound("match:find", { authenticated: true })
  async find(
    _params: unknown,
    _reply: unknown,
    connection: IRealtimeConnection,
  ): Promise<void> {
    if (connection.userId === null) return;
    const match = "match:42"; // la partie trouvée pour ce joueur
    const members = players.get(match) ?? new Set<string>();
    members.add(connection.userId); // 1. écrire l'appartenance là où `allow` la lit
    players.set(match, members);
    await getRealtimeHub().subscribeConnection(match, connection); // 2. abonner d'office
  }
}
```

**Pourquoi ce choix.** Le navigateur rejoue ses abonnements à chaque reconnexion, et ce rejeu passe
par `allow`. L'appartenance est donc écrite **là où `allow` la lit**, avant d'abonner : le joueur
retrouve sa partie après une coupure, sans code côté navigateur.

**Le piège.** Abonner d'office sans écrire l'appartenance : tout marche, jusqu'à la première
coupure réseau — sur mobile, dans la minute — où le joueur est refusé de sa propre partie.

Le détail des gestes (lister, éjecter, terminer) : [Canal à membres](canaux-a-membres.md).

### Salon privé sur invitation

Seuls les invités entrent ; un modérateur peut exclure quelqu'un.

<!-- example: privateRoom.ts -->

```ts
import type { ContextType } from "@nodefony/http";
import {
  RealtimeChannel,
  RealtimeController,
  getRealtimeHub,
} from "@nodefony/realtime";

/** Les invités de chaque salon — en vrai, une table : `allow` peut l'interroger. */
export const guests = new Map<string, Set<string>>();

async function isGuest(room: string, user: string): Promise<boolean> {
  return guests.get(room)?.has(user) ?? false; // en vrai : `await repository.exists(…)`
}

export class RoomRealtime extends RealtimeController {
  constructor(context: ContextType) {
    super("RoomRealtime", context);
  }

  // Appelé UNE fois, au `subscribe` : une requête en base y est normale.
  @RealtimeChannel("room:*", {
    allow: async (channel, who) =>
      who.id !== null && (await isGuest(channel, who.id)),
  })
  room(): () => void {
    return () => {};
  }

  override createRealtimeChannel(channel: string): (() => void) | null {
    return guests.has(channel) ? () => {} : null;
  }
}

/** Exclure : retirer l'invitation (`allow` dira non), PUIS couper ce qu'il reçoit déjà. */
export function exclude(room: string, user: string): void {
  guests.get(room)?.delete(user);
  getRealtimeHub().evictUser(room, user); // ses onglets reçoivent `realtime:closed { reason: "evicted" }`
}
```

**Pourquoi ce choix.** `allow` est appelé une seule fois par abonnement, jamais par message : une
requête en base y est normale. Exclure, c'est retirer l'invitation **puis** éjecter.

**Le piège.** Éjecter sans retirer l'invitation, ou tenir une liste noire à côté : l'exclu
recharge sa page, son navigateur refait `subscribe`, et `allow` le laisse rentrer.

Le salon complet — historique, messages privés, présence : [Recette — un chat](cookbook-chat.md).

### Sonde et supervision

Des capteurs envoient des mesures ; les écrans de supervision les reçoivent.

<!-- example: sensors.ts -->

```ts
import type { ContextType } from "@nodefony/http";
import {
  RealtimeChannel,
  RealtimeController,
  RealtimeInbound,
  getRealtimeHub,
} from "@nodefony/realtime";

export class SensorRealtime extends RealtimeController {
  constructor(context: ContextType) {
    super("SensorRealtime", context);
  }

  // Écrire : réservé aux sondes, par la portée de leur jeton.
  @RealtimeInbound("sensor:reading", { scopes: ["telemetry:write"] })
  reading(params: unknown): void {
    if (!isReading(params)) return;
    getRealtimeHub().publish("sensor:dashboard", params);
  }

  // Lire : les écrans de supervision. Aucun gestionnaire entrant : le canal est en lecture seule.
  @RealtimeChannel("sensor:dashboard", { roles: ["ROLE_SUPERVISOR"] })
  dashboard(): () => void {
    return () => {};
  }
}

function isReading(value: unknown): value is { probe: string; value: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    "probe" in value &&
    "value" in value &&
    typeof value.probe === "string" &&
    typeof value.value === "number"
  );
}
```

**Pourquoi ce choix.** Écrire et lire sont deux droits distincts : la sonde s'identifie par la
portée de son jeton (`telemetry:write`), l'écran par un rôle. Le canal du tableau n'a aucun
gestionnaire entrant : un écran ne peut rien y pousser.

**Le piège.** Un écran lent — un onglet en arrière-plan, un réseau faible — ne ralentit personne :
au-delà de sa file d'envoi, le serveur jette ce qui lui est destiné, puis le déconnecte. Ne
compensez pas par une file maison : ce serait garder en mémoire ce que l'écran ne lira jamais.
Réglages et mesures : [Cadence et contre-pression](cadence-et-contre-pression.md).

### Notification privée `user:<id>`

Prévenir une personne — sur tous ses onglets, tous les serveurs, et elle seule.

<!-- example: userNotifications.ts -->

```ts
import { getRealtimeHub } from "@nodefony/realtime";

/** Depuis un service, un job ou un contrôleur : rien à déclarer, aucun canal à écrire. */
export function notifyInvoicePaid(userId: string, invoice: string): void {
  getRealtimeHub().publishToUser(userId, { kind: "invoice:paid", invoice });
}
```

Côté navigateur, un seul geste ; la forme du message se déclare dans le contrat :

```ts
import { NodefonySocket } from "nodefony/client";
import type { IRealtimeContract } from "nodefony/client";

interface BillingContract extends IRealtimeContract {
  serverToClient: {
    [channel: `user:${string}`]: { kind: "invoice:paid"; invoice: string };
  };
}

const socket = NodefonySocket.fromContract<BillingContract>({
  url: "/api/live/realtime",
});
socket.onUser((note) => console.log(`facture ${note.invoice} payée`));
```

**Pourquoi ce choix.** Le canal personnel est une brique du framework : connexion authentifiée,
admission par égalité exacte avec `user:<ton id>`, diffusion sur tous les serveurs. Rien à
déclarer, et une application qui n'appelle jamais `onUser` ne paie rien.

**Le piège.** Déclarer soi-même une politique sur `user:…` — par exemple pour ouvrir `user:public`
à tous. Elle l'emporte sur la règle intégrée, et retire la garantie « toi seul » au canal qu'elle
couvre. À n'écrire qu'en connaissance de cause : [Sécurité](securite.md).

### Tâche d'agent

Une tâche longue — une analyse, une génération — dont le demandeur suit la progression.

<!-- example: agentTask.ts -->

```ts
import { randomUUID } from "node:crypto";
import type { ContextType } from "@nodefony/http";
import {
  RealtimeChannel,
  RealtimeController,
  RealtimeInbound,
  getRealtimeHub,
} from "@nodefony/realtime";
import type { IRealtimeConnection } from "@nodefony/realtime";

/** Tâche en cours → son demandeur. Seul le demandeur suit le flux de SA tâche. */
export const owners = new Map<string, string>();

export class TaskRealtime extends RealtimeController {
  constructor(context: ContextType) {
    super("TaskRealtime", context);
  }

  @RealtimeChannel("task:*", {
    allow: (channel, who) => owners.get(channel) === who.id,
  })
  task(): () => void {
    return () => {};
  }

  override createRealtimeChannel(channel: string): (() => void) | null {
    return owners.has(channel) ? () => {} : null; // tâche finie : plus de canal
  }

  @RealtimeInbound("task:start", { authenticated: true })
  async start(
    _params: unknown,
    reply: (payload: object) => void,
    connection: IRealtimeConnection,
  ): Promise<void> {
    if (connection.userId === null) return;
    const task = `task:${randomUUID()}`; // nom choisi par le SERVEUR, jamais par le client
    owners.set(task, connection.userId);
    if (await getRealtimeHub().subscribeConnection(task, connection)) {
      reply({ task }); // le navigateur apprend le nom du canal qu'il suit déjà
      void run(task);
    }
  }
}

/** Le travail long : il publie sa progression, puis termine le canal pour tous. */
export async function run(task: string): Promise<void> {
  const hub = getRealtimeHub();
  for (const step of ["lecture", "analyse", "rédaction"]) {
    hub.publish(task, { step });
    await new Promise((resolve) => setTimeout(resolve, 0)); // le vrai travail
  }
  owners.delete(task);
  hub.closeChannel(task); // le client reçoit `realtime:closed { reason: "ended" }`
}
```

```ts
import { NodefonySocket } from "nodefony/client";

const socket = NodefonySocket.shared({ url: "/api/live/realtime" });
socket.on("task:start", (reply) => {
  // Une charge reçue du réseau se vérifie avant usage.
  if (typeof reply !== "object" || reply === null || !("task" in reply)) return;
  if (typeof reply.task === "string")
    socket.on(reply.task, (p) => console.log(p));
});
socket.onClosed(({ reason }) =>
  console.log(reason === "ended" ? "terminé" : reason),
);
socket.emit("task:start");
```

**Pourquoi ce choix.** Le serveur choisit le nom du canal et y abonne le demandeur : personne ne
peut deviner, ni imposer, le nom de la tâche d'un autre. La fin se dit par `closeChannel`, que le
navigateur reçoit en `realtime:closed { reason: "ended" }` — pas par un message « fini » que le
client devrait reconnaître.

**Le piège.** Réutiliser un nom de canal d'une tâche à l'autre (`task:alice`) : un onglet resté
ouvert sur la précédente recevrait la progression de la suivante.

### Appel et voix

En conception : le transport du son sur la socket, et la conversation à la voix avec un agent,
font l'objet de travaux en cours. Cette section renverra à leurs pages quand elles existeront ; d'ici
là, n'en anticipez pas l'interface.

## ⚠️ Pièges

- **Recomposer ce que le framework porte** : une liste noire à côté d'`allow`, un contrôle de rôle
  recopié dans chaque gestionnaire, un canal `user:` écrit à la main. Chacun compile ; chacun se
  désynchronise.
- **Mettre en file ce qui est un état** (une position, une jauge) : seule la dernière valeur compte.
  Les événements où chaque message compte (un message de chat) suivent l'autre règle.
- **Laisser le client nommer un canal privé** : le serveur le nomme, `allow` le garde.
- **Écrire un exemple sans politique** : un canal sans politique est public. Chaque exemple
  ci-dessus en déclare une.

## 🔩 Où c'est fait

- Entrée client par canal : `realtimeDecorators.ts#RealtimeInbound` ; canal servi :
  `realtimeDecorators.ts#RealtimeChannel`.
- Abonner d'office : `RealtimeHub.ts#RealtimeHub.subscribeConnection` ; éjecter un compte :
  `RealtimeHub.ts#RealtimeHub.evictUser` ; terminer : `RealtimeHub.ts#RealtimeHub.closeChannel`.
- Canal personnel : `RealtimeHub.ts#RealtimeHub.publishToUser`, et côté navigateur
  `NodefonySocket.ts#NodefonySocket.onUser`.
- Contre-pression du navigateur : `NodefonySocket.ts#NodefonySocket.admitOutbound` (jette au-delà de
  `maxBufferedAmount`).

## 🧪 Tests & couverture

- **Exemples exécutés** (`useCases.test.ts`) : chaque bloc serveur de cette page est un fichier de
  `nodefony/tests/fixtures/use-cases/`, éprouvé par un test — dernière position seule et diffusion
  au tick, appartenance qui survit à la reconnexion, exclu qui ne revient pas, mesure malformée
  écartée, notification qui n'atteint que sa destinataire, progression puis `ended`.
- **Page et fichiers identiques** : le même test compare chaque bloc marqué de cette page au
  fichier exécuté ; un exemple corrigé d'un seul côté fait échouer la suite.

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Realtime — vue d'ensemble](index.md) · [Toute la documentation](../../../../../docs/index.md)
- [Canal à membres](canaux-a-membres.md) — abonner d'office, éjecter, terminer.
- [Sécurité](securite.md) — `allow`, ses formes, son délai ; le canal `user:<id>`.
- [Cadence et contre-pression](cadence-et-contre-pression.md) — bornes d'envoi et de réception.
- Décisions : ADR-0022 §5 (contre-pression, bornes) et §6 (canaux privés).
