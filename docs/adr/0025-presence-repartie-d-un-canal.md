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

**Revue finale (validée par l'auteur le 2026-11-10) :** la revue côte à côte (un siège, étape 0 de
#760) a rendu dix-sept constats, chacun vérifié au code ; ce texte les intègre EN PLACE. Ce qui a
changé : la preuve de vie passe hors quota sur son propre canal ; le bus perdu se constate par
l'écho de sa propre preuve de vie ; numéros `seq` / `prev` / `last` au lieu d'une version unique ;
incarnation entière bornée ; forme du lot entre pods prête pour l'état ; demande d'état qui nomme
ses canaux ; aucun verbe client neuf (`subscribe` suffit) ; `unnamed` au lieu d'`anonymous` ;
compteurs nommés ; règle d'application pure, partagée par le navigateur et le pod ; budgets
séparés en invariants testés et mesures de banc.

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
- **Côté navigateur** : la présence arrive comme les notifications du protocole qui existent déjà
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

- **Deux canaux** (`src/nodefony/src/realtime/platformChannels.ts#PLATFORM_BUS_CHANNELS`, préfixe
  `PLATFORM_BUS_PREFIX` exigé) : `PLATFORM_BUS_CHANNELS.presence` = `nodefony:bus:presence` pour
  les lots, demandes et réponses d'état ; `PLATFORM_BUS_CHANNELS.presenceAlive` =
  `nodefony:bus:presence:alive` pour la seule preuve de vie. Scellés comme tout message, jamais
  servis à un client, jamais déclarables par une application, lus par un lecteur à liste fermée
  (champs propres seulement, textes bornés, plafond de membres par pod et par canal, un canal
  accepté seulement s'il est déclaré à présence sur CE pod — sur le modèle de
  `src/packages/@nodefony/realtime/nodefony/src/backplane/controlOrder.ts#readControlOrder`). Le
  canal de contrôle reste inchangé : « tout ordre enlève » est ce qui rend son rejeu tolérable,
  et la présence AJOUTE.
- **La voie hors quota de la file d'envoi** : la preuve de vie n'est JAMAIS jetée par la file
  (`src/packages/@nodefony/realtime/nodefony/src/backplane/publishQueue.ts#BackplanePublishQueue.send`),
  comme un ordre de contrôle — sinon une rafale ferait oublier un pod vivant, et la liste
  clignoterait. Lots, demandes et réponses restent jetables : leur volume suit l'activité. La
  règle « quel canal passe hors quota » est UN prédicat du cœur (`isPriorityBusChannel`), lu par
  la file et par tout driver qui l'emploie ; il n'est comparé que file saturée. Hors quota veut
  dire « jamais jeté », pas « livré à temps » : un bus bloqué relève de l'écho (Oubli, ci-dessous).
- **Règle de lecture du bus, figée** : un champ inconnu est toléré ; un type de message ou un
  canal de plateforme inconnu est rejeté et compté À PART, dans `ingressUnknownDiscardedTotal`,
  jamais dans `ingressRejectedTotal` (compteur d'injection, F83). **Livré (#761)** :
  `RealtimeHub.ts#RealtimeHub.#discardUnknownFromBus`,
  `src/packages/@nodefony/realtime/nodefony/src/backplane/controlOrder.ts#isUnknownControlOrder`.
- **Ce qu'un pod envoie** — `originId` n'est JAMAIS recopié dans la charge, il se lit dans
  l'enveloppe :
  - ses changements, **groupés** en un lot scellé multi-canaux toutes les 50 ms ; une arrivée et
    un départ dans la même fenêtre s'annulent à la source. Un lot porte `seq` et `prev` (le `seq`
    du lot précédent) ;
  - à chaque intervalle, une **preuve de vie réduite** — incarnation, `seq`, `last` (le `seq` du
    dernier lot), quelques dizaines d'octets, indépendante du nombre de canaux — dès qu'il porte
    un présent OU garde une vue distante (sans elle il n'aurait aucun écho à constater) ;
  - son **état à la demande** d'un pair. La demande NOMME ses canaux (trou, incarnation neuve,
    pod inconnu, premier abonné local) ; la réponse ne porte qu'eux, regroupée par fenêtre de
    50 ms tous demandeurs confondus ; un même canal n'est pas resservi dans la même fenêtre.
    Découpée en messages de 64 Ko au plus, chaque part porte (canal, `i`/`n`) : la part 1
    REMPLACE la vue de ce pod pour ce canal, les suivantes complètent.
- **Incarnation et numéros** — entiers, comparés comme des nombres, aucune chaîne :
  - l'**incarnation** est tirée au démarrage : `Date.now() × 1024 + aléa sur 10 bits`, entier sûr
    jusqu'en 2248 (un facteur 4096 dépasserait `Number.MAX_SAFE_INTEGER` en 2039). Un `originId`
    vaut `${hôte}:${pid}` (`backplane/originId.ts#resolveBackplaneOriginId`) et reste identique
    quand un conteneur redémarre en pid 1 (S-rt-104). Une incarnation plus récente purge
    l'ancienne vie ; une plus ancienne est refusée TANT QUE la vie connue n'est pas oubliée —
    l'oubli efface l'incarnation retenue, si bien qu'une vie neuve dont l'horloge a reculé est
    acceptée au plus tard après le délai d'oubli. Un ordre ne se prouve jamais par deux horloges
    (ADR-0022 §6 décision 4) : l'incarnation ne sert qu'à départager, l'oubli tranche ;
  - **`seq`** croît strictement à chaque message par (`originId`, incarnation), preuve de vie
    comprise : `seq` déjà vu = ignoré. C'est l'anti-rejeu de la présence — le sceau ne couvre pas
    le rejeu (`backplane/envelope.ts#seal`), et un message rejoué ajouterait des fantômes. Le
    `seq` est attribué AVANT l'envoi, que la file l'ait laissé partir ou non ;
  - **trou** = `prev` d'un lot, ou `last` d'une preuve de vie, différent du dernier lot appliqué.
    Une preuve de vie perdue ne crée aucun trou. Un trou déclenche une demande d'état, répétée une
    fois par intervalle tant qu'il dure ; l'ancienne vue reste affichée entre-temps.
- **Ce qu'un pod garde** : la vue distante des seuls canaux qu'il sert ; un message pour un
  canal non servi est lu puis jeté sans stockage. La vue se range par pod puis par canal :
  oublier un pod libère une table. **Forme du lot entre pods** : par identité, le NOMBRE
  d'onglets (entier) ; les états voyageront dans un champ FACULTATIF distinct (`states`), qu'un
  lecteur 10.0 ignore — jamais par un changement de type de la valeur, qu'un lecteur à liste
  fermée refuserait pendant tout déploiement progressif. Les présents locaux ne coûtent rien de
  plus (dérivés des membres du hub). Le premier abonné local d'un canal déclenche une demande
  d'état groupée au tic suivant (S-rt-99).
- **Portée** : la présence se lit sur le nom EXACT du canal — un canal cadencé (`base:<ms>`,
  `src/nodefony/src/realtime/channelRate.ts#rateChannel`) est un autre canal. Elle est répartie
  pour les canaux diffusés (`@RealtimeBroadcast`), locale pour les autres — zéro octet de bus ;
  un canal à présence non diffusé alors qu'un bus est configuré est annoncé UNE fois (sinon on
  retombe en silence sur la présence par processus). En 10.0, elle compte et sert les connexions
  socket seulement, pas les flux SSE (ADR-0021 S10 ter).
- **Oubli** : mesuré sur l'horloge LOCALE du récepteur, jamais sur un horodatage émis ; délai
  d'oubli par défaut 3 intervalles de 5 s, refusé au démarrage s'il vaut moins de 2 intervalles.
  **Le bus perdu se CONSTATE par l'écho** : Redis renvoie à l'émetteur ses propres messages, sur
  une connexion d'abonnement distincte de celle d'envoi, et l'écho n'est lu qu'après vérification
  du sceau (`src/packages/@nodefony/realtime/nodefony/src/backplane/RedisBackplane.ts#RedisBackplane.#ingress`).
  Le driver compte les échos (`echoTotal`, un entier incrémenté sur la branche anti-écho, aucun
  horodatage par message), champ FACULTATIF de son `describe()` — aucune méthode neuve dans
  `IBackplane`. À chaque tic, le pod compare ce compteur à son relevé précédent : écho vu et pair
  muet = pair mort, oublié ; aucun écho = bus perdu, la vue se fige, aucun oubli de masse
  (S-rt-102). Un driver qui n'expose pas l'écho (IPC du `cluster`, sans file ni perte ; driver
  tiers) : oubli normal.
- **Compteurs** (ensemble fermé d'ADR-0021 S9) : `presenceRejectedTotal` — message de présence de
  forme invalide, au-delà d'un plafond, ou pour un canal non déclaré à présence ;
  `presenceStaleDiscardedTotal` — `seq` déjà vu ou incarnation plus ancienne. Unité : un message
  reçu d'un exemplaire. Un type de message inconnu sur ces canaux va dans
  `ingressUnknownDiscardedTotal`.
- **Une règle pure, deux bords** : appliquer un changement numéroté à une vue (`applied` /
  `gap` / `stale`) est la même règle dans le navigateur et dans la vue distante d'un pod. Elle vit
  au cœur (`src/nodefony/src/realtime/`), pure et isomorphe ; les types de trame entrent dans
  `RealtimeEventMap.ts`.
- **Coût nul sans présence** : aucune structure (`null` sur l'état du canal), aucun minuteur. Un
  seul minuteur par pod, armé seulement quand un canal a quelque chose à envoyer.

### P2 bis — Vers le navigateur : liste partagée, changements regroupés, version

**Décision (tranchée par délégation de l'auteur le 2026-11-10) :**

- Une notification du protocole **`realtime:presence`** sur le canal décrit, comme
  `realtime:subscribed` et `realtime:closed`
  (`src/nodefony/src/client/realtime/NodefonySocket.ts#NodefonySocket.dispatchNotification`, qui
  ignore une méthode inconnue : un client plus ancien n'est pas affecté).
- **Champs figés** : `channel` ; `version` (entier par canal, +1 par trame, propre au pod qui sert
  la connexion) ; `count` (identités nommées distinctes) ; `unnamed` (connexions comptées sans être
  nommées) ; puis EXACTEMENT un de : `members` (liste complète, qui REMPLACE la vue et
  RÉINITIALISE la référence de version) ou `changes` (`set` : identité → états par onglet,
  `gone` : identités parties — qui s'applique à la vue). Au-delà d'un seuil de membres nommés
  (défaut 1 000, réglable), la trame ne porte que `count` et `unnamed`.
- **Liste complète** à chaque abonnement, rejeu après reconnexion compris ; encodée UNE fois par
  (canal, version, codec) et servie telle quelle à tous les abonnés de la fenêtre (S-rt-101).
  Les changements passent par la trame partagée (un encodage, N envois), comme une diffusion.
- **Regroupement** par fenêtre de 250 ms avec front montant : le premier changement d'un canal
  calme part tout de suite, les suivants attendent la fin de la fenêtre. Le tic unique du pod
  regroupe aussi par connexion (un client abonné à 50 canaux).
- **Trou de version** côté client → le client réémet `subscribe { channel }`, limité à une fois
  par canal toutes les 2 s avec gigue ; le serveur, qui ré-acquitte déjà un abonnement en cours
  (`RealtimeController.ts#RealtimeController.startChannel`), renvoie la liste partagée (S-rt-103).
  **Aucun verbe client neuf** : un `realtime:presence:sync` aurait été jugé par le verrou de trame
  comme un CANAL entrant de ce nom, et « liste complète à l'abonnement » reste une seule règle.
  **Borne côté serveur** : la liste n'est renvoyée à une connexion que si la version du canal a
  changé depuis la dernière liste qu'elle a reçue — numéro rangé dans l'enregistrement de
  présence du membre, aucune allocation de plus.
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
  réservé de la plateforme, et sur la politique d'ÉCRITURE (`IChannelPolicies.write`), où elle
  n'a pas de sens.
- Serveur : `getRealtimeHub().presence("room:42")` → `{ count, unnamed, members }`, vue
  cohérente à un intervalle près.
- Navigateur : `useNodefonyPresence(socket, "room:42")` (React, et son équivalent Vue) →
  `{ count, unnamed, members }`, `members` étant une `ReadonlyMap` identité → états par
  onglet, vide avant la première trame, désabonnée au démontage ; `socket.onPresence(canal,
handler)` hors framework. L'identité de l'onglet courant se lit déjà sur la socket
  (`NodefonySocket.ts#NodefonySocket.onIdentity`) : se retirer de la liste tient en un filtre.
- **Identités nommées = comptes seulement** : nommée ⇔
  `src/nodefony/src/realtime/channelAdmission.ts#ISubscriberIdentity` porte `account === true`
  (champ existant, aucun découpage de `id`). Un appelant machine sans compte
  (`<émetteur>#<sujet>`) et un anonyme sont comptés dans `unnamed`, jamais nommés : la présence ne
  publie ni fournisseur d'identité ni sujet externe. Le champ ne s'appelle pas `anonymous` : il
  compte aussi des appelants AUTHENTIFIÉS, et `IChannelPolicy.anonymous` porte déjà un autre sens.
- Le hook et `socket.onPresence` sont génériques sur le contrat de l'application dès 10.0 : le
  type de l'état s'y inférera plus tard sans conversion.
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
- Les présents d'un pod d'une version sans présence ne sont pas vus tant qu'il tourne : le bus
  n'a pas d'annuaire de pairs, un pod qui n'émet rien n'existe pour personne.
- Hors quota n'est pas « prioritaire » dans le client Redis : une preuve de vie passe derrière ce
  qui est déjà en vol sur la connexion.

### Budgets — critères de fin

Deux natures, deux preuves. Les **invariants** sont des tests à horloge simulée (un compte exact,
pas une mesure) ; les **mesures** passent au banc
(`.claude/skills/nodefony-load-test/scripts/micro/micro-presence.mjs` : hub seul, bus en mémoire
avec le vrai sceau, un processus par mesure, variantes alternées, médiane, refus au-delà de 3 %
de dispersion), plus le gate mémoire de `@nodefony/http`.

| Grandeur                                                                                               | Budget                                                                                         | Preuve    |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | --------- |
| Trames de présence par client et par canal                                                             | ≤ 5/s, front montant compris, hors resynchronisation                                           | invariant |
| Bus au repos, 1 000 contre 100 000 canaux                                                              | octets égaux (indépendants du nombre de canaux)                                                | invariant |
| Bus au repos, canal sans présence                                                                      | 0 message, aucun minuteur, aucune structure                                                    | invariant |
| Encodages de liste complète, 250 abonnés en 2 s                                                        | ≤ 1 par fenêtre et par codec (compteur lisible)                                                | invariant |
| Premier abonné d'un pod (S-rt-99)                                                                      | liste complète en ≤ 2 fenêtres de 50 ms après la demande ; latence réelle au banc multi-pods   | invariant |
| Preuve de vie                                                                                          | ≤ 200 o par message, `originId` ≤ 48 caractères, secret posé (enveloppe scellée = 112 o fixes) | mesure    |
| Octets de présence par client (S-rt-87 : 1 000 membres, 30 mouvements/s, identifiant de 36 caractères) | ≤ 2 Ko/s, compte seul au-delà du seuil                                                         | mesure    |
| Mémoire par présent distant (tas après GC forcé, 100 000 présents ; état de 128 o)                     | ≤ 160 o sans état, ≤ 320 o avec                                                                | mesure    |

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
