---
name: nodefony-add-realtime-channel
description: >
  Ajoute un flux temps réel à une application Nodefony par la bonne couche — un
  `RealtimeController` et ses décorateurs de canal — au lieu de recomposer un WebSocket à la main.
  Porte la façon de fermer un canal à certains rôles, le piège du canal public par défaut, celui
  du canal dont le nom est calculé, et la façade cliente à employer côté navigateur. À charger
  AVANT d'écrire du code WebSocket, un canal, ou un abonnement client.
  Dit aussi quand un flux SSE suffit, et sa façade, et comment typer les deux bouts par un
  contrat déclaré une fois.
  Déclencheurs : "flux temps réel", "websocket", "canal", "push", "notifications en direct",
  "abonnement", "RealtimeController", "@RealtimeChannel", "socket client", "temps réel privé",
  "réserver un canal à un rôle", "mon canal est public", "diffuser à plusieurs onglets",
  "SSE", "server-sent events", "EventSource", "barre de progression", "réponse en streaming",
  "typer les canaux", "contrat temps réel", "action introuvable -32601".
---

# add-realtime-channel — le temps réel par sa couche

> 🧭 **Tu es arrivé ici directement ? Charge aussi `nodefony-dev`** — il porte la conduite
> commune (par où commencer, comment prouver que c'est fait) et les pièges qui coûtent une heure,
> serveur comme front. Cette page-ci ne couvre QUE son geste.
>
> Et si une réponse te manque, elle est probablement INSTALLÉE : `rg` ne descend pas dans
> `node_modules`, donc 70 pages de documentation y paraissent absentes. Une commande les lit, avec
> la ligne exacte :
> `node node_modules/@nodefony/devkit/skills/nodefony-dev/scripts/docs.mjs <termes>`.

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

## WebSocket, ou un simple flux SSE ?

| Besoin                                                         | Choisir                                     |
| -------------------------------------------------------------- | ------------------------------------------- |
| Le serveur pousse, le client écoute (progression, journal)     | **SSE** — une réponse HTTP qui ne finit pas |
| La réponse d'UNE requête arrive par morceaux (modèle, export)  | **SSE** sur cette requête                   |
| Échange dans les deux sens, canaux, état partagé entre onglets | **WebSocket** — le reste de cette page      |

SSE n'est pas une route d'un genre particulier : l'action d'une route ordinaire choisit de
répondre en flux.

```ts
@route("progress-run", { path: "/run" })
async run() {
  const sse = await this.renderSse();          // en-têtes, battement, contre-pression
  await sse.send({ step: "calcul" }, { event: "step" });
  return sse.close();
}
```

`this.acceptsSse()` dit si le client a demandé `text/event-stream` (une même route peut répondre
en JSON ou en flux). Côté navigateur, `new NodefonySse(url)` (`nodefony/client`), qui se lit comme
`EventSource` ; les liaisons de front existent comme pour la socket. **N'écris jamais
`Content-Type: text/event-stream` à la main** : tu perdrais le battement qui empêche un proxy de
couper la connexion, et la contre-pression (`await sse.send()` freine si le client lit lentement).
Détail : `node_modules/@nodefony/http/docs/sse.md`.

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

La politique d'un `@RealtimeChannel` est indexée par le nom **EXACT** du canal. Un canal dont le
nom se construit à l'exécution (`` `room:${id}` ``) **n'est couvert par aucun décorateur** — il
naît public, et rien ne le signale.

```ts
@RealtimeChannel("room:lobby", { authenticated: true })   // ✅ couvert
// `room:42` construit à la volée                          // 🔴 PAS couvert par le décorateur
```

La parade est une règle **par préfixe** dans la configuration de sécurité, qui garde à la fois
les canaux ET les actions dont le nom commence ainsi :

```ts
use("@nodefony/security", {
  realtimeChannels: [
    { pattern: "room:", authenticated: true, roles: ["ROLE_USER"] },
  ],
});
```

Elle exprime une classe d'identité (connecté, rôles), jamais une liste de membres : « seuls les
participants de la salle 42 » ne s'écrit pas encore dans le framework. Ne le simule pas avec un
nom de canal difficile à deviner.

## Savoir QUI appelle une action

Les paramètres décorés d'une route valent aussi dans une `@RealtimeAction` : `@Body("clé")` lit la
charge de l'appel, `@CurrentUser()` l'utilisateur de la connexion (`undefined` pour un anonyme).
L'auteur d'un message se prend là, côté SERVEUR — jamais dans la charge, où le client peut mentir.

```ts
@RealtimeAction("chat:send")
send(@Body("text") text: string, @CurrentUser() user: IUser) {
  return { author: user.identifier, text };
}
```

## Côté client — la façade, pas le socket

```ts
import { NodefonySocket } from "nodefony/client";

const client = NodefonySocket.shared({ url: "/api/live/realtime" });
client.subscribe("ops:alerts", (payload) => { … });
```

L'adresse est **obligatoire** : `shared()` sans `url` lève une erreur, parce que la route dépend de
l'application. Une application générée monte `/api/live/realtime`.

En React, les hooks du paquet client font la même chose avec le cycle de vie du composant.
**Importe depuis `nodefony/client`**, jamais depuis la racine `nodefony` : côté navigateur, elle
n'expose pas ces symboles et le compilateur refuse.

## Typer les deux bouts — un contrat, déclaré UNE fois

Dès que le navigateur et le serveur échangent plus qu'un canal, déclare un **contrat** : sans lui,
chaque côté type ce qu'il envoie, jamais ce que l'autre implémente — une action oubliée ou de
forme fausse compile, puis rend `-32601` en production.

```ts
// shared/ops.ts — types SEULS : 0 octet compilé, le navigateur n'importe aucun code serveur
import type { IRealtimeContract } from "nodefony/client";

export interface OpsContract extends IRealtimeContract {
  serverToClient: { "ops:alerts": { level: string; at: Date } }; // poussé par le serveur
  clientToServer: { "ops:ack": { id: string } }; // envoyé par le client
  serverMethods: {
    "ops:mute": { in: { id: string }; out: { muted: boolean } };
  };
}
```

```ts
// navigateur — la porte du client
const ops = NodefonySocket.fromContract<OpsContract>({
  url: "/api/live/realtime",
});
ops.on("ops:alerts", (a) => a.at); // `string` : ce que JSON fait d'une Date
```

```ts
// serveur — la porte du serveur ; le contrat s'écrit UNE fois, sur `extends`
@RealtimePolicy({ "ops:mute": { roles: ["ROLE_OPS"] } })
class OpsRealtime extends ContractRealtimeController<OpsContract> {
  protected realtimeActions() {
    // TOUTES les méthodes du contrat : une oubliée ne compile pas
    return { "ops:mute": (p: { id: string }) => ({ muted: p.id.length > 0 }) };
  }
}
```

- **La table de `realtimeActions()` sert SEULE les méthodes** : n'ajoute pas `@RealtimeAction` à
  une méthode qu'elle sert déjà (un handler fabriqué puis écrasé à chaque connexion, et
  `@Body` ignoré). La politique se pose sur la classe, par `@RealtimePolicy` ; un nom hors
  contrat y est refusé à la compilation.
- **Un contrat sans `serverMethods`** (tableau de bord) : `realtimeActions() { return {}; }`.
- **Le flux SSE lit la même carte** : `this.renderSse<ContractServerEmit<OpsContract>>()`.
- **Le type n'est pas une validation** : les entrées restent non fiables, la politique de canal
  reste la seule garde.

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
