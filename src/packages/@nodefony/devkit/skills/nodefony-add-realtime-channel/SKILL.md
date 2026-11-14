---
name: nodefony-add-realtime-channel
metadata:
  version: 3.1.0
description: >
  Branche le temps réel d'une application Nodefony par ses briques — canal, route appelée par la
  socket, entrée client, action, canal personnel, flux SSE, contrat typé — au lieu d'un WebSocket
  ou d'un contrôle d'accès écrits à la main. Part du besoin (chat, salon privé, jeu, sondes,
  notification, tâche longue), mène à la ligne, à l'exemple exécuté et à son test, dit qui a le
  droit de LIRE et d'ÉCRIRE, et porte la production : plusieurs serveurs, reconnexion,
  redéploiement, révocation. À charger AVANT d'écrire un canal, un abonnement ou un flux. Qui est
  en ligne → `nodefony-add-realtime-presence` ; des octets → `nodefony-add-realtime-binary`.
  Déclencheurs : "temps réel", "websocket", "canal", "push", "chat", "salon privé", "exclure un
  membre", "l'exclu revient", "réserver un canal à un rôle", "mon canal est public", "prévenir un
  utilisateur", "progression d'une tâche", "SSE", "tableau de bord en direct", "-32601", "ça marche en
  local, plus en cluster", "le canal ne répond jamais".
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
> node node_modules/@nodefony/devkit/skills/nodefony-dev/scripts/docs.mjs --open cookbook-chat
> node node_modules/@nodefony/devkit/skills/nodefony-dev/scripts/docs.mjs salon allow evict
> ```

> ⚖️ **La confiance n'exclut pas le contrôle.** Un **canal** sans politique est public par
> construction ; une **action** sans politique est fermée (connexion authentifiée exigée). Ce qui
> n'est pas déclaré n'est pas gardé — et ce que le framework porte déjà ne se réécrit pas.

> **Maintenance** : vérité courante, jamais un journal. Éditer en place ; historique = `git log`.
> Chaque bloc de code est un EXTRAIT d'un fichier exécuté par la suite du framework (marqueur
> `excerpt`) : un test refuse qu'il en diverge. Une page installée en montre le fichier entier.
>
> **La démo** (première implémentation complète, chat compris) : dans ton application si elle a été
> créée avec la démo, sinon ses gabarits sous `node_modules/nodefony/templates/demo/` (fichiers
> `.tpl`, lisibles tels quels) — le chat : `server/nodefony/controllers/ChatController.ts.tpl`.

## 1. Quel besoin → quelle brique

| Je veux…                                                    | La brique (et rien d'autre)                                                                                          | Où le voir                                                                               |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| un **chat** : des messages gardés, des salons, des droits   | lire par un **canal**, écrire par une **route** appelée par la socket (§3)                                           | `cookbook-chat.md`, le chat de la démo                                                   |
| pousser un flux que des écrans lisent                       | `@RealtimeChannel("nom")` ; un producteur par canal et par serveur, créé au premier abonné                           | `cas-d-usage.md` (tableau de bord)                                                       |
| le réserver à un rôle                                       | `@RealtimeChannel("nom", { roles: ["ROLE_X"] })`                                                                     | `securite.md`                                                                            |
| une famille de canaux (`room:<id>`, `task:<id>`)            | motif `"room:*"` — il sert chaque nom ; `createRealtimeChannel()` seulement pour FILTRER (`null` = refus)            | §4                                                                                       |
| **ce compte-là et lui seul** (salon privé, invitation)      | `allow` sur le motif, écrit en **classe d'admission** qui lit la base (§5)                                           | `cas-d-usage.md` (salon privé : son ADMISSION ; l'écriture suit §3, pas son `room:send`) |
| exclure quelqu'un, pour de bon                              | retirer l'appartenance (`allow` dira non), PUIS `getRealtimeHub().evictUser(canal, id)` — jamais de liste noire      | `canaux-a-membres.md`                                                                    |
| placer quelqu'un dans un canal sans qu'il s'abonne          | `getRealtimeHub().subscribeConnection(canal, connection)` depuis une entrée client, après avoir écrit l'appartenance | `cas-d-usage.md` (recherche de partie)                                                   |
| **qui est en ligne**, combien, « en train d'écrire »        | l'option `presence` du canal                                                                                         | skill `nodefony-add-realtime-presence`                                                   |
| prévenir UNE personne, tous ses onglets, tous les serveurs  | `getRealtimeHub().publishToUser(id, charge)` / `socket.onUser(h)` — rien à déclarer                                  | `cas-d-usage.md` (notification)                                                          |
| suivre une tâche longue (agent, export)                     | le serveur nomme `task:<uuid>`, impose l'abonnement, publie, puis `closeChannel()` → `ended`                         | `cas-d-usage.md` (tâche d'agent)                                                         |
| recevoir un flux FRÉQUENT du client (coups de jeu, mesures) | `@RealtimeInbound("game:steer", politique)` — sans réponse ; seule la dernière valeur compte (§4)                    | `cas-d-usage.md` (jeu, sondes)                                                           |
| un appel avec réponse qui ne change rien (un devis)         | `@RealtimeAction("x:y")` (fermée par défaut) — ou une route `GET`                                                    | `actions.md`                                                                             |
| le serveur pousse, le client écoute, sur UNE requête        | `this.renderSse()` dans une action ordinaire ; `new NodefonySse(url)` côté client (§8)                               | `http/docs/sse.md`                                                                       |
| typer les deux bouts une fois                               | `interface C extends IRealtimeContract` + `NodefonySocket.fromContract<C>()` + `ContractRealtimeController<C>` (§9)  | `actions.md` (contrat)                                                                   |
| des **octets** (image, audio, mesures binaires, document)   | le codec CBOR et un `Uint8Array` dans la charge                                                                      | skill `nodefony-add-realtime-binary`                                                     |
| ça marche avec deux onglets, plus en cluster                | `@RealtimeBroadcast("prefix:")` sur la classe (défaut : un canal reste sur son serveur)                              | `references/production.md`                                                               |

Chemins complets : `node_modules/@nodefony/realtime/docs/<page>.md`,
`node_modules/@nodefony/http/docs/sse.md`, `node_modules/nodefony/docs/client.md`.

## 2. Le geste

```bash
npx nodefony create controller Room --kind realtime
```

Produit une sous-classe de `RealtimeController` avec un canal de démonstration, une action, une
entrée client, et **son test** (`createRealtimeHarness`). Nomme le contrôleur par son USAGE
(`RoomChat`, `Arena`), pas par une entité : `create entity Room` après `create controller Room`
est refusé (nom déjà référencé). Retires-tu le canal de démonstration ? Adapte son test dans la
foulée — ne laisse pas un banc rouge que tu finirais par ignorer.

🔴 **`/api` est FERMÉ dans une application générée** (zone `main` sans `anonymous`) : sans
session, l'ouverture de `/api/room/realtime` reçoit 401 — et un WebSocket refusé ne LÈVE rien côté
client, il attend puis expire. Un canal qui « ne répond jamais » se cherche dans la zone avant le
réseau. Canal public voulu : une zone au pattern ÉNUMÉRÉ terminé par `(/|$)` (skill
`nodefony-protect-route`), jamais `anonymous` remis sur `main`.

🔴 **Une socket ne sert QUE les canaux du contrôleur qui porte sa route WebSocket** : ouverte sur
`/api/arena/realtime`, `room:42` est refusé (`unknown`). Une socket par page : regroupe les canaux
dans un même contrôleur. Seul `user:<id>` est fourni par toutes.

**N'écris ni `new WebSocket(...)` côté serveur, ni `ws.on(...)`, ni un `WebSocketServer`** : tu
perdrais le routage par canal, l'identité partagée avec HTTP, la reconnexion et la contre-pression.

## 3. Le patron d'un chat : LIRE par le canal, ÉCRIRE par une route

C'est la forme du chat de la démo, première implémentation complète du temps réel Nodefony. Le
canal porte ce qui se DIFFUSE ; chaque GESTE qui change un état (envoyer, modifier, inviter) est
une **route**, que le navigateur appelle **sur la même socket** — `socket.post()` envoie une trame,
pas une requête HTTP de plus.

**1 — ouvrir le pont** : la route WebSocket du contrôleur, et `realtimeApiRequest()` qui rend
joignables par la socket les routes qui déclarent `WEBSOCKET` :

<!-- excerpt: demo/server/nodefony/controllers/ChatController.ts.tpl -->

```ts
  /** Ouvre le pont : les actions ci-dessous deviennent joignables par la socket. */
  protected override realtimeApiRequest(): boolean {
    return true;
  }

  /** La porte WebSocket : `handleRealtime` porte tout le protocole. */
  @route("demo-chat-realtime", {
    path: "/realtime",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async realtime(message: string | Uint8Array | null): Promise<void> {
    this.handleRealtime(message);
  }
```

**2 — le geste d'écriture est une route** : schéma validé, droit vérifié, rejeu sans doublon,
réponse à l'expéditeur :

<!-- excerpt: demo/server/nodefony/controllers/ChatController.ts.tpl -->

```ts
  @route("demo-chat-send", {
    path: "/rooms/{room}/send",
    requirements: { methods: ["POST", "WEBSOCKET"] },
    schema: { params: RoomParams, body: SendBody },
  })
  @IsGranted(["ROLE_USER"])
  @Idempotent()
  async send(
    input: RoomInput<{ body: typeof SendBody }>,
  ): Promise<{ id: string; sentAt: number }> {
    const me = this.#writer();
    await this.#admitted(input.params.room);
```

**3 — le service persiste PUIS publie** sur le canal du salon (seule voie d'écriture : la route,
l'envoi de pièces jointes et un outil MCP l'appellent) :

<!-- excerpt: demo/server/nodefony/service/ChatService.ts.tpl -->

```ts
  async publish(roomId: string, draft: IMessageDraft): Promise<ChatMessage> {
    const message = await this.#messages().archive(roomId, draft);
    publishFrame(roomId, { kind: "message", message });
```

**4 — le navigateur écrit par la socket** ; l'auteur, c'est le serveur qui le pose :

<!-- excerpt: demo/front/frontend/src/chat/useChat.ts.tpl -->

```ts
await socket.post(
  "/demo/chat/rooms/{room}/send",
  replyTo === null ? { text } : { text, replyTo },
  { params: { room: roomId } },
);
```

Ce que la route donne et qu'une entrée de canal n'a pas : identité **revérifiée** à chaque appel
(une entrée se fie au verdict retenu sur la connexion), corps validé par schéma (422), rejeu sans
doublon (`@Idempotent`, la socket pose la clé), une **réponse** (le message enregistré, ou
403/409/429 — une entrée ne répond rien), et la même route sert en HTTP simple (réseau qui bloque
les WebSocket, test, agent). La table `serverRoutes` du contrôleur déclare ces routes dans le
contrat, et le démarrage refuse une route du contrat sans action.

**Route ou entrée de canal ?** Le geste a-t-il besoin d'une réponse, d'un schéma, d'une identité
revérifiée, d'un rejeu sûr ou d'un contrôle métier (appartenance au salon) ? → **route**. Un flux
fréquent sans réponse, où seule la dernière valeur compte (direction d'un joueur, mesure d'une
sonde, curseur) ? → **entrée** (§4). La frappe « en train d'écrire » d'un salon PRIVÉ passe par une
route dans la démo, parce qu'elle doit vérifier l'admission au salon.

- **Un seul chemin d'affichage** : la route ne rend que l'identifiant (`{ id, sentAt }`) ; l'écran
  n'ajoute le message qu'à sa DIFFUSION sur le canal, dédoublonnée par cet identifiant. Afficher la
  réponse ET la diffusion ferait voir le message deux fois.
- **L'historique se lit APRÈS l'abonnement effectif** : `await socket.whenSubscribed(canal)` puis
  la route `GET …/history` (`GET` + `WEBSOCKET`). Lu avant, un message publié pendant qu'`allow`
  lit la base n'arrive par aucun des deux chemins. Même geste à chaque reconnexion : le client
  rejoue ses abonnements, pas les messages manqués.
- **Rattrape sur l'identifiant croissant de la base, jamais sur un horodatage** : deux serveurs ont
  deux horloges, et un curseur `sentAt > x` perd les messages de la même milliseconde. Une page
  relue qui ne recoupe aucun identifiant connu REMPLACE la liste (trou) au lieu de la fusionner.
- **Borne le débit d'écriture par compte** : le transport ne le fait pas par défaut, et un compte
  connecté peut sinon boucler l'envoi. `#writer()` ci-dessus compte le geste AVANT toute lecture
  en base ; au-delà, l'action pose `this.response?.setHeader("Retry-After", n)` puis lève un
  `HttpError` 429. Le MÊME code dit l'attente sur les deux transports : l'en-tête en HTTP,
  `error.data.retryAfter` (secondes, RFC 9110 §10.2.3) sur la socket, qui n'a pas d'en-tête — et
  seul cet en-tête-là passe sur une trame. La démo tient une fenêtre fixe par compte
  (`nodefony/kit/rateLimit.ts`, `take(clé)` rend les secondes à attendre), un quota séparé pour la
  frappe (épuiser l'un ne coupe pas l'autre).
- **Les fichiers ne passent pas par la socket** : la démo envoie ses pièces jointes en `POST`
  multipart (avec `Idempotency-Key`), puis publie le message qui les cite. La route qui SERT une
  pièce d'un salon privé vérifie l'admission au salon comme les autres — un identifiant
  imprévisible n'est pas une autorisation.

## 4. Les mots du serveur — canal, fabrique, entrée, action

<!-- excerpt: gameMoves.ts -->

```ts
  // Le joueur envoie ce qu'il VEUT faire (une direction), jamais où il EST.
  // Le rôle est contrôlé à la première commande, puis retenu sur la connexion.
  @RealtimeInbound("game:steer", { roles: ["ROLE_PLAYER"] })
  steer(
    params: unknown,
    _reply: unknown,
    connection: IRealtimeConnection,
  ): void {
    if (connection.userId === null || !ArenaRealtime.isDirection(params)) {
      return;
    }
    this.arena.steer(connection.userId, params);
  }

  // Le moteur démarre au PREMIER joueur abonné et s'arrête au DERNIER : la
  // fonction rendue est l'arrêt. Personne d'autre ne l'appelle.
  @RealtimeChannel("game:state", { roles: ["ROLE_PLAYER"] })
  state(channel: string, publish: RealtimePublish): () => void {
    return this.arena.start((state) => publish(channel, state));
  }
```

- **Le contrôleur est instancié PAR CONNEXION** : l'état partagé (le jeu, les salons) vit dans un
  service `@injectable`, injecté par son nom (`@Inject("ArenaService")`). La fabrique d'un canal
  est partagée entre connexions : elle ne capture jamais `this.context`.
- **`params` vient du réseau** : valide-le. L'auteur est `connection.userId`, jamais un champ de
  la charge.
- **Publier depuis n'importe où** (service, tâche, minuteur) : `getRealtimeHub().publish(canal,
charge)`. La charge est un objet, un tableau, des octets ou rien — **un scalaire lève**
  (`publish("c", 42)` → `TypeError`) : écris `{ value: 42 }`. Un canal au nom calculé se publie par
  son nom (``getRealtimeHub().publish(`room:${id}`, charge)``).
- **État ou événement ?** Une position, une jauge : seule la dernière valeur compte — garde-la et
  diffuse au rythme du serveur (`setInterval`, `unref()`) — un relais direct à chaque réception ne se
  tolère qu'à faible cadence (quelques trames par seconde). Un message de
  chat : chacun compte — persiste-le AVANT de le publier (§3).
- **Une famille de canaux** (`room:*`) : le motif pose la POLITIQUE de toute la famille ET sert
  ses noms — `room:42` est servi, la méthode reçoit le nom réel. Une surcharge de
  `createRealtimeChannel` ne sert qu'à FILTRER : dès qu'elle existe, elle seule décide, et son
  `null` est un refus `unknown` que le motif ne contourne pas :

<!-- excerpt: privateRoom.ts -->

```ts
  // « CETTE personne a-t-elle droit à CE salon ? » : la classe d'admission tranche.
  @RealtimeChannel("room:*", { allow: RoomAdmission })
  room(): () => void {
    return () => {};
  }

  // La surcharge FILTRE la famille : un nom qui n'est pas un salon est refusé
  // (`null`). Sans elle, le motif servirait tout `room:*`, sous `allow`.
  override createRealtimeChannel(channel: string): (() => void) | null {
    return RoomService.roomOf(channel) === null ? null : () => {};
  }
```

Un canal à durée de vie porte l'identifiant de son instance dans son nom (`game:42:a1b2`) ; la
fabrique rend `null` une fois l'instance finie.

## 5. Qui a le droit — LIRE et ÉCRIRE sont deux politiques

Une politique = `{ authenticated?, roles?, scopes?, allow?, anonymous?, presence? }` — toute autre
clé refuse le démarrage en nommant la classe et le canal. Les axes se cumulent (ET). Un rôle dit
**qui est connecté** ; `allow` dit **ce compte sur ce canal**.

| Déclaration                                    | Elle garde                                                                           | Jugée                                         |
| ---------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------- |
| `@RealtimeChannel(nom, politique)`             | la **LECTURE** du nom                                                                | au `subscribe`                                |
| `@RealtimeInbound(nom, politique)`             | l'**ÉCRITURE** du nom                                                                | à chaque trame entrante : lecture ET écriture |
| `@RealtimeAction(nom, politique)`              | l'écriture du nom ; sans politique : la lecture du nom si déclarée, sinon **fermée** | à chaque appel                                |
| `@RealtimePolicy({ nom: politique })` (classe) | lecture ET écriture, pour un contrôleur à contrat                                    | idem                                          |
| route + `@IsGranted`                           | le geste, comme toute route HTTP                                                     | à chaque appel, identité revérifiée           |

- **Ce qui n'est pas déclaré s'hérite** : une lecture absente reprend l'écriture du même nom ; un
  canal que tout le monde lit et que seuls certains écrivent se déclare donc deux fois, lecture
  ouverte et écriture gardée. Deux déclarations contradictoires d'une même sorte sur un nom
  refusent le démarrage.
- **Une entrée sous un AUTRE nom n'hérite PAS de la politique du canal qu'elle vise** :
  `@RealtimeInbound("room:send")` ne reçoit pas l'`allow` de `room:*` — elle vérifie l'appartenance
  elle-même, par le MÊME service que l'admission (ou devient une route, §3).
- **`allow` est une règle de LECTURE** : posé sur une écriture distincte, il refuse le démarrage.
  Il est demandé UNE fois au `subscribe` (et à chaque reconnexion) ; seul `=== true` admet ; lever
  = `forbidden` ; trop lent = `unavailable` (le client réessaie seul).
- **Dès que la règle lit la base, écris-la en classe d'admission** — une dépendance absente refuse
  alors le démarrage en nommant la classe, au lieu de refuser tous les abonnés sans un mot :

<!-- excerpt: privateRoom.ts -->

```ts
@injectable()
export class RoomAdmission extends Service implements IChannelAdmission {
  constructor(@Inject("RoomService") private readonly rooms: RoomService) {
    super("roomAdmission");
  }

  async allow(channel: string, who: ISubscriberIdentity): Promise<boolean> {
    return who.id !== null && (await this.rooms.isMember(channel, who.id));
  }
}
```

- **Déclarée dans `@services([...])` du module** : `nodefony create service RoomAdmission` le fait ;
  écrite à la main et oubliée, `nodefony doctor` la signale orpheline (`wiring/orphan-service`).
- `who` est plat (`id`, `authenticated`, `roles`, `scopes`, `issuer`, `account`) : la règle ne lit
  que ses arguments — ni contexte de requête, ni session. Un salon PUBLIC lisible sans compte :
  `anonymous: true` à côté d'`allow` (la démo), la règle refusant les salons privés.
- **Le verdict d'`allow` est RETENU sur la connexion** : une admission qui expire (invitation à un
  événement terminé, salon verrouillé) ne se retire pas seule — éjecte (`evictUser`) au moment où
  la condition tombe, sinon le canal continue de livrer ce que la route refuse déjà. Une même
  règle pure, appelée par la classe d'admission ET par les routes, évite qu'elles divergent.
- **Exclure** = retirer l'appartenance, PUIS `getRealtimeHub().evictUser(canal, id)` (tous ses
  onglets, tous les serveurs ; `realtime:closed { reason: "evicted" }`). L'éjection seule ne suffit
  pas : son navigateur rejoue `subscribe` au rechargement, et `allow` tranche alors. Une liste
  noire à côté d'`allow` diverge en silence : interdit. **Exclusion DÉFINITIVE** (pas de
  réinvitation) = un ÉTAT sur la ligne d'appartenance (`banned`), lu par la MÊME règle qu'`allow` et
  par la route d'invitation — jamais une seconde table. Le modérateur est un attribut
  d'appartenance, pas un rôle global ; l'entité d'appartenance se génère **sans ressource REST**
  (`--no-controller`) — un CRUD ouvert laisserait chacun s'inviter.
- **Inviter** = une route (`@IsGranted` + contrôle « est modérateur ») qui écrit l'appartenance PUIS
  prévient l'invité : `getRealtimeHub().publishToUser(invité, { kind: "invited", room })`. Son
  écran s'abonne au salon, `allow` dit oui.
- **Nom exact contre motif** : le nom exact l'emporte et REMPLACE le motif en entier ; entre
  motifs, le littéral le plus long gagne. Un canal servi par la fabrique sans aucune politique qui
  le couvre est signalé une fois au journal (`… n'a aucune règle d'accès …`) : pose le motif.
- **Noms réservés** : `nodefony:` (plateforme) et les suffixes `:health` / `:stats` dans TOUT
  espace de noms (refusés sans `ROLE_NODEFONY_ADMIN`). `user:<id>` est fourni (son propre id
  seulement) : n'écris jamais de politique sur `user:…` sans le vouloir — elle remplacerait la
  garantie « toi seul ».
- **Condition d'activation** : rôles, portées et `authenticated` ne sont jugés que si
  `@nodefony/security` est chargé avec une zone qui couvre la socket ; sinon un WARNING au premier
  handshake. `allow` s'applique toujours. **Ne ferme pas la zone pour fermer un canal** : la
  politique se pose sur le canal.

## 6. Côté client — la façade, jamais le socket nu

<!-- excerpt: privateRoom.client.ts -->

```ts
import { NodefonySocket } from "nodefony/client";

const socket = NodefonySocket.shared({ url: "/api/room/realtime" });

/** Entrer dans un salon : une DEMANDE, que `allow` tranche côté serveur. */
export function joinRoom(
  room: string,
  onMessage: (message: unknown) => void,
): () => void {
  const off = socket.on(room, onMessage);
  socket.subscribe(room);
  return () => {
    off();
    socket.unsubscribe(room);
  };
}
```

| Méthode                                              | Rôle                                                                       |
| ---------------------------------------------------- | -------------------------------------------------------------------------- |
| `NodefonySocket.shared({ url })`                     | UNE socket par adresse ; les options ne comptent qu'à la première création |
| `subscribe(canal)` / `on(canal, h)`                  | DEMANDER le flux (rejoué à chaque reconnexion) / le RECEVOIR — deux gestes |
| `whenSubscribed(canal)`                              | attendre l'acquittement avant de charger l'état initial                    |
| `get` / `post` / `put` / `patch` / `delete(chemin…)` | appeler une route par la socket (§3)                                       |
| `emit(nom, charge)`                                  | pousser vers une entrée (`@RealtimeInbound`), sans réponse                 |
| `request(nom, params)`                               | appeler une action, avec réponse                                           |
| `onDenied(h)`                                        | refus : `forbidden`, `limit`, `unknown`, `unavailable`                     |
| `onClosed(h)`                                        | fin imposée : `ended`, `evicted` — le client ne rejoue pas                 |
| `onUser(h)`                                          | les messages adressés à CE compte                                          |
| `onState(h)` / `onIdentity(h)`                       | connexion (`connected`…) / compte de la connexion                          |

- **Importe de `nodefony/client`**, jamais de la racine `nodefony` dans un bundle navigateur ;
  `nodefony/realtime` n'existe pas.
- Vues : `nodefony/react` (`<NodefonyProvider url="…">`, `useNodefony()`,
  `useNodefonyChannelData`, `useNodefonyChannel`), mêmes noms en `nodefony/vue`. Un composant monte
  et démonte son abonnement ; la socket appartient à la page.
- Un refus de handshake (401/403) n'est vu par le navigateur que comme une coupure : la socket
  sonde l'adresse en HTTP et s'arrête d'elle-même. Rien à écrire.

## 7. Plusieurs serveurs, redéploiement, révocation — résumé

Lis [`references/production.md`](references/production.md) avant de dire « fait ».

- Un canal reste sur son serveur tant que sa classe ne porte pas `@RealtimeBroadcast("prefix:")`
  — sur TOUS les serveurs. L'application générée tourne en `backplane.driver: "cluster"` : deux
  onglets sur un processus ne prouvent rien. L'oubli se compte (`localOnlyTotal`).
- **Le temps réel traverse les serveurs, l'ÉTAT non** : plusieurs serveurs exigent une base
  partagée (SQLite local = des salons et des appartenances différents par serveur, donc des `allow`
  différents) et un stockage de fichiers partagé.
- Noms de canaux = espace PLAT entre modules : préfixe-les par domaine. Livraison : au plus une
  fois — la reconnexion rejoue les abonnements, pas les messages.
- Révocation : `4001` session morte, `4005` droits changés (revient aussitôt), `4006` jeton porteur
  expiré ; `1013` client qui ne lit plus ; `1001` redéploiement (reconnexion silencieuse). Compare
  aux constantes de `nodefony`, jamais aux nombres.
- Socket sur une autre origine que la page : `publicOrigin` (CSP `connect-src`).

## 8. SSE ou socket ?

| Besoin                                                               | Choisir                                     |
| -------------------------------------------------------------------- | ------------------------------------------- |
| Le serveur pousse sur UNE requête (progression, réponse d'un modèle) | **SSE** — une réponse HTTP qui ne finit pas |
| Un réseau d'entreprise bloque les WebSocket                          | **SSE** — c'est une réponse HTTP ordinaire  |
| Deux sens, canaux, plusieurs onglets, identité par connexion         | **socket** — le reste de cette page         |

`const sse = await this.renderSse()` dans une action ordinaire, puis `await sse.send(données, {
event })` et `sse.close()` ; `this.acceptsSse()` laisse la même route répondre en JSON ou en flux.
Client : `new NodefonySse(url)` (`nodefony/client`), liaison `useNodefonySse`. **N'écris jamais
`Content-Type: text/event-stream` à la main** : tu perdrais le battement qui empêche un proxy de
couper, et la contre-pression (`await sse.send()` freine si le client lit lentement). Un flux SSE
est gardé par la zone et `@IsGranted` de sa route, pas par une politique de canal. Exemple complet :
`node_modules/@nodefony/http/docs/sse.md`.

## 9. Un contrat, déclaré UNE fois

Dès que navigateur et serveur échangent plus qu'un canal : sans contrat, une méthode oubliée
compile puis rend `-32601`. Une interface de types seuls (`extends IRealtimeContract`), partagée
par les deux côtés : `NodefonySocket.fromContract<C>()` au navigateur, `ContractRealtimeController<C>`
au serveur, `@RealtimePolicy` sur la classe. Les quatre clés, leurs pièges et le contrat du chat :
[`references/contrat.md`](references/contrat.md). **Le type n'est pas une validation.**

## 10. Prouver

```bash
npm test
npx nodefony inspect routes --json
```

Le harnais `createRealtimeHarness` (`@nodefony/realtime/testing`) parle le protocole sans serveur
ni navigateur ; l'identité et le VRAI verrou de trames viennent de `@nodefony/security/testing`.
Le patron (salon privé, cas exécuté complet dans `cas-d-usage.md`) :

<!-- excerpt: privateRoom.test.ts -->

```ts
/** Une connexion par compte, identifiée par son identifiant EN BASE. */
async function connect(name: string): Promise<IRealtimeHarness<RoomRealtime>> {
  // Le service et l'admission passés à la main, comme l'injecteur en production.
  const h = createRealtimeHarness((ctx) => new RoomRealtime(ctx, rooms), {
    identity: createTestIdentity({ identifier: name, id: idOf(name) }),
    admissions: [new RoomAdmission(rooms)],
    resetHub: open.length === 0,
  });
  await h.connect();
  open.push(h);
  return h;
}
```

<!-- excerpt: privateRoom.test.ts -->

```ts
it("exclu : `evicted` tout de suite, puis refusé à la page rechargée", async () => {
  const carol = await connect("carol");
  await carol.subscribe(channel);
  await flush();
  await rooms.exclude(channel, idOf("carol"));
  expect(closedOf(carol)).toEqual([{ channel, reason: "evicted" }]);
  const reloaded = await connect("carol"); // une page rechargée refait `subscribe`
  await reloaded.subscribe(channel);
  await flush();
  expect(reloaded.denials()).toHaveLength(1);
});
```

- Sans `identity` : **anonyme**. `resetHub` au premier harnais seulement ; `subscriptions()`,
  `denials()`, `messages(canal)` : acquittés, refus, reçus.
- **`roles` / `authenticated` ne sont jugés qu'avec un verrou** : passe
  `frameAuthorizer: createTestFrameAuthorizer(getRealtimeHub())` au harnais, sinon la politique
  n'est appliquée par personne — et le test est vert pour la mauvaise raison.
- 🔴 **`allow` lit la base ? Le test MONTE la base**, sur le connecteur que lit le service
  (`const CONNECTOR = "default"`) — sinon `aucun connecteur « default »`, et le harnais rend
  `socket fermée (code 1011)` : ni l'Origin ni l'authentification, le service est sans base.
  Dans le `beforeAll` :

<!-- excerpt: privateRoom.test.ts -->

```ts
for (const entity of ENTITIES) {
  entityRegistry.register({ ...entity, connector: CONNECTOR });
}
orm = new DrizzleOrm(CONNECTOR, { filename: ":memory:" }); // en mémoire, rien à installer
await orm.connect();
```

Puis sème les PARENTS (`seedEntityRow`) : `FOREIGN KEY constraint failed` = un parent non
semé, jamais une raison de retirer le test. Fichier complet : salon privé de `cas-d-usage.md`.

- **Vois le test rouge une fois** : retire `allow` (ou `roles`), l'intrus doit entrer ; remets-le.
  L'exclusion se prouve par `evicted` PUIS un `subscribe` refusé — un refus opposé à qui n'a jamais
  été membre ne prouve rien.
- Une route du pont se prouve aussi en HTTP (même route, `POST`).
- La santé en marche : `GET /nodefony/realtime/api/health` (rôle d'administration) —
  `publishTotal` qui monte sans `fanoutTotal` = tu publies dans le vide (nom mal orthographié).

## 11. Voisins

| Besoin                                                    | Skill                            |
| --------------------------------------------------------- | -------------------------------- |
| Qui est en ligne, combien, « en train d'écrire »          | `nodefony-add-realtime-presence` |
| Des octets : image, audio, mesures binaires, CBOR         | `nodefony-add-realtime-binary`   |
| Réserver une route HTTP, une page                         | `nodefony-protect-route`         |
| Une ressource stockée (l'entité d'appartenance, messages) | `nodefony-add-crud`              |
| Un service métier injectable (la classe d'admission)      | `nodefony-add-service`           |
| Voir l'écran, piloter une socket depuis la page           | `nodefony-browser`               |
| Un canal qui répondait ne répond plus                     | `nodefony-troubleshoot`          |
