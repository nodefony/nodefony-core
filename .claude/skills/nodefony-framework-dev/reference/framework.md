# @nodefony/framework (Router/Controller/admin) — référence complète (recettes + API + internals + gotchas)

> Chargé à la demande par `SKILL.md`. **1 concern = 1 fichier** : recettes copier-coller PUIS API publique + internals + gotchas du module. Vérité courante (édition en place, git = historique).

## ▸ Partie A — Recettes (copier-coller, usage)

> Chargé à la demande par `SKILL.md`. Le back EXPOSE le contrat ; `nodefony-studio-dev` le CONSOMME.

## Sommaire

- Endpoint admin data plane (broker `IAdminApi`, RBAC `ROLE_NODEFONY_ADMIN`, audit, duplex)
- Lien full-stack : côté front → `nodefony-studio-dev` (page + `useResource`/`ApiClient` + pont socket)

---

### Endpoint admin data plane (Studio)

```typescript
// Producteur (module http/kernel/orm…) — importe SEULEMENT depuis "nodefony" (jamais framework : cycle)
import type { IAdminApi, IAdminRegistry } from "nodefony";

export function createXxxAdminApi(mod: MyModule): IAdminApi {
  return {
    adminNamespace: "xxx",
    adminDescriptor: () => ({ name: "xxx", order: 50 }),
    adminEndpoints: () => [
      {
        path: "/things",
        method: "GET",
        role: "ROLE_NODEFONY_ADMIN",
        handler: () => ({ things: [] }),
      }, // succès = donnée BRUTE (pas {body}, sinon double-wrap)
    ],
  };
}
// enregistrement dans onKernelBoot : (this.kernel.container.get("adminBroker") as IAdminRegistry).register(api)
```

- Routes admin = **≥3 segments** `/nodefony/<ns>/api/*` (jamais mono-segment → collision SPA Studio).
- L'enveloppe `{status,headers,body}` n'est lue que si `status` OU `headers` présent (sinon donnée brute).
- RBAC : `request.roles` vide tant que P6 absent → 403 inactif (mock), s'activera sans changer le code.
- Le front consomme `store.api.getAbsolute<T>("/nodefony/xxx/api/things")`. Per-instance (header `x-nodefony-instance`).

---

## Côté FRONT (full-stack) — consommation Studio

Le pendant front de cet endpoint vit dans **`nodefony-studio-dev`** :

- page sous `routes/`, fetch via `useResource(() => store.api.getAbsolute(...))` (HTTP) ou pont `api.request` (socket) ;
- contrat partagé = types `I*Api`/`I*Controller` exportés (jamais une copie figée). Voir `nodefony-studio-dev` → `reference/realtime.md` + recette « page données ».

## ▸ Partie B — API, internals & gotchas

> Chargé à la demande. **Autosuffisant** : coder avec `@nodefony/framework` depuis le **dist npm**
> seul (projet consumer, sans le source). Rôle de CE fichier = **surface API + internals + gotchas
> PROPRES au framework**. NE duplique PAS : recettes d'usage → `reference/recipes-{core,http,admin}.md` ;
> gotchas transverses (idempotence codes RFC, hot-path, ALS, redirect whitelist…) → `reference/gotchas.md` ;
> sécurité (coder en sûreté, sources) → `reference/security.md`.
>
> Ancres `fichier:ligne` relatives à `src/packages/@nodefony/framework/`. Intemporel (pas de dates/phases).

## Sommaire

- [Purpose](#purpose)
- [Exports publics (`index.ts`)](#exports-publics-indexts)
- [API — `Router`](#api--router)
- [API — `Route`](#api--route)
- [API — `Resolver`](#api--resolver)
- [API — `Controller` (+ `ResourceController`, controllers concrets)](#api--controller)
- [API — Décorateurs](#api--décorateurs)
- [API — `AdminBroker` / `IAdminApi` / `AdminApiController`](#api--adminbroker--iadminapi--adminapicontroller)
- [API — Moteur de vues (Eta)](#api--moteur-de-vues-eta)
- [API — Idempotence (store + registre)](#api--idempotence-store--registre)
- [Internals — pipeline de résolution](#internals--pipeline-de-résolution)
- [Internals — `match()` + methodOverride + 405/host](#internals--match--methodoverride--405host)
- [Internals — seam sécurité](#internals--seam-sécurité)
- [Internals — seam idempotence](#internals--seam-idempotence)
- [Internals — `callController`/`executeAction`/`initialize`/scope](#internals--callcontrollerexecuteactioninitializescope)
- [Internals — `RouteActionMeta` (memo)](#internals--routeactionmeta-memo)
- [Internals — contrat de retour controller](#internals--contrat-de-retour-controller)
- [Gotchas spécifiques framework](#gotchas-spécifiques-framework)

---

## Purpose

Routeur HTTP+WS + Controller de base + Resolver + décorateurs (style Symfony `@route`/`@controller`
fusionnés avec NestJS `@Get`/`@Body`/`@IsGranted`) + data plane admin Studio + moteur de vues Eta.
Dépend de `@nodefony/http` (Context/Request/Response) et de `nodefony` (core : Service, Injector,
RequestContext, contrats `IAdminApi`/`IIdempotencyStore`). **Ne peut JAMAIS importer
`@nodefony/security`** (security dépend de framework) → tout service sécu est résolu **par nom** via le
container (`authorization`, `authFlow`, `tokenService`…).

---

## Exports publics (`index.ts`)

`Framework` (default, classe `Module`). Nommés (`index.ts:324`) :

- **Classes** : `Controller`, `ResourceController`, `Route`, `Router`, `Resolver`, `AdminBroker`,
  `MemoryIdempotencyStore`, `AdminApiController`, `Eta`.
- **Controllers d'auth concrets** + leur `mount*` : `SessionAuthController`/`mountSessionAuthRoutes`,
  `TokenAuthController`/`mountTokenAuthRoutes`, `WebAuthnController`/`mountWebAuthnRoutes`,
  `OAuth2Controller`/`mountOAuth2Routes`, `ApiKeyController`/`mountApiKeyRoutes`,
  `TotpController`/`mountTotpRoutes`.
- **Producteurs admin** : `createKernelAdminApi`, `createFrameworkAdminApi`, `createSyslogAdminApi`.
- **Décorateurs** : `route`, `controller`, `controllers`, `Get`, `Post`, `Put`, `Delete`, `Patch`,
  `Options`, `Head`, `All`, `Domain`, `BypassFirewall`, `IsGranted`, `RequireScope`, `Anonymous`,
  `Csp`, `CsrfProtect`, `CsrfExempt`, `Idempotent`, `CurrentUser`, `Scope`, `UseSession`, `HttpCode`,
  `Header`, `Redirect`, `Param`, `Body`, `Query`, `Headers`, `Cookie`, `Session`, `Req`, `Res`,
  `UploadedFile`, `UploadedFiles`, `routeExpectsBodyStream`.
- **Idempotence** : `registerIdempotencyStore`, `getIdempotencyStoreFactory`, `listIdempotencyStores`.
- **Config** : `frameworkConfigSchema`, `frameworkConfigJsonSchema`. `graphql` (façade @graphql-tools).
- **Types** : `IController`, `IRoute`, `IResolver`, `IAdminBroker`, `IAdminRoute`, `IIdempotencyStore`,
  `IdempotencyOutcome`, `IdempotentResponse`, `IResourceService`, `ControllerScope`, `SecurityClause`,
  `SecurityRequirement`, `CspDirectives`, `FrameworkConfig`, `IdempotencyStoreFactory`…

> ⚠️ `Twig`/`Ejs` **n'existent plus** : moteur unique = `Eta` (cf [moteur de vues](#api--moteur-de-vues-eta)).
> Les `module-level` `frameworkConfigSchema` et `MemoryIdempotencyStore` sont enregistrés via
> `@services([Router, Eta, AdminBroker, MemoryIdempotencyStore])` (`index.ts:123`).

**Module `Framework`** (`index.ts:124`) — hooks : `onKernelRegister` (valide config Zod →
`this.options`) · `onKernelBoot` (résout store d'idempotence distribué si `idempotency.store!=="memory"`,
fail-loud prod / fail-soft dev) · `onKernelReady` (register producteurs admin kernel/framework/syslog +
`broker.mountAll()` PUIS monte conditionnellement les routes d'auth selon présence du service :
`authFlow`→sessionAuth, `tokenService`→token, `webauthn`, `oauth2`, `apiKeys`, `totp` ; absent = 404,
0 surface).

---

## API — `Router`

Service `@injectable()` `"router"` (`nodefony/service/router.ts:124`). Table `static routes: Route[]`
**module-level, partagée process-wide** (`router.ts:48`,`126`).

| Méthode                         | Signature                                                                 | Rôle                                                                          |
| ------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------- |
| `resolve`                       | `(ctx, cleanPathOverride?, methodOverride?) → Resolver` (`router.ts:190`) | point d'entrée du routage                                                     |
| `resolveController`             | `(ctx, "module:ctrl:action") → Resolver` (`router.ts:305`)                | forward interne                                                               |
| `getRoutes`                     | `(name) → Route                                                           | Route[]` (`router.ts:326`)                                                    | lookup / dump |
| `removeRoutes`                  | `(name?) → void` (`router.ts:335`)                                        | retire 1 route (ou tout si vide) + invalide l'index                           |
| `matchRoutes`                   | `(path) → RegExpExecArray[]` (`router.ts:315`)                            | toutes les routes dont le pattern matche                                      |
| `getSingletonController`        | `(ctor, create) → Promise<Controller>` (`router.ts:161`)                  | cache promesse singleton (V4.3)                                               |
| `static createRoute`            | `(name, RouteOptions) → Route` (`router.ts:350`)                          | push table + invalide l'index                                                 |
| `static setController`          | `(ctor, module) → ctor` (`router.ts:356`)                                 | `proto.module` (writable:false) + clé `module:Class` + propage `route.module` |
| `static getRoutesForController` | `(ctor) → Route[]` (`router.ts:390`)                                      | log des routes d'un controller                                                |

---

## API — `Route`

`Route implements IRoute` (`nodefony/src/Route.ts:122`). `RouteOptions` (`Route.ts:94`) :
`path`, `constructor`, `classMethod`, `prefix`, `method`, `host`, `defaults`, `requirements`,
`filePath`, **`bypassFirewall?`** (court-circuite le firewall, défaut `false`). `RouteRequirements`
(`Route.ts:115`) : `domain`, `scheme`, `methods` (`HTTPMethod[]|HTTPMethod|"a,b"`), `protocol`.

Champs notables : `variables: string[]` = **NOMS** des params `{x}` (`Route.ts:131`) ; `pattern: RegExp`
(compilée flag `i`) ; `methodsSet`/`methodsAllow`/`varRegexp` (pré-compilés au boot) ; `hostRegexp`
(vhosts) ; `bodyStream?`/`actionMeta?` (memo lazy) ; `bypassFirewall`.

Méthodes : `static cleanPathname(ctx)` (`Route.ts:204`, pathname sans slash final, **1×/req**) ·
`match(ctx, cleanPath?, methodOverride?)` (`Route.ts:212`) · `compile()` (`Route.ts:300`) ·
`compileRequirements()` (`Route.ts:324`) · `matchRequirements(ctx, methodOverride?)` (`Route.ts:526`) ·
`matchHostname(ctx)` (`Route.ts:482`, 403 si vhost interdit) · `addRequirement`/`getRequirement` ·
`generateId()` (md5) · `toObject()`/`toLogLine()`.

---

## API — `Resolver`

`Resolver implements IResolver` (`nodefony/src/Resolver.ts:87`). **POJO per-requête, n'étend PAS
`Service`** ; 1 par requête HTTP, 1 par connexion WS (réutilisé par message). Cache du controller sur
`context.container` clé `"controller"` (survit au Resolver).

Champs : `controller`, `actionName`, `action`, `route`, `variables: unknown[]` (VALEURS matchées),
`resolve`, `bypassFirewall`, `acceptedProtocol`, `queryOverride` (pont WS-RPC, `Resolver.ts:108`),
`methodOverride` (méthode logique WS, `Resolver.ts:117`).

| Méthode                  | Signature                                                                           | Rôle                                           |
| ------------------------ | ----------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------ |
| `match`                  | `(route, ctx, cleanPath?) → map                                                     | undefined` (`Resolver.ts:123`)                 | délègue `route.match`, pose route + intents sur le ctx |
| `parsePathernController` | `("module:ctrl:action") → void` (`Resolver.ts:186`)                                 | forward                                        |
| `getMatchedParams`       | `() → Record<string,unknown>` (`Resolver.ts:171`)                                   | snapshot `{name}`→valeur (+ `*`)               |
| `newController`          | `(ctx?) → Promise<Controller>` (`Resolver.ts:237`)                                  | instancie (DI) + cache, gère singleton         |
| `executeAction`          | `(data?, reload?, metaArg?) → Promise<{result, redirectMeta?}>` (`Resolver.ts:306`) | **exécute SANS rendre** (seam multi-transport) |
| `callController`         | `(data?, reload?) → Promise<unknown>` (`Resolver.ts:385`)                           | exécute **PUIS rend** (pipeline normal)        |
| `returnController`       | `(result) → Promise<unknown>` (`Resolver.ts:648`)                                   | normalise la valeur vers le transport          |

---

## API — `Controller`

`Controller extends Service implements IController` (`nodefony/src/Controller.ts:112`). Statiques :
`prefix = "/"` ; **`scope: ControllerScope = "request"`** (`"request"|"singleton"`, posé par `@Scope`,
lu via `new.target`).

**Getters/setters per-request (V4.1)** — dérivent du `context` LIVE (`shadow ?? context.x`), 0 alloc :
`context` (`Controller.ts:146`, retombe sur `RequestContext.getContext()` pour un singleton), `route`
(via `context.resolver`), `request`, `response`, `method`, `queryGet`, `query`, `queryFile`,
`queryPost`, **`session`** (getter direct `context.session ?? null`, `Controller.ts:229` — **plus de
`startSession()`** ; activation par `@UseSession`/`@Session`/cookie). `module`, `template` (Eta).

| Méthode                                             | Signature                                                                  | Rôle                                                           |
| --------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `renderJson`                                        | `(obj, status?, headers?) → Promise<Response>` (`Controller.ts:353`)       | JSON + `content-type`                                          |
| `render`                                            | `(data, encoding?, status?, headers?)` (`Controller.ts:273`)               | délègue `context.render`                                       |
| `renderResponse`                                    | `(data, encoding?, status?, headers?)` (`Controller.ts:290`)               | `context.send` brut                                            |
| `renderView`                                        | `(path                                                                     | FileClass, param={}, status?, headers?)` (`Controller.ts:308`) | lit le fichier → `template.render` (Eta) → HTML, injecte les helpers frontend |
| `renderFileDownload`                                | `(file, options?, headers={}) → Promise<ReadStream>` (`Controller.ts:463`) | `attachment`                                                   |
| `renderMediaStream`                                 | `(file, headers={}, options={})` (`Controller.ts:599`)                     | Range RFC 9110 (`parseByteRange` → 206/416)                    |
| `streamFile`                                        | `(file, headers?, options={}) → Promise<ReadStream>` (`Controller.ts:488`) | pipe + cleanup fd (client parti)                               |
| `redirect`                                          | `(url, status?, headers?)` (`Controller.ts:372`)                           | délègue `context.redirect`                                     |
| `forward`                                           | `("module:ctrl:action", param?)` (`Controller.ts:406`)                     | re-route interne (`reload:true`)                               |
| `getSession`/`getFlashBag`/`setFlashBag`/`addFlash` | (`Controller.ts:368`,`386`)                                                | session/flash                                                  |
| `getFileAsync`                                      | `(file                                                                     | string) → Promise<FileClass>` (`Controller.ts:446`)            | stats async (préférer à `getFile`, sync `@deprecated`)                        |

**`ResourceController<T>`** (`nodefony/src/ResourceController.ts:67`) — controller souverain
**`static scope = "singleton"`** (stateless). Service injecté `IResourceService<T>` (`find`/`findById`
requis ; `create`/`updateOne`/`delete` optionnels). Helpers `protected` retournant la **valeur brute**
(seam multi-transport) : `listResource(criteria?)`, `getResource(id)`, `createResource(data)` (501 si
read-only), `updateResource(criteria, data)`, `removeResource(criteria)`. **Aucun critère implicite**
(pas de `find(this.queryGet)` → deny-by-default).

**Controllers concrets** (montés conditionnellement par `Framework.onKernelReady`, cf
[exports](#exports-publics-indexts)) :

| Controller              | `mount*`                 | Service requis | Rôle                                          |
| ----------------------- | ------------------------ | -------------- | --------------------------------------------- |
| `AdminApiController`    | (broker)                 | —              | pont unique data plane admin                  |
| `SessionAuthController` | `mountSessionAuthRoutes` | `authFlow`     | login/logout/me BFF (routes `bypassFirewall`) |
| `TokenAuthController`   | `mountTokenAuthRoutes`   | `tokenService` | émission/rotation JWT                         |
| `WebAuthnController`    | `mountWebAuthnRoutes`    | `webauthn`     | cérémonies passkeys                           |
| `OAuth2Controller`      | `mountOAuth2Routes`      | `oauth2`       | social login (BFF)                            |
| `ApiKeyController`      | `mountApiKeyRoutes`      | `apiKeys`      | gestion PAT (zone data plane)                 |
| `TotpController`        | `mountTotpRoutes`        | `totp`         | self-service 2FA TOTP                         |

---

## API — Décorateurs

Tous dans `nodefony/decorators/routerDecorators.ts`. Reposent sur `reflect-metadata`
(`experimentalDecorators` requis). N'écrivent **QUE de la metadata** (0 logique sécu/cycle).

**Routage** : `controllers(ctrls)` (classe Module, `:18` — hook `onBoot` → `Router.setController`) ·
`controller(prefix)` (classe controller, `:75` — lit la metadata `@route` → `Router.createRoute`) ·
`route(name, RouteOptions)` (méthode, `:157`).

**Méthode HTTP** (factory `httpMethodDecorator`, `:340` ; auto-name `Class::method`) :
`@Get/@Post/@Put/@Delete/@Patch/@Options/@Head(path?, options?)` → `requirements.methods:[VERB]`
(`:361`). `@All(path?, options?)` (`:374`) = **aucun** `requirements.methods` (matche toutes).
`options = Omit<RouteOptions,"path"|"method">`.

**Réponse** (Reflect, appliqués par le Resolver) : `@HttpCode(status)` (`:387`) · `@Header(k, v)`
(accumulable, `:398`) · `@Redirect(url, status=302)` (`:412`).

**Paramètres** (factory `paramDecoratorFactory`, `:946` ; `(key?)`) — `ParamSource` (`:250`) :
`@Param(key?)` (`:966`, var de route ; `@Param()`=tous) · `@Query(key?)` (`:967`) · `@Body(keyOr{stream})`
(`:976` ; `@Body({stream:true})`=flux brut `Readable`, saute le parse) · `@Headers(key?)` (`:999`,
lookup lowercase) · `@Cookie(key?)` · `@Session(key?)` (active la session) · `@CurrentUser()` (`:1003`,
user ALS, jamais le credential) · `@Req()`/`@Res()` · `@UploadedFile()` (1er fichier) /
`@UploadedFiles()` (tous).

**Sécurité** (déclaratif ; décision rendue par voter `authorization` par nom au runtime) :
`@IsGranted(attr|attr[], {subject?})` (`:664` — clause `anyOf` en OR ; empilage = AND ; `subject`=nom
de param de route) · `@RequireScope(scope|scope[])` (`:761` — axe scopes `api:action`, metadata
DÉDIÉE pour la découverte boot ; no-op pour session humaine) · `@Anonymous()` (`:712` — public :
pose anonymous **+** bypassFirewall, override `@IsGranted` de classe).

**CSP/CSRF** : `@Csp({"frame-src":[…]})` (`:826`, additif classe+méthode) · `@CsrfProtect()` (`:888`,
synchronizer token HMAC) · `@CsrfExempt()` (`:897`, hors CSRF mais auth conservée).

**Idempotence** : `@Idempotent({required?})` (`:926`) — `IdempotentMeta{required}` (défaut `true`=strict).
No-op GET/WS-handshake ; précédence méthode > classe.

**Cycle de vie / divers** : `@Scope("singleton"|"request")` (`:552`, classe — pose `static scope`) ·
`@UseSession({context?,readOnly?,eager?})` (`:585`, classe+méthode — **unique** activation de session
explicite ; `resolveSessionIntent` `:618`) · `@Domain(pattern|patterns)` (`:448`, classe+méthode →
`route.host`) · `@BypassFirewall` (`:509` — **flag SANS parenthèses**, route publique).

> Duals classe+méthode (`@Domain/@BypassFirewall/@IsGranted/@RequireScope/@Csp/@Idempotent/@UseSession/
@Anonymous`) : `target` = ctor (classe) ou prototype (méthode) → idiome `any` polymorphe assumé.

---

## API — `AdminBroker` / `IAdminApi` / `AdminApiController`

> Recette PRODUCTEUR (créer un endpoint admin) = `reference/recipes-admin.md`. Ici = surface + internals.

**`IAdminApi`** (contrat producteur, dans le **core** `nodefony` — inversion de dépendance) :
`adminNamespace`, `adminDescriptor()`, `adminEndpoints() → IAdminEndpoint[]`. `IAdminEndpoint` :
`path` (relatif), `method`, `role`, `handler(IAdminRequest)`, `public?`. Producteur externe importe
SEULEMENT depuis `"nodefony"` (`IAdminApi`/`IAdminRegistry`), jamais framework (cycle).

**`AdminBroker`** Service `"adminBroker"` `implements IAdminBroker` (`nodefony/service/AdminBroker.ts:21`).
Constantes : `rootPrefix="/nodefony"`, `apiSegment="api"`, `defaultRole="ROLE_NODEFONY_ADMIN"`.

| Méthode       | Signature                                          | Note                                         |
| ------------- | -------------------------------------------------- | -------------------------------------------- |
| `register`    | `(api) → this` (`AdminBroker.ts:45`)               | **throw** si déjà monté / namespace dup      |
| `unregister`  | `(ns) → boolean` (`:61`)                           | retire routes si monté                       |
| `has`         | `(ns) → boolean` (`:79`)                           | (override de `Service.has`)                  |
| `getApi`      | `(ns) → IAdminApi?` (`:83`)                        | ⚠️ **PAS `get`** (masquerait `Service.get`)  |
| `resolvePath` | `(ns, path) → "/nodefony/<ns>/api/<path>"` (`:91`) |                                              |
| `resolve`     | `(routeName) → IAdminRoute?` (`:96`)               | lookup O(1) du dispatch                      |
| `routes`      | `() → readonly IAdminRoute[]` (`:100`)             | introspection                                |
| `mountAll`    | `() → void` (`:104`)                               | idempotent ; 1 `Router.createRoute`/endpoint |

**`mountAll`** : chaque endpoint GET monté `methods:[method,"WEBSOCKET"]` (`AdminBroker.ts:123`) →
invocable par le pont WS-RPC `api.request` ; `endpoint.public` → `role=""` (RBAC court-circuité).
Nom de route = `admin.<ns>.<method>.<path>`. `Router.setController(AdminApiController, …)` gardé par
`hasOwnProperty("module")` (idempotent).

**`AdminApiController.dispatch(...args)`** (`nodefony/controller/AdminApiController.ts:60`) — 1 controller
pour N endpoints. `runAdmin()` (`:86`) transport-agnostique : `broker.resolve(route.name)` → `buildRequest`
(Context→`IAdminRequest`, params zippés depuis `route.variables`, body via ALS du pont WS sinon
`queryPost`) → **RBAC** `isAdminGranted(roles, role)` (`src/adminRbac.ts`, fail-closed, 403 si rôle
absent ; `role===""`=public) → **idempotencyGate** → `handler` → `normalize`. Rendu : **HTTP** =
`renderJson(body,status,{…,"x-nodefony-instance":pid})` ; **WS** = body NU, status≥400 → `RpcError(-32000,
{status,body})`.

`normalize()` (`:255`) : l'enveloppe `{status,headers,body}` n'est reconnue que si `status` OU `headers`
présent — sinon donnée brute (⚠️ un `{body}` seul = double-wrap `{body:{body}}`).

---

## API — Moteur de vues (Eta)

**Moteur UNIQUE** = `Eta` (remplace EJS + Twig, retirés). `Eta extends Template` service `"template"`
(`nodefony/service/Eta.ts:34`). Choisi : écrit en TS (types fournis), ESM natif, autoescape, délimiteurs
`<% %>`/`<%= %>` (pas de collision TS/JSON/JSX).

- `render(str, data={}) → Promise<string>` (`Eta.ts:51`) — source chaîne (chemin chaud du Controller).
- `renderFile(path, data={}) → Promise<string>` (`Eta.ts:66`) — depuis un fichier (CLI/Builder).
- Options : `autoEscape:true` (échappe `<%= %>` ; brut volontaire `<%~ %>`), `useWith:true` (locals nus
  comme EJS), `cache` = `true` en prod uniquement (`Template.ts:20`, `Eta.ts:41`).

`Controller.renderView` lit le fichier (`FileClass`) puis appelle `template.render(source, locals)` ;
`withFrontendLocals` injecte `frontendTags`/`frontendDocument`/`asset` (service `frontend` par nom).

---

## API — Idempotence (store + registre)

**`IIdempotencyStore`** (contrat dans le **core** `nodefony`, re-export façade
`nodefony/interfaces/IIdempotencyStore.ts`) : `begin(key, fingerprint) → IdempotencyOutcome` (state :
`fresh`|`in-flight`|`replayed`{response}|`mismatch`) · `complete(key, IdempotentResponse)` · `abort(key)`
(+ `gc?` pour les stores SQL sans TTL natif). Sync (mémoire) **ou** async (distribué) → `evaluateIdempotency`
`await`e `begin`.

**`MemoryIdempotencyStore`** (`nodefony/service/IdempotencyStore.ts:41`, service `"idempotencyStore"`,
défaut `@services`) : `Map` **lazy** (1er `begin`), 0 timer/listener (purge passive + éviction FIFO).
TTL réponse 600 s, lease in-flight 60 s, cap 1000 (`:11`).

**Registre de stores distribués** (`nodefony/src/idempotencyStoreRegistry.ts`) :
`registerIdempotencyStore(name, factory)`, `getIdempotencyStoreFactory(name)`, `listIdempotencyStores()`.
Driver **`redis`** builtin (enregistré au chargement de `index.ts:107`, résout le service `redis` par
nom → 0 import `@nodefony/redis`, 0 cycle). Sélection par config `idempotency.store`
(`nodefony/config/schema.ts:40`) ; `gcIntervalS` (défaut 600, 0=désarmé) + `gcJitter`. Échec de
résolution : **prod = fatal** (anti double-effet cluster) ; **dev/test = WARNING + fallback mémoire**
(`index.ts:182`).

---

## Internals — pipeline de résolution

```
Router.resolve(ctx)                         router.ts:190
  cleanPath = Route.cleanPathname(ctx)      (1× pour tout le scan)
  index = routeIndex | buildRouteIndex()    partition statics(Map path.toLowerCase) / dynamics
  Pass 1 : merge ordonné littérales(path) ∪ dynamiques (par position d'insertion)
     resolver.match(route, ctx, cleanPath)  → 1ʳᵉ route qui matche path+method → return resolver
  Pass 2 : aucun match + HTTP → 405 + header Allow agrégé (RFC 9110 §15.5.6)
HttpKernel → resolver.callController()      Resolver.ts:385
  meta = resolveActionMeta(route)           memo, 0 Reflect/req
  meta.idempotent !== null ? _callWithIdempotency : executeAction + _handleRedirect
executeAction()                             Resolver.ts:306
  meta.security !== null → _enforceSecurity (403 AVANT instanciation — Zero Trust)
  controller = container.get("controller") | newController()   (instanceof check WS)
  args = paramsMeta ? _buildParamArgs : [...variables(, ...data)]
  _applyResponseMeta(meta)                  @HttpCode + @Header
  return { result: action(...args), redirectMeta }
_handleRedirect → returnController          normalise vers transport
```

**Index de routes** (`router.ts:64`-`121`) : `statics` = paths littéraux (Map → candidates O(1)) ;
`dynamics` = `{var}`/`*`/metachar regex → scan ordonné. `resolve()` fusionne **par position
d'insertion** → même séquence que le scan linéaire MOINS les littérales d'autres paths. Invalidé
(`routeIndex=null`) par `createRoute`/`removeRoutes` + garde-fou photo `length/first/last` (mutations
directes de `routes` des bancs de test). Ne court-circuite JAMAIS `resolver.match()`.

`match()` pose AUSSI sur le contexte (post-match, `Resolver.ts:144`-`154`) : `sessionIntent`,
`cspDirectives` (si `@Csp`), `csrfProtect`/`csrfExempt` — consommés plus tard par le firewall.

---

## Internals — `match()` + methodOverride + 405/host

`Route.match(ctx, cleanPath?, methodOverride?)` (`Route.ts:212`) : pattern-test → `hydrateDefaultParameters`
→ **`matchHostname` AVANT `matchRequirements`** (la ressource cible inclut le host : un vhost interdit
jette **403**, jamais une 405 qui fuiterait les méthodes d'un autre vhost) → renvoie `map` = captures
`res.slice(1)` (array hybride + accès par nom + `*`).

`matchRequirements(ctx, methodOverride?)` (`Route.ts:526`) : `methods` via `methodsSet` (Set UPPERCASE
pré-compilé) → 405 `HttpError{code:405, allow}`. **methodOverride** (pont WS-RPC d'une mutation) : sur
le transport `WEBSOCKET` unique, exige `methodsSet.has("WEBSOCKET") && has(methodOverride)` pour lever
l'ambiguïté GET-via-WS / POST-via-WS. `protocol` WS → 1002.

Pass 2 du Router (`router.ts:261`) : si aucune route ne matche (ou pass 1 finit sur 405) ET HTTP →
agrège l'`Allow` de **toutes** les routes du path **sur ce vhost** (`isDomainAllowed`, exclut les autres
vhosts) → 405 unique. Pseudo-méthode `WEBSOCKET` exposée dans l'agrégat d'un path duplex.

---

## Internals — seam sécurité

`_enforceSecurity(req: SecurityRequirement)` (`Resolver.ts:526`), appelé dans `executeAction` **AVANT
`newController()`** (un 403 court-circuite l'instanciation DI + `initialize()`). Résout le service
`authorization` **par nom** (`IAuthorizer.decide(token, attribute, subject?) → Promise<boolean>`,
`Resolver.ts:53`) ; `token = RequestContext.get()?.token`. **Fail-closed** : `!authz || token===undefined`
→ 403. Clauses en **AND** (`req.clauses`), attributs d'une clause en **OR** (`clause.anyOf`) ; `subject`
résolu via `_resolveSubject(name)` (`Resolver.ts:564`, depuis `route.variables`). `meta.security===null`
(99 % des routes) → 0 lookup/await/alloc.

`SecurityRequirement` figé par `computeSecurityRequirement` (`routerDecorators.ts:1256`) = fusion
`@IsGranted` (rôles) **+** `@RequireScope` (scopes) classe+méthode en AND. `@Anonymous` méthode →
`null` (override classe). Découverte boot des scopes : `collectDeclaredApiScopes()`
(`nodefony/src/scopeCatalog.ts:29`, scanne `Router.routes` → groupes par API).

---

## Internals — seam idempotence

Logique normative **partagée** = `nodefony/src/idempotency.ts` : `evaluateIdempotency(opts) →
IdempotencyVerdict` (`execute`|`guarded{key}`|`replay{response}`|`reject{status,message}`) +
`resolveIdempotencyKey(alsKey, header)` (ALS > header, borne `IDEMPOTENCY_KEY_MAX=255`) +
`resolveIdentity(user)` (username/identifier/id, fallback `getUserId()`, `null`=pas de cache) +
`computeFingerprint(parts)` (SHA-256) + `isMutationMethod(m)` (POST/PUT/PATCH/DELETE). `requiredEffective
= required || isWs` (WS toujours strict).

**Deux call-sites** traduisent le MÊME verdict :

- **userland** `@Idempotent` → `Resolver.callController` branche vers `_callWithIdempotency(meta, …)`
  (`Resolver.ts:425`) si `meta.idempotent !== null`. No-op si méthode sûre. Verdict : `reject`→
  `nodefonyError(status)` ; `replay`→ rejoue la réponse mémorisée (status+headers+body) SANS exécuter ;
  `execute`→ exécution directe ; `guarded`→ exécute puis `store.complete(key,{status,body})` (succès)
  ou `store.abort(key)` (échec). Réponse mémorisée = **valeur RETOURNÉE** par l'action (un `this.render`
  manuel n'est pas rejoué fidèlement).
- **admin** → `AdminApiController.idempotencyGate(adminRoute, request)` (`AdminApiController.ts:158`) =
  ne fait que TRADUIRE le verdict en `{shortCircuit}` / callbacks `onSuccess`/`onFailure`. `required:false`
  (admin n'exige la clé qu'en WS).

---

## Internals — `callController`/`executeAction`/`initialize`/scope

- **`callController`** (`Resolver.ts:385`) : résout `meta` **1×** (memo) puis le PASSE à `executeAction`
  → 0 double résolution.
- **`executeAction`** (`Resolver.ts:306`) : exécute et renvoie `{result, redirectMeta}` **sans rendre**
  (réutilisé par le pont WS-RPC `invoke` / futur GraphQL). Garde-fou : pointeur container `"controller"`
  vérifié `instanceof this.controller` (connexion WS multi-invoke → réécriture du pointeur).
- **`newController`/`_createController`** (`Resolver.ts:237`,`274`) : `Injector.instantiate(ctor, ctx)`
  → pose `module` (shadow 1×) → `await controller.initialize()` si présent
  (`ControllerWithInitialize`, hook **per-request**, hot path, JAMAIS borné — distinct du `init()` de
  boot des services).
- **Scope singleton** (V4.3) : `ctor.scope==="singleton"` → bindé au container **KERNEL** (jamais celui
  de la requête, `clean()`é au teardown) ; instance cachée comme **promesse** sur
  `Router.getSingletonController` (anti-race) ; `initialize()` 1×/création ; `setRoute`/`module` skippés ;
  l'état per-request arrive UNIQUEMENT par args décorés + ALS. **Data race** si champ mutable par requête
  sur `this` → opt-in stateless seulement.

---

## Internals — `RouteActionMeta` (memo)

`RouteActionMeta` (`routerDecorators.ts:1148`) gèle par route : `paramsMeta`, `redirectMeta`, `httpCode`,
`headerEntries` (`Object.entries` 1×), `sessionIntent`, `security`, `cspDirectives`, `csrfProtect`,
`csrfExempt`, `idempotent`. **Mémoïsé** au 1er hit sur `route.actionMeta` via `resolveActionMeta(route)`
(`:1386`) → **0 `Reflect.getMetadata` par requête** (avant ~6/req). `computeActionMeta(ctor, method)`
(`:1338`) = calcul pur (chemin froid forward sans route). Objet **PARTAGÉ entre requêtes — ne JAMAIS
muter** (`Object.freeze` sur `security`/`cspDirectives`/`idempotent`). Posé après `generateId()` → hash
de route stable.

Fonctions pures exportées (testables sans serveur) : `buildParamArgs(metas, IParamArgContext)` /
`resolveParamArg(meta, ctx)` (`:1103`,`:1050`) · `routeExpectsBodyStream(route)` (`:1121`, memo
`route.bodyStream`, lu **en amont** par `handleHttp` pour sauter le parse) · `resolveSessionIntent`
(`:618`) · `extractActionScopes` (`:1232`).

---

## Internals — contrat de retour controller

`returnController(result)` (`Resolver.ts:648`) normalise la valeur retournée par l'action vers le
transport (`switch(typeOf)`) :

| Valeur retournée                                   | Comportement                                                                |
| -------------------------------------------------- | --------------------------------------------------------------------------- |
| `Promise`/`BlueBird`/thenable                      | unwrap récursif puis re-dispatch (**bluebird requis**, ne pas retirer)      |
| `string`/`String`                                  | `context.send(result)`                                                      |
| `Http2Response`/`HttpResponse`/`WebsocketResponse` | retournée telle quelle (déjà rendue)                                        |
| `Buffer` (`typeOf==="buffer"`)                     | `send(buffer)` si pas déjà envoyé (sinon hang→408)                          |
| `number`/`boolean`                                 | scalaire JSON (`setContextJson` + `render`) — `return 42` répond `"42"`     |
| `object`/`array` plain                             | auto-JSON (`render`) — **vaut aussi en WS** (`return {type:"pong"}` envoie) |
| instance de classe (entité ORM…)                   | NON sérialisée → `waitAsync=true` (warning dev, pas de hang muet)           |
| `void`/`null` + `isRedirect`                       | `context.send()`                                                            |
| `void`/`null`                                      | `waitAsync=true` (l'action a géré elle-même)                                |

`@Redirect` : action `void`/`null` → `_handleRedirect` (`Resolver.ts:617`) appelle `context.redirect(url,
code)` puis `returnController(undefined)` (un objet `{url, statusCode?}` retourné par l'action override).

---

## Gotchas spécifiques framework

- **`Router.routes` est statique module-level** : une seule table pour TOUT le process ;
  `removeRoutes()` affecte tout le monde (bancs de test : restaurer/swap la table).
- **Noms d'action RÉSERVÉS** : `session`, `request`, `response`, `context`, `method`, `get`, `set` —
  ce sont des **props/getters** de `Controller` qui shadow la méthode → `controller["session"]` renvoie
  la Session, pas l'action → `executeAction` jette « Route Action not found ».
- **`Twig`/`Ejs` n'existent plus** → moteur unique `Eta`. Pas de `renderTwig`/`renderEjs` (le MEMORY
  module les liste encore : périmé). Vue : `renderView` (lit fichier `.eta`).
- **Ordre des décorateurs** : `@route`/`@Get`… (méthode) évalués AVANT `@controller` (classe), car les
  décorateurs sont bottom-up et `@controller` LIT la metadata accumulée. `@controller` **supprime** la
  metadata après lecture (`routerDecorators.ts:135`).
- **Décorateurs de CLASSE sous `@controller`** : `@Domain`/`@BypassFirewall`/`@UseSession`/`@IsGranted`
  de classe doivent être placés SOUS `@controller` (appliqués bas→haut ; `@controller` doit les voir
  posés au moment où il construit les routes).
- **`@Param` index = `i`, pas `i+1`** : `route.match` renvoie `res.slice(1)` (captures SANS le
  full-match) → `variables[0]` = 1ʳᵉ capture. `route.variables` = NOMS ; `resolver.variables` = VALEURS,
  zippées par position.
- **Routes admin = ≥3 segments** `/nodefony/<ns>/api/*` (mono-segment → collision SPA Studio).
  `getApi` (jamais `get`) côté broker (`AdminBroker extends Service`). `register()` après `mountAll`
  → throw (routes figées).
- **Enveloppe admin double-wrap** : un handler qui renvoie `{body:…}` SANS `status`/`headers` est traité
  comme donnée brute → `{body:{body:…}}`. Succès défaut 200 = renvoyer la donnée BRUTE.
- **`@Scope` homonyme** : le core `nodefony` exporte aussi `Scope` (scope DI du Container) — le
  décorateur controller s'importe depuis `@nodefony/framework`.
- **`extractControllerFilePath`** (`routerDecorators.ts:207`) : regex stack-trace `controllers?/.*\.js`
  → ne capture le `filePath` d'une route qu'avec des fichiers **compilés `.js`** (no-op en ts-node).
- **Singleton stateless strict** : `@Scope("singleton")` / `ResourceController` → JAMAIS `this.x=…` par
  requête (data race). Rétrograder en `static scope="request"` si état per-request requis.
