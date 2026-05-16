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

## Lifecycle Timing — Context.phases (P1.1, 2026-05-16)

- `Context.phases: PhaseTiming[]` — instrumentation pipeline, rempli par HttpKernel
- API : `context.phaseStart(name)` / `context.phaseEnd(name)` — `performance.now()` (perf_hooks)
- `_phaseIndex: Map<string,name>` → `O(1)` lookup ; `phaseEnd` idempotent (re-call = noop)
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

## Tests — 377/377 (2026-05-16)

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
