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
├── package.json                    ← deps: ws, @fastify/busboy, serve-static, uuid…
├── rolldown.config.ts                ← NE PAS MODIFIER sans accord
├── tsconfig.json                   ← NE PAS MODIFIER sans accord
└── nodefony/
    ├── config/config.ts            ← config défaut (ports, TLS, sessions…)
    ├── command/networkCommand.ts   ← commande CLI `network`
    ├── interfaces/                 ← IContext, IHttpKernel, IRequest, IResponse, ICookie, ISession, IUpload
    ├── service/
    │   ├── http-kernel.ts          ← orchestrateur central — routing, firewall, erreurs
    │   ├── certificates.ts         ← génération/chargement TLS (node-forge)
    │   ├── sessions/sessions-service.ts
    │   ├── upload/upload-service.ts  ← @fastify/busboy
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
  → rate-limit par IP                  ← si options.rateLimit.enabled (:865)
  → createHttpContext()
  → Firewall.handleCors()              ← AVANT le routing ; preflight → 204, court-circuit (:1169)
  → Router.resolve()                   ← match hissé AVANT le parse du body (:1183)
  → Firewall.applySecurityHeaders()    ← CSP/Referrer/COOP, avant tout writeHead (:1194)
  → fallback statique                  ← ROUTER-FIRST : seulement si aucune route (:1201)
  → request.initialize()               ← parse du body (sauté si @Body({stream:true})) (:1225)
  → onRequestEnd() (:1251)
      → hook beforeResolve
      → prepareFrontController()       ← route + zone (context.secure) — N'INSTANCIE PAS (:1282)
      → Firewall.enforceCsrf()         ← rejet précoce des mutations cross-site (:1290)
      → startSession()                 ← AVANT le firewall : SessionAuthenticator lit L1 (:1295)
      → Firewall.handleSecurity()      ← si context.secure || isControlledAccess (:1301)
  → Context.handle() → callController → @IsGranted → newController + initialize() → action (:1235)
  → Response.writeHead() ← injecte X-Request-Id ici
  → Response.send()
```

⚠️ **`Firewall.check()` n'existe pas** — le point d'entrée du firewall est
`handleSecurity()` (`firewall.ts:587`), et il est précédé de trois autres appels
(`handleCors`, `applySecurityHeaders`, `enforceCsrf`) qui, eux, tournent sur
**toutes** les requêtes, zone ou pas.

⚠️ **Le controller n'est PAS instancié avant le firewall (HTTP).** `prepareFrontController()`
arme la route (résolveur + `context.secure`) ; l'instanciation DI et le hook
`initialize()` attendent `Resolver.executeAction()`, après CSRF, session, firewall
et `@IsGranted`. Une requête qui finit en 401/403 n'exécute donc aucun code de
controller. Le **WS garde** l'instanciation au handshake (`handleFrontController`) :
le controller porte le protocole négocié et c'est la dernière fenêtre avant
`connect()` pour toucher la réponse — donc en WS, `initialize()` reste pré-firewall.
Verrou : `tests/http/pipeline-order.test.ts`.

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

| Commande                   | Config                         | Spec                                             | Portée           | Serveur requis  |
| -------------------------- | ------------------------------ | ------------------------------------------------ | ---------------- | --------------- |
| `npm test`                 | `vitest.config.ts`             | `tests/unit/**`                                  | pur, hors réseau | non             |
| `npm run test:integration` | `vitest.integration.config.ts` | `tests/{http,integration,routing,websockets}/**` | non-régression   | oui (5151/5152) |
| `npm run test:load`        | `vitest.load.config.ts`        | `tests/load/**` + `tests/http/memory.test.ts`    | charge/heap/leak | oui             |
| `npm run test:memory`      | `vitest.load.config.ts`        | `tests/http/memory.test.ts` seul (le GATE)       | gate mémoire     | oui             |

> **Aucun compte de tests n'est écrit ici** : il se périme au premier test ajouté et personne ne le
> recale. Le compte réel se demande au runner (`npm test 2>&1 | tail -3`), l'inventaire au disque
> (`ls nodefony/tests/**/*.test.ts`).

> Les suites intégration/load sont **séquentielles** (`fileParallelism:false`) : tous les fichiers
> tapent le MÊME serveur live → la parallélisation corromprait sessions/ports et surtout les deltas de
> heap (load). Plus de double-exécution unit (mocha est parti) : `unit` ne tourne QUE sous `npm test`.
> Compte réel à jour : `npm test 2>&1 | tail -3` · `npm run test:integration 2>&1 | tail -3`.
> ⚠️ Le serveur dev (DevSupervisor) **redémarre sur édition de fichier** — ne pas éditer pendant un run
> intégration/load (ECONNREFUSED transitoire). Run propre = serveur stable, pas d'édition concurrente.

Cartographie **par sujet** (pour trouver où poser un test, ou où un comportement est déjà couvert) :

| Sujet                     | Où                                                                                                                                                                                                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cookies                   | `unit/Cookie.test.ts` (serialize/parse/options + signé HMAC)                                                                                                                                                                                                           |
| Sessions                  | `unit/{Session,MemorySessionStorage,SessionsAdmin,sessions-admin-paging,session-pagination,session-timeout.attack}.test.ts` · `http/{session,session-runtime,session-bff}.test.ts` · `websockets/websocket-session.test.ts` · `integration/session-revocation.test.ts` |
| Requête / réponse / body  | `unit/{Response,parser,metaData}.test.ts` · `http/{body-content-types,body-limit,auto-json,headers,decorators,decorators-response}.test.ts` · `integration/{bodyStream,decorators-param}.test.ts`                                                                      |
| Erreurs & codes HTTP      | `unit/{HttpError,ErrorRenderer,clientError}.test.ts` · `http/{errors,host-misdirected,client-abort-499}.test.ts` · `integration/http-rfc-errors.test.ts`                                                                                                               |
| Pipeline & cycle de vie   | `http/{httpKernel,pipeline-order,lifecycle-init-crash,timeout-abort,abort-cleanup}.test.ts` · `integration/{after-response,abort-signal,timing,di-singleton}.test.ts`                                                                                                  |
| ALS / contexte de requête | `integration/{request-context,request-context-ws,lifecycle-als,after-response-als}.test.ts` · `load/als-load.test.ts`                                                                                                                                                  |
| Sécurité (attaques)       | `http/security.test.ts` (path traversal, injection d'en-tête, taille URL/corps, cookie, fuite d'information) · `http/{webauthn-attack,firewall-auth}.test.ts` · `integration/oauth2-attack.test.ts` · `websockets/ws-data-plane-attack.test.ts`                        |
| CORS · CSRF · en-têtes    | `http/{cors,csrf,security-headers}.test.ts` — **CORS a son fichier dédié**, pas `security.test.ts`                                                                                                                                                                     |
| Auth (flux)               | `http/{webauthn-bff,firewall-auth}.test.ts` · `integration/{apikey-flow,oauth2-flow,security-hooks}.test.ts` · `websockets/{ws-scope-jwt,ws-isgranted-jwt,ws-data-plane-auth}.test.ts`                                                                                 |
| Proxy / IP de confiance   | `unit/{trustProxy,forwarded,forwardedWiring,generateProxyConfig,domain}.test.ts` · `http/forward.test.ts`                                                                                                                                                              |
| Traçage / journalisation  | `unit/{trace,requestId,RequestLogger,PrettyRequestLogger,wsLogContent,Profiler,AuditLogger,FrameProfile}.test.ts` · `http/traceparent.test.ts` · `websockets/websocket-trace-logging.test.ts`                                                                          |
| WebSocket (protocole)     | `websockets/{websocket,websocket-protocol,websocket-limits,websocket-fragmentation,websocket-origin,websocket-w3c,websocket-binary-broadcast}.test.ts` · `unit/{wsCloseCode,wsHeartbeat,wsBackpressure,wsConnectionCounter,WsResponsePeerGone}.test.ts`                |
| WebSocket (pont/actions)  | `websockets/{ws-bridge-radiography,ws-bridge-rendered-action}.test.ts`                                                                                                                                                                                                 |
| Statique & upload         | `http/{static,fileStream,upload}.test.ts` · `unit/{UploadedFile,collectAssets,prebuiltUi}.test.ts`                                                                                                                                                                     |
| Routage                   | `routing/Router.test.ts` · `integration/domain-routing.test.ts`                                                                                                                                                                                                        |
| Config & démarrage        | `unit/{httpConfig,portBinder,certificates,PhasesVerbose,httpContextTimeout}.test.ts` · `integration/stores-location.test.ts` · `http/{health,https,http,http1}.test.ts`                                                                                                |
| Débit / quotas            | `unit/{rateLimit,rateLimitAdminApi,Backpressure}.test.ts` · `http/resilience.test.ts`                                                                                                                                                                                  |
| Charge & mémoire          | `http/memory.test.ts` (le gate ¹) · `load/{session,stream,ws-connections,ws-messages,ws-latency}-load.test.ts`                                                                                                                                                         |

> ¹ `memory.test.ts` — le cas « 1000 GET séquentiels < 35 MB » est flaky en suite complète (pression
> GC après ~250 tests) et passe toujours en isolation : ce n'est pas une fuite. Diagnostic →
> skill `nodefony-check-memory-health`.

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
- **Ne PAS appeler `startSession()` dans `initialize()` d'un controller WS** : le point d'activation
  est unique et partagé avec le HTTP — `HttpKernel.onConnect()` l'appelle après le front controller
  et avant `context.connect()` (`http-kernel.ts:1579-1584`), gardé par `context.sessionStarting`.
  Il est **paresseux** : sans intent de route ni cookie entrant, il ne crée rien (`:1036-1053`).
  L'appeler à la main dans un controller rétablit l'ancien « démarre sur toutes les routes » — donc
  une session persistée par connexion WS, y compris sur `echo`/`broadcast` qui n'en ont aucun besoin
  (le module `test` documente la tempête d'INSERT que ça avait causée, `WebSocketController.ts:19-26`).
- `httpError.ts` ne peut pas importer `@nodefony/framework` (dépendance circulaire) → accès au resolver via `(context as any)?.resolver`
- Tout nouveau fichier test `.ts` doit avoir `/// <reference types="node" />` en première ligne

---

## Lancer le serveur (tests d'intégration)

→ Skill **`nodefony-start-server`** (`bash .claude/skills/nodefony-start-server/start.sh`) : rebuild
conditionnel de `src/modules/test`, kill ports 5151/5152, **spawn `detached`** (évite le SIGHUP qui tue
`npx nodefony development &`), attente boot + health check. Commandes standalone `nodefony status` /
`nodefony stop` (de partout). Diagnostic crash → skill **`nodefony-tail-error-logs`**.

> ⚠️ **Gotcha dist — cause #1 des 404 en test.** En `development`, Nodefony charge le `dist/` existant au
> boot PUIS recompile (rolldown) plus tard et l'écrase : une route ajoutée au source APRÈS le dernier
> build est **absente** jusqu'au prochain restart avec dist à jour. → **rebuilder `src/modules/test`
> (`npm run build`) avant de démarrer si le source a changé.** Diagnostic : **404** sur une route définie =
> dist périmé ; route trouvée mais **500** = erreur controller (stack dans les logs). ⚠️ Le DevSupervisor
> **redémarre sur édition de fichier** → ne pas éditer pendant un run intégration/load (ECONNREFUSED transitoire).

---

## Ce qu'il ne faut JAMAIS faire sans accord

- Modifier `rolldown.config.ts` ou `tsconfig.json`
- Changer les ports par défaut dans `config.ts`
- Remplacer `ws` par une autre lib WS
- Ajouter un default export (module utilise named exports)
- Importer `@nodefony/framework` depuis `@nodefony/http` (dépendance circulaire)
