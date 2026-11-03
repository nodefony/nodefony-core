---
name: nodefony-add-realtime-channel
metadata:
  version: 2.1.1
description: >
  Choisit et branche la brique temps réel que Nodefony fournit déjà — canal, entrée client,
  action, canal personnel, canal à membres, flux SSE, contrat typé, octets — au lieu d'un
  WebSocket, d'une liste noire ou d'un contrôle d'accès écrits à la main. Part du besoin (salon
  privé avec exclusion, jeu, sondes, tableau de bord, notification à une personne, tâche longue)
  et mène à la ligne à écrire, à l'exemple installé et à son test. Porte ce qui ne se voit qu'en
  production : plusieurs serveurs, reconnexion, révocation, contre-pression. À charger AVANT
  d'écrire un canal, un abonnement client ou un flux.
  Déclencheurs : "temps réel", "websocket", "canal", "push", "notifications en direct",
  "abonnement", "salon privé", "exclure un membre", "réserver un canal à un rôle", "mon canal
  est public", "prévenir un utilisateur", "progression d'une tâche", "SSE", "EventSource",
  "réponse en streaming", "contrat temps réel", "-32601", "CBOR",
  "Uint8Array", "ça marche en local, plus en cluster", "l'exclu revient".
---

# add-realtime-channel — le temps réel par sa brique

> 🧭 **Arrivé ici directement ? Charge aussi `nodefony-dev`** : il porte la conduite commune (par
> où commencer, comment prouver, les pièges du serveur et du front). Cette page ne couvre QUE le
> temps réel.
>
> Les pages de référence sont INSTALLÉES (`rg` ne descend pas dans `node_modules`). Une commande
> les trouve et rend leur chemin — **exécute-la, puis lis la page** :
>
> ```bash
> node node_modules/@nodefony/devkit/skills/nodefony-dev/scripts/docs.mjs --open cas-d-usage
> node node_modules/@nodefony/devkit/skills/nodefony-dev/scripts/docs.mjs salon allow evict
> ```

> ⚖️ **La confiance n'exclut pas le contrôle.** Un **canal** sans politique est public par
> construction ; une **action** sans politique est fermée (connexion authentifiée exigée). Ce qui
> n'est pas déclaré n'est pas gardé — et ce que le framework porte déjà ne se réécrit pas.

## 1. Quel besoin → quelle brique

Lis la ligne qui ressemble à ton besoin, écris ce qu'elle dit, puis ouvre la page citée. Pour
chaque cas, `cas-d-usage.md` montre trois fichiers — le serveur, le navigateur, le test —
exécutés par la suite du framework : **copie le test avec le serveur**.

| Je veux…                                                      | La brique (et rien d'autre)                                                                                          | Page installée                         |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| pousser un flux que des écrans lisent                         | `@RealtimeChannel("nom")` ; un seul producteur par canal et par serveur, créé au premier abonné                      | `cas-d-usage.md` (tableau de bord)     |
| le réserver à un rôle                                         | `@RealtimeChannel("nom", { roles: ["ROLE_X"] })`                                                                     | `securite.md`                          |
| une famille de canaux (`room:<id>`, `task:<id>`)              | motif `"room:*"` + `createRealtimeChannel()` qui sert (ou refuse, `null`) chaque nom                                 | `securite.md` (nom exact vs dérivés)   |
| **ce compte-là et lui seul** (salon privé, invitation)        | `allow: (channel, who) => …` sur le motif — l'appartenance vit en base, `allow` la lit                               | `cas-d-usage.md` (salon privé)         |
| exclure quelqu'un, pour de bon                                | retirer l'appartenance (`allow` dira non), PUIS `getRealtimeHub().evictUser(canal, id)` — jamais de liste noire      | `canaux-a-membres.md`                  |
| placer quelqu'un dans un canal sans qu'il s'abonne            | `getRealtimeHub().subscribeConnection(canal, connection)` depuis une entrée client, après avoir écrit l'appartenance | `cas-d-usage.md` (recherche de partie) |
| prévenir UNE personne, tous ses onglets, tous les serveurs    | `getRealtimeHub().publishToUser(id, charge)` / `socket.onUser(h)` — rien à déclarer                                  | `cas-d-usage.md` (notification)        |
| suivre une tâche longue (agent, export)                       | le serveur nomme `task:<uuid>`, impose l'abonnement, publie, puis `closeChannel()` → `ended`                         | `cas-d-usage.md` (tâche d'agent)       |
| recevoir ce que le client pousse (coups de jeu, mesures)      | `@RealtimeInbound("game:move", politique)` — `params` non fiable, `connection.userId` = l'auteur                     | `cas-d-usage.md` (jeu, sondes)         |
| un appel avec réponse (un devis, un historique)               | `@RealtimeAction("x:y")` (fermée par défaut) — ou une ROUTE appelée par `socket.post()` si ça change un état         | `actions.md`                           |
| le serveur pousse, le client écoute, sur UNE requête          | `this.renderSse()` dans une action ordinaire ; `new NodefonySse(url)` côté client                                    | `http/docs/sse.md`                     |
| typer les deux bouts une fois                                 | `interface C extends IRealtimeContract` + `NodefonySocket.fromContract<C>()` + `ContractRealtimeController<C>`       | `actions.md` (contrat)                 |
| des octets (document partagé, audio, image, mesures binaires) | `use("@nodefony/realtime", { codec: "cbor" })` et `Uint8Array` dans la charge — même canal, mêmes gardes             | `references/binaire.md`                |
| ça marche avec deux onglets, plus en cluster                  | `@RealtimeBroadcast("prefix:")` sur la classe (défaut : un canal reste sur son serveur)                              | `references/production.md`             |

Les chemins complets : `node_modules/@nodefony/realtime/docs/<page>.md`,
`node_modules/@nodefony/http/docs/sse.md`, `node_modules/nodefony/docs/client.md`.

**Canal ou route ?** Le canal porte les FLUX (diffusés, éphémères, attribués par l'identité de la
connexion). Un GESTE qui change un état (envoyer un message conservé, payer, inviter) est une
**route** `POST` avec `@IsGranted` et `@Idempotent`, que le navigateur appelle par
`socket.post("/chemin", corps)` : identité revérifiée à chaque appel, validation, rejeu sans
doublon. Détail : `actions.md` (« Le pont API »).

## 2. Le geste

```bash
npx nodefony create controller Room --kind realtime
```

Produit une sous-classe de `RealtimeController`, avec un canal de démonstration, une action, une
entrée client, et **son test** (`createRealtimeHarness`). Nomme le contrôleur par son USAGE
(`RoomChat`, `Arena`), pas par une entité : `create entity Room` après `create controller Room`
est refusé (nom déjà référencé). Une application générée sert déjà `/api/live/realtime`
(`LiveController`, canal `live:events`) : c'est le canal public témoin, il doit continuer de
répondre après ta modification.

**Le client ouvre la socket du contrôleur qui DÉCLARE ses canaux** — `/api/room/realtime` pour
`create controller Room`. Une socket ne sert que les canaux de SON contrôleur : ouvert sur
`/api/live/realtime`, `room:42` est refusé (`unknown`). Pour une seule socket par page, regroupe
les canaux dans un même contrôleur ; seul `user:<id>` est fourni par toutes.

**N'écris ni `new WebSocket(...)` côté serveur, ni `ws.on(...)`, ni un `WebSocketServer`** : le
bas niveau existe, le framework l'emploie ; le reprendre te prive du routage par canal, de
l'identité partagée avec HTTP, de la reconnexion et de la contre-pression.

**Si tu retires ou renommes le canal de démonstration du contrôleur généré, adapte son test dans
la foulée** — ne laisse pas un banc rouge que tu finirais par ignorer.

## 3. Les quatre mots du serveur

```ts
import type { ContextType } from "@nodefony/http";
import {
  RealtimeAction,
  RealtimeChannel,
  RealtimeController,
  RealtimeInbound,
  getRealtimeHub,
} from "@nodefony/realtime";
import type { IRealtimeConnection } from "@nodefony/realtime";
import { CurrentUser } from "@nodefony/framework";
import type { IUser } from "@nodefony/user";

export class OpsRealtime extends RealtimeController {
  constructor(context: ContextType) {
    super("OpsRealtime", context);
  }

  // CANAL (flux serveur → abonnés) : la fabrique rend le nettoyage. Un seul producteur
  // par canal et par serveur, partagé entre connexions : ne capture jamais `this.context`.
  @RealtimeChannel("ops:alerts", { roles: ["ROLE_ADMIN"] })
  alerts(): () => void {
    return () => {};
  }

  // ENTRÉE (le client pousse, sans réponse) : `params` vient du réseau, valide-le ;
  // l'auteur est `connection.userId`, jamais un champ de la charge.
  @RealtimeInbound("ops:ack", { authenticated: true })
  ack(params: unknown, _reply: unknown, connection: IRealtimeConnection): void {
    if (connection.userId === null || !isAck(params)) return;
    getRealtimeHub().publish("ops:alerts", {
      acked: params.id,
      by: connection.userId,
    });
  }

  // ACTION (appel avec réponse) : FERMÉE par défaut ; `@CurrentUser()` comme sur une route.
  @RealtimeAction("ops:whoami")
  whoami(@CurrentUser() user: IUser): { identifier: string } {
    return { identifier: user.identifier };
  }
}

function isAck(v: unknown): v is { id: string } {
  return (
    typeof v === "object" && v !== null && "id" in v && typeof v.id === "string"
  );
}
```

- **Publier depuis n'importe où** (service, tâche, minuteur, boucle de jeu) :
  `getRealtimeHub().publish(canal, charge)`. La charge est un objet, un tableau, des octets ou
  rien — **un scalaire lève** (`publish("c", 42)` → `TypeError`) : écris `{ value: 42 }`.
- **Un canal au nom calculé ne se publie pas par la variable `publishToChannel` du contrôleur
  généré** (elle ne sert qu'un nom exact) : `getRealtimeHub().publish(\`room:${id}\`, charge)`.
- **État ou événement ?** Une position, une jauge : seule la dernière valeur compte — garde-la et
  diffuse au rythme du serveur (`setInterval`, `unref()`), jamais à chaque réception. Un message
  de chat : chacun compte — persiste-le AVANT de le publier.
- **Une famille de canaux** (`room:*`) : le décorateur ne sert que le nom EXACT. Ajoute
  `override createRealtimeChannel(channel) { return exists(channel) ? () => {} : null; }` ;
  `null` = canal inconnu, le client reçoit `realtime:denied { reason: "unknown" }`. Un canal à
  durée de vie porte l'identifiant de son instance dans son nom (`game:42:a1b2`), et la fabrique
  rend `null` une fois l'instance finie.

## 4. Qui a le droit — la politique, et ce qu'elle ne couvre pas

Politique = `{ authenticated?, roles?, scopes?, allow?, anonymous? }` — toute autre clé est
refusée au démarrage. Les clés se cumulent. Un rôle dit **qui est connecté** ; `allow` dit **ce
compte sur ce canal**.

```ts
// L'appartenance vit en base (entité générée) ; `allow` la lit UNE fois, au `subscribe` —
// et à chaque reconnexion, puisque le navigateur rejoue ses abonnements.
@RealtimeChannel("room:*", {
  allow: async (channel, who) =>
    who.id !== null &&
    (await getRoomMemberService().findOne({ room: channel.slice("room:".length), user: who.id })) !==
      null,
})
room(): () => void {
  return () => {};
}

// 🔴 Le motif pose la POLITIQUE de toute la famille, pas la FABRIQUE : sans celle-ci,
// `room:42` est refusé (`realtime:denied { reason: "unknown" }`).
override createRealtimeChannel(channel: string): (() => void) | null {
  return channel.startsWith("room:") ? () => {} : null;
}
```

- `who` est une donnée plate (`id`, `authenticated`, `roles`, `scopes`, `issuer`, `account`) :
  `allow` ne lit **que ses arguments** — ni contexte de requête, ni session. Seul `=== true`
  admet ; lever ou rejeter = `forbidden` ; trop lent = `unavailable` (le client réessaie seul).
  Dès que la règle lit la base par des services, écris-la en **classe `@injectable`** résolue au
  démarrage (`securite.md`, « forme longue ») : une dépendance absente y refuse le démarrage en
  nommant la classe, au lieu de refuser tous les abonnés sans un mot.
- **Lire l'appartenance** : `getXxxService()` est l'accesseur que `create entity Xxx` a généré ;
  une colonne de référence se filtre par l'identifiant de la cible
  (`findOne({ room: roomId, user: who.id })`). N'invente ni service, ni injection, ni `as never`.
- **Exclure** = retirer l'appartenance, PUIS `getRealtimeHub().evictUser(canal, who.id)` (tous ses
  onglets, tous les serveurs ; `realtime:closed { reason: "evicted" }`). L'éjection seule ne
  suffit pas : son navigateur rejoue `subscribe` au rechargement, et `allow` tranche alors. Une
  liste noire à côté d'`allow` diverge en silence : interdit.
- **Le modérateur est un attribut d'appartenance** (`RoomMember.role`), pas un rôle global de
  l'application. Et l'entité d'appartenance se génère **sans ressource REST** (`--no-controller`) :
  un CRUD ouvert laisserait chacun s'inviter lui-même.
- **Une entrée ou une action n'hérite PAS de la politique du canal.**
  `@RealtimeInbound("room:send")` porte la sienne, et vérifie l'appartenance avec
  `connection.userId` par le MÊME registre qu'`allow` — ou devient une route `POST` (§1).
- **Le nom exact l'emporte sur le motif, et le remplace EN ENTIER** : une politique
  `@RealtimeChannel("room:lobby", { authenticated: true })` ouvre `room:lobby` à tout compte
  connecté malgré l'`allow` de `room:*`.
- **`user:<id>` est fourni** : politique intégrée (compte connecté, son propre id seulement),
  diffusé entre serveurs, rien à déclarer. N'écris jamais de politique sur `user:…`.
- **Ne ferme pas la zone pour fermer un canal.** La politique se pose sur le canal ; une zone
  `^/api` privée de `"anonymous"` emporte le reste de l'application, démonstrations et tests
  fournis compris. Réserver une route : skill `nodefony-protect-route`.
- **Condition d'activation** : rôles, portées et `authenticated` ne sont appliqués que si
  `@nodefony/security` est chargé avec une zone qui couvre la socket (`realtime: true`, défaut).
  Sinon le serveur l'écrit en WARNING au premier handshake. `allow` s'applique toujours.
- La configuration de sécurité `realtimeChannels: [{ pattern: "room:", roles: […] }]` durcit une
  famille sans toucher au code ; elle n'exprime jamais l'appartenance. Ne simule jamais un salon
  privé par un nom de canal difficile à deviner.

## 5. Côté client — la façade, jamais le socket nu

```ts
import { NodefonySocket } from "nodefony/client";

// La socket du contrôleur qui DÉCLARE ces canaux (`create controller Ops` → `/api/ops/realtime`).
const socket = NodefonySocket.shared({ url: "/api/ops/realtime" }); // UNE socket par URL
socket.subscribe("ops:alerts"); // DEMANDE le flux (rejoué à chaque reconnexion)
socket.on("ops:alerts", (alert) => render(alert)); // REÇOIT ; deux gestes distincts
socket.emit("ops:ack", { id: "a1" }); // entrée client, sans réponse
const me = await socket.request("ops:whoami"); // action, avec réponse (30 s)
socket.onDenied(({ channel, reason }) => {}); // forbidden | limit | unknown | unavailable
socket.onClosed(({ channel, reason }) => {}); // ended | evicted — le client ne rejoue pas
await socket.whenSubscribed("ops:alerts"); // avant de charger l'état initial
socket.onUser((note) => {}); // les messages adressés à CE compte
```

- **Importe de `nodefony/client`**, jamais de la racine `nodefony` dans un bundle navigateur ;
  `nodefony/realtime` n'existe pas.
- `shared()` sans `url` lève ; les options ne comptent qu'à la PREMIÈRE création (codec compris).
- Vues : `nodefony/react` (`<NodefonyProvider url="…">`, `useNodefony()`,
  `useNodefonyChannelData(socket, "canal", initial)`, `useNodefonyChannel(socket, "canal", h)`),
  mêmes noms en `nodefony/vue`. Un composant monte et démonte son abonnement ; la socket
  appartient à la page. Détail : `node_modules/nodefony/docs/client.md`.
- Le navigateur ne voit un refus de handshake (401/403) que comme une coupure : la socket sonde
  l'adresse en HTTP et s'arrête d'elle-même ; tu n'as rien à écrire.

## 6. SSE ou socket ?

| Besoin                                                               | Choisir                                     |
| -------------------------------------------------------------------- | ------------------------------------------- |
| Le serveur pousse sur UNE requête (progression, réponse d'un modèle) | **SSE** — une réponse HTTP qui ne finit pas |
| Un réseau d'entreprise bloque les WebSocket                          | **SSE** — c'est une réponse HTTP ordinaire  |
| Deux sens, canaux, plusieurs onglets, identité par connexion         | **socket** — le reste de cette page         |

```ts
@route("progress-run", { path: "/run" })
async run() {
  const sse = await this.renderSse(); // en-têtes, battement, contre-pression
  await sse.send({ step: "calcul" }, { event: "step" });
  return sse.close();
}
```

`this.acceptsSse()` laisse la même route répondre en JSON ou en flux. Client :
`new NodefonySse(url)` (`nodefony/client`), liaison `useNodefonySse`. **N'écris jamais
`Content-Type: text/event-stream` à la main** : tu perdrais le battement qui empêche un proxy de
couper, et la contre-pression (`await sse.send()` freine si le client lit lentement). Un flux SSE
n'est pas un canal : il n'est pas gardé par une politique de canal, mais par la zone et
`@IsGranted` de sa route. Détail : `node_modules/@nodefony/http/docs/sse.md`.

## 7. Un contrat, déclaré UNE fois

Dès que navigateur et serveur échangent plus qu'un canal : sans contrat, chaque côté type ce qu'il
envoie, jamais ce que l'autre implémente — une méthode oubliée compile puis rend `-32601`.

```ts
// shared/ops.ts — types SEULS : 0 octet compilé, aucun import de code serveur
import type { IRealtimeContract } from "nodefony/client";

export interface OpsContract extends IRealtimeContract {
  serverToClient: { "ops:alerts": { level: string; at: Date } };
  clientToServer: { "ops:ack": { id: string } };
  serverMethods: {
    "ops:mute": { in: { id: string }; out: { muted: boolean } };
  };
}
```

```ts
// navigateur
const ops = NodefonySocket.fromContract<OpsContract>({
  url: "/api/ops/realtime", // la socket d'OpsRealtime, qui sert ces canaux
});
ops.on("ops:alerts", (a) => a.at); // `string` : ce que JSON fait d'une Date
```

```ts
// serveur — le contrat s'écrit UNE fois, sur `extends` ; la table sert SEULE les méthodes
@RealtimePolicy({ "ops:mute": { roles: ["ROLE_OPS"] } })
class OpsRealtime extends ContractRealtimeController<OpsContract> {
  protected override realtimeActions() {
    return { "ops:mute": (p: { id: string }) => ({ muted: p.id.length > 0 }) }; // une oubliée ne compile pas
  }
}
```

- N'ajoute pas `@RealtimeAction` à une méthode de la table ; la politique va sur la classe par
  `@RealtimePolicy` (un nom hors contrat ne compile pas). Sans `serverMethods`, rien à écrire.
- Diffuser : `getRealtimeHub<OpsContract>().publish(canal, charge)` — nom et charge vérifiés ; une
  fabrique de canal déclare `publish: ContractRealtimePublish<OpsContract>` ; le flux SSE lit la
  même carte (`this.renderSse<ContractServerEmit<OpsContract>>()`).
- Routes du pont : clé `serverRoutes` → le client appelle `ops.post("/ops/mute", corps)`.
- **Le type n'est pas une validation** : la politique reste la seule garde.

## 8. Ce qui ne se voit qu'en production — lis-le avant de dire « fait »

Résumé ; chaque ligne est détaillée dans [`references/production.md`](references/production.md).

- **Plusieurs serveurs** : un canal reste sur son serveur tant que sa classe ne porte pas
  `@RealtimeBroadcast("prefix:")` — sur TOUS les serveurs, pas seulement l'émetteur. L'application
  générée tourne en `backplane.driver: "cluster"` : deux onglets sur un seul processus ne prouvent
  rien. La sonde compte l'oubli (`localOnlyTotal`). `user:` est diffusé par le framework.
- **Reconnexion** : le client rejoue ses abonnements au `welcome` — pas les messages manqués. Une
  discussion se reprend par une route (`GET …/history?since=`) ; déduplique sur l'identifiant
  persistant.
- **Aucune garantie de livraison** : au plus une fois, un trou jamais réordonné. Une alarme qui ne
  doit pas se perdre porte son identifiant dans la charge, un accusé, une réémission applicative.
- **Révocation** : une socket survit à sa session jusqu'à la revalidation (30 s). Rôles changés →
  `4005` (revient aussitôt, lis `onIdentity`) ; session morte → `4001` ; jeton porteur expiré →
  `4006` (définitif : recrée la socket avant `exp`). Compare aux constantes de `nodefony`, jamais
  aux nombres.
- **Contre-pression** : un client lent est jeté puis fermé (`1013`) par le serveur (`websocket` ET
  `websocketSecure` de `@nodefony/http`) ; `drop` ne trie pas. Côté navigateur, `maxBufferedAmount`
  jette un coup périmé au lieu de l'empiler (jeu, capteur).
- **`allow` lent** : `unavailable`, réessayé 3 fois par le client ; en rafale au redémarrage
  (N clients × M canaux). Un bus partagé doit être **privé** (un ordre d'éjection capté se rejoue).

## 9. Des octets dans un canal

Côté serveur, une ligne : `use("@nodefony/realtime", { codec: "cbor" })`. Sans elle, un
`Uint8Array` part en `{"0":1,…}` **sans erreur**. Côté navigateur, offre le codec à la PREMIÈRE
création : `NodefonySocket.shared({ url, codec: CBOR_FRAME_CODEC })` (`nodefony/cbor`). Les octets
passent par `publish` / `on(canal)` sous les mêmes politiques ; `onRealtimeBinary()` est **hors des
gardes**. Mise en place, messages d'erreur, ce qui rate sans message :
[`references/binaire.md`](references/binaire.md) — à lire AVANT la première ligne.

## 10. Prouver

```bash
npm test
npx nodefony inspect routes --json
```

Le harnais parle le protocole sans serveur ni navigateur ; chaque cas de `cas-d-usage.md` en
montre un test complet. Le patron :

```ts
import { getRealtimeHub } from "@nodefony/realtime";
import { createRealtimeHarness } from "@nodefony/realtime/testing";
import {
  createTestFrameAuthorizer,
  createTestIdentity,
} from "@nodefony/security/testing";

const bob = createRealtimeHarness((ctx) => new RoomRealtime(ctx), {
  identity: createTestIdentity({ identifier: "bob" }), // `who.id` = "bob" ; `id:` pour une clé distincte
  frameAuthorizer: createTestFrameAuthorizer(getRealtimeHub()), // le VRAI verrou : sans lui, `roles` n'est pas jugé
});
await bob.connect();
await bob.subscribe("room:7"); // acquitté : `bob.subscriptions()` ; refusé : `bob.denials()`
await bob.notify("room:send", { room: "room:7", text: "salut" }); // entrée client
bob.messages("room:7"); // ce qu'il a reçu, dans l'ordre
bob.received.filter((f) => f.method === "realtime:closed"); // evicted | ended
bob.dispose();
```

- Sans `identity` : connexion **anonyme**. Plusieurs harnais sur le même hub : `resetHub` au
  premier seulement — c'est ainsi qu'on éprouve qu'une publication atteint l'un et pas l'autre.
- **Vois le test rouge une fois** : retire `allow` (ou `roles`), l'intrus doit entrer ; remets-le.
- L'exclusion se prouve : exclu → `realtime:closed evicted`, puis un nouveau `subscribe` refusé.
  Un refus opposé à quelqu'un qui n'a jamais été membre ne prouve PAS l'exclusion.
- **`allow` lit la base ? Le test l'amorce** — c'est la recette du test que `create entity` a
  écrit à côté de chaque entité (`tests/<entité>.test.ts`), avec deux écarts :

  ```ts
  import { DrizzleOrm, seedEntityRow } from "@nodefony/drizzle";
  import { entityRegistry, ormRegistry } from "@nodefony/orm-core";

  const CONNECTOR = "default"; // celui de l'APPLICATION : `getRoomMemberService()` le lit
  for (const e of [UserEntity, RoomEntity, RoomMemberEntity]) {
    entityRegistry.register({ ...e, connector: CONNECTOR });
  }
  const orm = new DrizzleOrm(CONNECTOR, { filename: ":memory:" });
  await orm.connect();
  // Les PARENTS d'abord : une clé étrangère inventée est refusée par la base.
  const bobId = String(
    await seedEntityRow(orm, { ...UserEntity, connector: CONNECTOR }),
  );
  const room = String(
    await seedEntityRow(orm, { ...RoomEntity, connector: CONNECTOR }),
  );
  await getRoomMemberService().create({ room, user: bobId, role: "member" });
  // `who.id` = l'identifiant EN BASE :
  createTestIdentity({ identifier: "bob", id: bobId });
  // afterAll : orm.disconnect(), entityRegistry.unregister(nom, CONNECTOR), ormRegistry.unregister(CONNECTOR)
  ```

  Écart 1 : le connecteur s'appelle `default`, pas `test-<entité>` — sinon l'accesseur du
  service ne trouve aucune base. Écart 2 : `FOREIGN KEY constraint failed` = un parent non semé,
  jamais une raison de retirer le test. Exemple exécuté complet : `cas-d-usage.md` (salon privé).

- **Et le canal public témoin répond toujours** (`live:events` d'une application générée) : s'il
  s'est fermé, une politique ou une zone a débordé.
- La santé en marche : `GET /nodefony/realtime/api/health` (rôle d'administration) —
  `publishTotal` qui monte sans `fanoutTotal` = tu publies dans le vide (nom mal orthographié).

## 11. Voisins

| Besoin                                                   | Skill                    |
| -------------------------------------------------------- | ------------------------ |
| Réserver une route HTTP, une page                        | `nodefony-protect-route` |
| Une ressource complète stockée (l'entité d'appartenance) | `nodefony-add-crud`      |
| Un service métier injectable (la classe d'admission)     | `nodefony-add-service`   |
| Voir l'écran, piloter une socket depuis la page          | `nodefony-browser`       |
| Un canal qui répondait ne répond plus                    | `nodefony-troubleshoot`  |
