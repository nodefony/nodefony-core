---
adr: 27
title: Arrêt de l'application — cesser de servir, puis libérer dans l'ordre inverse
lang: fr
navTitle: Ordre d'arrêt
date: 2026-11-14
status: accepted
deciders: [Christophe CAMENSULI]
tags: [kernel, lifecycle, shutdown, cloud-native, compatibility]
---

# ADR-0027 — Arrêt de l'application : cesser de servir, puis libérer dans l'ordre inverse

## Statut

Accepté (2026-11-14), validé par l'auteur en entier, écart A10 compris. Instruit par le ticket #775. Le principe (ordre inverse, deux phases) a été
tranché par délégation de l'auteur à la clôture de #760 ; cet ADR le confronte au code et aux
normes avant toute ligne de code, et corrige la décision écrite au ticket sur un point : la
première phase ne se limite pas à la disponibilité (§ D1).

## Contexte

À l'arrêt (`SIGTERM`, déploiement, `Ctrl+C`), `Kernel.ts#Kernel.doTerminate` émet un seul
événement, `onTerminate`, par `Event.ts#Event.emitAsync` : les écouteurs tournent **un par un,
dans l'ordre d'inscription**. Trois défauts en découlent.

1. **Ce dont on dépend se ferme avant soi.** Un service s'inscrit en général dans son
   constructeur ; le module qui l'utilise s'inscrit plus tard (à `onKernelBoot`, par exemple). Il
   s'arrête donc APRÈS la fermeture de sa ressource, et ses écritures d'arrêt se perdent sans
   erreur. Vu au banc multi-pods réel (#760) : la preuve de vie finale de la présence partait sur
   un Redis déjà fermé (`redis.ts#RedisService.constructor` contre
   `realtime/index.ts#Realtime.onKernelBoot`), « arrêt non terminé en 2000 ms ». Même famille,
   non vue au banc : `auditService.ts#AuditService` vide son agrégateur dans un store dont la
   connexion (`DrizzleService.ts`, `MongooseService.ts`) a été inscrite à la fermeture avant lui.
2. **L'ordre utile est obtenu par rustines.** Pour que la disponibilité bascule d'abord, que les
   WebSocket reçoivent 1001 avant le drain HTTP et que les flux longs reçoivent leur fin avant lui
   (ADR-0026 D8), six fichiers posent des `prependOnceListener("onTerminate")` à des moments choisis
   pour que la position d'inscription tombe juste — `http-kernel.ts#HttpKernel.init` le documente
   en commentaire : « posé à `onPostReady` pour prepend EN DERNIER → passer EN PREMIER ». L'ordre
   d'arrêt est une règle dispersée en six endroits et encodée par des moments d'inscription.
3. **Un écouteur qui échoue fait sauter tous les suivants.** `emitAsync` sort de sa boucle au
   premier rejet : les ressources inscrites après l'écouteur fautif ne sont jamais libérées.

## Normes et antériorités

Chaque citation a été relue dans son texte source le 2026-11-14.

| Source                                               | Ce qu'elle dit                                                                                                                                                                                                                                                                                                                           | Ce qu'on en retient                                                                                                                                    |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| systemd, `systemd.unit(5)`, `After=`                 | « When two units with an ordering dependency between them are shut down, the inverse of the start-up order is applied. »                                                                                                                                                                                                                 | L'arrêt défait dans l'ordre inverse de la mise en place (D3).                                                                                          |
| POSIX.1-2024, `exit()`                               | Les fonctions d'`atexit()` sont appelées « in the reverse order of their registration, except that a function is called after any previously registered functions that had already been called at the time it was registered ».                                                                                                          | Ordre inverse d'INSCRIPTION — pas de graphe déclaré ; et une inscription faite pendant l'arrêt est honorée (D3, point 3).                              |
| Go, `net/http`, `Server.Shutdown`                    | « first closing all open listeners, then closing all idle connections, and then waiting […] Shutdown does not attempt to close nor wait for hijacked connections such as WebSockets. The caller […] should separately notify such long-lived connections ». `RegisterOnShutdown` : « should start protocol-specific graceful shutdown ». | Cesser de servir est une étape à part, AVANT la libération, et les connexions longues reçoivent leur congé par leur protocole avant le drain (D1, D2). |
| Kubernetes, _Pod Lifecycle_, « Termination of Pods » | Le pod qui s'arrête est retiré des EndpointSlices (`ready: false`) ; délai de grâce par défaut 30 s ; les sidecars « are terminated in the reverse order they are defined ».                                                                                                                                                             | La disponibilité passe hors service d'abord ; une seule échéance pour tout l'arrêt (D5) ; l'ordre inverse est aussi la règle de l'orchestrateur.       |
| RFC 6455 §7.4.1 — code 1001                          | « going away, such as a server going down ».                                                                                                                                                                                                                                                                                             | Congé des WebSocket en phase 1 (inchangé).                                                                                                             |
| RFC 9113 §6.8 — GOAWAY                               | Arrêt gracieux d'une connexion HTTP/2 : les flux en vol finissent, les nouveaux sont refusés.                                                                                                                                                                                                                                            | Drain des serveurs en phase 1 (inchangé, `serverShutdown.ts#createDrainTerminator`).                                                                   |

Antériorité interne : ADR-0026 D8 fixe l'ordre « readyz à 503, fermeture 1001 des WebSocket, fin
des flux, drain HTTP ». Cet ADR le conserve tel quel ; il change seulement QUI le porte.

## Décisions

### D1 — Deux phases, deux événements : `onDrain` puis `onTerminate`

**Le constat qui corrige le ticket.** #775 proposait : la disponibilité bascule d'abord, puis TOUS
les écouteurs `onTerminate` du dernier inscrit au premier. Rejoué sur l'inventaire (§ Inventaire),
ce renversement brut casse ADR-0026 D8 : `HttpKernel.shutdownStreams` est inscrit dès `init()`,
avant les serveurs ; renversé, il passerait APRÈS le drain HTTP, et les flux longs seraient
détruits au lieu de recevoir leur fin. La première phase est donc tout ce qui concerne le
TRAFIC, pas la seule disponibilité.

1. **`onDrain` — cesser de servir.** Le pod sort de la répartition, congédie ses connexions longues
   (WebSocket 1001, flux longs, sockets proxifiées) et draine ses serveurs. Rien n'y est libéré.
2. **`onTerminate` — libérer.** Connexions aux bases et à Redis, minuteurs, vidage des agrégateurs,
   fichiers. À ce moment plus aucune requête n'est en vol : un écouteur peut écrire dans un store
   sans craindre une requête concurrente.

La phase se choisit par la NATURE de l'écouteur, plus par son moment d'inscription. Un module
qui ne sert aucun trafic n'écrit que `onTerminate`, comme aujourd'hui.

`onDrain` entre dans `Kernel.ts#Events` (avant `onTerminate`) : c'est un événement public de cycle
de vie, documenté avec les autres.

### D2 — `onDrain` : les écouteurs tournent ensemble ; l'ordre interne appartient au module

1. **Le noyau pose l'état d'arrêt AVANT d'émettre `onDrain`** : un accesseur public
   `kernel.isTerminating` (vrai dès le premier `terminate()`), que la sonde `/readyz` lit pour
   répondre 503. La disponibilité n'est plus un écouteur parmi d'autres qu'il faut placer
   premier : c'est un fait du noyau, posé avant toute phase. Un `SIGTERM` reçu pendant le
   démarrage trouve donc la sonde déjà à 503, ce qu'un écouteur posé à `onPostReady` ne
   garantissait pas.
2. **Les écouteurs `onDrain` tournent ensemble** (`Promise.allSettled`), et le noyau attend le
   dernier. Chaque module draine son propre trafic, indépendant de celui des autres : la durée de
   la phase est celle du plus long, pas leur somme — ce qui compte dans l'échéance unique (D5).
3. **Un ordre interne au trafic s'écrit dans UNE fonction du module qui le porte.** Pour
   `@nodefony/http`, `HttpKernel` inscrit un seul écouteur `onDrain` qui enchaîne, explicitement :
   1. attendre `health.shutdownDelay` (le temps que la répartition retire le pod) ;
   2. congédier les connexions longues, ensemble : 1001 des serveurs WebSocket, fin des flux
      (`shutdownStreams`, ADR-0026 D8), fermeture des sockets proxifiées ;
   3. drainer les serveurs HTTP, HTTPS et h2c, ensemble (ports distincts, aucune dépendance).
      Les serveurs n'inscrivent plus rien sur le noyau : ils exposent leur drain, `HttpKernel` les
      appelle. La règle d'ADR-0026 D8 vit en un endroit au lieu de six moments d'inscription.
      Effet de bord voulu : les serveurs se drainaient l'un après l'autre (jusqu'à
      `shutdownTimeout` chacun) ; ils se drainent ensemble.

### D3 — `onTerminate` : du dernier inscrit au premier, un à la fois

1. **Ordre inverse d'inscription** (systemd, POSIX). Ce dont un écouteur dépend a été mis en place
   avant lui — construit plus tôt, donc inscrit plus tôt —, donc s'arrête après lui. L'ordre
   d'inscription est le témoin fidèle de l'ordre de construction, sans graphe à déclarer.
2. **Un à la fois** : un écouteur peut attendre que le précédent ait fini d'écrire avant de fermer
   ce sur quoi celui-ci écrivait.
3. **Une inscription faite pendant la phase est honorée** (POSIX `exit()`) : un service construit
   pendant l'arrêt (par un `get()` paresseux) a créé sa ressource après les autres ; son écouteur
   est appelé avant ceux qui restent. L'émission ordinaire de Node prend un instantané et l'aurait
   ignoré — la ressource serait restée ouverte.
4. **La règle d'écriture qui rend l'ordre juste : on inscrit sa libération au moment où l'on PREND
   ce dont elle dépend, pas avant.** L'ordre inverse n'est fidèle que si l'inscription suit
   l'acquisition — c'est le contrat implicite d'`atexit`, qu'on appelle après avoir ouvert ce
   que la fonction touchera. Contre-exemple au code : `auditService.ts#AuditService.constructor`
   inscrit sa libération à la construction, mais ne prend son store qu'à `onBoot`
   (`AuditService.#build`). Si la sécurité est construite avant le connecteur de base, l'ordre
   inverse fermerait encore la base AVANT le vidage de l'audit. Ces services (§ Inventaire,
   colonne « déplacer ») inscrivent leur libération là où ils résolvent leur store. La règle
   entre dans la documentation du cycle de vie, avec l'exemple.

### D4 — Un écouteur qui échoue n'interrompt pas la phase

Chaque écouteur est isolé : un rejet (ou une exception synchrone) est journalisé en `ERROR` avec
la phase, le code de sortie passe à 1, et la phase continue. Vaut pour les deux phases. Une
ressource ne reste plus ouverte parce qu'une autre, inscrite avant elle, a échoué à se fermer.

### D5 — Une seule échéance pour tout l'arrêt

`shutdownDeadline` (défaut 15 s, sous le délai de grâce de l'orchestrateur) borne les DEUX phases
ensemble, comme aujourd'hui : l'orchestrateur ne connaît qu'un délai. La ligne `CRITIC` du
dépassement nomme la phase interrompue (`onDrain` ou `onTerminate`), pour qu'on sache si c'est
le trafic ou une ressource qui pendait.

### D6 — Les rustines disparaissent

Chaque `prependOnceListener("onTerminate")` est revu : il disparaît (congé et drain du trafic,
absorbés par D2) ou repasse en `once` (ressource, que D3 place correctement). Chacun est vu ROUGE
seul, avant le correctif du noyau, puis vert après. Liste au § Inventaire.

## Inventaire

Relevé des inscriptions à `onTerminate` hors tests (`rg -n '"onTerminate"' src`), moment
d'inscription lu au code.

**Phase 1 — trafic : absorbés par l'écouteur `onDrain` de `HttpKernel` (D2), plus rien sur le noyau**

| Site                                                                          | Aujourd'hui                                          | Devient                                |
| ----------------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------- |
| `http-kernel.ts#HttpKernel.init` — bascule de disponibilité + `shutdownDelay` | `prepend` à `onPostReady`                            | `kernel.isTerminating` + étape 1 de D2 |
| `http-kernel.ts#HttpKernel.init` — `shutdownStreams`                          | `prepend` à `init()`                                 | étape 2 de D2                          |
| `server-websocket.ts`, `server-websocket-secure.ts` — `terminate` (1001)      | `prepend` à `createServer`                           | étape 2 de D2                          |
| `reverse-proxy.ts` — `closeAll` (sockets proxifiées)                          | `prepend` au constructeur                            | étape 2 de D2                          |
| `server-http.ts`, `server-https.ts` (×2), `server-h2c.ts` — drain             | `once` à `createServer`, attendus l'un après l'autre | étape 3 de D2, ensemble                |

**Phase 1 — trafic, hors `@nodefony/http` : passe sur `onDrain`**

| Site                                                                                                                           | Aujourd'hui            | Devient           |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------------------- | ----------------- |
| `DevkitService.ts#DevkitService.mcpToolDeps` — `onShutdown` d'un outil MCP (rapport partiel avant la fermeture des connexions) | `prepend` à la demande | `once("onDrain")` |

**Phase 2 — ressources : restent sur `onTerminate`, placés par D3**

| Site                                                                                     | Moment d'inscription                | Geste                                                   |
| ---------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------- |
| `realtime/index.ts#Realtime.onKernelBoot` — dernier lot de présence, arrêt du bus        | `onKernelBoot`                      | `prepend` → `once`                                      |
| `redis.ts#RedisService.constructor` — `closeConnections`                                 | constructeur                        | inchangé                                                |
| `DrizzleService.ts`, `MongooseService.ts` — fermeture des connexions                     | constructeur                        | inchangé                                                |
| `auditService.ts`, `totp.ts`, `webAuthn.ts`, `tokenService.ts` — vidage / arrêt du store | constructeur, store pris à `onBoot` | **déplacer** à la résolution du store (D3 point 4)      |
| `webhooks.ts` — désabonnement de l'audit, arrêt du répartiteur                           | constructeur                        | inchangé (A10)                                          |
| `sessions-service.ts#SessionsService.constructor` — GC, fermeture du stockage            | constructeur                        | vérifier le moment d'ouverture du stockage (D3 point 4) |
| `http-kernel.ts#HttpKernel.init` — GC du rate-limit, récepteurs h2                       | `init()`                            | inchangé                                                |
| `framework/index.ts` — GC d'idempotence                                                  | `onKernelBoot`                      | inchangé                                                |
| `periodicTask.ts` — `schedulePeriodic`, `runOnceAtStartup`                               | à l'appel                           | inchangé                                                |
| `FrontendService.ts` — superviseurs Vite                                                 | `init()`                            | inchangé                                                |
| `BootReporter.ts` (×3) — affichage, échantillonneur                                      | `onPreStart` / fin du boot          | inchangé                                                |
| `Command.ts#Command.setEvents` — hook `onKernelTerminate` d'une commande                 | `setEvents`                         | inchangé                                                |

## Scénarios jugés

| #   | Scénario                                                         | Aujourd'hui                                                                 | Avec cet ADR                                                                                                                                                                                                                                                            |
| --- | ---------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Le temps réel émet sa dernière preuve de vie sur Redis à l'arrêt | perdue sans `prepend`                                                       | Redis (constructeur) libéré après le temps réel (`onKernelBoot`)                                                                                                                                                                                                        |
| A2  | L'audit vide son agrégateur dans la base                         | base peut-être déjà fermée                                                  | base libérée après l'audit ; aucune requête en vol (phase 1 finie)                                                                                                                                                                                                      |
| A3  | `SIGTERM` pendant le démarrage, avant `onPostReady`              | sonde jamais basculée                                                       | `isTerminating` vrai, sonde à 503                                                                                                                                                                                                                                       |
| A4  | Un écouteur de libération rejette                                | les suivants sautent                                                        | journalisé, sortie 1, les suivants tournent                                                                                                                                                                                                                             |
| A5  | Un écouteur pend                                                 | échéance, sortie 1                                                          | idem ; la ligne nomme la phase                                                                                                                                                                                                                                          |
| A6  | Un service construit pendant l'arrêt                             | son écouteur ignoré ou mal placé                                            | appelé avant ceux qui restent                                                                                                                                                                                                                                           |
| A7  | Commande en une passe (aucun serveur)                            | —                                                                           | `onDrain` sans écouteur : aucun coût                                                                                                                                                                                                                                    |
| A8  | Trois serveurs HTTP à drainer, une connexion lente sur chacun    | jusqu'à 3 × `shutdownTimeout`                                               | 1 × `shutdownTimeout`                                                                                                                                                                                                                                                   |
| A9  | Flux gRPC ouvert à l'arrêt                                       | 14 avant drain (par `prepend`)                                              | 14 avant drain (étape 2 de D2)                                                                                                                                                                                                                                          |
| A10 | L'audit vide ses résumés de refus ; les webhooks y sont abonnés  | les webhooks, inscrits après l'audit, reçoivent les résumés puis s'arrêtent | le consommateur s'arrête avant son producteur (systemd) : les résumés du vidage sont ÉCRITS dans le store, mais ne partent plus en webhook. **Écart accepté** : le répartiteur annulait de toute façon ses envois en vol à l'arrêt ; la trace qui fait foi est le store |

## Alternatives écartées

- **Renverser brutalement le seul `onTerminate`** (proposition initiale du ticket) : casse
  ADR-0026 D8 (§ D1) et garde l'ordre du trafic dépendant des moments d'inscription.
- **Trier par le graphe de dépendances du conteneur** : les écouteurs ne sont pas tous des
  services, et les dépendances prises par `get()` paresseux ne sont déclarées nulle part. L'ordre
  d'inscription en est le témoin fidèle, sans rien à déclarer (le raisonnement de POSIX).
- **Des priorités numériques par écouteur** : chaque auteur de module devrait connaître les
  nombres des autres ; un nombre magique remplace une rustine sans la supprimer.
- **Garder les `prependOnceListener`** : c'est le défaut constaté.

## Compatibilité

- **Changement de comportement d'un événement public** : l'ordre d'`onTerminate` s'inverse. La
  10.0 n'est pas publiée (série `10.0.0-beta`) : le changement entre avant la version stable,
  sous `Changed` au changelog, avec le geste de migration — un écouteur qui sert du trafic passe
  sur `onDrain`.
- **Ajout** : l'événement `onDrain` et l'accesseur `kernel.isTerminating`.
- Un écouteur `onTerminate` d'application qui écrivait dans un store reste correct, et le devient
  dans les cas où il ne l'était pas (A2).

## Coût

Aucun sur le chemin d'une requête : tout se passe à l'arrêt, une fois. `onDrain` sans écouteur ne
coûte qu'un `listenerCount` (déjà le court-circuit d'`emitAsync`).

## Fini quand

Repris du ticket #775, ajusté à D1-D2 :

- test du noyau : la dépendance inscrite d'abord est encore ouverte quand le dépendant s'arrête —
  vu ROUGE avec l'ordre d'inscription ; un rejet n'interrompt pas la phase ; une inscription
  pendant la phase est honorée ;
- `/readyz` à 503 avant la fermeture de la moindre socket, y compris sur un arrêt pendant le
  démarrage ;
- WebSocket fermés en 1001 et flux finis AVANT le drain HTTP : `graceful-shutdown-e2e.mjs` vert ;
- `realtimeTerminate.test.ts` vert sans `prepend` ; banc `presence-pods.mjs` : arrêt propre
  annoncé (1 fin, 0 oubli sur le pair) ;
- l'audit vidé dans une base encore ouverte, la sécurité étant construite AVANT le connecteur :
  test du module sécurité, vu rouge avec l'inscription au constructeur ;
- chaque `prepend` retiré vu rouge seul avant le correctif du noyau.
