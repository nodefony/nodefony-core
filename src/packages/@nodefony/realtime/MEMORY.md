# MEMORY.md — @nodefony/realtime

Purpose: couche realtime serveur Nodefony (hub WS, JSON-RPC 2.0, backplane cluster).

## Core Components (cible après rapatriement P13.0)

- **`RealtimeService`** (façade DI publique) — wrapper du singleton hub, expose `publish`/`subscribe`/`unsubscribe`/`probe`/`markBroadcastChannel`/`getConfig`/`getHub`/`getBackplane` + (étape 6) `useAuthenticator(matcher, authenticator)` / `getTokenForPeer(peer)` + (P6.14 lot 4) `registerSystemChannel(channel, factory)`. Branche au `initialize` le backplane custom (`config.backplane.instance` OU service DI `realtimeBackplane`) ET le guard Origin (`csrf.checkOrigin`). ✅ livré (Bloc A étape 5 + 6).
- **`registerSystemChannel(channel, factory)`** (P6.14 lot 4) — registre de **canaux SYSTÈME** (plateforme) sur le hub : un module bas niveau (`@nodefony/security` → `security:audit`) déclare au boot la factory d'un canal SANS qu'aucun `RealtimeController` ne le connaisse. `RealtimeHub.subscribe` le consulte en **dernier recours** (quand la factory du controller renvoie `null`) → servable par TOUT endpoint, 0 couplage Studio. Garde la sémantique lazy (créé au 1ᵉʳ abonné, `dispose` au dernier). N'aggrave PAS la dette #3 (factory par nom EXACT, canal plateforme gardé par P6).
- **`IRealtimeAuthenticator`** + `IRealtimeToken` + `IRealtimeHandshake` + `IRealtimeAuthenticatorMatcher` (✅ Bloc A étape 6) — 4 contrats du seam #2 dans `nodefony/interfaces/`. Pattern Symfony 6 (`supports/authenticate/onSuccess/onFailure`). 0 dep `@nodefony/security` (structural typing). `ANONYMOUS_REALTIME_TOKEN` = singleton gelé fallback Zero Trust.
- **`defineRealtimeConfig(config?, { backplane? })`** — builder Zod gelé + `realtimeConfigJsonSchema()` (introspection Studio, exclut `instance`). ✅ livré.
- **`RealtimeHub`** (server) — broker fan-out canaux PARTAGÉS, 1 par pod. Sonde `probe()`.
- **`RealtimeController`** (server, base class) — controllers WS extends ceci. Décorateurs `@RealtimeController`/`@RealtimeEvent` à coder (P13.8).
- **`RealtimeAdminApi`** (server) — endpoint `/nodefony/realtime/api/health` + canal `realtime:health`.
- **`IBackplane`** (contrat) — impls : `LoopbackBackplane` (mono), `ClusterBackplane` (IPC), `RedisBackplane` (✅ P13.5, pub/sub cross-pod). KafkaBackplane = futur (PAS de littéral "kafka" mort tant qu'absent).
- **Registre de drivers** (`backplaneRegistry.ts`) — `registerBackplaneDriver(name, factory)` / `getBackplaneDriver` / `listBackplaneDrivers`. La sélection du backplane résout `config.backplane.driver` (chaîne) → fabrique, **SANS chaîne de `if` sur des noms en dur**. Chaque driver porte son nom (`X.driver` static, littéral unique chez lui). Schéma = `z.string()` ouvert (plus d'enum fermé). Wiring dans `index.ts#wireBackplane` (onKernelBoot, `await start()` avant `setBackplane`). Drivers natifs enregistrés top-level de `index.ts`. Userland : `registerBackplaneDriver("nats", …)` + `driver:"nats"`. Driver inconnu → warn fail-soft (hub local).
- **Env layering** `NF_REALTIME_DRIVER` (convention-frère `REDIS_*`) surcharge le driver après parse dans `defineRealtimeConfig`. ⚠️ L'override app `module-realtime` n'atteint PAS realtime (validé à onRegister, override appliqué à onPreBoot → trop tard : chantier config ordering). Env = lever fiable en attendant.
- **`RedisBackplane`** (✅ P13.5) — fan-out cross-**pod** via pub/sub Redis. Découplé : seam `IRedisBackplaneTransport` injectable (testable sans infra) + adaptateur `createRedisServiceTransport(publisher, subscriber)` (SEUL point couplé à `redis`, couplage **structurel** — 0 dépendance ajoutée à realtime). Canal Redis dédié `REDIS_RT_CHANNEL="nodefony:realtime"` (surchargeable) portant l'enveloppe JSON `{channel,payload,originId}`. Anti-echo par `originId` (Redis renvoie au pod émetteur → filtré sinon double fan-out). Branchement : `redis.getClient("publish"/"subscribe")` → adaptateur → `defineRealtimeConfig({backplane:{driver:"redis"}}, {backplane: bp})` OU service DI `realtimeBackplane`. Tests : 10 unit (bus mémoire) + 2 intégration (Redis docker réel, auto-skip).
- **`RealtimeError`** — base error (code + context). ✅ livré.
- **`JsonRpcPeer`** = reste dans **core** (isomorphe). **Composé des DEUX côtés** : `RealtimeController` (serveur, par connexion) ET `RealtimeClient` (navigateur) — ce dernier depuis **L0 (2026-06-13)** : le client DÉLÈGUE tout le plan de contrôle au moteur (request/notify/stream/receive/register/erreurs/corrélation id) au lieu de le réimplémenter. Effet : `RealtimeClient implements IRealtimePeer` (doc-comment enfin vrai) + `register()` côté client ⇒ **duplex serveur→client réel** (un serveur peut `peer.request` le client).
- **Série « socket isomorphe » L0→L4 ✅ (2026-06-13)** — au-delà de L0 :
  - **L1** : `RealtimeController.requestClient<K extends ActionNames<Actions>>(method, params?, timeout?)` + `notifyClient<K extends EventNames<Emit>>(method, params?)` (protected) = duplex serveur→client **par connexion** (RPC avec réponse / notification ciblée). Usages : confirmation d'action, invalidation cache push+ACK, health S→C.
  - **L3** : `RealtimeController<Emit, Actions>` **générique** (défauts permissifs = rétro-compat ; `extends RealtimeController` sans params inchangé). Une map déclarée UNE fois (`ServerToClient`/`AppActions`) type CLIENT (`on`/`register`) ET SERVEUR (`notifyClient`/`requestClient`) → refactor-safe end-to-end. `Listen` (canaux entrants serveur) hors typage (params `realtimeInbound` NON FIABLES par design sécu). Preuve : `tests/unit/realtimeSharedContract.types.test.ts` (compile-only).
  - **L4** : `ServerRealtimeSocket implements IRealtimeSocket` (+ helper `serverSocket()`) au-dessus du hub → un **service back** tient UN handle (`publish`/`subscribe`/`on`/`channel`) comme une page front. `publish` = fan-out hub (+ backplane). `request` **non supporté** (pas de pair unique côté hub → renvoie vers `requestClient` L1). Écoute serveur = provider VIDE (dette #3 hub).
  - **L5** (mutations via `api.request`) = post-P6 (API souveraine Ph.4).
- **Banc de conformité ISOMORPHE** = [`tests/integration/realtimeLoopback.e2e.test.ts`](nodefony/tests/integration/realtimeLoopback.e2e.test.ts) — VRAI `RealtimeClient` ↔ VRAI `RealtimeController` reliés par un câble loopback in-process (frames STRING sérialisées + async microtask). **26 scénarios E2E** (request C↔S, RpcError code/data, pub/sub ref-count, full-duplex inbound, **duplex S→C result/throw/async** + `notifyClient`, welcome identité, origin, close fatal, **façade serveur L4 publish→client / on / request rejeté**). ⚠️ Indispensable : les unit du client (stubs `handleMessage`/`send`) ne prouvent NI la plomberie du peer NI le duplex — c'est la jonction réelle qui les couvre. Client importé en **source** (teste la refacto sans rebuild) ; handler serveur throw le `RpcError` du **dist** (double identité source/dist — `instanceof` du peer serveur).

## Vocabulaire figé (12 mots, ANALOGIE PHYSIQUE)

- **Socket** = prise murale = `IRealtimeSocket` (handle code applicatif)
- **Hub** = autocom = `RealtimeHub` (broker serveur)
- **Peer** = combiné = `JsonRpcPeer` (parle JSON-RPC 2.0)
- **Transport** = câble = `IRealtimeTransport` (WS / long-polling / TCP/UDP/Unix)
- **Frame** = enveloppe = message JSON-RPC 2.0
- **Channel** = conférence téléphonique = nom de canal (`chat:room-42`)
- **Fan-out** = ventilateur = 1 entrée → N abonnés
- **Backplane** = fond de panier rack = `IBackplane` (cross-pod)
- **Dispatch** = aiguillage = `JsonRpcPeer.dispatch(frame)`
- **AIMD** = régulateur TCP-style = cadence client auto
- **Sonde** = oscilloscope = `IRealtimeProbe.probe()`
- **Seam** = point de greffe = hook pour couche supérieure (security)

## Config DEFAULTS (builder ✅ livré Bloc A étape 5)

```ts
// Forme nominale — defaults sûrs si toute section omise
defineRealtimeConfig({
  enabled: true,
  backplane: { driver: "loopback" }, // "loopback" | "cluster" | "redis" | "kafka"
  cluster: { probe: { enabled: true } }, // sonde agrégée pod (Phase 4c)
  slowConsumer: { bytes: 1 << 20 }, // 1 MiB — seuil backpressure WS
});

// Backplane custom userland (NATS, Pulsar…) — hors schéma sérialisable
import { MyBackplane } from "./my-backplane";
defineRealtimeConfig(
  { backplane: { driver: "loopback" } },
  { backplane: new MyBackplane() },
);
// OU via DI : `module.container.set("realtimeBackplane", instance)` — service le picks up

// JSON Schema (Studio, exclut backplane.instance)
realtimeConfigJsonSchema();
```

**Piège Zod 4** : `.default({})` plat NE déclenche PAS les sous-défauts internes
→ pattern obligatoire `.default(() => subSchema.parse({}))` partout dans `config.ts`.
Cf [[feedback_config_validation_zod]].

## Pipeline (cycle de vie d'une frame en cluster — cas 2 pods)

```
Alice (pod A) → WS → JsonRpcPeer.dispatch (seam #1 beforeDispatch)
  → ChatController.onMessage → RealtimeHub.publish
  → fan-out LOCAL pod A + IBackplane.publish(originPodId=A)
  → réseau (Redis / Kafka / IPC) → IBackplane pod B reçoit
  → filtre anti-écho (originPodId == B ?) → RealtimeHub pod B
  → fan-out LOCAL → JsonRpcPeer envoie sur WS Bob
  → Bob.on receives
```

Alice/Bob ne savent PAS qu'ils sont sur des pods différents. Seul `IBackplane` sait.

## Behaviors

- **Pont API souverain (Ph.3)** : opt-in `realtimeApiRequest(): boolean` (défaut false ; Studio = true) → méthode RPC `api.request {path}` au handshake. `invokeApiRequest` : split `?` → `router.resolve(ctx, pathname)` (cleanPathOverride) + `resolver.queryOverride` (query per-invocation, parse plat `URLSearchParams`, clés répétées→array ; nested qs NON supporté) → `executeActionGuarded(undefined, true)` (porte `@Idempotent`, sans rendu transport) → valeur nue (peer enveloppe `{id,result}`). N'atteint QUE les routes déclarant `WEBSOCKET` ; path connu sans transport → Router THROW 405 agrégé, catché duck-typing `e.code` 400-599 → `RpcError(-32000, {status})` ; autres throw = `-32603` opaque (Zero Trust). Client : `socket.request("/path")` (overload `RealtimeClient`). 9 tests intég `framework/.../api-souverain-bridge.test.ts` (snapshot ≡ REST, query no-bleed, 404/405, -32602).
- **Pont — action RENDUE (`renderJson`/`renderView`)** : le pont pose `renderSink` dans l'ALS (`RequestContextPayload.renderSink`, per-invocation → 0 bleed) ; `WebsocketContext.send()` capture le payload dans le sink AU LIEU d'émettre (sinon : frame NUE hors protocole + retour `WebsocketResponse` circulaire → stringify de l'enveloppe casse). Sink alimenté → `result` = payload re-parsé JSON (sinon texte brut) ; le retour de `renderJson` est ignoré. **Filet fail-safe du send peer** : `JSON.stringify(frame)` sous try/catch — payload non JSON-safe → log ERROR + réponse `-32603 "non-serializable payload"` (frame à `id` ; notification fautive droppée), la chaîne du peer ne casse JAMAIS (avant : unhandledRejection + timeout client silencieux — bug vécu au Playground). Tests fermeture : `http/.../ws-bridge-rendered-action.test.ts` (2 — payload ≡ REST + zéro frame nue, continuité de connexion).
- **Pont — RADIOGRAPHIE par frame** : `invokeApiRequest` ouvre `ctx.beginFrame(method, path)` (→ `FrameProfile` de `@nodefony/http`, `null` en prod) et le pose dans l'ALS (`invocation` + `queries` = son buffer ORM), émet les phases `resolve` / `identity` (re-validation `token.isValid()`) / `action` (`initialize`+`render` arrivent du Resolver/Controller via l'override `phaseStart` du contexte WS), puis `finish(status)` + `ctx.collectFrame(fp)` en `finally`. L'id du profil est rendu au client dans un champ **`meta` FRÈRE du `result`** (`RpcEnvelope` déballée par `JsonRpcPeer.handleRequest`) — le `result` reste NU (« snapshot ≡ GET REST »), et rien n'est émis hors profiling (0 octet en prod). Un **refus** (403/404/405/409/401) porte l'id dans `RpcError.data.requestId` → un refus se radiographie ; une erreur non HTTP-like reste opaque (`-32603`). Client : `RealtimeClient.call(path, init?)` → `{ result, requestId }` (`request`/`mutate` inchangés, valeur nue). ⚠️ Le `id` JSON-RPC ne peut PAS servir de clé de profil : il est choisi par le CLIENT.
- **Statut d'erreur du pont = UNE fonction** (`httpStatusOfFrameError` / `toFrameRpcError`) : le même test « code 400-599 → RpcError(data.status) » était écrit à 2 endroits (catch du resolve, catch de l'action) → unifié dans le catch de l'invocation (règle : une décision, une fonction).
- **Canaux PARTAGÉS** : 1 provider par canal par pod (ref-counté). Re-subscribe à `onopen`.
- **Fan-out local** : appel synchrone à tous les peers locaux abonnés.
- **Filtre anti-écho** : chaque message porte un `originPodId` ; le backplane ne renvoie pas à l'expéditeur.
- **AIMD** : cadence par canal (`subscribe(base, {intervalMs})` ou suffixe `:<ms>`) auto-ajustée sur backpressure observé.
- **Sonde** : tick `sampleEveryMs` pousse `realtime:health` (KPI : abonnés/canal, fan-out/s, `slowConsumers`, `bufferedAmount`).

## Gotchas

- **Handshake async (étape 6)** : `RealtimeController.handleRealtime(null)` lance le handshake **fire-and-forget** (`void onHandshake(ctx)`). Frames texte arrivant pendant l'auth async sont **droppées silencieusement** (transport pas encore branché — `state?.transport.feed`). Comportement attendu : le client doit attendre `realtime:welcome` avant de pousser (ce que `RealtimeClient` fait nativement).
- **Codes close applicatifs** (RFC 6455 §7.4.2) : `4001 unauthorized` (auth fail), `4003 forbidden` (Origin reject). Plage 4000-4999.
- **`getTokenForPeer(peer)`** ne renvoie JAMAIS `null` — fallback `ANONYMOUS_REALTIME_TOKEN`. Code consumer simplifié (voters n'ont pas à guarder le null).
- **Matcher string** → compilé en RegExp **préfixe ancré** (`^<escaped>`) — pas EXACT. `{ pattern: "/admin/" }` matche `/admin/`, `/admin/users`, etc. Pour EXACT, passer une RegExp avec `$` (ex. `/^\/admin\/$/`).
- **NE PAS** créer 2 instances de `RealtimeClient` sur la même URL côté navigateur — utiliser `RealtimeClient.shared({url})` (singleton par URL sur `globalThis`).
- **NORMALISER `http(s)→ws(s)`** dans la clé `shared()` ET dans `new WebSocket(...)` : une URL relative hérite du scheme `https` → si non normalisée, 2 instances + `WebSocket("https://…")` throw.
- **Init depuis `client.state`** côté consommateur de socket partagée : la socket peut être DÉJÀ ouverte (event "connected" déjà passé) → sinon hub affiche "disconnected" à tort.
- **Frame ring lazy** : `__frame__` n'est émis que si un listener écoute → 0 surcoût hors console ouverte. Secrets redactés via `redactFrame`.
- **Tests cluster sans infra (livré Bloc A étape 7)** : `tests/integration/clusterIpc.e2e.test.ts` (5 tests, suite 138/138) — `child_process.fork` 2-3 workers `tsx` qui câblent leur `getRealtimeHub()` singleton + `ClusterBackplane(processIpcTransport)`. Test joue le master : `ClusterRelay` in-process attaché aux `IRelayWorker` (adapter sur `worker.send`/`worker.on('message')`). Prouve fan-out cross-process, fan-out N>2, anti-écho strict (compteur per-worker), duplex, canal non-broadcast instance-local. Pattern réutilisable pour Bloc B/C.
- **Tests cluster Redis/Kafka** : `testcontainers-node` (peerDep dev à ajouter en Bloc B).
- **✅ ex-DETTE #1 RÉSOLUE 2026-06-12 — namespace topic Redis** : champ `backplane.namespace` (Zod `^[\w.-]+$`, optionnel) ; canal effectif = `resolveRedisChannel(ns)` → `nodefony:realtime:<ns>` ; la fabrique redis dérive `ns = config.backplane.namespace ?? kernel.projectName` → 2 apps sur un Redis mutualisé cloisonnées par défaut. ⚠️ 2 déploiements de la MÊME app (staging/prod, même projectName) → poser un `namespace` EXPLICITE. Canal loggé au boot (`describe().channel`). Test 0-cross-talk dans `RedisBackplane.test.ts`.
- **✅ ex-DETTE #2 RÉSOLUE 2026-06-12 — originId cross-pod** : `resolveBackplaneOriginId()` (`backplane/originId.ts`, exporté) = `(POD_NAME ?? os.hostname()):pid`, fallback `randomUUID()` — défaut des 3 backplanes ET du ctx de fabrique (`#wireBackplane`). Couvre k8s (PID 1 ×N pods), bare-metal `-w N` + redis (même host, pids ≠), docker. Test « 2 pods PID 1 → fan-out non avalé » dans `RedisBackplane.test.ts` + `originId.test.ts`.
- **Déclaration broadcast = STATIQUE** : `@RealtimeBroadcast("chat:", …)` (décorateur de CLASSE, `decorators/realtimeDecorators.ts`) enregistre les préfixes **à l'import** dans un registre module-level ; `RealtimeService.init()` les applique au hub au boot (`applyDeclaredBroadcastPrefixes`). POURQUOI : `realtimeBroadcastChannels()` (override, toujours supporté pour un calcul dynamique) n'est appliqué qu'au **handshake d'un client** → un pod qui publie **sans abonné local** (job, webhook, worker) ne forwardait RIEN, en silence, et deux pods identiques diffusaient différemment selon leur historique de connexions. Trouvé sur banc multi-pods réel, invisible en test unitaire.
- **Ingress backplane = contrôle d'admission par canal** (`RealtimeHub.#admitFromBackplane`) : un message venu d'un pair n'est réinjecté (`publishLocal`) QUE si son canal est déclaré broadcast ; sinon compté dans `probe().ingressRejectedTotal` (agrégé pod par `mergeClusterHealth`) et jeté. Symétrie avec `publish` (forward opt-in) → un canal instance-local (`syslog:`, `security:audit`, `realtime:health`) est inatteignable depuis le transport, **quel que soit le driver**. Corollaire opérationnel : un préfixe broadcast doit être déclaré sur TOUS les pods (le controller le fait au handshake), pas seulement chez l'émetteur.
- **Sceau backplane (bus PARTAGÉ uniquement)** : `backplane.secret` (Zod ≥ 32, `.meta({secret:true})`, env `NF_REALTIME_BACKPLANE_SECRET` prioritaire) → `sealBackplaneEnvelope`/`openBackplaneEnvelope` (`backplane/envelope.ts`, HMAC-SHA256 base64url sur `originId\nchannel\npayload`, comparaison `timingSafeEqual`). Secret posé = **fail-closed strict** (non scellé ou altéré → ignoré, pas de downgrade en retirant `sig`) ; secret absent = bus ouvert + WARNING de boot. **Même secret sur tous les pods** sinon plus rien ne passe. `ClusterBackplane` (IPC) n'en prend PAS : son transport est authentifié par construction (master ↔ ses workers). Pas d'anti-rejeu (sémantique at-most-once assumée).
- **File d'envoi backplane BORNÉE** (`backplane/publishQueue.ts`, `BackplanePublishQueue`) : `publish` est fire-and-forget par contrat → le client réseau met en file ce qui n'est pas drainé, **sans limite** (583 MB observés sous rafale au banc, 152 MB au repos). Garde = seuil `backplane.maxQueueBytes` (défaut 8 MiB, `0` = illimité) : si `bytes >= seuil` la publication est **jetée** (on teste l'état de la file AVANT, pas la taille du message — sinon une charge > seuil ne partirait jamais : famine). Compteurs dans `describe().queue` (`bytes`/`maxBytes`/`droppedTotal`/`failedTotal`) → sonde + Studio. Transitions annoncées via `onNotice` (1 WARNING à la saturation, 1 INFO au retour avec le total perdu ; hystérésis à la moitié du seuil contre le flapping de logs). ⚠️ Le seam `IRedisBackplaneTransport.publish` RETOURNE désormais la promesse (`void | Promise<unknown>`) — c'est l'acquittement qui rend la place ; un transport **synchrone** (bus mémoire des tests, IPC) n'a pas de file → garde inerte, jamais de drop. Effet de bord fermé : le `void publisher.publish()` d'avant laissait remonter un `unhandledRejection` quand Redis coupait en plein envoi. Mutualisé pour tout driver cross-host userland (comme `envelope.ts`).
- **Plancher des canaux de PLATEFORME sans module de sécurité** (`RESERVED_SYSTEM_PREFIXES`, `isReservedSystemChannel`, `RealtimeHub.subscribeClient`) : tant qu'aucun `frameAuthorizer` n'est posé, une connexion CLIENTE ne peut pas s'abonner à `security:`/`syslog:`/`orm:`/`node:`/`dashboard:`/`debugbar:`/`realtime:`/`cluster:`/`kernel:` — sans module de sécurité, aucune identité n'existe, donc personne ne peut prouver son droit d'accès. Comparaison insensible à la casse (`SYSLOG:` ne contourne pas). Deux portes distinctes : `subscribeClient` (réseau, plancher appliqué) vs `subscribe` (service interne du serveur, jamais concerné). Le refus est DIT au client (`realtime:denied` motif `forbidden`), compté (`probe().systemFloorDeniedTotal`) et journalisé une fois. Dès qu'un verrou est posé, le plancher s'efface (c'est le verrou qui décide, avec les rôles).
- **Source unique des namespaces réservés = le hub** : `RealtimeService.reservedSystemPrefixes()` est lu par `@nodefony/security` (`firewall.#wireRealtime` → `buildSystemRules(prefixes)`) au lieu de sa propre liste. Le hub possède l'espace de nommage (il sert les canaux), security possède les rôles. Deux inventaires auraient divergé au premier namespace ajouté — et le namespace neuf serait resté **sans politique**, en silence. Repli sur la liste locale de security si le hub est d'une version antérieure (méthode optionnelle du contrat).
- **Avertir à la DÉCLARATION, pas à l'échec** (`onPlatformNotice`, dédup par motif) : `registerChannelPolicy` sur un canal de namespace réservé → WARNING (le plancher l'emportera sur la policy déclarée) ; `markBroadcastChannel` d'un préfixe réservé → **REFUSÉ** + WARNING (diffuser `syslog:` rouvrirait l'ingress du bus à ce canal, donc l'injection cross-pod de fausses lignes). Sans ça, l'auteur d'un canal nommé `syslog:commandes` voyait ses utilisateurs refusés sans jamais savoir d'où venait l'exigence.
- **🟠 DETTE #3 pas de frontière dure inter-module** : 1 hub singleton/process = namespace de canaux PLAT partagé par tous les modules. `RealtimeHub.subscribe` n'appelle la factory QUE si le canal n'existe pas encore → un `subscribe` sur un canal DÉJÀ créé par un autre module ajoute le sink **sans aucun contrôle** (cas-fuite « cas 2 »). Barrières actuelles = isolation/connexion + factory (création seulement) + sécu P6 (à brancher) + convention préfixe. Frontière dure (préfixe imposé par controller / voter par namespace dans `beforeDispatch`) = audit isolation inter-module + P6.

## Perf — fan-out mutualisé (une frame diffusée n'est sérialisée qu'une fois)

Sur un canal diffusé, la frame `{jsonrpc:"2.0", method:<canal>, params:<charge>}` est **identique
pour tous les abonnés** : la sérialiser dans chaque sink refait N fois le même calcul. Le hub étant
agnostique du protocole, c'est **l'abonné qui lui fournit le sérialiseur** ; le hub décide seulement
quand l'appliquer.

Mécanique :

- `ChannelSink = (payload, serialized?) => void` — 2ᵉ argument **optionnel** : un sink historique à
  un paramètre l'ignore, rien ne casse.
- `ChannelSerializer` posé par `subscribe(channel, sink, factory, serialize?)`, mémorisé dans
  `ChannelState.serialize` (le 1ᵉʳ abonné qui en fournit un ouvre la mutualisation pour les suivants).
- `#fanout` : si `serialize !== null && sinks.size > 1` → **une** sérialisation, passée à tous.
  Un seul abonné ⇒ rien à mutualiser ⇒ chemin d'avant, **0 surcoût**.
- `JsonRpcPeer.buildNotification(method, params)` = **source unique** de la frame, utilisée par
  `notify()` ET par le sérialiseur → les deux voies ne peuvent pas diverger (test d'égalité stricte).
- `RealtimeController` : `sink = (p, raw) => raw !== undefined ? state.transport.send(raw) : peer.notify(channel, p)`.

⚠️ **Charge non sérialisable** : `st.serialize(payload)` est protégé — en cas d'échec on repart sans
frame mutualisée, chaque sink reprenant son propre filet (log + `-32603` au client concerné). Sans
cette garde, un objet cyclique casserait le fan-out du canal ENTIER.

**Ce que ça vaut, et comment on le sait** : mesuré sur l'étage fan-out seul (200 abonnés, les deux
chemins dans le même binaire), le coût de sérialisation tombe d'un facteur **26× (charge 50 o) à
62× (2–8 Ko)**. Le banc multi-pods, lui, **ne peut pas trancher** : saturé, sa variance atteint ×3
d'un tir à l'autre, bien au-delà de l'écart cherché — le budget d'une livraison WS y est dominé par
l'écriture réseau. D'où la règle : pour un gain d'étage, mesurer l'étage
(`tests/integration/fanoutSerialize.perf.test.ts`, opt-in `RUN_PERF=1`), pas le système saturé.

## API Studio (cible — surfacée dans `/nodefony/documentation`)

- `GET /nodefony/realtime/api/health` → IRealtimeHealth (snapshot)
- Canal `realtime:health` → push tick `sampleEveryMs` (sonde)
- Page Studio Hub (existante) consomme déjà via broker

## Tests (convention vitest — cf `feedback_test_framework_vitest`)

- `npm test` → vitest run (unit + intégration)
- `npm run coverage` → vitest run --coverage (provider v8, reports `.coverage/`)
- **167 unit verts + 9 skipped** (2026-06-12 — les skipped = intégration Redis/cluster réels, auto-skip sans docker). Le rapatriement P13.0 des tests est FAIT (12 fichiers unit + 3 intégration).
