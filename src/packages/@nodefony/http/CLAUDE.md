# CLAUDE.md — @nodefony/http

## Docs liées

- [`MEMORY.md`](./MEMORY.md) — internals IA (Context, requestId, gotchas, transports)
- [`../framework/CLAUDE.md`](../framework/CLAUDE.md) — Router/Controller qui consomme ce module (utilisé via `handleFrontController`)
- [`../../../modules/test/CLAUDE.md`](../../../modules/test/CLAUDE.md) — routes d'intégration HTTP/WS
- [`../../../../CLAUDE.md`](../../../../CLAUDE.md) — règles globales projet
- Core : [`../../../nodefony/MEMORY.md`](../../../nodefony/MEMORY.md) — Service, Container | [`../../../nodefony/src/kernel/MEMORY.md`](../../../nodefony/src/kernel/MEMORY.md) — Kernel/Module lifecycle

> **Règle dure** : `@nodefony/http` ne peut PAS importer `@nodefony/framework` (cycle). Accès au resolver via `(context as any)?.resolver`.

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
    ├── interfaces/                 ← IContext, IHttpKernel, IRequest, IResponse, ICookie, ISession, IUpload
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
        │   ├── Context.ts          ← classe de base (extends Service) — requestId ici
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
  → Response.writeHead() ← injecte X-Request-Id ici
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

### Request Tracing — requestId

Chaque contexte (HTTP + WS) reçoit un `requestId` UUID v4 à la construction (`randomUUID()`).

| Comportement | Détail |
| --- | --- |
| Génération | `Context.requestId = randomUUID()` — dans le constructeur de base |
| Corrélation | Si le client envoie `X-Request-Id`, il remplace le UUID généré (HTTP + WS) |
| Réponse HTTP | `Response.writeHead()` injecte `X-Request-Id: <uuid>` dans chaque réponse |
| Logs | `logRequest()` affiche `ID : <uuid>` dans chaque log de fin de requête |
| MetaData | Disponible dans `context.metaData.nodefony.requestId` |
| Interface | `IContext.requestId: string` |

---

## Décisions techniques figées

| Sujet         | Décision                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------- |
| WS lib        | `ws@8` — `import { WebSocketServer } from 'ws'` — jamais `Ws.Server` (undefined en ESM)    |
| Serveurs      | `node:http`, `node:http2`, `ws` uniquement — jamais Bun.serve                               |
| Protocol WS   | Exact string match — array `['a','b']` → header `"a, b"` → ne match pas `"a"` → 1002        |
| Binary frames | `context.send(buf, "binary")` côté serveur, `ws.send(Buffer)` côté client                   |
| Broadcast     | `Response.broadcast()` → `wss.clients.forEach(send)` — inclut l'émetteur                    |
| statusMessage | Sanitiser avec `replace(/[^\x20-\x7E]/g, "")` juste avant `ServerResponse.writeHead()` — Node.js set le natif AVANT validation → ERR_INVALID_CHAR en cascade sinon |
| url.parse     | Interdit — utiliser `new URL(str, "http://localhost")` partout                               |

---

## Tests — état complet (336/336 — 2026-05-16)

Tests dans `nodefony/tests/` — lancés via `npm test` (mocha + ts-node ESM).
**Prérequis** : serveur Nodefony actif (`npx nodefony development`) sur ports 5151/5152.

| Fichier                                         | Sujet                                           | Tests | État |
| ----------------------------------------------- | ----------------------------------------------- | ----- | ---- |
| `unit/Cookie.test.ts`                           | Cookie serialize/parse/options                  | 18    | ✅   |
| `unit/Session.test.ts`                          | Session CRUD, flash, meta, serialize            | 38    | ✅   |
| `unit/HttpError.test.ts`                        | HttpError wrapping, code, stack                 | 12    | ✅   |
| `unit/Response.test.ts`                         | HttpResponse setBody/setStatus/setLength        | 8     | ✅   |
| `http/http.test.ts`                             | HTTP basique                                    | 12    | ✅   |
| `http/http1.test.ts`                            | HTTP port 5151 GET/POST/PUT/DELETE + headers    | 12    | ✅   |
| `http/https.test.ts`                            | TLS handshake + cipher + HSTS                   | 8     | ✅   |
| `http/errors.test.ts`                           | JSON error format (code, message, stack, route) | 18    | ✅   |
| `http/decorators.test.ts`                       | @Param/@Body/@Query via HTTP                    | 10    | ✅   |
| `http/fileStream.test.ts`                       | Streaming                                       | 8     | ✅   |
| `http/upload.test.ts`                           | Upload formidable                               | 7     | ✅   |
| `http/httpKernel.test.ts`                       | Pipeline, Content-Type, erreurs, X-Request-Id   | 35    | ✅   |
| `http/static.test.ts`                           | Fichiers statiques                              | 12    | ✅   |
| `http/session.test.ts`                          | Sessions HTTP                                   | 15    | ✅   |
| `http/security.test.ts`                         | CORS, firewall                                  | 20    | ✅   |
| `http/memory.test.ts`                           | Memory leaks HTTP + WS                          | 7     | ✅ ¹ |
| `http/resilience.test.ts`                       | Disconnect, burst, malformed                    | 7     | ✅   |
| `routing/Router.test.ts`                        | Routing HTTP                                    | 11    | ✅   |
| `websockets/websocket.test.ts`                  | WS basique                                      | 8     | ✅   |
| `websockets/websocket-limits.test.ts`           | Limites taille/séquence                         | 8     | ✅   |
| `websockets/websocket-perf.test.ts`             | Perf concurrence                                | 5     | ✅   |
| `websockets/websocket-binary-broadcast.test.ts` | Binary + broadcast                              | 22    | ✅   |
| `websockets/websocket-protocol.test.ts`         | Protocol negotiation                            | 15    | ✅   |
| `websockets/websocket-session.test.ts`          | Sessions WS                                     | 1     | ✅   |
| `websockets/websocket-w3c.test.ts`              | W3C compat                                      | 2     | ✅   |

> ¹ `memory.test.ts` — test "1000 sequential GET < 35 MB" flaky en full suite (GC pressure après 249 tests). Passe toujours en isolation. Pas de fuite réelle.

---

## Bugs corrigés (historique)

| Bug | Fichier | Fix |
| --- | ------- | --- |
| `ERR_INVALID_CHAR` sur statusMessage | `Response.ts:writeHead()` | `safeMsg.replace(/[^\x20-\x7E]/g,"")` avant `ServerResponse.writeHead()` — Node.js poison le natif avant de throw |
| `url.parse()` deprecation | `sessions-service.ts` | Remplacé par `new URL(context.url, "http://localhost")` |
| `HttpError.controller/action/jsonResponse` undefined | `httpError.ts` | Extraits de `(context as any)?.resolver` dans le constructeur |
| Cookie `Expires` overflow | `cookie.ts` | `maxAge * 1000` → `maxAge` déjà en ms |
| `maxAge=0` session cookie | `cookie.ts` | Cas 0 traité séparément |

---

## Gotchas

- `onConnection` dans http-kernel a un `catch` silencieux — erreurs WS avalées, vérifier les logs server DEBUG
- `WebsocketResponse.connection` est assigné **dans le constructeur** (pas seulement dans `connect()`) → `onError` peut fermer avec code 1002 avant même l'accept
- `context.acceptedProtocol` = header `Sec-WebSocket-Protocol` brut (string)
- `SecuredArea.match()` nécessite `request.url` comme `URL` object — toujours passer par `WsIncomingMessage`
- Les sessions WS nécessitent `startSession()` dans `initialize()` du controller
- `httpError.ts` ne peut pas importer `@nodefony/framework` (dépendance circulaire) → accès au resolver via `(context as any)?.resolver`
- Tout nouveau fichier test `.ts` doit avoir `/// <reference types="node" />` en première ligne

---

## Lancer le serveur pour les tests d'intégration (procédure IA)

### Prérequis : rebuilder le module test avant le serveur

En mode `development`, Nodefony charge d'abord le `dist/` existant (routes enregistrées à ce moment), puis recompile avec Rollup ~12 s plus tard et écrase le dist. Toute route ajoutée au source APRÈS le dernier build manuel sera absente du routeur jusqu'au prochain redémarrage avec dist à jour.

**Règle** : toujours rebuilder `src/modules/test` avant de démarrer le serveur si le source a changé :

```bash
cd /Users/cci/repository/nodefony-core/src/modules/test && npm run build
```

### Démarrage du serveur (technique fiable)

Le simple `npx nodefony development > log 2>&1 &` meurt immédiatement (SIGHUP du subshell). Utiliser `spawn` Node.js avec `detached: true` :

```bash
node -e "
const { spawn } = require('child_process');
const child = spawn('npx', ['nodefony', 'development'], {
  cwd: '/Users/cci/repository/nodefony-core',
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true
});
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
child.unref();
require('fs').writeFileSync('/tmp/srv.pid', String(child.pid));
" > /tmp/nodefony-server.log 2>&1 &
```

Attendre 20 s, puis vérifier :

```bash
grep "Server Listen" /tmp/nodefony-server.log | sed 's/\x1b\[[0-9;]*m//g'
```

Signes OK : 5 lignes `Server Listen on http://... / https://... / ws://... / wss://...`

### Lecture des logs serveur et corrélation avec les bugs

- **Logs de requêtes** : `grep -E "http|https|ws" /tmp/nodefony-server.log | grep -E "404|500|ERROR"`
- **ID requête** : `grep "ID :" /tmp/nodefony-server.log | sed 's/\x1b\[[0-9;]*m//g'`
- **Routes non trouvées (404)** → cause probable : dist périmé (voir prérequis ci-dessus)
- **Routes trouvées mais 500** → erreur dans le controller, lire le stack trace dans le log
- **Tuer le serveur** : `lsof -ti:5151 -ti:5152 | xargs kill -9 2>/dev/null`
- **PID du serveur** : `cat /tmp/srv.pid` (si sauvegardé) ou `lsof -ti:5151`

---

## Ce qu'il ne faut JAMAIS faire sans accord

- Modifier `rollup.config.ts` ou `tsconfig.json`
- Changer les ports par défaut dans `config.ts`
- Remplacer `ws` par une autre lib WS
- Ajouter un default export (module utilise named exports)
- Importer `@nodefony/framework` depuis `@nodefony/http` (dépendance circulaire)
