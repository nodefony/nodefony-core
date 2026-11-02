---
title: "Canal à membres — abonner d'office, éjecter, terminer"
navTitle: Canal à membres
lang: fr
module: "@nodefony/realtime"
topic: realtime
section: "Temps réel"
audience: [developer]
tags: [canaux, membres, salon, partie, éjection, fermeture, allow]
version: "doc"
status: stable
updated: 2026-11-02
source: "src/packages/@nodefony/realtime/docs/canaux-a-membres.md"
coverageModule: realtime
---

# Canal à membres — abonner d'office, éjecter, terminer

📍 [Documentation](../../../../../docs/index.md) › [Realtime](index.md) › **Canal à membres**

> Un salon fermé, une partie à quatre, un appel, le flux d'une tâche qu'un agent rend à son
> demandeur : des canaux dont le **serveur** décide qui est dedans. Le canal reste le modèle — il
> porte son producteur — et le hub sait désormais **qui** y est abonné : il liste ses membres,
> abonne une connexion d'office, en éjecte une, et termine le canal pour tous.

## 🧠 Le modèle mental

Un canal ordinaire se remplit par la demande des clients : chaque navigateur envoie `subscribe`, la
politique du canal (rôles, scopes, `allow`) tranche, et le serveur diffuse. Un canal **à membres**
ajoute cinq gestes au serveur, et une règle qui les tient ensemble :

| Geste                                   | Méthode du hub                          | Portée                   |
| --------------------------------------- | --------------------------------------- | ------------------------ |
| Lister les membres                      | `channelMembers(canal)`                 | **ce processus**         |
| Abonner une connexion d'office          | `subscribeConnection(canal, connexion)` | **ce processus**         |
| Éjecter une connexion                   | `evictConnection(canal, connexion)`     | **ce processus**         |
| Éjecter un compte (tous ses onglets)    | `evictUser(canal, compte)`              | **tous les exemplaires** |
| Terminer le canal pour tous ses membres | `closeChannel(canal)`                   | **tous les exemplaires** |

Ce qui désigne une **connexion** reste local : elle n'existe que dans le processus qui tient sa
socket. Ce qui désigne un **nom** — un canal, un compte — traverse les exemplaires par le bus.

**La règle : `allow` est seul juge de qui ENTRE.** Abonner d'office passe par la même politique
qu'un `subscribe` du client, `allow` compris ; éjecter **coupe**, n'exclut pas. Le navigateur
rejoue ses abonnements à chaque reconnexion, et ce rejeu passe par `allow` : un membre imposé que
`allow` ne connaît pas serait éjecté à la première coupure réseau, et un éjecté qu'`allow` connaît
encore reviendrait au rechargement de sa page. L'application écrit donc l'appartenance **là où
`allow` la lit** — une table, un registre partagé — et les gestes du hub ne font que la suivre.

## 📖 Lexique

- **Membre** — une connexion abonnée à un canal par un CLIENT (sa demande, ou une imposition du
  serveur). Les écouteurs et services du serveur ne sont pas des membres.
- **Poignée** (`IRealtimeConnection`) — ce qui désigne une connexion côté serveur : `userId` et
  `open`. Elle n'existe que dans le processus qui tient la socket.
- **Abonnement imposé** — le serveur abonne une connexion qui n'a rien demandé ; le client en est
  averti par `realtime:subscribed { imposed: true }`.
- **Éjection** — retrait d'UNE connexion d'un canal, motif `evicted`. **Fin** — retrait de tous
  les membres, motif `ended`.
- **Instance** — l'occurrence d'un canal à durée de vie, portée par son nom (`game:42:a1b2`).

## 🚀 Démarrage rapide — une partie à quatre

```typescript
// nodefony/controllers/GameRealtimeController.ts
import { controller, route } from "@nodefony/framework";
import { Context } from "@nodefony/http";
import {
  RealtimeChannel,
  RealtimeController,
  RealtimeInbound,
  getRealtimeHub,
} from "@nodefony/realtime";
import type { IRealtimeConnection } from "@nodefony/realtime";

/** Qui joue à quelle partie — en vrai, une table ou un Redis partagé. */
const players = new Map<string, Set<string>>();
/** Parties en cours : une partie finie n'a plus de producteur. */
const running = new Set<string>();

@controller("/rt")
class GameRealtimeController extends RealtimeController {
  constructor(context: Context) {
    super("GameRealtimeController", context);
  }

  @route("game-ws", { path: "/game", requirements: { methods: ["WEBSOCKET"] } })
  async realtime(message: string | Buffer | null): Promise<void> {
    this.handleRealtime(message);
  }

  // `allow` lit l'appartenance : c'est elle qui fait entrer, au premier
  // abonnement comme à chaque reconnexion.
  @RealtimeChannel("game:*", {
    allow: (channel, who) =>
      who.id !== null && (players.get(channel)?.has(who.id) ?? false),
  })
  game(): () => void {
    return () => {};
  }

  // La fabrique d'un canal à durée de vie rend `null` pour une partie finie :
  // c'est elle, et elle seule, qui clôt le canal.
  override createRealtimeChannel(channel: string): (() => void) | null {
    return running.has(channel) ? () => {} : null;
  }

  // Le geste part PAR LA SOCKET : il atteint le processus qui la tient. Le
  // gestionnaire reçoit la connexion en dernier argument.
  @RealtimeInbound("game:join")
  async join(
    _params: unknown,
    _reply: (payload: unknown) => void,
    connection: IRealtimeConnection,
  ): Promise<void> {
    const game = "game:42:a1b2"; // la partie trouvée par la recherche
    if (connection.userId === null) return;
    running.add(game);
    const members = players.get(game) ?? new Set<string>();
    members.add(connection.userId);
    players.set(game, members);
    const joined = await getRealtimeHub().subscribeConnection(game, connection);
    if (!joined) this.log(`partie ${game} refusée`, "INFO");
  }
}

export default GameRealtimeController;

// Fin de partie, depuis n'importe quel service — la fin atteint tous les exemplaires :
export function endGame(game: string): void {
  running.delete(game);
  players.delete(game);
  getRealtimeHub().closeChannel(game);
}
```

Côté navigateur, rien à écrire pour suivre un canal imposé : l'acquittement
`realtime:subscribed { channel, imposed: true }` l'inscrit dans les abonnements du client, qui le
rejoue à la reconnexion comme s'il l'avait demandé. Pour dire la fin à l'écran :

```typescript
import { NodefonySocket } from "nodefony/client";

const socket = new NodefonySocket({ url: "/rt/game" });
socket.on("game:42:a1b2", (state) => console.log("état de la partie", state));
socket.onClosed(({ channel, reason }) => {
  // `ended` : la partie est finie pour tous ; `evicted` : on en a été retiré.
  console.log(
    channel,
    reason === "ended" ? "partie terminée" : "partie quittée",
  );
});
socket.connect().catch(() => {});
```

## 📋 Ce que fait chaque geste

**`subscribeConnection(canal, connexion)`** rend une promesse : `true` une fois l'abonnement acquitté,
`false` sinon — politique refusée, `allow` qui dit non ou ne répond pas dans `allowTimeoutMs`, canal
sans producteur, connexion fermée pendant l'attente, client qui se désabonne avant le verdict. Un
refus n'est rendu **qu'à l'appelant** : le client, qui n'a rien demandé, ne reçoit aucun
`realtime:denied`. Une connexion déjà membre rend `true` sans second acquittement.

**`evictConnection(canal, connexion)`** retire la connexion du canal par le même chemin qu'un
`unsubscribe` (le hub ET l'état de la connexion — jamais un abonné fantôme), lui retire l'admission
de ses trames entrantes sur ce canal, et lui envoie `realtime:closed { reason: "evicted" }`. Les
autres membres restent servis. Le client ne rejoue pas le canal ; une page rechargée, si — et c'est
`allow` qui tranche alors. Sur un canal **sans** `allow`, la politique fixe le laisse rentrer :
**exclure d'un canal sans `allow`, c'est lui en donner un**.

**`evictUser(canal, compte)`** éjecte de la même façon **toutes** les connexions de ce compte membres
du canal — ses onglets, quel que soit l'exemplaire qui les sert. Il rend le nombre de connexions
éjectées **ici** ; les autres exemplaires l'appliquent sans compte rendu. Un compte vide n'éjecte
rien. La même règle vaut : retirer l'appartenance là où `allow` la lit, **puis** éjecter.

**`closeChannel(canal)`** envoie `realtime:closed { reason: "ended" }` à chaque membre, sur tous les
exemplaires, puis libère le producteur. Les écouteurs du serveur (`listen`) restent inscrits, sur un canal redevenu passif. Le
hub ne garde **aucune marque « fermé »** : le `subscribe` suivant rejoue la fabrique, qui rend `null`
pour une instance terminée — le client reçoit `realtime:denied { reason: "unknown" }`. D'où la règle
d'écriture : **le nom d'un canal à durée de vie porte l'identifiant de son instance**
(`game:42:a1b2`, pas `game:42`), pour qu'une partie rouverte ne soit jamais confondue avec celle
qu'on vient de finir.

**`channelMembers(canal)`** rend les connexions abonnées par un client — pas les écouteurs ni les
services du serveur. Chaque poignée porte `userId` (le compte, `null` pour l'anonyme) et `open`.

Un geste qui ne trouve rien rend `false` (ou `0`) : connexion non membre, fermée, ou poignée qui ne
vient pas de ce processus. Jamais un geste muet.

## 🔩 Où c'est fait

- Le registre des membres vit dans l'état du canal, rempli à l'abonnement par
  `RealtimeHub.ts#RealtimeHub.subscribeClient` et vidé par `RealtimeHub.ts#RealtimeHub.unsubscribe` ;
  le fan-out (`RealtimeHub.ts#RealtimeHub.publish`) ne le lit jamais.
- Les cinq gestes : `RealtimeHub.ts#RealtimeHub.channelMembers`,
  `RealtimeHub.ts#RealtimeHub.subscribeConnection`, `RealtimeHub.ts#RealtimeHub.evictConnection`,
  `RealtimeHub.ts#RealtimeHub.evictUser`, `RealtimeHub.ts#RealtimeHub.closeChannel`.
- Les ordres entre exemplaires, en liste fermée : `controlOrder.ts#readControlOrder` (la même garde
  à l'émission et à la réception).
- La poignée : `RealtimeConnection.ts#RealtimeConnection`, créée au premier besoin par le contrôleur.
- Le chemin unique d'une sortie, demandée ou décidée :
  `RealtimeController.ts#RealtimeController.leaveChannel` ; la notification de fin :
  `RealtimeController.ts#RealtimeController.endChannel`.
- Côté navigateur : `NodefonySocket.ts#NodefonySocket.onClosed`.

## ⚠️ Pièges

- **Imposer sans écrire l'appartenance là où `allow` la lit** : l'abonnement tient jusqu'à la
  première coupure réseau, puis le rejeu est refusé. Sur mobile, c'est dans la minute.
- **Éjecter pour exclure** : une page rechargée refait `subscribe`. Retirer l'appartenance d'abord,
  éjecter ensuite.
- **Un nom de canal sans identifiant d'instance** (`game:42`) : la partie suivante portera le même
  nom, et un client resté sur l'ancienne y entrera.
- **Appeler un geste PAR CONNEXION depuis une requête HTTP** en cluster : la connexion est peut-être
  tenue par un autre exemplaire. Passer par la socket, par `allow` (section suivante), ou par un
  geste par NOM (`evictUser`, `closeChannel`), qui atteint tous les exemplaires.
- **Un bus partagé** (Redis mutualisé) : un tiers qui peut y écrire, même sans le secret, peut
  rejouer un ordre d'éjection capté. Sur un canal durable (`chat:general`), il recouperait le compte
  à chaque retour. L'effet reste une coupure, jamais une entrée ; changer le secret du bus rend
  caducs les ordres déjà captés. **Le bus doit être privé.**

## 🌐 Plusieurs exemplaires (pods, `nodefony cluster`)

Une connexion n'existe que dans la mémoire du processus qui a accepté sa socket. Le backplane
transporte les **publications** et deux **ordres** — terminer un canal, éjecter un compte — que
chaque exemplaire applique à SES connexions ; ni membres, ni politiques, ni acquittements. Ces deux
ordres ne font qu'enlever : seul `allow` fait entrer. Livrés « au plus une fois », comme toute
publication : un exemplaire qui en manque un, ou qui démarre après, est rattrapé par `allow` (pour
une éjection) ou par la fabrique qui rend `null` à une instance terminée (pour une fin).

Les gestes **par connexion** agissent sur les connexions de ce processus. Deux voies marchent en
cluster pour eux :

1. **Le geste part par la socket** — un gestionnaire `@RealtimeInbound` reçoit la connexion et
   s'exécute, par construction, sur le processus qui la tient.
2. **Le serveur autorise, le navigateur s'abonne** — une requête HTTP (routée sur n'importe quel
   exemplaire) écrit l'appartenance dans un registre partagé ; le navigateur fait `subscribe`, et
   `allow` lit ce registre **directement**, sans cache : il n'est appelé qu'une fois par abonnement.

Une requête HTTP qui appellerait `subscribeConnection` sur une connexion tenue par un autre
exemplaire n'a pas de poignée à lui passer : elle ne peut rien faire, et c'est voulu — un geste qui
marcherait en développement et une fois sur N en production serait le pire des défauts.

## 🧪 Tests & couverture

- **Serveur** (`channelMembers.test.ts`) : membres listés et retirés à la fermeture de la socket ;
  éjection (l'éjecté n'est plus servi, les autres si ; il rentre sans `allow`) ; imposition depuis un
  gestionnaire entrant, refus de `allow` rendu au seul appelant, connexion fermée ou désabonnée
  pendant l'attente ; fin du canal, producteur libéré, écouteur conservé, fabrique rejouée.
- **Entre exemplaires** (`memberOrdersAcrossPods.test.ts`) : fin et éjection d'un compte données sur
  un hub atteignent les membres de l'autre ; canal de contrôle jamais diffusé ; ordres mal formés,
  inventés ou visant un canal de la plateforme rejetés et comptés (`ingressRejectedTotal`). Sur un
  **Redis réel** (`memberOrdersRedis.test.ts`, gate Redis) : ordre scellé appliqué, ordre non scellé
  ignoré, et le rejeu d'une éjection captée — le risque accepté — décrit par un test. Sur le **bus du
  cluster** (`clusterIpc.e2e.test.ts`, `npm run test:cluster`) : deux vrais processus.
- **Client** (`NodefonySocketClosed.test.ts`) : canal imposé inscrit et rejoué, canal terminé retiré
  pour tous ses consommateurs et jamais rejoué, attente d'acquittement rejetée, trame mal formée
  ignorée.
- **Trames** (`subscribedAck.test.ts`) : l'acquittement imposé est octet pour octet celui du pair
  JSON-RPC. **Surface figée** (`frozenSurface.test.ts`) : les motifs `ended` et `evicted`.

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Realtime — vue d'ensemble](index.md) · [Toute la documentation](../../../../../docs/index.md)
- [Sécurité](./securite.md) — `allow`, sa forme classe, son délai et son budget.
- [Protocole](./protocole.md) — les notifications système de la socket.
- Décisions : ADR-0022 §6 (canaux privés, décisions 2 à 4), ADR-0021 S4 (fin d'un flux).
