# Ce qui ne se voit qu'en production — plusieurs serveurs, réseau, révocation, charge

> Chargé depuis `SKILL.md` §8. Tout se vérifie dans la documentation installée :
> `node_modules/@nodefony/realtime/docs/configuration.md` (drivers, clés, variables),
> `node_modules/@nodefony/realtime/docs/securite.md` (codes de fermeture, `allow` lent),
> `node_modules/@nodefony/realtime/docs/cadence-et-contre-pression.md`,
> `node_modules/@nodefony/realtime/docs/canaux-a-membres.md` (gestes qui traversent les serveurs),
> `node_modules/@nodefony/realtime/docs/observabilite.md` (les compteurs qui accusent un oubli).

## 1. Plusieurs serveurs — rien ne traverse sans intention

| Déploiement                          | `backplane.driver`                  | Ce qui se passe sinon                                                                          |
| ------------------------------------ | ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| un seul processus                    | `loopback`                          | —                                                                                              |
| `nodefony cluster -w N`, une machine | `cluster` (défaut de l'app générée) | sans bus, un abonné sur le worker 2 ne reçoit pas ce que publie le worker 1                    |
| plusieurs machines ou pods           | `redis` (+ `@nodefony/redis`)       | `loopback` à plusieurs répliques : la moitié des utilisateurs ne reçoit plus rien, sans erreur |

Un bus branché ne diffuse **que les canaux déclarés** : pose `@RealtimeBroadcast("chat:", "room:")`
sur la classe du contrôleur, **sur tous les serveurs** (le receveur aussi). Un préfixe couvre
`chat:`, `chat:room-42`, `chat:room-42:1000`. Le défaut est l'isolement : un canal d'observabilité
décrit SON serveur, il ne doit pas traverser. Le framework diffuse `user:` lui-même.

- L'oubli se voit : `localOnlyTotal` monte sur la sonde dès qu'un bus est branché et qu'un canal
  non déclaré est publié ; les préfixes diffusés sont listés au démarrage.
- Le bus est un transport, pas un journal : un serveur absent 30 s ne rattrape rien. Redis
  injoignable au démarrage : repli sur ce seul processus, WARNING, l'application démarre.
- **Secret du bus** : `NF_REALTIME_BACKPLANE_SECRET` (≥ 32 caractères), le même partout ; un
  message non scellé est refusé et compté (`sealRejectedTotal`). Deux applications sur un même
  Redis : `backplane.namespace` distinct — c'est une clé de sécurité, pas de confort.
- **Ce qui traverse, et ce qui ne traverse pas** : les publications des canaux diffusés, et deux
  ordres qui ne font qu'enlever — `closeChannel(canal)` et `evictUser(canal, compte)`. Les gestes
  par CONNEXION (`subscribeConnection`, `evictConnection`, `channelMembers`) sont locaux au
  serveur qui tient la socket : appelle-les depuis une entrée client (`@RealtimeInbound`, qui
  s'exécute par construction sur ce serveur), jamais depuis une requête HTTP routée au hasard.
- **Bus partagé = bus privé.** Un ordre d'éjection capté sur le bus peut être rejoué par qui y
  écrit : l'effet reste une coupure (jamais une admission), et changer le secret rend caducs les
  ordres captés. Risque écrit et accepté (ADR-0022 §6).

## 2. Reconnexion — ce qui est rejoué, ce qui ne l'est pas

- Le client rejoue **ses abonnements** au `realtime:welcome` (imposés compris), et chacun repasse
  par la politique et par `allow`. D'où la règle : l'appartenance est écrite là où `allow` la lit
  AVANT d'abonner, sinon le membre est refusé à la première coupure (sur mobile : dans la minute).
- Il ne rejoue **ni les messages publiés pendant la coupure, ni les requêtes en vol**. Une
  discussion se reprend par une route (`GET /chat/history?since=<dernier id>`), dédoublonnée sur
  l'identifiant persistant, triée sur l'identifiant croissant de la base — jamais une horloge.
- Un canal fermé par le serveur (`realtime:closed`, `ended` ou `evicted`) n'est pas rejoué. Un
  rechargement de page, si : c'est `allow` qui tranche.
- `connected` ne veut pas dire abonné : `await socket.whenSubscribed(canal)` avant de charger
  l'état initial, sinon un événement entre les deux est perdu.

## 3. Garanties — ce que le framework promet, et rien de plus

| Livraison | Ordre                                            | Livraison        | En cas de perte                                                             |
| --------- | ------------------------------------------------ | ---------------- | --------------------------------------------------------------------------- |
| socket    | par flux et par émetteur ; jamais entre serveurs | au plus une fois | un trou, jamais un réordonnancement ; client qui ne lit plus fermé (`1013`) |
| flux SSE  | par flux                                         | au plus une fois | un trou ; la reprise appartient à l'action                                  |
| bus       | par émetteur                                     | au plus une fois | un trou                                                                     |

Une alarme machine qui ne doit pas se perdre se bâtit **au-dessus** : identifiant dans la charge,
accusé par une entrée client, réémission par l'application. Le socle ne stocke rien.

## 4. Révocation — une socket survit à sa session

Toutes les 30 s, chaque connexion authentifiée est revalidée. Les codes vivent dans un seul
registre, exporté par `nodefony` : **compare aux constantes, jamais aux nombres**.

| Code   | Constante                     | Cause                                                                   | Le client                                                     |
| ------ | ----------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------- |
| `4001` | `IDENTITY_DEAD_CLOSE_CODE`    | session détruite ou expirée, jeton révoqué                              | s'arrête                                                      |
| `4003` | `ORIGIN_REFUSED_CLOSE_CODE`   | origine refusée à la poignée de main                                    | s'arrête                                                      |
| `4005` | `IDENTITY_REFRESH_CLOSE_CODE` | droits changés, identité vivante                                        | revient aussitôt — lis `onIdentity()` pour rafraîchir l'écran |
| `4006` | `TOKEN_EXPIRED_CLOSE_CODE`    | jeton PORTEUR expiré sur une socket ouverte                             | s'arrête : recrée la socket avec un jeton neuf AVANT `exp`    |
| `4007` | `BACKPRESSURE_CLOSE_CODE`     | émis par le client : sa file d'envoi ne se vide plus                    | se reconnecte                                                 |
| `1013` | `TRY_AGAIN_LATER_CLOSE_CODE`  | serveur : client qui ne lit plus, ou authentification trop lente (10 s) | revient, avec recul                                           |

- Un refus à la poignée de main est un **statut HTTP** (401/403) que le navigateur cache : la
  socket sonde l'adresse en HTTP et traite 401/403/404 comme définitifs. Jamais de `4006` avant
  authentification.
- Un membre retiré d'une salle reste abonné tant que sa connexion vit : l'exclusion immédiate, c'est
  `evictUser` ; la révocation ferme la connexion entière.

## 5. Contre-pression et bornes — une règle, trois endroits

- **Serveur** (`@nodefony/http`, clés `websocket` ET `websocketSecure` — régler l'un ne règle pas
  l'autre) : `maxBackpressure` 4 MiB, `backpressurePolicy: "drop"` (défaut) ou `"close"`,
  `backpressureCloseAfterDrops` 1000 → fermeture `1013`. `drop` ne trie pas : une réponse RPC
  peut partir aussi. Un flux où chaque message compte choisit `close`, ou un accusé applicatif.
- **Débit entrant** : `maxFramesPerSecond` (défaut `0` = désactivé), fermeture `1008`
  sur un solde de refus — jamais au premier dépassement (une reconnexion qui rejoue ses
  abonnements est une rafale légitime). Pour un jeu : `120` et `frameRateCloseAfterRejects: 1000`.
- **Navigateur** : `maxBufferedAmount` (désactivé par défaut) jette un coup périmé au lieu de
  l'empiler, compté dans `framesDropped` ; `backpressureCloseAfterDrops` ferme en `4007`.
- **Cadence adaptative** : un canal d'ÉTAT se demande `base:<ms>` ; le serveur le sert par
  `createRealtimeChannel` + `parseRate` (`nodefony`), le client par
  `useNodefonyAdaptiveChannelData`. Jamais sur un canal d'événements.
- `slowConsumer.bytes` (`@nodefony/realtime`) compte, ne freine pas.

## 6. `allow` sous charge

- Rejeu au redémarrage : N clients × M canaux appels d'`allow` en rafale. Parade : une règle en
  classe qui lit un registre partagé, ou un cache court côté application.
- `allowTimeoutMs` 5 s → `unavailable` (le client réessaie seul, 3 fois, gigue complète) ;
  `maxPendingAllowsPerConnection` 8 (la demande attend son tour) ; `maxPendingAllowsTotal` 512
  → `unavailable` ; coupe-circuit 50 dépassements en 5 s. Compteurs : `allowTimedOutTotal`,
  `allowSaturatedTotal`.
- Un `allow` qui lève = `forbidden` pour tous, sans un mot en production : une règle en classe
  fait échouer le DÉMARRAGE si sa dépendance manque. Préfère-la dès qu'elle lit la base.

## 7. Lire la sonde avant d'accuser le code

`GET /nodefony/realtime/api/health` (rôle d'administration) ou le canal `nodefony:socket`.

| Signal                                            | Lecture                                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------------ |
| `publishTotal` monte, `fanoutTotal` stagne        | tu publies dans le vide : nom de canal différent entre serveur et client |
| `localOnlyTotal` > 0 sur un canal applicatif      | `@RealtimeBroadcast` oublié                                              |
| `ingressRejectedTotal`, `sealRejectedTotal`       | quelqu'un d'autre écrit sur le bus, ou rotation du secret en cours       |
| `backpressure.slowConsumers`, `drops`             | un client ne suit pas ; la protection agit — ce n'est pas une panne      |
| `allowTimedOutTotal`, `authenticateTimedOutTotal` | la base ne répond plus                                                   |
| `systemFloorDeniedTotal`                          | un client demande un canal de plateforme sans module de sécurité         |
