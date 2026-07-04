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
→ pattern obligatoire `.default(() => subSchema.parse({}))` partout dans `schema.ts`.
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

- **Pont API souverain (Ph.3, 2026-06-12)** : opt-in `realtimeApiRequest(): boolean` (défaut false ; Studio = true) → méthode RPC `api.request {path}` au handshake. `invokeApiRequest` : split `?` → `router.resolve(ctx, pathname)` (cleanPathOverride) + `resolver.queryOverride` (query per-invocation, parse plat `URLSearchParams`, clés répétées→array ; nested qs NON supporté) → `executeAction(undefined, true)` → valeur nue (peer enveloppe `{id,result}`). N'atteint QUE les routes déclarant `WEBSOCKET` ; path connu sans transport → Router THROW 405 agrégé, catché duck-typing `e.code` 400-599 → `RpcError(-32000, {status})` ; autres throw = `-32603` opaque (Zero Trust). Client : `socket.request("/path")` (overload `RealtimeClient`). 9 tests intég `framework/.../api-souverain-bridge.test.ts` (snapshot ≡ REST, query no-bleed, 404/405, -32602).
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
- **🟠 DETTE #3 pas de frontière dure inter-module** : 1 hub singleton/process = namespace de canaux PLAT partagé par tous les modules. `RealtimeHub.subscribe` n'appelle la factory QUE si le canal n'existe pas encore → un `subscribe` sur un canal DÉJÀ créé par un autre module ajoute le sink **sans aucun contrôle** (cas-fuite « cas 2 »). Barrières actuelles = isolation/connexion + factory (création seulement) + sécu P6 (à brancher) + convention préfixe. Frontière dure (préfixe imposé par controller / voter par namespace dans `beforeDispatch`) = audit isolation inter-module + P6.

## Perf — plan S1 : mutualiser le `JSON.stringify` du fan-out (FUTUR, déclencheur = grand fan-out)

> **Statut : REPORTÉ** (analysé + mesuré 2026-05-30). Le kit perf `project_request_cycle_perf_plan_kit` §3 l'annonçait « gratuit / 0 risque » — **FAUX**. À faire **le jour où un canal à grand fan-out existe** (chat/notif 100+ abonnés). Tant que les broadcasts sont santé/stats/syslog (basse cadence coalescée 200 ms + 1-10 abonnés Studio) → gain négligeable, **ne pas faire**.

**Constat (chaîne réelle)** : `RealtimeHub.#fanout` (`server/RealtimeHub.ts:247`) appelle `sink(payload)` **N×** (1 par abonné). Chaque `sink = (payload) => peer.notify(channel, payload)` (`server/RealtimeController.ts:346`) → `peer.send` = `(frame) => transport.send(JSON.stringify(frame))` (`:209`). Pour un broadcast, la frame `{jsonrpc:"2.0", method:channel, params:payload}` est **IDENTIQUE** pour tous → le `JSON.stringify` est répété **N fois** pour un résultat unique. Le hub est **agnostique** (ne connaît pas le JSON-RPC) → la mutualisation doit lui fournir un sérialiseur.

**Plan d'exécution (RÉTRO-COMPATIBLE — 0 casse)** :

1. `ChannelSink = (payload: unknown, serialized?: string) => void` — 2ᵉ arg **optionnel** ; les sinks existants `(payload) => …` l'ignorent (canaux non-broadcast inchangés).
2. `JsonRpcPeer` : extraire un helper **source unique** `buildNotification(method, params): JsonRpcNotification`, utilisé par `notify()` ET par le serialize (évite la divergence de format).
3. Hub `subscribe(channel, sink, factory, serialize?)` : `serialize?: (payload) => string` optionnel, mémorisé dans `ChannelState.serialize`.
4. `#fanout(st, payload)` : si `st.sinks.size > 1 && st.serialize` → `const raw = st.serialize(payload)` **1×**, puis `for (sink of sinks) sink(payload, raw)`. Sinon comportement actuel (`sink(payload)`).
5. `RealtimeController` : `sink = (p, raw) => raw !== undefined ? transport.send(raw) : peer.notify(channel, p)` ; passer `serialize = (p) => JSON.stringify(JsonRpcPeer.buildNotification(channel, p))` à `subscribe`. ⚠️ `transport.send(raw)` doit reproduire EXACTEMENT `peer.send` (notification sans id → aucun tracking sauté).

**Gain** : N `JSON.stringify` → **1 par publish** (à fan-out N). **Gates** : vitest realtime + `nodefony-check-memory-health` (WS) + bench dédié **grand fan-out** (1 canal, 100+ sockets) — surtout PAS `/als-test/state` (HTTP, hors sujet). Cf `project_request_cycle_perf_plan_kit` §3 (S1) + `feedback_observability_no_prod_impact`.

## API Studio (cible — surfacée dans `/nodefony/documentation`)

- `GET /nodefony/realtime/api/health` → IRealtimeHealth (snapshot)
- Canal `realtime:health` → push tick `sampleEveryMs` (sonde)
- Page Studio Hub (existante) consomme déjà via broker

## Tests (convention vitest — cf `feedback_test_framework_vitest`)

- `npm test` → vitest run (unit + intégration)
- `npm run coverage` → vitest run --coverage (provider v8, reports `.coverage/`)
- **167 unit verts + 9 skipped** (2026-06-12 — les skipped = intégration Redis/cluster réels, auto-skip sans docker). Le rapatriement P13.0 des tests est FAIT (12 fichiers unit + 3 intégration).
