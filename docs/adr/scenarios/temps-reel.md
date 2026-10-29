---
title: Temps réel — catalogue de scénarios
lang: fr
publish: false
tags: [realtime, websocket, sse, webhooks, backplane, design, scenarios]
---

# Temps réel — catalogue de scénarios

Les cas contre lesquels se juge **toute** décision du temps réel : le socle
([ADR-0021](../0021-temps-reel-evenement-et-livraisons.md)), la socket
([ADR-0022](../0022-socket-temps-reel.md)), les webhooks
([ADR-0023](../0023-webhooks-evenements-et-abonnements.md)). Méthode : skill
`nodefony-decision-making`, `references/methode-scenarios.md`.

**Règle d'usage.** Une décision passe TOUS les scénarios : tient / casse / sans objet, avec la
raison. Un cas que la décision révèle et qui manque ici s'AJOUTE ici, puis la matrice se repasse.
Le champ « A fait changer » garde la trace des cas qui ont coûté : il ne se vide jamais.

**Décisions figées par la publication de 10.0** (« rupture si différé : OUI », ou forme publiée
dès 10.0) — celles que ce catalogue juge en premier :

| Code    | Décision                                                                    |
| ------- | --------------------------------------------------------------------------- |
| S1      | la charge reste nue (`params` = ce que le producteur a publié), série 10    |
| S3-cond | un serveur 10.0 ignore un champ inconnu dans `params` d'un `subscribe`      |
| S6      | enveloppe du bus `{ channel, payload, originId }`, scellée sur ces 3 champs |
| S9-noms | `sentTotal`, `droppedTotal`, `failedTotal`, `pendingBytes`                  |
| W1      | corps d'un webhook `{ id, timestamp, type, data }`                          |
| W2      | `*` = tout, dans son périmètre ; grammaire des motifs figée pour la série   |

## Usages hétérogènes

### S-rt-1 — Un salon de discussion repris au dernier message vu

- **Situation** : 200 personnes, messages texte ; un mobile se reconnecte après 2 min et veut
  les messages manqués.
- **Catégorie** : usages hétérogènes
- **Tient si** : la reprise passe par la charge du producteur (son identifiant de message) et un
  `since` optionnel, sans enveloppe imposée par le socle.
- **Décisions jugées** : S1, S2, S3-cond, ADR-0022 §7
- **A fait changer** : aucune

### S-rt-2 — Un tableau de bord, un producteur, 5 000 navigateurs

- **Situation** : un point de série par seconde, un seul producteur partagé, 5 000 abonnés.
- **Catégorie** : usages hétérogènes
- **Tient si** : le producteur démarre au premier abonné, s'arrête au dernier ; aucune
  allocation par abonné et par frame.
- **Décisions jugées** : S1, ADR-0022 §1
- **A fait changer** : aucune

### S-rt-3 — Des capteurs binaires, et une alerte vers un système externe

- **Situation** : 10 000 capteurs envoient 16 octets chacun par la socket ; un seuil franchi
  part en webhook vers un système qui n'est pas connecté.
- **Catégorie** : usages hétérogènes (sans agent, sans média)
- **Tient si** : les octets restent un `Uint8Array` intact de bout en bout ; le webhook porte une
  charge JSON, jamais des octets déformés.
- **Décisions jugées** : S8, S6, W1
- **A fait changer** : aucune

### S-rt-4 — Une notification `user:42`, trois onglets et un CRM

- **Situation** : l'utilisateur 42 a trois onglets ouverts ; le même événement part aussi en
  webhook vers un CRM.
- **Catégorie** : usages hétérogènes
- **Tient si** : un seul prédicat décide « chez qui » pour la socket et pour le webhook ; aucun
  propriétaire dans l'événement.
- **Décisions jugées** : S7, W2, ADR-0022 §6
- **A fait changer** : aucune

### S-rt-5 — Une dictée transcrite, l'audio et le texte sur deux pods

- **Situation** : l'audio arrive sur le pod A, l'abonné au texte `transcript:<id>` est sur le pod B.
- **Catégorie** : usages hétérogènes (média)
- **Tient si** : le texte traverse le bus, l'admission se rejoue sur B, un éjecté n'est pas servi par B.
- **Décisions jugées** : S6, ADR-0022 §6 (cas `transcript:<id>`), §8
- **A fait changer** : aucune

### S-rt-6 — Un service gRPC qui relaie un canal

- **Situation** : un flux gRPC serveur (Epic #694) republie un canal à un client gRPC.
- **Catégorie** : usages hétérogènes (protocole consommateur)
- **Tient si** : il se bâtit au-dessus du hub sans que le socle connaisse gRPC, avec la même
  règle d'admission.
- **Décisions jugées** : S1, S7, W2
- **A fait changer** : la règle d'admission commune

### S-rt-7 — La fin d'une compilation, sans aucun client connecté

- **Situation** : une intégration continue reçoit un webhook à la fin d'un build ; personne n'a
  de socket ouverte.
- **Catégorie** : usages hétérogènes (sans connexion)
- **Tient si** : l'événement est le même `(canal, charge)` que sur la socket ; le corps du
  webhook ne dépend d'aucun abonné connecté.
- **Décisions jugées** : W1, W3
- **A fait changer** : aucune

### S-rt-8 — Une notification poussée à un agent A2A

- **Situation** : un agent tiers suit une tâche et reçoit ses mises à jour par webhook, avec un
  jeton porteur qu'il fournit lui-même.
- **Catégorie** : usages hétérogènes (agent)
- **Tient si** : W3 + W5 + W6 suffisent, sans rien de taillé pour A2A dans la brique.
- **Décisions jugées** : W1, W5, W6
- **A fait changer** : aucune

### S-rt-38 — Les sondes vibratoires d'un atelier industriel

- **Situation** : 300 machines, une sonde vibratoire à 1 kHz chacune, échantillons regroupés par
  paquets binaires de 100 ms ; un écran de supervision et un service d'analyse s'abonnent.
- **Catégorie** : usages hétérogènes (industrie, sans agent, sans média)
- **Tient si** : les octets passent sans copie ni conversion, l'ordre par machine (émetteur) tient
  entre pods, et le débit tient sur un pod mesuré, chiffres à l'appui.
- **Décisions jugées** : S1, S5, S6, S8, ADR-0022 §3, §5
- **A fait changer** : aucune

### S-rt-39 — Un serveur de jeu qui fait autorité, 30 ticks/s

- **Situation** : 64 joueurs par partie ; le serveur calcule l'état et envoie un delta binaire à
  chaque tick ; latence perçue visée sous 50 ms au p99.
- **Catégorie** : usages hétérogènes (jeu)
- **Tient si** : aucune allocation par joueur et par tick sur le chemin d'envoi ; un joueur lent
  est borné (contre-pression), il ne ralentit pas les 63 autres.
- **Décisions jugées** : S1, S8, ADR-0022 §3, §5
- **A fait changer** : aucune

## Charge

### S-rt-9 — 60 coups/s × 1 000 joueurs sur un canal à rôles

- **Situation** : un jeu, 60 trames/s par joueur, canal réservé à des rôles.
- **Catégorie** : charge
- **Tient si** : aucun contrôle de rôle par trame ; le verrou de trame mesuré reste sous le budget.
- **Décisions jugées** : ADR-0022 §5, §6 d1 bis
- **A fait changer** : le verdict retenu par connexion

### S-rt-10 — Webhook `*` sur l'audit, 500 connexions/s, 50 abonnés

- **Situation** : chaque connexion produit un événement d'audit ; 50 abonnements `*` ; file de 1 000.
- **Catégorie** : charge
- **Tient si** : la file pleine jette et compte (`droppedTotal`), sans ralentir la requête de
  connexion ; aucun abonné lent ne bloque les autres.
- **Décisions jugées** : W2, W4, S9-noms
- **A fait changer** : aucune

### S-rt-11 — Un exemplaire redémarre sous 20 000 clients

- **Situation** : 20 000 clients × 5 canaux rejouent leurs abonnements au `welcome`.
- **Catégorie** : charge
- **Tient si** : la rafale d'appels `allow` est bornée ou documentée avec sa parade.
- **Décisions jugées** : ADR-0022 §6 d1, §7
- **A fait changer** : aucune

### S-rt-40 — 10 000 spectateurs sur une même partie

- **Situation** : une finale diffusée ; un producteur, 10 000 abonnés répartis sur 4 pods.
- **Catégorie** : charge
- **Tient si** : un seul message par pod sur le bus, la diffusion locale sans encodage répété par
  abonné, et les spectateurs lents jetés et comptés (`droppedTotal`) sans gêner les joueurs.
- **Décisions jugées** : S6, S9-noms, ADR-0022 §5
- **A fait changer** : aucune

## Panne et réseau

### S-rt-12 — Un joueur passe dans un tunnel, la socket se reconnecte

- **Situation** : coupure de 20 s, reconnexion automatique du client.
- **Catégorie** : panne et réseau
- **Tient si** : chaque abonnement, imposé compris, est rejoué et réadmis par `allow`.
- **Décisions jugées** : ADR-0022 §6 d2, §7
- **A fait changer** : l'abonnement imposé (rejeu par `allow`)

### S-rt-13 — Le bus Redis coupé 30 secondes entre deux pods

- **Situation** : Redis indisponible 30 s ; les deux pods continuent de publier.
- **Catégorie** : panne et réseau
- **Tient si** : la perte est comptée (`failedTotal`) et visible ; rien n'est rejoué au retour ;
  aucune garantie promise au-delà de S5.
- **Décisions jugées** : S5, S9-noms
- **A fait changer** : aucune

### S-rt-14 — Un destinataire de webhook en panne deux heures

- **Situation** : le destinataire répond 503 pendant 2 h ; un pod est tué entre-temps.
- **Catégorie** : panne et réseau
- **Tient si** : réessais sous le même `webhook-id`, désactivation après 20 échecs, la perte au
  redémarrage écrite et comptée.
- **Décisions jugées** : W4, W7, S9-noms
- **A fait changer** : aucune

### S-rt-41 — Un atelier qui perd le réseau dix minutes

- **Situation** : la liaison de l'usine tombe ; au retour, 300 passerelles se reconnectent dans la
  même seconde et rejouent leurs abonnements.
- **Catégorie** : panne et réseau
- **Tient si** : la tempête de reconnexion est absorbée (rafale d'`allow` bornée ou documentée),
  et ce qui est perdu pendant la coupure est dit, jamais rejoué en silence.
- **Décisions jugées** : S3, S5, ADR-0022 §6 d1, §7
- **A fait changer** : aucune

### S-rt-42 — Une alarme machine critique qui ne doit pas se perdre

- **Situation** : une surchauffe déclenche une alarme ; l'industriel exige qu'elle arrive, même si
  un pod redémarre au même instant.
- **Catégorie** : panne et réseau (industrie)
- **Tient si** : la documentation dit clairement que le socle ne garantit pas la livraison, et
  l'application bâtit l'« au moins une fois » au-dessus (son identifiant dans la charge,
  acquittement, réémission) sans rien changer au socle ni au fil.
- **Décisions jugées** : S2, S5, W4
- **A fait changer** : aucune

## Plusieurs instances

### S-rt-15 — Deux serveurs reliés par Redis, un modérateur éjecte sur l'autre

- **Situation** : l'utilisateur est connecté au pod B ; le modérateur l'éjecte depuis le pod A.
- **Catégorie** : plusieurs instances
- **Tient si** : l'ordre par nom traverse le bus comme un message ordinaire scellé, sans méthode
  neuve sur `IBackplane`.
- **Décisions jugées** : S6, ADR-0022 §6 d4
- **A fait changer** : les ordres par nom sur le bus

### S-rt-16 — Un abonnement webhook créé sur A, l'événement produit sur B

- **Situation** : un administrateur crée un abonnement sur le pod A ; l'événement naît sur le pod B.
- **Catégorie** : plusieurs instances
- **Tient si** : B livre sans redémarrage, une seule fois.
- **Décisions jugées** : W7
- **A fait changer** : aucune

### S-rt-17 — `nodefony cluster -w 4` sur une seule machine

- **Situation** : quatre processus, bus de cluster, aucun Redis.
- **Catégorie** : plusieurs instances
- **Tient si** : même enveloppe, même sceau, même suite de conformité que Redis.
- **Décisions jugées** : S6
- **A fait changer** : aucune

## Versions qui cohabitent

### S-rt-18 — Un client 10.0 qui ignore la notification de fermeture

- **Situation** : serveur 10.2 ferme un canal ; le client 10.0 ne connaît pas `realtime:closed`.
- **Catégorie** : versions qui cohabitent
- **Tient si** : le client 10.0 ne casse pas et n'attend pas indéfiniment.
- **Décisions jugées** : S4, ADR-0022 §6 d3
- **A fait changer** : la fabrique qui rend `null`

### S-rt-19 — Déploiement progressif 10.0 et 10.3 sur le même bus

- **Situation** : pendant 20 min, des pods 10.0 et 10.3 échangent sur le même bus.
- **Catégorie** : versions qui cohabitent
- **Tient si** : aucun message refusé pour cause de sceau ; ce que 10.3 ajoute vit dans `payload`
  ou sur un sujet que 10.0 n'écoute pas.
- **Décisions jugées** : S6
- **A fait changer** : aucune

### S-rt-20 — Un client 10.2 envoie `subscribe { channel, since }` à un serveur 10.0

- **Situation** : client mis à jour avant le serveur.
- **Catégorie** : versions qui cohabitent
- **Tient si** : le serveur 10.0 ignore `since` et sert le canal normalement — prouvé par un test
  entre versions, pas par lecture.
- **Décisions jugées** : S3-cond, ADR-0022 §7, §10 contrôle 5
- **A fait changer** : aucune

### S-rt-21 — Un abonné webhook 10.0 qui a écrit `*`

- **Situation** : 10.1 ouvre l'émission applicative ; 10.4 introduit des événements rattachés à
  un locataire.
- **Catégorie** : versions qui cohabitent
- **Tient si** : l'abonné reçoit les événements applicatifs sans périmètre (sens écrit en 10.0),
  jamais ceux d'un locataire sans option explicite.
- **Décisions jugées** : W2
- **A fait changer** : aucune

### S-rt-22 — Un destinataire qui valide le corps du webhook par un schéma strict

- **Situation** : le destinataire refuse tout champ inconnu (`additionalProperties: false`) dans
  le corps reçu.
- **Catégorie** : versions qui cohabitent
- **Tient si** : aucun champ n'est ajouté au premier niveau du corps pendant la série.
- **Décisions jugées** : W1
- **A fait changer** : aucune

### S-rt-23 — Un tableau de supervision branché sur les anciens noms de la sonde

- **Situation** : un exploitant lit `messagesSent` et `dropped` depuis 10.0 ; 10.x ajoute les noms communs.
- **Catégorie** : versions qui cohabitent
- **Tient si** : les deux noms coexistent toute la série, l'ancien déprécié, retiré à la majeure.
- **Décisions jugées** : S9-noms
- **A fait changer** : aucune

## Attaquant

### S-rt-24 — Un vieil ordre « fermer » capté puis republié

- **Situation** : un message de contrôle scellé est capté sur le bus et rejoué plus tard.
- **Catégorie** : attaquant
- **Tient si** : le rejeu ne fait qu'enlever (jamais accorder) et sa portée est écrite.
- **Décisions jugées** : S6, ADR-0022 §6 d4
- **A fait changer** : la portée du sceau du bus

### S-rt-25 — Un client hostile qui vise le canal d'un autre

- **Situation** : un client authentifié s'abonne à `user:43`, ou envoie un `since` démesuré, ou un
  nom de canal de 10 Ko.
- **Catégorie** : attaquant
- **Tient si** : refus par `allow` ; aucune valeur de `params` ne coûte au serveur plus qu'un refus.
- **Décisions jugées** : S3-cond, ADR-0022 §6 d1, §7
- **A fait changer** : aucune

### S-rt-26 — Un accès en écriture au bus sans le secret

- **Situation** : un processus du réseau publie sur le sujet Redis, sans connaître le secret du sceau.
- **Catégorie** : attaquant
- **Tient si** : message refusé quand un secret est posé ; l'espace réservé du canal de contrôle
  ne s'injecte pas.
- **Décisions jugées** : S6, ADR-0022 §6 d4
- **A fait changer** : aucune

### S-rt-27 — Un locataire qui écrit `*` pour lire les événements d'un autre

- **Situation** : deux entreprises sur la même instance ; A crée un abonnement `*`.
- **Catégorie** : attaquant
- **Tient si** : A ne reçoit jamais un événement du périmètre de B.
- **Décisions jugées** : W2
- **A fait changer** : aucune

## Plateformes

### S-rt-28 — Développer et tester sous Windows

- **Situation** : `nodefony cluster -w 2` sous Windows ; fixtures d'octets relues dans Node et
  dans un navigateur.
- **Catégorie** : plateformes
- **Tient si** : le bus de cluster et les fixtures ne supposent ni groupe de processus, ni
  séparateur `/`, ni fin de ligne.
- **Décisions jugées** : S6, ADR-0022 §10
- **A fait changer** : aucune

## Extension tierce

### S-rt-29 — Un driver de bus écrit par un tiers sur un journal partitionné

- **Situation** : un tiers branche Kafka ou NATS comme bus.
- **Catégorie** : extension tierce
- **Tient si** : il implémente le contrat public, scelle par la fonction mutualisée, passe la
  suite de conformité exportée — sans méthode neuve sur le contrat.
- **Décisions jugées** : S6, ADR-0022 §6 d4
- **A fait changer** : aucune méthode neuve sur le contrat

### S-rt-30 — Un module tiers qui ajoute un codec ou une livraison

- **Situation** : un module ajoute un codec MessagePack, ou relaie un canal en SSE.
- **Catégorie** : extension tierce
- **Tient si** : il se branche sans toucher au cœur, et la charge qu'il reçoit est la même que
  celle des livraisons du framework.
- **Décisions jugées** : S1, S8, ADR-0022 §2
- **A fait changer** : aucune

## Agent IA consommateur

### S-rt-31 — « Notifie l'utilisateur 42 quand sa commande part »

- **Situation** : un agent reçoit cette demande dans une application Nodefony.
- **Catégorie** : agent IA consommateur
- **Tient si** : il choisit un canal privé admis par `allow` (ou un webhook à périmètre), jamais
  un `owner` glissé dans la charge.
- **Décisions jugées** : S7, W2, ADR-0022 §6
- **A fait changer** : aucune

### S-rt-32 — « Ajoute un numéro d'ordre aux messages »

- **Situation** : un agent veut que le client détecte les messages manqués.
- **Catégorie** : agent IA consommateur
- **Tient si** : il numérote dans la charge du producteur, jamais dans une enveloppe autour.
- **Décisions jugées** : S1, S2
- **A fait changer** : aucune

## Exploitation

### S-rt-33 — Des octets publiés sur un canal diffusé

- **Situation** : une application publie du binaire sur un canal diffusé entre pods, avant #618.
- **Catégorie** : exploitation
- **Tient si** : l'exploitant est prévenu ; les abonnés des autres pods ne reçoivent rien, et le
  compteur le dit.
- **Décisions jugées** : S6, S8, S9-noms
- **A fait changer** : aucune

### S-rt-34 — La rotation du secret du bus pendant un déploiement

- **Situation** : le secret du sceau change ; des pods ont l'ancien, d'autres le nouveau.
- **Catégorie** : exploitation
- **Tient si** : la procédure existe et ne perd pas de messages en silence.
- **Décisions jugées** : S6
- **A fait changer** : aucune

### S-rt-35 — Comparer les quatre livraisons dans la console

- **Situation** : un exploitant veut savoir où les messages se perdent : socket, SSE, webhooks ou bus.
- **Catégorie** : exploitation
- **Tient si** : un seul vocabulaire, lu sans calcul par trame.
- **Décisions jugées** : S9-noms
- **A fait changer** : aucune

## Mainteneur solo

### S-rt-36 — La même règle de motif pour un canal et un abonnement webhook

- **Situation** : une politique de canal et un abonnement webhook écrits tous deux `commande.*`.
- **Catégorie** : mainteneur solo
- **Tient si** : ils désignent exactement les mêmes noms, par une seule implémentation du motif.
- **Décisions jugées** : W2, ADR-0022 §6
- **A fait changer** : aucune

### S-rt-37 — Une règle d'admission, cinq livraisons

- **Situation** : socket, SSE, webhook, gRPC et bus doivent tous appliquer « chez qui ».
- **Catégorie** : mainteneur solo
- **Tient si** : un seul prédicat codé une fois ; un test compare les livraisons s'il existe une
  frontière de paquets.
- **Décisions jugées** : S7, W2, W6
- **A fait changer** : aucune
