---
adr: 25
title: Présence répartie d'un canal temps réel — portée par le canal lui-même
lang: fr
navTitle: Présence d'un canal
date: 2026-11-10
status: accepted
deciders: [Christophe CAMENSULI]
tags: [realtime, presence, cluster, design, compatibility]
---

# ADR-0025 — Présence répartie d'un canal temps réel : portée par le canal lui-même

## Statut

Accepté (2026-11-10). Instruit par le ticket #760 (Epic #621) : P1 tranché par l'auteur, P2 à P4 par délégation de
l'auteur après une table d'experts ; chaque décision porte sa ligne datée. Jugé contre le catalogue
[`scenarios/temps-reel.md`](scenarios/temps-reel.md), scénarios S-rt-84 à S-rt-110. L'architecture
temps réel est gelée (#702) : la surface neuve ne se code qu'une fois cet ADR accepté, puis entre
dans la fixture `frozenSurface`.

**Décision (validée par l'auteur le 2026-11-10) :** l'ADR est accepté en entier, P2 à P4 compris, sur la
synthèse de la table. Le code reste conditionné à la revue finale côte à côte d'ADR-0021, 0022 et
0025 (étape 0 de #760).

## Contexte

« Qui est dans ce salon ? » est la base d'un chat, d'un salon de jeu, d'un tableau partagé ou d'un
poste de supervision. Le framework n'y répond que pour le processus courant : les membres d'un
canal sont ceux de CE pod
(`src/packages/@nodefony/realtime/nodefony/src/server/RealtimeHub.ts#RealtimeHub.channelMembers`),
et une connexion n'existe que dans la mémoire du processus qui l'a acceptée
(`src/packages/@nodefony/realtime/nodefony/interfaces/IRealtimeConnection.ts#IRealtimeConnection`).
Dès que l'application tourne en plusieurs exemplaires (pods, `nodefony cluster -w N`), chacun ne
voit que ses propres connexions.

Bien faire demande trois mécanismes que chaque application réécrirait :

1. un pod qui meurt n'annonce pas ses départs — il faut republier à intervalle fixe, et oublier un
   pod muet ;
2. le bus livre au plus une fois — ces mêmes republications réparent un départ perdu et
   rattrapent un pod qui démarre en retard ;
3. une personne a plusieurs onglets, parfois sur deux pods — la présence se compte par identité,
   les anonymes se comptent sans être nommés.

Notre propre cookbook l'a réécrite fausse (`src/packages/@nodefony/realtime/docs/cookbook-chat.md`,
§ « Étape 3 » : un `Set` par processus publié toutes les 5 s, que chaque pod écrase chez l'autre
derrière un bus).

## Décisions

### P1 — Le framework porte la présence, sur le canal lui-même

**Décision (validée par l'auteur le 2026-11-10) :** la présence est une brique du framework,
activée canal par canal. Elle voyage sur le canal qu'elle décrit : être admis dans `room:42`
donne sa présence, aucun second canal (`room:42:presence`) n'est à ouvrir.

- **Une seule règle d'entrée** : celle du canal (`allow`, rôles, scopes). Un second canal devrait
  recopier cette règle (deux copies divergent en silence) ou la retrouver en découpant son nom
  (découpage déjà écarté par ADR-0022 pour `dm:<a>:<b>`) ; une copie qui oublie une règle
  ouvrirait un oracle de présence (S-rt-93).
- **Aucun registre global identité → canaux** : on ne lit la présence d'un canal qu'en y étant
  admis. L'objection d'ADR-0022 (« registre identité → connexions — oracle de présence ») ne
  s'applique donc pas : rien n'est appris au-delà de ce que l'admission accorde déjà.
- **Côté navigateur** : la présence arrive comme les notifications de plateforme qui existent déjà
  sur un canal (`realtime:subscribed`, `realtime:denied`, `realtime:closed` —
  `src/nodefony/src/client/realtime/NodefonySocket.ts#NodefonySocket.dispatchNotification`). Le
  hook réutilise la mécanique d'abonnement partagée et rejouée à la reconnexion
  (`#NodefonySocket.replaySubscriptions`) : l'application n'a presque rien à câbler.
- **Coût nul** pour un canal qui ne l'active pas : ni minuteur, ni structure allouée (S-rt-88).
- **Rouvre ADR-0022, décision D1** (« le développeur écrit son chat — … présence ») : la présence
  passe au framework ; contrat, actions, base, historique et salons restent à l'application.

### Comment P2 à P4 ont été tranchés

L'auteur a délégué ces décisions (« il faut que tu tranches, Nodefony doit être la référence du
temps réel, la perf est très importante ») et demandé une table d'experts : contradicteur,
spécialiste perf, attaquant (deux modèles), exploitant, développeur d'application, gardien de la
compatibilité. Le contradicteur a ajouté S-rt-100 à S-rt-104 et fait réécrire quatre cas ; chaque
constat retenu ci-dessous a été vérifié au code. La règle qui a départagé : **au repos, le coût
est proportionnel au nombre de pods ; en rafale, au nombre de fenêtres — jamais au nombre de
canaux, de membres ou d'abonnés.**

### P2 — Entre pods : un canal de plateforme dédié, des changements groupés, une preuve de vie de quelques octets

**Décision (tranchée par délégation de l'auteur le 2026-11-10) :**

- **Le canal** : `PLATFORM_BUS_CHANNELS.presence` = `nodefony:bus:presence`
  (`src/nodefony/src/realtime/platformChannels.ts#PLATFORM_BUS_CHANNELS`), scellé comme tout
  message, jamais servi à un client, jamais déclarable par une application, lu par un lecteur à
  liste fermée (champs propres seulement, textes bornés, plafond de membres par pod et par canal,
  un canal accepté seulement s'il est déclaré à présence sur CE pod). Le canal de contrôle reste
  inchangé : « tout ordre enlève » est ce qui rend son rejeu tolérable, et la présence AJOUTE.
- **Règle de lecture du bus, figée** : un champ inconnu est toléré ; un type de message ou un
  canal de plateforme inconnu est rejeté et compté À PART, jamais dans `ingressRejectedTotal`
  (compteur d'injection, F83). Aujourd'hui `RealtimeHub.ts#RealtimeHub.#admitFromBackplane` et
  `#RealtimeHub.#applyControl` comptent tout inconnu comme une injection : sans cette règle, toute
  addition d'une version 10.x passerait pour une attaque pendant un déploiement progressif
  (S-rt-92). **Elle part en 10.0, que la présence y soit livrée ou non.**
- **Ce qu'un pod envoie** :
  - ses changements, **groupés** en un message scellé multi-canaux toutes les 50 ms ; une arrivée
    et un départ dans la même fenêtre s'annulent à la source ;
  - à chaque intervalle, une **preuve de vie réduite** — `originId`, incarnation, version, quelques
    dizaines d'octets, indépendante du nombre de canaux — et seulement s'il porte au moins un
    présent (S-rt-100) ;
  - son **état complet seulement à la demande** d'un pair (trou de version, incarnation neuve,
    pod inconnu, premier abonné local), servi au plus une fois par intervalle quel que soit le
    nombre de demandeurs, découpé en messages de 64 Ko au plus.
- **Incarnation et version** : l'incarnation est tirée au démarrage et **ordonnée** (instant de
  démarrage + aléa) — un `originId` vaut `${hôte}:${pid}`
  (`backplane/originId.ts#resolveBackplaneOriginId`) et reste identique quand un conteneur
  redémarre en pid 1 (S-rt-104). Une incarnation plus récente purge l'ancienne vie ; une plus
  ancienne est refusée. La version croît strictement par (`originId`, incarnation), preuve de vie
  comprise : une version déjà vue est ignorée. C'est l'anti-rejeu de la présence — le sceau ne
  couvre pas le rejeu (`backplane/envelope.ts#seal`), et un message de présence rejoué ajouterait
  des fantômes.
- **Ce qu'un pod garde** : la vue distante des seuls canaux qu'il sert ; un message pour un
  canal non servi est lu puis jeté sans stockage. La vue se range par pod puis par canal :
  oublier un pod libère une table ; un présent sans état se stocke comme un nombre d'onglets. Les
  présents locaux ne coûtent rien de plus (dérivés des membres du hub). Le premier abonné local
  d'un canal déclenche une demande d'état groupée au tic suivant (S-rt-99).
- **Portée** : la présence est répartie pour les canaux diffusés (`@RealtimeBroadcast`), locale
  pour les autres — zéro octet de bus.
- **Oubli** : mesuré sur l'horloge LOCALE du récepteur, jamais sur un horodatage émis ; délai
  d'oubli par défaut 3 intervalles de 5 s, refusé au démarrage s'il vaut moins de 2 intervalles.
  Pas d'oubli quand c'est la file d'émission LOCALE qui a jeté. Silence simultané de tous les
  pairs = bus perdu : la vue se fige, aucun oubli de masse (S-rt-102).
- **Coût nul sans présence** : aucune structure (`null` sur l'état du canal), aucun minuteur. Un
  seul minuteur par pod, armé seulement quand un canal a quelque chose à envoyer.

### P2 bis — Vers le navigateur : liste partagée, changements regroupés, version

**Décision (tranchée par délégation de l'auteur le 2026-11-10) :**

- Une notification de plateforme **`realtime:presence`** sur le canal décrit, comme
  `realtime:subscribed` et `realtime:closed`
  (`src/nodefony/src/client/realtime/NodefonySocket.ts#NodefonySocket.dispatchNotification`, qui
  ignore une méthode inconnue : un client plus ancien n'est pas affecté).
- **Champs figés** : `channel` ; `version` (entier par canal, +1 par trame) ; `count` (identités
  distinctes) ; `anonymous` (connexions comptées sans être nommées) ; puis EXACTEMENT un de :
  `members` (liste complète, qui REMPLACE la vue) ou `changes` (`set` : identité → états par
  onglet, `gone` : identités parties — qui s'applique à la vue). Au-delà d'un seuil de membres
  nommés (défaut 1 000, réglable), la trame ne porte que `count` et `anonymous`.
- **Liste complète** à chaque abonnement, rejeu après reconnexion compris ; encodée UNE fois par
  (canal, version, codec) et servie telle quelle à tous les abonnés de la fenêtre (S-rt-101).
  Les changements passent par la trame partagée (un encodage, N envois), comme une diffusion.
- **Regroupement** par fenêtre de 250 ms avec front montant : le premier changement d'un canal
  calme part tout de suite, les suivants attendent la fin de la fenêtre. Le tic unique du pod
  regroupe aussi par connexion (un client abonné à 50 canaux).
- **Trou de version** côté client → demande de la liste complète par une trame client
  `realtime:presence:sync { channel }`, figée en 10.0, limitée à une par canal toutes les 2 s
  avec gigue, servie depuis la liste partagée (S-rt-103).
- **Pod perdu** = UNE trame `changes` par client, avec toutes les identités qui disparaissent —
  jamais un départ par membre, et aucune topologie de pods exposée au navigateur.
- Le client range la vue dans une `Map` (aucune clé héritée, `__proto__` sans effet).

### P3 — Activation et API : une clé de la politique du canal

**Décision (tranchée par délégation de l'auteur le 2026-11-10) :**

```ts
@RealtimeChannel("room:*", { allow: RoomAdmission, presence: true })
```

- La clé `presence` de `IChannelPolicy`
  (`src/nodefony/src/realtime/channelAdmission.ts#IChannelPolicy`), `true` ou un objet d'options
  (seuil, état — options futures additives). La présence se déclare au même endroit que la règle
  d'entrée qui la protège ; une clé mal écrite est déjà refusée au démarrage. Refusée sur un canal
  réservé de la plateforme.
- Serveur : `getRealtimeHub().presence("room:42")` → `{ count, anonymous, members }`, vue
  cohérente à un intervalle près.
- Navigateur : `useNodefonyPresence(socket, "room:42")` (React, et son équivalent Vue) →
  `{ count, anonymous, members }`, `members` étant une `ReadonlyMap` identité → états par
  onglet, vide avant la première trame, désabonnée au démontage ; `socket.onPresence(canal,
handler)` hors framework. L'identité de l'onglet courant se lit déjà sur la socket
  (`NodefonySocket.ts#NodefonySocket.onIdentity`) : se retirer de la liste tient en un filtre.
- **Identités nommées = comptes seulement** (`RealtimeIdentity.id` d'un compte local). Un
  appelant machine sans compte (`<émetteur>#<sujet>`) et un anonyme sont comptés dans
  `anonymous`, jamais nommés : la présence ne publie ni fournisseur d'identité ni sujet externe.
- **Aucun nom affiché dans la présence** : l'application résout identité → nom par sa route.
  Un libellé posé par le SERVEUR est un ajout possible ; un nom posé par le navigateur serait
  usurpable, il ne le sera jamais.

### P4 — L'état d'un présent : la forme en 10.0, l'écriture ensuite

**Décision (tranchée par délégation de l'auteur le 2026-11-10) :**

- 10.0 livre la **forme complète** — identité → tableau d'états par onglet, `{}` = aucun état —
  et aucun moyen de poser un état. Le micro, la caméra ou « en train d'écrire » s'ajoutent sans
  toucher à la trame ni au hook (S-rt-97).
- Ensuite, par ajout : un état posé par le SERVEUR (`hub.setPresenceState(connexion, canal,
état)` depuis un gestionnaire d'entrée), puis posé par le navigateur
  (`socket.presence(canal).set(état)`) seulement sur un canal qui déclare un validateur, avec un
  état borné (128 octets), le dernier écrit gagnant par onglet et par fenêtre, et un quota par
  connexion ET par canal (S-rt-98). Le type de l'état entre alors au contrat de l'application.

### Ce qu'on ne promet pas

- Au plus une fois sur le bus ; la présence est **cohérente à un intervalle près**, réparée par
  les demandes d'état, jamais garantie instantanée.
- Un pod qui détient le secret du bus peut forger la présence d'un autre : le sceau est un secret
  de cluster, pas une identité de pair — même limite que les ordres (ADR-0022 §6 décision 4).
- Un message rejoué d'une vie oubliée peut réafficher un fantôme jusqu'au délai d'oubli suivant.

### Budgets — critères de fin, mesurés par `micro-presence.mjs`

| Grandeur                                           | Budget                                 |
| -------------------------------------------------- | -------------------------------------- |
| Trames de présence par client et par canal         | ≤ 5/s (front montant compris)          |
| Octets de présence par client                      | ≤ 2 Ko/s, compte seul au-delà du seuil |
| Bus au repos, par pod                              | ≤ 40 o/s ; 0 sans présence             |
| Bus au repos, 1 000 contre 100 000 canaux          | égal (indépendant du nombre de canaux) |
| Mémoire par présent distant                        | ≤ 160 o sans état, ≤ 320 o avec        |
| Mémoire par présent local, par canal sans présence | 0                                      |
| Encodages de liste complète, 250 abonnés en 2 s    | ≤ 1 par fenêtre et par codec           |
| Premier abonné d'un pod (S-rt-99)                  | liste complète en < 200 ms             |

Le banc (`.claude/skills/nodefony-load-test/scripts/micro/micro-presence.mjs`) : hub seul, bus
en mémoire avec le vrai sceau, un processus par mesure, variantes alternées, médiane, refus
au-delà de 3 % de dispersion ; plus le gate mémoire de `@nodefony/http`.

## Scénarios jugés

S-rt-84 à S-rt-110 (`scenarios/temps-reel.md`). Plateformes : sans objet — ni chemin, ni
processus enfant ; un minuteur `unref` se comporte à l'identique sur les trois systèmes.

## Alternatives écartées

- **La présence reste à l'application** (ADR-0022 D1 avant P1) : trois mécanismes difficiles
  réécrits par chaque application, et faux dans notre propre cookbook.
- **Un second canal par canal suivi** (`room:42:presence`) : voir P1.
- **De nouveaux ordres sur le canal de contrôle** : un ordre inconnu y est compté comme une
  injection, et la présence casserait « tout ordre enlève ».
- **Une publication sur un canal d'application dérivé** : servie aux clients d'un pod ancien
  comme un message de l'application ; un message scellé par canal (100 000 canaux = 100 000
  enveloppes).
- **Republier l'état complet à chaque intervalle** : ~11 Mo par intervalle pour 100 000 petits
  canaux sur 20 pods, lus par tous (S-rt-100).
- **Chaque pod garde la vue de tout le cluster** : ~85 Mo par pod sur S-rt-100, et un pair
  hostile gonfle la mémoire de tous.
- **Chaque changement envoyé tout de suite au navigateur** : ~750 000 trames/s à 10× (S-rt-87),
  250 000 trames sur un retour en masse (S-rt-101).
- **Suspendre les membres d'un pod perdu côté client** (index de pod par membre) : moins
  d'octets sur un évènement rare, mais la topologie des pods sortirait vers le navigateur.
- **Un décorateur dédié ou une clé de configuration** : la présence pourrait exister sans la
  règle d'entrée qui la protège, et s'activer loin du canal.
- **Un état posé par le navigateur dès 10.0** : une trame entrante à borner et à figer avant
  d'avoir été attaquée.
