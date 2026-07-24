# Realtime (WS/hub/RealtimeService) — référence complète (recettes + API + internals + gotchas)

> Chargé à la demande par `SKILL.md`. **1 concern = 1 fichier** : recettes copier-coller PUIS API publique + internals + gotchas du module. Vérité courante (édition en place, git = historique).

## ▸ Partie A — Recettes (copier-coller, usage)

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
// getters : state · subscribedChannels · framesReceived · frameLog (ring lazy : émis seulement si listener)
```

- 🚨 **1 SEULE socket par origine** (`shared` singleton) — Studio ET debug bar la partagent. **TOUS** les
  consommateurs ref-comptent (`subscribe`/`unsubscribe`) ; JAMAIS de `emit("subscribe")` brut (un unsub à
  ref→0 couperait le canal pour tous). Normaliser `http(s)→ws(s)` (clé + WebSocket) sinon 2 sockets/throw.

### Architecture « la socket Nodefony » (NORTH STAR)

Le realtime est **stratifié** ; seul le transport diffère client/serveur, tout le reste est **isomorphe** :

```
4. Hub        RealtimeHub         ← LE PATRON : subscribe/publish/on + stats        ✅ (classe ; pas d'interface IRealtimeHub exportée — façade userland = RealtimeService)
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
- API : `register/unregister/methods` (actions entrantes) · `request/requestTraced/notify` (sortant) · `receive`
  (entrant) · `dispose`. **Pas de streaming RPC** : une action rend UNE valeur, aucune frame de fragment
  n'existe. Réponse qui progresse (LLM, export long) → motif « travail + canal ».

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
- **Geste malin (polyglotte ciblé)** : `RealtimeService`/`RealtimeHub` est **déjà
  transport-agnostique** → c'est LE seam pour pousser, le jour du mur, le hot path du hub (pump WS,
  fan-out, backpressure) dans un **addon natif Rust (napi-rs)** in-process OU un **sidecar Go/Elixir**
  parlant notre JSON-RPC, **sans toucher au framework**. L'abstraction déjà en place vaut de l'or
  précisément pour ça. Réfs : [[project_realtime_granularity_clientlib]] (AIMD), [[project_decisions_realtime_isomorphic]].

## ▸ Partie B — API, internals & gotchas

> Chargé à la demande par `nodefony-framework-dev/SKILL.md`. Cible : coder le realtime Nodefony depuis le **dist npm seul** (projet consumer, sans le source).
> **Périmètre** : surface publique exportée (rôles + signatures) + internes (mécanique) + pièges realtime.
> **NE COUVRE PAS** les recettes d'usage (écrire un controller WS, subscribe client, flot d'une frame) → `references/realtime.md`.
> Ancres `fichier:ligne` = provenance vérifiée (repo `nodefony-core`), pour contrôle. Roots : **rt/** = `src/packages/@nodefony/realtime/` · **core/** = `src/nodefony/`.

## Sommaire

- [1. Purpose — le différenciateur](#1-purpose)
- [2. Surface API publique (exports)](#2-surface-api)
  - [2.1 `RealtimeService` — façade DI serveur](#21-realtimeservice)
  - [2.2 `RealtimeHub` — broker singleton](#22-realtimehub)
  - [2.3 `RealtimeController` — base endpoint WS](#23-realtimecontroller)
  - [2.4 `ServerRealtimeSocket` — handle serveur](#24-serverrealtimesocket)
  - [2.5 `RealtimeClient` — client isomorphe (core)](#25-realtimeclient)
  - [2.6 `JsonRpcPeer` + `IRealtimeSocket` (core)](#26-jsonrpcpeer)
  - [2.7 Backplane — `IBackplane`, drivers, registre](#27-backplane)
  - [2.8 Décorateurs realtime](#28-decorateurs)
  - [2.9 Sondes + admin API](#29-sondes)
  - [2.10 Config — `defineRealtimeConfig`](#210-config)
- [3. Internals (mécanique)](#3-internals)
- [4. Gotchas spécifiques realtime](#4-gotchas)

---

<a id="1-purpose"></a>

## 1. Purpose — le différenciateur

**Le temps réel est le patron de Nodefony** : HTTP et WS sont co-citoyens du **même pipeline controller**. Là où Socket.IO impose une lib parallèle, Nodefony multiplexe N canaux sur 1 WS via un **protocole JSON-RPC 2.0 maison** type-safe de bout en bout.

Quatre briques :

- **WS natif** — les 2 serveurs `ws` (`ws://5151`, `wss://5152`) vivent dans `@nodefony/http` ; le transport serveur est `WsConnectionTransport` (wrap d'une conn `ws` brute). `@nodefony/realtime` est la couche **au-dessus** (hub / protocole / backplane), PAS les serveurs physiques.
- **Hub + façade** — `RealtimeHub` (broker fan-out **par pod**, canaux partagés ref-comptés) exposé via la façade DI `RealtimeService`. Pas d'interface `IRealtimeHub` exportée : le « patron » est la classe `RealtimeHub` (singleton `getRealtimeHub()`) ; la surface stable userland est `RealtimeService`.
- **Backplane cross-process** — port `IBackplane` à drivers interchangeables : `loopback` (mono), `cluster` (IPC workers d'un pod), `redis` (pub/sub cross-pod multi-host). Même hub, le front ne change pas. Kafka/NATS/Pulsar = drivers userland via le registre.
- **Pont protocolaire** — un canal n'est pas qu'un pub/sub : son backing est pluggable côté serveur (encapsulation SIP-over-WS, bridge TCP/UDP, proxy). Un navigateur n'ouvre pas de socket TCP → le serveur décapsule. Fondation des cas média (mediasoup) et agents IA vocaux.

**Isomorphe** : le client `RealtimeClient` vit dans le **core** (subpath `nodefony/realtime`, importable navigateur, 0 dép serveur) et compose le **même** `JsonRpcPeer` que la connexion serveur. Écrire le protocole une fois, tourner des 2 côtés. Vocabulaire : `socket` = la prise (`IRealtimeSocket`, ce qu'on tient) · `hub` = broker serveur · `peer` = `JsonRpcPeer` · `transport` = la couche octets · `backplane` = fond de panier cross-pod.

---

<a id="2-surface-api"></a>

## 2. Surface API publique (exports)

Tout est exporté depuis `@nodefony/realtime` (`rt/index.ts`), sauf les briques **isomorphes** depuis `nodefony` / `nodefony/realtime` / `nodefony/client` (core).

<a id="21-realtimeservice"></a>

### 2.1 `RealtimeService` — façade DI serveur

`rt/nodefony/src/service/RealtimeService.ts:48`. Service DI nommé **`realtimeService`**, wrapper mince du singleton `RealtimeHub`. C'est l'API stable userland serveur (`this.get("realtimeService")`).

| Méthode                                 | Signature                                                                      | Rôle                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `publish`                               | `(channel: string, payload: unknown): void`                                    | Fan-out local + backplane si broadcast. `:123`                      |
| `subscribe`                             | `(channel, sink: ChannelSink, factory: ChannelFactory): boolean`               | Abonne un sink ; `false` si canal inconnu. `:133`                   |
| `unsubscribe`                           | `(channel, sink: ChannelSink): void`                                           | Désabonne ; dispose le provider au dernier. `:145`                  |
| `registerSystemChannel`                 | `(channel: string, factory: ChannelFactory): void`                             | Canal **plateforme** servable par tout endpoint. `:156`             |
| `markBroadcastChannel`                  | `(prefix: string): void`                                                       | Déclare un préfixe **cross-process** (sinon instance-local). `:170` |
| `probe`                                 | `(): IRealtimeProbe`                                                           | Snapshot d'observabilité du hub. `:161`                             |
| `getHub` / `getBackplane` / `getConfig` | `(): RealtimeHub` / `IBackplane \| null` / `IRealtimeConfig`                   | Accès bas niveau + config gelée. `:110/:115/:102`                   |
| `useAuthenticator`                      | `(matcher: IRealtimeAuthenticatorMatcher, auth: IRealtimeAuthenticator): void` | Seam #2/#3 (P6). `:189`                                             |
| `setFrameAuthorizer`                    | `(authorizer: FrameAuthorizer \| null): void`                                  | Seam #1 verrou de frame (P6). `:211`                                |
| `resolveChannelPolicy`                  | `(channel: string): IChannelPolicy \| null`                                    | Seam #1b — policy déclarée. `:225`                                  |
| `getTokenForPeer`                       | `(peer: JsonRpcPeer): IRealtimeToken`                                          | Identité résolue au handshake (jamais `null`). `:235`               |

`init()` (`:77`, phase `onPreBoot`) : pose la config, branche un backplane custom (`config.backplane.instance` OU service DI `realtimeBackplane`, **uniquement si** `hub.backplane === null`), puis pose le guard Origin (`hub.setOriginGuard`, `:97`).

<a id="22-realtimehub"></a>

### 2.2 `RealtimeHub` — broker singleton

`rt/nodefony/src/server/RealtimeHub.ts:117`. **1 pod = 1 process = 1 hub** (singleton lazy `getRealtimeHub()` `:706`). Consommé directement par les controllers/admin/WS handlers ; userland passe par `RealtimeService`.

**Cœur fan-out / pub-sub** :

- `subscribe(channel, sink, factory): boolean` `:199` — crée le provider partagé au **1ᵉʳ** abonné (sink ajouté AVANT `factory` → capte le 1ᵉʳ push), sinon ajoute le sink. `factory` renvoie `null` → canal inconnu (dernier recours : registre des canaux système). `forward` (broadcast ?) résolu UNE fois ici.
- `unsubscribe(channel, sink)` `:240` — `dispose()` le provider au **dernier** abonné.
- `publish(channel, payload)` `:268` — fan-out local (`#fanout`) **+** `#backplane.publish` SI le canal est broadcast. Mono-process : un seul test `#backplane === null` payé (`:273`).
- `publishLocal(channel, payload)` `:287` — fan-out local **SEUL** (voie d'ingress backplane, jamais re-propagée).
- `markBroadcastChannel(prefix)` `:318` — déclare un préfixe cross-process (réévalue les canaux déjà actifs). Défaut : **aucun** → tout instance-local (anti-fuite Zero Trust).
- `setBackplane(bp): IBackplane` `:348` — câble `bp.onMessage → publishLocal` + `bp.start()`. `get backplane` `:356`.

**Sondes / connexions** : `probe(): IRealtimeProbe` `:394` · `registerConnection`/`unregisterConnection(conn: IRealtimeConnProbe)` `:370/:375` (symétrique handshake/close) · `recordInbound()` `:383` · `subscriberCount(channel)` `:361` · `activeChannels` `:452`.

**Seams sécurité (P6, cold-path)** : `useAuthenticator`/`resolveAuthenticator` `:470/:488` · `setOriginGuard`/`checkOrigin` `:505/:513` · `setTokenForPeer`/`getTokenForPeer` (WeakMap, jamais `null`) `:522/:534` · `setFrameAuthorizer`/`hasFrameAuthorizer`/`runAuthorizer` `:543/:552/:610` · `registerChannelPolicy`/`resolveChannelPolicy` `:565/:577` · `registerSystemChannel` `:593` · `clear()` (reset, ne `stop()` PAS le backplane) `:622`.

Types : `ChannelSink = (payload: unknown) => void` `:62` · `ChannelFactory = (channel, publish: RealtimePublish) => (() => void) | null` `:71` · `SLOW_CONSUMER_BYTES = 1<<20` `:56`.

<a id="23-realtimecontroller"></a>

### 2.3 `RealtimeController` — base endpoint WS

`rt/nodefony/src/server/RealtimeController.ts:79`. `abstract RealtimeController<Emit extends EventsMap = Default, Actions extends ActionsMap = Default> extends Controller implements IRealtimeController`. Factorise TOUT le protocole ; une sous-classe garde sa route WS et délègue à `handleRealtime(message)`.

**Override seams** (tous `protected`, défauts vides/sûrs) :

| Hook                        | Signature                                                   | Rôle                                                                                                                  |
| --------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `createRealtimeChannel`     | `(channel, publish: RealtimePublish): (() => void) \| null` | Provider d'un canal (pattern/regex/suffixe `:<ms>`). `null` = inconnu. **public** (sur `IRealtimeController`). `:106` |
| `realtimeActions`           | `(): Record<string, RpcActionHandler>`                      | Actions RPC requête→réponse. `:114`                                                                                   |
| `realtimeChannels`          | `(): string[]`                                              | Canaux annoncés au welcome. `:119`                                                                                    |
| `realtimeBroadcastChannels` | `(): string[]`                                              | Préfixes cross-process de cet endpoint. `:130`                                                                        |
| `realtimeInbound`           | `(): Record<string, RealtimeInboundHandler>`                | Canaux **full-duplex entrants** (client→serveur). Défaut vide = aucun (sûr). `:140`                                   |
| `realtimeApiRequest`        | `(): boolean`                                               | Opt-in du pont `api.request {path}` (« API souveraine »). Défaut `false`. `:154`                                      |

**Duplex serveur→client (par connexion)** : `requestClient<K>(method, params?, timeoutMs?): Promise<ActionResult>` `:198` (RPC vers une action que le client a `register`) · `notifyClient<K>(method, params?): void` `:224` (notification ciblée). `handleRealtime(message: string|Buffer|null)` `:168` : `null` = handshake (fire-and-forget `onHandshake` async), sinon `transport.feed(message)`.

Types : `RealtimePublish = (channel: string, payload: unknown) => void` · `RealtimeInboundHandler = (params: unknown, reply: (payload: unknown) => void) => void` (`rt/nodefony/interfaces/IRealtimeController.ts:2/:16` ; `params` **NON FIABLE** → valider).

<a id="24-serverrealtimesocket"></a>

### 2.4 `ServerRealtimeSocket` — handle serveur

`rt/nodefony/src/server/ServerRealtimeSocket.ts:43`. `implements IRealtimeSocket` au-dessus du hub : un **service back** tient UN handle comme une page front. Fabrique `serverSocket<Emit, Listen, Actions>()` `:223`.

- `publish(channel, payload)` `:56` — fan-out hub (+ backplane si broadcast). **Cas d'usage principal.**
- `subscribe`/`unsubscribe` `:68/:81` — le service ÉCOUTE (ref-compté). Au 1ᵉʳ abonné, pose une **écoute passive** (`hub.listen`, `:77`) : le service reçoit ce qui passe **sans ouvrir le canal**. Un canal tenu par de seuls écouteurs est `passif` — la 1ʳᵉ connexion cliente qui le demande fait rejouer la fabrique du controller, qui seule décide de son existence.
- `on`/`off`/`channel` `:97/:117/:147` · `getStats`/`getChannelStats`/`subscribedChannels` `:175/:180/:185`.
- `request(...)` `:131` — **rejette toujours** (pas de pair unique côté hub multi-clients) → utiliser `RealtimeController.requestClient` pour un RPC 1-1.

Lazy : aucune structure allouée tant que le service n'`on`/`subscribe`/`publish` pas.

<a id="25-realtimeclient"></a>

### 2.5 `RealtimeClient` — client isomorphe (core)

`core/src/client/realtime/RealtimeClient.ts:154`. `import { RealtimeClient } from "nodefony"` (ou `nodefony/client` navigateur). `implements IRealtimeSocket<Emit, Listen, Actions>, IRealtimePeer<Emit, Actions>`. Compose le **même** `JsonRpcPeer` que le serveur ; n'ajoute que transport/reconnect/heartbeat/stats/identité/ref-count.

| Méthode                               | Signature                                                             | Rôle                                                                                                   |
| ------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `static shared`                       | `(opts?: RealtimeOptions): RealtimeClient`                            | **Singleton par URL** (`globalThis`) — 1 seule socket/origine. `:236`                                  |
| `connect` / `disconnect` / `retryNow` | `(url?) => Promise<void>` / `()` / `()`                               | Cycle de vie (idempotent). `:304/:311/:287`                                                            |
| `subscribe` / `unsubscribe`           | `(channel): void`                                                     | **Ref-compté** : `subscribe` réseau émis aux seules transitions 0↔1, ré-émis au reconnect. `:423/:434` |
| `on` / `off`                          | `(channel, handler): () => void` / `void`                             | REÇOIT (≠ `subscribe` qui DEMANDE). `:329/:340`                                                        |
| `publish` / `emit`                    | `(channel, payload?): void`                                           | Notification au serveur (one-way). `:406/:384`                                                         |
| `request`                             | `(method, params?, timeoutMs?) \| (path: \`/${string}\`, timeoutMs?)` | RPC corrélé. Forme **path** (1ᵉʳ char `/`) → pont `api.request` (GET REST via WS). `:579`              |
| `mutate`                              | `(path, { method, body?, idempotencyKey, timeoutMs? }): Promise<T>`   | Mutation via pont (clé d'idempotence **obligatoire**). `:616`                                          |
| `stream`                              | `(method, params, onChunk, timeoutMs?): Promise<TChunk[]>`            | Streaming token-by-token (LLM). `:665`                                                                 |
| `register` / `unregister`             | `(method, handler): void`                                             | Expose une action **appelable par le serveur** (duplex). `:713/:721`                                   |
| `ping`                                | `(timeoutMs?): Promise<KernelPingResult & { rtt }>`                   | RTT via `kernel:ping` (helper réutilisable). `:645`                                                    |
| `adaptiveChannel`                     | `(base, handler, options): AdaptiveChannelBinding`                    | Canal d'ÉTAT en cadence AIMD (latest-wins). `:533`                                                     |

Getters : `state` · `identity` (résolue au `realtime:welcome`, `null` avant) · `serverChannels`/`serverMethods` (découverte) · `subscribedChannels` · `framesReceived` · `frameLog` (ring lazy, redacté) · `reconnectAttempts`/`nextRetryAt`. Events locaux (jamais réseau) : `onNotice`/`onDenied`/`onIdentity`. Transport injectable (2ᵉ arg ctor) → testable sans vrai socket.

<a id="26-jsonrpcpeer"></a>

### 2.6 `JsonRpcPeer` + `IRealtimeSocket` (core)

`core/src/realtime/JsonRpcPeer.ts:237` — moteur protocole **JSON-RPC 2.0** isomorphe, 0 dép Node (browser-safe). `import { JsonRpcPeer, RpcError } from "nodefony"`.

- `new JsonRpcPeer(opts: JsonRpcPeerOptions)` `:250` — `opts = { send, onNotification?, onError?, beforeDispatch?, onFrameAudit? }` (`:116`).
- Sortant : `request<K>(method, params?, timeoutMs=30000)` `:276` · `notify<K>(method, params?)` `:303`.
- Entrant/callee : `register<K>(method, handler)` `:255` · `unregister` `:266` · `receive(frame): JsonRpcFrameKind` `:315` · `methods` `:271` · `dispose(reason?)` `:378`.
- `RpcError extends Error` `:70` — `{ code: number, data?: unknown }`, plage applicative `-32000..-32099`. **Seule** façon d'exposer un code/message au pair (tout autre throw → `-32603` opaque). Isomorphe : `catch (e) { if (e instanceof RpcError) e.data.status }`.

`IRealtimeSocket<Emit, Listen, Actions>` `core/src/realtime/IRealtimeSocket.ts:122` — contrat de « la socket » (`subscribe`/`on`/`publish`/`request`/`channel`). Sous-types : `IRealtimeChannel` (`:87`, vue par-canal `on`/`send`/`open`/`close`) · `IChannelStats` (`:64`) · `RealtimeHandler` (`:58`). `IRealtimePeer<Emit, Actions>` = surface bidirectionnelle (`JsonRpcPeer.ts:183`).

<a id="27-backplane"></a>

### 2.7 Backplane — `IBackplane`, drivers, registre

Port `IBackplane` `rt/nodefony/interfaces/IBackplane.ts:75` :

```ts
interface IBackplane {
  readonly originId: string; // identité pair, anti-echo  :77
  start(): void | Promise<void>; // idempotent (sync IPC / async Redis)  :83
  publish(channel: string, payload: unknown): void; // → AUTRES pairs, PAS de fan-out local  :89
  onMessage(handler: BackplaneHandler): void; // ingress (echo déjà filtré), 1 handler  :95
  stop(): void | Promise<void>; // idempotent  :98
  describe(): IBackplaneInfo; // carte d'identité (driver/kind/crossPod/channel)  :104
}
```

`IBackplaneMessage = { channel, payload, originId }` `:34` · `BackplaneHandler = (msg) => void` `:48` · `IBackplaneInfo = { driver, kind, originId, crossPod, channel? }` `:57`. Livraison **best-effort / at-most-once** (le client re-sync ; ne pas sur-concevoir).

Drivers (chacun porte `static readonly driver`) :

- `LoopbackBackplane` `rt/.../backplane/LoopbackBackplane.ts:24` — `driver="loopback"`, no-op (aucun pair).
- `ClusterBackplane` `rt/.../backplane/ClusterBackplane.ts:89` — `driver="cluster"`, IPC worker→master-gateway (`processIpcTransport` `:45`). `crossPod:false` (workers d'un même pod). Anti-echo `:134`.
- `RedisBackplane` `rt/.../backplane/RedisBackplane.ts:161` — `driver="redis"`, pub/sub cross-pod. `crossPod:true`. Helpers : `createRedisServiceTransport(publisher, subscriber)` (`:100`, **seul** point couplé à `redis`, couplage **structurel** sans import) · `resolveRedisChannel(ns)` → `nodefony:realtime:<ns>` (`:31`) · `REDIS_RT_CHANNEL` (`:20`). Seams : `IRedisBackplaneTransport` (`:42`), `IRedisPublisher`/`IRedisSubscriber` (typage structurel).

Registre `rt/nodefony/src/backplane/backplaneRegistry.ts` (sélection ouverte, **0 `if` sur noms en dur**) : `registerBackplaneDriver(name, factory: BackplaneFactory)` `:55` · `getBackplaneDriver(name)` `:63` · `listBackplaneDrivers()` `:68`. `BackplaneFactory = (ctx: IBackplaneFactoryContext) => IBackplane | null | Promise<...>` (`:44`) ; `null` = driver inactif dans ce contexte → hub local. Userland : `registerBackplaneDriver("nats", …)` + `driver: "nats"`. `resolveBackplaneOriginId()` (`rt/.../backplane/originId.ts:24`) = `(POD_NAME ?? hostname()):pid` (fallback `randomUUID()`).

<a id="28-decorateurs"></a>

### 2.8 Décorateurs realtime

`rt/nodefony/decorators/realtimeDecorators.ts` (style NestJS, posent des métadonnées `reflect-metadata` sur le constructeur, lues 1× au handshake). Coexistent avec les overrides (override gagne en conflit).

- `@RealtimeAction(method: string)` `:101` — méthode = action RPC (retour → `result`).
- `@RealtimeChannel(channel: string, policy?: IChannelPolicy)` `:142` — méthode = provider de canal pub/sub (**match EXACT**, doit renvoyer `dispose`). `policy` (opt-in) lue par security au `subscribe`.
- `@RealtimeInbound(method: string, policy?: IChannelPolicy)` `:182` — méthode = handler full-duplex entrant (`(params, reply) => void`).

Lecteurs internes : `getRealtimeActions`/`getRealtimeChannels`/`getRealtimeInbound`/`getRealtimeChannelPolicies` (`:201/:219/:237/:261`, `null` si aucun décorateur → 0 alloc, `.bind(instance)`).

<a id="29-sondes"></a>

### 2.9 Sondes + admin API

`rt/nodefony/src/server/RealtimeAdminApi.ts` : `createRealtimeAdminApi(): IAdminApi` `:91` (namespace `realtime`, endpoint `GET /nodefony/realtime/api/health` `:93`) · `buildOwnHealth(): IRealtimeHealth` `:52` (probe hub + identité process + ORM/erreurs additifs) · `buildRealtimeHealth(): Promise<IRealtimeHealth | IRealtimeClusterHealth>` `:74` (vue pod agrégée si sonde cluster, sinon per-instance).

Contrats `rt/nodefony/interfaces/IRealtimeProbe.ts` : `IRealtimeProbe` (`:61` — `channels`, `publishTotal`, `fanoutTotal=publish×abonnés`, `inboundTotal`, `connectionCount`, `bytesSentTotal`, `messagesSentTotal`, **`backpressure {maxBufferedAmount, totalBufferedAmount, slowConsumers, drops}`**, `backplane?`) · `IRealtimeConnProbe` (`:25` — `readyState`, `bufferedAmount`, `bytesSent`, `messagesSent`, `dropped`) · `IRealtimeChannelStat` (`:47`) · `IRealtimeHealth` (`:106`) · `IRealtimeClusterHealth` (`:155`). **Cumuls monotones** → débit/s dérivé côté lecteur (delta `total`/`ts`).

<a id="210-config"></a>

### 2.10 Config — `defineRealtimeConfig`

`defineRealtimeConfig(config?, { backplane? })` (builder Zod gelé) + `realtimeConfigJsonSchema()` (introspection Studio, exclut `backplane.instance`). Schéma source `rt/nodefony/config/schema.ts:132`. Défauts :

```ts
{ enabled: true,
  backplane: { driver: "loopback" /* | "cluster" | "redis" | <custom> */, namespace?: string },
  cluster:   { probe: { enabled: true } },
  slowConsumer:  { bytes: 1<<20 },           // 1 MiB — seuil de COMPTAGE de la sonde (observe)
  backpressure:  { dropBytes: 1<<20,         // 1 MiB — au-delà, la frame est JETÉE (latest-wins)
                   closeBytes: 8<<20 },      // 8 MiB — au-delà, close 1013. DOIT être > dropBytes (refine)
  limits:    { maxChannelsPerConnection: 256 },
  csrf: { checkOrigin: { enabled: false, allowList: [], allowMissingOrigin: false } } }
```

⚠️ **`slowConsumer` OBSERVE, `backpressure` AGIT** — deux clés, deux rôles. Les seuils d'action sont
appliqués au transport de CHAQUE connexion au handshake (`RealtimeController` lit `hub.backpressureBytes`,
posé par `RealtimeService.init()`). Avant ce câblage ils n'étaient atteignables que par le 2ᵉ arg du
constructeur du transport, qu'aucun appelant de prod ne passe : une app subissait les constantes.
**Rien n'est annoncé au client** — il a le close `1013` (classé transitoire → reconnexion) et son AIMD,
qui suit le comportement observé plutôt qu'une valeur déclarée (juste même si les seuils changent à chaud,
et même si la reconnexion tombe sur un pod réglé autrement).

Backplane custom userland (NATS…) hors schéma sérialisable : `defineRealtimeConfig({ backplane: { driver: "loopback" } }, { backplane: new MyBackplane() })` OU service DI `realtimeBackplane`. Env layering : `NODEFONY_REALTIME_DRIVER` surcharge le driver. ⚠️ **Zod 4** : `.default({})` plat n'applique PAS les sous-défauts → pattern `.default(() => sub.parse({}))` partout (`schema.ts:67/:128/:141`).

---

<a id="3-internals"></a>

## 3. Internals (mécanique)

**Pub/sub par canal (canaux PARTAGÉS, ref-compté)** — `RealtimeHub` tient `Map<channel, ChannelState>` (lazy `null`, `RealtimeHub.ts:119`). `ChannelState = { dispose, sinks: Set<ChannelSink>, messages, forward }` (`:76`). Au **1ᵉʳ** abonné : sink ajouté → `factory(channel, publishFn)` crée **UN** provider (ticker/listener) → son `dispose` mémorisé. Abonnés suivants = juste un sink de plus (`subscribe:199`). Au **dernier** `unsubscribe` : `dispose()` + suppression du canal (`:244-251`). **Dédup par nom de canal** : 1 provider par nom par pod — `subscribe` sur un canal existant n'appelle JAMAIS `factory` (il ajoute un sink). Conséquence : 1 effet de bord (enrich/ticker/drill) par canal, pas par abonné. `#fanout` (`:293`) incrémente la sonde puis appelle chaque sink dans un `try/catch` isolé (une conn fautive ne casse pas la diffusion).

**Anti-boucle backplane = 2 barrières + `originId`** (`IBackplane.ts:17`, `RealtimeHub.ts:266`) :

1. **Barrière hub** — `publish` propage au backplane ; l'ingress backplane (`setBackplane` câble `onMessage → publishLocal`, `:350`) réinjecte en **fan-out local SEUL** (`publishLocal` `:287`), jamais re-`publish` → pas de re-forward.
2. **Barrière driver** — chaque message porte l'`originId` de l'émetteur ; le driver **filtre son propre `originId`** à la réception (Redis renvoie au pod émetteur ; cluster master peut renvoyer à la source). Cf `RedisBackplane.#ingress:220`, `ClusterBackplane.#ingress:134`.

`originId` doit être **unique cross-pod** : `String(process.pid)` seul confond 2 pods k8s (tous PID 1) → fan-out légitime avalé. D'où `resolveBackplaneOriginId()` = `host:pid`.

**`#backplane = null` lazy** (`RealtimeHub.ts:137`) — mono-process : `publish` ne paie qu'un test `=== null` (`:273`), la politique de forward n'est JAMAIS évaluée. `LoopbackBackplane` n'est pas branché par défaut (le hub reste `null`) — il sert de cible de test / câblage explicite. Le wiring réel (`rt/index.ts:237 #wireBackplane`, phase `onKernelBoot`) résout `config.backplane.driver` via le registre, `await start()` AVANT `setBackplane` (un driver async perdrait sinon les 1ᵉʳˢ messages), borné par `withTimeout` (`#startWithTimeout:311`, 5 s) → fail-soft hub local si le transport pend.

**Forward opt-in par canal** — `forward` mis en cache dans `ChannelState` au 1ᵉʳ abonné (`#isBroadcast` `:330`) → hot path lit un booléen. Défaut : tout **instance-local** (observabilité/état pod ne fuit pas cross-pod sans `markBroadcastChannel`). Un `publish` serveur sans abonné local évalue la politique à la volée (`:276`).

**JSON-RPC 2.0 — discrimination par `method`, PAS par `id`** (`JsonRpcPeer.receive:315`) : `method`+`id` → **requête** (`handleRequest` → `result`/`error`) · `method` seul → **notification** (`onNotification`) · `id` sans `method` → **réponse** (résout un pending sortant). `id` string|number. Méthode inconnue → `-32601` ; handler qui throw → `-32603` générique (détail via `onError` = Zero Trust) ; `RpcError` lancée → renvoyée fidèlement (code/data préservés). `pending` et `actions` du peer sont **lazy** (`null` jusqu'au 1ᵉʳ `request`/`register`).

**Gating inbound** (`RealtimeController.onRealtimeNotification:466`) — une notification entrante est routée : `subscribe`/`unsubscribe` (pub/sub), `ping` (heartbeat no-op), sinon `state.inbound[method]` → handler full-duplex **uniquement si déclaré** (`realtimeInbound`/`@RealtimeInbound`). Non déclaré = **droppé en silence** (défaut sûr : un client ne pousse rien tant que le serveur ne l'a pas ouvert). `state.inbound = null` si aucun déclaré → 0 lookup. Seam #1 (P6) : `beforeDispatch` branché sur le peer SEULEMENT si `hub.hasFrameAuthorizer()` (`onHandshake:308`) → hot-path 0-coût quand security absent.

**Handshake** (`onHandshake:247`, async fire-and-forget) : Origin check (`hub.checkOrigin`, refus → close `4003`) → authenticator (`hub.resolveAuthenticator`, throw → close `4001`, sinon `ANONYMOUS_REALTIME_TOKEN`) → `setTokenForPeer` AVANT le `realtime:welcome` (lookup voters garanti dès la 1ʳᵉ frame) → welcome annonce `channels` + `methods` + `identity`. Pont `api.request` (`invokeApiRequest:539`) : re-valide `token.isValid()` (Zero Trust — la WS survit à sa session) → `RequestContext.run` (ALS) → `executeAction` ; erreurs HTTP-like mappées en `RpcError(data.status)`.

---

<a id="4-gotchas"></a>

## 4. Gotchas spécifiques realtime

- **Push hors action = conn brute, pas `ctx.send()`.** Après le handshake, `ctx.send()` (réponse HTTP) **rejette** (`requestEnded`). Tout push (fan-out, `notify`, `notifyClient`) passe par le peer → `WsConnectionTransport.send` (`rt/.../transport/WsConnectionTransport.ts:76`) qui écrit sur `ctx.connection` brute avec garde `readyState === OPEN` (`:77`). Ne JAMAIS écrire `ctx.connection.send(...)` à la main sans cette garde : le transport gère aussi la **back-pressure 2 seuils** (DROP latest-wins / CLOSE 1013, réglables par `config.backpressure`) et les compteurs sonde — bypasser = file `ws` non bornée → OOM.

- **Cleanup symétrique connect/close.** Chaque ressource posée au handshake DOIT être retirée sur `ctx.once("onFinish")` (`onHandshake:422`) : désabonner CHAQUE canal (`hub.unsubscribe` par sink → le hub dispose le provider au dernier), `hub.unregisterConnection(transport)` (sonde), `transport.fireClose()`, `peer.dispose()`. Règle générale : `registerConnection`↔`unregisterConnection`, `subscribe`↔`unsubscribe`. Un sink oublié = provider/timer orphelin + fuite mémoire (gate `memory.test`).

- **Per-instance vs cluster.** Un canal est **instance-local par défaut** : un `realtime:health`, un état de pod, un compteur ne traversent PAS le backplane. Il faut `markBroadcastChannel(prefix)` (ou `realtimeBroadcastChannels()`) pour qu'un canal (chat/présence/notif) soit cross-pod. Inverse : ne PAS broadcaster un canal per-instance (snapshot du pod) sinon les pods se mélangent. `RealtimeHub` = **1 par pod** → `probe()` est per-instance ; l'agrégat multi-pod vient de la sonde cluster / Prometheus, pas du hub.

- **Canal combiné = 1 provider = 1 effet de bord.** Le provider étant **partagé** (ref-compté), un canal coûteux (drill `orm:rich@<pid>`, enrich, ticker) s'exécute **une seule fois** par pod quel que soit le nombre d'abonnés (N onglets Studio sur le même canal = 1 enrich, pas N). Corollaire : le provider **survit** à la connexion qui l'a créé → la factory doit capturer des deps **long-lived** (broker/syslog/kernel), JAMAIS `this.context` (lié à la connexion créatrice qui peut fermer alors que d'autres abonnés restent).

- **Singleton client par URL.** Côté navigateur, NE créez pas 2 `RealtimeClient` sur la même URL → `RealtimeClient.shared({ url })`. Normaliser `http(s)→ws(s)` (clé + `WebSocket`) sinon une URL relative hérite de `https` → 2 instances + `new WebSocket("https://…")` throw. Tous les consommateurs **ref-comptent** (`subscribe`/`unsubscribe`) ; jamais d'`emit("subscribe")` brut (un unsub à ref→0 couperait le canal pour tous).

- **`getTokenForPeer` ne renvoie jamais `null`** → `ANONYMOUS_REALTIME_TOKEN` (Zero Trust). Les voters P6 n'ont pas à garder le null. Matcher `string` d'authenticator = RegExp **préfixe ancré** (`^<escaped>`), pas EXACT — pour EXACT passer une RegExp avec `$`.

- **Driver redis inactif si `@nodefony/redis` absent.** La factory du driver `redis` (`rt/index.ts:108`) lit `container.get("redis")` ; module non listé → `WARNING` + hub local (fail-soft). De même `start()` qui pend → fallback local, boot poursuivi. Sur Redis mutualisé, poser `backplane.namespace` EXPLICITE (le `database` Redis ne cloisonne PAS le pub/sub).
