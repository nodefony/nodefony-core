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

| Comportement | Détail                                                                     |
| ------------ | -------------------------------------------------------------------------- |
| Génération   | `Context.requestId = randomUUID()` — dans le constructeur de base          |
| Corrélation  | Si le client envoie `X-Request-Id`, il remplace le UUID généré (HTTP + WS) |
| Réponse HTTP | `Response.writeHead()` injecte `X-Request-Id: <uuid>` dans chaque réponse  |
| Logs         | `logRequest()` affiche `ID : <uuid>` dans chaque log de fin de requête     |
| MetaData     | Disponible dans `context.metaData.nodefony.requestId`                      |
| Interface    | `IContext.requestId: string`                                               |

---

## Décisions techniques figées

| Sujet         | Décision                                                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| WS lib        | `ws@8` — `import { WebSocketServer } from 'ws'` — jamais `Ws.Server` (undefined en ESM)                                                                            |
| Serveurs      | `node:http`, `node:http2`, `ws` uniquement — jamais Bun.serve                                                                                                      |
| Protocol WS   | Exact string match — array `['a','b']` → header `"a, b"` → ne match pas `"a"` → 1002                                                                               |
| Binary frames | `context.send(buf, "binary")` côté serveur, `ws.send(Buffer)` côté client                                                                                          |
| Broadcast     | `Response.broadcast()` → `wss.clients.forEach(send)` — inclut l'émetteur                                                                                           |
| statusMessage | Sanitiser avec `replace(/[^\x20-\x7E]/g, "")` juste avant `ServerResponse.writeHead()` — Node.js set le natif AVANT validation → ERR_INVALID_CHAR en cascade sinon |
| url.parse     | Interdit — utiliser `new URL(str, "http://localhost")` partout                                                                                                     |

---

## Tests (vitest — mocha retiré)

**Runner unique = Vitest 4** (mocha retiré : suppression totale, gate audit). 3 suites = 3 configs :

| Commande                   | Config                         | Spec                                             | Compte (indicatif)    | Serveur requis  |
| -------------------------- | ------------------------------ | ------------------------------------------------ | --------------------- | --------------- |
| `npm test`                 | `vitest.config.ts`             | `tests/unit/**`                                  | **337** (20 fichiers) | non             |
| `npm run test:integration` | `vitest.integration.config.ts` | `tests/{http,integration,routing,websockets}/**` | **400 + 1 skipped**   | oui (5151/5152) |
| `npm run test:load`        | `vitest.load.config.ts`        | `tests/load/**` + `tests/http/memory.test.ts`    | charge/heap/leak      | oui             |
| `npm run test:memory`      | `vitest.load.config.ts`        | `tests/http/memory.test.ts` seul (le GATE)       | **9** (gate mémoire)  | oui             |

> Les suites intégration/load sont **séquentielles** (`fileParallelism:false`) : tous les fichiers
> tapent le MÊME serveur live → la parallélisation corromprait sessions/ports et surtout les deltas de
> heap (load). Plus de double-exécution unit (mocha est parti) : `unit` ne tourne QUE sous `npm test`.
> Compte réel à jour : `npm test 2>&1 | tail -3` · `npm run test:integration 2>&1 | tail -3`.
> ⚠️ Le serveur dev (DevSupervisor) **redémarre sur édition de fichier** — ne pas éditer pendant un run
> intégration/load (ECONNREFUSED transitoire). Run propre = serveur stable, pas d'édition concurrente.

Cartographie fichier→sujet ci-dessous (comptes par fichier **indicatifs** : la colonne sujet fait foi, les totaux dérivent — compte réel = les commandes ci-dessus) :

| Fichier                                         | Sujet                                           | Tests | État |
| ----------------------------------------------- | ----------------------------------------------- | ----- | ---- |
| `unit/Cookie.test.ts`                           | Cookie serialize/parse/options + signé HMAC     | 41    | ✅   |
| `unit/Session.test.ts`                          | Session CRUD, flash, meta, serialize            | 36    | ✅   |
| `unit/Response.test.ts`                         | HttpResponse setBody/setStatus/setLength        | 24    | ✅   |
| `unit/AuditLogger.test.ts`                      | Audit JSON shape, redaction, severity           | 24    | ✅   |
| `unit/parser.test.ts`                           | body/charset parsers (QS/XML/multipart)         | 17    | ✅   |
| `unit/HttpError.test.ts`                        | HttpError wrapping, code, stack                 | 16    | ✅   |
| `unit/trace.test.ts`                            | traceparent W3C parse/format                    | 14    | ✅   |
| `unit/trustProxy.test.ts`                       | trustProxy CIDR/presets/BlockList               | 11    | ✅   |
| `unit/RequestLogger.test.ts`                    | logger requête                                  | 11    | ✅   |
| `unit/Profiler.test.ts`                         | Profiler ring buffer + admin api                | 11    | ✅   |
| `unit/requestId.test.ts`                        | sanitizeRequestId Zero Trust                    | 10    | ✅   |
| `unit/PrettyRequestLogger.test.ts`              | pretty logger                                   | 10    | ✅   |
| `unit/wsCloseCode.test.ts`                      | codes close WS RFC 6455                         | 9     | ✅   |
| `unit/ErrorRenderer.test.ts`                    | rendu erreur HTML/JSON                          | 9     | ✅   |
| `unit/UploadedFile.test.ts`                     | UploadedFile (taille, temp, cleanup)            | 7     | ✅   |
| `unit/clientError.test.ts`                      | clientError ferme socket 400/431                | 4     | ✅   |
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
>
> ² Tableau **non exhaustif** (focus unit + cas emblématiques). Non listés mais verts : `http/{auto-json,headers,forward,abort-cleanup,traceparent}.test.ts` + tout `integration/` (ALS, after-response, timing, request-context, security-hooks, http-rfc-errors). Inventaire réel = `ls nodefony/tests/**/*.test.ts` ; compte = commandes ci-dessus.

### Suites séparées — charge vs non-régression

- **Non-régression rapide** : `npm run test:integration` (`vitest.integration.config.ts`). Exclut `tests/load/**` + `tests/http/memory.test.ts`. C'est la suite à lancer systématiquement.
- **Charge / mémoire / leak / scopes DI** : `npm run test:load` (`vitest.load.config.ts` = `tests/load/**` + `memory.test.ts`). À lancer AVANT tout commit touchant Kernel / pipeline request / cycle de vie / mémoire — pas à chaque non-régression (sinon trop lent).
- Gate perf seul : `npm run test:memory` (= `vitest.load.config.ts` filtré sur `memory.test.ts`).
- ✅ **`tests/load/ws-messages-load.test.ts > sustained heap < 30 MB`** : le faux positif (delta ~160–185 MB) venait de la **sonde `/nodefony/test/memory` qui lisait `heapUsed` sans forcer le GC**, sur un serveur **sans `--expose-gc`** → on mesurait le **garbage transitoire** des 5000 frames, pas du retenu. **Jamais une fuite ni une régression** (identique sous mocha). Le vrai bug de rétention WS-sous-charge (session SQLite par connexion) avait déjà été corrigé à part (`WebSocketController` sans `startSession` global). **Fix** : la sonde force `global.gc?.()` (heap retenu) + `start.sh` lance le serveur avec `--expose-gc`. **Preuve** : avec GC forcé, delta < 30 MB, suite load 26/28 verte. ⚠️ Le gate mémoire **exige** un serveur lancé via `start.sh` (qui pose `--expose-gc`) — sinon le faux positif revient. Cf mémoire `project_ws_sustained_heap_finding`.
- Tests ALS/lifecycle : `tests/integration/{request-context-ws,after-response-als,lifecycle-als}.test.ts` (rapides, assertions delta) + `tests/load/als-load.test.ts` (lourds). Route diagnostic scopes : `/nodefony/test/als-test/scopes`.
- **Stress WS** (2 axes distincts) : `tests/load/ws-connections-load.test.ts` (axe 1 — nombre de sockets simultanées) + `tests/load/ws-messages-load.test.ts` (axe 2 — débit frames + broadcast). Cas CI-stables = lossless + plancher de débit + scopes drainés (poll `drainTo`, pas de `wait` fixe). Sondes plafond/rupture gated derrière `RUN_WS_RUPTURE=1` (cap `WS_RUPTURE_CAP`, défaut 8000) car elles épuisent les ports éphémères loopback. Mesures observées : ~750+ conn / 33–38k msg/s soutenu jusqu'à 200k frames sans perte.
  - Gotcha harness : ouvrir N centaines de WS en **un seul** `Promise.all` → `AggregateError` (connect TLS loopback dual-stack `internalConnectMultiple`) → ouvrir par **batches** (`openFleet`, 50/batch). Tracker chaque socket (`Set` + `afterEach` terminate) sinon un test qui throw laisse des sockets ouvertes qui **polluent la baseline scopes** du test suivant.
- **Traceparent W3C sur WS** : `tests/http/traceparent.test.ts` assert désormais la **propagation réelle** du traceId dans le handler de message WS (via la sonde `/nodefony/test/als-test/ws` qui renvoie `RequestContext.traceparent`), pas seulement la tolérance au handshake.

---

## Bugs corrigés (cas limites connus)

| Bug                                                  | Fichier                   | Fix                                                                                                               |
| ---------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `ERR_INVALID_CHAR` sur statusMessage                 | `Response.ts:writeHead()` | `safeMsg.replace(/[^\x20-\x7E]/g,"")` avant `ServerResponse.writeHead()` — Node.js poison le natif avant de throw |
| `url.parse()` deprecation                            | `sessions-service.ts`     | Remplacé par `new URL(context.url, "http://localhost")`                                                           |
| `HttpError.controller/action/jsonResponse` undefined | `httpError.ts`            | Extraits de `(context as any)?.resolver` dans le constructeur                                                     |
| Cookie `Expires` overflow                            | `cookie.ts`               | `maxAge * 1000` → `maxAge` déjà en ms                                                                             |
| `maxAge=0` session cookie                            | `cookie.ts`               | Cas 0 traité séparément                                                                                           |

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

## Lancer le serveur (tests d'intégration)

→ Skill **`nodefony-start-server`** (`bash .claude/skills/nodefony-start-server/start.sh`) : rebuild
conditionnel de `src/modules/test`, kill ports 5151/5152, **spawn `detached`** (évite le SIGHUP qui tue
`npx nodefony development &`), attente boot + health check. Commandes standalone `nodefony status` /
`nodefony stop` (de partout). Diagnostic crash → skill **`nodefony-tail-error-logs`**.

> ⚠️ **Gotcha dist — cause #1 des 404 en test.** En `development`, Nodefony charge le `dist/` existant au
> boot PUIS recompile (Rollup) ~12 s plus tard et l'écrase : une route ajoutée au source APRÈS le dernier
> build est **absente** jusqu'au prochain restart avec dist à jour. → **rebuilder `src/modules/test`
> (`npm run build`) avant de démarrer si le source a changé.** Diagnostic : **404** sur une route définie =
> dist périmé ; route trouvée mais **500** = erreur controller (stack dans les logs). ⚠️ Le DevSupervisor
> **redémarre sur édition de fichier** → ne pas éditer pendant un run intégration/load (ECONNREFUSED transitoire).

---

## Ce qu'il ne faut JAMAIS faire sans accord

- Modifier `rollup.config.ts` ou `tsconfig.json`
- Changer les ports par défaut dans `config.ts`
- Remplacer `ws` par une autre lib WS
- Ajouter un default export (module utilise named exports)
- Importer `@nodefony/framework` depuis `@nodefony/http` (dépendance circulaire)
