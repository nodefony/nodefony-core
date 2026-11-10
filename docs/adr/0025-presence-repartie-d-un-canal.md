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

**Confrontation aux normes (tranchée par délégation de l'auteur le 2026-11-10) :** cet ADR avait été
écrit sans consulter les normes de présence. Trois lecteurs indépendants l'ont confronté à XMPP
(RFC 6121, XEP-0045), à SIP / PIDF (RFC 2778, 3856, 3863, 4479, 5262, 5263, 6665) et à l'état de
l'art réparti (SWIM, Lifeguard, `memberlist`, Phoenix Tracker et Presence, Cassandra, Matrix,
Ably) ; chaque citation décisive a été recontrôlée dans le texte source. **Aucune décision de fond
n'est contredite.** Les trous qu'elles ont révélés sont comblés EN PLACE : la liste ne consomme pas de version ; la
borne serveur de renvoi de la liste est retirée ; la réponse d'état porte `last`, s'applique d'un
bloc, et une demande ciblée reçoit toujours une réponse ; la preuve de vie annonce son
intervalle ; l'oubli résiste au gel du récepteur ; la vue cliente connaît l'état « non
synchronisée » ; le champ `partial` ; la forme par identité `{ tabs, states? }` ; le départ d'un
pod arrêté proprement et la grâce. Source par source : § « Normes et antériorités ».

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
    dernier lot), `interval` (son intervalle en millisecondes, ANNONCÉ : c'est lui qui fixe le
    délai d'oubli chez les pairs, comme la durée annoncée fait foi en SIP, RFC 6665 §3.1.1),
    quelques dizaines d'octets, indépendante du nombre de canaux — dès qu'il porte un présent OU
    garde une vue distante (sans elle il n'aurait aucun écho à constater). Le premier battement
    part avec une gigue de 0 à 25 % de l'intervalle : des pods démarrés ensemble ne battent pas
    en phase (Phoenix Tracker fait de même) ;
  - son **état à la demande** d'un pair — le _fetch_ de RFC 2778 §2.1, la _presence probe_ de
    RFC 6121 §4.3. La demande NOMME ses canaux ; quand elle vise un pod connu (trou, incarnation
    neuve, pod inconnu vu par sa preuve de vie), elle NOMME aussi ce pod (`to`). La réponse ne
    porte que ces canaux, regroupée par fenêtre de 50 ms tous demandeurs confondus ; un même
    canal n'est pas resservi dans la même fenêtre. **Une demande ciblée reçoit TOUJOURS une
    réponse, vide comprise** — RFC 6121 §4.3.2 : une réponse « deterministic » ; sans elle, le
    demandeur garde une vue périmée et redemande à chaque intervalle. Une demande non ciblée
    (premier abonné local) n'est servie que par les pods qui ont des présents sur ces canaux,
    sinon vingt pods répondraient « rien ». La réponse porte `last` (le `seq` du dernier lot émis
    avant elle). Découpée en messages de 64 Ko au plus, chaque part porte `i`/`n` et une liste d'entrées de
    canal (un canal peut s'étendre sur plusieurs parts, ses membres s'additionnent) ; les
    `n` parts d'une réponse partent d'un bloc, à `seq` consécutifs, ce qui les identifie. **Elle
    s'applique d'un bloc** : la vue de ce pod n'est touchée qu'une fois les `n` parts reçues, et
    une réponse ne FERME le trou que si elle nomme tous les canaux que la demande nommait — celle
    servie à un autre demandeur peut en nommer moins (`server/remotePresence.ts#RemotePresence`) (une part est jetable et aucun `prev` ne révèle sa perte — RFC 6665 §5.3.1 exige
    « a well-defined and complete state ») ; une réponse incomplète un intervalle après sa
    demande laisse le trou ouvert et se redemande.
- **Incarnation et numéros** — entiers, comparés comme des nombres, aucune chaîne :
  - l'**incarnation** est tirée au démarrage : `Date.now() × 1024 + aléa sur 10 bits`, entier sûr
    jusqu'en 2248 (un facteur 4096 dépasserait `Number.MAX_SAFE_INTEGER` en 2039). Un `originId`
    vaut `${hôte}:${pid}` (`backplane/originId.ts#resolveBackplaneOriginId`) et reste identique
    quand un conteneur redémarre en pid 1 (S-rt-104). Une incarnation plus récente purge
    l'ancienne vie ; une plus ancienne est refusée TANT QUE la vie connue n'est pas oubliée —
    l'oubli efface l'incarnation retenue, si bien qu'une vie neuve dont l'horloge a reculé est
    acceptée au plus tard après le délai d'oubli. Un ordre ne se prouve jamais par deux horloges
    (ADR-0022 §6 décision 4) : l'incarnation ne sert qu'à départager, l'oubli tranche. Un message
    d'une incarnation refusée ne rafraîchit PAS le dernier signe de vie de la vie connue (sinon
    ni l'une ni l'autre ne sortirait jamais). Le mot s'entend au sens d'une VIE de processus —
    `vsn` du Tracker de Phoenix, `generation` de Cassandra, même construction par l'horloge —, pas
    au sens du compteur de réfutation de SWIM ; `generation` est déjà pris par l'ordre de contrôle
    (`src/packages/@nodefony/realtime/nodefony/src/backplane/controlOrder.ts#IEvictUserOrder.generation`) ;
  - **`seq`** croît strictement à chaque message par (`originId`, incarnation), preuve de vie
    comprise : `seq` déjà vu = ignoré. Le « déjà vu » se relève PAR CANAL du bus (lots, demandes
    et réponses d'un côté, preuve de vie de l'autre) : la preuve de vie passe hors quota et peut
    doubler dans la file une demande encore en attente — un relevé unique jetterait celle-ci comme
    un rejeu. L'ordre d'un même canal, lui, est conservé. C'est l'anti-rejeu de la présence — le sceau ne couvre pas
    le rejeu (`backplane/envelope.ts#seal`), et un message rejoué ajouterait des fantômes. Le
    `seq` est attribué AVANT l'envoi, que la file l'ait laissé partir ou non ;
  - **trou** = `prev` d'un lot, ou `last` d'une preuve de vie, différent du dernier lot appliqué.
    Une preuve de vie perdue ne crée aucun trou. Un pair
    dont la preuve de vie porte `last: 0`, ou dont le premier lot porte `prev: 0`, n'a jamais
    émis de lot : sa vue, vide, est connue sans demande (aucun aller-retour au démarrage). Un trou déclenche une demande d'état ciblée,
    répétée une fois par intervalle tant qu'il dure ; l'ancienne vue reste affichée entre-temps.
    Pendant un trou, les lots reçus de ce pod ne s'appliquent pas, mais leur numéro est retenu
    (RFC 6665 §5.3.2 : « except for the version number, which it retains to detect message
    loss ») ; la réponse complète **ferme le trou** en posant le dernier lot appliqué à son
    `last` (RFC 5263 §4.5) : un lot de `seq` ≤ `last` y est déjà compris, le suivant s'applique
    si son `prev` vaut `last`. L'ordre des messages d'un même pod est conservé : la file admet ou
    jette, elle ne réordonne pas.
- **Ce qu'un pod garde** : la vue distante des seuls canaux qu'il sert ; un message pour un
  canal non servi est lu puis jeté sans stockage. La vue se range par pod puis par canal :
  oublier un pod libère une table. **Forme du lot entre pods** : par identité, le NOMBRE
  d'onglets (entier), en paires à plat comme vers le navigateur (P2 bis, « Sur le fil ») ; les états voyageront dans un champ FACULTATIF distinct (`states`, clé =
  référence d'onglet opaque, qui ne dit rien de la topologie), qu'un lecteur 10.0 ignore — jamais par un changement de type de la valeur, qu'un lecteur à liste
  fermée refuserait pendant tout déploiement progressif. Les présents locaux ne coûtent rien de
  plus (dérivés des membres du hub). Le premier abonné local d'un canal déclenche une demande
  d'état groupée au tic suivant (S-rt-99).
- **Portée** : la présence se lit sur le nom EXACT du canal — un canal cadencé (`base:<ms>`,
  `src/nodefony/src/realtime/channelRate.ts#rateChannel`) est un autre canal. Elle est répartie
  pour les canaux diffusés (`@RealtimeBroadcast`), locale pour les autres — zéro octet de bus ;
  un canal à présence non diffusé alors qu'un bus est configuré est annoncé UNE fois (sinon on
  retombe en silence sur la présence par processus). En 10.0, elle compte et sert les connexions
  socket seulement, pas les flux SSE (ADR-0021 S10 ter).
- **Oubli** : mesuré sur l'horloge MONOTONE LOCALE du récepteur — jamais l'horloge murale, qu'un
  saut NTP déplace, jamais un horodatage émis ; le délai est une DURÉE. Délai d'oubli =
  3 intervalles ANNONCÉS par le pair (nombre réglable, refusé au démarrage sous 2 — Phoenix
  Tracker exige le même plancher) ; intervalle local par défaut 5 s. Mesuré sur l'intervalle
  annoncé et non sur la configuration du récepteur, un déploiement progressif qui change
  l'intervalle ne fait pas oublier en boucle un pod vivant. Tout message valide de l'incarnation
  courante vaut signe de vie, pas seulement la preuve de vie.
  **Le récepteur aussi peut geler** (GC, cgroup étranglé) — c'est la première cause de faux
  positifs d'un détecteur de panne (Lifeguard : « slow processing by the failure detector module
  itself is the primary cause of the false positives »). Un tic en retard de plus d'un intervalle
  sur son échéance, ou le retour de l'écho après une absence, RÉARME le délai de tous les pairs au
  lieu d'oublier : sinon un pod bloqué 20 s oublierait d'un coup tous les pods vivants dont les
  preuves de vie attendent encore dans son tampon (les minuteurs passent avant la lecture des
  sockets).
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
  `RealtimeEventMap.ts`. Ses trois issues sont celles de RFC 5263 §4.5 : numéro attendu →
  `applied` ; plus loin → `gap`, le changement n'est PAS appliqué ; déjà vu → `stale`, jeté. Une
  vue « non synchronisée » (référence `null`) rend `gap` à tout changement, jusqu'à la prochaine
  liste complète.
- **Coût nul sans présence** : aucune structure (`null` sur l'état du canal), aucun minuteur. Un
  seul minuteur par pod, armé seulement quand un canal a quelque chose à envoyer.

### P2 bis — Vers le navigateur : liste partagée, changements regroupés, version

**Décision (tranchée par délégation de l'auteur le 2026-11-10) :**

- Une notification du protocole **`realtime:presence`** sur le canal décrit, comme
  `realtime:subscribed` et `realtime:closed`
  (`src/nodefony/src/client/realtime/NodefonySocket.ts#NodefonySocket.dispatchNotification`, qui
  ignore une méthode inconnue : un client plus ancien n'est pas affecté).
- **Champs figés** : `channel` ; `version` (entier par canal, propre au pod qui sert la
  connexion) ; `count` (identités nommées distinctes) ; `unnamed` (connexions comptées sans être
  nommées) ; `partial` (présent seulement s'il vaut `true`) ; puis EXACTEMENT un de : `members`
  (liste complète, qui REMPLACE la vue et RÉINITIALISE la référence de version) ou `changes`
  (`set` : identité → `{ tabs }`, `gone` : identités parties — qui s'applique à la vue). Au-delà
  d'un seuil de membres nommés (défaut 1 000, réglable), la trame ne porte que `count` et
  `unnamed` ; **seuil à 0** = présents comptés, jamais nommés (le salon semi-anonyme de
  XEP-0045 §4.2). Cette trame de nombres seuls est complète comme une liste : elle porte la
  version courante et réinitialise la référence.
- **Sur le fil, à plat** (`src/nodefony/src/realtime/RealtimeEventMap.ts#PresencePairs`) :
  `members` et `changes.set` sont des paires `[identité, onglets, identité, onglets, …]`, les
  états dans un champ voisin facultatif `states` (identité → référence d'onglet → état). La
  correspondance identité → `{ tabs, states? }` est celle de la VUE (hook, `hub.presence()`),
  pas du fil. Pourquoi : aucun objet par membre à l'encodage ni au décodage, un tableau compact
  de primitives au lieu d'un objet à clés dynamiques, -18 % d’octets en JSON et -13 % en CBOR à 1 000 membres
  (mesuré, identifiants de 36 caractères ; budget S-rt-87), et une identité n'est jamais une clé d'objet. Même forme dans le lot entre
  pods.
- **`version` : +1 par trame `changes`, jamais par une `members`**, qui porte la version
  COURANTE. Servie à un nouvel abonné, une liste qui prendrait un numéro ferait voir un trou à
  tous les autres abonnés, qui se resynchroniseraient ensemble à chaque arrivée. (RFC 5263 §4.4
  incrémente aussi la liste, mais son compteur est propre à l'abonnement ; le nôtre est propre au
  canal, pour qu'une trame encodée une fois serve tous les abonnés.) Le serveur PEUT envoyer
  `members` à tout moment au lieu de `changes` — quand la liste pèse moins que les changements,
  RFC 5262 §4 — et le client l'accepte sans l'avoir demandée.
- **`partial`** : la vue servie est connue incomplète ou figée — liste locale avant la réponse
  des pairs (S-rt-99), bus perdu (vue figée), trou en cours sur un pod. Un changement de
  complétude est un changement (trame `changes`, version +1). Sans lui, un poste de supervision
  déciderait sur une liste qu'on sait fausse : XEP-0045 §7.2.2 signale la fin de la liste,
  RFC 3863 §6 demande d'écarter une présence périmée.
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
  C'est mot pour mot la règle de XEP-0045 §17.3 : un client déjà présent qui redemande l'entrée,
  le service « MUST treat it as a full synchronization request ».
  **Aucune borne côté serveur** : un `subscribe` répété reçoit TOUJOURS la liste (RFC 5263 §4.4
  fait de même). Une borne « liste déjà envoyée à cette version » supposerait la liste REÇUE, or
  la contre-pression jette n'importe quelle trame sans le dire
  (`src/packages/@nodefony/realtime/nodefony/src/transport/WsConnectionTransport.ts#WsConnectionTransport.send`
  rend `void`) : un salon calme resterait affiché vide, et son re-`subscribe` refusé. La
  protection est la limite du client et le limiteur de trames entrantes ; renvoyer coûte un
  envoi, la liste étant déjà encodée pour cette version.
- **Vue « non synchronisée »** : à la fermeture de la socket et à chaque `subscribe` émis, la vue
  cliente perd sa référence de version ; tout `changes` y rend `gap` sans nouvelle demande,
  jusqu'à la prochaine `members`. Sinon, reconnecté sur un autre pod (dont la `version` est
  autre), un changement pourrait tomber par hasard sur le numéro attendu de l'ancienne vue et
  s'appliquer à tort — Phoenix Presence porte le même état (`inPendingSyncState`).
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
  (seuil, `grace` ; état — options futures additives). La présence se déclare au même endroit que la règle
  d'entrée qui la protège ; une clé mal écrite est déjà refusée au démarrage. Refusée sur un canal
  réservé de la plateforme, et sur la politique d'ÉCRITURE (`IChannelPolicies.write`), où elle
  n'a pas de sens.
- Serveur : `getRealtimeHub().presence("room:42")` → `{ count, unnamed, members, partial }`, vue
  cohérente à un intervalle près ; `members` toujours rendu, le seuil ne bornant que la trame
  vers le navigateur. C'est aussi la voie de l'observateur qui lit sans figurer (modérateur,
  tableau de bord) : RFC 2778 §2.1 sépare observateur et présent, la présence d'un canal les
  confond côté navigateur.
- Navigateur : `useNodefonyPresence(socket, "room:42")` (React, et son équivalent Vue) →
  `{ ready, count, unnamed, members, partial }`, `members` étant une `ReadonlyMap` identité →
  `{ tabs, states? }`, désabonnée au démontage ; `ready` vaut `false` avant la première trame —
  l'« état neutre » qu'exige RFC 6665 §4.1.2.4 : « vide » et « pas encore reçu » ne se
  confondent pas ; `socket.onPresence(canal, handler)` hors framework.
- `members` désigne les PRÉSENTS (les _occupants_ de XEP-0045), pas les inscrits d'un salon — le
  mot _member_ y désigne une affiliation durable ; une application qui stocke ses membres garde
  ce mot pour elle. Le nom suit `RealtimeHub.ts#RealtimeHub.channelMembers`, qui le porte déjà. L'identité de l'onglet courant se lit déjà sur la socket
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

- 10.0 livre la **forme** — identité → `{ tabs }` (nombre d'onglets), les états à venir dans
  `states` (référence d'onglet opaque → état), champ FACULTATIF — et aucun moyen de poser un
  état. C'est la forme du lot entre pods, recopiée à l'identique. Un tableau d'états sans
  identifiant, d'abord retenu, ne permettait pas de suivre un onglet d'une trame à l'autre :
  chaque précédent identifie l'entrée (`id` de chaque _tuple_, RFC 3863 §4.1.2 ; `phx_ref` de
  Phoenix Presence ; `connectionId` d'Ably). La référence ne voyage qu'avec un état ; sans état,
  le nombre suffit. Le micro, la caméra ou l'absence s'ajoutent sans toucher à la trame ni au
  hook (S-rt-97).
- **Un état DURE ; « en train d'écrire » n'en est pas un** : il passe par un message éphémère du
  canal. RFC 6121 §4.4.1 réserve la présence à la disponibilité (« Information that is not
  relevant in this way […] SHOULD be sent via other means ») et XMPP porte la frappe dans les
  messages. C'est aussi ce qui écarte la tempête de S-rt-105.
- Ensuite, par ajout : un état posé par le SERVEUR (`hub.setPresenceState(connexion, canal,
état)` depuis un gestionnaire d'entrée), puis posé par le navigateur
  (`socket.presence(canal).set(état)`) seulement sur un canal qui déclare un validateur, avec un
  état borné (128 octets), le dernier écrit gagnant par onglet et par fenêtre, et un quota par
  connexion ET par canal (S-rt-98). Le type de l'état entre alors au contrat de l'application.

### P5 — Les départs : exacts par défaut, grâce sur option

**Décision (tranchée par délégation de l'auteur le 2026-11-10) :**

- Une connexion qui se ferme part tout de suite (front montant de la fenêtre de 250 ms).
- **Arrêt propre d'un pod** (`SIGTERM`, déploiement) : il émet son dernier lot, puis une preuve
  de vie FINALE (`final: true`, hors quota comme toute preuve de vie) ; les pairs l'oublient
  aussitôt, par le même chemin que l'oubli (une trame `changes` par client). Sans elle, chaque
  déploiement laisserait ses présents chez les pairs jusqu'au délai d'oubli, et compterait deux
  fois dans `unnamed` les clients reconnectés ailleurs. Les normes annoncent cette fin : RFC 6121
  §4.5.1 (« gracefully become unavailable »), XEP-0045 §11.2 (code 332), RFC 6665 §4.2.1.4.
- **Grâce** : option `presence: { grace: <ms> }`. Un départ — connexion fermée, pod oublié ou
  parti — n'est publié qu'après ce délai, et s'annule si l'identité revient : un rechargement de
  page ou un déploiement ne fait plus clignoter la liste. Pour `unnamed`, la grâce retarde le
  décompte. Les délais vivent dans le tic unique du pod, aucun minuteur par présent.
- **Défaut `0`** : un salon de jeu ou un poste de supervision veut un compte EXACT ; un chat
  règle sa grâce. Ably tient 15 s par défaut ; Phoenix Tracker garde les présents d'un nœud
  arrêté « to avoid overwhelming clients with notifications that many users left and immediately
  rejoined » — c'est le choix inverse, assumé : l'exactitude par défaut, la stabilité sur option,
  et une seule option pour toutes les causes de départ.

### Ce qu'on ne promet pas

- Au plus une fois sur le bus ; la présence est **cohérente à un intervalle près**, réparée par
  les demandes d'état, jamais garantie instantanée.
- Un pod qui détient le secret du bus peut forger la présence d'un autre : le sceau est un secret
  de cluster, pas une identité de pair — même limite que les ordres (ADR-0022 §6 décision 4).
- Un message rejoué d'une vie oubliée peut réafficher un fantôme jusqu'au délai d'oubli suivant ;
  rejouée message après message dans l'ordre des `seq`, une capture peut le tenir plus longtemps.
  Parade possible, additive : une demande d'état qui porte un aléa que la réponse recopie. Aucune
  source lue ne traite le rejeu — XMPP, SIP, SWIM et Phoenix supposent un lien de confiance.
- Le sceau authentifie, il ne chiffre pas : qui lit le bus lit identité → canal. TLS et droits
  d'accès du bus relèvent de l'exploitation (RFC 3856 §9.1 recommande TLS entre éléments).
- Deux processus vivants sous le même `originId` (nom d'hôte cloné, pid 1 des deux côtés)
  prennent les messages de l'autre pour leur propre écho et ne se voient pas : l'unicité de
  l'`originId` est une condition de déploiement (`memberlist` détecte ce conflit, pas nous).
- Le motif d'un départ (quitté, éjecté, panne, arrêt du service) n'est pas publié ; il pourra
  l'être par un champ facultatif parallèle à `gone` (XEP-0045 : codes 307, 332, 333).
- Un lot perdu coûte une demande d'état de tous les canaux servis par le récepteur (il ignore
  quels canaux le lot touchait) ; une reprise par lots manquants (`since`, comme les
  `max_delta_sizes` de Phoenix Tracker) est un ajout possible.
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
| Récepteur gelé 20 s ; bus revenu après une coupure plus longue que le délai d'oubli                    | aucun pair vivant oublié                                                                       | invariant |
| Deux pods d'intervalles différents (déploiement progressif)                                            | aucun oubli d'un pod vivant                                                                    | invariant |
| 250 abonnés successifs d'un canal                                                                      | 0 trou de version chez les abonnés déjà présents                                               | invariant |
| Réponse d'état en `n` parts, une part perdue                                                           | vue inchangée, trou maintenu puis redemandé                                                    | invariant |
| Demande ciblée à un pod sans présent sur le canal                                                      | 1 réponse vide                                                                                 | invariant |
| Liste complète jetée par la contre-pression, puis `subscribe` répété                                   | liste reçue                                                                                    | invariant |
| Arrêt propre d'un pod                                                                                  | présents retirés chez les pairs en ≤ 1 fenêtre, sans attendre le délai d'oubli                 | invariant |
| Preuve de vie                                                                                          | ≤ 200 o par message, `originId` ≤ 48 caractères, secret posé (enveloppe scellée = 112 o fixes) | mesure    |
| Octets de présence par client (S-rt-87 : 1 000 membres, 30 mouvements/s, identifiant de 36 caractères) | ≤ 2 Ko/s, compte seul au-delà du seuil                                                         | mesure    |
| Mémoire par présent distant (tas après GC forcé, 100 000 présents ; état de 128 o)                     | ≤ 160 o sans état, ≤ 320 o avec                                                                | mesure    |

## Scénarios jugés

S-rt-84 à S-rt-110 (`scenarios/temps-reel.md`). Plateformes : sans objet — ni chemin, ni
processus enfant ; un minuteur `unref` se comporte à l'identique sur les trois systèmes.

## Normes et antériorités

Notre protocole n'est interopérable ni avec XMPP ni avec SIP : un écart de FORMAT n'est pas une
faute. Ce qui compte, ce sont les problèmes que ces normes ont appris à résoudre. Textes figés hors
ligne dans le corpus unique : `.claude/skills/nodefony-framework-dev/references/rfc/ietf/rfc<N>.txt`
(RFC) et `…/rfc/specs/` (`xep-0045-multi-user-chat.xml`, `matrix-presence.md`).

| Source                                                                       | Ce que la présence reprend                                                                                                                                                                                                                                                                                                                | Où elle s'écarte, et pourquoi                                                                                                                                                                                          |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **XEP-0045** (XMPP, salons) — le cas le plus proche : la présence d'un SALON | Être dans le salon donne la présence (§5.1.1) ; liste complète à l'entrée (§7.2.2) ; une seconde demande d'entrée = resynchronisation complète (§17.3) ; plusieurs sessions d'une identité (§7.2.8) ; ce qui fait autorité vient du service (§17.3) ; salon semi-anonyme (§4.2) → seuil 0 ; codes de départ 307 / 332 / 333 → motif futur | Une trame `members` atomique au lieu de N présences et d'une auto-présence finale ; pas de pseudo libre (§14.6, usurpation) ; aucune option « identités visibles aux seuls modérateurs » en 10.0                       |
| **RFC 6121** (XMPP, présence)                                                | Le serveur fabrique le départ d'un présent mort (§4.5.2) ; la _presence probe_ (§4.3) = demande d'état ; réponse déterministe (§4.3.2) ; la présence porte la disponibilité, le reste passe ailleurs (§4.4.1)                                                                                                                             | Battement systématique au lieu d'un sondage facultatif (§4.3.1, MAY) : notre bus ne garantit rien ; vocabulaire `show` fermé non repris                                                                                |
| **RFC 2778 / 4479** (modèle)                                                 | Observateur et présent, _fetch_ (RFC 2778 §2.1) ; personne → services / appareils (RFC 4479 §3) = identité → onglets                                                                                                                                                                                                                      | Observateur non listé : côté serveur seulement                                                                                                                                                                         |
| **RFC 3863 / 5262 / 5263** (PIDF, présence partielle)                        | Liste complète ou changements dans le même canal (RFC 5262 §1) ; liste quand les changements pèsent plus (§4) ; trois issues d'un numéro (RFC 5263 §4.5) = `applied` / `gap` / `stale` ; identifiant de chaque entrée (RFC 3863 §4.1.2) → référence d'onglet                                                                              | Version par CANAL et non par abonnement (une trame encodée pour tous) : la liste ne consomme donc pas de numéro                                                                                                        |
| **RFC 6665 / 3856** (notification SIP)                                       | État initial à l'abonnement (§4.2.1.2) ; un changement ignoré mais son numéro retenu (§5.3.2) ; durée annoncée qui fait foi (§3.1.1) → `interval` ; débit maximal des notifications (§5.4.10) → 250 ms ; état neutre avant la première notification (§4.1.2.4) → `ready` ; agrégation par le serveur, jamais par l'abonné (RFC 3856 §6.9) | Pas d'acquittement par notification : `prev` / `last` révèlent la perte que l'acquittement révélait                                                                                                                    |
| **SWIM / Lifeguard / `memberlist`**                                          | Battement à compteur ; le récepteur lent est la première cause de faux positifs (Lifeguard) → réarmement des délais                                                                                                                                                                                                                       | Tous les pods se battent le cœur (charge quadratique, négligeable à quelques dizaines de pods, à rejuger au-delà de quelques centaines) ; « incarnation » au sens d'une vie, pas du compteur de réfutation             |
| **Phoenix Tracker / Presence**                                               | Incarnation par l'horloge (`vsn`) ; délai d'oubli ≥ 2 intervalles, refusé au démarrage ; lots ; `presence_state` / `presence_diff` = `members` / `changes` ; plusieurs entrées par clé ; état « en attente de synchro » ; gigue du premier battement                                                                                      | Pas de CRDT (chaque pod est seul auteur de ses présents : une chaîne `seq` suffit) ; vue des seuls canaux servis (S-rt-100) ; un seul palier d'oubli ; lots à 50 ms au lieu de 1,5 s ; départs annoncés à l'arrêt (P5) |
| **Cassandra** (`generation`) · **Matrix** (présence) · **Ably** (presence)   | Génération tirée de l'horloge ; durées relatives, jamais d'heure absolue entre serveurs ; grâce au départ (15 s), liste poussée à l'attachement, compte seul pour les grands ensembles                                                                                                                                                    | Grâce à 0 par défaut (P5)                                                                                                                                                                                              |

Vocabulaire : on garde les noms de l'ADR. Équivalences à citer dans la documentation —
présent = _occupant_ (XEP-0045) ; demande d'état = _fetch_ / _probe_ ; `members` / `changes` =
_full_ / _partial presence_ (RFC 5262), `presence_state` / `presence_diff` (Phoenix) ; `stale` est
le mot de RFC 3856 §9.4 ; preuve de vie = _heartbeat_.

**Passerelle XMPP ou SIP : possible, et à garder possible.** Le modèle étant celui des normes, une
passerelle se traduit concept par concept : abonnement = entrée dans un salon / `SUBSCRIBE` ;
`members` / `changes` + `version` = liste des occupants puis présences / `NOTIFY` complet puis
partiel ; demande d'état = _probe_ / _fetch_ ; identité → `{ tabs }` = sessions d'un occupant /
personne → appareils. Elle vivrait dans un module à part, consommateur de la présence comme toute
application ; le cœur ne parle aucun de ces protocoles. Ce qui lui manque, tout ADDITIF : un
abonnement serveur aux CHANGEMENTS de présence (`hub.presence()` ne fait que lire), le motif d'un
départ (codes 307 / 332 / 333), l'état (P4). Les présents `unnamed` n'y apparaîtraient pas un par
un — XMPP exige un pseudo par occupant : voulu, ils ne sont jamais nommés. **Toute évolution qui
rendrait l'une de ces traductions impossible se juge contre ce paragraphe.**

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
