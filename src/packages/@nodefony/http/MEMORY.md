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

## Config Zod — schema.ts source de vérité (2026-05-30)

`nodefony/config/{schema.ts, defineHttpConfig.ts, configMeta.ts, config.ts}` + interface `interfaces/IHttpConfig.ts`. Convention [[feedback_config_validation_zod]].

- **`config.ts` = `httpConfigSchema.parse({})`** (dérivé, plus de défauts à la main). **PAS de freeze** (≠ redis) : les services mutent `module.options` (`upload.uploadDir`, cert `serialNumber`).
- **Validation au boot** : `index.ts` `onKernelRegister` → `defineHttpConfig(this.options, this.kernel)` → **ré-assigne `this.options`** (sûr : `onRegister` AVANT instanciation `@services` à `onBoot`). Throw `[@nodefony/http] Invalid config: ...` si invalide.
- **strict (strip) vs loose (passthrough)** — décision clé : sections transmises à une **lib tierce** (`http`/`https`/`http2`/`websocket(s)`/`queryString`/`statics.*.options`) = **`z.looseObject`** (sinon Zod stripperait une option lib légitime — ex. `http.insecureHTTPParser`). Sections **notre code** (`securityHeaders`/`trustProxy`/`certificates`/`session`/`upload`) = **`z.object` strict** (strip = attrape les typos).
- **Schéma PUR** (pas de deref kernel/env) → `defineHttpConfig` injecte les défauts kernel APRÈS parse : `upload.uploadDir` vide ← `kernel.tmpDir` (sinon `/tmp`) ; `certificates.openssl.attrs` vide ← `commonName=kernel.domain`.
- **Piège Zod 4** : `.default(() => sub.parse({}))` par section (un `.default({})` plat ne ré-applique PAS les sous-défauts).
- **Métadonnées de champ** (`configMeta.ts` helper `meta()` typé `INodefonyFieldMeta`) : flags `reserved`/`runtimeMutable`/`kernelDerived`/`secret` écrits dans le global registry Zod → recopiés par `httpConfigJsonSchema()` (`z.toJSONSchema`) pour Studio/doc. Posés : `watch`+`http3`=reserved, `headerServer`=runtimeMutable, `uploadDir`+`openssl.attrs`=kernelDerived. ⚠️ poser le `.meta()` sur le **nœud final** présent dans `.shape` (sinon non lu : http3 a fallu wrapper le `.default()` racine).
- **Clés RETIRÉES** (mortes, 0 usage repo-wide, accord user) : `sockjs`, `requestClient`, `session.memcached`, `http2.enablePush`. `memcached` retiré de `dependencies` + rollup `external`. `zod` ajouté en peerDep + rollup `external`.
- **`statics.enabled`** (défaut true, `6f82669`) : `false` = serveur statique intégré OFF (0 montage config-driven `web`/`assets`, 0 listener) pour la prod cloud-native (nginx/CDN sert). server-static lit `enabled` PUIS le `delete` AVANT le `for...in` (sinon traité comme racine statique → `.path` sur booléen — même contrat que `defaultOptions`). Ne gate PAS les `addMount()` programmatiques (frontend prod Vite). ⚠️ Le `delete this.options.{enabled,defaultOptions}` EXIGE la config NON gelée (raison #1 du non-freeze).
- Tests : `tests/unit/httpConfig.test.ts` (25, vitest). Exports publics : `httpConfigSchema`, `defineHttpConfig`, `httpConfigJsonSchema`, `meta`, types `IHttpConfig`/`HttpConfig`.

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

## Certificates TLS — service + CLI (durci 2026-06-07)

`service/certificates.ts` = fourniture du cert HTTPS/WSS. **Génération = DEV** (mkcert>auto-signé) ;
**prod = `explicit`** (cert fourni, sinon WARNING fort — Nodefony ≠ CA de prod). `node-forge` chargé
**lazy** (`loadForge`, `await import`) → JAMAIS importé en prod avec cert explicite.

- **Stratégies** (`certificates.strategy`) : `auto` (défaut : mkcert si dispo en dev → CA trustée HMR,
  sinon `selfsigned`) | `mkcert` | `selfsigned` | `explicit` (`key`/`cert`/`ca` fournis).
- **Conformité auto-signé** : SHA-256 (jamais SHA-1 — node-forge `sign()` SANS digest = SHA-1 par
  défaut, piège), serial **`crypto.randomBytes(16)`** 128 bits (RFC 5280 §4.1.2.2, ≠ `01` fixe),
  privkey **0600** + dossier 0700, `notBefore` backdaté (`backdateMinutes`), **SKI** (RFC 5280 §4.2.1.2),
  SAN = vérité d'hôte (RFC 6125 ; CN ignoré). IP littérale → `iPAddress` jamais `dNSName`.
- **SAN** : `certificates.san {dns,ip}` ; vide = dérivé kernel (`localhost`+`domain`, `0.0.0.0` exclu).
  Banc reverse-proxy : `nodefony.config.ts` met `nodefony.com` quand `NF_BIND_ALL`.
- **Reload** : `isCertAdequate` régénère si expiré / SHA-1 / SAN incomplet.
- **Déclenchement** : auto au boot (`init`→`onBoot`→`generateServerCertificates`, idempotent) **+**
  commande CLI. `generateServerCertificates()` appelle `setFiles()` en tête (auto-suffisant).
- **`describe()`** : résumé introspectable (CLI + futur endpoint Studio, source unique).
- ⚠️ `extend(true, {}, defaultOptions, …)` (cible `{}`) — sinon mute la constante partagée.

### Commande CLI

`nodefony certificates [--force] [--json]` (`command/certificatesCommand.ts`, `kernelEvent:"onBoot"`

- `lifetime:oneshot` → ne démarre pas les serveurs) : (re)génère + imprime `describe()`. Réutilise le
  service enregistré (`getModules().http.get("certificates")`). PKI complète offline (root+intermediate+
  client) = `bin/generateCertificates.sh` (`npm run certificates`), outil avancé hors service.

`nodefony proxy:generate <nginx|haproxy> [-o file] [-b host] [-l port] [--reencrypt]`
(`command/proxyGenerateCommand.ts` + générateurs PURS `src/proxy/generateProxyConfig.ts`) : DÉRIVE la
conf reverse-proxy de l'introspection (domaines=`trustedHosts` sans IP, ports `servers.{http,https}`,
statiques = `server-static.servers` racines + `.mounts` préfixés, trustProxy). **nginx** résout le
**trou statiques multi-modules** : N `public/` servis à `/` → **chaîne `try_files`** via locations
nommées (`root d0`→`@r1`→…→`@nodefony`), fallback backend ; mounts préfixés → `location { alias }`.
**haproxy** = proxy + Forwarded RFC 7239 (ne sert pas de fichiers) ; `--reencrypt` = backend HTTPS
`verify required`+`verifyhost`+`sni`. Edge écrase XFF (`$remote_addr`). Tests : `generateProxyConfig.test.ts` (12).
⚠️ `proxy:generate` boote à `kernelEvent: onReady` (mounts natifs posés à onReady) + appelle `staticSvc.mountModulePublics()` (idempotent, anti-race ordre listeners) ; kernel console = modules PROD (pas `policy:"dev"` → pas de `/test/` en prod = correct).

## Préfixe natif statique `/<module>/` (server-static `mountModulePublics`)

À `onReady`, `server-static` auto-monte le `public/` de chaque module sous `/<basename(nom)>/` via `addMount` (`@nodefony/test`→`/test/`). **Skip** : app root (`isApp` → `./public` à `/` via `statics.web`, ex. favicon) ; modules frontend-managed (présents dans `frontend.listEntries()` → servis `/_assets/<name>/`, studio inclus) ; modules sans `public/` (http/framework/security skippés naturellement). Enregistré dans `.mounts` quel que soit `enabled` → introspectable par proxy:generate même statics OFF. `addMount` idempotent (remplace par préfixe). Fichiers à la RACINE de `public/` (pas de sous-dossier nom-de-module sinon `/test/test/`).
**Config par module** `module.options.publicMount` (même pattern que `watch` — option top-level lue dans `mod.options`) : `false` = opt-out · `{ publicPath?, dir? }` = override (l'explicite PRIME sur le skip frontend) · absent = auto (`publicPath=/<basename>/`, `dir="public"`). `publicPath` = sémantique frontend.publicPath ; `dir` = dossier SOURCE (analogue entrée du `outDir` frontend). Validé runtime : override `{publicPath:"/medias"}` → `/medias/*` 200, `/test/*` 404.

## Commande `assets:publish` (CDN-ready tree, provider-agnostic)

`nodefony assets:publish [-o dir] [--clean] [--json]` (`command/assetsPublishCommand.ts`, planner PUR `src/assets/collectAssets.ts`, `kernelEvent:onReady`). Assemble TOUS les assets servables dans UN arbre `dist-assets/` miroir des préfixes + `manifest.json`. Sources = `server-static.mounts` (publics natifs, après `mountModulePublics()`) + `frontend.listEntries()` (`publicPath`→`outDir` buildé). `planAssetPublish(sources,outDir)` : dédup par préfixe (dernier gagne), `/x/y/`→`outDir/x/y`, `/`→outDir. **Nodefony ASSEMBLE, l'orchestrateur PUBLIE** (`aws s3 sync`/rsync/CI) — 0 dep cloud. Combine avec `frontend.assetBaseUrl` (URLs émises → CDN). Kernel console = modules PROD (dev-only absents = correct). Tests : `collectAssets.test.ts` (4). Validé : studio `/_assets/studio/` 127 fichiers + manifest.

## Servers

| Service                 | Port | Type                        |
| ----------------------- | ---- | --------------------------- |
| server-http             | 5151 | http                        |
| server-https            | 5152 | https + HTTP/2 (allowHTTP1) |
| server-websocket        | 5151 | ws sur http                 |
| server-websocket-secure | 5152 | wss sur https               |
| server-static           | —    | serve-static                |

**Arrêt gracieux WS (2026-06-05)** : `terminate()` envoie le message applicatif `{nodefony:{state:shutDown}}` PUIS `client.close(1001,"Server shutting down")` (frame Close RFC 6455 §7.4.1 "Going Away") AVANT `server.close()`. Sans le `client.close(1001)`, couper la socket TCP fait voir **1006** au client (Abnormal Closure, réservé, jamais émis sur le fil) → indistinguable d'une coupure réseau. 1001 = reconnexion normale côté client (cf realtime close codes). Idem `server-websocket-secure`.

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

## Streaming backpressure (P2.8) + trace verbose (P3.7) — 2026-06-05

- **Backpressure** `Response.send` : `ServerResponse.write()===false` (buffer > highWaterMark) → resolve sur `once("drain")`, pas avant (contrat Node `stream.Writable`). `flush()` chunké (RFC 9112 §7.1) → producteur freiné, RAM bornée si client lent ; `ok===true` → resolve immédiat. Listener `drain` attaché QUE sous pression (`once` + `removeListener` si erreur d'écriture). Content-Length ⊥ Transfer-Encoding (RFC 9112 §6.1) déjà géré par `setLength` (skip si chunked).
- **Trace verbose** `Context.logPhasesVerbose()` (teardown, après `logRequest`) : log DEBUG `TRACE phases [Σ Xms] parse=… · action=…`. Opt-in `kernel.options.timing.verbose` → triple gate (`_timingVerbose` résolu 1× au ctor → `_timingEnabled` → `phases.length>0`) ; **0 stringify/alloc hors verbose** (perf-first, gratuit prod). Tests unit : `Backpressure.test.ts`, `PhasesVerbose.test.ts`.
- **`@Body({ stream })` (P2.9)** : `route-match` HISSÉ avant le parse dans `handleHttp` (pur — method+URL). Si l'action déclare `@Body({stream:true})` (flag `route.bodyStream` memoïsé côté framework par `routeExpectsBodyStream`, lu par http via simple booléen — **pas** d'import framework, cycle interdit), le parse busboy/JSON est **sauté** → le param reçoit le `Readable` brut (`request.request`). `handleFrontController` réutilise `context.resolver` (0 double match). A/B même-machine : **0 régression RPS** (plages chevauchées) ; gain mémoire O(chunk) vs O(taille). Isolé HTTP (WS ne parse aucun body). Ordre hooks P6 inchangé. Tests : `BodyStream.test.ts` (framework) + `integration/bodyStream.test.ts` (HTTP/1+2, 1 Mo, vide, non-régression `@Body()`).

## Router-first — static en fallback (façon Express) — 2026-06-05

- **Avant** : `onHttpRequest` tentait `serverStatic.handle()` AVANT le routing (static-first) → chaque requête API payait le `fs.stat`/`path.normalize` de serve-static pour rien (≈836 ticks profilés). **Après** : static tenté en **FALLBACK** dans `handleHttp`, APRÈS un route-match raté (`resolver?.resolve !== true && !resolver?.exception`) → une requête qui matche une route ne touche plus le disque. **+28 % RPS** (mono prod 4805→6167, ≈ bypass total → le fallback ne coûte rien aux routes).
- `serverStatic.handle()` reste **PENDING** si un fichier est servi (court-circuit ; `response.end`→`onFinish`→teardown déjà wiré par `createHttpContext`) ; **RESOLVE** si aucun fichier → pipeline → 404. Teardown (logRequest/leaveScope) via l'event `finish` → OK même quand le static court-circuite.
- ⚠️ Avant `serverStatic.handle` en fallback : `response.removeHeader("Content-Type")` — le Context a posé le défaut `application/octet-stream` (`Response.ts:37`) que serve-static (`send`) **n'écrase pas** s'il existe → sinon favicon/webm en octet-stream. Validé : `static.test`, intégration 405, memory 9/9.
- Hooks pipeline (`onServerRequest`/`onCreateContext`/`beforeResolve`/`afterAuth`/`onFinish`) guardés `if (listenerCount(e))` — `fireAsync` est async → `await` crée 1 Promise+microtask même à 0 listener ; 0 hook sans @nodefony/security. Gain RPS non mesurable (microtasks trop légères) mais cohérent perf-first.

## Profiler — dev-only (2026-05-21)

- `src/profiler/Profiler.ts` : ring buffer `Map<requestId, ProfileEntry>` (cap 500, éviction insertion-order), `collect(ctx)` = snapshot fin de requête (phases/route/controller/user/traceparent/status + **queries ORM**), `get`/`recent`/`clear`. **Borné** (pas de fuite, validé).
- **Seam ORM `queries` BRANCHÉ (2026-05-21)** : `handleHttp` alloue `context.profilerQueries = this.profiler ? [] : null` (**dev-only, 0 alloc prod**) et passe la **même réf** dans la payload ALS (clé `queries`). Les adapters ORM y poussent via `RequestContext.pushQuery()` ; `collect` lit `ctx.profilerQueries` au teardown (teardown est **hors bulle ALS** → on lit la réf sur le context, jamais `RequestContext.get()`). `queries` reste `undefined` si vide (contrat preserved). WS : pas encore collecté (teardown HTTP only). Tests Profiler +2.
- Hook : `http-kernel` teardown (`this.profiler?.collect(ctx)` avant `clean()`), résolu container `"profiler"` à onReady, **null en prod** (module l'instancie dev-only dans `index.ts` onKernelBoot → `environment !== "production"`). ⚠️ **Bug corrigé 2026-06-05** : comparait `"prod"` — valeur INEXISTANTE (`setEnv` normalise en `"development"`/`"production"`/`"test"`) → `"production" !== "prod"` toujours vrai → Profiler (+ timing `Context.ts`, pretty-logger) tournait **EN PROD** : perf (JS pipeline 24.5→18.5 %) **+ sécu** (`/nodefony/profiler/api/*` exposé = fuite d'info). **Règle : comparer `"production"`, jamais `"prod"`** (cf `request-logger.ts`, `Context._timingEnabled`).
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

### Audit sampling — L3 perf (2026-05-30)

- Opt-in `log.requestLogger.sampleRate` (défaut `1` = tout loguer). `N>1` = 1 req 2xx/3xx sur N, **toujours** ≥400 + erreurs.
- Gate = `JsonAuditLogger.shouldSample(ctx, err)` (méthode optionnelle de `IRequestLogger`), appelée par `Context.logRequest()` **AVANT** `renderHttp` → skip = 0 objet/0 `JSON.stringify`.
- Compteur **déterministe** modulo (pas de RNG — cohérent L2) ; les ≥400/erreurs n'avancent PAS le compteur (cadence 2xx stable). Clamp `<1`/NaN→1.
- Câblé via `applyRequestLoggerFromConfig` (passe `sampleRate` à `JsonAuditLoggerOptions`). Pretty/Default loggers = pas de `shouldSample` ⇒ toujours loguer.
- Micro-bench dist : `renderHttp` ~1365 ns/req vs `shouldSample` ~10 ns ; sampleRate=20 → poste audit 1365→78 ns/req (-94%). Défaut **iso-perf**. +7 tests sampling.

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

**Pipeline = async plates, JAMAIS `new Promise(async executor)`** (L4, 2026-05-30) : `handle`/`handleFrontController`/`handleHttp`/`onRequestEnd` sont des `async function` plates (`throw`/`return` directs, `try/catch`). NE PAS réintroduire `return new Promise(async (resolve,reject)=>…)` : une fn async retourne déjà une Promise → wrapper = 2ᵉ Promise + microtasks + closures/req, et les `throw` hors `resolve/reject` sont **avalés** (la Promise externe reste pending à jamais). `RequestContext.run<T>(payload, fn)` **propage** le retour de `fn` → `return await RequestContext.run(...)`. Seul `.catch` volontaire conservé = `onAuthFailure` (log + avale pour ne pas masquer `authError`).

**Binary WS** : `context?.send(buf, "binary")` server-side ; `ws.send(Buffer)` client-side. Envois séquentiels : utiliser `wsCollectBinary(ws, n)` côté test (collect all then assert) — pattern `await` frame par frame timeout.

**Broadcast** : `context.broadcast(str)` → `wss.clients.forEach(send)` — inclut l'émetteur.

**url.parse interdit** : remplacé par `new URL(str, "http://localhost")` — `url.parse()` deprecated Node.js v22+.

**onConnection** dans http-kernel : `catch` silencieux — erreurs WS avalées, vérifier logs DEBUG.

**Activation session (refonte 2026-06-07, plug runtime)** : plus de `startSession()`. Une session s'ouvre via l'**intent** déclaré `@UseSession({context?,readOnly?,eager?})` (framework, classe/méthode) **OU** un paramètre `@Session` **OU** un cookie de session existant (reprise L1). Point d'activation UNIQUE `HttpKernel.startSession(context)` (HTTP **et** WS, symétrique), lit `context.sessionIntent` (posé par le Resolver). Lazy : 0 session/0 write sinon (fin du `sessionAutoStart` global = le ×23). `Session.readOnly` → `save()` no-op. `cookie.hostPrefix` (`auto`|`true`|`false`) → préfixe `__Host-` sur scheme **effectif** (TLS, honore X-Forwarded-Proto si trustProxy). Cookie nommé via `Context.getSessionCookieName()` (lecture=écriture). `regenerateId()` = seam P6 (anti-fixation). `absolute_timeout` (OWASP) en + de l'idle.

**Session storage = IoC** : `SessionsService` tient un **registre statique** (`registerStorage/getStorage/storageHandlers`) ; http n'importe AUCUN ORM. Chaque backend s'auto-enregistre au chargement (`files` par http ; `drizzle`/`sequelize`/`mongoose` par leur module). Sélection via config `session.handler` (casse-insensible). Events kernel `onRegisterSessionStorage` / `onSessionStorageReady`. Défaut reco = `drizzle`. Guide : [[guide session-storage]] (`docs/guides/session-storage.md`). ⚠️ appeler `registerStorage` rend l'import http VALEUR → externaliser `@nodefony/http` dans le rollup du module fournisseur.

**HTTP/2 write-after-end** : sur réponse lente, le client abandonne / le stream se ferme → `stream.respond()`/`write()` sur stream détruit = `ERR_HTTP2_INVALID_STREAM` + `ERR_STREAM_WRITE_AFTER_END` (CRITIC). Fix : gardes `stream.destroyed/closed/writable` dans `Http2Response.writeHead/send/end` → skip DEBUG. (Relève de P2.3 aborted-requests.)

**Fichiers test** : chaque `.ts` dans `nodefony/tests/` doit commencer par `/// <reference types="node" />`.

## Tests — vitest 100% (mocha SUPPRIMÉ 2026-06-05) — 337 unit / 400 intég / 9 gate

Runner unique = **Vitest 4**, 3 suites = 3 configs (séquentielles pour intég+load) :

- `npm test` = `vitest.config.ts` → `tests/unit/**` = **337** (composants purs, pas de serveur).
- `npm run test:integration` = `vitest.integration.config.ts` → `tests/{http,integration,routing,websockets}/**` = **400 +1 skipped** (serveur 5151/5152 requis). Plus de double-exécution unit (mocha parti).
- `npm run test:load` = `vitest.load.config.ts` → `tests/load/**` + `memory.test.ts` (charge/heap/leak/scopes).
- `npm run test:memory` = idem filtré sur `memory.test.ts` = **9** (le GATE).

```
unit/      : Cookie, Session, HttpError, Response, parser, trace, … (20 fichiers) — 337
http/ + integration/ + routing/ + websockets/  (42 fichiers)        — 400 (+1 skipped)
load/ + http/memory.test.ts  → npm run test:load (séquentiel)
```

`memory.test.ts` (gate, `vitest.load.config.ts`) — 9 tests ; deltas heap GC-noisy → mesurer sur **serveur frais** (pas de `--expose-gc`). `ws-messages-load > sustained < 30 MB` = **pré-existant rouge** (~120-160 MB, identique sous mocha avant migration, ≠ leak).

Configs vitest : `vitest.config.ts` (unit) / `vitest.integration.config.ts` / `vitest.load.config.ts` ; setup `vitest.setup.ts` (reflect + before/after). `fileParallelism:false` (serveur partagé). `import "mocha"` strippé partout, shim+fix-reflect+`.mocharc.*` supprimés.

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

## Domain matching (Host) — 2 étages (cf `src/context/domainMatcher.ts`)

- **`trustedHosts` (kernel, sécu AVANT routing)** : barrière Host anti-injection. Config Zod
  `http.trustedHosts` : `false`=domaine canonique + loopback (dev) · `true`=bypass (proxy
  cloud-native) · `string|string[]`=vhosts add. `compileTrustedHosts()` → `regAlias` ;
  `isValidDomain()`/`checkValidDomain()` → 401 si Host non trusté. Loopback dev =
  `localhost`/`127.0.0.1`/`[::1]` (IPv6 sérialisé canonique `[::1]` — WHATWG URL).
- **`domainAlias` SUPPRIMÉ** (ex-liste vhosts fine kernel) → remplacé par `trustedHosts`. La
  liste des vhosts SERVIS = `@Domain` côté framework (source unique), pas le kernel.
- **Politique de pattern UNIQUE** (partagée avec `@Domain`) : string exact ancré (`.` littéral) /
  `*` wildcard un-label (RFC 6125) / `RegExp` libre. ReDoS-safe (`[^.]+`, ancré). ~40 ns/req, 0 alloc.
- Exports publics : `compileDomainPattern(s)`, `compileTrustedHosts`, `isDomainAllowed`, types
  `DomainPattern`/`TrustedHostsConfig` (réutilisés par `@nodefony/framework`).
