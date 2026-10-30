---
adr: 21
title: Temps réel — un événement générique, plusieurs livraisons
lang: fr
navTitle: Temps réel, le socle
date: 2026-10-28
status: accepted
deciders: [Christophe CAMENSULI]
tags: [realtime, websocket, sse, webhooks, backplane, design, compatibility]
---

# ADR-0021 — Temps réel : un événement générique, plusieurs livraisons

## Statut

Accepté (2026-10-28), décision par décision (S1 à S9) avec l’auteur. Rouvert par l'auteur le
2026-10-29, après une table d'experts (catalogue `scenarios/temps-reel.md`), pour trois
amendements : la charge est structurée (S1), un sceau refusé se compte et le rejeu d'un ordre
se pare par sa cible (S6), l'unité des compteurs (S9). Complété le 2026-10-30 par les règles
communes aux trois livraisons (#702) : l'identité d'admission (S10). Amendé le 2026-10-30 par la
table d'experts du gel (7 sièges, deux tours, aucun vote contre) : les refus se comptent par cause
(S9), `allow` perd son troisième argument au profit d'une classe injectable, son délai et sa
saturation ont un motif `unavailable` (S10 bis), une socket dont le jeton porteur expire se ferme
en `4006` et une authentification trop lente en `1013` (S11). Revu avant le gel (revue finale,
24 constats, #702) : au-delà du plafond d'appels d'`allow` en vol, une demande attend son tour au
lieu d'être refusée (S10 bis), et la règle du flux SSE d'un canal est écrite (S10 ter). Socle commun des décisions temps réel :
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

**Amendement (validé par l'auteur le 2026-10-29) : la charge est un objet ou un tableau.**
JSON-RPC 2.0 (§4.2) exige que `params` soit structuré ; un pair écrit dans un autre langage
refuse la frame d'un scalaire (S-rt-43). `RealtimeHub.publish` refusera donc (#704, 10.0) une
charge qui n'est ni un objet ni un tableau — nombre, chaîne, booléen, `null` —, en le nommant. Un
scalaire se publie dans un objet (`{ value: 42 }`) ; des octets restent admis (S8). Le contrôle
est une règle pure au cœur (`isRealtimePayload`), un `typeof` par publication, hors du chemin de
chaque connexion.

**Une charge ABSENTE reste admise** : JSON-RPC autorise une notification sans `params`, et
`publish(canal)` sans charge est un signal légitime (une fin de compilation, un « rafraîchis »).
Elle part sans `params` et arrive `undefined` chez l'abonné, **quel que soit le bus**. Aujourd'hui
ce n'est pas le cas : sous le sceau elle voyage en `null` et arrive `null`, sans sceau elle arrive
`undefined` (`envelope.ts#sealBackplaneEnvelope`). Ce que signe le sceau ne change pas — `null`
y reste le texte signé d'une charge absente ; c'est le récepteur qui rend `undefined`, sans
ambiguïté puisque `null` n'est plus une charge valide.

- Écarté : tolérer le scalaire comme dérogation écrite à JSON-RPC. La socket se dit lisible par un
  pair d'un autre langage (ADR-0022) ; une dérogation le démentirait pour un gain nul.
- **Rupture si différé : OUI.** Refuser un scalaire après 10.0 casse qui en publie déjà.

**Le moule typé des trois livraisons est figé par [ADR-0022](0022-socket-temps-reel.md) §4** : le
MÊME `IRealtimeContract` type la socket, le flux SSE et le webhook ; le code suit (#628), la forme
est figée avec 10.0.

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
redémarrage du process ; une ligne de journal (la première perte, puis une sur cent) et
`droppedCount()` la rendent visible, et l'exposition en console vient avec le vocabulaire S9
(10.x). Promettre « au moins une fois »
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

**Précisions (validées par l'auteur le 2026-10-29)**, aucune ne touche à ce que signe le sceau :

- **Un sceau refusé se compte et se journalise.** Aujourd'hui il disparaît sans trace
  (`src/packages/@nodefony/realtime/nodefony/src/backplane/RedisBackplane.ts#RedisBackplane.#ingress`) :
  une rotation de secret ou un producteur mal configuré perd des messages en silence (S-rt-34).
  Un compteur `sealRejectedTotal` et une ligne de journal (la première, puis une sur cent).
- **La forme signée n'est pas promise comme « la sérialisation du moteur JavaScript ».**
  Le récepteur recalcule le sceau sur sa propre re-sérialisation de la charge
  (`envelope.ts#openBackplaneEnvelope`) ; un producteur écrit dans un autre langage n'est donc pas
  garanti en 10.0 (S-rt-44). Vérifier aussi le sceau sur les octets reçus reste un élargissement
  possible en 10.x : il accepte strictement plus, aucun exemplaire ne refuse ce qu'il acceptait.
- **La rotation du secret.** Un seul secret est lu : pendant la fenêtre où les exemplaires n'ont
  pas le même, leurs messages se refusent — comptés par `sealRejectedTotal`, écrit dans la page
  d'exploitation. Accepter un second secret en lecture est un ajout de 10.x.
- **Le rejeu reste hors du sceau ; un ordre se pare par sa cible.** Un message rejoué ne fait que
  rediffuser une charge, sauf s'il porte un ordre (ADR-0022 §6) : un ordre désigne alors une
  **instance** — l'admission qu'il révoque, la partie qu'il ferme —, jamais un nom seul, de sorte
  qu'un ordre rejoué ne désigne plus rien de vivant. Écarté : un numéro d'ordre par émetteur dans
  l'enveloppe, demandé par le siège attaquant. Il ne protège pas un exemplaire démarré après
  l'émetteur, et un second sceau qui le couvre pourra s'ajouter en 10.x sans rupture : lu s'il est
  présent, exigé par une option une fois tout le parc à jour.

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

| Transport | Ce que le code tient                                                                                                                                                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Socket    | trame binaire, octets intacts                                                                                                                                                                                                              |
| Backplane | **refusés** plutôt que déformés : livrés aux seuls abonnés locaux, l'exploitant prévenu une fois (`src/packages/@nodefony/realtime/nodefony/src/server/RealtimeHub.ts#RealtimeHub.publish`) ; voie brute sur un second sujet (S6, #618)    |
| Flux SSE  | **refusés** : `TypeError` qui dit d'encoder soi-même en base64 avec le type MIME (`src/packages/@nodefony/http/nodefony/src/context/http/SseStream.ts#serialize`) — un flux SSE n'est que du texte UTF-8 (WHATWG HTML §9.2)                |
| Webhook   | **sans objet en 10.0** : seuls les événements de sécurité partent, sans octets ; la règle se décide avec l'émission applicative (ADR-0023 W3, 10.1), sous la contrainte « jamais des octets déformés » (S-rt-3) — table du gel, 2026-10-30 |

Un `Uint8Array` IMBRIQUÉ dans une charge JSON suit la convention du codec
([ADR-0022](0022-socket-temps-reel.md) §3, #618 : chaîne d'octets en CBOR, base64 déclaré en
JSON) ; jusque-là il est déformé en objet, sur toute livraison — la garde ne regarde que le
premier niveau —, et cette forme n'est pas une promesse (S-rt-56).

- Usages : de la voix, un document partagé, de la télémétrie binaire.
- **Rupture si différé : NON.** Mais une application qui décoderait la forme déformée casserait au
  correctif : la règle est écrite avant 10.0 pour que cette forme ne soit jamais une promesse.

### S9. Un seul vocabulaire pour compter ce qui part et ce qui se perd

**Décision (validée par l’auteur le 2026-10-28) :** les livraisons exposent les mêmes compteurs,
tous facultatifs : chacune ne remplit que ceux qui la concernent. Socket, SSE, webhooks et backplane
y viennent ; la console d'administration les lit d'une seule manière. Ces compteurs restent hors du
chemin de chaque frame : on les lit à la demande, on ne les calcule pas à chaque envoi.

| Nom            | Ce qu'il compte                                                       | Nature                      | Ce qu'il appelle                                      |
| -------------- | --------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------- |
| `sentTotal`    | messages partis                                                       | monotone                    | rien : le flux passe                                  |
| `droppedTotal` | messages **jetés par nous**, faute de place dans la file              | monotone                    | un destinataire trop lent : limite ou volume à revoir |
| `failedTotal`  | messages **refusés par la destination** (bus coupé, réessais épuisés) | monotone                    | une destination en panne : aller voir de ce côté      |
| `pendingBytes` | octets en attente de départ                                           | instantané (monte, descend) | la pression du moment                                 |

- Usages : la console qui compare les quatre livraisons, une alerte sur la croissance de
  `droppedTotal`, un export vers un outil de supervision.
- **Rupture si différé : NON** pour le code, qui s'ajoute après 10.0. Les **noms**, eux, sont figés
  dès maintenant : une fois publiés, ils le sont pour toute la série.

**Pourquoi ces noms.** Le suffixe `Total` distingue ce qui ne fait que croître de ce qui est une
photo de l'instant (`pendingBytes`, sans suffixe, l'unité dans le nom) ; c'est aussi la convention
des exports de métriques, qui les reprendront tels quels. `droppedTotal` et `failedTotal` sont déjà
les noms du backplane
(`src/packages/@nodefony/realtime/nodefony/interfaces/IBackplane.ts#IBackplaneQueueInfo`) : un
renommage de moins. « Jeté » et « échoué » restent deux compteurs parce que le remède diffère.

**L'unité est figée avec le nom (validée par l'auteur le 2026-10-29) : une livraison à UNE
destination** — une connexion, un abonné webhook, un exemplaire du bus. Un message diffusé à
trois abonnés compte trois ; ses réessais ne comptent pas. C'est la seule unité où `droppedTotal`
désigne la destination trop lente : perdre un message pour un seul abonné sur mille se voit.
Sans unité écrite, la console comparerait sous un même nom des grandeurs différentes (S-rt-35).

**Les noms existants ne sont pas renommés.** La sonde de la socket est publique
(`src/packages/@nodefony/realtime/nodefony/interfaces/IRealtimeProbe.ts#IRealtimeProbe` :
`messagesSent`, `dropped`, `bufferedAmount`) : le vocabulaire commun s'ajoute À CÔTÉ en 10.x, et
l'ancien nom se déprécie selon la politique de compatibilité, avec retrait à la majeure suivante.
`failedTotal` n'a que deux usages connus (backplane, webhooks), le SSE serait le troisième (un
envoi vers un client parti) ; facultatif, il ne coûte rien à qui ne s'en sert pas.

**Un refus n'est pas une perte : il se compte à part, un compteur par cause (validé par l'auteur
le 2026-10-30, table du gel).** Ni `droppedTotal` (« jeté faute de place ») ni `failedTotal`
(« refusé par la destination ») : un refus est un verdict de NOTRE garde, et ce qu'il appelle
dépend de la garde. Il n'y a donc pas de compteur générique des refus : chaque cause a le sien,
dans un ensemble fermé, et son unité s'écrit avec son nom — comme pour les quatre compteurs
ci-dessus.

| Nom                         | Ce qu'il compte                                                                                           | Unité                           | Où                     |
| --------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------- | ---------------------- |
| `ingressRejectedTotal`      | message du bus refusé à l'entrée (canal non déclaré diffusé)                                              | un message reçu d'un exemplaire | sonde du hub, existant |
| `systemFloorDeniedTotal`    | abonnement refusé par le plancher des canaux de plateforme                                                | une demande d'abonnement        | sonde du hub, existant |
| `sealRejectedTotal`         | message du bus dont le sceau ne se vérifie pas (S6)                                                       | un message reçu d'un exemplaire | #704                   |
| `allowTimedOutTotal`        | `allow` qui n'a pas répondu dans `realtime.allowTimeoutMs` (S10 bis)                                      | un appel d'`allow`              | #622                   |
| `allowSaturatedTotal`       | demande rendue `unavailable` sans appel d'`allow` (plafond global, coupe-circuit)                         | une demande d'abonnement        | #622                   |
| `frameRateRejectedTotal`    | trame entrante écartée par la borne de débit, avant tout décodage (ADR-0022 §5 C2, désactivée par défaut) | une trame reçue                 | #703                   |
| `authenticateTimedOutTotal` | `authenticate()` sans réponse dans `realtime.authenticateTimeoutMs` (S11)                                 | une poignée de main             | #622                   |

- **Le FILTRAGE n'est pas un refus** (S-rt-67). Un `allow` qui rend `false` à l'émission d'un
  webhook dit « ce message n'est pas pour toi » — 400 000 fois par seconde dans un usage normal
  (S-rt-59). Il n'entre dans aucun compteur de refus : il noierait les refus de sécurité (verrou,
  sceau, plancher) qu'un exploitant doit voir monter.
- **Rupture si différé : OUI pour les noms** : les deux déjà publiés (`ingressRejectedTotal`,
  `systemFloorDeniedTotal`), `sealRejectedTotal` (#704), `frameRateRejectedTotal` (#703 ; le
  compteur existe dès 10.0 même si la borne reste désactivée), `allowTimedOutTotal`,
  `allowSaturatedTotal` et `authenticateTimedOutTotal` (#622) — tous naissent avec 10.0. Un total générique
  calculé À LA LECTURE (somme des causes) reste un ajout possible en 10.x.
- **Écarté** : `deniedTotal` ou `rejectedTotal` générique (option A/B de la table) — il additionne
  des grandeurs d'unités différentes ; un générique plus une ventilation `{ cause: n }` (option D) —
  le générique n'apporte rien que la somme ne donne.

### S10. Une seule identité d'admission, une donnée plate produite par le framework

**Décision (validée par l'auteur le 2026-10-30, après trois tours de la table d'experts de
#702) :** le prédicat d'admission `allow` (#622) reçoit la MÊME identité quelle que soit la
livraison — socket, flux SSE, abonnement webhook. C'est une **donnée plate** définie au cœur,
jamais l'objet jeton `IRealtimeToken`, et elle se présente en deux types :

```ts
// Vue PUBLIQUE — envoyée au client dans `realtime:welcome`, identique des deux côtés
export interface RealtimeIdentity {
  type: string;
  authenticated: boolean;
  id: string | null; // stable et OPAQUE : la clé des canaux (`user:${id}`) ; null si anonyme
  userIdentifier: string; // login : affichage et audit, jamais une clé de canal
  roles: readonly string[];
  scopes: readonly string[];
}

// Ce que reçoit `allow` — SERVEUR seulement, jamais réémis au client
export interface ISubscriberIdentity extends RealtimeIdentity {
  readonly issuer: string | null; // `iss` du jeton vérifié ; null = aucun jeton (session, anonyme)
  readonly account: boolean; // `id` désigne un compte local que l'on peut relire
}
```

Forme actuelle de `RealtimeIdentity`
(`src/nodefony/src/realtime/RealtimeEventMap.ts#RealtimeIdentity`) :
`{ type, authenticated, userIdentifier, roles: string[], scopes: string[] }`. `id` (requis) et le
`readonly` de `roles` et `scopes` s'ajoutent dans #622, avant 10.0 : passer un tableau en
`readonly` après publication casse le type de qui l'écrit. La forme d'`allow` (flèche OU classe
`@injectable`) est fixée en S10 bis.

1. **Deux types.** `id` part au client (il connaît ainsi son canal sans taper une route) ;
   `issuer` et `account` restent au serveur.
2. **Pas de revendications de jeton dans l'identité.** Seuls les JWT en portent ; une session ou
   une clé API n'en a aucune, et une règle qui les lirait rendrait trois verdicts pour la même
   personne selon son mode de connexion. Tout champ de l'identité est soit enregistré avec
   l'abonnement, soit relu par `id` — l'appartenance à une organisation se résout par `id`,
   auprès des services de l'application (`allow` peut être asynchrone).
3. **`id` n'est jamais le login.** Un e-mail change, un login libéré se réattribue : le nouveau
   compte hériterait des canaux et des abonnements de l'ancien. `id` est l'identifiant du compte
   local, ou `<émetteur>#<sujet>` pour un appelant `ephemeral` sans compte (`account: false`).
4. **Produite par le framework, jamais construite par l'application** (TSDoc `@remarks` sur les
   deux types) : `IRealtimeToken` gagne une méthode facultative `getIdentity?()`, remplie par
   l'authentificateur à la poignée de main ; le flux SSE la tire de l'utilisateur de la requête ;
   le webhook la reconstruit par `id` à l'émission.
5. **Protections que le framework applique seul**, chacune gardée par un test :
   - **invariant** : anonyme ⇔ `authenticated=false ∧ id=null ∧ issuer=null` — l'anonyme du pare-feu
     (`id = "anonymous"`) est traduit en `null` ;
   - un canal qui déclare `allow` **refuse l'anonyme d'office** ; il ne l'admet que sur option
     explicite (`anonymous: true`) — `user:${who.id}` ne peut donc pas valoir `"user:null"` ;
   - un authentificateur sans `getIdentity` n'entre sur **aucun** canal à `allow` : refus
     `forbidden` et une ligne de journal — jamais un `id` déduit de `getUserIdentifier()` ;
   - seul `=== true` admet ; une exception ou une promesse rejetée valent refus `forbidden` ; un
     délai dépassé ou une saturation rendent `unavailable` (S10 bis point 3), jamais une admission ;
   - l'identité est gelée une fois, à la poignée de main : un `allow` ne peut pas s'ajouter un rôle ;
   - la copie structurelle du contrat dans `@nodefony/security`
     (`src/packages/@nodefony/security/nodefony/src/realtime/realtimeContracts.ts#IRealtimeToken`)
     est comparée à l'original par un test, ou disparaît au profit d'une déclaration unique au cœur.
6. **Webhook** : l'abonnement enregistre `{ id, issuer, type, account }` ; `createdBy` ne sert plus
   qu'à l'affichage. Une identité sans compte (`account: false`) ne peut pas créer d'abonnement :
   rien ne pourrait la relire à l'émission. La lecture tolère un champ inconnu (retour arrière,
   S-rt-51).

- Usages : un canal par utilisateur, un canal réservé aux personnes prouvées par le fournisseur
  d'entreprise (`who.issuer === "https://sso.corp"` ET un rôle), un canal par organisation résolu
  par `id`, un abonnement webhook qui survit six mois (S-rt-4, S-rt-37, S-rt-54, S-rt-55).
- **Rupture si différé : OUI.** `allow` est un rappel que l'application écrit : passer d'un objet à
  une donnée après publication casserait chaque `token.getRoles()` ; et `id` entre dans
  `RealtimeIdentity` comme champ REQUIS, ce qui n'est possible qu'avant 10.0. Après, l'identité ne
  s'enrichit que par des champs facultatifs.

**Écarté.** L'objet `IRealtimeToken` (le SSE et le webhook devraient simuler six méthodes depuis
une chaîne) ; un seul type pour le welcome et `allow` (il enverrait au client l'émetteur et les
revendications) ; `issuer: "local"` au lieu de `null` (un JWT local porte déjà son propre `iss`,
la sentinelle mentirait) ; les revendications du jeton dans l'identité (point 2). **Reporté, sans
rupture** : une règle déclarative `{ owner: true }` où le framework compare lui-même la fin du nom
de canal à `id` — un ajout d'API, à peser dans #622.

#### S10 bis. Le contrat d'`allow`, publié avec 10.0

**Décision (validée par l'auteur le 2026-10-30, après la table d'experts de #702 sur QUAND
`allow` est évalué) :** le TSDoc d'`allow` et la page publique de la sécurité temps réel disent,
dès 10.0 :

```ts
// Au cœur (`nodefony`), à côté d'`ISubscriberIdentity` : realtime et security le lisent sans
// dépendre l'un de l'autre.
export interface IChannelAdmission {
  allow(channel: string, who: ISubscriberIdentity): boolean | Promise<boolean>;
}

// Dans la politique d'un canal, DEUX formes :
allow?:
  | ((channel: string, who: ISubscriberIdentity) => boolean | Promise<boolean>) // règle sans service
  | (new (...args: never[]) => IChannelAdmission); // classe `@injectable`, résolue au boot

@RealtimeChannel("room:*", { authenticated: true, allow: RoomAdmission })
```

1. **Ses arguments, et rien d'autre.** Ni contexte de requête, ni session : à l'émission d'un
   webhook il n'y en a pas, et un `allow` qui les lirait passerait tous ses tests sur la socket
   puis refuserait 100 % des webhooks, sans un mot (S-rt-63). Une règle qui lit les données de
   l'application (une appartenance en base) s'écrit en **classe** : ses services lui arrivent par
   le constructeur, comme à tout service injectable.

   **Le troisième argument `services` est retiré** (amendement du 2026-10-30, table du gel).
   Deux motifs. Une clé chaîne ne se vérifie pas : une politique livrée par un module qui fait
   `services.get("userService")` quand l'application l'a nommé `users` reçoit `null`
   (`src/nodefony/src/types/IContainer.ts#IContainer`), lève, et refuse 100 % des abonnés sans un
   mot (S-rt-68) — l'injection par constructeur, elle, échoue au démarrage en nommant la
   dépendance (`src/nodefony/src/kernel/injector/injector.ts`). Et le conteneur expose
   `set`/`remove`/`clean`/`reset` à du code de politique, parfois tiers. La flèche reste pour les
   règles qui ne lisent rien (`channel === \`user:${who.id}\``).

   **La classe d'admission**, règles que le framework applique seul, chacune gardée par un test :
   - elle **étend `Service`**, comme tout `@injectable` : le décorateur n'accepte que cette forme
     (`src/nodefony/src/kernel/decorators/kernelDecorator.ts#injectable`), et un second moule
     d'injection pour la seule admission serait une deuxième implémentation d'une même règle ;
   - elle est **enregistrée et résolue au démarrage du noyau, une fois**, jamais par appel ni à la
     première poignée de main : un exemplaire qui n'émet que des webhooks doit avoir ses
     politiques. Aujourd'hui `RealtimeHub.registerChannelPolicy` n'est appelé que depuis
     `src/packages/@nodefony/realtime/nodefony/src/server/RealtimeController.ts#RealtimeController.onHandshake` :
     #622 déplace l'enregistrement au démarrage ;
   - une dépendance absente fait **échouer le démarrage en nommant la classe ET le canal** ; une
     portée `request` est refusée au démarrage (un singleton seulement : une instance sert tous
     les abonnés) ; une classe sans méthode `allow` est refusée au démarrage en la nommant ;
   - flèche et classe se distinguent par la **métadonnée `@injectable`**, jamais par le texte de la
     fonction (`class …`) : la garde `isChannelPolicy`
     (`src/packages/@nodefony/realtime/nodefony/decorators/realtimeDecorators.ts#isChannelPolicy`),
     qui aujourd'hui ne lit que `authenticated`/`roles`/`scopes` et laisse passer toute clé
     inconnue sans la lire — un `allow` posé avant #622 est accepté et ignoré —, accepte les deux
     formes d'`allow` et **refuse toute clé inconnue** (règle de sévérité des schémas du dépôt :
     une faute de frappe dans une politique de sécurité ne s'ignore pas) ;
   - une instance sert tous les abonnés en même temps : elle ne garde **aucun état par abonné**
     (TSDoc, page publique ; un test joue deux `allow` concurrents d'une classe qui mémorise `who`
     et exige qu'ils ne se croisent pas) ;
   - une ligne de journal au démarrage par canal : « canal X, admission Y, résolue ».
   - Un module npm qui livre une politique enregistre sa classe comme tout service de module ;
     la page publique le montre par un exemple complet.

2. **Il peut être appelé plus d'une fois pour un même abonné** — rejeu à la reconnexion
   (ADR-0022 §6), réabonnement après un changement d'identité, livraison d'un webhook : il doit
   être idempotent et sans effet de bord. Le nombre d'appels n'est pas une garantie du contrat.
3. **Son délai est borné, et un `allow` trop lent n'est pas un `forbidden`** (amendement du
   2026-10-30, table du gel). Une exception ou une promesse rejetée valent refus `forbidden`
   (fail-closed ; le détail ne part au client que hors production). Un délai dépassé ou une
   saturation, eux, ne disent rien du droit de l'abonné : ils rendent un **quatrième motif fermé,
   `unavailable`** (« indécidable pour l'instant »), ajouté à
   `src/nodefony/src/realtime/RealtimeEventMap.ts#RealtimeDeniedReason` AVANT 10.0 — l'union est
   fermée, l'ajouter après casserait les `switch` exhaustifs des applications, et un client
   ancien le replierait sur `forbidden`
   (`src/nodefony/src/client/realtime/NodefonySocket.ts#NodefonySocket.ingestDenied`). Sans ce
   motif, un abonné légitime refusé pendant 30 s de base saturée resterait muet jusqu'à une
   reconnexion fortuite : le client ne réessaie AUCUN motif aujourd'hui (S-rt-65).
   - `realtime.allowTimeoutMs` : le délai (nommage aligné sur `deliveryTimeoutMs`), défaut fixé
     par #622 avant 10.0. Le minuteur n'est armé que si `allow` rend une promesse, et
     `clearTimeout` à la résolution ; un verdict arrivé après le délai est **ignoré**, jamais une
     admission.
   - `realtime.maxPendingAllowsPerConnection` : appels d'`allow` en vol par connexion, défaut
     PETIT fixé par #622. Au-delà, une demande d'abonnement **attend son tour** dans une file par
     connexion ; elle n'est pas refusée (amendement du 2026-10-30, revue du gel). Le rejeu au
     `welcome`
     (`src/nodefony/src/client/realtime/NodefonySocket.ts#NodefonySocket.replaySubscriptions`)
     renvoie tous les `subscribe` d'un coup, et le client ne réessaie pas `limit` : un refus
     ferait perdre ses canaux à un abonné légitime à chaque reconnexion. La file est paresseuse
     (`null` tant que N appels au plus sont en vol), bornée par le plafond de canaux
     (`limits.maxChannelsPerConnection`, contrôlé AVANT `allow`), et libérée à la fermeture ;
     `realtime.allowTimeoutMs` court depuis la RÉCEPTION du `subscribe`, file comprise —
     dépassé, `unavailable`. `limit` garde son seul sens : plafond de canaux atteint. Un plafond
     par connexion porté à 256 aurait évité la file, mais il ne bornerait plus rien contre une
     base bloquée (S-rt-70).
   - `realtime.maxPendingAllowsTotal` : plafond global par exemplaire ; au-delà, `unavailable`.
     Un coupe-circuit par exemplaire (N dépassements dans une fenêtre) rend `unavailable` sans
     rappeler `allow` pendant la fenêtre. `realtime:denied` gagne un champ facultatif
     `retryAfterMs`.
   - Client 10.0 : sur `unavailable`, il réessaie le seul `subscribe` concerné, recul exponentiel
     à gigue COMPLÈTE, trois tentatives au plus ; valeurs écrites dans la page publique.
   - Compteurs `allowTimedOutTotal` et `allowSaturatedTotal` (S9) ; un `warn` limité en fréquence
     (canal, `NF_POD_NAME`, durée).
   - **Reporté en 10.x, sans rupture** : un `AbortSignal` en argument facultatif (un paramètre de
     plus dans un rappel ne casse pas une fonction qui en prend moins), un délai par canal.

   Le sort d'une panne à l'émission d'un webhook est réglé avec les abonnements par API (W6) :
   une panne n'y sera jamais traitée comme un verdict `false` (S-rt-60).

4. **Il s'ajoute aux exigences de SA politique** (`authenticated`, `roles`, `scopes`, puis
   `allow`). Un canal ne résout qu'une politique — le nom exact, sinon le motif le plus
   spécifique (`src/packages/@nodefony/realtime/nodefony/src/server/RealtimeHub.ts#RealtimeHub.resolveChannelPolicy`) :
   une politique plus spécifique remplace la sienne en entier, `allow` compris.
5. **`who.scopes` porte les scopes du jeton qui a ouvert CETTE livraison** ; il est vide pour une
   session et pour un webhook (rien n'est stocké avec l'abonnement, S10 point 6).

- Usages : une sonde industrielle admise par sa flotte (classe, lecture en base), un joueur admis
  par `channel === \`room:${partie}\``(flèche), un agent admis par`who.issuer` et un rôle.
- **Rupture si différé : OUI** (gardien de la compatibilité, table #702) : déclarer « ses
  arguments seuls » après 10.0 rendrait faux un `allow` qui lit le contexte, sans qu'il ait
  changé. Le motif `unavailable` et les clés de délai le sont aussi : un défaut publié ne change
  plus (politique de compatibilité).
- **Gardé par** (#622) : un test joue le MÊME `allow` à l'admission d'une socket et à l'émission
  d'un webhook et exige le même verdict ; un `allow` qui lit le contexte de requête est refusé
  par ce test ; un test prouve qu'une politique plus spécifique sans `allow` ouvre le canal ; un
  verdict tardif est ignoré ; un `allow` qui rend `1` ou `"yes"` refuse ; une politique portant
  une clé inconnue est refusée ; un rejeu de 256 `subscribe` au `welcome` contre un `allow` lent
  admet les 256, sans aucun `limit` ; 300 passerelles et
  10 000 clients contre une base bloquée ne déclenchent qu'un nombre BORNÉ d'appels d'`allow`.

**Reporté aux abonnements par API (W6, 10.1), sans rupture** : quand un webhook évalue `allow`
(à chaque tentative, verdict retenu ou non — W-a, à la création seulement, est écarté : un
abonnement à motif n'a aucun canal à passer, et un droit vu une fois survit à la personne) ; un
verdict retenu par `(abonnement, canal)` ne borne pas le coût de S-rt-59 quand chaque ressource a
son canal — à mesurer avant de choisir ; le stockage des scopes avec l'abonnement ; un quota par
abonnement dans la file des livraisons.

**Décision (validée par l’auteur le 2026-10-30, pour 10.0) :** un émetteur retiré
de la liste acceptée (`resourceServer.issuers`) est **jugé à l'ouverture**. La liste se fige à la
construction du vérificateur (`src/packages/@nodefony/security/nodefony/src/token/RemoteJwtVerifier.ts#RemoteJwtVerifier`)
et aucune voie ne la change dans un process vivant : la retirer, c'est changer la configuration et
redémarrer — et le redémarrage ferme les sockets, dont la reconnexion présente le jeton à la
nouvelle liste. Le revalidateur d'une socket ouverte par jeton
(`src/packages/@nodefony/security/nodefony/src/authenticator/FirewallRealtimeAuthenticator.ts#FirewallRealtimeAuthenticator`)
ne relit donc pas l'émetteur, et « fermer au tick » est écarté : il comparerait à une liste qui ne
bouge jamais. La fenêtre d'un déploiement progressif (un ancien exemplaire accepte encore
l'émetteur) n'est pas propre à la socket : HTTP la partage.

- **Rupture si différé : non**, et c'est ce qui permet de l'écrire maintenant. Un rechargement à
  chaud de la liste, s'il arrive, est une capacité neuve : il devra fermer lui-même les sockets de
  l'émetteur retiré, sans rien changer à ce qui est écrit ici. Le cas attendu est le
  multi-locataire (#492) : des émetteurs en base, un par organisation, modifiables à l’exécution —
  c’est là que la fermeture des sockets de l’émetteur retiré devient une exigence.
- **Gardé par** `src/packages/@nodefony/security/tests/unit/remoteJwtVerifier.test.ts` : modifier
  la liste fournie après la construction ne change aucun verdict, et la surface du vérificateur
  n'offre aucune méthode qui la modifierait — une méthode neuve fait tomber le test, qui renvoie
  ici.

**Décision (tranchée par l'agent sur délégation de l'auteur le 2026-10-30, après la table d'experts
de #702 sur la clé retirée) :** un jeton porteur sans `exp`, sans `iat`, ou dont l'`iat` dépasse
l'instant présent de plus de 5 s, est refusé partout — requête HTTP comme ouverture d'une socket,
jeton de l'application comme jeton tiers. Une seule règle
(`src/packages/@nodefony/security/nodefony/src/token/tokenTimeClaims.ts#isIssuedInFuture`), appelée
par `src/packages/@nodefony/security/nodefony/src/authenticator/JwtAuthenticator.ts#JwtAuthenticator`
et `src/packages/@nodefony/security/nodefony/src/token/RemoteJwtVerifier.ts#RemoteJwtVerifier.verifyClaims`.
La RFC 9068 §2.2 rend `exp` et `iat` obligatoires : un émetteur conforme n'est pas touché. Sans
`exp`, une socket ouverte avec une clé volée n'avait aucune borne (le revalidateur l'admettait dès
qu'il portait `jti` et `iat`) ; un `iat` futur échappait à `invalidBefore`, qui compare `iat` à un
seuil passé — jose ne le contrôle que sous `maxTokenAge`.

- **Rupture si différé : oui** — refuser après 10.0 un jeton accepté avant changerait un verdict.
- **Gardé par** `src/packages/@nodefony/security/tests/unit/remoteJwtVerifier.test.ts` et
  `src/packages/@nodefony/security/tests/unit/jwt.attack.test.ts` (7 refus vus rouges sans le
  correctif ; une avance de 2 s reste acceptée).
- **Écarté par la table** : revérifier la signature au tick (D) — jeton brut gardé par connexion
  (40 à 75 Mo à 50 000 sockets), des secondes de calcul par passe, et une panne de l'émetteur de
  plus de 10 min qui fermerait tout le parc (jose ne garde aucun jeu de clés périmé).
- **Opt-in de 10.x, sans rupture tant que le défaut ne change pas** : une durée de vie maximale du
  jeton, une durée de vie maximale de la connexion (avec étalement des échéances), la révocation
  par clé ou par émetteur, et une option client `token: () => Promise<string>`.

#### S10 ter. Le flux SSE d'un canal

**Décision (tranchée par l'agent sur délégation de l'auteur le 2026-10-30, revue du gel) :** un
flux SSE ouvert sur un canal s'admet par la politique du canal et `allow`, avec l'identité de la
requête (S10 point 4). Un refus est un **statut HTTP** (401 ou 403) rendu AVANT le flux, jamais
un message dedans : `EventSource` ne lit pas de corps d'erreur, et un flux ouvert puis refusé
serait rouvert sans fin. L'éjection et la fin (`ended`, `evicted`, S4) ferment le flux ;
`EventSource` reçoit le statut à sa reconnexion et s'arrête (WHATWG HTML §9.2). Le flux est
enregistré auprès du hub comme un abonné (#623) : aujourd'hui le hub ne connaît aucun flux SSE,
et une éjection ne l'atteindrait pas (S-rt-55). Un flux hors canal (porte MCP, `renderSse()` sans
paramètre) n'est pas concerné.

- Usages : l'écran d'atelier qui suit les mesures d'une ligne, le tableau des scores d'une partie
  diffusé à des spectateurs, l'avancement d'une tâche d'agent suivi par un navigateur.
- **Rupture si différé : NON.** Rien n'existe encore : la règle s'écrit avant le code.

### S11. Fermer une socket : le code dit la cause, et ce que le client doit en faire

**Décision (validée par l'auteur le 2026-10-30, table du gel) :** deux causes de fermeture
gagnent leur code avant 10.0. Les codes vivent dans un seul registre,
`src/nodefony/src/realtime/closeCodes.ts`, exportés par `nodefony` : le serveur qui ferme et le
client qui décide de revenir lisent la même constante.

| Code   | Constante                     | Cause                                                                                                                     | Client 10.0              |
| ------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `4001` | `IDENTITY_DEAD_CLOSE_CODE`    | identité morte : `authenticate` lève, session détruite, jeton RÉVOQUÉ                                                     | s'arrête                 |
| `4003` | `ORIGIN_REFUSED_CLOSE_CODE`   | origine refusée à la poignée de main (RFC 6455 §10.2)                                                                     | s'arrête                 |
| `4004` | `NOT_FOUND_CLOSE_CODE`        | ressource temps réel introuvable (4xx applicatif sans équivalent RFC)                                                     | s'arrête                 |
| `4005` | `IDENTITY_REFRESH_CLOSE_CODE` | droits changés, identité vivante                                                                                          | revient aussitôt         |
| `4006` | `TOKEN_EXPIRED_CLOSE_CODE`    | le jeton PORTEUR d'une socket ouverte a atteint son `exp`                                                                 | s'arrête (définitif)     |
| `4007` | `BACKPRESSURE_CLOSE_CODE`     | émis par le CLIENT : sa file d'envoi ne se vide plus (ADR-0022 §5 C1, #703)                                               | se reconnecte            |
| `1013` | `TRY_AGAIN_LATER_CLOSE_CODE`  | indisponibilité passagère : `authenticate` sans réponse dans le délai, ou client qui ne draine plus (contre-pression, S5) | revient (recul existant) |

Aujourd'hui `4001` est un littéral, écrit cinq fois (serveur et client) ; #706 pose
`IDENTITY_DEAD_CLOSE_CODE` dans le registre et remplace les cinq occurrences — le registre unique
n'est vrai qu'à ce prix.

**`4006` — le jeton porteur expire.** Depuis la règle `exp`/`iat` obligatoires (ci-dessus),
l'expiration est un événement CERTAIN pour toute socket ouverte par jeton : 10 000 capteurs
provisionnés le même jour expirent dans le même tick (S-rt-64).

- Le client 10.0 range `4006` dans ses codes définitifs
  (`src/nodefony/src/client/realtime/notice.ts#FATAL_CLOSE_CODES`) et
  `src/nodefony/src/client/realtime/notice.ts#closeCodeToNotice` lui donne son message. Sans cela
  le code lui serait inconnu, donc reconnectable (`#isReconnectableCloseCode`) : 10 000
  reconnexions dans la seconde avec le MÊME jeton périmé, une rafale fabriquée par le framework.
- Un client 10.x muni d'un fournisseur de jeton (`token: () => Promise<string>`, opt-in) pourra,
  lui, revenir sur `4006` avec un jeton frais — sans rien changer côté serveur. C'est la raison
  de réserver le code dès 10.0 plutôt que de garder `4001` : la cause doit déjà voyager.
- **Porteur seul.** Une session garde `4001` : le stockage rend `null` pour une session expirée
  comme pour une session détruite, la cause n'est pas connaissable.
- **Révoqué l'emporte sur expiré** : un jeton révoqué ET expiré ferme en `4001`. C'est la règle
  existante de `src/packages/@nodefony/security/nodefony/src/token/tokenStatus.ts#tokenStatusOf`.
  Le revalidateur d'une socket
  (`src/packages/@nodefony/security/nodefony/src/authenticator/FirewallRealtimeAuthenticator.ts#FirewallRealtimeAuthenticator`)
  teste `exp` avant la liste de refus : il est réordonné.
- La cause remonte au hub par un membre facultatif neuf d'`IRealtimeToken`, à côté du booléen
  d'`isValid` qu'elle remplace pour qui la donne ; son vocabulaire est celui de `TokenStatus`
  (`"active" | "expired" | "revoked"`), DÉPLACÉ au cœur — realtime n'importe pas security —, et
  `@nodefony/security` garde un alias. Le miroir
  `src/packages/@nodefony/security/nodefony/src/realtime/realtimeContracts.ts` suit.
- **La poignée de main ne change pas** : un jeton refusé par le pare-feu reçoit le 401 uniforme,
  donc `1008`. Jamais de `4006` AVANT authentification : ce serait un oracle qui dit à qui tient
  un jeton volé qu'il a été valide.
- **SSE : rien.** `EventSource` reçoit 401 à sa reconnexion et s'arrête (WHATWG §9.2).
- Le code `4007` est pris par la contre-pression (#703), qui prévoyait un code neuf.

**`1013` — `authenticate` trop lent à la poignée de main.** Aujourd'hui
`src/packages/@nodefony/realtime/nodefony/src/server/RealtimeController.ts#RealtimeController.onHandshake`
attend `authenticate()` sans borne : une base bloquée retient chaque connexion entrante, sans
limite. La règle est celle d'`allow` (S10 bis point 3) :

- clé `realtime.authenticateTimeoutMs`, défaut fixé par #622 avant 10.0 ; le minuteur n'est armé
  que si `authenticate` rend une promesse, `clearTimeout` à la résolution ; une identité arrivée
  après le délai est **ignorée**, jamais admise ;
- au dépassement, fermeture `1013` « Try Again Later » (RFC 6455 §7.4.1, registre IANA) : un
  code STANDARD, que le client 10.0 traite déjà comme reconnectable, avec son recul. Jamais
  `4001` : définitif, il arrêterait un client légitime à chaque panne de base ;
- un compteur `authenticateTimedOutTotal` (unité : une poignée de main) et un `warn` limité en
  fréquence, comme pour `allow`.

- Usages : un parc de capteurs à jeton statique (S-rt-64), une passerelle sans interface, un
  agent A2A à jeton de service, un tableau de bord derrière une session (qui garde `4001`).
- **Rupture si différé : OUI.** Un client 10.0 qui recevrait plus tard un code inconnu se
  reconnecterait : `4006` doit être connu de lui dès 10.0. Et borner après 10.0 une
  authentification qui ne l'était pas ferait échouer une poignée de main qui réussissait.
- **Gardé par** : un jeton expiré sur une socket ouverte ferme en `4006`, révoqué et expiré en
  `4001`, une session expirée en `4001` ; aucun `4006` avant authentification ; le client ne se
  reconnecte pas sur `4006` ; `authenticate` bloqué ferme en `1013` et le client revient ; une
  identité tardive est ignorée.
- Documenté dans `src/packages/@nodefony/realtime/docs/securite.md` (tableau des codes), avec la
  recette 10.0 « un jeton d'une heure sur une socket de sept jours » : l'application renouvelle
  sa socket avant `exp`.
- **Reporté en 10.x, sans rupture** : le fournisseur de jeton client, un compteur des fermetures
  par code.

**Reste à trancher** (sans rupture si différé) : une clé retirée du jeu de l'APPLICATION n'est
suivie qu'au redémarrage
(`src/packages/@nodefony/security/nodefony/src/authenticator/JwtAuthenticator.ts#JwtAuthenticator`
garde le jeu de clés local) ; à la requête HTTP, un jeton tiers n'est jamais confronté au store de
révocation ; le changement d'identité entre exemplaires (S-rt-61).

### Ce qui reste hors du socle

- **Plusieurs locataires** (`tenant` d'A2A, `tenantId` des webhooks, espace de noms du backplane) :
  un seul usage connu, la règle de généricité n'est pas remplie. Le nom du canal et le prédicat
  d'admission suffisent.
- **gRPC** : un service de `@nodefony/http`, expérimental en 10.1. Un service qui diffuse appelle
  le hub (`RealtimeService.publish`) ; le socle n'a rien à lui ajouter.

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
- Tickets : #621 (Epic, règle de généricité), #627, #630 (décisions de gel), #618, #622, #623, #629, #702, #703, #706
