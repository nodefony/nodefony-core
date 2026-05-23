---
module: global
topic: realtime-socket-nodefony
audience: [human, ai]
tags:
  [realtime, architecture, websocket, jsonrpc, sip, redis, backplane, vision]
status: vision
last-updated: 2026-05-23
deciders: [Christophe CAMENSULI]
---

# « La socket Nodefony » — vision realtime (NORTH STAR)

> Document de vision/architecture **transverse** (core + framework + studio + futurs
> redis/sip/media). Capture **précisément** la discussion d'architecture du 2026-05-23.
> C'est l'étoile polaire vers laquelle converge tout le travail realtime.
> Principe DX : **« la socket, c'est le patron »** — un consommateur ne parle JAMAIS au
> transport brut, il parle à la socket. (Vocabulaire : la **socket** = la prise que tient
> le métier ; le **hub** = le broker serveur caché qui aiguille entre les sockets + cross-pod.)

## 1. L'idée en une phrase

Le realtime Nodefony repose sur **une socket** entre le client et le back — **« la
socket Nodefony »** — qui a une **existence identique des deux côtés** (isomorphe), dont
le **plan de contrôle parle JSON-RPC 2.0**, et qui **multiplexe N canaux** par
souscription. Un consommateur (page front OU service back) tient **UN handle**
(`subscribe / on / publish / request`) et ignore le reste.

## 2. Le modèle en couches

```
NODEFONY SOCKET  IRealtimeSocket        ← 1 handle isomorphe (ce que tient le métier)
   │  plan de contrôle JSON-RPC, multiplexe N CANAUX (subscription)
   ├─ canal     IRealtimeChannel     ← sous-flux nommé DUPLEX, backing pluggable
   │     backings : pubsub | SIP (encapsulation) | bridge TCP/UDP | proxy
   ├─ fan-out   IRealtimeBackplane   ← in-memory → REDIS pub/sub (cross-pod, cloud-native)
   ├─ protocole JsonRpcPeer          ← classe/route/corrèle les frames (isomorphe)
   └─ octets    IRealtimeTransport   ← WS / ws / TCP / UDP (le SEUL maillon qui diffère)
```

- **2 couches isomorphes** (identiques client/serveur) : `IRealtimeSocket`, `JsonRpcPeer`.
- **2 seams polymorphes** : `IRealtimeTransport` (octets d'UN lien) et `IRealtimeBackplane`
  (diffusion ENTRE instances). Changer de seam ne change PAS le code métier ni le front.

## 3. La socket = le patron (règles d'or)

- Le métier parle **à la socket**, jamais au transport brut.
- Le **générique** vit dans la lib/le framework, **jamais dupliqué** (la cause d'un bug
  passé : la discrimination request/response vivait à 2 endroits divergents).
- Client et serveur sont **les deux bouts de la MÊME interface** — le pari isomorphe
  poussé au bout.

### Sémantique des verbes (identique des deux côtés, cible différente)

| Verbe                       | Côté client                                     | Côté hub serveur                            |
| --------------------------- | ----------------------------------------------- | ------------------------------------------- |
| `publish(canal, payload)`   | notification vers le serveur (1 pair)           | fan-out vers tous les abonnés (+ backplane) |
| `subscribe` / `unsubscribe` | demande/arrête un flux (ref-compté)             | idem, par connexion                         |
| `on` / `off`                | reçoit (≠ subscribe : branche le handler local) | idem                                        |
| `request(method, params?)`  | RPC corrélé (Promise du result)                 | idem                                        |

## 4. Un canal = un tuyau DUPLEX à backing PLUGGABLE

Chaque canal est **bidirectionnel**. Son **backing est pluggable côté serveur**,
transparent pour le consommateur :

- **pub/sub** (défaut) : notifications JSON-RPC (`dashboard:stats`).
- **encapsulation de protocole** : le canal transporte un AUTRE langage tunnelé dans la
  socket (ex. **SIP** sur `sip:line1`). « Le canal parle un autre langage. »
- **bridge** : canal câblé vers une autre couche de transport (**TCP/UDP**).
- **proxy** : canal qui relaie vers un autre service.

> Le **backplane Redis n'est qu'UN backing** (fan-out cross-pod) parmi ceux-là.
> Conséquence à implémenter côté serveur : un canal doit être **full-duplex** — router
> `publish` client → provider du canal, pas seulement pousser serveur → client.

## 5. Adressage d'un canal — décision : string + handle

Décision (2026-05-23) : **les deux, en couches.**

- Primitives `subscribe/on/publish` sur le hub (par **string**) = le moteur.
- `channel(name): IRealtimeChannel` = un objet « socket-like »
  `{ name, kind?, on, send, open, close }`, fine liaison au-dessus des primitives.

Pourquoi le **handle** est le bon point d'accroche des couches d'après : un canal SIP/
TCP/UDP est un **tuyau avec état** (un appel, une connexion). C'est sur cet objet que
viendront se brancher **sans retoucher le hub** : le **codec de protocole** (SIP), le
**bridge/proxy**, la **cadence AIMD par canal** et la **politique `drop|coalesce|batch`**.
On n'ajoute PAS encore ces champs — juste la coquille, comme extension point.

## 6. Cloud-native / cross-pod — le backplane

**Exigence** : un abonné à un canal doit pouvoir discuter même s'il n'est PAS sur le même
pod/réseau. ✅ Couvert par le **backplane sous le hub SERVEUR**. Le **client ignore les
pods** : il parle à sa socket locale.

```
Client A ──WS──► Pod 1 ─┐                          ┌─► Pod 2 ──WS──► Client B
  subscribe room:42      │                          │      subscribe room:42
                         ▼                          ▼
A: publish("room:42")  Pod1.hub.publish  ──►  BACKPLANE (Redis)  ──►  Pod2.hub (ingress)
                         │  fan-out LOCAL            pub/sub canal       │  fan-out LOCAL only
                         └─► abonnés Pod1                                └─► B reçoit ✅
```

**LA règle anti-boucle** : `publish` = fan-out local **+** forward backplane ; un message
venu **DU** backplane se fait **fan-out local SEULEMENT** (jamais re-forward). Nom de canal
**global** = clé de routage. = modèle Socket.IO redis-adapter / Phoenix.PubSub.

### Honnêteté — 3 points pas gratuits

1. **Déploiement, pas archi** : le backplane doit être un médium partagé joignable par tous
   les pods (Redis/NATS/cluster). Réseaux totalement isolés → relai/fédération (encore une
   impl de backplane).
2. **Backplane ≠ bridge/proxy** : backplane = scaling horizontal du MÊME app (broadcast
   cross-pod) ; bridge/proxy = canal câblé vers l'EXTÉRIEUR. Deux backings distincts.
3. **Cross-pod = plan PUB/SUB** (`publish`/`subscribe`). Le `request` RPC **ciblé** vers un
   pair distant précis (« à l'utilisateur X où qu'il soit ») = couche EN PLUS (annuaire
   qui-est-où + message backplane ciblé), pas gratuite avec le simple broadcast.

## 7. Faisabilité / dé-risquage

**Verdict : ambitieux en LARGEUR (catalogue de backings), PAS en difficulté d'algo.**
Aucune brique n'est de la recherche — chacune a une **référence éprouvée** : peer JSON-RPC
isomorphe (fait) · canaux multiplexés (Socket.IO rooms / Phoenix channels / ActionCable) ·
backplane Redis (`socket.io-redis-adapter`, `Phoenix.PubSub`) · bridge TCP/UDP (`node:net`/
`node:dgram`, Node pur) · SIP (SIP.js / RFC 7118).

**Le principe qui dé-risque** : des seams INDÉPENDANTS livrés un par un, avec un **produit
utile à CHAQUE étape** (Studio marche déjà ; +hub serveur = multi-clients propre ; +Redis =
cloud-native ; +bridge/AIMD/SIP = bonus optionnels). **Jamais de big-bang.** Déjà prouvé :
transport → peer → controller → contrat = 4 incréments verts.

Les 2 seuls points « rigueur » (pas ambition) : (1) le **hub serveur** (canaux partagés +
full-duplex + fan-out) = la vraie viande, discipline `memory.test` ; (2) **SIP/media** =
voir §8-9, on PORTE du code prod, on n'invente pas.

## 8. Preuve décisive — `nodefony-client` v6 tourne EN PROD (opérateur télécom)

Le nouveau modèle valide une couche realtime **déjà en production chez un opérateur
télécom** : `nodefony-client` (`/Users/cci/repository/nodefony-client`). Mapping :

| nodefony-client (prod)                                  | nodefony-core (nouveau)                  | nature                      |
| ------------------------------------------------------- | ---------------------------------------- | --------------------------- |
| `transports/{websocket,socket}`                         | `IRealtimeTransport`                     | **refait NEUF** (pas porté) |
| `sendAsync` + corrélation `nodefonyId`                  | `JsonRpcPeer.request` (id, JSON-RPC 2.0) | **refait NEUF**             |
| `transport.on("subscribe"/"unsubscribe")`               | `hub.subscribe/unsubscribe`              | **refait NEUF**             |
| `transport.on("sip", msg)`                              | `hub.channel("sip:…").on()`              | **contrat posé**            |
| `protocols/sip` (SDP 604L, dialog, transaction — 2345L) | backing SIP sur `IRealtimeChannel`       | **à PORTER (protocolaire)** |
| `protocols/bayeux` (pub/sub CometD)                     | canaux JSON-RPC natifs                   | remplacé                    |
| `medias/webrtc` + repo `nodefony-mediasoup`             | médias P15 (SFU)                         | infra existe                |

## 9. Directive de portage — PROTOCOLAIRE seulement, PAS le transport

**On NE reprend PAS l'ancienne couche `transports/`** (le neuf `IRealtimeTransport` +
`JsonRpcPeer` est meilleur). De `nodefony-client` on prend **UNIQUEMENT la partie
protocolaire** (`protocols/sip` : parsing SDP, dialogues, transactions, messages, timers de
retransmission) → on la glisse comme **backing d'un `IRealtimeChannel`**.

Pourquoi c'est sûr : le protocole SIP est **transport-agnostique** par nature (il
consomme/produit des messages texte). Dans l'ancienne lib il ne faisait déjà que
`transport.on("sip", msg)` + envoyer des strings → **déjà découplé**. Dans notre modèle :

```ts
inbound: channel.on((raw) => sip.receive(raw)); // le canal livre les messages SIP
outbound: channel.send(sipText); // le canal les renvoie
```

C'est même **plus propre** que l'ancien (où `Sip` tenait une réf directe au transport ;
maintenant découplé derrière le canal).

## 10. Proxy / bridge vers Asterisk

Le client parle **toujours** la nodefony socket (WSS) ; le serveur branche le canal `sip:…`
vers Asterisk avec le backing adéquat :

```
Client ──WSS──► Nodefony socket ──► canal "sip:line1" (backing) ──► Asterisk
                                       ├─ bridge : node:net  → TCP:5060  (Asterisk legacy, sans WS)
                                       └─ proxy  : ws client → WS/WSS     (Asterisk moderne, RFC 7118)
```

- **Asterisk legacy (sans transport WS)** → backing **bridge** WS↔TCP. La traduction de
  framing (frame WS ↔ Content-Length TCP) fait partie du protocolaire porté.
- **Asterisk moderne (transport WS)** → backing **proxy** WS↔WS, quasi-passthrough, plus simple.

On garde **les deux** backings (legacy + moderne ; vaut aussi pour Kamailio/FreeSWITCH).

**Pourquoi proxifier par Nodefony même si Asterisk fait du WS** (valeur, pas contournement) :
point d'entrée TLS unique + auth/firewall, multiplexage SIP sur le même socket que les
autres canaux, observabilité (debug bar/Studio), cross-pod.

**Deux modes**, les deux supportés : **proxy bête** (relai d'octets, Nodefony ne parse pas
SIP — trivial) ou **B2BUA intelligent** (Nodefony parse, réécrit Via/Contact pour le NAT,
enregistre — utilise le protocolaire SIP porté).

## 11. État & suite

**Fait (2026-05-23) :**

- ✅ `JsonRpcPeer` (protocole isomorphe), `IRealtimeTransport` (seam octets),
  `RealtimeController` (base serveur), `WsConnectionTransport`.
- ✅ **Contrat socket** : `IRealtimeSocket` + `IRealtimeChannel` + `IChannelStats` (core
  `src/nodefony/src/realtime/`) ; `RealtimeClient implements IRealtimeSocket` (1ʳᵉ impl,
  `publish()`/`channel()`, `MessageStats` = alias). Tests conformité 5/5.
- ✅ **Hub serveur** : `RealtimeHub` (framework, broker per-instance) = canaux **partagés**
  (1 provider/canal/pod au lieu de N per-connexion) + fan-out + dispose au dernier abonné.
  `RealtimeController` délègue subscribe/publish/cleanup au hub ; `StudioRealtimeController`
  capture ses deps long-lived (provider partagé survit à la connexion créatrice). Tests hub
  5/5 + controller verts ; `memory.test` WS vert (100 conns < 30 MB).
- ✅ **Full-duplex (entrant, gated)** : hook `realtimeInbound()` du `RealtimeController` →
  un client `publish(channel, payload)` sur un canal **déclaré** atteint un
  `RealtimeInboundHandler` per-connexion `(params, reply)`. **Sûr par défaut** (aucun canal
  entrant tant que non déclaré) ; params NON FIABLES (Zero Trust). C'est le seam des backings
  entrants (SIP, bridge). 0 lookup sur le chemin notification si aucun canal entrant.

**Reste, dans l'ordre :**

1. **Backplane Redis** : un backing fan-out derrière `RealtimeHub.publish` (cross-pod, anti-boucle).
2. **Bridge TCP/UDP** (Node pur, faible risque) + **canaux privés/per-connexion** (mode SIP-ligne).
3. **AIMD** (cadence adaptative par canal) → s'accroche à `IRealtimeChannel`.
4. **SIP** (porter le protocolaire `nodefony-client`) + **médias** (P15 ; SFU mediasoup ; Asterisk = serveur).
5. **Façade `IRealtimeSocket` serveur** (un service back tient une socket : publish/on via le hub).

## Références

- Code : `src/nodefony/src/realtime/` (`IRealtimeSocket`, `IRealtimeChannel`, `JsonRpcPeer`,
  `IRealtimeTransport`), `src/nodefony/src/client/realtime/RealtimeClient.ts`,
  `src/packages/@nodefony/framework/nodefony/src/` (`RealtimeController.ts`, `RealtimeHub.ts` = broker).
- Lib prod de référence : `/Users/cci/repository/nodefony-client` (`protocols/sip`, `medias`).
- ADR-0002 — schéma conférence WebRTC/mediasoup ([`../adr/0002-schema-conference-webrtc-mediasoup.md`](../adr/0002-schema-conference-webrtc-mediasoup.md)).
