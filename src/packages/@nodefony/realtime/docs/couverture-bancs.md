---
title: "Ce que les bancs du temps réel n'éprouvent PAS"
navTitle: Couverture des bancs
lang: fr
module: "@nodefony/realtime"
topic: realtime
coverageModule: realtime
section: "Realtime"
audience: [developer]
tags: [realtime, tests, couverture, bancs, trous, e2e, charge]
version: "doc"
status: stable
publish: false
source: "src/packages/@nodefony/realtime/docs/couverture-bancs.md"
---

# Ce que les bancs du temps réel n'éprouvent PAS

Le temps réel est la clé de voûte du framework — HTTP et WebSocket dans le même
contexte de contrôleur est ce qui distingue Nodefony. Sa couverture de bancs a des
trous, et le vrai problème n'est pas qu'il en reste : c'est que **personne n'avait
établi la liste**. Tant qu'elle n'existe pas, chaque défaut se découvre par
accident — c'est arrivé deux fois en une semaine, dont une frame que le serveur
émettait et que le client jetait en silence.

Cette page est la liste. Elle se **remesure**, elle ne se relit pas de confiance.

## La mesure, et ce qu'elle vaut

```bash
node scripts/realtime-coverage-map.mjs          # le relevé lisible
node scripts/realtime-coverage-map.mjs --json   # pour un autre outil
```

Le critère est mécanique : **un fichier de test IMPORTE-t-il ce module ?** Il ne
juge pas si le test l'exerce vraiment — un import peut ne servir qu'à un décor.
Il balaie tout `src/`, plus les scripts de charge du skill `nodefony-load-test`,
et range chaque banc par son CHEMIN (`/tests/integration/`, `.e2e.`,
`/tests/websockets/` → jonction ; `.mjs` du skill → charge ; le reste → unitaire).

**Deux limites, à connaître avant de croire un verdict :**

1. **Il ne voit que l'import DIRECT.** Un module atteint par défaut à travers un
   autre sort « éprouvé par personne » à tort — c'est le cas de
   `BrowserWsTransport`, que `RealtimeClient` fabrique lui-même et qu'un banc de
   `@nodefony/http` exerce donc pour de vrai. Un module signalé se contrôle à la
   main.
2. **Importé n'est pas exercé.** L'inverse du premier point, et il ne se voit
   qu'en lisant le banc.

> ⚠️ Une première version de ce relevé ne balayait que les tests du module
> `realtime` et accusait `BrowserWsTransport`. Un périmètre trop étroit ne rend
> pas un verdict incomplet : il rend un verdict FAUX, et celui-là mettait
> l'instrument à l'abri en accusant le code.

## Les trous, et ce qu'ils coûtent

### Aucun test n'importe ces modules

| Module                                           | Ce qu'un défaut y passerait sans être vu                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `publishQueue` (`src/backplane/publishQueue.ts`) | La file de publication vers le fond de panier est **bornée** : au-delà, elle jette. Rien n'éprouve ce qui se passe quand elle sature — ni le rejet, ni ce que l'émetteur en apprend. Une rafale cross-pod perdrait des messages **en silence**, et le symptôme apparaîtrait sur un AUTRE pod que celui qui a jeté.                      |
| `RealtimeError` (`src/errors/RealtimeError.ts`)  | Le type d'erreur propre au module. Personne ne vérifie qu'il porte ce qu'il annonce (code, canal, cause) : une erreur qui perd son contexte est une erreur qu'on diagnostique en lisant le code du framework, pas les journaux.                                                                                                         |
| `BrowserWsTransport`                             | **Faux positif de l'instrument** — exercé indirectement par `client-isomorphe-e2e.test.ts` (`@nodefony/http`), qui monte un vrai serveur WSS et un vrai `RealtimeClient`. Aucun test ne l'importe _directement_ : sa logique propre (états, reconnexion, codes de fermeture) n'est donc éprouvée qu'à travers ce que le client en fait. |

### Éprouvés en unitaire, jamais dans la jonction

Ces modules ont des cas unitaires, mais **aucun banc ne les fait travailler avec
un serveur en face**. C'est la forme d'angle mort qui a laissé passer les deux
défauts de la semaine : la logique était juste des deux côtés, c'est le fil entre
les deux qui ne portait pas.

| Module                                                                                                                     | Éprouvé par                                                   | Ce que la jonction prouverait en plus                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AdaptiveRate`                                                                                                             | `AdaptiveRate.test.ts`                                        | La cadence est calculée côté client ; rien ne montre qu'elle ARRIVE au hub et qu'il l'applique. Le fil peut être coupé sans qu'un cas tombe.                                         |
| `WsConnectionTransport`                                                                                                    | `backpressureConfig.test.ts`, `WsConnectionTransport.test.ts` | Le seuil de consommateur lent est configuré et mesuré, jamais FRANCHI avec un vrai client au bout.                                                                                   |
| `LoopbackBackplane`                                                                                                        | `channelOwnership.test.ts`, `RealtimeHub.test.ts`             | Le fond de panier mono-processus est le défaut de toute application : c'est le seul chemin que personne ne prouve de bout en bout.                                                   |
| `originId`                                                                                                                 | `originId.test.ts`, `RealtimeHub.test.ts`                     | Deux pods qui se donnent le même identifiant d'origine (même nom d'hôte sous Kubernetes) laisseraient passer un double fan-out.                                                      |
| `deniedDetail`, `welcomeEnv`                                                                                               | leurs cas unitaires                                           | Tous deux décident ce qu'un visiteur APPREND selon le mode d'exécution. Leur jonction est désormais couverte pour le welcome (`realtimeChannelAuth.e2e.test.ts`), pas pour le refus. |
| `notice`, `observe`, `localEvents`, `IRealtimeSocket`                                                                      | cas unitaires du client                                       | La surface que consomme une application (observables, avis) n'est jamais exercée contre un serveur réel.                                                                             |
| `backplaneRegistry`, `ClusterProbeClient`, `RealtimeAdminApi`, `ClusterBackplane`, `channelRate`, `AnonymousRealtimeToken` | cf le relevé                                                  | Voir la carte complète ci-dessous.                                                                                                                                                   |

## La carte complète

| Module                   | Étages              | Bancs (3 premiers)                                                                                                  |
| ------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `AdaptiveRate`           | unit · charge       | `AdaptiveRate.test.ts`, `aimd-demo.mjs`                                                                             |
| `AnonymousRealtimeToken` | unit                | `RealtimeHubSecurity.test.ts`, `RealtimeController.test.ts`, `RealtimeService.test.ts`                              |
| `backplaneRegistry`      | unit                | `healthBackplaneDrivers.test.ts`, `backplaneRegistry.test.ts`                                                       |
| `BrowserWsTransport`     | —                   | —                                                                                                                   |
| `channelRate`            | unit                | `platformChannels.test.ts`, `channelRate.test.ts`                                                                   |
| `ClusterBackplane`       | unit · charge       | `ClusterBackplane.test.ts`, `backplaneRegistry.test.ts`, `cluster-ipc.mjs`                                          |
| `ClusterProbeClient`     | unit · charge       | `ClusterProbeClient.test.ts`, `cluster-health-endpoint-e2e.mjs`, `cluster-orm-rich-e2e.mjs`                         |
| `deniedDetail`           | unit                | `deniedDetail.test.ts`                                                                                              |
| `envelope`               | unit · e2e          | `backplaneInjection.attack.test.ts`, `RedisBackplane.test.ts`                                                       |
| `IRealtimeSocket`        | unit                | `RealtimeSocket.test.ts`, `AdaptiveRate.test.ts`                                                                    |
| `IRealtimeTransport`     | unit · e2e          | `clientAngular.test.ts`, `clientSvelte.test.ts`, `RealtimeSocket.test.ts`                                           |
| `JsonRpcPeer`            | unit · e2e          | `JsonRpcPeer.types.test.ts`, `JsonRpcPeer.test.ts`, `realtimeControllerPaths.e2e.test.ts`                           |
| `localEvents`            | unit                | `clientObserve.test.ts`                                                                                             |
| `LoopbackBackplane`      | unit                | `channelOwnership.test.ts`, `RealtimeHub.test.ts`, `backplaneRegistry.test.ts`                                      |
| `notice`                 | unit                | `RealtimeNotice.test.ts`, `clientObserve.test.ts`                                                                   |
| `observe`                | unit · charge       | `clientObserve.test.ts`, `db-backend-cost.mjs`, `aimd-demo.mjs`                                                     |
| `originId`               | unit · charge       | `originId.test.ts`, `RealtimeHub.test.ts`, `cluster-ipc.mjs`                                                        |
| `platformChannels`       | unit · e2e          | `platformChannels.test.ts`, `clientSyslogUplink.test.ts`, `clientObserve.test.ts`                                   |
| `publishQueue`           | —                   | —                                                                                                                   |
| `RealtimeAdminApi`       | unit                | `healthBackplaneDrivers.test.ts`                                                                                    |
| `RealtimeClient`         | unit · e2e          | `NodefonyProvider.test.ts`, `clientAngular.test.ts`, `clientSvelte.test.ts`                                         |
| `RealtimeController`     | unit · e2e          | `realtimeChannelCap.attack.test.ts`, `realtimeUnknownChannel.test.ts`, `RealtimeController.test.ts`                 |
| `RealtimeError`          | —                   | —                                                                                                                   |
| `RealtimeEventMap`       | unit · e2e          | `JsonRpcPeer.types.test.ts`, `RealtimeClient.types.test.ts`, `JsonRpcPeer.test.ts`                                  |
| `RealtimeHub`            | unit · e2e · charge | `realtimeUnenforcedPolicy.attack.test.ts`, `realtimeRevocation.attack.test.ts`, `realtimeChannelCap.attack.test.ts` |
| `RealtimeService`        | unit · e2e          | `RealtimeService.test.ts`, `realtimeFirewallWiring.e2e.test.ts`                                                     |
| `RedisBackplane`         | unit · e2e          | `RedisBackplane.test.ts`, `backplaneInjection.attack.test.ts`, `backplanePublishQueue.test.ts`                      |
| `ServerRealtimeSocket`   | unit · e2e          | `channelOwnership.test.ts`, `realtimeLoopback.e2e.test.ts`                                                          |
| `syslogUplink`           | unit · e2e          | `syslogUplink.test.ts`, `syslogUplink.e2e.test.ts`                                                                  |
| `welcomeEnv`             | unit                | `welcomeEnv.test.ts`                                                                                                |
| `WsConnectionTransport`  | unit                | `backpressureConfig.test.ts`, `WsConnectionTransport.test.ts`                                                       |

## Ce qui est éprouvé, et bien

- **La jonction client ↔ serveur** : `realtimeLoopback.e2e.test.ts` relie un VRAI
  `RealtimeClient` à un VRAI `RealtimeController` par un câble en mémoire.
- **L'autorisation, identité par identité** : `realtimeChannelAuth.e2e.test.ts` —
  matrice `identité × canal` pour `subscribe`, et désormais pour ce que le
  `realtime:welcome` ANNONCE.
- **Le fond de panier Redis et l'IPC de cluster**, y compris cross-pod, derrière
  leurs variables d'infrastructure (`NF_REDIS_TEST_URL`, `NF_RUN_CLUSTER_E2E`) —
  **absentes, ces suites se sautent, et un banc sauté compte comme vert**.

## Ce que cette page ne couvre pas

Les scripts de charge sont comptés par la MENTION du nom, pas par un import :
ils parlent au serveur, ils ne l'importent pas. Leur colonne dit donc « un script
de charge parle de ce mécanisme », jamais « il le mesure ».
