# @nodefony/framework MEMORY

## Docs liées

- [`CLAUDE.md`](./CLAUDE.md) — instructions module
- [`../http/MEMORY.md`](../http/MEMORY.md) — Context/Request/Response (dépendance bas-niveau)
- [`../../../modules/test/MEMORY.md`](../../../modules/test/MEMORY.md) — controllers d'intégration
- Core : [`../../../nodefony/MEMORY.md`](../../../nodefony/MEMORY.md) (Service) | [`../../../nodefony/src/kernel/injector/MEMORY.md`](../../../nodefony/src/kernel/injector/MEMORY.md) (DI/Injector — `Injector.instantiate` utilisé par `Resolver.newController()`)

## Purpose

Module Nodefony : routeur HTTP+WS, Controller, Resolver, décorateurs `@route`/`@controller`/`@controllers` + NestJS-inspired HTTP method + response decorators, templates Twig/EJS.

## Core Components

| Classe/Fichier     | Lignes | Rôle                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Controller`       | 514    | Extends Service. Props: `route`, `request`, `response`, `context`, `queryGet/Post/File`. `session` = **getter** sur `context.session` (plus de `startSession()` — supprimé 2026-06-07 ; activation = `@UseSession`/`@Session`/cookie). API: `renderJson/View/Twig/Ejs/FileDownload/MediaStream`, `redirect`, `forward`, `getSession`, `getFlashBag/setFlashBag`. **⚠ noms d'action réservés (conflit prop/méthode Controller) : `session`, `get`, `set`, `request`, `response`, `method`.**                                                                                                                                                                                                                                                                               |
| `Resolver`         | 403    | **POJO per-request (V3.1 — n'étend PLUS Service)** : ctor = 2 affectations + lookup injector via `context.container`. Cache controller sur `context.container` clé `"controller"` (survit au Resolver : WS par message, forward `reload`). `match()` → `executeAction()` (meta P5 figées) → `_applyResponseMeta()` → `_handleRedirect()` → `returnController()`. `newController()` via Injector.                                                                                                                                                                                                                                                                                                                                                                          |
| `Route`            | 440    | `name`, `path`, `pattern` (RegExp compilé), `variables[]`, `defaults`, `requirements`. `match(ctx)` → vérifie url+requirements. `matchRequirements` vérifie `requirements.methods` (pas `route.method`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `Router` (service) | 131    | Tableau statique `routes: Route[]` partagé process-wide. `resolve(ctx)` → Resolver. `createRoute(name, opts)` static. **Index de routes (fast path ét. 4, 2026-06-11)** : partition littérales (Map `path.toLowerCase()` — flag `i` oblige) / dynamiques (`{var}`/`*`/metachar regex, compile() n'échappe QUE `/` et `.`) ; `resolve()` = merge ordonné par position → même séquence que le scan MOINS les littérales d'autres paths ; invalidation `routeIndex=null` sur create/removeRoutes + garde-fou photo `length/first/last` (swap direct type bancs) ; ne court-circuite JAMAIS `resolver.match()`. A/B mono prod : **+15,3 %** RPS (pos 134/222), **+24,9 %** (littérale pos 151). Contrat : `routing-nonregression.test.ts` (25) + `routing-index.test.ts` (6). |
| `routerDecorators` | 290    | `@controllers`, `@controller(prefix)`, `@route(name, opts)` + **`@Get/@Post/@Put/@Delete/@Patch/@Options/@Head`** (requirements.methods) + **`@All`** (AUCUN requirement methods → matche toutes) + **`@HttpCode/@Header/@Redirect`** + **`@Param/@Body/@Query`** (Reflect metadata).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `Twig` / `Ejs`     | 118/43 | Services template. `render(file, params)` → Promise\<string\>.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

## Interfaces

| Interface      | Fichier                               | Implémentée par                                                     |
| -------------- | ------------------------------------- | ------------------------------------------------------------------- |
| `IController`  | `nodefony/interfaces/IController.ts`  | `Controller` — `route` est `readonly` dans l'interface (covariance) |
| `IRoute`       | `nodefony/interfaces/IRoute.ts`       | `Route`                                                             |
| `IResolver`    | `nodefony/interfaces/IResolver.ts`    | `Resolver`                                                          |
| `IAdminBroker` | `nodefony/interfaces/IAdminBroker.ts` | `AdminBroker` — étend `IAdminRegistry` (core)                       |

## Admin data plane — `IAdminApi` / `AdminBroker` (P10.2-P10.3, 2026-05-20)

Contrat d'exposition admin pour Studio. **Inversion de dépendance** : contrat producteur dans le core, transport dans framework.

- **Core (`nodefony`)** : `IAdminApi` (`adminNamespace`, `adminDescriptor()`, `adminEndpoints()`), `IAdminEndpoint` (`path` relatif, `method`, `role`, `handler`), `IAdminRequest`/`IAdminResponse` (abstraction du Context → core ne dépend pas de http), `IAdminRegistry` (façade minimale `register/unregister/has/getApi/list`).
- **Framework** : `IAdminBroker extends IAdminRegistry` (+ `mountAll`, `resolvePath`, `resolve` O(1), `routes`). `AdminBroker` (Service `"adminBroker"`), `AdminApiController` (controller pont unique), `createKernelAdminApi(kernel)`.

**Flux** : producteur `register(api)` en `onKernelBoot` → `Framework.onKernelReady` enregistre le kernel + `broker.mountAll()` → `Router.createRoute` 1 route/endpoint vers `AdminApiController.dispatch` + `setController` once → dispatch `resolve(route.name)` O(1) → `Context→IAdminRequest` → RBAC → `handler` → `renderJson`.

**DUPLEX Ph.3 (2026-06-12, POC souverain)** : `mountAll` déclare `methods: ["GET","WEBSOCKET"]` sur les endpoints GET → invocables par le pont `api.request` (hub realtime, opt-in). `dispatch` = `runAdmin()` transport-agnostique (`{status,headers?,body}`) + 2 rendus : HTTP inchangé (`renderJson`+`x-nodefony-instance`) ; contexte `websocket*` → **body NU** (snapshot ≡ GET par construction), status ≥ 400 → `throw RpcError(-32000, {status, body})`. Mutations (POST/…) restent HTTP-only. `Resolver.queryOverride` (per-invocation) : consommé par `@Query` (clé `queryOverride` du bag `IParamArgContext`, prime sur `request.queryGet` ; `@Req` intact) + copié sur le controller per-request (`queryGet`/`query` shadows) — jamais le contexte WS partagé (bleed). Tests : `tests/integration/api-souverain-bridge.test.ts` (9).

**Producteur externe (http/security…)** : importe SEULEMENT `IAdminApi`/`IAdminRegistry` depuis `"nodefony"` (jamais framework — dép. circulaire). `container.get("adminBroker") as IAdminRegistry` → `.register(api)`.

**Gotchas** :

- `AdminBroker extends Service` → `Service.get()` existe : le getter producteur s'appelle **`getApi`** (pas `get`).
- **RBAC différé** : `request.roles` vide tant que P6 absent → 403 inactif (mode mock). S'active dès que le firewall peuple les rôles, sans changer le code.
- `mountAll()` à `onKernelReady` → producteurs s'enregistrent en `onKernelBoot`.
- Routes admin **≥3 segments** `/nodefony/<ns>/api/*` (jamais mono-segment → collision SPA Studio).
- **Params `{x}`** : `route.variables` = `string[]` de NOMS ; les valeurs arrivent en args positionnels à l'action (`dispatch(...args)`), alignées sur `route.variables` (cf `Resolver._buildParamArgs`). `buildRequest` zippe noms↔args → `request.params`. `{x}` = mono-segment (`[^/]+`) → pas de `/` dans la valeur (ex `module/{name}` : utiliser la clé `http`, pas `@nodefony/http`).
- **Enveloppe `IAdminResponse`** reconnue par `normalize()` SEULEMENT si `status` OU `headers` présent. Un `{ body }` seul = traité comme donnée brute → **double-wrap** `{body:{body:...}}`. Règle producteur : succès défaut 200 = renvoyer la donnée BRUTE ; n'utiliser l'enveloppe que pour piloter status/headers (ex 404).

**Producteurs migrés ✅** (runtime 2026-05-20) :

- **kernel** : `GET /nodefony/kernel/api/{health,info,modules}` — `createKernelAdminApi(kernel)` (le kernel ne peut pas s'auto-enregistrer → framework le wrappe).
- **framework** : `GET /nodefony/framework/api/{routes,info,admin}` — `createFrameworkAdminApi(broker)`. `routes` = dump `Router.routes` ; `admin` = **catalogue discovery P10.2** (tous les producteurs + descriptors + endpoints, ordonné par `descriptor.order`) → source de la nav admin Studio. Le framework héberge le broker → register direct dans `onKernelReady` avant `mountAll`.
- **http** : `GET /nodefony/http/api/{servers,info}` (cf http MEMORY.md).
- **realtime** : `GET /nodefony/realtime/api/health` — `createRealtimeAdminApi()` (register direct dans `Framework.onKernelReady`, idempotent `broker.has("realtime")`). Sonde de la **Socket Nodefony** (cf section dédiée). Namespace `realtime` (pas `framework`) car déménagera dans `@nodefony/realtime` (P13.1) tel quel.
- **orm** : `GET /nodefony/orm/api/{orms,entities,entity/{name},graph,export/{format}}` — `createOrmAdminApi()` (dans `@nodefony/orm-core`). **Graphe canonique IA-first** (ORMs + entités + colonnes + relations) depuis `ormRegistry`+`entityRegistry` ; colonnes via `IOrm.describeEntity?` (Drizzle = `getTableConfig`) ; `export/dbml` = DBML (refs dérivés des relations). orm-core étant une **lib pure**, c'est le **module Drizzle** (`onKernelBoot`, idempotent `broker.has("orm")`) qui le monte — lit les registres globaux → couvre tous les ORM. Cf orm-core MEMORY.
- **syslog** : `GET /nodefony/syslog/api/{logs,info,files,files/{name}}` — `createSyslogAdminApi(kernel.syslog, {logDir, enableFiles})` (index passe `kernel.tmpDir.path` + `environment!=="production"` ; ⚠️ `isProd` PAS fiable, défaut `true` jamais remis false en dev). `logs`/`info` lisent `ISyslog.ringStack` (FIFO), `logs` supporte `?severity=ERROR&limit=N`. **`files`/`files/{name}` = viewer fichiers DEV** (remplace `tail -f`) : `files` liste `*.log` du tmpDir (prod → `enabled:false`, logs→stdout/collecteur) ; `files/{name}?from=&lines=&raw=` = tail incrémental par **offset** (sans `from`=N dernières lignes ; avec=octets ajoutés=follow ; frontières `\n` propres, gère rotation). **Sécu** : path-traversal/non-`.log` → 400 (`resolveLogFile` : `^[A-Za-z0-9._-]+\.log$` + `dirname===logDir`) ; redaction serveur par défaut via `redactSecrets` (core), toggle `raw=1`. Wrappé par framework (syslog est dans le core).
- **+ endpoints paramétrés** (introspection cross-module, producteur **kernel**) :
  - `GET /nodefony/kernel/api/module/{name}` — détail module : key/name/version/isApp/path + `dependencies` + **`services`** (`[{name,class}]` via `Module.getServiceNames()`) + **`config`** (`module.options` sérialisé défensivement : profondeur bornée, fonctions/cycles neutralisés). Onglets Studio Services/Config.
  - `GET /nodefony/kernel/api/module/{name}/docs` — sommaire docs : `[{slug,title,status,since,updated,gitUpdated,order}]` lu depuis `<modulePath>/docs/*.md` (frontmatter parsé). Onglet Studio Docs.
  - `GET /nodefony/kernel/api/module/{name}/docs/{slug}` — `{slug,frontmatter,markdown,gitUpdated}` (2 variables ; slug borné `^[a-z0-9][\w.-]*$` anti path-traversal).
  - `GET /nodefony/kernel/api/module/{name}/symbols` — `{key,package,symbols[]}` filtré depuis `.ai/symbols.json` (`module === getModuleName()` + `exported`). Onglet Studio API.
  - `GET /nodefony/kernel/api/module/{name}/coverage` — dernier rapport (`<module>/.coverage/`), `{available,total,files[],generated}`. `readCoverage` lit `coverage-summary.json` (vitest, a les statements) OU à défaut parse `lcov.info` (monocart core + vitest). → marche pour framework/http (vitest) ET core (monocart lcov, 84.82%). Onglet Studio Coverage ; `available:false` si rien généré.
  - `GET /nodefony/kernel/api/module/{name}/tests` → `{devMode, files[]}` (fichiers test unit, `listTestFiles` filtre `tests/unit/**` si présent). Onglet Studio Tests.
  - `POST /nodefony/kernel/api/module/{name}/test/run` `{file?}` → `runModuleTests` (spawn `npx vitest run <file>` si fichier+vitest, sinon `npm run coverage`) → `{ok,passed,failed,durationMs,output,mode}`. ⚠️ **GARDE DEV-ONLY** : 403 si `kernel.environment!=="development" && !kernel.debug` (ça EXÉCUTE un process). `file` validé (suffixe `.test.ts`, pas de `..`) ; spawn sans shell + args tableau (pas d'injection).

**Runner tests framework** : **unit = vitest** (`vitest run`, `vitest.config.ts` ; mocha+chai tournent via `globals:true` + shim `import "mocha"` + alias stub mongoose). **coverage = `vitest run --coverage`** (v8, json-summary/lcov → `.coverage/`). **intégration = ts-node mocha** (`.mocharc.integration.json`, inchangée, tape le serveur). Pourquoi vitest et pas monocart : monocart `--require` bascule en CJS → specs important le dist non enregistrées (cf [[feedback_coverage_modules]]).

- Helper : `nodefony/src/docsReader.ts` (`parseFrontmatter`/`listModuleDocs`/`readModuleDoc`/`listModuleSymbols`/gitLastUpdated). **0 dep npm** (frontmatter parser maison). `gitLastUpdated` = `git log -1 --format=%cI -- <file>` (cwd `process.cwd()`), fallback `mtime` si non commité/hors git. Endpoints admin basse fréquence → coût `spawn` git acceptable.
- ⚠️ **Routing multi-var** : `{name}` = `([^/]+)` ancré → `module/{name}` (6 seg) ne masque PAS `module/{name}/docs` (7 seg) ni `module/{name}/docs/{slug}` (8 seg). Aucune ambiguïté.
- **Pseudo-module `core`** : le core (`@nodefony/core`) n'est pas dans `getModules()` → `resolveTarget(key)` mappe `key==="core"` vers `resolveCorePath()` (dev `<cwd>/src/nodefony`, fallback `import.meta.resolve("nodefony")`) + pkg `@nodefony/core`. `readCoreInfo()` lit `src/nodefony/package.json` (version/deps). L'endpoint `modules` injecte la carte core en tête. Front Studio inchangé.

## Socket Nodefony — realtime (Hub + Controller + sonde)

> **« la Socket Nodefony »** (majuscule) = le PATRON/concept entier (multiplexage N canaux / 1 WS,
> isomorphe, broker fan-out). En minuscule/code : `socket`/`IRealtimeSocket` = la prise métier ;
> `hub` (`RealtimeHub`) = broker serveur caché ; `channel` = 1 flux ; `transport`/`peer` = octets/protocole.

- **`RealtimeHub`** (`src/RealtimeHub.ts`) — broker per-instance. Canaux PARTAGÉS (`#channels` lazy : 1 provider/canal/pod + `Set<sink>` fan-out, dispose au dernier abonné). `getRealtimeHub()` singleton lazy. `subscribe(channel,sink,factory)`/`unsubscribe`/`publish`/`subscriberCount`/`activeChannels`/`clear`.
- **Backplane cross-process** (`IBackplane` = _fond de panier_ : tuyau qui relie les hubs des autres process ; `publish`=local+backplane (si broadcast), ingress backplane=`publishLocal` only, anti-boucle via `originId`) :
  - `LoopbackBackplane` (`src/LoopbackBackplane.ts`) — mono-process no-op. **Défaut = `#backplane===null`** (0 overhead).
  - **`ClusterBackplane`** (`src/ClusterBackplane.ts`, Phase 3, worker-side) — IPC via seam `IClusterBackplaneTransport`{send,onReceive} (`processIpcTransport` défaut = `process.send`/`process.on("message")`). `publish`→enveloppe taguée `CLUSTER_RT_KIND` (importé de `"nodefony"`) ; `#ingress` filtre kind + **anti-echo `originId`**. Branché sur le hub par le module `Framework` (ctor `kernel.once("onCluster","WORKER")` gardé `NODEFONY_CLUSTER`). Master-gateway = `ClusterRelay` (core). Tests `unit/ClusterBackplane.test.ts` (8, mock transport, 0 fork). Drop-in suivant = `RedisBackplane` (P13).
- **Politique de forward PAR CANAL (Phase 4a, 2026-05-24) — opt-in broadcast** : `publish` ne traverse le backplane QUE pour un canal déclaré broadcast ; **défaut = instance-local** (per-instance ne sort pas). POURQUOI : (1) sûreté Zero-Trust (0 fuite cross-pod de données per-instance) ; (2) tous les canaux d'observabilité actuels (`syslog:stream`/`dashboard:supervision`/`orm:*`/`realtime:health`) corrects en cluster sans déclaration ; (3) le forward (chat/présence/notif) = capacité demandée. `RealtimeHub.markBroadcastChannel(prefix)` (préfixe ⇒ couvre la cadence `:<ms>` ; réévalue les canaux actifs ⇒ ordre indifférent) ; flag `forward` caché dans `ChannelState` (lu O(1) sur hot path ; `publish` serveur sans abonné local ⇒ politique à la volée). Mono-process : politique JAMAIS évaluée (hot path = 1 test `=== null`). Seam endpoint = `RealtimeController.realtimeBroadcastChannels(): string[]` (défaut `[]`, déclaré au handshake). Tests `unit/RealtimeHub.test.ts` (+6 policy).
- **`RealtimeController`** (`src/RealtimeController.ts`, abstract extends Controller) — porte TOUT le protocole JSON-RPC 2.0 (handshake/welcome, `JsonRpcPeer`+`WsConnectionTransport`, pub/sub, cleanup `onFinish`). Sous-classe = `createRealtimeChannel` + `realtimeActions`/`realtimeChannels`/`realtimeInbound` (full-duplex gated, défaut aucun) + `realtimeBroadcastChannels` (forward cross-process, défaut aucun).
- **Sonde (auto-observabilité, 2026-05-24)** — « la socket s'observe à travers elle-même ». Le multiplexing N canaux/1 WS déplace 3 risques sur le hub → la sonde les rend MESURABLES (mesurer avant d'optimiser) :
  - `RealtimeHub.probe(): IRealtimeProbe` — lecture PURE (0 alloc hot path, jamais throw) : canaux+`subscribers`+`messages`, `publishTotal`/`fanoutTotal` (=publish×abonnés), `inboundTotal`, connexions, `bytesSentTotal`/`messagesSentTotal`, **`backpressure`{maxBufferedAmount,totalBufferedAmount,slowConsumers}** (risque #1). Cumuls MONOTONES → débit dérivé côté lecteur (delta total/ts).
  - **Compteurs always-ON** (≠ flux ORM gaté) : intégers O(1) sur `publish`/`send`, **pas** de syscall/stringify → la backpressure (blocker #1) doit être visible sans flag.
  - `bufferedAmount` vit sur la connexion `ws` BRUTE → seul `WsConnectionTransport` l'expose (getter + `bytesSent`/`messagesSent` cumulés dans `send`, `implements IRealtimeConnProbe`). Le controller `registerConnection`/`unregisterConnection` (handshake/onFinish, symétrique) auprès du hub (registre `#connections` lazy, lu QUE dans `probe`).
  - `SLOW_CONSUMER_BYTES = 1 MiB` (seuil d'alerte slow-consumer ; PAS encore de drop — ordre : sonde → stringify unique broadcast → seuil drop/close 1013 → coalescing).
  - Endpoint `GET /nodefony/realtime/api/health` (`buildRealtimeHealth`) + canal Studio `realtime:health` (ticker broker `createBrokerTicker`, défaut 2 s).
- **Sonde AGRÉGÉE pod (Phase 4c, 2026-05-24) — push, désactivable** : en cluster, chaque worker n'a que SA sonde → l'endpoint santé donnait une vue partielle. Modèle **push** : chaque worker remonte sa santé au master (`CLUSTER_PROBE_KIND`), le master `ClusterProbeAggregator` (core, **opaque**, seam `IProbeWorker`, ticker `unref`) **rediffuse** le snapshot (`CLUSTER_PROBE_SNAPSHOT_KIND`) ; chaque worker met en cache → sert la vue POD en O(1) (0 latence). Worker = `ClusterProbeClient` (`src/ClusterProbeClient.ts`, seam `IClusterProbeTransport`/`processProbeTransport`) ; `mergeClusterHealth(instances)` somme les scalaires (`maxBufferedAmount`=MAX). `buildRealtimeHealth` = `clusterProbeHealth() ?? buildOwnHealth()` → `IRealtimeClusterHealth`{cluster:true,instanceCount,instances,totals} en cluster, sinon `IRealtimeHealth` per-instance. **Bypass total** si `NODEFONY_CLUSTER_PROBE=0` OU mono-process : pas de client/agrégateur → 0 timer, 0 listener, 0 IPC, fallback per-instance. Indépendant du backplane realtime. Câblage : `ClusterCommand` (master, gaté) + `Framework.#wireCluster` (worker, gaté) + `Kernel.initCluster` filtre `nf:probe:snap`. Tests : core `ClusterProbeAggregator.test.ts` (6), fw `ClusterProbeClient.test.ts` (7 merge+cache), e2e fork `cluster-probe-e2e.mjs`. Futur push/pull en config : [[project_cluster_probe_mode_config]].
  - Interfaces : `nodefony/interfaces/IRealtimeProbe.ts` (`IRealtimeProbe`/`IRealtimeHealth`/`IRealtimeChannelStat`/`IRealtimeConnProbe`).
  - Tests : `unit/RealtimeHub.test.ts` (26 : fan-out + probe + backplane + 6 forward-policy). Validé live (curl + WS subscribe → connectionCount/canal/fan-out reflétés, cleanup au close = 0 fuite).

## Route Registration Flow

```
@route("name", opts)     → Reflect.defineMetadata(routes:definitions, metadata, Ctor)
@Get/Post/etc(path, opts)→ idem avec auto-name ClassName::methodName + requirements.methods
@controller("/prefix")   → Reflect.getMetadata → Router.createRoute(name, opts) pour chaque route
@controllers([MyCtrl])   → onBoot → Router.setController(MyCtrl, module)
```

**Ordre critique** : `@route`/`@Get/etc` avant `@controller` (metadata collectée avant que `@controller` la lise).

## Decorators NestJS-inspired

### HTTP method decorators

```typescript
@Get(path?, options?)    // → requirements: { methods: ["GET"] }
@Post(path?, options?)   // → requirements: { methods: ["POST"] }
@Put / @Delete / @Patch / @Options / @Head  // idem (1 méthode chacun)
@All(path?, options?)    // → AUCUN requirements.methods → matche TOUTES les méthodes (NestJS-like)
```

Auto-name : `ClassName::methodName` — déterministe, unique par (classe, méthode).

**Clé** : stocke `requirements: { methods }` pas `method: [...]` — sinon `matchRequirements()` ne filtre pas.

### Parameter decorators

```typescript
@Param("id")        // route path variable — this.variables[i] (captures sans full-match)
@Param()            // tous les params nommés comme Record<string, unknown>
@Body("field")      // champ du body parsé (queryPost)
@Body()             // body complet
@Query("q")         // paramètre query string (queryGet)
@Query()            // query string complet
@Headers("x-foo")   // header requête (lookup lowercase — Node) ; @Headers() = objet complet
@Cookie("sid")      // cookie requête → objet Cookie (.value) ; @Cookie() = map (ctx.getRequestCookies)
@Session("user")    // ctx.session.get("user") ; @Session() = l'objet Session live (+ active la session, intent implicite)
@Req()              // ctx.request ; @Res() = ctx.response
@UploadedFile()     // ctx.request.queryFile[0] (1er/unique) ; @UploadedFiles() = tableau complet
```

**Activation** : dès qu'au moins 1 décorateur est présent sur la méthode → `Resolver._buildParamArgs()` remplace les args positionnels.

### `@UseSession` (classe + méthode, dual — activation de session)

```typescript
@UseSession({ context: "aire", readOnly: true, eager: false })
```

Déclare le besoin de **session serveur** (chantier session étape 5, 2026-06-07). Seule façon d'activer (avec un `@Session` param = intent implicite, ou un cookie repris). Plus de `Controller.startSession()`. `resolveSessionIntent(ctor, action)` (combine classe⊕méthode, méthode prioritaire ; détecte un `@Session` param) → posé sur `context.sessionIntent` par le `Resolver.match()` → consommé au point unique `HttpKernel.startSession` (HTTP+WS). `readOnly` → session lue jamais persistée. `eager` → seam P6 (régén ID post-auth). **Lazy** : 0 session sans intent/cookie.

**Résolution = fonction pure testable** : `buildParamArgs(metas, ctx)` + `resolveParamArg(meta, ctx)` (exportées de `routerDecorators`) prennent un `IParamArgContext` structurel (forme minimale `{paramsMap, request, response, session, getRequestCookies}`). Le `Resolver` passe le vrai `Context` (le satisfait par forme) ; les tests unit passent un faux. → la logique de résolution est couverte SANS serveur (`paramDecorators.test.ts`), l'intégration ne valide que le câblage runtime (`http/integration/decorators-param.test.ts`).

**`@UploadedFile` sans clé** : `UploadedFile` ne conserve pas le `fieldname` du formulaire (busboy le passe juste en fallback de `filename`) → pas de matching par champ possible sans toucher le pipeline upload. D'où `@UploadedFile()` = 1er fichier, `@UploadedFiles()` = tous. Dette : tracker `fieldname` si matching par champ requis.

**Gotcha `@Param`** : `route.match()` retourne `map = res.slice(1)` (captures SANS le full-match). Donc `this.variables[0]` = 1ère capture. Index `i`, pas `i+1`.

### `@Idempotent` (classe + méthode, dual — anti double-effet des mutations, P6.8)

```typescript
@Post("/") @Idempotent() create() {}            // STRICT : clé absente → 400
@Patch("/{id}") @Idempotent({ required:false }) update() {} // souple en HTTP
```

Protège une **mutation** (POST/PUT/PATCH/DELETE ; no-op GET/HEAD/WEBSOCKET) contre le rejeu (double-clic, reconnexion socket, retry) via `Idempotency-Key` cliente (`draft-ietf-httpapi-idempotency-key-header`). `computeIdempotent(ctor, m)` → `RouteActionMeta.idempotent: {required}|null` (méthode > classe, comme `@UseSession`). Coût hot path nul si `null`.

- **Seam = `Resolver.callController` → `_callWithIdempotency`** (PAS `executeAction`, réutilisé par le pont WS-RPC invoke sans rendu). `meta` résolu **1× dans `callController`** puis passé à `executeAction(data, reload, meta)` → **0 double résolution** (perf hot path).
- **Logique normative PARTAGÉE** : `src/idempotency.ts` (`evaluateIdempotency` → verdict neutre `execute|guarded|replay|reject` + `resolveIdempotencyKey`/`resolveIdentity`/`computeFingerprint`/`isMutationMethod`). MÊME helper que `AdminApiController` (qui ne fait plus que TRADUIRE le verdict). `required` effectif = `required || isWs` (WS toujours strict).
- **Réponse mémorisée = valeur RETOURNÉE** par l'action (`return data`) + statut. Une action qui pilote la response (`this.render`/stream) n'est pas rejouée fidèlement (double-effet évité, corps rejoué vide) — limite assumée.
- Clé de cache **scopée identité** `[identity, clientKey]` (anti-IDOR) ; payload comparé par fingerprint SHA-256 → 422 si clé réutilisée avec un autre corps.
- **Contrat `IIdempotencyStore` déplacé framework → CORE** (`nodefony` `src/types/`) : permet à `@nodefony/redis`/`@nodefony/drizzle` (hors framework) d'implémenter un store distribué. `interfaces/IIdempotencyStore.ts` = re-export façade. Service `idempotencyStore` (`@services`) inchangé.
- Tests : `unit/idempotency.test.ts` (verdict, 13) + `unit/resolverIdempotency.test.ts` (seam, 8 — replay sans ré-exécution, scope identité) + banc live `http/.../ws-data-plane-auth` (admin).

### Response decorators

```typescript
@HttpCode(201)          // Reflect metadata route:httpCode — appliqué par Resolver avant action
@Header("X-Foo", "bar") // Reflect metadata route:responseHeaders — accumulable, appliqué avant action
@Redirect("/url", 302)  // Reflect metadata route:redirect — appliqué si action retourne void/null
```

**P5 (V3.2 2026-06-10) — metadata d'action FIGÉES par route** : `route.actionMeta` (`RouteActionMeta` = `{paramsMeta, redirectMeta, httpCode, headerEntries, sessionIntent}`), memo au 1er hit via `resolveActionMeta(route)` (pattern frère `routeExpectsBodyStream`) → **0 `Reflect.getMetadata`/`Object.entries` par requête** (avant : ~6/req). `computeActionMeta(ctor, method)` = calcul pur (chemin froid forward). Snapshot PARTAGÉ entre requêtes — ne JAMAIS muter. Posé après `generateId()` → hash route stable. A/B mono prod : ~+6 % RPS (cumul V3.1+V3.2).

**V4 (2026-06-10) — stateless + singleton opt-in** :

- **V4.1 accessors ALS** (`6905ec3`) : champs per-request Controller → accessors `shadow ?? dérivation` (`#context` posé par `setContext` ; `request/response/method/query*` dérivent du context LIVE ; `route` via `context.resolver` ; `context` retombe sur `RequestContext.getContext()` si champ absent). Per-request : 0 lecture ALS. Supprimés : `once("onRequestEnd")` + 4 allocs `{}`/`[]`/construction. Payload ALS porte `context` (posé par http-kernel, HTTP+WS).
- **V4.3 `@Scope("singleton")`** (`18b6e72`) : statique `Controller.scope` (défaut `"request"`, hérité, lu `new.target` + Resolver — 0 Reflect). Singleton : bindé container KERNEL (jamais celui de la requête — clean()é), pas de `setContext`, cache **promesse** sur `Router.getSingletonController` (anti-race création), `initialize()` 1× création, `setRoute`/`module` writes skippés. ⚠️ data race si champ mutable par requête sur `this` → opt-in stateless SEULEMENT, défaut per-request INTOUCHÉ. ⚠️ homonyme `Scope` DI core.
- **V4.2 `ResourceController<T>`** : `static scope = "singleton"` PAR DÉFAUT (sous-classe peut rétrograder). `IResourceService<T>` structurel (find/findById/create?/updateOne?/delete? — aligné AbstractCrudService, 0 dep orm-core). Helpers `listResource/getResource/...` = valeur BRUTE (seam multi-transport) ; écriture absente → 501 ; criteria JAMAIS implicites (deny-by-default). POC `/poc/r-books` + E2E anti-data-race (`resource-singleton.test.ts`).
- **Garde-fou executeAction** : pointeur container `"controller"` vérifié `instanceof` (connexion WS multi-invoke : pointeur réécrit par un re-routage → mauvaise instance sinon). Court-circuité hot path HTTP.
- **A/B** : singleton ≈ per-request (bruit ±5 %) — V4 = archi/sécu concurrence, pas perf.

**`@Redirect` flow** : action retourne void → `context.redirect(url, code)` → `returnController(undefined)` → `isRedirect=true` → `context.send()`.

**Metadata keys exportées** : `HTTP_CODE_METADATA`, `HEADERS_METADATA`, `REDIRECT_METADATA`, `PARAM_ARGS_METADATA`, `RedirectMeta`, `ParamMeta`, `ParamSource` + `RouteActionMeta`, `computeActionMeta`, `resolveActionMeta`.

## Resolver Pipeline (détail)

```
callController()
  → meta = resolveActionMeta(route)              // P5 memo (forward : computeActionMeta)
  → _applyResponseMeta(controller, meta)         // @HttpCode + @Header (0 Reflect)
  → action(...args)                              // args via meta.paramsMeta si décorés
  → _handleRedirect(actionResult, redirectMeta)
    → si redirectMeta + void → context.redirect() → returnController(undefined)
    → sinon → returnController(actionResult)
  → returnController()
    → Promise → unwrap récursif
    → string → context.send()
    → HttpResponse/Http2Response/WebsocketResponse → retourner direct
    → void + isRedirect → context.send()
    → void → waitAsync = true
```

## Gotchas

**Router.routes est statique** : module-level — une seule liste pour tout le process. `removeRoutes()` affecte tout le monde.

**`Route.match()` attend `URL` object** — pas de string pour `context.request.url`.

**`requirements.methods` vs `route.method`** : seul `requirements.methods` est vérifié par `matchRequirements()`. `@Get/@Post/etc` utilisent `requirements.methods`. L'ancien champ `route.method` n'est plus utilisé pour le filtrage.

**`Controller.session` prop écrase la méthode** : si une méthode de controller s'appelle `session()`, `controller["session"]` retourne la Session (prop instance) pas la méthode. Bug subtil : `Resolver.callController` → "Route Action not found". **Règle : ne jamais nommer une action `session`, `request`, `response`, `context`, `method`.**

**queryGet first param bug** : `qs.parse(url.search)` sans `ignoreQueryPrefix:true` → premier param = `"?name"` au lieu de `"name"`. Bug pré-existant `@nodefony/http`. Les tests d'intégration testent seulement le 2ème param.

**`extractControllerFilePath`** dans routerDecorators : stack trace regex `controllers?/.*\.js` — fonctionne uniquement avec fichiers compilés en `.js`.

**`bluebird`** dans Resolver : `returnController` gère `BlueBird` + native Promise + `isPromise()`. Ne pas supprimer.

**`@Redirect` envoie via `returnController(undefined)`** — ne jamais `return` directement après `context.redirect()` dans Resolver, sinon la réponse n'est pas envoyée.

**`Response.redirect()` default = 301** — sans status explicite, la réponse est 301 (pas 302). Toujours passer le code explicitement : `this.redirect(url, 302)`.

## Types exportés (index.ts)

```typescript
export default Framework;
export { Controller, Route, Router, Resolver, Twig, Ejs };
// decorators
export {
  route,
  controller,
  controllers,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  HttpCode,
  Header,
  Redirect,
  Param,
  Body,
  Query,
};
// types only
export type { IController, IRoute, IResolver };
export { graphql };
```

## Tests

| Suite                                       | Fichier                               | Nb      | Scope                                                                                                                                                                              |
| ------------------------------------------- | ------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Route                                       | `unit/Route.test.ts`                  | 28      | constructor, compile, match, variables, defaults, matchRequirements, setPrefix, toObject, requirements API                                                                         |
| Router                                      | `unit/Router.test.ts`                 | 11      | createRoute, getRoutes, removeRoutes, matchRoutes                                                                                                                                  |
| @route/@controller                          | `unit/routerDecorators.test.ts`       | 10      | route registered, prefix, multi-route, metadata cleanup, pattern + @Param/@Body/@Query metadata storage                                                                            |
| @Get/Post/etc + @HttpCode/@Header/@Redirect | `unit/httpMethodDecorators.test.ts`   | 23      | auto-naming, requirements.methods, metadata storage, combined                                                                                                                      |
| Controller intégration                      | `integration/controller.test.ts`      | 23      | renderJson, @HttpCode, @Header, redirect(), @Redirect, errors, queryGet, method constraints, context, session                                                                      |
| @Param/@Body/@Query intégration             | `http/decorators.test.ts`             | 10      | @Param clé unique/multiple/sans clé, @Query avec/sans, @Body complet/champ/absent, combinés                                                                                        |
| **AdminBroker**                             | `unit/AdminBroker.test.ts`            | 10      | register/dup throw/has/getApi/list/unregister, resolvePath, mountAll (routes+resolve O(1)+idempotent), register-after-mount throw                                                  |
| **Admin data plane**                        | `integration/admin-dataplane.test.ts` | 15      | kernel/http/framework/syslog endpoints, **catalogue `/framework/api/admin`**, **param `{name}` (regexp)**, **404 enveloppe**, **non double-wrap**, header x-nodefony-instance, 405 |
| **TOTAL**                                   |                                       | **137** | **92 unit + 45 intégration** (server requis pour intégration)                                                                                                                      |

Lancer : `npm test` (unit) — `npm run test:integration` (unit + intégration, serveur requis 5151/5152). Tests admin = régression des 2 bugs trouvés (params/enveloppe).

## État

- `dist/types/index.d.ts` généré par Rollup ✅ (2026-05-15)
- `package.json` : `exports` + `types` ✅ (2026-05-15)
- `IController`/`IRoute`/`IResolver` créées + `implements` sur les 3 classes ✅ (2026-05-15)
- NestJS decorators `@Get/@Post/etc` + `@HttpCode/@Header/@Redirect` ✅ (2026-05-16)
- Parameter decorators `@Param/@Body/@Query` ✅ (2026-05-16)
- Fix `queryGet ?-prefix` dans `@nodefony/http` Request.ts ✅ (2026-05-16)
- 100 tests (72 unit + 28 intégration), 0 failing ✅ (2026-05-16)

## `any` restants (à typer progressivement)

| Fichier               | Ligne | Symbole              |
| --------------------- | ----- | -------------------- |
| `Controller.ts`       | 71-73 | `queryGet/Post/File` |
| `Resolver.ts`         | 41    | `variables: any[]`   |
| `Route.ts`            | 118   | `variables: any[]`   |
| `routerDecorators.ts` | 65    | `mycontroller: any`  |

## @Domain + routing par vhost (cf `Route.ts`, `routerDecorators.ts`, `router.ts`)

- **`@Domain(pattern|patterns)`** : décorateur CLASSE (contrôleur entier) + MÉTHODE. Alimente
  `route.host`. Précédence `@route({host})` > `@Domain` méthode > `@Domain` classe. ⚠️ en CLASSE,
  placer SOUS `@controller` (décorateurs classe = bas en haut ; `@controller` construit les routes).
- **`Route.host`** : `string|string[]`. Pré-compilé en `hostRegexp: RegExp[]` dans `compile()`
  (host + `requirements.domain`) via `compileDomainPatterns` (@nodefony/http). `matchHostname` →
  `isDomainAllowed` → **403** (RFC 9110 ; ex-401). `undefined` = servie sur tous les vhosts (0 ns).
- **Virtual hosting** (même path, vhost ≠) : `Router.resolve` boucle + `catch → continue` (fallthrough)
  → la route du bon vhost est choisie. Preuve e2e : `domain-routing.test.ts` (module test, DomainController).
- **Router Pass 2 (405 Allow) host-aware + AGRÉGÉE RFC 9110 §15.5.6 (lot 2026-06-11)** : une route
  restreinte à un autre vhost est exclue du calcul du `Allow` (`isDomainAllowed`) — sinon un 403
  domaine serait masqué par un 405 trompeur. La pass 2 s'exécute AUSSI quand la pass 1 finit sur
  une 405 (ex-écart « Allow = dernière route scannée » corrigé) → **tout 405 HTTP sort de la pass 2
  avec l'agrégat** des méthodes du path sur ce vhost. **`Route.match` vérifie hostname AVANT
  methods** (la ressource cible = URI host compris) → une route d'un autre vhost jette 403, jamais
  une 405 qui fuiterait SES méthodes ; path 100 % autre-vhost = 403 quelle que soit la méthode.
  **Pseudo-méthode `WEBSOCKET` exposée dans l'agrégat d'un path duplex** (décision figée : token
  d'extension légal RFC + révèle la surface duplex REST≡WS). Banc NR §B/§D (28 invariants).
- `domainAlias` kernel SUPPRIMÉ → barrière sécu = `http.trustedHosts` (cf http MEMORY). `@Domain` =
  source unique des vhosts servis (plus de double déclaration / "concordance" kernel↔route).
