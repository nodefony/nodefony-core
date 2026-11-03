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
| une mesure périodique affichée sur N écrans                        | [Tableau de bord partagé](#tableau-de-bord-partagé)    | un producteur par canal, pas par écran  |
| prévenir une personne, sur tous ses onglets                        | [Notification privée](#notification-privée-userid)     | le canal `user:<id>`, fourni            |
| montrer la progression d'une tâche longue à celui qui l'a demandée | [Tâche d'agent](#tâche-dagent)                         | le serveur nomme le canal et le termine |
| un appel, une conversation à la voix                               | [Appel et voix](#appel-et-voix)                        | en conception                           |

Chaque exemple serveur est un **contrôleur temps réel complet, point d'entrée compris**.
`@controller("/api/arena")` donne le préfixe ; la route `WEBSOCKET` (`path: "/realtime"`) est la
porte de la socket, et `handleRealtime` y fait tout le protocole — accueil, identité, abonnements,
entrées. C'est la forme que produit la commande :

```bash
npx nodefony create controller Arena --kind realtime   # sert /api/arena/realtime
```

> ⚠️ **Une socket ne sert que les canaux du contrôleur qui porte sa route.** Pour `room:*`, le
> navigateur ouvre `/api/room/realtime` : ouverte sur un autre contrôleur, la socket refuse
> `room:42` (`unknown`). Pour qu'une page n'ouvre qu'une socket, regroupez ses canaux dans un même
> contrôleur. Seul `user:<id>` est fourni par toutes.

Chaque cas montre trois fichiers : le **serveur**, le **navigateur**, et le **test** qui éprouve
le serveur avec l'identité d'essai de `@nodefony/security/testing`. Le serveur et le test sont
exécutés tels quels par la suite du module, le navigateur y est vérifié par le compilateur : ce
que vous copiez a tourné. Seuls les imports changent — la page montre ceux d'une application qui
pose le test à côté de son contrôleur.

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
import { controller, route } from "@nodefony/framework";
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

// Sa socket : `/api/arena/realtime` (préfixe + route). Elle ne sert que les canaux déclarés ici.
@controller("/api/arena")
export class ArenaRealtime extends RealtimeController {
  constructor(context: ContextType) {
    super("ArenaRealtime", context);
  }

  // Le point d'entrée : `handleRealtime` fait tout le protocole et route vers les décorateurs.
  @route("arena-realtime", {
    path: "/realtime",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async realtime(message: string | Uint8Array | null): Promise<void> {
    this.handleRealtime(message);
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

<!-- example: gameMoves.client.ts -->

```ts
import { NodefonySocket } from "nodefony/client";

const socket = NodefonySocket.shared({
  url: "/api/arena/realtime",
  maxBufferedAmount: 64 * 1024, // au-delà, le coup est JETÉ et compté, pas mis en file
});

/** Chaque état reçu REMPLACE le précédent : rien n'est empilé. */
export function watchArena(draw: (players: unknown) => void): () => void {
  const off = socket.on("game:state", draw); // charge réseau : la vérifier avant de dessiner
  socket.subscribe("game:state");
  return () => {
    off();
    socket.unsubscribe("game:state");
  };
}

/** Soixante fois par seconde : une notification, aucune réponse attendue. */
export function move(x: number, y: number): void {
  socket.emit("game:move", { x, y });
}
```

Le test joue soixante coups, puis un tick ; il branche le **vrai** verrou du pare-feu, sans lequel
le rôle exigé ne serait jugé par personne :

<!-- example: gameMoves.test.ts -->

```ts
import { afterEach, describe, expect, it } from "vitest";
import { getRealtimeHub } from "@nodefony/realtime";
import { createRealtimeHarness } from "@nodefony/realtime/testing";
import type { IRealtimeHarness } from "@nodefony/realtime/testing";
import {
  createTestFrameAuthorizer,
  createTestIdentity,
} from "@nodefony/security/testing";
import { ArenaRealtime, positions, tick } from "./gameMoves";

const open: IRealtimeHarness<ArenaRealtime>[] = [];
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

async function connect(
  user: string,
  roles: string[],
): Promise<IRealtimeHarness<ArenaRealtime>> {
  const h = createRealtimeHarness((ctx) => new ArenaRealtime(ctx), {
    identity: createTestIdentity({ identifier: user, roles }),
    // Le VRAI verrou du pare-feu : sans lui, `roles` n'est jugé par personne.
    frameAuthorizer: createTestFrameAuthorizer(getRealtimeHub()),
    resetHub: open.length === 0,
  });
  await h.connect();
  open.push(h);
  return h;
}

describe("jeu — seule la dernière position compte, diffusée au rythme du serveur", () => {
  afterEach(() => {
    for (const h of open.splice(0)) h.close();
    positions.clear();
    getRealtimeHub().clear();
  });

  it("soixante coups, un seul état diffusé : le dernier", async () => {
    const alice = await connect("alice", ["ROLE_PLAYER"]);
    await alice.subscribe("game:state");
    for (let x = 0; x < 60; x++) await alice.notify("game:move", { x, y: 1 });
    await alice.notify("game:move", { x: "pas un nombre", y: 1 });
    expect(alice.messages("game:state")).toHaveLength(0); // rien avant le tick
    tick(); // en production : `setInterval(tick, 50)`
    expect(alice.messages("game:state")).toEqual([{ alice: { x: 59, y: 1 } }]);
  });

  it("sans ROLE_PLAYER, ni l'état ni les coups", async () => {
    const watcher = await connect("watcher", ["ROLE_USER"]);
    await watcher.subscribe("game:state");
    await watcher.notify("game:move", { x: 9, y: 9 });
    await flush();
    expect(watcher.denials().map((d) => d.channel)).toContain("game:state");
    expect(positions.has("watcher")).toBe(false);
  });
});
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
import { controller, route } from "@nodefony/framework";
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

// Sa socket : `/api/match/realtime` (préfixe + route). Elle ne sert que les canaux déclarés ici.
@controller("/api/match")
export class MatchRealtime extends RealtimeController {
  constructor(context: ContextType) {
    super("MatchRealtime", context);
  }

  // Le point d'entrée : `handleRealtime` fait tout le protocole et route vers les décorateurs.
  @route("match-realtime", {
    path: "/realtime",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async realtime(message: string | Uint8Array | null): Promise<void> {
    this.handleRealtime(message);
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

Côté navigateur, rien à demander : l'abonnement arrive avec `imposed: true`.

<!-- example: matchmaking.client.ts -->

```ts
import { NodefonySocket } from "nodefony/client";

const socket = NodefonySocket.shared({ url: "/api/match/realtime" });

/** Rien à écrire pour suivre la partie : le serveur IMPOSE l'abonnement. */
export function findMatch(onState: (state: unknown) => void): void {
  socket.onSubscribed(({ channel, imposed }) => {
    if (imposed === true && channel.startsWith("match:"))
      socket.on(channel, onState);
  });
  socket.emit("match:find");
}

socket.onClosed(({ channel, reason }) => {
  if (reason === "ended") console.log(`partie ${channel} terminée`);
});
```

Le test coupe la connexion, puis la rouvre — ce qu'un tunnel fait au téléphone :

<!-- example: matchmaking.test.ts -->

```ts
import { afterEach, describe, expect, it } from "vitest";
import { getRealtimeHub } from "@nodefony/realtime";
import { createRealtimeHarness } from "@nodefony/realtime/testing";
import type { IRealtimeHarness } from "@nodefony/realtime/testing";
import { createTestIdentity } from "@nodefony/security/testing";
import { MatchRealtime, players } from "./matchmaking";

const open: IRealtimeHarness<MatchRealtime>[] = [];
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

async function connect(user: string): Promise<IRealtimeHarness<MatchRealtime>> {
  const h = createRealtimeHarness((ctx) => new MatchRealtime(ctx), {
    identity: createTestIdentity({ identifier: user }),
    resetHub: open.length === 0,
  });
  await h.connect();
  open.push(h);
  return h;
}

describe("recherche de partie — abonné d'office, et l'appartenance survit à la reconnexion", () => {
  afterEach(() => {
    for (const h of open.splice(0)) h.close();
    players.clear();
    getRealtimeHub().clear();
  });

  it("placé sans s'abonner, le joueur retrouve sa partie après une coupure", async () => {
    const alice = await connect("alice");
    await alice.notify("match:find");
    await flush();
    expect(alice.subscriptions()).toEqual(["match:42"]);
    alice.close(); // un tunnel
    const again = await connect("alice"); // le navigateur rejoue `subscribe`
    await again.subscribe("match:42");
    await flush();
    expect(again.denials()).toHaveLength(0);
  });

  it("un joueur d'une autre partie n'entre pas", async () => {
    const alice = await connect("alice");
    await alice.notify("match:find");
    await flush();
    const mallory = await connect("mallory");
    await mallory.subscribe("match:42");
    await flush();
    expect(mallory.denials()).toMatchObject([
      { channel: "match:42", reason: "forbidden" },
    ]);
  });
});
```

**Pourquoi ce choix.** Le navigateur rejoue ses abonnements à chaque reconnexion, et ce rejeu passe
par `allow`. L'appartenance est donc écrite **là où `allow` la lit**, avant d'abonner : le joueur
retrouve sa partie après une coupure, sans code côté navigateur.

**Le piège.** Abonner d'office sans écrire l'appartenance : tout marche, jusqu'à la première
coupure réseau — sur mobile, dans la minute — où le joueur est refusé de sa propre partie.

Le détail des gestes (lister, éjecter, terminer) : [Canal à membres](canaux-a-membres.md).

### Salon privé sur invitation

Seuls les membres entrent ; un modérateur peut exclure quelqu'un. L'appartenance vit en base,
dans les entités que le générateur écrit :

```bash
npx nodefony create entity Room "name:string"
npx nodefony create entity RoomMember "room:ref:Room" "user:ref:User" "role:enum(member,moderator)" --no-controller
```

`--no-controller` : un CRUD ouvert sur `RoomMember` laisserait chacun s'inviter lui-même.

<!-- example: privateRoom.ts -->

```ts
import { controller, route } from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";
import {
  RealtimeChannel,
  RealtimeController,
  RealtimeInbound,
  getRealtimeHub,
} from "@nodefony/realtime";
import type { IRealtimeConnection } from "@nodefony/realtime";
import { getRoomMemberService } from "../service/RoomMemberService";

/** L'identifiant du salon d'un canal `room:<id>`, `null` hors de la famille. */
function roomOf(channel: string): string | null {
  return channel.startsWith("room:") ? channel.slice("room:".length) : null;
}

/** L'appartenance vit en base : une ligne `RoomMember` (salon, compte). */
async function isMember(channel: string, user: string): Promise<boolean> {
  const room = roomOf(channel);
  if (room === null) return false;
  return (await getRoomMemberService().findOne({ room, user })) !== null;
}

// La socket de CE contrôleur s'ouvre sur `/api/room/realtime` : le préfixe de la
// classe, puis le chemin de sa route WebSocket. Seuls les canaux déclarés ICI y
// sont servis — une socket ouverte ailleurs ne connaît pas `room:*`.
@controller("/api/room")
export class RoomRealtime extends RealtimeController {
  // Instancié PAR CONNEXION : rien de partagé entre membres ne vit dans `this`.
  constructor(context: ContextType) {
    super("RoomRealtime", context);
  }

  // Le point d'entrée : chaque trame de la socket arrive ici. `handleRealtime`
  // fait tout le protocole — accueil, identité de la connexion, abonnements,
  // entrées — et route vers les décorateurs ci-dessous. Rien d'autre à écrire.
  @route("room-realtime", {
    path: "/realtime",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async realtime(message: string | Uint8Array | null): Promise<void> {
    this.handleRealtime(message);
  }

  // `allow` tranche « CETTE personne a-t-elle droit à CE salon ? ». `who.id` est
  // l'identité posée par le serveur à l'ouverture, jamais un champ du client.
  // Appelé UNE fois, au `subscribe` (et à chaque page rechargée) : une requête
  // en base y est normale.
  @RealtimeChannel("room:*", {
    allow: async (channel, who) =>
      who.id !== null && (await isMember(channel, who.id)),
  })
  room(): () => void {
    return () => {};
  }

  // Un canal décoré n'est servi que sous son nom exact : la famille l'est ici.
  override createRealtimeChannel(channel: string): (() => void) | null {
    return roomOf(channel) === null ? null : () => {};
  }

  // Une entrée n'hérite PAS de la politique du canal : elle vérifie l'appartenance
  // elle-même, par la MÊME fonction qu'`allow`, et l'auteur vient de la connexion.
  @RealtimeInbound("room:send", { authenticated: true })
  async send(
    params: unknown,
    _reply: unknown,
    connection: IRealtimeConnection,
  ): Promise<void> {
    if (connection.userId === null || !isMessage(params)) return;
    if (!(await isMember(params.room, connection.userId))) return;
    getRealtimeHub().publish(params.room, {
      author: connection.userId,
      text: params.text.slice(0, 500),
    });
  }
}

/** Exclure : retirer l'appartenance (`allow` dira non), PUIS couper ce qu'il reçoit déjà. */
export async function exclude(channel: string, user: string): Promise<void> {
  const room = roomOf(channel);
  if (room === null) return;
  await getRoomMemberService().delete({ room, user });
  getRealtimeHub().evictUser(channel, user); // ses onglets reçoivent `realtime:closed { reason: "evicted" }`
}

function isMessage(value: unknown): value is { room: string; text: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "room" in value &&
    "text" in value &&
    typeof value.room === "string" &&
    typeof value.text === "string"
  );
}
```

Côté navigateur, entrer est une demande ; un refus ou une exclusion s'affiche, sans réessai :

<!-- example: privateRoom.client.ts -->

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

export function say(room: string, text: string): void {
  socket.emit("room:send", { room, text });
}

// Refusé (pas membre) ou exclu : l'écran le dit, et ne réessaie pas.
socket.onDenied(({ channel, reason }) =>
  console.warn(`${channel} : ${reason}`),
);
socket.onClosed(({ channel, reason }) => {
  if (reason === "evicted") console.warn(`exclu de ${channel}`);
});
```

Le test admet, refuse, puis exclut — et recharge la page de l'exclu. Comme `allow` lit la
base, le test en ouvre une en mémoire et l'**amorce**, avec la recette du test que `create entity`
génère pour chaque entité :

- les entités sont enregistrées sous le connecteur de l'APPLICATION (`default`) : c'est là que
  `getRoomMemberService()` les cherche ;
- les lignes PARENTES d'abord : `RoomMember` porte deux clés étrangères, et la base refuse un
  compte ou un salon inventé (« FOREIGN KEY constraint failed »). `seedEntityRow` pose une ligne
  valide quelle que soit la table, et rend son identifiant ;
- l'identité de test porte cet identifiant (`createTestIdentity({ identifier, id })`) : c'est
  lui que `who.id` donne à `allow`.

<!-- example: privateRoom.test.ts -->

```ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { DrizzleOrm, seedEntityRow } from "@nodefony/drizzle";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import { getRealtimeHub } from "@nodefony/realtime";
import { createRealtimeHarness } from "@nodefony/realtime/testing";
import type { IRealtimeHarness } from "@nodefony/realtime/testing";
import { createTestIdentity } from "@nodefony/security/testing";
import { UserEntity } from "../entity/User";
import { RoomEntity } from "../entity/Room";
import { RoomMemberEntity } from "../entity/RoomMember";
import { getRoomMemberService } from "../service/RoomMemberService";
import { RoomRealtime, exclude } from "./privateRoom";

// Le connecteur de l'APPLICATION : `getRoomMemberService()` le lit sous ce nom.
// Un autre nom (`test-room-member`, celui du test d'entité généré) laisserait
// le service sans base.
const CONNECTOR = "default";
const ENTITIES = [UserEntity, RoomEntity, RoomMemberEntity];

let orm: DrizzleOrm;
let channel = "";
const accounts = new Map<string, string>();

/** L'identifiant en base d'un compte semé. */
function idOf(name: string): string {
  const id = accounts.get(name);
  if (id === undefined) throw new Error(`compte non semé : ${name}`);
  return id;
}

beforeAll(async () => {
  for (const entity of ENTITIES) {
    entityRegistry.register({ ...entity, connector: CONNECTOR });
  }
  orm = new DrizzleOrm(CONNECTOR, { filename: ":memory:" }); // en mémoire, rien à installer
  await orm.connect();
  // Les lignes PARENTES d'abord : `RoomMember` porte deux clés étrangères, et la
  // base refuse un compte ou un salon inventé (« FOREIGN KEY constraint failed »).
  for (const name of ["alice", "bob", "carol", "mallory"]) {
    const id = await seedEntityRow(orm, {
      ...UserEntity,
      connector: CONNECTOR,
    });
    accounts.set(name, String(id));
  }
  const room = String(
    await seedEntityRow(orm, { ...RoomEntity, connector: CONNECTOR }),
  );
  channel = `room:${room}`;
  for (const name of ["alice", "bob", "carol"]) {
    await getRoomMemberService().create({
      room,
      user: idOf(name),
      role: "member",
    });
  }
});

afterAll(async () => {
  await orm.disconnect();
  for (const entity of ENTITIES)
    entityRegistry.unregister(entity.name, CONNECTOR);
  ormRegistry.unregister(CONNECTOR);
});

const open: IRealtimeHarness<RoomRealtime>[] = [];
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Une connexion par compte, identifiée par son identifiant EN BASE. */
async function connect(name: string): Promise<IRealtimeHarness<RoomRealtime>> {
  const h = createRealtimeHarness((ctx) => new RoomRealtime(ctx), {
    identity: createTestIdentity({ identifier: name, id: idOf(name) }),
    resetHub: open.length === 0,
  });
  await h.connect();
  open.push(h);
  return h;
}

const closedOf = (h: IRealtimeHarness<RoomRealtime>): unknown[] =>
  h.received.filter((f) => f.method === "realtime:closed").map((f) => f.params);

describe("salon privé — `allow` lit la base, l'exclusion coupe ET empêche de revenir", () => {
  afterEach(() => {
    for (const h of open.splice(0)) h.close();
    getRealtimeHub().clear();
  });

  it("le membre entre, l'intrus est refusé par le MÊME motif", async () => {
    const bob = await connect("bob");
    const mallory = await connect("mallory");
    await bob.subscribe(channel);
    await mallory.subscribe(channel);
    await flush();
    expect(bob.subscriptions()).toEqual([channel]);
    expect(mallory.denials()).toMatchObject([{ channel, reason: "forbidden" }]);
  });

  it("seul un membre écrit ; l'auteur vient de la connexion, pas du message", async () => {
    const alice = await connect("alice");
    const bob = await connect("bob");
    const mallory = await connect("mallory");
    await alice.subscribe(channel);
    await bob.notify("room:send", {
      room: channel,
      text: "salut",
      author: "x",
    });
    await mallory.notify("room:send", { room: channel, text: "intrus" });
    await flush();
    expect(alice.messages(channel)).toEqual([
      { author: idOf("bob"), text: "salut" },
    ]);
  });

  it("exclu : `evicted` tout de suite, puis refusé à la page rechargée", async () => {
    const carol = await connect("carol");
    await carol.subscribe(channel);
    await flush();
    await exclude(channel, idOf("carol"));
    expect(closedOf(carol)).toEqual([{ channel, reason: "evicted" }]);
    const reloaded = await connect("carol"); // une page rechargée refait `subscribe`
    await reloaded.subscribe(channel);
    await flush();
    expect(reloaded.denials()).toHaveLength(1);
  });
});
```

**Pourquoi ce choix.** `allow` est appelé une seule fois par abonnement, jamais par message : une
requête en base y est normale. Exclure, c'est retirer l'appartenance **puis** éjecter. L'entrée
`room:send` n'hérite pas de la politique du canal : elle relit l'appartenance elle-même, et prend
l'auteur sur la connexion, jamais dans le message.

**Le piège.** Éjecter sans retirer l'appartenance, ou tenir une liste noire à côté : l'exclu
recharge sa page, son navigateur refait `subscribe`, et `allow` le laisse rentrer. Côté test :
écrire une appartenance pour un compte qui n'existe pas en base — refusée par la clé étrangère, ou,
si on renonce, un test qui ne prouve plus l'exclusion.

Le salon complet — historique, messages privés, présence : [Recette — un chat](cookbook-chat.md).

### Sonde et supervision

Des capteurs envoient des mesures ; les écrans de supervision les reçoivent.

<!-- example: sensors.ts -->

```ts
import { controller, route } from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";
import {
  RealtimeChannel,
  RealtimeController,
  RealtimeInbound,
  getRealtimeHub,
} from "@nodefony/realtime";

// Sa socket : `/api/sensor/realtime` (préfixe + route). Elle ne sert que les canaux déclarés ici.
@controller("/api/sensor")
export class SensorRealtime extends RealtimeController {
  constructor(context: ContextType) {
    super("SensorRealtime", context);
  }

  // Le point d'entrée : `handleRealtime` fait tout le protocole et route vers les décorateurs.
  @route("sensor-realtime", {
    path: "/realtime",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async realtime(message: string | Uint8Array | null): Promise<void> {
    this.handleRealtime(message);
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

Côté navigateur, l'écran lit ; côté atelier, une passerelle écrit avec son propre jeton :

<!-- example: sensors.client.ts -->

```ts
import { NodefonySocket } from "nodefony/client";

/** L'écran de supervision LIT (ROLE_SUPERVISOR) ; il ne peut rien pousser. */
export function watchDashboard(show: (reading: unknown) => void): () => void {
  const screen = NodefonySocket.shared({ url: "/api/sensor/realtime" });
  const off = screen.on("sensor:dashboard", show);
  screen.subscribe("sensor:dashboard");
  return off;
}

/** Une passerelle d'atelier (script Node) : jeton de portée `telemetry:write`, rien d'autre. */
export function openGateway(token: string): NodefonySocket {
  const gateway = new NodefonySocket({
    url: "https://supervision.example/api/sensor/realtime",
    token,
    maxBufferedAmount: 64 * 1024, // une mesure périmée se jette, elle ne s'empile pas
  });
  gateway.connect().catch(() => {}); // la reconnexion automatique prend le relais
  return gateway;
}

export function report(
  gateway: NodefonySocket,
  probe: string,
  value: number,
): void {
  gateway.emit("sensor:reading", { probe, value });
}
```

Le test donne un rôle à l'écran, une portée à la sonde, et vérifie que chacun reste à sa place :

<!-- example: sensors.test.ts -->

```ts
import { afterEach, describe, expect, it } from "vitest";
import { getRealtimeHub } from "@nodefony/realtime";
import { createRealtimeHarness } from "@nodefony/realtime/testing";
import type { IRealtimeHarness } from "@nodefony/realtime/testing";
import {
  createTestFrameAuthorizer,
  createTestIdentity,
} from "@nodefony/security/testing";
import { SensorRealtime } from "./sensors";

const open: IRealtimeHarness<SensorRealtime>[] = [];
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

async function connect(
  user: string,
  rights: { roles?: string[]; scopes?: string[] },
): Promise<IRealtimeHarness<SensorRealtime>> {
  const h = createRealtimeHarness((ctx) => new SensorRealtime(ctx), {
    identity: createTestIdentity({ identifier: user, ...rights }),
    frameAuthorizer: createTestFrameAuthorizer(getRealtimeHub()),
    resetHub: open.length === 0,
  });
  await h.connect();
  open.push(h);
  return h;
}

describe("sondes — la portée du jeton écrit, le rôle lit", () => {
  afterEach(() => {
    for (const h of open.splice(0)) h.close();
    getRealtimeHub().clear();
  });

  it("une mesure de sonde atteint l'écran ; une mesure malformée, nulle part", async () => {
    const screen = await connect("screen", { roles: ["ROLE_SUPERVISOR"] });
    const probe = await connect("probe-1", {
      roles: [],
      scopes: ["telemetry:write"],
    });
    await screen.subscribe("sensor:dashboard");
    await probe.notify("sensor:reading", { probe: "four-3", value: 812 });
    await probe.notify("sensor:reading", { probe: "four-3", value: "chaud" });
    await flush();
    expect(screen.messages("sensor:dashboard")).toEqual([
      { probe: "four-3", value: 812 },
    ]);
  });

  it("un écran ne pousse rien, un compte sans le rôle ne lit rien", async () => {
    const screen = await connect("screen", { roles: ["ROLE_SUPERVISOR"] });
    const visitor = await connect("visitor", { roles: ["ROLE_USER"] });
    await screen.subscribe("sensor:dashboard");
    await screen.notify("sensor:reading", { probe: "forged", value: 0 });
    await visitor.subscribe("sensor:dashboard");
    await flush();
    expect(screen.messages("sensor:dashboard")).toHaveLength(0);
    expect(visitor.denials().map((d) => d.channel)).toContain(
      "sensor:dashboard",
    );
  });
});
```

**Pourquoi ce choix.** Écrire et lire sont deux droits distincts : la sonde s'identifie par la
portée de son jeton (`telemetry:write`), l'écran par un rôle. Le canal du tableau n'a aucun
gestionnaire entrant : un écran ne peut rien y pousser.

**Le piège.** Un écran lent — un onglet en arrière-plan, un réseau faible — ne ralentit personne :
au-delà de sa file d'envoi, le serveur jette ce qui lui est destiné, puis le déconnecte. Ne
compensez pas par une file maison : ce serait garder en mémoire ce que l'écran ne lira jamais.
Réglages et mesures : [Cadence et contre-pression](cadence-et-contre-pression.md).

### Tableau de bord partagé

Une mesure par seconde, affichée sur autant d'écrans qu'on veut, pour le prix d'un seul calcul.

<!-- example: boardTicker.ts -->

```ts
import { controller, route } from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";
import {
  RealtimeChannel,
  RealtimeController,
  getRealtimeHub,
} from "@nodefony/realtime";

/** Cadence du tableau : une publication par seconde, quel que soit le nombre d'écrans. */
export const TICK_MS = 1000;

/** Ce que publie chaque tick — ici la mémoire du processus, en vrai un service. */
export function publishLoad(): void {
  const { rss, heapUsed } = process.memoryUsage();
  getRealtimeHub().publish("board:load", { rss, heap: heapUsed });
}

// Sa socket : `/api/board/realtime` (préfixe + route). Elle ne sert que les canaux déclarés ici.
@controller("/api/board")
export class BoardRealtime extends RealtimeController {
  constructor(context: ContextType) {
    super("BoardRealtime", context);
  }

  // Le point d'entrée : `handleRealtime` fait tout le protocole et route vers les décorateurs.
  @route("board-realtime", {
    path: "/realtime",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async realtime(message: string | Uint8Array | null): Promise<void> {
    this.handleRealtime(message);
  }

  // UN minuteur par serveur : créé au PREMIER écran, arrêté au DERNIER. Rien de
  // `this.context` ici : le producteur survit à la connexion qui l'a créé.
  @RealtimeChannel("board:load", { roles: ["ROLE_SUPERVISOR"] })
  load(): () => void {
    const timer = setInterval(publishLoad, TICK_MS);
    timer.unref(); // un serveur qui s'arrête n'attend pas le prochain tick
    return () => clearInterval(timer);
  }
}
```

Côté navigateur, chaque écran s'abonne, sans rien savoir des autres :

<!-- example: boardTicker.client.ts -->

```ts
import { NodefonySocket } from "nodefony/client";

const socket = NodefonySocket.shared({ url: "/api/board/realtime" });

/** Chaque écran s'abonne ; le serveur ne paie qu'un producteur pour tous. */
export function watchLoad(render: (load: unknown) => void): () => void {
  const off = socket.on("board:load", render); // charge réseau : la vérifier avant d'afficher
  socket.subscribe("board:load");
  return () => {
    off();
    socket.unsubscribe("board:load");
  };
}
```

Le test simule le seul minuteur du producteur, et compte ce que reçoit chaque écran :

<!-- example: boardTicker.test.ts -->

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRealtimeHub } from "@nodefony/realtime";
import { createRealtimeHarness } from "@nodefony/realtime/testing";
import type { IRealtimeHarness } from "@nodefony/realtime/testing";
import {
  createTestFrameAuthorizer,
  createTestIdentity,
} from "@nodefony/security/testing";
import { BoardRealtime, TICK_MS } from "./boardTicker";

const open: IRealtimeHarness<BoardRealtime>[] = [];

async function connect(
  user: string,
  roles: string[],
): Promise<IRealtimeHarness<BoardRealtime>> {
  const h = createRealtimeHarness((ctx) => new BoardRealtime(ctx), {
    identity: createTestIdentity({ identifier: user, roles }),
    frameAuthorizer: createTestFrameAuthorizer(getRealtimeHub()),
    resetHub: open.length === 0,
  });
  await h.connect();
  open.push(h);
  return h;
}

describe("tableau de bord — un producteur pour N écrans", () => {
  // Seul le minuteur du producteur est simulé : le reste du hub garde le vrai temps.
  beforeEach(() =>
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] }),
  );
  afterEach(() => {
    for (const h of open.splice(0)) h.close();
    getRealtimeHub().clear();
    vi.useRealTimers();
  });

  it("deux écrans, un tick : UNE publication chacun — jamais un minuteur par écran", async () => {
    const a = await connect("ops-a", ["ROLE_SUPERVISOR"]);
    const b = await connect("ops-b", ["ROLE_SUPERVISOR"]);
    await a.subscribe("board:load");
    await b.subscribe("board:load");
    vi.advanceTimersByTime(TICK_MS);
    expect(a.messages("board:load")).toHaveLength(1);
    expect(b.messages("board:load")).toHaveLength(1);
  });

  it("le dernier écran parti, le minuteur s'arrête", async () => {
    const a = await connect("ops-a", ["ROLE_SUPERVISOR"]);
    await a.subscribe("board:load");
    expect(vi.getTimerCount()).toBe(1);
    a.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("un compte sans le rôle est refusé", async () => {
    const visitor = await connect("visitor", ["ROLE_USER"]);
    await visitor.subscribe("board:load");
    expect(visitor.denials()).toMatchObject([
      { channel: "board:load", reason: "forbidden" },
    ]);
  });
});
```

**Pourquoi ce choix.** La fabrique du canal tourne au **premier** abonné et s'arrête au
**dernier** : le minuteur appartient au canal, pas à la connexion. Dix écrans coûtent une mesure par
seconde, pas dix.

**Le piège.** Lancer le minuteur dans le gestionnaire d'une connexion, ou y lire `this.context` :
chaque écran ajoute son minuteur, et le serveur publie N fois la même mesure à N écrans — N² messages
par seconde, sans une erreur.

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

<!-- example: userNotifications.client.ts -->

```ts
import { NodefonySocket } from "nodefony/client";
import type { IRealtimeContract } from "nodefony/client";

// La forme du message se déclare dans le contrat : `note` est typé à l'arrivée.
interface BillingContract extends IRealtimeContract {
  serverToClient: {
    [channel: `user:${string}`]: { kind: "invoice:paid"; invoice: string };
  };
}

// N'importe quelle socket temps réel de l'application : `user:<id>` est fourni
// par chacune, sans rien déclarer. Ici celle des sondes (`SensorRealtime`).
const socket = NodefonySocket.fromContract<BillingContract>({
  url: "/api/sensor/realtime",
});

/** Rien à connaître ni à construire : l'identifiant vient de l'accueil de la socket. */
export const stopListening = socket.onUser((note) =>
  console.log(`facture ${note.invoice} payée`),
);
```

Le test vérifie la destinataire, et qu'un autre compte n'entre pas sur son canal :

<!-- example: userNotifications.test.ts -->

```ts
import { afterEach, describe, expect, it } from "vitest";
import { getRealtimeHub } from "@nodefony/realtime";
import { createRealtimeHarness } from "@nodefony/realtime/testing";
import type { IRealtimeHarness } from "@nodefony/realtime/testing";
import { createTestIdentity } from "@nodefony/security/testing";
import { SensorRealtime } from "./sensors";
import { notifyInvoicePaid } from "./userNotifications";

const open: IRealtimeHarness<SensorRealtime>[] = [];
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** N'importe quel contrôleur temps réel : le canal personnel est fourni par le framework. */
async function connect(
  user: string,
): Promise<IRealtimeHarness<SensorRealtime>> {
  const h = createRealtimeHarness((ctx) => new SensorRealtime(ctx), {
    identity: createTestIdentity({ identifier: user }),
    resetHub: open.length === 0,
  });
  await h.connect();
  open.push(h);
  return h;
}

describe("notification privée — n'atteint que la personne visée", () => {
  afterEach(() => {
    for (const h of open.splice(0)) h.close();
    getRealtimeHub().clear();
  });

  it("alice reçoit, bob non, et personne n'entre sur le canal d'un autre", async () => {
    const alice = await connect("alice");
    const bob = await connect("bob");
    await alice.subscribe("user:alice"); // ce que fait `socket.onUser()`
    await bob.subscribe("user:bob");
    await bob.subscribe("user:alice");
    await flush();
    notifyInvoicePaid("alice", "F-2026-001");
    expect(alice.messages("user:alice")).toEqual([
      { kind: "invoice:paid", invoice: "F-2026-001" },
    ]);
    expect(bob.messages("user:alice")).toHaveLength(0);
    expect(bob.denials()).toMatchObject([
      { channel: "user:alice", reason: "forbidden" },
    ]);
  });
});
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
import { controller, route } from "@nodefony/framework";
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

// Sa socket : `/api/task/realtime` (préfixe + route). Elle ne sert que les canaux déclarés ici.
@controller("/api/task")
export class TaskRealtime extends RealtimeController {
  constructor(context: ContextType) {
    super("TaskRealtime", context);
  }

  // Le point d'entrée : `handleRealtime` fait tout le protocole et route vers les décorateurs.
  @route("task-realtime", {
    path: "/realtime",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async realtime(message: string | Uint8Array | null): Promise<void> {
    this.handleRealtime(message);
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

Côté navigateur, la réponse donne le nom du canal, que la socket suit déjà :

<!-- example: agentTask.client.ts -->

```ts
import { NodefonySocket } from "nodefony/client";

const socket = NodefonySocket.shared({ url: "/api/task/realtime" });

/** Démarre une tâche : le serveur nomme le canal, y abonne, puis le termine. */
export function startTask(
  onStep: (step: unknown) => void,
  onDone: () => void,
): void {
  socket.on("task:start", (reply) => {
    // Une charge reçue du réseau se vérifie avant usage.
    if (typeof reply !== "object" || reply === null || !("task" in reply))
      return;
    if (typeof reply.task === "string") socket.on(reply.task, onStep);
  });
  socket.onClosed(({ channel, reason }) => {
    if (channel.startsWith("task:") && reason === "ended") onDone();
  });
  socket.emit("task:start");
}
```

Le test suit la progression jusqu'à la fin, puis tente de deviner le canal d'un autre :

<!-- example: agentTask.test.ts -->

```ts
import { afterEach, describe, expect, it } from "vitest";
import { getRealtimeHub } from "@nodefony/realtime";
import { createRealtimeHarness } from "@nodefony/realtime/testing";
import type { IRealtimeHarness } from "@nodefony/realtime/testing";
import { createTestIdentity } from "@nodefony/security/testing";
import { TaskRealtime, owners } from "./agentTask";

const open: IRealtimeHarness<TaskRealtime>[] = [];
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

async function connect(user: string): Promise<IRealtimeHarness<TaskRealtime>> {
  const h = createRealtimeHarness((ctx) => new TaskRealtime(ctx), {
    identity: createTestIdentity({ identifier: user }),
    resetHub: open.length === 0,
  });
  await h.connect();
  open.push(h);
  return h;
}

const closedOf = (h: IRealtimeHarness<TaskRealtime>): unknown[] =>
  h.received.filter((f) => f.method === "realtime:closed").map((f) => f.params);

describe("tâche d'agent — le demandeur suit SA progression, puis reçoit `ended`", () => {
  afterEach(() => {
    for (const h of open.splice(0)) h.close();
    owners.clear();
    getRealtimeHub().clear();
  });

  it("progression puis fin, sur un canal que le serveur a nommé", async () => {
    const alice = await connect("alice");
    await alice.notify("task:start");
    for (let i = 0; i < 10; i++) await flush();
    const [task] = alice.subscriptions();
    expect(task).toMatch(/^task:/);
    expect(alice.messages("task:start")).toEqual([{ task }]);
    expect(alice.messages(task ?? "")).toEqual([
      { step: "lecture" },
      { step: "analyse" },
      { step: "rédaction" },
    ]);
    expect(closedOf(alice)).toEqual([{ channel: task, reason: "ended" }]);
  });

  it("un autre compte ne suit pas la tâche d'alice, même en devinant son nom", async () => {
    const alice = await connect("alice");
    await alice.notify("task:start");
    const [task] = alice.subscriptions(); // la tâche tourne encore
    const mallory = await connect("mallory");
    await mallory.subscribe(task ?? "task:devine");
    expect(mallory.denials()).toMatchObject([{ reason: "forbidden" }]);
  });
});
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

- **Exemples exécutés** : chaque bloc serveur et navigateur de cette page est un fichier de
  `nodefony/tests/fixtures/use-cases/` (le navigateur, typé), chaque bloc de test un fichier de
  `nodefony/tests/unit/use-cases/`, exécuté — dernière position seule et diffusion au tick,
  appartenance qui survit à la reconnexion, exclu qui ne revient pas, auteur pris sur la connexion,
  mesure malformée écartée, un minuteur pour N écrans, notification qui n'atteint que sa
  destinataire, progression puis `ended`.
- **Page et fichiers identiques** (`useCases.test.ts`) : chaque bloc marqué de cette page est
  comparé au fichier du dépôt, et chaque cas doit montrer ses trois fichiers ; un exemple corrigé
  d'un seul côté fait échouer la suite.

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Realtime — vue d'ensemble](index.md) · [Toute la documentation](../../../../../docs/index.md)
- [Canal à membres](canaux-a-membres.md) — abonner d'office, éjecter, terminer.
- [Sécurité](securite.md) — `allow`, ses formes, son délai ; le canal `user:<id>`.
- [Cadence et contre-pression](cadence-et-contre-pression.md) — bornes d'envoi et de réception.
- Décisions : ADR-0022 §5 (contre-pression, bornes) et §6 (canaux privés).
