---
name: http-module-memory
description: "@nodefony/http — serveurs, contextes, WS, pipeline request"
metadata:
  type: project
---

# @nodefony/http MEMORY

## Purpose
Module Nodefony gérant tous les serveurs + contextes HTTP et WebSocket. Différenciateur clé : HTTP et WS dans le même pipeline Controller.

## Core Components

**Http** (`index.ts`) — Module racine. `@services([HttpKernel, Certificate, SessionsService, StaticServer, HttpServer, HttpsServer, WebsocketServer, WebsocketSecureServer, UploadService])`. Hook `onKernelReady`.

**HttpKernel** (`service/http-kernel.ts`) — orchestrateur central. Méthodes clés :
- `handle(req, res, type)` → pipeline HTTP
- `handleWebsocket(req, ws, type)` → pipeline WS
- `handleFrontController(context)` → router + firewall + controller
- `onError(context, error)` → gestion erreurs (WS: code 1002/1011)

**Context** (`src/context/Context.ts`) — classe de base extends `Service`. Propriétés : `type`, `scheme`, `request`, `response`, `method`, `webSocketState`, `metaData`, `session`, `cookies`, `resolver`.

**HttpContext** (`src/context/http/HttpContext.ts`) — extends Context. Pipeline HTTP/HTTPS/HTTP2.

**WebsocketContext** (`src/context/websocket/WebsocketContext.ts`) — extends Context. Propriétés supplémentaires : `acceptedProtocol`, `connection` (Ws), `wsUrl`, `rejected`. Override `request` → `WsIncomingMessage`.

**WebsocketResponse** (`src/context/websocket/Response.ts`) — `connection` assigné dans le constructeur (pas seulement `connect()`). API: `send()`, `broadcast()` (wss.clients forEach), `close(code, msg)`.

## Servers
| Service | Port | Type |
|---|---|---|
| server-http | 5151 | http |
| server-https | 5152 | https + HTTP/2 (allowHTTP1) |
| server-websocket | 5151 | ws sur http |
| server-websocket-secure | 5152 | wss sur https |
| server-static | — | serve-static |

## WS Flow (critique)
1. `server-websocket` reçoit `connection` event (ws@8)
2. `http-kernel.handleWebsocket(req, ws, type)`
3. `createWebsocketContext()` → `WebsocketContext(scope, req, ws, type)`
4. `handleFrontController()` → route resolved AVANT accept
5. Protocol check: `Route.match()` exact string → `HttpError(1002)` si mismatch → `context.close(1002)`
6. `context.connect()` → ws handshake accepted
7. `Controller.execute(null)` → handshake handler
8. `ws "message"` → `Controller.execute(message)`

## IWsRequestExtension (gotcha critique)
`IncomingMessage.url` = string. `Route.match()` fait `.pathname`. Fix : `WsIncomingMessage = IncomingMessage & { url: URL; query; queryGet; path }` — assigné dans `WebsocketContext` constructor.

## Protocol WS
- `requirements.protocol: "echo-protocol"` → exact string match sur `context.acceptedProtocol`
- Array `['a','b']` → header `"a, b"` → ne matche pas `"a"` → 1002
- `requirements.protocol: ""` → accepte tout (reflect)
- Code erreur : toujours 1002 (violation protocole)

## Binary / Broadcast
- Binary: `context?.send(buf, "binary")` server-side; `ws.send(Buffer)` client-side
- Broadcast: `context.broadcast(str)` → `wss.clients.forEach(send)` — inclut l'émetteur
- Gotcha: envois binaires séquentiels multiples → timeout (bug en investigation)

## Tests
Prérequis: serveur `npx nodefony development` sur 5151/5152. Runner: mocha + ts-node ESM.
72 passing, 2 failing (sequential binary timeout) — branche `refactor/http-deps`.

## Deps clés
- `ws@8.20.1` — ESM interop: `import Ws, { WebSocketServer } from 'ws'` (jamais `Ws.Server`)
- `formidable@3.5.4` — upload
- `serve-static@2.2.1` — static files
- `uuid@14.0.0`
- `node-forge@1.4.0` — TLS/certificates
