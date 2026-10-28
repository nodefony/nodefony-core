---
adr: 21
title: Temps réel — un événement générique, plusieurs livraisons
lang: fr
navTitle: Temps réel, le socle
date: 2026-10-28
status: proposed
deciders: [Christophe CAMENSULI]
tags: [realtime, websocket, sse, webhooks, backplane, design, compatibility]
---

# ADR-0021 — Temps réel : un événement générique, plusieurs livraisons

## Statut

Proposé (2026-10-28), brouillon soumis à l'auteur. Socle commun des décisions temps réel :
[ADR-0022](0022-socket-temps-reel.md) (la socket, #627) et
[ADR-0023](0023-webhooks-evenements-et-abonnements.md) (les webhooks) en dépendent ; l'ADR de
gRPC naîtra avec l'Epic #694. Instruit par un relevé des quatre briques existantes et par le
protocole A2A 1.0.1, figé hors ligne pour vérifier que rien ici n'empêche de le bâtir dessus.

## Contexte

Nodefony est un framework **générique**. Son temps réel sert une discussion en direct, un
tableau de bord, un jeu, un éditeur partagé, des capteurs, des notifications, un flux de média,
et aussi des agents — sans être taillé pour aucun de ces usages. Le framework fournit des
**briques** ; les protocoles qu'on bâtit avec elles (une liaison A2A, un service gRPC, une porte
MCP, un webhook métier) en sont des **consommateurs**.

Quatre manières de livrer un événement existent déjà :

| Livraison | Brique                                                                                        | Connexion                          |
| --------- | --------------------------------------------------------------------------------------------- | ---------------------------------- |
| Socket    | `@nodefony/realtime` (hub, canaux) sur WebSocket, client `nodefony/client`                    | ouverte, dans les deux sens        |
| Flux SSE  | `src/packages/@nodefony/http/nodefony/src/context/http/SseStream.ts#SseStream`                | ouverte, du serveur vers le client |
| Webhook   | `src/packages/@nodefony/security/nodefony/src/webhook/WebhookDispatcher.ts#WebhookDispatcher` | aucune : un `POST` par événement   |
| gRPC      | POC #690, Epic #694 (10.1)                                                                    | un flux HTTP/2 par appel           |

Entre deux exemplaires de l'application, le **backplane** relaie la socket
(`src/packages/@nodefony/realtime/nodefony/interfaces/IBackplane.ts#IBackplaneMessage`).

**Ce qui est déjà commun.** Les quatre livraisons transportent la même paire, **(canal, charge)**,
sous des noms différents. Le hub publie `publish(channel, payload)`, la frame de socket porte
`{ method: canal, params: charge }`, le backplane `{ channel, payload }`, un flux SSE
`event` / `data`, un webhook `type` / `data`. L'identité suit déjà une seule règle : un verdict par
canal, le même pour annoncer et pour admettre, revalidé toutes les 30 secondes pour la socket
comme pour SSE (`src/packages/@nodefony/http/nodefony/service/http-kernel.ts#HttpKernel.revalidateStreams`).
Et un même producteur nourrit déjà plusieurs livraisons sans qu'aucune le sache : l'audit de
sécurité alimente à la fois un canal de la socket et les webhooks.

**Ce qui est dupliqué.** Cinq vocabulaires pour dire « j'ai jeté un message » (socket, SSE,
webhooks, backplane, MCP), deux grammaires de motif de nom (politique de canal, abonnement de
webhook), et aucune garantie d'ordre ni de livraison écrite où que ce soit.

**Pourquoi maintenant.** Après la publication de 10.0, changer ce qu'une application reçoit est
une rupture, même à types identiques ([politique de compatibilité](../guides/compatibilite.md)).
Ce document ne demande pas de coder les quatre livraisons avant la bêta. Il décide ce qui
deviendrait une rupture si on le décidait plus tard, et écarte le reste du socle.

**La règle de généricité** (déjà posée par l'Epic #621) : une décision n'entre au socle que si
elle sert **au moins trois usages hétérogènes**, dont un sans agent ni IA et un sans média. À
défaut, elle appartient à la brique qui la consomme. Un protocole tiers n'est jamais une source
d'exigence : il sert de **contrôle de non-blocage** — peut-il se bâtir au-dessus sans que le
socle le connaisse ?

## Décision

Chaque point porte ses usages et répond à une question : **rupture si on le décidait après 10.0 ?**

### S1. L'événement est `(canal, charge)`, et la charge reste nue

**Décision (validée par l’auteur le 2026-10-28) :** un événement est un nom de canal et une charge. Sur la socket, la charge
est `params`, telle que le producteur l'a publiée, sans enveloppe, pour toute la série 10. Ce
qu'un canal garantit en plus (acquittement, reprise, cadence) se **déclare une fois par canal**,
dans un champ optionnel de l'accueil `realtime:welcome`, jamais dans chaque frame.

- Usages : une discussion (un texte), un tableau de bord (un point de série), un capteur (une mesure).
- Écarté : une enveloppe `{ seq, ts, data }` par frame. Elle alloue à chaque frame, et change le
  fil comme le type reçu par chaque gestionnaire.
- **Rupture si différé : OUI.** Ajouter une enveloppe après 10.0 change ce que reçoit chaque
  application. Écrire maintenant que la charge reste nue ferme cette porte pour la série.

### S2. Pas d'identifiant ni de séquence imposés par le socle

**Décision (validée par l’auteur le 2026-10-28) :** le socle ne numérote pas les événements. Un producteur qui sait
numéroter le fait dans **sa** charge, avec **son** identifiant : un journal par son numéro de
ligne, un document partagé par son vecteur d'état, une notification par l'identifiant de sa ligne
en base. C'est déjà ce que font l'audit et le flux de journaux en SSE.

- Écarté : un compteur par canal posé par le hub. Il ne serait ordonné que dans un exemplaire, et
  donnerait une fausse garantie entre exemplaires.
- **Rupture si différé : NON.** Un type utilitaire facultatif reste possible plus tard.

### S3. Aucune politique de reprise imposée

**Décision (validée par l’auteur le 2026-10-28) :** après une coupure, le socle n'impose ni
relecture, ni instantané, et **ne conserve aucun événement** : pas de tampon, pas de journal. Il
rend la reprise **possible** : un abonnement pourra porter un **curseur optionnel**, remis à un
**rattrapage propre à l'abonné**, qui relit la **source du canal** (la base d'une discussion, le
tampon qu'un service tient déjà) et décide quoi renvoyer à cet abonné seul (la suite depuis le
curseur, l'état courant, ou rien), avant de le brancher sur le flux partagé. Un canal sans source
ne rejoue rien ; un canal sans rattrapage déclaré ne coûte rien.

Le curseur ne va **pas** à la fabrique du canal : elle n'est appelée qu'au premier abonné, puis
partagée par tous (`src/packages/@nodefony/realtime/nodefony/src/server/RealtimeController.ts#RealtimeController.startChannel`) ;
elle ne verrait jamais le curseur d'un abonné arrivé après, et un rejeu de sa part partirait chez
tous. Le patron existe déjà côté SSE, où chaque requête relit `Last-Event-ID` et rejoue depuis le
tampon que syslog tient déjà (`src/modules/test/nodefony/controller/LiveSyslogController.ts#LiveSyslogController.stream`).

- Usages : reprendre une discussion au dernier message vu, une courbe au dernier point, des
  notifications manquées.
- Écarté : « l'instantané, puis la suite » comme règle du socle. C'est le choix d'un protocole
  (A2A le fait), que sa liaison peut faire au-dessus du curseur.
- Écarté : un tampon d'événements tenu par le socle. Il coûterait de la mémoire à chaque canal,
  servi ou non, pour une reprise que la source du canal sait déjà faire.
- **Rupture si différé : NON**, à une condition : qu'un serveur 10.0 ignore un champ inconnu dans
  un abonnement. C'est le cas : seul `params.channel` est lu
  (`src/packages/@nodefony/realtime/nodefony/src/server/RealtimeController.ts#channelParam`), et
  `realtimeSubscribedAck.test.ts` le fige (« un champ inconnu est ignoré », vu rouge sous une
  lecture stricte). Mécanique de la socket : [ADR-0022](0022-socket-temps-reel.md).

### S4. La fin d'un flux est un signal à motif fermé

**Décision (validée par l’auteur le 2026-10-28) :** quand un canal se termine côté serveur,
l'abonné le **sait**, par un signal dont le motif appartient à une liste fermée. Sur la socket,
c'est une notification `realtime:closed { channel, reason }`, ajoutée en 10.x, avec deux motifs :
`ended` (le canal est terminé pour tous) et `evicted` (cette connexion en est retirée). Un client
qui la reçoit retire l'abonnement et ne le rejoue pas. En SSE, la fin est la fermeture du flux, et
le code 204 dit de ne pas se reconnecter.

**Règle pour les clients qui ignorent `closed`** : un client 10.0 garde l'abonnement et le
**rejoue à sa reconnexion** (`src/nodefony/src/client/realtime/NodefonySocket.ts#NodefonySocket.replaySubscriptions`).
C'est donc à la **fabrique** d'un canal à durée de vie de refuser un canal terminé : elle rend
`null`, et le client reçoit `realtime:denied { reason: "unknown" }`, qu'il sait lire. Sans cette
règle, un vieil onglet relancerait un import achevé. Aucun code dans le socle : une consigne
d'écriture des canaux.

- Usages : un appel qui se termine, une partie finie, un import de fichier achevé.
- Écarté : réutiliser le refus `realtime:denied` avec un motif neuf. Ses motifs sont gelés (#630),
  et une fin normale n'est pas un refus : l'écran doit pouvoir dire « terminé », pas « refusé ».
- **Rupture si différé : NON.** Une notification inconnue est passée aux seuls gestionnaires
  inscrits par un client 10.0, sans autre effet
  (`src/nodefony/src/client/realtime/NodefonySocket.ts#NodefonySocket.dispatchNotification`).

### S5. Les garanties d'ordre et de livraison sont écrites

**Décision (validée par l’auteur le 2026-10-28) :** le framework promet ceci, et rien de plus.

| Livraison | Ordre                                                                  | Livraison                               | En cas de perte                                                                                                                                                   |
| --------- | ---------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Socket    | par flux et par émetteur ; jamais entre émetteurs ni entre exemplaires | au plus une fois                        | un trou, jamais un réordonnancement : une frame que la file d'envoi ne peut plus prendre est jetée ; un client qui ne draine plus rien est fermé (`1013`)         |
| Flux SSE  | par flux                                                               | au plus une fois                        | un trou ; la reprise appartient à l'action (S3)                                                                                                                   |
| Webhook   | **aucun** : des réessais en parallèle peuvent inverser deux événements | plusieurs tentatives, **sans garantie** | doublon possible : le destinataire déduplique par `webhook-id` ; perte possible (file pleine, réessais épuisés, redémarrage) : le destinataire rapproche lui-même |
| Backplane | par émetteur                                                           | au plus une fois, sans anti-rejeu       | un trou                                                                                                                                                           |

**Pourquoi « sans garantie » et pas « au moins une fois » pour le webhook.** La file des
livraisons vit en mémoire (`src/packages/@nodefony/security/nodefony/src/webhook/WebhookDispatcher.ts#WebhookDispatcher`) :
une livraison est abandonnée quand la file est pleine, après le dernier réessai, ou au
redémarrage du process, et le compteur `dropped` la rend visible. Promettre « au moins une fois »
exigerait une file durable, donc de stocker des événements — ce que S3 écarte du socle. Un
réessai garde le même `webhook-id` que la tentative échouée, ce qui rend le doublon
dédupliquable. Passer plus tard à une livraison garantie est un ajout ; l'inverse serait une
rupture.

**Socket : jeter avant de fermer.** Par défaut (`backpressurePolicy: "drop"`), une frame qui
dépasse le seuil d'envoi est jetée et le client reste connecté ; il n'est fermé (`1013`) qu'au-delà
d'un solde de frames refusées (`backpressureCloseAfterDrops`, 1 000 par défaut). Règle unique :
`src/packages/@nodefony/http/nodefony/src/context/websocket/wsBackpressure.ts#decideSend`.

- **Rupture si différé : NON**, mais l'écrire avant 10.0 protège. Non écrite, une garantie que le
  framework ne tient pas (un ordre global entre exemplaires) peut être supposée par une
  application. Un correctif de file serait alors vécu comme une rupture.

### S6. L'enveloppe entre exemplaires est figée

**Décision (validée par l’auteur le 2026-10-28) :** le message du backplane reste
`{ channel, payload, originId }` pour toute la série, scellé sur ces trois champs exactement
(`src/packages/@nodefony/realtime/nodefony/src/backplane/envelope.ts#sealBackplaneEnvelope`).
Toute extension vit **dans** `payload`.

Le figement ne ferme pas la porte au **binaire**. Des octets traverseront le bus **bruts**, sur
un **second sujet versionné** — un en-tête court (canal, origine, sceau) suivi des octets, sans
conversion — que les exemplaires plus anciens n'écoutent pas : ce message-ci n'est pas touché.
Le client Redis l'autorise (`publish` accepte des octets, `subscribe` en mode tampon les rend
bruts). Mécanique dans #618. Écarté : des octets encodés en base64 dans `payload` (un tiers plus
lourd, et du calcul à chaque message).

Jusque-là, des octets publiés sur un canal diffusé **ne partent pas sur le bus** : ils restent
livrés intacts aux abonnés locaux, et l'exploitant est prévenu une fois
(`src/packages/@nodefony/realtime/nodefony/src/server/RealtimeHub.ts#RealtimeHub.publish`). Avant
ce garde-fou, `JSON.stringify` les rendait en objet ordinaire (`{"0":1,"1":2}`), sans erreur.

- Usages : un cluster Kubernetes, `nodefony cluster -w N` sur une machine, un pilote de bus écrit
  par une application (l'interface est publique).
- Écarté : un champ neuf au premier niveau. Signé, il fait refuser les messages entre deux
  versions pendant un déploiement progressif ; non signé, il est falsifiable.
- **Rupture si différé : OUI.** Pendant un déploiement progressif, un exemplaire 10.x et un
  exemplaire 10.y cohabitent : changer ce que signe le sceau ferait refuser leurs messages.

### S7. Pas de propriétaire dans l'événement

**Décision (validée par l’auteur le 2026-10-28) :** l'événement ne porte ni propriétaire, ni
ressource. La ressource **est** le canal ; l'appartenance est un **prédicat d'admission** évalué sur
le nom du canal (#622).

- Usages : une diffusion publique (sans propriétaire), un canal `user:42` (un prédicat), un appel
  (la liste des participants est un prédicat).
- **Rupture si différé : NON.**

**Pourquoi à l'abonnement et pas à chaque envoi.** Un contrôle par `subscribe`, zéro par frame :
filtrer chaque événement sur un `owner` coûterait un test par abonné et par message, et
l'enveloppe de backplane, figée (S6), n'a pas de place pour lui. Un `owner` glissé dans la charge
ne protège rien : le socle ne le lit pas. L'admission passe aujourd'hui par
`src/packages/@nodefony/realtime/nodefony/src/server/RealtimeHub.ts#RealtimeHub.resolveChannelPolicy`,
qui ne regarde que la connexion, les rôles et les scopes : la règle évaluée sur le nom du canal
(`user:42` réservé à l'utilisateur 42) est l'objet de #622.

### S8. Des octets sont des `Uint8Array`, et chaque transport dit comment il les porte

**Décision (validée par l’auteur le 2026-10-28) :** une charge est compatible avec JSON, ou ce
sont des octets, et des octets sont un `Uint8Array` des deux côtés
(`src/nodefony/src/realtime/IRealtimeTransport.ts#RealtimeFrameData`). Chaque transport déclare sa
manière, jamais un `JSON.stringify` qui rendrait un objet (`[1, 2, 255]` devient
`{"0":1,"1":2,"2":255}`, sans erreur).

| Transport | Ce que le code tient                                                                                                                                                                                                                    |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Socket    | trame binaire, octets intacts                                                                                                                                                                                                           |
| Backplane | **refusés** plutôt que déformés : livrés aux seuls abonnés locaux, l'exploitant prévenu une fois (`src/packages/@nodefony/realtime/nodefony/src/server/RealtimeHub.ts#RealtimeHub.publish`) ; voie brute sur un second sujet (S6, #618) |
| Flux SSE  | **déformés aujourd'hui** : `src/packages/@nodefony/http/nodefony/src/context/http/SseStream.ts#serialize` passe des octets par `JSON.stringify` — à trancher (S8 bis)                                                                   |

- Usages : de la voix, un document partagé, de la télémétrie binaire.
- **Rupture si différé : NON.** Mais une application qui décoderait la forme déformée casserait au
  correctif : la règle est écrite avant 10.0 pour que cette forme ne soit jamais une promesse.

### S9. Un seul vocabulaire pour compter ce qui part et ce qui se perd

**Décision proposée :** les livraisons exposent les mêmes compteurs, avec des membres optionnels :
envoyés, jetés, octets en attente. Socket, SSE, webhooks et backplane y viennent ; la console
d'administration les lit d'une seule manière. Ces compteurs restent hors du chemin de chaque frame.

- **Rupture si différé : NON.**

### Ce qui reste hors du socle

- **Plusieurs locataires** (`tenant` d'A2A, `tenantId` des webhooks, espace de noms du backplane) :
  un seul usage connu, la règle de généricité n'est pas remplie. Le nom du canal et le prédicat
  d'admission suffisent.
- **gRPC** : un service de `@nodefony/http`, expérimental en 10.1. Un service qui diffuse appelle
  le hub (`RealtimeService.publish`) ; le socle n'a rien à lui ajouter.
- **Un contrat typé commun** au-delà de la socket : `SseStream.send` pourra accepter plus tard le
  même générique de carte d'événements, ajouté en fin avec un défaut.

## Alternatives écartées

- **Une enveloppe par frame** (S1) : allocation par frame, rupture de fil, et une fausse
  promesse d'ordre global.
- **Un numéro de séquence posé par le hub** (S2) : ordonné dans un seul exemplaire.
- **Une politique de reprise imposée** (S3) : un choix de protocole présenté comme une règle
  générique.
- **Un propriétaire dans l'événement** (S7) : sans objet pour une diffusion.
- **Une enveloppe de backplane extensible au premier niveau** (S6) : déploiements progressifs cassés.
- **Un socle multi-locataire** : un usage, pas trois.

## Contrôle de non-blocage

Les protocoles bâtis au-dessus vérifient le socle ; ils ne le définissent pas.

| Protocole                                  | Ce qu'il lui faut                                                         | Empêché par le socle ?                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| A2A 1.0.1, liaison WebSocket personnalisée | ordre par flux, fin de flux, reprise, paramètres de service hors en-têtes | **non** : un contrôleur consommateur expose la liaison (S1, S3, S4)                                                            |
| A2A, flux en SSE                           | un événement par `data:`, reprise                                         | **non**                                                                                                                        |
| A2A, notifications poussées                | le même objet que le flux, au moins une fois, dédupliqué                  | **non par le socle** ; deux manques dans la brique webhook, traités par [ADR-0023](0023-webhooks-evenements-et-abonnements.md) |
| MCP 2026-07-28                             | JSON-RPC 2.0, flux de réponse SSE, sans reprise                           | **non** ; il consomme `SseStream` et le JSON-RPC du cœur sans que rien y soit taillé pour lui                                  |
| gRPC                                       | ordre par flux HTTP/2, trailers                                           | **non** ; hors du hub                                                                                                          |

## Conséquences

- La charge nue (S1) et l'enveloppe de backplane figée (S6) deviennent des engagements de la série
  10, au même titre que les décisions de gel de #630.
- Les garanties de S5 entrent dans la documentation de chaque livraison. Elles décrivent ce qui est
  vrai, rien de plus.
- **Preuves à apporter avant 10.0 :**
  - des fixtures d'octets dorées de l'enveloppe de backplane (#629) ;
  - le passage d'un `Uint8Array` par le pilote Redis (#618) ;
  - la tolérance d'un champ inconnu dans un abonnement (ADR-0022).
- Le curseur de reprise (S3) et les compteurs communs (S9) sont des ajouts, prévus après 10.0.

## Références

- JSON-RPC 2.0 — <https://www.jsonrpc.org/specification>
- RFC 6455, The WebSocket Protocol — <https://www.rfc-editor.org/rfc/rfc6455>
- Server-sent events, WHATWG HTML §9.2 — <https://html.spec.whatwg.org/multipage/server-sent-events.html>
- RFC 8949, CBOR — <https://www.rfc-editor.org/rfc/rfc8949>
- Standard Webhooks — <https://www.standardwebhooks.com/>
- A2A 1.0.1 — <https://a2a-protocol.org/v1.0.0/specification> (§3.5, §4.3.3, §5.8, §12)
- [Politique de compatibilité](../guides/compatibilite.md)
- Tickets : #621 (Epic, règle de généricité), #627, #630 (décisions de gel), #618, #622, #623, #629
