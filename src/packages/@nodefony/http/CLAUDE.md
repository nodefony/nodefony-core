# CLAUDE.md — @nodefony/http

## Rôle du module

Module central de Nodefony : gère **tous les serveurs** (HTTP/HTTPS/HTTP2/WS/WSS) et leurs contextes.
C'est le différenciateur clé du framework — HTTP et WebSocket partagent le même pipeline Controller.

---

## Structure des fichiers

```
src/packages/@nodefony/http/
├── index.ts                        ← classe Http (Module) + exports publics
├── package.json                    ← deps: ws, formidable, serve-static, uuid…
├── rollup.config.ts                ← NE PAS MODIFIER sans accord
├── tsconfig.json                   ← NE PAS MODIFIER sans accord
└── nodefony/
    ├── config/config.ts            ← config défaut (ports, TLS, sessions…)
    ├── command/networkCommand.ts   ← commande CLI `network`
    ├── service/
    │   ├── http-kernel.ts          ← orchestrateur central — routing, firewall, erreurs
    │   ├── certificates.ts         ← génération/chargement TLS (node-forge)
    │   ├── sessions/sessions-service.ts
    │   ├── upload/upload-service.ts  ← formidable
    │   └── servers/
    │       ├── server-http.ts      ← node:http — port 5151
    │       ├── server-https.ts     ← node:https + HTTP/2 — port 5152
    │       ├── server-websocket.ts ← ws sur http — ws://5151
    │       ├── server-websocket-secure.ts ← ws sur https — wss://5152
    │       └── server-static.ts   ← serve-static
    └── src/
        ├── context/
        │   ├── Context.ts          ← classe de base (extends Service)
        │   ├── http/HttpContext.ts ← pipeline HTTP/HTTPS/HTTP2
        │   ├── http/Request.ts + Response.ts
        │   ├── http2/Request.ts + Response.ts
        │   └── websocket/
        │       ├── WebsocketContext.ts ← pipeline WS (IWsRequestExtension)
        │       └── Response.ts        ← send/broadcast/close WS
        ├── cookies/cookie.ts
        ├── errors/httpError.ts
        └── session/
            ├── session.ts
            └── storage/FileSessionStorage.ts
```

---

## Architecture clé

### Pipeline HTTP

```
server-http.ts (IncomingMessage) → http-kernel.ts.handle()
  → createHttpContext()
  → handleFrontController() (Router.match → Resolver.resolve)
  → Firewall.check()
  → Controller.execute()
  → Response.send()
```

### Pipeline WebSocket

```
server-websocket.ts (ws "connection" event) → http-kernel.ts.handleWebsocket()
  → createWebsocketContext()
  → handleFrontController() ← résolution route AVANT accept
  → context.connect() ← accept WS handshake
  → Controller.execute(null) ← handshake (message=null)
  → ws "message" → Controller.execute(message)
```

**Point critique** : la route est résolue (et le protocole vérifié) AVANT `context.connect()`.
Protocol incorrect → `HttpError(1002)` → `context.close(1002)` → client reçoit code 1002.

### WebsocketContext — IWsRequestExtension

`IncomingMessage.url` est une `string` en Node.js natif.
`Route.match()` fait `context.request.url.pathname` — nécessite un objet `URL`.
Fix : `WebsocketContext` étend `request` avec `IWsRequestExtension { url: URL; ... }`.

---

## Décisions techniques figées

| Sujet         | Décision                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------- |
| WS lib        | `ws@8` — `import Ws, { WebSocketServer } from 'ws'` — jamais `Ws.Server` (undefined en ESM) |
| Serveurs      | `node:http`, `node:http2`, `ws` uniquement — jamais Bun.serve                               |
| Protocol WS   | Exact string match — array `['a','b']` → header `"a, b"` → ne match pas `"a"` → 1002        |
| Binary frames | `context.send(buf, "binary")` côté serveur, `ws.send(Buffer)` côté client                   |
| Broadcast     | `Response.broadcast()` → `wss.clients.forEach(send)` — inclut l'émetteur                    |

---

## Tests

Tests dans `nodefony/tests/` — lancés via `npm test` (mocha + ts-node ESM).
**Prérequis** : serveur Nodefony actif (`npx nodefony development`) sur ports 5151/5152.

| Fichier                                         | Sujet                   | État      |
| ----------------------------------------------- | ----------------------- | --------- |
| `http/http.test.ts`                             | HTTP basique            | ✅        |
| `http/fileStream.test.ts`                       | Streaming               | ✅        |
| `http/upload.test.ts`                           | Upload formidable       | ✅        |
| `routing/Router.test.ts`                        | Routing HTTP            | ✅        |
| `websockets/websocket.test.ts`                  | WS basique              | ✅        |
| `websockets/websocket-limits.test.ts`           | Limites taille/séquence | ✅        |
| `websockets/websocket-perf.test.ts`             | Perf concurrence        | ✅        |
| `websockets/websocket-binary-broadcast.test.ts` | Binary + broadcast      | 20/22 ✅  |
| `websockets/websocket-protocol.test.ts`         | Protocol negotiation    | à valider |
| `websockets/websocket-session.test.ts`          | Sessions WS             | ✅        |
| `websockets/websocket-w3c.test.ts`              | W3C compat              | ✅        |

### 2 tests en échec connus

`5 sequential binary` et `10 sequential binary` — timeout — cause : `context.send(buf, "binary")` en boucle ne renvoie pas toutes les frames. À investiguer dans `http-kernel.ts` ou `WebsocketContext`.

---

## Gotchas

- `onConnection` dans http-kernel a un `catch` silencieux — erreurs WS avalées, vérifier les logs server DEBUG
- `WebsocketResponse.connection` est assigné **dans le constructeur** (pas seulement dans `connect()`) → `onError` peut fermer avec code 1002 avant même l'accept
- `context.acceptedProtocol` = header `Sec-WebSocket-Protocol` brut (string)
- `SecuredArea.match()` nécessite `request.url` comme `URL` object — toujours passer par `WsIncomingMessage`
- Les sessions WS nécessitent `startSession()` dans `initialize()` du controller

---

## Ce qu'il ne faut JAMAIS faire sans accord

- Modifier `rollup.config.ts` ou `tsconfig.json`
- Changer les ports par défaut dans `config.ts`
- Remplacer `ws` par une autre lib WS
- Ajouter un default export (module utilise named exports)
