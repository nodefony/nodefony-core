---
name: http-module-memory
description: "@nodefony/http — serveurs, contextes, WS, pipeline, requestId, bugs corrigés — notes IA"
metadata:
  type: project
---

# @nodefony/http MEMORY

## Docs liées

- [`CLAUDE.md`](./CLAUDE.md) — instructions module (rôle, décisions figées, interdits)
- [`../framework/MEMORY.md`](../framework/MEMORY.md) — Router/Controller/Resolver (consommateur)
- [`../../../modules/test/MEMORY.md`](../../../modules/test/MEMORY.md) — routes d'intégration HTTP/WS
- Core : [`../../../nodefony/MEMORY.md`](../../../nodefony/MEMORY.md) (Service/Container) | [`../../../nodefony/src/kernel/MEMORY.md`](../../../nodefony/src/kernel/MEMORY.md) (Kernel/Module) | [`../../../nodefony/src/kernel/injector/MEMORY.md`](../../../nodefony/src/kernel/injector/MEMORY.md) (DI)

## Purpose

Module Nodefony : tous les serveurs (HTTP/HTTPS/HTTP2/WS/WSS) + contextes. Différenciateur : HTTP et WS dans le même pipeline Controller.

## Core Components

| Classe              | Fichier                                     | Rôle                                                                                                                                                                    |
| ------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Http`              | `index.ts`                                  | Module racine. `@services([HttpKernel, Certificate, SessionsService, StaticServer, HttpServer, HttpsServer, WebsocketServer, WebsocketSecureServer, UploadService])`    |
| `HttpKernel`        | `service/http-kernel.ts`                    | Orchestrateur. `handle()` → pipeline HTTP. `handleWebsocket()` → pipeline WS. `handleFrontController()` → router+firewall+controller. `onError()` → 1002/1011 WS        |
| `Context`           | `src/context/Context.ts`                    | Base extends `Service`. Props: `type`, `scheme`, `request`, `response`, `method`, `webSocketState`, `metaData`, `session`, `cookies`, `resolver`, **`requestId`**       |
| `HttpContext`       | `src/context/http/HttpContext.ts`           | Extends Context. Honor `X-Request-Id` header entrant. Pipeline HTTP/HTTPS/HTTP2.                                                                                        |
| `WebsocketContext`  | `src/context/websocket/WebsocketContext.ts` | Extends Context. Honor `X-Request-Id` header entrant. Props extra: `acceptedProtocol`, `connection` (Ws), `wsUrl`, `rejected`. Override `request` → `WsIncomingMessage` |
| `HttpResponse`      | `src/context/http/Response.ts`              | `writeHead()` : sanitize statusMessage ASCII + injecte `X-Request-Id`. `setBody()`, `setLength()`, `redirect()`.                                                        |
| `WebsocketResponse` | `src/context/websocket/Response.ts`         | `connection` assigné dans constructeur. API: `send()`, `broadcast()` (wss.clients forEach), `close(code, msg)`                                                          |
| `HttpError`         | `src/errors/httpError.ts`                   | Extends `nodefonyError`. Props: `controller`, `action`, `jsonResponse` — extraits de `(context as any)?.resolver` (évite import circulaire avec `@nodefony/framework`)  |

## Servers

| Service                 | Port | Type                        |
| ----------------------- | ---- | --------------------------- |
| server-http             | 5151 | http                        |
| server-https            | 5152 | https + HTTP/2 (allowHTTP1) |
| server-websocket        | 5151 | ws sur http                 |
| server-websocket-secure | 5152 | wss sur https               |
| server-static           | —    | serve-static                |

## Multi-process / scaling (post-PM2)

- Serveurs bind via `server.listen(this.port, this.domain, cb)` **positionnel** (`server-http.ts:97`, `server-https.ts:120/237`).
- **Scaling horizontal** (PM2 déprécié, [[project_pm2_deprecation]]) :
  - **Prod** : N pods + LB orchestrateur (k8s/Swarm/Cloud Run). 1 process = 1 pod.
  - **Single host** : **`SO_REUSEPORT`** (Node 23.1+, repo Node 26) → passer `listen({ port, host, reusePort: true })` → N process Node sur le MÊME port, kernel OS répartit. Remplace PM2-cluster. Feature cible Phase 16 : `nodefony <env> --workers N` (fork Kernel + reusePort). Alt : `node:cluster`.
  - **Test local** : N instances/N ports + round-robin client (zéro code).
- **Viable** car HTTP full stateless JWT ([[project_security_stateless_http_decision]]) → pas de session RAM à partager, pas de sticky.
- ⚠️ **Cross-process** : `broadcast()` (`wss.clients.forEach`) et le pub/sub realtime ne touchent que les clients du MÊME worker → fan-out cross-process = **Redis pub/sub (Phase 13** [[project_phase13_realtime_redis_client]]). Idem stats Studio (per-instance). Détails : [[project_multiprocess_scaling]].
- Mesure stress 2026-05-20 : Node mono-thread sature ~1 cœur ≈ 400 req/s sur loopback, dégradation gracieuse (1600 conns concurrentes, 0,04 % err, 0 crash).

## Request Tracing — requestId

- `Context.requestId = randomUUID()` — UUID v4 généré à construction (base class)
- `HttpContext` constructor : if `request.headers["x-request-id"]` → override requestId
- `WebsocketContext` constructor : if `req.headers["x-request-id"]` → override requestId
- `Response.writeHead()` : `response.setHeader("x-request-id", context.requestId)` avant write
- `Context.logRequest()` : affiche `ID : <uuid>` dans chaque log de fin de requête
- `Context.setMetaData()` : inclut `requestId` dans `metaData.nodefony`
- `IContext.requestId: string` — exporté dans `nodefony/interfaces/IContext.ts`
- **wsId = `requestId` du `WebsocketContext`** (P3.9, 2026-05-29) : pas de champ distinct (alloc 0). Stable sur toute la socket (ctor → ALS → handshake/messages/close) → corrèle les events d'une même connexion WS. Présent dans les **3 logs de cycle de vie WS** : handshake (`renderWebsocket` → `ID : <uuid>`), `onClose`, `onConnectionError`. **Per-message NON loggé** (bruit + hot path 33-38k msg/s) — extensible via logger custom opt-in si besoin debug.
- ⚠️ **HTTP/2 GOTCHA (fix 2026-05-21)** : `http2/Response.writeHead` chemin `stream.respond()` **bypasse** `super.writeHead` → pose `x-request-id` + `traceparent` ICI aussi. Sinon réponses HTTP/2 (port 5152, dont Studio) **sans header** → corrélation profiler/debug bar impossible (symptôme : clic requête = « no requestId »).

## Profiler — dev-only (2026-05-21)

- `src/profiler/Profiler.ts` : ring buffer `Map<requestId, ProfileEntry>` (cap 500, éviction insertion-order), `collect(ctx)` = snapshot fin de requête (phases/route/controller/user/traceparent/status + **queries ORM**), `get`/`recent`/`clear`. **Borné** (pas de fuite, validé).
- **Seam ORM `queries` BRANCHÉ (2026-05-21)** : `handleHttp` alloue `context.profilerQueries = this.profiler ? [] : null` (**dev-only, 0 alloc prod**) et passe la **même réf** dans la payload ALS (clé `queries`). Les adapters ORM y poussent via `RequestContext.pushQuery()` ; `collect` lit `ctx.profilerQueries` au teardown (teardown est **hors bulle ALS** → on lit la réf sur le context, jamais `RequestContext.get()`). `queries` reste `undefined` si vide (contrat preserved). WS : pas encore collecté (teardown HTTP only). Tests Profiler +2.
- Hook : `http-kernel` teardown (`this.profiler?.collect(ctx)` avant `clean()`), résolu container `"profiler"` à onReady, **null en prod** (module l'instancie dev-only dans `index.ts` onKernelBoot → `this.kernel?.environment !== "prod"`).
- Data-plane : `createProfilerAdminApi(profiler)` → namespace `profiler` → `GET /nodefony/profiler/api/recent` (+`?limit`) / `GET /{id}` (404 si absent) / `DELETE recent`. Tests `tests/unit/Profiler.test.ts` (11).

## PrettyRequestLogger — P3.2 (2026-05-16)

- `PrettyRequestLogger implements IRequestLogger` (`service/pretty-request-logger.ts`)
- Format 1 ligne human-friendly (dev) : `GET 200 /api/test 12.3ms 127.0.0.1 [a1b2c3d4]` (ANSI couleurs)
- Status colorisé : 2xx vert, 3xx jaune, 4xx jaune-bold, 5xx rouge
- requestId tronqué à 8 chars (premier bloc UUID, suffisant visuellement)
- Duration formatée : `12.5ms` < 1s, `1.23s` >= 1s, `0.42ms` < 1ms
- Activation : `httpKernel.setRequestLogger(new PrettyRequestLogger())`
- WS : prefix `WS  ` + `[protocol]` si présent
- Severity status-based (consomme `severityFromStatus` de P3.3)
- Tests unit : `PrettyRequestLogger.test.ts` (11 tests)

## JsonAuditLogger error enrichi — P3.5 (2026-05-16)

Extension de l'`AuditErrorEntry` :

- `{ name, message, code?, errorType?, stack?, cause? }` — récursif
- **stack** conditionnel : par défaut activé si `NODE_ENV !== "production"`, override via `new JsonAuditLogger({ includeStack: true|false })`
- **cause chain** : sérialise `error.cause` récursivement (Error{cause:Error{cause:...}}})
- **`maxCauseDepth`** : default 5 — protège contre cycles + log oversize
- **`errorType`** : pull depuis `nodefonyError.errorType` (Phase 1 domain classifier)
- Cycles safe : `cause` cyclique = stop net à depth max, pas de crash
- Tests : 6 nouveaux dans `AuditLogger.test.ts` (stack/no-stack, cause chain, depth cap, errorType, circular safe)

## JsonAuditLogger — P3.1 + P3.3 + P3.4 (2026-05-16)

- `JsonAuditLogger implements IRequestLogger` (`service/audit-logger.ts`)
- Activation : `httpKernel.setRequestLogger(new JsonAuditLogger())` (singleton stateless)
- 1 PDU JSON canonique/req — msgid = `"audit"`
- Format `AuditLogEntry` : `{ts, requestId, userId, type:"http"|"ws", scheme, method, url, status, durationMs, remoteAddress, host, userAgent, hasAuthorization, hasCookie, phases?[], error?{name,message,code}, protocol?}`
- **P3.3** : `severityFromStatus(s)` exporté — 200/301→INFO, 404/405→WARNING, 500/502→ERROR
- **P3.4** : flags `hasAuthorization`/`hasCookie` (boolean) — **valeurs JAMAIS loggées**
- `userId` pull depuis `RequestContext.getUserId()` (P1.4 ALS) — sera rempli par security après login (P6)
- `durationMs` = `performance.now() - phases[0].startMs` (utilise P1.1)
- WS : ajoute `protocol`
- Tests unit : `nodefony/tests/unit/AuditLogger.test.ts` (18 tests : shape JSON, redaction, severity, phases, error)
- **Débloque** : P3.2 pretty formatter, P3.5 erreur enrichie, P10.9 Studio logs streaming SSE/WS

## RequestContext (ALS) — P1.4 (2026-05-16)

- `RequestContext` exporté depuis `nodefony` core (`src/runtime/RequestContext.ts`)
- API : `RequestContext.run(payload, fn)`, `.get()`, `.getRequestId()`, `.getUser()`, `.getUserId()`, `.set(key, value)`
- AsyncLocalStorage lazy : 1 instance partagée, créée au premier `.run()`. Aucun coût si jamais utilisé.
- Payload type : `RequestContextPayload { requestId, scheme?, userId?, user?, traceparent?, [key]: unknown }` (open shape)
- Wrap dans `HttpKernel.handleHttp` (après `createHttpContext`+`onCreateContext`, AVANT `parse` phase) avec `{requestId, scheme}`
- Wrap dans `HttpKernel.handleWebsocket` (avant `onConnect`) idem
- Perf : Node 22+ ALS = ~50-100 ns/request, 0 régression mesurable
- Routes test : `/nodefony/test/als/{now,async}`
- Tests intégration : `nodefony/tests/integration/request-context.test.ts` (6 tests : match contextId, X-Request-Id override, scheme, propagation cross-await, isolation 10 concurrent)
- **Débloque** : P3.1 audit log (requestId dans chaque log même hors context), P6.8b décorateurs `@IsGranted` (récup `user` global type-safe), P13.4 RealtimeService (RequestContext pour TCP/UDP/Unix sockets)

## RequestLogger pluggable (P1.6, 2026-05-16)

- `IRequestLogger` interface : `renderHttp(ctx, error?)` + `renderWebsocket(ctx, error?, protocol?)` → `{text, severity, msgid}`
- `DefaultRequestLogger` (`service/request-logger.ts`) — singleton, stateless, **zéro alloc per-request**
- Format inchangé : `URL : ... FROM : ... ORIGIN : ... ID : <uuid>` + `Accept-Protocol` WS + couleurs cli-color
- Prod env : erreur single-line. Dev env : multi-line avec stack
- `HttpKernel.requestLogger: IRequestLogger = new DefaultRequestLogger()` (instance unique)
- `HttpKernel.setRequestLogger(custom)` / `.getRequestLogger()`
- `Context.logRequest` et `WebsocketContext.logRequest` délèguent : `this.httpKernel?.getRequestLogger().renderHttp(...)`
- Exporté dans `index.ts` : `DefaultRequestLogger`, `IRequestLogger`, `IRequestLogEntry`
- Préalable : P3.1 audit log canonique JSON, P3.2 pretty formatter, P3.10 NCSA/Combined transport

## Security hooks (P1.7, 2026-05-16) — préalable Phase 6

3 hooks `fireAsync` au niveau `HttpKernel` (cohérent avec `onServerRequest`/`onCreateContext`) :

| Hook            | Quand fire                                                                                                | Payload                |
| --------------- | --------------------------------------------------------------------------------------------------------- | ---------------------- |
| `beforeResolve` | AVANT `handleFrontController` (HTTP + WS)                                                                 | `(context)`            |
| `afterAuth`     | APRÈS `firewall.handleSecurity()` SUCCESS (HTTP + WS)                                                     | `(context)`            |
| `onAuthFailure` | APRÈS `firewall.handleSecurity()` THROW (HTTP + WS) — log-only erreurs, n'arrête pas le throw du firewall | `(context, authError)` |

- Listeners s'enregistrent via `httpKernel.on("beforeResolve", fn)` au `onKernelReady` du module security
- `onAuthFailure` est `.catch()` log-only — si un listener throw, l'erreur du firewall est tjs propagée (priorité)
- Invariant testé : `afterAuthCount <= beforeResolveCount` (auth est subset de toutes les requests)
- Pas de listener au niveau Context (fire-and-forget par request mal adapté pour services security globaux)
- Routes test : `/nodefony/test/hooks/{state,reset}` — counters singleton, listeners enregistrés dans `Test.onKernelReady()`
- Tests : `nodefony/tests/integration/security-hooks.test.ts` (6 tests)
- **Débloque Phase 6 Security** — firewall.ts peut se brancher proprement sans coupler `@nodefony/http`

## ErrorRenderer unifié HTTP+WS (P1.5, 2026-05-16)

- `IErrorRenderer` interface : `renderHttp(err, ctx) → {status, message, body, headers?}` + `renderWebsocket(err, ctx) → {code, reason}`
- `DefaultErrorRenderer` (`service/error-renderer.ts`) — singleton, stateless, **zéro alloc per-request**
- Préserve la shape JSON erreur legacy : `{code, message, error: HttpError.toJSON(), nodefony: {requestId, scheme, ...}, result: null}` — aucune régression
- WS : code clamp 1000-4999 (1011 si HTTP-style code en phase connected), reason = `error.message`
- `HttpKernel.errorRenderer: IErrorRenderer = new DefaultErrorRenderer()` (instance unique)
- `HttpKernel.setErrorRenderer(custom)` pour override (hide stack en prod, RFC 7807, auth challenge headers...)
- `HttpKernel.getErrorRenderer()` pour lecture
- Exporté dans `index.ts` : `DefaultErrorRenderer`, types `IErrorRenderer`, `IErrorHttpResult`, `IErrorWebsocketResult`
- Préalable : P1.7 hooks security (AuthFailureHandler), P3.5 erreur enrichie audit

## Abort signal — Context.signal (P1.3, 2026-05-16)

- `Context.signal: AbortSignal` (getter lazy) — alloue `AbortController` + branche listener AU PREMIER ACCÈS
- **Zéro overhead par défaut** : si jamais lu, aucune allocation
- HTTP : `request.once("close")` → si `request.complete === false` → `abort()` (client a fermé avant fin)
- HTTP : si déjà aborted quand `signal` accédé (post-mortem) → signal directement aborted (sécurité late-subscribe)
- WS : `WebsocketContext.onClose()` → fire `onFinish` → handler kernel appelle `context._abortIfPending("WebSocket closed")`
- `_abortIfPending(reason?)` méthode interne idempotente — used by HttpKernel pour aborter sans lire signal
- Distinction `finish` vs `close` côté HttpKernel : seul `close` sans finish prior abort le signal
- Reason propagée via `signal.reason` (Error message lisible)
- Routes test : `/nodefony/test/abort/{wait,state,reset}` — counters singleton
- Tests : `nodefony/tests/integration/abort-signal.test.ts` (5 tests)

## Aborted requests + 499 interne — P2.3 (2026-05-29)

- Client part avant TOUT envoi → `http-kernel.onClose` (`!didFinish`) : `_abortIfPending` + si `!sended` → `response.statusCode = 499` (nginx-style "client closed request").
- **499 = observabilité PURE** : reflété dans request-log + profiler, **JAMAIS écrit sur le socket** (déjà mort). Le logger préfère `error.code` → 499 ne surface que sur un abort sans erreur ni envoi.
- Test : `nodefony/tests/http/client-abort-499.test.ts` (assert via log `GET  499 …/abort/wait`).

## Request timeout — 2 couches distinctes — P2.5 (2026-05-29)

- **Couche réseau** : `requestTimeout` natif Node (config `http/https`, défaut 30s) = délai de réception headers+body → anti-slowloris. Node renvoie un 408 brut + ferme. **Hors pipeline volontairement** (aucun Context/controller à ce stade).
- **Couche pipeline** : `responseTimeout` (Nodefony) armé via `HttpContext.setTimeout()` → socket idle → `onTimeout` event → **`_abortIfPending("Request timeout")` (annule `ctx.signal`)** PUIS `httpKernel.onError(408 | 504 si HTTP/2 stream)` → errorRenderer.
- Sondes test : `/nodefony/test/timeout/{probe,state,reset}` (la sonde re-arme un socket timeout court via `ctx.response.response.setTimeout(ms, cb)` + `fire("onTimeout")`). Test : `nodefony/tests/http/timeout-abort.test.ts`.

## Controller initialize() error boundary — P2.4 (2026-05-29)

- `Resolver.newController` → `await controller.initialize()` ; un throw remonte `HttpContext.handle()` reject → `handleHttp` catch → `onError` → 500 JSON cohérent, serveur sain (pas de hang).
- Verrou : `LifecycleController` (module test) dont `initialize()` throw toujours, route `/nodefony/test/lifecycle/init-crash`. Test : `nodefony/tests/http/lifecycle-init-crash.test.ts`.

## Post-response hook — Context.onAfterResponse (P1.2, 2026-05-16)

- `Context.onAfterResponse(fn: (ctx) => void | Promise<void>): void`
- Fire-once per context, dédup HTTP `response.on("finish")` vs `response.on("close")` via `_afterResponseFired` flag
- Handlers await en série dans `_runAfterResponse()` — exceptions swallow + log (un handler qui throw ne bloque pas les autres)
- Late subscribe (après fire) → fn exécutée sur microtask
- WS : trigger via event `onFinish` déjà fire dans `WebsocketContext.onClose()`
- Insertion : entre `logRequest()` et `fireAsync("onFinish")` (avant `clean()` / `leaveScope()`)
- Routes test : `/nodefony/test/after/{incr,multi,throw,state,reset}` — counters singleton
- Tests : `nodefony/tests/integration/after-response.test.ts` (6 tests)
- Préalable : P3.1 audit log canonique, P2.2 tear-down déterministe, P2.3 aborted requests (signal)

## Lifecycle Timing — Context.phases (P1.1, 2026-05-16)

- `Context.phases: PhaseTiming[]` — instrumentation pipeline, rempli par HttpKernel
- API : `context.phaseStart(name)` / `context.phaseEnd(name)` — `performance.now()` (perf_hooks)
- **Désactivé par défaut en `environment === "prod"`** — opt-in via `kernel.options.timing.enabled: true`
- Quand désactivé : `phases` = shared `EMPTY_PHASES` frozen singleton, `phaseStart/End` noop, aucune `Map` allouée
- `_phaseIndex: Map<string,number>` lazy alloc au premier `phaseStart` (pas dans le constructor)
- `phaseEnd` idempotent (re-call = noop)
- Phases canoniques instrumentées dans `http-kernel.ts` :
  - `parse` : `context.request.initialize()` (handleHttp)
  - `resolve` : `router.resolve(context)` (handleFrontController)
  - `firewall` : `firewall.handleSecurity(context)` (onRequestEnd + handleWebsocket)
  - `action` : `context.handle()` (handleHttp + handleWebsocket) — **reste ouverte pendant le controller** (endMs/durationMs null si lecture depuis l'action)
- `PhaseTiming { name; startMs; endMs?; durationMs? }` — type dans `interfaces/IContext.ts`
- Route exemple : `/nodefony/test/timing` (DefaultController) — retourne phases JSON
- Tests : `nodefony/tests/integration/timing.test.ts` (7 tests)
- Préalable : P2.1 (audit log timing), P3.7 (mode trace verbose)
- WS hérite via classe de base — phases dispos sur `WebsocketContext`

## Body parsing — drain OBLIGATOIRE avant lecture (fix 2026-05-29)

- `@Body`/`@Query`(POST) lisent `request.queryPost`, rempli par les parsers (`ParserJson`/`ParserQs`/`ParserXml`).
- **Le corps DOIT être entièrement reçu avant de parser** : `Parser.parse()` (base) fait `await this.ended()` (attend `end`) PUIS `Buffer.concat(chunks)`. `initialize()` fait `await parser.parse()` AVANT de fire `onRequestEnd` → le controller lit un `queryPost` complet.
- 🐛 **2 bugs corrigés** (révélés par `decorators-response.test.ts`/`body-content-types.test.ts`) :
  1. **`Request` ctor attachait `on("data")` (compteur `dataSize` MORT, jamais lu)** → flux en flowing mode dès la construction → les chunks s'écoulaient AVANT que le parser (attaché tard dans `parseRequest`) ne les voie → `queryPost` vide. **Listener + champ supprimés.**
  2. **base `Parser.parse()` ne drainait pas + `initialize` n'`await`ait pas `parser.parse()`** → Qs/Xml lisaient des chunks partiels/vides (JSON marchait déjà : drain+await présents). Drain mutualisé dans la base + `await` ajouté.
- ⚠️ **Couvert par les UNIT tests** (`unit/parser.test.ts`) ET intégration — l'intégration seule ne voyait pas le bug Qs/Xml (aucun test n'envoyait d'urlencoded). Le mock unit marque `stream.readableEnded=true` (corps livré en synchrone).

## WS Flow (critique)

1. `server-websocket` reçoit `connection` event (ws@8)
2. `http-kernel.handleWebsocket(req, ws, type)`
3. `createWebsocketContext()` → `WebsocketContext(scope, req, ws, type)`
4. `handleFrontController()` → route résolue AVANT accept
5. Protocol check → `HttpError(1002)` si mismatch → `context.close(1002)`
6. `context.connect()` → ws handshake accepted
7. `Controller.execute(null)` → handshake handler
8. `ws "message"` → `Controller.execute(message)`

## Gotchas critiques

**IWsRequestExtension** : `IncomingMessage.url` = string. `Route.match()` fait `.pathname`. Fix : `WsIncomingMessage = IncomingMessage & { url: URL; query; queryGet; path }` — assigné dans `WebsocketContext` constructor.

**ERR_INVALID_CHAR** : Node.js set `ServerResponse.statusMessage` natif AVANT validation → char invalide persiste même si `writeHead()` throw. Tous les writes suivants échouent en cascade (y compris timeout 30s). Fix : `safeMsg = statusMessage.replace(/[^\x20-\x7E]/g, "")` juste avant `ServerResponse.writeHead()` dans `Response.ts`.

**HttpError champs undefined** : `httpError.ts` est dans `@nodefony/http` qui est une dépendance de `@nodefony/framework` — import circulaire impossible. Accès au resolver via `(context as any)?.resolver`. Props : `this.controller = resolver?.controller?.name`, `this.action = resolver?.actionName`, `this.jsonResponse = \`${res.statusCode} ${res.statusMessage}\`.trim()`.

**Protocol WS** : `requirements.protocol: "echo-protocol"` → exact string match. Array `['a','b']` → header `"a, b"` → ne matche pas `"a"` → 1002. `requirements.protocol: ""` → accepte tout.

**Binary WS** : `context?.send(buf, "binary")` server-side ; `ws.send(Buffer)` client-side. Envois séquentiels : utiliser `wsCollectBinary(ws, n)` côté test (collect all then assert) — pattern `await` frame par frame timeout.

**Broadcast** : `context.broadcast(str)` → `wss.clients.forEach(send)` — inclut l'émetteur.

**url.parse interdit** : remplacé par `new URL(str, "http://localhost")` — `url.parse()` deprecated Node.js v22+.

**onConnection** dans http-kernel : `catch` silencieux — erreurs WS avalées, vérifier logs DEBUG.

**Sessions WS** : nécessitent `startSession()` dans `initialize()` du controller.

**Session storage = IoC** : `SessionsService` tient un **registre statique** (`registerStorage/getStorage/storageHandlers`) ; http n'importe AUCUN ORM. Chaque backend s'auto-enregistre au chargement (`files` par http ; `drizzle`/`sequelize`/`mongoose` par leur module). Sélection via config `session.handler` (casse-insensible). Events kernel `onRegisterSessionStorage` / `onSessionStorageReady`. Défaut reco = `drizzle`. Guide : [[guide session-storage]] (`docs/guides/session-storage.md`). ⚠️ appeler `registerStorage` rend l'import http VALEUR → externaliser `@nodefony/http` dans le rollup du module fournisseur.

**HTTP/2 write-after-end** : sur réponse lente, le client abandonne / le stream se ferme → `stream.respond()`/`write()` sur stream détruit = `ERR_HTTP2_INVALID_STREAM` + `ERR_STREAM_WRITE_AFTER_END` (CRITIC). Fix : gardes `stream.destroyed/closed/writable` dans `Http2Response.writeHead/send/end` → skip DEBUG. (Relève de P2.3 aborted-requests.)

**Fichiers test** : chaque `.ts` dans `nodefony/tests/` doit commencer par `/// <reference types="node" />`.

## Tests — 621 intégration (+1 pending) / 254 unit (2026-05-29)

2 runners (les `unit/` tournent sous les DEUX) :

- `npm test` = **vitest** → `tests/unit/**` = **254** (composants purs, pas de serveur).
- `npm run test:integration` = **mocha** + ts-node ESM → `tests/**` sauf load+memory = **621 +1 pending** (serveur `npx nodefony development` 5151/5152 requis). Inclut les 254 unit → NE PAS sommer. Suite non-régression = celle-ci.

```
unit/      : Cookie, Session, HttpError, Response, parser,
             trace, … (16 fichiers vitest)            — 254 tests
http/      : http(1/2), https, errors, decorators, fileStream,
             upload, httpKernel, static, session, security,
             traceparent, resilience
routing/   : Router
websockets/: websocket, limits, perf, binary-broadcast,
             protocol, session, w3c
                                                      mocha TOTAL : 621 (+1 pending)
```

`memory.test.ts` (suite load, `.mocharc.load.json`) — "1000 GET < 35 MB" flaky en full suite (GC pressure). Passe en isolation. Pas de fuite. "100 native crashes" idem (le test qui fail varie).

Config ts-node intég: `tsconfig.tests.json` + hook `fix-reflect.mjs` (corrige `_virtual/Reflect.js` CJS/ESM). Vitest: `vitest.config.ts` (setup `vitest.setup.ts`, shim mocha→`describe/it`).

## Admin data plane — `IAdminApi` (P10.3, 2026-05-20)

http = **2ᵉ producteur** du data plane admin Studio (1er = kernel). `createHttpAdminApi(module)` (`nodefony/service/HttpAdminApi.ts`) → enregistré dans `onKernelBoot` via `IAdminRegistry` du container (`this.kernel.container.get("adminBroker")`).

- **Import : SEULEMENT `IAdminApi`/`IAdminRegistry` depuis `"nodefony"`** — jamais `@nodefony/framework` (cycle). C'est tout l'intérêt du split `IAdminRegistry` (core) / `IAdminBroker` (framework).
- Endpoints (validés runtime) : `GET /nodefony/http/api/servers` (5 services serveur : type/scheme/protocol/address/port/family/ready) · `GET /nodefony/http/api/info` (serveurs prêts, ports, schemes, protocols) · `GET /nodefony/http/api/sessions` (état sous-système sessions + `active` = nb fichiers sous `save_path`, **flag `deprecated:true`** — HTTP stateless JWT [[project_security_stateless_http_decision]]).
- Lecture défensive des services `server-{http,https,websocket,websocket-secure,static}` via `module.get(name)`.
- **Per-instance** : answers du process qui reçoit (LB route vers 1 pod). Header `x-nodefony-instance` posé par `AdminApiController` (convention `NODEFONY_INSTANCE_ID ?? pid`). Vue cluster = Redis P13. Cf [[project_multiprocess_scaling]].
- Stateless : aucun `startSession()`, lit l'user via ALS (futur JWT). Cf [[project_security_stateless_http_decision]].
- Détails contrat + broker : framework MEMORY.md « Admin data plane ».

## Deps clés

- `ws@8` — ESM : `import { WebSocketServer } from 'ws'` (jamais `Ws` default, jamais `Ws.Server`)
- `formidable@3` — upload
- `serve-static@2` — static files
- `node-forge@1` — TLS/certificates

## Interfaces exportées

`nodefony/interfaces/` — tous dans `index.ts` barrel :

| Interface           | Fichier          | Contenu clé                                    |
| ------------------- | ---------------- | ---------------------------------------------- |
| `IContext`          | `IContext.ts`    | `requestId`, `type`, `scheme`, `method`, `url` |
| `IHttpContext`      | `IContext.ts`    | `handle()`, `render()`, `redirect()`           |
| `IWebsocketContext` | `IContext.ts`    | `connect()`, `send()`, `broadcast()`           |
| `IHttpKernel`       | `IHttpKernel.ts` | `handle()`, `onError()`, `isValidDomain()`     |
| `IRequest`          | `IRequest.ts`    | HTTP + WS request shapes                       |
| `IResponse`         | `IResponse.ts`   | HTTP + WS response shapes                      |
| `ICookie`           | `ICookie.ts`     | Cookie options + serialize                     |
| `ISession`          | `ISession.ts`    | Session CRUD + flash + meta                    |
