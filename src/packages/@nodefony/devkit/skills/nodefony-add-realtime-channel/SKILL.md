---
name: nodefony-add-realtime-channel
description: >
  Ajoute un flux temps réel à une application Nodefony par la bonne couche — un
  `RealtimeController` et ses décorateurs de canal — au lieu de recomposer un WebSocket à la main.
  Porte la façon de fermer un canal à certains rôles, le piège du canal public par défaut, celui
  du canal dont le nom est calculé, et la façade cliente à employer côté navigateur. À charger
  AVANT d'écrire du code WebSocket, un canal, ou un abonnement client.
  Déclencheurs : "flux temps réel", "websocket", "canal", "push", "notifications en direct",
  "abonnement", "RealtimeController", "@RealtimeChannel", "socket client", "temps réel privé",
  "réserver un canal à un rôle", "mon canal est public", "diffuser à plusieurs onglets".
---

# add-realtime-channel — le temps réel par sa couche

> ⚖️ **La confiance n'exclut pas le contrôle.** Un canal sans politique est **public par
> construction** — c'est le comportement voulu du framework, pas un oubli. Ce qui n'est pas
> déclaré fermé est ouvert.

## Le geste

```bash
npx nodefony create controller Ops --kind realtime
```

Produit une sous-classe de `RealtimeController` avec son canal décoré et une action, plus le
câblage. **N'écris pas de `new WebSocket(...)` ni de `ws.on(...)` côté serveur** : le bas niveau
existe, il est employé par le framework, et le reprendre à la main te prive du routage par canal,
de l'authentification partagée avec HTTP, et de la contre-pression.

## Fermer un canal

```ts
@RealtimeChannel("ops:alerts", { roles: ["ROLE_ADMIN"] })
export class OpsController extends RealtimeController {
  @RealtimeAction("ops:snapshot", { roles: ["ROLE_ADMIN"] })
  async snapshot() { … }
}
```

Deux niveaux, et ils sont indépendants : la **politique du canal** décide qui peut s'abonner, la
politique d'une **action** décide qui peut la déclencher. `{ authenticated: true }` suffit quand
aucun rôle particulier n'est requis.

## 🔴 Le piège du canal dont le nom est calculé

Une politique est indexée par le nom **EXACT** du canal. Un canal dont le nom se construit à
l'exécution (`` `room:${id}` ``) **n'est couvert par aucune politique déclarée** — il naît public,
et rien ne le signale.

```ts
@RealtimeChannel("room:lobby", { authenticated: true })   // ✅ couvert
// `room:42` construit à la volée                          // 🔴 PAS couvert
```

Tant qu'un canal à membres n'existe pas dans le framework, le geste montrable est le canal
**gardé** par rôle ou authentification, pas le canal dynamique.

## Côté client — la façade, pas le socket

```ts
import { RealtimeClient } from "nodefony/client";

const client = RealtimeClient.shared();
client.subscribe("ops:alerts", (payload) => { … });
```

En React, les hooks du paquet client font la même chose avec le cycle de vie du composant.
**Importe depuis `nodefony/client`**, jamais depuis la racine `nodefony` : côté navigateur, elle
n'expose pas ces symboles et le compilateur refuse.

## Ne pas ouvrir plus que le canal demandé

Fermer « toute la zone `^/api` » pour protéger un canal emporte le reste de l'application avec
lui — y compris les démonstrations publiques posées par le scaffold. La politique se pose **sur le
canal**, pas sur l'espace HTTP qui l'entoure.

## Prouver

```bash
npm test
npx nodefony inspect routes --json   # les canaux montés, tels que l'application les voit
```

Puis, avec trois identités comme pour une route : un anonyme ne reçoit pas le flux réservé, un
compte sans le rôle non plus, l'administrateur oui — **et le canal public du scaffold répond
toujours** (s'il s'est fermé, une politique a débordé).

## Voisins

| Besoin                         | Skill                    |
| ------------------------------ | ------------------------ |
| Réserver une route HTTP        | `nodefony-protect-route` |
| Une ressource complète stockée | `nodefony-add-crud`      |
| Un service métier injectable   | `nodefony-add-service`   |
