---
name: http-module-memory
description: "@nodefony/http — serveurs, contextes, WS, pipeline request — notes techniques IA"
metadata:
  type: project
---

# @nodefony/http MEMORY

## Purpose

Module Nodefony : tous les serveurs (HTTP/HTTPS/HTTP2/WS/WSS) + contextes. Différenciateur : HTTP et WS dans le même pipeline Controller.

# NODE.JS CORE API CACHE (HTTP/WS)

## http & http2 (Node v20+)

- **Server**: `http.createServer((req, res) => ...)` | `http2.createSecureServer(options, (req, res) => ...)`
- **Request**: `req.method`, `req.url`, `req.headers`.
- **Response**: `res.writeHead(code, headers)`, `res.end(data)`.
- **HTTP2 Stream**: `stream.respond({ ':status': 200 })`, `stream.on('data')`, `stream.on('end')`.
- **Doc Link**: https://r.jina.ai/https://nodejs.org/api/http2.html

## WebSocket (ws integration)

- **Server**: `new WebSocketServer({ noServer: true })`.
- **Upgrade**: `server.on('upgrade', (req, socket, head) => ws.handleUpgrade(...))`.
- **Doc Link**: https://r.jina.ai/https://github.com/websockets/ws/blob/master/doc/ws.md

## Core Components

| Classe              | Fichier                                     | Rôle                                                                                                                                                                 |
| ------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Http`              | `index.ts`                                  | Module racine. `@services([HttpKernel, Certificate, SessionsService, StaticServer, HttpServer, HttpsServer, WebsocketServer, WebsocketSecureServer, UploadService])` |
| `HttpKernel`        | `service/http-kernel.ts`                    | Orchestrateur. `handle()` → pipeline HTTP. `handleWebsocket()` → pipeline WS. `handleFrontController()` → router+firewall+controller. `onError()` → 1002/1011 WS     |
| `Context`           | `src/context/Context.ts`                    | Base extends `Service`. Props: `type`, `scheme`, `request`, `response`, `method`, `webSocketState`, `metaData`, `session`, `cookies`, `resolver`                     |
| `HttpContext`       | `src/context/http/HttpContext.ts`           | Extends Context. Pipeline HTTP/HTTPS/HTTP2                                                                                                                           |
| `WebsocketContext`  | `src/context/websocket/WebsocketContext.ts` | Extends Context. Props extra: `acceptedProtocol`, `connection` (Ws), `wsUrl`, `rejected`. Override `request` → `WsIncomingMessage`                                   |
| `WebsocketResponse` | `src/context/websocket/Response.ts`         | `connection` assigné dans constructeur. API: `send()`, `broadcast()` (wss.clients forEach), `close(code, msg)`                                                       |

## Servers

| Service                 | Port | Type                        |
| ----------------------- | ---- | --------------------------- |
| server-http             | 5151 | http                        |
| server-https            | 5152 | https + HTTP/2 (allowHTTP1) |
| server-websocket        | 5151 | ws sur http                 |
| server-websocket-secure | 5152 | wss sur https               |
| server-static           | —    | serve-static                |

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

**Protocol WS** :

- `requirements.protocol: "echo-protocol"` → exact string match sur `context.acceptedProtocol`
- Array `['a','b']` → header `"a, b"` → ne matche pas `"a"` → 1002
- `requirements.protocol: ""` → accepte tout (reflect)

**Binary** : `context?.send(buf, "binary")` server-side ; `ws.send(Buffer)` client-side. Envois séquentiels multiples → timeout (bug en investigation).

**Broadcast** : `context.broadcast(str)` → `wss.clients.forEach(send)` — inclut l'émetteur.

**Request.queryGet** : assigné APRÈS `QS.parse(url.search)` — sinon pointe vers ancien objet vide.

**Response.setStatusCode()** : sanitize ASCII (`replace(/[^\x20-\x7E]/g, "")`) — sinon `writeHead()` throw `ERR_INVALID_CHAR` sur em dash etc.

**onConnection** dans http-kernel : `catch` silencieux — erreurs WS avalées, vérifier logs DEBUG.

**Sessions WS** : nécessitent `startSession()` dans `initialize()` du controller.

## Tests

Runner: mocha + ts-node ESM. Prérequis: `npx nodefony development` sur 5151/5152.
**État** : 319 passing, 0 failing (2026-05-15) — mergé dans `claude-ts`.

Config ts-node: `tsconfig.tests.json` + `types: ["node","mocha","chai"]` + `TS_NODE_PROJECT` pour `test:integration`.
Hook `fix-reflect.mjs` : corrige `_virtual/Reflect.js` CJS/ESM (Rollup `__require` absent en preserveModules).

Routes test module (`src/modules/test`) : voir `src/modules/test/CLAUDE.md`.

## Deps clés

- `ws@8.20.1` — ESM : `import Ws, { WebSocketServer } from 'ws'` (jamais `Ws.Server`)
- `formidable@3.5.4` — upload
- `serve-static@2.2.1` — static files
- `uuid@14.0.0`
- `node-forge@1.4.0` — TLS/certificates

## TS Warnings pré-existants (NE PAS CORRIGER sans investigation)

| Fichier                      | Code   | Symbole                     | Note                    |
| ---------------------------- | ------ | --------------------------- | ----------------------- |
| `framework/Route.ts`         | TS2339 | propriété inconnue          | pré-existant            |
| `framework/Route.ts`         | TS7006 | paramètre implicite `any`   | pré-existant            |
| `security/securedArea.ts`    | TS2339 | `resourceURL`               | pré-existant            |
| `server-websocket.ts`        | TS2694 | `Ws.Server` (undefined ESM) | fix = `WebSocketServer` |
| `server-websocket-secure.ts` | TS2694 | `Ws.Server`                 | pré-existant            |
| `WebsocketContext.ts`        | TS2322 | `URL` assignation           | pré-existant            |
| `WebsocketContext.ts`        | TS2741 | `dispatchEvent` manquant    | pré-existant            |
| `WebsocketContext.ts`        | TS2345 | `number\|null`              | pré-existant            |
| `http-kernel.ts`             | TS2322 | lignes 695, 721             | pré-existant            |
| `http-kernel.ts`             | TS6133 | `extraHeaders` inutilisé    | pré-existant            |
