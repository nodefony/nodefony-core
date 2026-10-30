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
communes aux trois livraisons (#702) : l'identité d'admission (S10). Socle commun des décisions temps réel :
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
refuse la frame d'un scalaire (S-rt-43). `RealtimeHub.publish` refuse donc une charge qui n'est
ni un objet ni un tableau — nombre, chaîne, booléen, `null` —, en le nommant. Un scalaire se
publie dans un objet (`{ value: 42 }`) ; des octets restent admis (S8). Le contrôle est un
`typeof` par publication, hors du chemin de chaque connexion.

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

| Transport | Ce que le code tient                                                                                                                                                                                                                    |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Socket    | trame binaire, octets intacts                                                                                                                                                                                                           |
| Backplane | **refusés** plutôt que déformés : livrés aux seuls abonnés locaux, l'exploitant prévenu une fois (`src/packages/@nodefony/realtime/nodefony/src/server/RealtimeHub.ts#RealtimeHub.publish`) ; voie brute sur un second sujet (S6, #618) |
| Flux SSE  | **refusés** : `TypeError` qui dit d'encoder soi-même en base64 avec le type MIME (`src/packages/@nodefony/http/nodefony/src/context/http/SseStream.ts#serialize`) — un flux SSE n'est que du texte UTF-8 (WHATWG HTML §9.2)             |

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

allow?: (channel: string, who: ISubscriberIdentity) => boolean | Promise<boolean>;
```

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
   - seul `=== true` admet ; une exception, une promesse rejetée ou un délai dépassé valent refus ;
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

**Reste à trancher** : QUAND `allow` est évalué pour chaque livraison — compte introuvable à
l'émission d'un webhook, scopes d'un abonnement, émetteur retiré de la liste d'autorisation,
journal et compteur des refus.

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
