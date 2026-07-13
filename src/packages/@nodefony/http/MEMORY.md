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

## Ports — repli automatique (`servers.portPolicy`)

- **Les ports NE sont PAS dans le Zod de ce module** : ils vivent dans la config d'APP (core `config/schema.ts` → `servers.http.port` 5151 / `servers.https.port` 5152, défauts `config/defaults.ts`). Ce module ne fait que les LIRE (`kernel.options.servers`).
- **`servers.portPolicy: "auto" | "strict"`** — que faire si le port désiré est occupé. Défaut **`auto` en `development`**, **`strict` en `production` ET `test`** (`resolvePortPolicy`). Prod : le port est un CONTRAT (service k8s/ingress/sonde) → glisser en silence = pod « sain » injoignable. Test : un port pris = un serveur resté debout → le banc doit s'arrêter, pas viser le serveur du voisin. `servers.portRetryAttempts` (défaut 20) borne le repli.
- **`src/servers/portBinder.ts`** = source unique. `bindWithFallback(server, host, plan)` retente **au `listen()`** sur `EADDRINUSE` — **jamais de sonde préalable** (« le port est-il libre ? » puis binder = course TOCTOU ; le listen est atomique). `buildBindPlan(which, servers, env)` compose le plan et **réserve le port de l'AUTRE serveur** (sinon HTTP, chassé de 5151, volerait 5152 à HTTPS). Deux serveurs qui se disputent le même départ se démêlent seuls (le bind atomique arbitre).
- ⚠️ **Le handler `error` DURABLE se pose APRÈS le bind** (`attachErrorHandler`) : attaché avant, il voyait passer les `EADDRINUSE` de repli et terminait le kernel en croyant à une panne. `reportBindError` garde le contrat FATAL (log CRITIC + `terminate(1)`) quand le bind échoue pour de bon.
- **Tout décalage est ANNONCÉ** (WARNING `Port X déjà occupé → écoute sur Y`) — pas de dégradation silencieuse.
- **Publication des ports effectifs** : `initServers()` → `publishRuntimePorts()` → `writeRuntimeState()` (core) → `node_modules/.cache/nodefony/runtime.json`. **Dev/test seulement** (en prod le port ne glisse pas, et l'image peut être en lecture seule). C'est le canal SANS lequel `status`/`stop`/readiness `--detach` resteraient aveugles (ils sondaient `[5151,5152]` en dur). Cf core `devProcess.ts`.
- Les serveurs **WS n'ont pas de port propre** (adossés à http/https) et relisent `server.address()` → ils suivent le repli sans rien faire.
- Banc : `tests/unit/portBinder.test.ts` (22, sur de VRAIES sockets — un mock de `listen` ne prouverait rien du comportement du noyau).

## Config Zod — config.ts source de vérité

`nodefony/config/{config.ts, defineModuleConfig.ts}` + interface `interfaces/IHttpConfig.ts`. Convention [[feedback_config_validation_zod]].

- **`config.ts` = `httpConfigSchema.parse({})`** (dérivé, plus de défauts à la main). **PAS de freeze** (≠ redis) : les services mutent `module.options` (`upload.uploadDir`, cert `serialNumber`).
- **Validation au boot** : `index.ts` `onKernelRegister` → `defineHttpConfig(this.options, this.kernel)` → **ré-assigne `this.options`** (sûr : `onRegister` AVANT instanciation `@services` à `onBoot`). Throw `[@nodefony/http] Invalid config: ...` si invalide.
- **strict (strip) vs loose (passthrough)** — décision clé : sections transmises à une **lib tierce** (`http`/`https`/`http2`/`websocket(s)`/`queryString`/`statics.*.options`) = **`z.looseObject`** (sinon Zod stripperait une option lib légitime — ex. `http.insecureHTTPParser`). Sections **notre code** (`securityHeaders`/`trustProxy`/`certificates`/`session`/`upload`) = **`z.object` strict** (strip = attrape les typos).
- **Schéma PUR** (pas de deref kernel/env) → `defineHttpConfig` injecte les défauts kernel APRÈS parse : `upload.uploadDir` vide ← `kernel.tmpDir` (sinon `/tmp`) ; `certificates.openssl.attrs` vide ← `commonName=kernel.domain`.
- **Piège Zod 4** : `.default(() => sub.parse({}))` par section (un `.default({})` plat ne ré-applique PAS les sous-défauts).
- **Métadonnées de champ** (`.meta()` NATIF zod, typé `IConfigFieldMeta` du core via augmentation `GlobalMeta`) : flags `reserved`/`runtimeMutable`/`kernelDerived`/`secret` écrits dans le global registry Zod → recopiés par `httpConfigJsonSchema()` (`z.toJSONSchema`) pour Studio/doc. Posés : `http3`=reserved, `headerServer`=runtimeMutable, `uploadDir`+`openssl.attrs`=kernelDerived. ⚠️ poser le `.meta()` sur le **nœud final** présent dans `.shape` (sinon non lu : http3 a fallu wrapper le `.default()` racine).
- **Clés RETIRÉES** (mortes, 0 usage repo-wide, accord user) : `sockjs`, `requestClient`, `session.memcached`, `http2.enablePush`. `memcached` retiré de `dependencies` + rolldown `external`. `zod` ajouté en peerDep + rolldown `external`.
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

## Certificates TLS — service + CLI

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
**Config par module** `module.options.publicMount` (option top-level lue dans `mod.options`) : `false` = opt-out · `{ publicPath?, dir? }` = override (l'explicite PRIME sur le skip frontend) · absent = auto (`publicPath=/<basename>/`, `dir="public"`). `publicPath` = sémantique frontend.publicPath ; `dir` = dossier SOURCE (analogue entrée du `outDir` frontend). Validé runtime : override `{publicPath:"/medias"}` → `/medias/*` 200, `/test/*` 404.

## Livraison d'UI embarquée — `src/assets/prebuiltUi.ts` (pattern « module tiers avec UI »)

`resolveUiDelivery({requested, environment, hasFrontendService, sourcesDir, distIndex})` → `{mode, reason}`. Molette `ui: auto|static|vite` (config du module UI). `auto` = vite SI (dev + service frontend + sources), sinon static SI `dist/frontend/index.html` présent, sinon `none` (fail-loud, `reason` loggable). JAMAIS vite en prod. `PrebuiltUi({publicPath, distDir})` : `.mount(container, kernel?)` = `server-static.addMount` par nom (retry `onReady` si service absent) ; `.renderIndex(nonce?)` = index.html Vite pré-buildé (lu 1× lazy, nonce injecté par `replaceAll("<script")`, miss non caché). Le consommateur npm ne compile JAMAIS l'UI d'un module distribué (pattern bull-board) : build au publish (`vite build` app-mode, `base` = publicPath), shippé dans `dist/frontend/`. SPA fallback = controller du module (routes littérales). 1er consommateur : `@nodefony/studio` (`index.ts` onKernelBoot + `StudioController.renderStudio`). Tests : `unit/prebuiltUi.test.ts` (11).

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

**Arrêt gracieux WS** : `terminate()` envoie le message applicatif `{nodefony:{state:shutDown}}` PUIS `client.close(1001,"Server shutting down")` (frame Close RFC 6455 §7.4.1 "Going Away") AVANT `server.close()`. Sans le `client.close(1001)`, couper la socket TCP fait voir **1006** au client (Abnormal Closure, réservé, jamais émis sur le fil) → indistinguable d'une coupure réseau. 1001 = reconnexion normale côté client (cf realtime close codes). Idem `server-websocket-secure`.

**Arrêt gracieux HTTP/HTTPS/H2 (drain SIGTERM)** : les 3 chemins (`server-http`, `server-https` H1 et H2) drainent via `http-terminator` (`serverShutdown.ts` → `createDrainTerminator`) : requêtes in-flight terminées (`connection: close` injecté), sockets idle fermées, destroy forcé après `servers.*.shutdownTimeout` ms (Zod, défaut 5000 — garder < grace period orchestrateur : 30 s k8s, 10 s Docker). Le terminator `close()` le serveur lui-même — ne PAS rappeler `server.close()` derrière. ⚠️ JAMAIS `closeAllConnections()` au shutdown (coupe les requêtes en cours = requêtes perdues à chaque rolling update). **Ordre garanti** : WS/WSS s'attachent à `onTerminate` en `prependOnceListener` (close 1001 des clients) AVANT le drain HTTP (`once`) — sinon le terminator détruirait les sockets upgradées sans frame Close (1006). ⚠️ Dans `ws/wss.terminate()`, la résolution appartient au `setTimeout(300)` (`return;` après l'armer) : un `resolve()` immédiat ferait démarrer le drain HTTP sans attendre → la séquence complète post-SIGTERM = bascule readiness (prepend http-kernel, posé à `onPostReady` donc 1ᵉʳ exécuté) → fenêtre ~600 ms (2×300 ms WS, listener HTTP encore ouvert : trafic servi + readyz 503) → drain → exit 0. Preuve e2e versionnée : `run.sh graceful` (readyz 503 + in-flight 200 + WS 1001 + port libéré).

**Probes santé `/livez` + `/readyz` (config `health`, défaut on)** : court-circuit TOTAL dans `HttpKernel.onHttpRequest` — AVANT le rate-limit (un kubelet throttlé 429 = cascade de restarts), 0 contexte/session/ALS/log par sonde, réponses pré-allouées (`HEALTH_BODY_*`), match STRICT de `request.url` (avec query → pipeline normal). `livez` = 200 tant que le process sert, Y COMPRIS pendant le drain (sinon k8s tue le pod en plein graceful). `readyz` = 200 si `kernel.postReady && !#terminating` ; 503 pendant boot et dès SIGTERM. `health.shutdownDelay` (défaut 0) = délai additionnel entre la bascule 503 et le drain (propagation LB ; alternative : `preStop: sleep N` k8s). Chemins servis par HTTP ET HTTPS (kubelet `scheme: HTTPS` ok).

## Multi-process / scaling (post-PM2)

- Serveurs bind via `server.listen(this.port, this.domain, cb)` **positionnel** (`server-http.ts:97`, `server-https.ts:120/237`).
- **Scaling horizontal** (PM2 déprécié, [[project_pm2_deprecation]]) :
  - **Prod** : N pods + LB orchestrateur (k8s/Swarm/Cloud Run). 1 process = 1 pod.
  - **Single host** : **`SO_REUSEPORT`** (Node 23.1+, repo Node 26) → passer `listen({ port, host, reusePort: true })` → N process Node sur le MÊME port, kernel OS répartit. Remplace PM2-cluster. Feature cible Phase 16 : `nodefony <env> --workers N` (fork Kernel + reusePort). Alt : `node:cluster`.
  - **Test local** : N instances/N ports + round-robin client (zéro code).
- **Viable** car HTTP full stateless JWT ([[project_security_stateless_http_decision]]) → pas de session RAM à partager, pas de sticky.
- ⚠️ **Cross-process** : `broadcast()` (`wss.clients.forEach`) et le pub/sub realtime ne touchent que les clients du MÊME worker → fan-out cross-process = **Redis pub/sub (Phase 13** [[project_phase13_realtime_redis_client]]). Idem stats Studio (per-instance). Détails : [[project_multiprocess_scaling]].
- Mesure stress : Node mono-thread sature ~1 cœur ≈ 400 req/s sur loopback, dégradation gracieuse (1600 conns concurrentes, 0,04 % err, 0 crash).

## Request Tracing — requestId

- `Context.requestId = randomUUID()` — UUID v4 généré à construction (base class)
- `HttpContext` constructor : if `request.headers["x-request-id"]` → override requestId
- `WebsocketContext` constructor : if `req.headers["x-request-id"]` → override requestId
- `Response.writeHead()` : `response.setHeader("x-request-id", context.requestId)` avant write
- `Context.logRequest()` : affiche `ID : <uuid>` dans chaque log de fin de requête
- `Context.setMetaData()` : inclut `requestId` dans `metaData.nodefony`
- `IContext.requestId: string` — exporté dans `nodefony/interfaces/IContext.ts`
- **wsId = `requestId` du `WebsocketContext`** : pas de champ distinct (alloc 0). Stable sur toute la socket (ctor → ALS → handshake/messages/close) → corrèle les events d'une même connexion WS. Présent dans les **3 logs de cycle de vie WS** : handshake (`renderWebsocket` → `ID : <uuid>`), `onClose`, `onConnectionError`. **Per-message NON loggé** (bruit + hot path 33-38k msg/s) — extensible via logger custom opt-in si besoin debug.
- **`WebsocketContext.send()` — capture de rendu pont** : si `RequestContext.get()?.renderSink` présent (posé par le pont `api.request`, per-invocation), le payload est CAPTURÉ dans le sink et rien n'est émis (pas de frame nue hors protocole JSON-RPC, pas de `fire`). Hors pont : 1 lecture ALS par frame sortante (~30 ns, négligeable devant les 2 `fire()`). Cf realtime MEMORY (pont — action rendue).
- ⚠️ **HTTP/2 GOTCHA** : `http2/Response.writeHead` chemin `stream.respond()` **bypasse** `super.writeHead` → pose `x-request-id` + `traceparent` ICI aussi. Sinon réponses HTTP/2 (port 5152, dont Studio) **sans header** → corrélation profiler/debug bar impossible (symptôme : clic requête = « no requestId »).

## Streaming backpressure + trace verbose

- **Backpressure** `Response.send` : `ServerResponse.write()===false` (buffer > highWaterMark) → resolve sur `once("drain")`, pas avant (contrat Node `stream.Writable`). `flush()` chunké (RFC 9112 §7.1) → producteur freiné, RAM bornée si client lent ; `ok===true` → resolve immédiat. Listener `drain` attaché QUE sous pression (`once` + `removeListener` si erreur d'écriture). Content-Length ⊥ Transfer-Encoding (RFC 9112 §6.1) déjà géré par `setLength` (skip si chunked).
- **Trace verbose** `Context.logPhasesVerbose()` (teardown, après `logRequest`) : log DEBUG `TRACE phases [Σ Xms] parse=… · action=…`. Opt-in `kernel.options.timing.verbose` → triple gate (`_timingVerbose` résolu 1× au ctor → `_timingEnabled` → `phases.length>0`) ; **0 stringify/alloc hors verbose** (perf-first, gratuit prod). Tests unit : `Backpressure.test.ts`, `PhasesVerbose.test.ts`.
- **`@Body({ stream })` (P2.9)** : `route-match` HISSÉ avant le parse dans `handleHttp` (pur — method+URL). Si l'action déclare `@Body({stream:true})` (flag `route.bodyStream` memoïsé côté framework par `routeExpectsBodyStream`, lu par http via simple booléen — **pas** d'import framework, cycle interdit), le parse busboy/JSON est **sauté** → le param reçoit le `Readable` brut (`request.request`). `handleFrontController` réutilise `context.resolver` (0 double match). A/B même-machine : **0 régression RPS** (plages chevauchées) ; gain mémoire O(chunk) vs O(taille). Isolé HTTP (WS ne parse aucun body). Ordre hooks P6 inchangé. Tests : `BodyStream.test.ts` (framework) + `integration/bodyStream.test.ts` (HTTP/1+2, 1 Mo, vide, non-régression `@Body()`).

## Router-first — static en fallback (façon Express)

- **Avant** : `onHttpRequest` tentait `serverStatic.handle()` AVANT le routing (static-first) → chaque requête API payait le `fs.stat`/`path.normalize` de serve-static pour rien (≈836 ticks profilés). **Après** : static tenté en **FALLBACK** dans `handleHttp`, APRÈS un route-match raté (`resolver?.resolve !== true && !resolver?.exception`) → une requête qui matche une route ne touche plus le disque. **+28 % RPS** (mono prod 4805→6167, ≈ bypass total → le fallback ne coûte rien aux routes).
- `serverStatic.handle()` reste **PENDING** si un fichier est servi (court-circuit ; `response.end`→`onFinish`→teardown déjà wiré par `createHttpContext`) ; **RESOLVE** si aucun fichier → pipeline → 404. Teardown (logRequest/leaveScope) via l'event `finish` → OK même quand le static court-circuite.
- ⚠️ Avant `serverStatic.handle` en fallback : `response.removeHeader("Content-Type")` — le Context a posé le défaut `application/octet-stream` (`Response.ts:37`) que serve-static (`send`) **n'écrase pas** s'il existe → sinon favicon/webm en octet-stream. Validé : `static.test`, intégration 405, memory 9/9.
- Hooks pipeline (`onServerRequest`/`onCreateContext`/`beforeResolve`/`afterAuth`/`onFinish`) guardés `if (listenerCount(e))` — `fireAsync` est async → `await` crée 1 Promise+microtask même à 0 listener ; 0 hook sans @nodefony/security. Gain RPS non mesurable (microtasks trop légères) mais cohérent perf-first.

## Rate-limit général par IP (P0.3)

Plafond de trafic **par IP** sur TOUTES les routes HTTP — **≠ `security.rateLimit`** (backoff de LOGIN NIST par identifiant saisi). Store `src/rateLimit/{IRateLimitStore,MemoryRateLimitStore}.ts` + config `http.rateLimit` (config.ts) + check dans `HttpKernel.onHttpRequest`.

- **`MemoryRateLimitStore`** : fenêtre FIXE par IP (`{count, resetAt}`), O(1)/req (1 `Map.get` + arithmétique). `Map` **lazy `null`** (0 coût si jamais sollicité) ; à l'expiration, reset **en place** (0 alloc pour une IP récurrente). Mémoire bornée `maxTracked` (purge des fenêtres expirées → éviction **FIFO**) + `gc(now)` planifiable. Horloge `now` injectable (tests déterministes). `trackedCount`/`rejectedTotal` = introspection. Contrat `IRateLimitStore` **SYNC** (hot-path → 0 microtask ; un store Redis distribué introduira son PROPRE chemin, pas ce contrat). Verdict `RateLimitVerdict {limited, limit, remaining, resetAtMs, retryAfterS}`.
- **Config `http.rateLimit`** (Zod strict) : `enabled`(**false**, opt-in)/`windowS`(60)/`max`(300)/`maxTracked`(100k)/`gcIntervalS`(300)/`gcJitter`(true). `enabled`/`windowS`/`max` = `runtimeMutable`. Défaut OFF = cloud-native délègue souvent à l'ingress/gateway + coût hot-path non imposé sans opt-in. `use("@nodefony/http", {rateLimit})` typé (augmentation `NodefonyModuleConfig` ajoutée à `index.ts`, absente avant).
- **Check `onHttpRequest`** (AVANT `handle()`) : `if (rateLimiter !== null)` → **lazy null = 0 coût quand désactivé**. Rejet **AVANT** l'alloc du context/scope DI/ALS (un flood = 1 lookup Map). IP = `resolveForwarded(headers, socket.remoteAddress, trustProxyChecker).clientIp` = **même résolution que audit/logs** (forwarded-aware RFC 7239 + XFF ; **non spoofable tant que `trustProxy=false`** → IP = socket réel). Headers `X-RateLimit-Limit/-Remaining/-Reset` (epoch s, convention GitHub) sur **chaque** réponse quand activé ; dépassement → `Retry-After` (s) + `429` (RFC 6585). `ip===null` (pas de socket) → skip (jamais agréger tout le trafic sous une clé nulle = point de DoS).
- **Lifecycle** : `configureRateLimit()` (privée, idempotente) au `onReady` + `onConfigChanged` (reconstruit le compteur + réarme/désarme le GC). `GcScheduler` (core) armé si `enabled`, `stop()` au `onTerminate`. Cast `response as http.ServerResponse` pour `writeHead(429)`/`end()` (union h1|h2 = TS2349 sur méthodes surchargées incompatibles ; compat h2 partage l'API).
- **Limites assumées** : (1) fenêtre fixe → burst jusqu'à **2× max** à cheval sur 2 fenêtres ; (2) **IP exacte** → un /64 IPv6 = 1 compteur/IP (subnet-aware = amélioration future) ; (3) éviction FIFO au cap → un flood multi-IP peut évincer des compteurs légitimes (mémoire bornée = trade-off assumé) ; (4) rejet AVANT firewall → un flood d'une IP peut gêner un user légitime derrière la même IP (rate-limit transport, par design).

## Bornes DoS du HANDSHAKE / des connexions WS (revue 0.6)

- **F5 — handshake WS soumis au rate-limit IP** : l'upgrade WS EST une requête HTTP (GET+Upgrade) → compté dans le **MÊME** `rateLimiter` que `onHttpRequest` (un upgrade = 1 `hit(ip)`). Check en tête de `onWebsocketRequest`, AVANT `enterScope`/ALS/pipeline. Le 101 étant déjà émis par `ws`, un 429 est impossible → **close RFC 6455 1013**. **0 log/rejet** (amplificateur DoS sous flood). Banc `run.sh ws-handshake-rl`.
- **F6c — cap connexions CONCURRENTES/IP (backstop OPT-IN)** : `src/rateLimit/WsConnectionCounter.ts` (Map lazy `ip→count`, `tryAcquire`/`release`, auto-bornée = 0 GC, `rejectedTotal`). Config **`http.wsMaxConnectionsPerIp`** (`null` DÉFAUT = OFF, `runtimeMutable`). `configureWsConnectionLimit()` au `onReady`+`onConfigChanged`. Dans `onWebsocketRequest` : IP résolue **1 fois** si `rateLimiter||#wsConnCounter` armé ; `tryAcquire` → au-delà close 1013 « too many connections », sinon `ws.once("close", …release)` (compteur capturé en closure → décrémente TOUJOURS la bonne instance après reconfiguration ; `once` fire garanti à la fermeture = 0 fuite). Banc `run.sh ws-conn-cap` (`NF__HTTP__WSMAXCONNECTIONSPERIP=3`).
- **⚠️ Délégation (doc)** : F6c est **PAR PROCESS** (1 pod). Un vrai plafond **global/IP** = **ingress/LB** (nginx `limit_conn`, HAProxy `sc_conn_cur`, annotation k8s), qui voit tout le trafic + rejette avant le fd/TLS + couvre tous les pods. **Cloud-native : laisser `null`, déléguer à l'edge.** N'activer que sur bare-metal/VPS SANS ingress (défense en profondeur). C'est le choix des frameworks matures (`ws`/Express : rien + « use a reverse proxy »).
- **Perf** : F5/F6c ne touchent QUE `onWebsocketRequest` (1×/connexion, PAS le hot-path HTTP ni le chemin message WS). Désactivés (défaut) = 1 lecture de champ + tests `!== null`, 0 alloc/0 listener. Prouvé : `memory.test` 9/9 inchangé.
- **Banc e2e wire** : `.claude/skills/nodefony-load-test/scripts/ratelimit-e2e.mjs` (câblage réel HTTP : transition 200→429 depuis une fenêtre fraîche + `X-RateLimit-*` + `Retry-After`). Prérequis serveur : `NF__HTTP__RATELIMIT__ENABLED=true NF__HTTP__RATELIMIT__MAX=5 NF__HTTP__RATELIMIT__WINDOWS=5 bash .claude/skills/nodefony-start-server/start.sh`.
- Tests : `tests/unit/rateLimit.test.ts` (fenêtre, 429/Retry-After, reset, **isolation par clé** anti-contournement, éviction FIFO, gc, état vierge lazy).

## Profiler — dev-only

- `src/profiler/Profiler.ts` : ring buffer `Map<requestId, ProfileEntry>` (cap 500, éviction insertion-order), `collect(ctx)` = snapshot fin de requête (phases/route/controller/user/traceparent/status + **queries ORM**), `get`/`recent`/`clear`. **Borné** (pas de fuite, validé).
- **Seam ORM `queries` BRANCHÉ** : `handleHttp` alloue `context.profilerQueries = this.profiler ? [] : null` (**dev-only, 0 alloc prod**) et passe la **même réf** dans la payload ALS (clé `queries`). Les adapters ORM y poussent via `RequestContext.pushQuery()` ; `collect` lit `ctx.profilerQueries` au teardown (teardown est **hors bulle ALS** → on lit la réf sur le context, jamais `RequestContext.get()`). `queries` reste `undefined` si vide (contrat preserved). WS : pas encore collecté (teardown HTTP only). Tests Profiler +2.
- Hook : `http-kernel` teardown (`this.profiler?.collect(ctx)` avant `clean()`), résolu container `"profiler"` à onReady, **null en prod** (module l'instancie dev-only dans `index.ts` onKernelBoot → `environment !== "production"`). ⚠️ **Bug `"prod"` vs `"production"`** : comparait `"prod"` — valeur INEXISTANTE (`setEnv` normalise en `"development"`/`"production"`/`"test"`) → `"production" !== "prod"` toujours vrai → Profiler (+ timing `Context.ts`, pretty-logger) tournait **EN PROD** : perf (JS pipeline 24.5→18.5 %) **+ sécu** (`/nodefony/profiler/api/*` exposé = fuite d'info). **Règle : comparer `"production"`, jamais `"prod"`** (cf `request-logger.ts`, `Context._timingEnabled`).
- Data-plane : `createProfilerAdminApi(profiler)` → namespace `profiler` → `GET /nodefony/profiler/api/recent` (+`?limit`) / `GET /{id}` (404 si absent) / `DELETE recent`. Tests `tests/unit/Profiler.test.ts` (16).
- **Seam SÉCURITÉ `security` BRANCHÉ** (radiographie) : `context.profiling = this.profiler !== null` (booléen, posé HTTP + handshake WS) = le TÉMOIN que lisent les producteurs de trace hors http. `@nodefony/security` alloue alors `context.securityTrace: ISecurityTrace` (`authenticator`/`outcome`/`reason`/`user`/`roles`) — contrat porté par `interfaces/IContext.ts` car **http ne peut pas importer security** (cycle) : http porte le champ, security le remplit (même pattern que `profilerQueries` ← adapters ORM). `collect` fusionne la ZONE (`ctx.security`, ce qui était POSSIBLE) et la TRACE (ce qui s'est PASSÉ) → `ProfileEntry.security`. `undefined` hors zone. **Raison d'être** : le chemin de succès du firewall n'émet AUCUN audit (délibéré) → sans ça, une requête qui passe ne dit ni sa zone ni son authenticator.
- ⚠️ **`ProfileEntry.user` ne peut PAS venir de `context.user`** en zone : le token vit dans l'ALS, illisible au teardown où `collect()` tourne → `readUser()` retombe sur `securityTrace.user` (sinon une requête authentifiée s'affiche « anonyme » tout en portant des rôles).
- `ProfileQuery.startMs` (posé par les adapters drizzle/mongoose, même horloge que `PhaseTiming.startMs`) → le SQL se PLACE dans le waterfall (une requête de session apparaît DANS la barre `firewall`), au lieu de flotter en liste.

## PrettyRequestLogger

- `PrettyRequestLogger implements IRequestLogger` (`service/pretty-request-logger.ts`)
- Format 1 ligne human-friendly (dev) : `GET 200 /api/test 12.3ms 127.0.0.1 [a1b2c3d4]` (ANSI couleurs)
- Status colorisé : 2xx vert, 3xx jaune, 4xx jaune-bold, 5xx rouge
- requestId tronqué à 8 chars (premier bloc UUID, suffisant visuellement)
- Duration formatée : `12.5ms` < 1s, `1.23s` >= 1s, `0.42ms` < 1ms
- Activation : `httpKernel.setRequestLogger(new PrettyRequestLogger())`
- WS : prefix `WS  ` + `[protocol]` si présent
- Severity status-based (consomme `severityFromStatus` de P3.3)
- Tests unit : `PrettyRequestLogger.test.ts` (11 tests)

## JsonAuditLogger error enrichi

Extension de l'`AuditErrorEntry` :

- `{ name, message, code?, errorType?, stack?, cause? }` — récursif
- **stack** conditionnel : par défaut activé si `NODE_ENV !== "production"`, override via `new JsonAuditLogger({ includeStack: true|false })`
- **cause chain** : sérialise `error.cause` récursivement (Error{cause:Error{cause:...}}})
- **`maxCauseDepth`** : default 5 — protège contre cycles + log oversize
- **`errorType`** : pull depuis `nodefonyError.errorType` (Phase 1 domain classifier)
- Cycles safe : `cause` cyclique = stop net à depth max, pas de crash
- Tests : 6 nouveaux dans `AuditLogger.test.ts` (stack/no-stack, cause chain, depth cap, errorType, circular safe)

## JsonAuditLogger

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

### Audit sampling — L3 perf

- Opt-in `log.requestLogger.sampleRate` (défaut `1` = tout loguer). `N>1` = 1 req 2xx/3xx sur N, **toujours** ≥400 + erreurs.
- Gate = `JsonAuditLogger.shouldSample(ctx, err)` (méthode optionnelle de `IRequestLogger`), appelée par `Context.logRequest()` **AVANT** `renderHttp` → skip = 0 objet/0 `JSON.stringify`.
- Compteur **déterministe** modulo (pas de RNG — cohérent L2) ; les ≥400/erreurs n'avancent PAS le compteur (cadence 2xx stable). Clamp `<1`/NaN→1.
- Câblé via `applyRequestLoggerFromConfig` (passe `sampleRate` à `JsonAuditLoggerOptions`). Pretty/Default loggers = pas de `shouldSample` ⇒ toujours loguer.
- Micro-bench dist : `renderHttp` ~1365 ns/req vs `shouldSample` ~10 ns ; sampleRate=20 → poste audit 1365→78 ns/req (-94%). Défaut **iso-perf**. +7 tests sampling.

## RequestContext (ALS)

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

## RequestLogger pluggable

- `IRequestLogger` interface : `renderHttp(ctx, error?)` + `renderWebsocket(ctx, error?, protocol?)` → `{text, severity, msgid}`
- `DefaultRequestLogger` (`service/request-logger.ts`) — singleton, stateless, **zéro alloc per-request**
- Format inchangé : `URL : ... FROM : ... ORIGIN : ... ID : <uuid>` + `Accept-Protocol` WS + couleurs cli-color
- Prod env : erreur single-line. Dev env : multi-line avec stack
- `HttpKernel.requestLogger: IRequestLogger = new DefaultRequestLogger()` (instance unique)
- `HttpKernel.setRequestLogger(custom)` / `.getRequestLogger()`
- `Context.logRequest` et `WebsocketContext.logRequest` délèguent : `this.httpKernel?.getRequestLogger().renderHttp(...)`
- Exporté dans `index.ts` : `DefaultRequestLogger`, `IRequestLogger`, `IRequestLogEntry`
- Préalable : P3.1 audit log canonique JSON, P3.2 pretty formatter, P3.10 NCSA/Combined transport

## Security hooks

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

## ErrorRenderer unifié HTTP+WS

- `IErrorRenderer` interface : `renderHttp(err, ctx) → {status, message, body, headers?}` + `renderWebsocket(err, ctx) → {code, reason}`
- `DefaultErrorRenderer` (`service/error-renderer.ts`) — singleton, stateless, **zéro alloc per-request**
- Préserve la shape JSON erreur legacy : `{code, message, error: HttpError.toJSON(), nodefony: {requestId, scheme, ...}, result: null}` — aucune régression
- WS : code clamp 1000-4999 (1011 si HTTP-style code en phase connected), reason = `error.message`
- `HttpKernel.errorRenderer: IErrorRenderer = new DefaultErrorRenderer()` (instance unique)
- `HttpKernel.setErrorRenderer(custom)` pour override (hide stack en prod, RFC 7807, auth challenge headers...)
- `HttpKernel.getErrorRenderer()` pour lecture
- Exporté dans `index.ts` : `DefaultErrorRenderer`, types `IErrorRenderer`, `IErrorHttpResult`, `IErrorWebsocketResult`
- Préalable : P1.7 hooks security (AuthFailureHandler), P3.5 erreur enrichie audit

## Abort signal — Context.signal

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

## Aborted requests + 499 interne

- Client part avant TOUT envoi → `http-kernel.onClose` (`!didFinish`) : `_abortIfPending` + si `!sended` → `response.statusCode = 499` (nginx-style "client closed request").
- **499 = observabilité PURE** : reflété dans request-log + profiler, **JAMAIS écrit sur le socket** (déjà mort). Le logger préfère `error.code` → 499 ne surface que sur un abort sans erreur ni envoi.
- Test : `nodefony/tests/http/client-abort-499.test.ts` (assert via log `GET  499 …/abort/wait`).

## Request timeout — 2 couches distinctes

- **Couche réseau** : `requestTimeout` natif Node (config `http/https`, défaut 30s) = délai de réception headers+body → anti-slowloris. Node renvoie un 408 brut + ferme. **Hors pipeline volontairement** (aucun Context/controller à ce stade).
- **Couche pipeline** : `responseTimeout` (Nodefony) armé via `HttpContext.setTimeout()` → socket idle → `onTimeout` event → **`_abortIfPending("Request timeout")` (annule `ctx.signal`)** PUIS `httpKernel.onError(408 | 504 si HTTP/2 stream)` → errorRenderer.
- Sondes test : `/nodefony/test/timeout/{probe,state,reset}` (la sonde re-arme un socket timeout court via `ctx.response.response.setTimeout(ms, cb)` + `fire("onTimeout")`). Test : `nodefony/tests/http/timeout-abort.test.ts`.

## Controller initialize() error boundary

- `Resolver.newController` → `await controller.initialize()` ; un throw remonte `HttpContext.handle()` reject → `handleHttp` catch → `onError` → 500 JSON cohérent, serveur sain (pas de hang).
- Verrou : `LifecycleController` (module test) dont `initialize()` throw toujours, route `/nodefony/test/lifecycle/init-crash`. Test : `nodefony/tests/http/lifecycle-init-crash.test.ts`.

## Post-response hook — Context.onAfterResponse

- `Context.onAfterResponse(fn: (ctx) => void | Promise<void>): void`
- Fire-once per context, dédup HTTP `response.on("finish")` vs `response.on("close")` via `_afterResponseFired` flag
- Handlers await en série dans `_runAfterResponse()` — exceptions swallow + log (un handler qui throw ne bloque pas les autres)
- Late subscribe (après fire) → fn exécutée sur microtask
- WS : trigger via event `onFinish` déjà fire dans `WebsocketContext.onClose()`
- Insertion : entre `logRequest()` et `fireAsync("onFinish")` (avant `clean()` / `leaveScope()`)
- Routes test : `/nodefony/test/after/{incr,multi,throw,state,reset}` — counters singleton
- Tests : `nodefony/tests/integration/after-response.test.ts` (6 tests)
- Préalable : P3.1 audit log canonique, P2.2 tear-down déterministe, P2.3 aborted requests (signal)

## Lifecycle Timing — Context.phases

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

## Body parsing — drain OBLIGATOIRE avant lecture

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

## Durcissement WS — heartbeat (G2) + backpressure (G1) + fragmentation/latence (G3)

`ws@8` n'a **0 keep-alive natif** (≠ ancienne lib `websocket` theturtle32 qui pingait/droppait seule via **1-2 timers PAR connexion** = anti-pattern). Les knobs `keepaliveInterval`/`keepaliveGracePeriod` (Zod) étaient déclarés mais **non câblés** (config menteuse) → recâblés.

- **Helper `service/servers/wsHeartbeat.ts`** : `startHeartbeat(server,opts)` = **1 SEUL `setInterval`/serveur** (jamais 1/conn), `unref` + `clearInterval` au `terminate()`. `trackPong(ws)` par conn = **1 listener `pong` + 2 `number`** (`_nfLastPong`/`_nfPingedAt`), **0 alloc/tick**. Tick = `max(250, min(interval,grace))`.
- **Sémantique** : ping tous les `keepaliveInterval` (déf. 20s) ; `terminate()` (close abrupt, pas `close()` — pair mort, pas de handshake) si pas de pong sous `keepaliveGracePeriod` (déf. 10s). Half-open réclamé en ~`interval+grace`. RFC 6455 §5.5.2 (pair **MUST** pong) / §5.5.3 (pong non sollicité OK → `trackPong` rafraîchit sur **tout** pong). `keepaliveInterval<=0` → désactivé (`null`).
- **Câblé ws + wss** : `createServer`→`startHeartbeat` ; `onConnection`→`trackPong` ; `terminate`→`clearInterval`. Coût = **2 timers fixes** (5151+5152), constant quel que soit N connexions.
- **Options `ws@8` désormais TOUTES déclarées+câblées** (Zod) : `perMessageDeflate`(false, anti zip-bomb)/`skipUTF8Validation`(false, §8.1)/`autoPong`(true, §5.5.2)/`allowSynchronousEvents`(true)/`maxPayload`(1 MiB, durci vs 100 MiB ws). `new WebSocketServer({...this.options, server, clientTracking:true})` — `server`+`clientTracking` **forcés** (broadcast()+heartbeat en dépendent). `keepalive*`/`closeTimeout` = knobs Nodefony, **pas** options ws (ws les ignore).
- **Backpressure SORTANTE (G1, LIVRÉ)** : `Response.send()`/`broadcast()` gatent via `decideSend(ws,max,policy)` (`src/context/websocket/wsBackpressure.ts`) **AVANT** `client.send()`. Lit `ws.bufferedAmount` (O(1)), **0 alloc sous le seuil** (nominal inchangé). Config Zod `maxBackpressure` (déf **4 MiB**, `0`=off) + `backpressurePolicy` `drop`(déf)|`close`. `drop` = saute la frame (client reste connecté, dégradable, idéal broadcast/télémétrie) ; `close` = `close(1013)` « Try Again Later ». Compteur `_nfDrops` lazy/socket (sonde) + **WARNING 1×/conn** au 1er drop. Seuil/politique relus depuis `wss.options` (ws conserve nos clés via le spread). `coalesce` = couche **canal realtime**, PAS transport. Démo live : flood 17.6 MiB à un lecteur `paused` → drop à 4 MiB, socket reste OPEN, 0 OOM.
- **Fragmentation + latence + deflate (G3, LIVRÉ — 0 code prod, `ws` gère déjà)** : (b) **fragmentation RFC §5.4** testée (`tests/websockets/websocket-fragmentation.test.ts`) — `ws` réassemble ; message fragmenté → echo complet, **ping interjeté entre fragments** → pong (autoPong) **sans corrompre** le réassemblage (croise G2). Frames fabriquées via `ws.Sender.frame` (import namespace — pas dans `@types/ws` ni sur le default ESM). (a) **latence** : banc RTT p50/p95/p99 (`tests/load/ws-latency-load.test.ts`, 500 micro-frames séquentielles, lossless + p99 < 100 ms). (c) **audit `perMessageDeflate`** : `ws` borne la **décompression** par `maxPayload` (`RangeError 'Max payload size exceeded'` → close) → **zip-bomb mitigé** (notre 1 MiB) ; défaut `false` = 0 décompression ; `maxFragments` (ws, déf 128k) borne le **nombre** de fragments (anti-DoS). **Chantier WS = 3/3 trous fermés.**

## Durcissement cycle requête V1/V2/V5 + fast path T1/T3/T4

- **V1 sécu (`0860a48`)** : body cap → **413** (`maxBodySize` Zod) ; origin check HTTP ; **anti-CSWSH** WS (origin sur upgrade).
- **V2.1 (`55405ff`)** : logs d'events lifecycle **gatés boot-time** (0 closure/format si sink inactif).
- **T1 (`fd7107e`, +10,8 % RPS A/B)** : audit nominal **gaté boot-time** quand sink log = null — `JsonAuditLogger` n'est plus construit/appelé par requête si personne n'écoute. Re-check au switch de driver.
- **T3 (`e180faf`)** : timeout socket h1 = **1 closure/socket** + re-arm **conditionnel**. ⚠️ piège : node RÉ-ARME `socket.setTimeout` aux transitions keep-alive (`server.timeout` 120 s ↔ `keepAliveTimeout` 5 s) → tout état « 1× par socket » peut être écrasé dès la req 2 → check conditionnel par requête. Poste résiduel = node-interne (prix de la feature 408).
- **T4 (`5a37a0b`, structurel)** : churn listeners/req — 1 seul `once("close")` au teardown, `_onTimeout()` direct, `fireRequestEnd()` ; ~4 onceWrappers + 5 closures + 2 removeListener supprimés/req. ⚠️ vécu : `replace_all` d'un call site vers la méthode fraîchement extraite = récursion infinie (s'exclure soi-même).
- **V5 RFC (`fd28a82`/`023fd5e`/`1aaa6f2`)** : teardown blindé (hook `onFinish` qui throw ne fuit plus de scope DI) ; **Host mismatch → 421** ; broadcast WS binaire ; Range RFC 9110 (416/ignore/clamp) + `destroy()` ReadStream ; `new Promise(async executor)` aplatis. Bonus : hang `super.send` http2 corrigé.
- **Contrat retours controller (`044df1d`)** : scalaires auto-JSON (RFC 8259), `Buffer` direct, `null`/`undefined` = corps vide. (Resolver côté framework.)

## Gotchas critiques

**IWsRequestExtension** : `IncomingMessage.url` = string. `Route.match()` fait `.pathname`. Fix : `WsIncomingMessage = IncomingMessage & { url: URL; query; queryGet; path }` — assigné dans `WebsocketContext` constructor.

**ERR_INVALID_CHAR** : Node.js set `ServerResponse.statusMessage` natif AVANT validation → char invalide persiste même si `writeHead()` throw. Tous les writes suivants échouent en cascade (y compris timeout 30s). Fix : `safeMsg = statusMessage.replace(/[^\x20-\x7E]/g, "")` juste avant `ServerResponse.writeHead()` dans `Response.ts`.

**HttpError champs undefined** : `httpError.ts` est dans `@nodefony/http` qui est une dépendance de `@nodefony/framework` — import circulaire impossible. Accès au resolver via `(context as any)?.resolver`. Props : `this.controller = resolver?.controller?.name`, `this.action = resolver?.actionName`, `this.jsonResponse = \`${res.statusCode} ${res.statusMessage}\`.trim()`.

**Protocol WS** : `requirements.protocol: "echo-protocol"` → exact string match. Array `['a','b']` → header `"a, b"` → ne matche pas `"a"` → 1002. `requirements.protocol: ""` → accepte tout.

**Pipeline = async plates, JAMAIS `new Promise(async executor)`** : `handle`/`handleFrontController`/`handleHttp`/`onRequestEnd` sont des `async function` plates (`throw`/`return` directs, `try/catch`). NE PAS réintroduire `return new Promise(async (resolve,reject)=>…)` : une fn async retourne déjà une Promise → wrapper = 2ᵉ Promise + microtasks + closures/req, et les `throw` hors `resolve/reject` sont **avalés** (la Promise externe reste pending à jamais). `RequestContext.run<T>(payload, fn)` **propage** le retour de `fn` → `return await RequestContext.run(...)`. Seul `.catch` volontaire conservé = `onAuthFailure` (log + avale pour ne pas masquer `authError`).

**Binary WS** : `context?.send(buf, "binary")` server-side ; `ws.send(Buffer)` client-side. Envois séquentiels : utiliser `wsCollectBinary(ws, n)` côté test (collect all then assert) — pattern `await` frame par frame timeout.

**Broadcast** : `context.broadcast(str)` → `wss.clients.forEach(send)` — inclut l'émetteur.

**url.parse interdit** : remplacé par `new URL(str, "http://localhost")` — `url.parse()` deprecated Node.js v22+.

**onConnection** dans http-kernel : `catch` silencieux — erreurs WS avalées, vérifier logs DEBUG.

**Activation session (plug runtime)** : plus de `startSession()`. Une session s'ouvre via l'**intent** déclaré `@UseSession({context?,readOnly?,eager?})` (framework, classe/méthode) **OU** un paramètre `@Session` **OU** un cookie de session existant (reprise L1). Point d'activation UNIQUE `HttpKernel.startSession(context)` (HTTP **et** WS, symétrique), lit `context.sessionIntent` (posé par le Resolver). Lazy : 0 session/0 write sinon (fin du `sessionAutoStart` global = le ×23). `Session.readOnly` → `save()` no-op. `cookie.hostPrefix` (`auto`|`true`|`false`) → préfixe `__Host-` sur scheme **effectif** (TLS, honore X-Forwarded-Proto si trustProxy). Cookie nommé via `Context.getSessionCookieName()` (lecture=écriture). `regenerateId()` = seam P6 (anti-fixation).

**Modèle de durée de vie session (NIST 800-63B / OWASP, schema `session`)** : **deux** timeouts distincts, enforcement 100 % serveur (le cookie reste session-only). `idleTimeoutS` (défaut 1800 = 30 min) = inactivité max depuis la dernière activité ; `absoluteTimeoutS` (défaut 43200 = 12 h) = âge max depuis création, **JAMAIS prolongé** (re-auth forcée même session active — borne un id volé). Plus de `maxLifetimeS` (nom PHP retiré). `isValidSession` applique les deux à la **lecture** (idle via `updated`, absolute via `created`) ; le GC purge sur les **deux bornes** (`storage.gc(idle, absolute)`). **Touch throttlé** = le cœur : `Session.touchIfNeeded()` (appelé par `SessionsService.saveSession` quand la session n'écrit pas son blob — propre OU `readOnly` dirty) prolonge l'idle sur l'activité HTTP **ET WS** sans réécrire le blob, **1 write/tranche** (mi-vie de l'idle) → une session ACTIVE (cas Studio WS read-only) ne meurt plus. Capacité optionnelle `ISessionStorage.touch?(id, idleS?)` : `files`=`utimes` (mtime=idle, birthtime=absolute), `drizzle`/`mongoose`=`updateOne updatedAt`, `redis`=`EXPIRE` (TTL natif glissant ; absolute honoré à la lecture). `RevocationGuardStorage.touch` respecte la pierre tombale (pas de prolongation d'une session révoquée). Perf prouvée prod : touch 4,4× moins cher que write (évite l'écriture SQLite synchrone). Banc d'attaque : `tests/unit/session-timeout.attack.test.ts`.

**Session storage = IoC** : `SessionsService` tient un **registre statique** (`registerStorage/getStorage/storageHandlers`) ; http n'importe AUCUN ORM. Chaque backend s'auto-enregistre au chargement (`files` par http ; `drizzle`/`mongoose` par leur module). Sélection via config `session.store` (casse-insensible). Events kernel `onRegisterSessionStorage` / `onSessionStorageReady`. Défaut reco = `drizzle`. Guide : [[guide session-storage]] (`docs/guides/session-storage.md`). ⚠️ appeler `registerStorage` rend l'import http VALEUR → externaliser `@nodefony/http` dans le rolldown.config du module fournisseur.

**HTTP/2 write-after-end** : sur réponse lente, le client abandonne / le stream se ferme → `stream.respond()`/`write()` sur stream détruit = `ERR_HTTP2_INVALID_STREAM` + `ERR_STREAM_WRITE_AFTER_END` (CRITIC). Fix : gardes `stream.destroyed/closed/writable` dans `Http2Response.writeHead/send/end` → skip DEBUG. (Relève de P2.3 aborted-requests.)

**Fichiers test** : chaque `.ts` dans `nodefony/tests/` doit commencer par `/// <reference types="node" />`.

## Tests — vitest (mocha retiré) — unit / intégration / charge

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

## Admin data plane — `IAdminApi`

http = **2ᵉ producteur** du data plane admin Studio (1er = kernel). `createHttpAdminApi(module)` (`nodefony/service/HttpAdminApi.ts`) → enregistré dans `onKernelBoot` via `IAdminRegistry` du container (`this.kernel.container.get("adminBroker")`).

- **Import : SEULEMENT `IAdminApi`/`IAdminRegistry` depuis `"nodefony"`** — jamais `@nodefony/framework` (cycle). C'est tout l'intérêt du split `IAdminRegistry` (core) / `IAdminBroker` (framework).
- Endpoints (validés runtime) : `GET /nodefony/http/api/servers` (5 services serveur : type/scheme/protocol/address/port/family/ready) · `GET /nodefony/http/api/info` (serveurs prêts, ports, schemes, protocols) · `GET /nodefony/http/api/sessions` (état sous-système + `active` = count ; flag `deprecated` **retiré** — session = base auth web BFF).
- **Sessions admin** : `GET sessions/list` (paginé `?user&limit&offset`, défaut 50/cap 200) · `POST sessions/{ref}/revoke` · `POST sessions/revoke-user/{identifier}` (logout-everywhere). RBAC `ROLE_NODEFONY_ADMIN` (défaut broker). **DTO redacté `ISessionSummary`** (jamais `Attributes`/`flashBag`/id brut) — id remplacé par **`ref = HMAC(secret, id)`** (`computeSessionRef`/`toSessionSummary`, fonctions pures testées ; secret = `this.secret` session). Énumération = `ISessionStorage.listAll?(filter?)` **optionnelle** (4 stores : File/Drizzle/Redis-SCAN/Mongoose ; absente → **501** honnête). Révocation = scan O(N) + recompute HMAC (pas d'index inverse). Mutations auditées via pont optionnel `auditService` (catégorie `session`, no-op si security absent). Tests : `tests/unit/SessionsAdmin.test.ts` (ref/redaction/orchestration) + drizzle `session-storage` (SQL réel).
- Lecture défensive des services `server-{http,https,websocket,websocket-secure,static}` via `module.get(name)`.
- **Per-instance** : answers du process qui reçoit (LB route vers 1 pod). Header `x-nodefony-instance` posé par `AdminApiController` (convention `NODEFONY_INSTANCE_ID ?? pid`). Vue cluster = Redis P13. Cf [[project_multiprocess_scaling]].
- Stateless : aucun `startSession()`, lit l'user via ALS (futur JWT). Cf [[project_security_stateless_http_decision]].
- Détails contrat + broker : framework MEMORY.md « Admin data plane ».

## Deps clés

- `ws@8` — ESM : `import { WebSocketServer } from 'ws'` (jamais `Ws` default, jamais `Ws.Server`)
- `@fastify/busboy@3` — upload
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
