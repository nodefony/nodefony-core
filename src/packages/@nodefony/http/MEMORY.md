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

---

## Plan de migration TypeScript — @nodefony/http

### Phase 1 — Interfaces ✅ (commit 8a81ede — 2026-05-15)
Créé `nodefony/interfaces/` : `ICookie`, `ISession`, `IUpload`, `IRequest`, `IResponse`, `IContext`, `IHttpKernel`, `index.ts`.
`implements` ajouté sur : `Cookie`, `Context`, `HttpContext`, `WebsocketContext`, `HttpKernel`.

### Phase 2 — Tests unitaires ✅ partiel (commit 3ddf8ca — 2026-05-15)
Runner: `npm run test:unit` → `.mocharc.unit.json` + hook `fix-reflect.mjs` (patch Rollup _virtual/Reflect.js ESM issue).
- `Cookie.test.ts` ✅ 43 passing
- `HttpError.test.ts` ✅ 13 passing
- `Session.test.ts` — start, save, flashBag, migrate/invalidate (mock FileSessionStorage)
- `Context.test.ts` — base class: type, scheme, cookies map, metaData (mock IncomingMessage)

**Note technique loader** : `_virtual/Reflect.js` dans nodefony dist utilise `__require` (helper Rollup CJS absent en preserveModules ESM). Hook `nodefony/tests/hooks/fix-reflect.mjs` intercept et remplace par `createRequire`.

### Phase 3 — Tests d'intégration runtime (en attente)
Prérequis : `npx nodefony development` sur 5151/5152.
Appui sur le module `src/modules/test` (HtmlController, RestController, WebSocketController…).
- `http1.test.ts` — GET/POST/PUT/DELETE, headers, status codes
- `http2.test.ts` — HTTP/2 multiplexing, stream
- `https.test.ts` — TLS handshake, redirect HTTP→HTTPS
- `session.test.ts` — session cookie, flashBag, invalidation (RestController)
- `upload.test.ts` ✅ (déjà présent — HtmlController /upload)
- `errors.test.ts` — 400/401/403/404/408/500/504, format JSON/HTML
- `context.test.ts` — context properties via route /nodefony/test/* (HttpKernel + Context validés côté serveur)

### Phase 4 — HTTP/3 stub (en attente)
`server-http3.ts` reste commenté — `node:http3` n'existe pas dans Node.js v26.
QUIC disponible via `node:net` mais pas de couche HTTP/3. À réactiver quand Node.js supportera.

### Phase 5 — Performance (en attente)
- Compression gzip/brotli (`node:zlib` + `Accept-Encoding`)
- ETag / `If-None-Match` → 304 Not Modified
- `Connection: keep-alive` + timeout configuration
- Benchmarks : `autocannon` ou `wrk`

### Phase 6 — README.md (en attente)
Documentation publique complète du module avec exemples API, tableaux, troubleshooting.

### Phase 7 — Commandes CLI HTTP (en attente)
Nouvelles commandes dans `nodefony/command/` :
- `certificates` — afficher/générer/renouveler certificats TLS (info expiry, CN, SAN)
- `routes` — lister toutes les routes enregistrées (méthode, path, controller, protocole)
- `sessions:clear` — vider les sessions fichiers (storage FileSessionStorage)
- `sessions:list` — lister sessions actives (id, expires, user)
- `server:stats` — connexions actives, mémoire, uptime par serveur
- `compress:test` — tester gzip/brotli sur une URL interne (debug Phase 5)

---

## Warnings TypeScript pré-existants (NE PAS CORRIGER sans investigation)

Ces warnings existaient AVANT la Phase 1 — ne pas les introduire dans les commits Phase 1+.

| Fichier | Code | Symbole | Note |
|---|---|---|---|
| `framework/Route.ts` | TS2339 | propriété inconnue | pré-existant |
| `framework/Route.ts` | TS7006 | paramètre implicite `any` | pré-existant |
| `security/securedArea.ts` | TS2339 | `resourceURL` | pré-existant |
| `server-websocket.ts` | TS2694 | `Ws.Server` (undefined ESM) | pré-existant — `WebSocketServer` est le fix ESM |
| `server-websocket-secure.ts` | TS2694 | `Ws.Server` (undefined ESM) | pré-existant |
| `WebsocketContext.ts` | TS2322 | `URL` assignation | pré-existant |
| `WebsocketContext.ts` | TS2741 | `dispatchEvent` manquant | pré-existant |
| `WebsocketContext.ts` | TS2345 | `number\|null` | pré-existant |
| `http-kernel.ts` | TS2322 | lignes 695, 721 | pré-existant |
| `http-kernel.ts` | TS6133 | `extraHeaders` inutilisé | pré-existant |
