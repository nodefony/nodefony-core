# Recettes REALTIME — socket isomorphe, WS, hub, RealtimeService

> Chargé à la demande par `SKILL.md`. LE différenciateur Nodefony. Détail-journal = `git log`.

## Sommaire

- Core isomorphe / polymorphisme front-back (lib client + realtime)
- Architecture « la socket Nodefony » (NORTH STAR)
- WebSocket — le socle (`@nodefony/http`)
- `@nodefony/realtime` — module livré (hub + seams + Redis)
- `@nodefony/redis` — driver backplane + sessions
- Pont protocolaire universel (TCP/UDP/SIP)
- Choix de runtime / langage — boussole stratégique

---

### Core isomorphe / polymorphisme front-back (lib client + realtime)

**Le différenciateur** : `nodefony` se résout en **deux builds** selon l'environnement, **même import**.

```jsonc
// package.json "nodefony" — condition browser ⇒ bundle client ; sinon ⇒ build serveur
"exports": { ".": {
  "browser": { "import": { "default": "./dist/client/client/index.js" } },  // Vite/navigateur
  "import":  {            "default": "./dist/node/index.js" } } }            // Node serveur
// subpaths client : nodefony/client · nodefony/react · nodefony/roles · nodefony/debugbar · nodefony/debugbar.js
```

- **Isomorphe** (tourne des 2 côtés) : `RealtimeClient`, `Pdu`, `Syslog`, `Tools`, `roles` (`hasRole`…).
  Build client dédié (`createClientConfig` + `tsconfigClient.json` `types:[]` + shims `node:util/events/cli-color`,
  `preserveModules` → `RealtimeClient`/`Pdu` **partagés** entre subpaths, 0 dup, bundle ~25 KB gz).
- 🚨 **Frontière (sécu MAX)** : ne JAMAIS embarquer de code/données SERVEUR dans le bundle client. La
  condition `browser` résout vers le build client (sans `node:*`, sans services/secrets). Besoin d'un type
  serveur côté front → **type miroir local**, jamais d'import runtime. Seul pont front↔serveur = data plane
  `/nodefony/<module>/api/*` (JSON, secrets redactés serveur).
- **Côté front** (consommation) : hooks `nodefony/react` (`useNodefony*`) → skill `nodefony-studio-dev`.

**`RealtimeClient` (Core, JSON-RPC 2.0, isomorphe)** :

```typescript
import { RealtimeClient } from "nodefony"; // ou nodefony/client côté navigateur
const c = RealtimeClient.shared({ url: "/nodefony/studio/api/realtime" }); // singleton PAR URL (globalThis)
await c.connect();
c.subscribe("dashboard:stats"); // ref-compté (réseau émis aux seules transitions 0↔1)
const off = c.on("dashboard:stats", (p) => {
  /* … */
}); // off() pour se désabonner
const data = await c.request<T>("method", params); // RPC requête/réponse
await c.stream<TChunk>("method", params, (chunk) => {}); // RPC streaming
// getters : state · subscribedChannels · framesReceived · frameLog (ring lazy : émis seulement si listener)
```

- 🚨 **1 SEULE socket par origine** (`shared` singleton) — Studio ET debug bar la partagent. **TOUS** les
  consommateurs ref-comptent (`subscribe`/`unsubscribe`) ; JAMAIS de `emit("subscribe")` brut (un unsub à
  ref→0 couperait le canal pour tous). Normaliser `http(s)→ws(s)` (clé + WebSocket) sinon 2 sockets/throw.

### Architecture « la socket Nodefony » (NORTH STAR — 2026-05-23)

Le realtime est **stratifié** ; seul le transport diffère client/serveur, tout le reste est **isomorphe** :

```
4. Hub        IRealtimeHub        ← LE PATRON : subscribe/publish/on + stats        ⬜ (RealtimeService P13)
3. Endpoint   IRealtimePeer       ← request/notify/receive (1 connexion)            ✅
2. Peer       JsonRpcPeer         ← protocole JSON-RPC 2.0 (discrimination)         ✅
1. Transport  IRealtimeTransport  ← octets : WS / ws / TCP / UDP / SIP / Redis      ✅ (seam polymorphe)
```

> Vision complète : mémoire `project_realtime_nodefony_socket_vision`. Backplane Redis = fan-out cross-pod
> (cloud-native) derrière le MÊME hub (le front ne change pas). « le hub, c'est le patron » : une page parle
> au hub, JAMAIS au socket brut.

**`JsonRpcPeer` (core `src/realtime/`, ISOMORPHE, `implements IRealtimePeer`)** — moteur protocole écrit
UNE fois, composé des 2 côtés. ZÉRO dépendance node (pub/sub via `Map`+callbacks, pas d'`Event`) → aucun shim.

- **Discrimination par `method`, PAS par `id`** (règle absolue) : `method`+`id`=requête → `result`/`error` ;
  `method` seul=notification ; `id` sans `method`=réponse (matchée au pending, ignorée si aucun). `id` string|number.
  Inconnu → `-32601` ; handler qui throw → `-32603` **message générique** (détail via `onError`=Zero Trust).
- API : `register/unregister/methods` (actions entrantes) · `request/requestStream/notify` (sortant) · `receive`
  (entrant) · `dispose`. Bug à NE PAS refaire : le stream doit pousser dans `pending.chunks` (sinon résout `[]`).

**`IRealtimeTransport` (core, seam)** — `connect/send/close/readyState` + `onOpen/onMessage/onClose/onError`.
`TransportState` (0..3, aligné WebSocket). `BrowserWsTransport` (navigateur, wrap `WebSocket`) ; `WsConnectionTransport`
(serveur, wrap `ctx.connection` — inbound poussé par `feed()`, fermeture par `fireClose()`). Le transport est « bête » ;
reconnect/backoff/heartbeat vivent au-dessus (`RealtimeClient` crée un transport NEUF par tentative).

**Endpoint SERVEUR = étendre `RealtimeController` (framework)** — le protocole (handshake/welcome, dispatch,
pub/sub, cleanup) est factorisé ; le contrôleur ne déclare QUE son métier :

```typescript
@controller("/nodefony/<mod>/api")
class MyRealtime extends RealtimeController {
  @route("ws", { path: "/realtime", requirements: { methods: ["WEBSOCKET"] } })
  async realtime(message: string | Buffer | null) {
    this.handleRealtime(message);
  } // délègue tout

  // SEUL point obligatoire : provider d'un canal au subscribe → dispose (appelé au unsubscribe ET au close)
  createRealtimeChannel(
    channel: string,
    publish: RealtimePublish,
  ): (() => void) | null {
    if (channel === "my:chan") return createMyTicker(publish); // null = canal inconnu
    return null;
  }
  protected override realtimeActions() {
    return { "kernel:ping": () => ({ pong: true }) };
  } // requête→result
  protected override realtimeChannels() {
    return ["my:chan"];
  } // annoncés au welcome (+ methods auto)
}
```

- 1 connexion = 1 `JsonRpcPeer` + 1 `WsConnectionTransport` (le MÊME peer que le client). `peer.dispose` + dispose
  des canaux sur `ctx.once("onFinish")`. Le `welcome` annonce `channels` + `methods` (découverte côté client).
- 🚨 **Le générique va dans la lib/le framework**, jamais dupliqué : protocole=`JsonRpcPeer`, plomberie=`RealtimeController`.
  Studio/debugbar/apps partagent. (Avant : chaque controller hand-rollait `dispatchRequest` → dérive. Supprimé.)
- ⚠️ Push hors handshake : `ctx.send()` rejette (`requestEnded`) → la base pousse sur `ctx.connection` brute
  (`WsConnectionTransport`, garde `readyState===1`). **SSE supprimé** (mort + `flushHeaders` absent sur `Http2ServerResponse`
  → `code=000`) ; tout futur SSE écoute `rawRes.once("close")` (RESPONSE), pas `request` (fire trop tôt HTTP/2).

**Côté client (lib, déjà là)** : `client.request<T>("kernel:ping")` (Promise id-matchée) ; helper réutilisable
`client.ping()` (RTT). Le générique vit dans `RealtimeClient`, pas le front.

**Tests realtime (BÉTON, sans navigateur)** :

- `JsonRpcPeer` : `send` capturé dans un tableau, `receive(frame)` → asserte la discrimination + le cycle req/rép
  (`src/nodefony/src/tests/JsonRpcPeer.test.ts`, 14).
- `RealtimeClient` : transport **mock** injecté (2e param ctor) + délais réels → connect/reconnect/heartbeat/disconnect
  (`RealtimeClientTransport.test.ts`, 6) ; discrimination + `ping()` en stubant `request` (`RealtimeClient{Dispatch,Ping}.test.ts`).
- `RealtimeController` : **faux Context** `{ connection: mockConn, once }` (Controller se construit avec `{} as ContextType`),
  sous-classe de test → handshake/welcome/subscribe/actions/-32601/-32603/réponse-ignorée/onFinish
  (`@nodefony/framework` vitest `RealtimeController.test.ts`, 12) + `WsConnectionTransport.test.ts` (7).
- Le dispatch d'action est **async** (microtask) → flusher (`await new Promise(r=>setTimeout(r,0))`) avant d'asserter.

**Auto-observabilité = la sonde de la Socket Nodefony** (`RealtimeHub.probe()`, livré 2026-05-24) —
« la socket s'observe à travers elle-même ». Le multiplexing N canaux/1 WS est bon mais déplace 3 risques
sur le hub → la sonde les rend MESURABLES **avant** d'optimiser :

- `RealtimeHub.probe(): IRealtimeProbe` — lecture PURE (0 alloc, jamais throw) : canaux+`subscribers`+`messages`,
  `publishTotal`/`fanoutTotal` (=publish×abonnés), `inboundTotal`, connexions, `bytes/messagesSentTotal`,
  **`backpressure`{max/totalBufferedAmount, slowConsumers}** (= risque #1, `bufferedAmount` du slow-consumer).
- **Compteurs always-ON** (≠ flux ORM gaté) : intégers O(1) sur `publish`/`send`, **0 syscall/stringify** → la
  backpressure (blocker #1) doit être visible sans flag. (Le flux ORM, lui, chronométrait CHAQUE requête → gaté.)
- `bufferedAmount` vit sur la conn `ws` brute → seul `WsConnectionTransport` l'expose (`implements IRealtimeConnProbe`,
  `bytesSent`/`messagesSent` cumulés dans `send`). `RealtimeController` `registerConnection`/`unregisterConnection`
  (handshake/onFinish, **symétrique**) auprès du hub (registre lazy, lu QUE dans `probe`). Cumuls **monotones** →
  débit dérivé côté lecteur (delta total/ts, comme CPU%/flux ORM). `SLOW_CONSUMER_BYTES=1 MiB` (alerte, **pas** de drop).
- Endpoint `GET /nodefony/realtime/api/health` (`buildRealtimeHealth`=probe+`instanceId`, namespace `realtime` →
  déménagera dans `@nodefony/realtime` P13.1) + canal Studio `realtime:health` (ticker broker `createBrokerTicker`).
- **Ordre des optims** (la sonde = préalable « mesurer avant d'optimiser ») : sonde → **stringify unique broadcast**
  (gratuit, 1× par publish au lieu de N) → **seuil bufferedAmount** drop (latest-wins) / close 1013 (slow-consumer) →
  coalescing si la sonde le justifie. Panneau Studio Hub = côté `nodefony-studio-dev`. [[project_realtime_socket_probe]].

> **NOMMAGE** : « **la Socket Nodefony** » (MAJUSCULE) = le patron/concept entier (prose, docs, pitch) ;
> minuscule/code = vocabulaire stratifié précis (`socket`/`IRealtimeSocket`=prise, `RealtimeHub`=broker,
> `channel`, `transport`/`peer`). Analogie « le Web » vs « un web ». [[project_realtime_nodefony_socket_vision]].

- **Placement (P13.0 FAIT — déménagement effectué)** : hub/sonde/controller/backplanes vivent dans
  **`@nodefony/realtime`** (`nodefony/src/server/{RealtimeHub,RealtimeController,RealtimeAdminApi}.ts`,
  `src/backplane/*`, `src/service/RealtimeService.ts`, `src/transport/WsConnectionTransport.ts`).
  `JsonRpcPeer` reste dans le **core** (isomorphe, subpath `nodefony/realtime`). Config = **`defineRealtimeConfig`**
  (Zod, module realtime) — plus de section dans `@nodefony/http`. Détail : `@nodefony/realtime/MEMORY.md`.
- **Build** : modif Core/subpath `nodefony/*` ou framework → rebuild **puis restart** (Vite ré-optimise au boot).
  Règle perf/mémoire Core s'applique. memory.test obligatoire (touche pipeline WS).
- Réfs : `project_realtime_nodefony_socket_vision`, `project_realtime_socket_probe`, `project_client_lib_subpaths_decision`,
  `project_studio_realtime_ws`, `project_decisions_realtime_isomorphic`, `project_realtime_granularity_clientlib` (AIMD).

**Backplane cross-process — port `IBackplane`** (framework, LIVRÉ Phase 1, `ac21bec`) — l'abstraction de
fan-out **cross-process** du hub. Le hub fait le fan-out LOCAL ; le backplane propage aux **autres pairs**
(workers IPC, pods Redis) et réinjecte localement. **Même contrat, backings interchangeables** → on prouve
l'archi multi-process AVANT toute infra (c'est le mode cluster sans PM2 : cf [[project_cluster_backplane_vision]]).

- `IBackplane` (`interfaces/IBackplane.ts`) : `originId` (identité pair, anti-echo) · `publish(channel,payload)`
  (→ autres pairs, **PAS** de fan-out local) · `onMessage(handler)` (ingress, echo déjà filtré) · `start/stop`.
  Sémantique **best-effort / at-most-once** (pub/sub — 0 garantie ordre/delivery, le client re-sync ; ne pas sur-concevoir).
- `LoopbackBackplane` (no-op, aucun pair) = impl de référence + cible de test.
- **Hub câblé** : `publish` = `publishLocal` **+** `#backplane?.publish` ; `publishLocal` = fan-out local
  SEUL = **voie d'ingress** (jamais re-propagée). `setBackplane(bp)` câble `bp.onMessage→publishLocal` + `bp.start()`.
  **`#backplane = null` par défaut** → 0 overhead mono-process (seul un test `!== null` sur le hot path, style lazy).
  `clear()` détache sans `stop` (lifecycle externe = owner du backplane). Getter `backplane`.
- 🚨 **Anti-boucle = 2 barrières** : (1) ingress → `publishLocal` (jamais `publish`) → pas de re-forward ;
  (2) le backplane filtre son propre `originId`. Une publication LOCALE part au backplane ; un message REÇU n'en repart jamais.
- Impls à venir : **`ClusterBackplane`** (IPC **master-gateway** : worker→`process.send` ; master sert 0 HTTP =
  relay IPC + agrège les sondes + **pont unique** Redis = 1 conn/pod, worker découplé) puis **`RedisBackplane`** (P13, drop-in).
- ⚠️ **Politique par canal** (à trancher Phase 3) : `publish` forward TOUT pour l'instant. Or un canal per-instance
  (`realtime:health` = snapshot du pod) ne doit PAS se mélanger cross-pod. Le harnais cluster RÉVÉLERA ces cas =
  l'intérêt de tester tôt. Phase 2 = lifecycle cluster core (`nodefony cluster`, fork cgroup-aware, respawn, `isPrimary`).

## 6. Realtime — LE différenciateur (WS natif + RealtimeService TCP/UDP/Redis)

Le temps réel est **le patron** de Nodefony (HTTP et WS co-citoyens, même pipeline). Protocole =
**JSON-RPC 2.0 maison** (pas Socket.IO : contrôle total, type-safe de bout en bout, 0 dep lourde) :
RPC bidirectionnel typé + streaming + **fallback HTTP long-polling** auto (résilience proxy/firewall).

**Architecture (3 couches — LIVRÉE sauf TCP/UDP)** :

```
[Serveurs physiques : WS(5151/5152) ✅ · TCP · UDP · Unix ⬜ (restes P13)]
        ↓
[RealtimeService (façade DI, @nodefony/realtime) ✅]  ── seam auth IRealtimeAuthenticator (P6-ready)
        ↓ publish/subscribe (fan-out local = RealtimeHub)
[IBackplane cross-pod : Loopback ✅ | Cluster IPC ✅ | Redis ✅ | Kafka ⬜ P13.6]  ── anti-echo originId
```

### A. WebSocket — le socle (BUILT, `@nodefony/http`)

- 2 serveurs `ws@8` : `ws://5151` (sur http) + `wss://5152` (sur https). **Même pipeline Controller que HTTP**.
- Flow : `connection` → `handleWebsocket` → `createWebsocketContext` → `handleFrontController` (**route résolue
  AVANT accept**) → check protocole (mismatch → close **1002**) → `connect()` (handshake) → `execute(null)`
  (handshake, message=**undefined**) → `execute(message)`. `IWsRequestExtension` (`request.url` = `URL`).
- **Push serveur→client** : après handshake `ctx.send()` **REJETTE** (`requestEnded`) → `ctx.connection.send(str, cb)`
  (garde `readyState===1`). `broadcast()` = `wss.clients.forEach` (inclut l'émetteur). SSE = `rawRes.once("close")`.
- **ALS WS** : listeners `message`/`close` attachés dans la bulle `RequestContext.run` → `AsyncResource.bind`.
- **Pub/sub par canal on-demand** (pattern Studio) : client `subscribe`/`unsubscribe {channel}` → serveur démarre/
  arrête un **provider** transport-agnostique (`createXxx(publish)`). État `Map<channel,dispose>` sur le ctx,
  `dispose()` garanti `ctx.once("onFinish")`, câblage 1× au handshake (flag), `setInterval` **unref**.
- **Back-pressure (S2)** : push borné par `bufferedAmount` → consommateur lent = **drop latest-wins** puis close
  **1013** (Try Again Later) si le buffer reste saturé. Superviser ≠ tomber la prod : budget borné + dégradable.
- Stress mesuré : ~16k connexions (plafond ports éphémères loopback) / ~40k msg/s fan-out propre / ~120k =
  saturation. Lag Studio résolu par **coalescing** (ring buffer + flush). Bench → skill `nodefony-load-test`.

### B. `@nodefony/realtime` — module LIVRÉ (P13.0 + seams + Redis ✅, 167 tests)

Le module porte la couche realtime serveur (hub WS, JSON-RPC 2.0, backplane cluster). **Vérité = son
`MEMORY.md`** (vocabulaire figé 12 mots, config defaults, pièges Zod). Livré :

- **`RealtimeService`** (façade DI publique) : `publish/subscribe/unsubscribe/probe/markBroadcastChannel/
getConfig/getHub/getBackplane` + **seam auth** `useAuthenticator(matcher, authenticator)` /
  `getTokenForPeer(peer)`. Branche au `initialize` le backplane custom (`config.backplane.instance` OU
  service DI `realtimeBackplane`) + guard Origin (`csrf.checkOrigin`).
- **Seam sécurité (P6-ready)** : `IRealtimeAuthenticator`/`IRealtimeToken`/`IRealtimeHandshake`/
  `IRealtimeAuthenticatorMatcher` (pattern Symfony `supports/authenticate/onSuccess/onFailure`,
  **0 dep `@nodefony/security`** — structural typing). `ANONYMOUS_REALTIME_TOKEN` = fallback Zero Trust.
- **Backplanes** (contrat `IBackplane`) : `LoopbackBackplane` (mono) · `ClusterBackplane` (IPC) ·
  **`RedisBackplane`** (pub/sub cross-pod, anti-echo `originId`, seam `IRedisBackplaneTransport`
  testable sans infra). **Registre de drivers** `backplaneRegistry` (`registerBackplaneDriver` — 0 `if`
  sur noms en dur, userland peut brancher NATS/Pulsar). Env `NODEFONY_REALTIME_DRIVER` surcharge.
- **`defineRealtimeConfig(config?, { backplane? })`** (builder Zod gelé) + `realtimeConfigJsonSchema()`.

**Reste P13** : `KafkaBackplane` (P13.6) · décorateurs `@RealtimeController`/`@RealtimeEvent` (P13.8) ·
serveurs **TCP/UDP/Unix** bas niveau (transport actuel = `WsConnectionTransport` seul ; ref JS
`bundles/realtime-bundle/`) · banc conformité ventilation · dette #3 auth WS (**attend P6**).
⚠️ **WS reste dans `@nodefony/http`** (serveurs physiques) — realtime = hub/protocole/backplane au-dessus.
Cf [[project_p13_realtime_finish_plan]].

### C. `@nodefony/redis` — refondu ✅ (driver backplane + sessions)

Fournit les clients pub/sub au `RedisBackplane` (`redis.getClient("publish"/"subscribe")` →
`createRedisServiceTransport`) + storage (cache / **session** / lock). Le scaling multi-instance
WS broadcast passe par le backplane Redis (cf B) — plus de `RedisRealtimeHub` séparé.

### E. Pont protocolaire universel (P15 — la valeur centrale vs Socket.IO)

Un navigateur **n'ouvre pas** de socket TCP/UDP. `RealtimeService` **proxifie** : le browser parle
`<protocole>-over-WS` → Nodefony décapsule → socket TCP/UDP natif côté serveur. Ex. **SIP-over-WS → Asterisk**
(qui ne parle que TCP/UDP). À penser comme **fondation** (pas mediasoup-only).

- **mediasoup** (P15) : `PlainTransport` (RTP/RTCP brut, **pas** WebRTC navigateur), `PipeTransports` pod-to-pod
  (bypass Redis/Kafka pour les flux media binaires). Test ultime de l'archi (perf P1 + ALS + agents P12). Cible :
  agent IA vocal PSTN (téléphone → Asterisk → STT → LLM → TTS → retour).

### Réfs realtime

mémoires `project_decisions_realtime_isomorphic` (IRealtimeHub/RealtimeService/JSON-RPC/SIP/mediasoup) ·
`project_phase13_realtime_redis_client` (3 modules) · `project_studio_realtime_ws` (pattern built + forward-compat +
gotcha push) · `project_multiprocess_scaling` (Redis fan-out) · `project_realtime_vision_studio_beta` (vision) ·
`project_ws_stress_studio_lag` (limites). Roadmap détaillée → skill **`nodefony-roadmap`** (Phase 13). RFC WS → `nodefony-rfc`.

### F. Choix de runtime / langage — boussole stratégique (TOUJOURS à l'esprit)

> Contexte permanent pour tout raisonnement sur la couche realtime/perf. Question posée par le user
> (2026-05-23) : « quel langage choisir pour Nodefony et ses specs temps réel ? ». La réponse oriente
> chaque décision d'archi du hot path.

**Le plafond observé = famine de l'event-loop MONO-THREAD** (test de charge 2026-05-23 : WS 1300 +
80k msg/s → 0 % err MAIS realtime figé par vagues, ping ORM gonflé 8 s = ordonnancement pas la base).
C'est un **artefact du modèle Node**, pas une fatalité. Garder ça en tête : sous charge, le
**différenciateur (realtime) meurt EN PREMIER** car tout (CPU-bound, sérialisation, ticker, ORM
synchrone) se bat sur un thread.

**Runtimes où ce problème n'existe pas** (pour situer nos choix, PAS pour réécrire) :

- **Elixir/BEAM** = réponse de manuel pour le pur realtime : process préemptifs (une requête lente ne
  gèle pas les autres), Phoenix Channels (= notre patron canal/ref-count natif), clustering distribué
  natif (= notre fan-out Redis gratuit), supervision/« let it crash » (résilience cloud-native),
  backpressure first-class (GenStage = notre AIMD). **Origine télécom → colle au Phase 15 SIP.**
- **Go** : goroutines = 1 conn = 1 goroutine, vrai parallélisme, tue le fan-out de connexions.
- **Rust** : perf/p99 ultimes, 0 GC — mais vélocité trop lente (solo) + ergonomie DI/agentic pénible.

**MAIS le pari #1 de Nodefony = le Core ISOMORPHE** (même code client+serveur : `RealtimeClient`
partagé, debug bar, hooks). **Seul TS tourne nativement dans le navigateur** — aucun langage
compilé/BEAM n'est isomorphe. Changer = tuer l'isomorphisme (re-créer une lib cliente = ce que P13.3
a justement supprimé).

**→ Décision (boussole) :**

- **Le framework reste TypeScript** : l'isomorphisme EST Nodefony, non négociable. Le plafond
  event-loop se **mitige** (worker_threads pour le CPU-bound, AIMD/backpressure, sortir l'ORM
  synchrone du thread principal).
- **Si l'isomorphisme était négociable & seul le realtime à l'échelle comptait → Elixir/Phoenix.**
- **Geste malin (polyglotte ciblé)** : `RealtimeService`/`IRealtimeHub` est **déjà
  transport-agnostique** → c'est LE seam pour pousser, le jour du mur, le hot path du hub (pump WS,
  fan-out, backpressure) dans un **addon natif Rust (napi-rs)** in-process OU un **sidecar Go/Elixir**
  parlant notre JSON-RPC, **sans toucher au framework**. L'abstraction déjà en place vaut de l'or
  précisément pour ça. Réfs : [[project_realtime_granularity_clientlib]] (AIMD), [[project_decisions_realtime_isomorphic]].
