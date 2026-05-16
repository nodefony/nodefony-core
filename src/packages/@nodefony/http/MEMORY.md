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

| Classe              | Fichier                                     | Rôle                                                                                                                                                                 |
| ------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Http`              | `index.ts`                                  | Module racine. `@services([HttpKernel, Certificate, SessionsService, StaticServer, HttpServer, HttpsServer, WebsocketServer, WebsocketSecureServer, UploadService])` |
| `HttpKernel`        | `service/http-kernel.ts`                    | Orchestrateur. `handle()` → pipeline HTTP. `handleWebsocket()` → pipeline WS. `handleFrontController()` → router+firewall+controller. `onError()` → 1002/1011 WS     |
| `Context`           | `src/context/Context.ts`                    | Base extends `Service`. Props: `type`, `scheme`, `request`, `response`, `method`, `webSocketState`, `metaData`, `session`, `cookies`, `resolver`, **`requestId`**    |
| `HttpContext`       | `src/context/http/HttpContext.ts`           | Extends Context. Honor `X-Request-Id` header entrant. Pipeline HTTP/HTTPS/HTTP2.                                                                                    |
| `WebsocketContext`  | `src/context/websocket/WebsocketContext.ts` | Extends Context. Honor `X-Request-Id` header entrant. Props extra: `acceptedProtocol`, `connection` (Ws), `wsUrl`, `rejected`. Override `request` → `WsIncomingMessage` |
| `HttpResponse`      | `src/context/http/Response.ts`              | `writeHead()` : sanitize statusMessage ASCII + injecte `X-Request-Id`. `setBody()`, `setLength()`, `redirect()`.                                                    |
| `WebsocketResponse` | `src/context/websocket/Response.ts`         | `connection` assigné dans constructeur. API: `send()`, `broadcast()` (wss.clients forEach), `close(code, msg)`                                                       |
| `HttpError`         | `src/errors/httpError.ts`                   | Extends `nodefonyError`. Props: `controller`, `action`, `jsonResponse` — extraits de `(context as any)?.resolver` (évite import circulaire avec `@nodefony/framework`) |

## Servers

| Service                 | Port | Type                        |
| ----------------------- | ---- | --------------------------- |
| server-http             | 5151 | http                        |
| server-https            | 5152 | https + HTTP/2 (allowHTTP1) |
| server-websocket        | 5151 | ws sur http                 |
| server-websocket-secure | 5152 | wss sur https               |
| server-static           | —    | serve-static                |

## Request Tracing — requestId

- `Context.requestId = randomUUID()` — UUID v4 généré à construction (base class)
- `HttpContext` constructor : if `request.headers["x-request-id"]` → override requestId
- `WebsocketContext` constructor : if `req.headers["x-request-id"]` → override requestId
- `Response.writeHead()` : `response.setHeader("x-request-id", context.requestId)` avant write
- `Context.logRequest()` : affiche `ID : <uuid>` dans chaque log de fin de requête
- `Context.setMetaData()` : inclut `requestId` dans `metaData.nodefony`
- `IContext.requestId: string` — exporté dans `nodefony/interfaces/IContext.ts`

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

| Hook            | Quand fire                                                 | Payload                       |
| --------------- | ---------------------------------------------------------- | ----------------------------- |
| `beforeResolve` | AVANT `handleFrontController` (HTTP + WS)                  | `(context)`                   |
| `afterAuth`     | APRÈS `firewall.handleSecurity()` SUCCESS (HTTP + WS)      | `(context)`                   |
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
- Préalable : P2.3 (aborted cleanup + 499), P2.5 (request timeout 408)

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

**Fichiers test** : chaque `.ts` dans `nodefony/tests/` doit commencer par `/// <reference types="node" />`.

## Tests — 403 intégration + 94 unit = 497 (2026-05-16)

Runner: mocha + ts-node ESM. Prérequis: `npx nodefony development` sur 5151/5152.

```
unit/    : Cookie, Session, HttpError, Response          — 76 tests
http/    : http, http1, https, errors, decorators,
           fileStream, upload, httpKernel, static,
           session, security, memory, resilience         — 182 tests
routing/ : Router                                        — 11 tests
ws/      : websocket, limits, perf, binary-broadcast,
           protocol, session, w3c                        — 50 tests (+ broadcast=22)
           ─────────────────────────────────────────────────────────
TOTAL    :                                               336 passing
```

`memory.test.ts` — "1000 sequential GET < 35 MB" : flaky en full suite (GC pressure). Passe en isolation. Pas de fuite.

Config ts-node: `tsconfig.tests.json` + hook `fix-reflect.mjs` (corrige `_virtual/Reflect.js` CJS/ESM).

## Deps clés

- `ws@8` — ESM : `import { WebSocketServer } from 'ws'` (jamais `Ws` default, jamais `Ws.Server`)
- `formidable@3` — upload
- `serve-static@2` — static files
- `node-forge@1` — TLS/certificates

## Interfaces exportées

`nodefony/interfaces/` — tous dans `index.ts` barrel :

| Interface        | Fichier           | Contenu clé                                    |
| ---------------- | ----------------- | ---------------------------------------------- |
| `IContext`       | `IContext.ts`     | `requestId`, `type`, `scheme`, `method`, `url` |
| `IHttpContext`   | `IContext.ts`     | `handle()`, `render()`, `redirect()`           |
| `IWebsocketContext` | `IContext.ts`  | `connect()`, `send()`, `broadcast()`           |
| `IHttpKernel`    | `IHttpKernel.ts`  | `handle()`, `onError()`, `isValidDomain()`     |
| `IRequest`       | `IRequest.ts`     | HTTP + WS request shapes                       |
| `IResponse`      | `IResponse.ts`    | HTTP + WS response shapes                      |
| `ICookie`        | `ICookie.ts`      | Cookie options + serialize                     |
| `ISession`       | `ISession.ts`     | Session CRUD + flash + meta                    |
