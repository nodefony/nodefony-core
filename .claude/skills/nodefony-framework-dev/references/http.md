# @nodefony/http (pipeline/serveurs/WS/TLS) — référence complète (recettes + API + internals + gotchas)

> Chargé à la demande par `SKILL.md`. **1 concern = 1 fichier** : recettes copier-coller PUIS API publique + internals + gotchas du module. Vérité courante (édition en place, git = historique).

## ▸ Partie A — Recettes (copier-coller, usage)

> Chargé à la demande par `SKILL.md`. Recettes vérifiées sur le source. Détail-journal = `git log`.

## Sommaire

- Endpoint HTTP/WS (Controller + décorateurs `@Get`/`@Post`/`@route`)
- Autorisation par scope `@RequireScope` (P6.8 — axe distinct des rôles)
- Contrat de réponse RFC du cycle (HTTP **et** WS — crucial realtime)
- Tests d'intégration (terrain = `src/modules/test`)
- Certificats TLS (HTTPS 5152 / WSS — service `Certificate`)

---

### Endpoint HTTP/WS (Controller + décorateurs)

```typescript
import { Controller } from "@nodefony/framework";
import {
  controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  HttpCode,
  Header,
} from "@nodefony/framework";

@controller("/api/things")
export class ThingsController extends Controller {
  @Get("/") // requirements.methods=["GET"]
  list(@Query("limit") limit?: string) {
    return this.renderJson({ things: [] });
  }

  @Get("/{id}") // {id} = mono-segment [^/]+
  one(@Param("id") id: string) {
    return this.renderJson({ id });
  }

  @Post("/")
  @HttpCode(201)
  create(@Body() dto: ICreateThing) {
    return this.renderJson(dto);
  }
}
```

- **Lire la requête par décorateurs** : `@Body()`/`@Body("f")`, `@Param("x")`, `@Query("x")`, `@Header("x")`.
  ⚠️ **`this.context.body` est VIDE/non parsé** → un POST lu ainsi tombe sur le défaut en silence.
- En-têtes bruts : `this.context.request.headers.authorization` (clé **minuscule**, peut être `string|string[]`).
- `@Redirect("/url", 302)`. `redirect()` : whitelist RFC 9110 §15.4 `{301,302,303,307,308}`, **défaut = 302** (Found) ; code hors liste → fallback 302 + WARNING. 307/308 **préservent** méthode+corps, 303 force GET ; 301/302 peuvent muter POST→GET. Réponses : `renderJson` / `renderView` (moteur **Eta** — `renderTwig`/`renderEjs` n'existent plus) / `forward("mod:ctrl:action")`.
- **Vhosting** : `@Domain("regexp"|["a","b"])` (classe ou méthode, précédence `@route({host})` > méthode > classe) → **403** si l'`Host` ne matche pas (`domainMatcher` pur, conforme). Hosts de confiance = config **`trustedHosts`** (ex-`domainAlias`, renommé pour la sécu). ⚠️ ordre des checks : un **405** ne doit pas masquer un **403** (Router corrigé).
- **Ne jamais nommer une action** `session`/`request`/`response`/`context`/`method` (collision prop Controller → « Action not found »).
- **WS** : même controller. Handshake = `execute(null)` (⚠️ l'action reçoit `undefined`, **pas** `null` →
  tester `message == null`, ne jamais `.toString()` un message absent), puis `execute(message)`. Protocol =
  match exact string (mismatch → close 1002). Route résolue AVANT `connect()`.
- **Hook `initialize()`** (per-request, **opt-in**) : si le controller le définit, `Resolver.newController()`
  l'`await` **juste APRÈS l'instanciation DI (`Injector.instantiate`) et AVANT l'action** (HTTP **et** WS).
  Async, doit `return this`. Le `Controller` de base ne le déclare PAS (interface-marqueur `IInitializable`
  côté Resolver) → c'est un opt-in userland. Place idéale pour précharger des données communes à toutes
  les actions, vérifs pré-action. Une exception levée ici **annule l'action**. (⚠️ la session N'est PAS
  encore active dans `initialize()` — l'activation est au point pipeline, avant l'action ; utiliser
  `@UseSession({ eager: true })` si la session doit être prête dès `initialize()`.)
- **Session (refonte 2026-06-07 — plug runtime, plus de `startSession()`)** : activation = décorateur
  **`@UseSession({ context?, readOnly?, eager? })`** (classe/méthode, dual, patron `@Domain`) **OU** un
  paramètre **`@Session`** (intent implicite) **OU** un cookie de session existant (reprise **L1**).
  **Lazy** par défaut : 0 session / 0 write si rien déclaré (a tué le `sessionAutoStart` global = le ×23).
  Point d'activation **UNIQUE** `HttpKernel.startSession(context)` (HTTP **et** WS, symétrique) lit
  `context.sessionIntent` posé par `Resolver.match()` (`resolveSessionIntent`). Accès : `this.session`
  (**getter** sur `context.session`) / `@Session()` (objet) / `@Session("k")` (= `session.get("k")`).
  `Session.readOnly` → `save()` no-op. Cookie : `__Host-<name>` sur scheme **effectif** (TLS, honore
  X-Forwarded-Proto si trustProxy) via `Context.getSessionCookieName()`, réglable `cookie.hostPrefix`
  (`auto`|`true`|`false`). `regenerateId()` = seam P6 (anti-fixation). `absolute_timeout` (OWASP). Sessions =
  IoC (`SessionsService` registre statique, http n'importe aucun ORM ; handler `session.handler`, défaut `drizzle`).
- **Cookies** : `this.context.cookies` (`Cookies` map) — `getCookie(name)` / `setCookie(new Cookie(name, val, opts))`.
  Conformité RFC 6265 (SameSite/Secure/HttpOnly) → skill `nodefony-rfc`. Réponse : `HttpResponse`/`Http2Response`
  (`setBody`/`setStatus`/`redirect`) — le cas courant passe par `renderJson`/`render*`.
- **Points d'extension HttpKernel** (pluggables, singleton stateless 0-alloc) : `setRequestLogger(IRequestLogger)`
  (`DefaultRequestLogger`/`PrettyRequestLogger`/`JsonAuditLogger`) · `setErrorRenderer(IErrorRenderer)`
  (`DefaultErrorRenderer` → override pour RFC 7807, hide-stack prod, auth-challenge headers).

### Autorisation par scope `@RequireScope` (P6.8 ✅ — axe distinct des rôles)

Les **scopes** (`api:action`, modèle GitHub PAT classic) bornent un **token machine** (clé API / JWT /
OAuth), orthogonaux aux rôles. `@RequireScope` = **frère de `@IsGranted`** : MÊME seam (metadata →
`route.actionMeta.security` figé → `Resolver._enforceSecurity` → `authz.decide`), **0 touche au Resolver**
(les clauses de scope sont fusionnées dans le même `SecurityRequirement`). Décorateur dans `@nodefony/framework`
(0 import security), voter dans `@nodefony/security`.

```typescript
@controller("/api/orders")
@IsGranted("ROLE_USER") // axe RÔLE (qui tu es)
@RequireScope("orders") // axe SCOPE classe → s'applique à toutes les actions
class OrdersController extends Controller {
  @Get("/") @RequireScope("orders:read") list() {} // empilé = AND
  @Post("/") @RequireScope(["orders:write", "orders:admin"]) create() {} // tableau = OR
}
```

- **Enforcement** = `ScopeVoter` (built-in `voterRegistry`, à côté de `RoleVoter`) : `supports` = l'attribut
  contient `:` et ≠ `ROLE_*` ; `vote` = GRANT si `token.getScopes().includes(attr)`, sinon **ABSTAIN** (le
  default-DENY de l'`AuthorizationService` ferme ; jamais DENY = pas de veto sur les autres attributs OR).
- **No-op humain / fail-closed machine** : le voter dérive « scopable » du **`token.type`** —
  `session`/`userpassword`/`anonymous` = humain → GRANT (le scope ne bride QUE les tokens délégués) ; tout
  autre (`apikey`/`jwt`/`oauth2`/futur) = bridé. **Décision : PAS de `isScopable()` sur `IToken`** (écart au
  kit, assumé) — l'ajouter toucherait 4 impls + le module realtime (le pont WS `api.request` passe un
  `IRealtimeToken` à `decide`, ligne ~622 `RealtimeController`) + risquerait de désaligner le miroir
  `IRealtimeToken`. `type` est porté à l'identique par les DEUX contrats → le voter reste transport-agnostique.
- **Découverte au boot** (catalogue du formulaire de clés) : `extractActionScopes(ctor, method)` lit la
  metadata d'une action (dédupliquée) ; `collectDeclaredApiScopes()` (`framework/nodefony/src/scopeCatalog.ts`)
  scanne `Router.routes` → `[{api, scopes[]}]` groupé par préfixe. **Exposé via `ApiKeyController.capabilities`**
  (`+declaredScopes`), PAS un nouvel endpoint : ce controller vit dans `@nodefony/framework` (il VOIT le
  `Router`), est déjà fetché par le formulaire et déjà self-service — `@nodefony/security` ne voit pas les routes.
- **Banc** : `src/modules/test/nodefony/secure/ApiM2mController.ts` routes `/m2m/scoped/{read,write,export}`
  (NE PAS décorer `/whoami` = testé e2e P6.12). Prouvé live : clé `[m2m:read]` → read 200 / write 403 /
  export 403 / whoami 200 (downscoping : une clé d'admin bridée à `m2m:read` ne fait pas le reste).
- **Reste P6.8 (optionnel)** : niveau B RBAC ORM (`PermissionVoter` `PERM_*`), audience RFC 8707 (restreindre
  une clé à une API), fine-grained par ressource (slot `resources[]`).

### Contrat de réponse RFC du cycle (HTTP **et** WS — crucial realtime)

Le `Resolver.returnController` normalise le retour d'action. **Connaître le contrat évite le « trap »** :

- **`return <object|array>`** → **auto-JSON gardé** : `setContextJson()` + `render()`. Gardes : si `context.sended`
  déjà → no-op ; n'auto-JSON QUE `isPlainObject`/`isArray` (un stream/Buffer/instance n'est PAS sérialisé).
- **`return <string>`** → `ctx.send(result)`. **`return <Promise>`** → résolu puis re-normalisé.
- **`return undefined` SANS avoir `send/stream/render`** = **le trap** : la réponse reste pendante. En `development`,
  `HttpKernel.teardown` **WARN** (`waitAsync && !sended`) avec le nom de la route. → toujours `return` une valeur
  rendable, ou envoyer manuellement.
- **JSON sans charset** : `application/json` (et `+json`) émis **SANS** `; charset=` (RFC 8259 §11 — JSON = UTF-8
  par spec, un param charset est non conforme/ignoré). Le reste garde `; charset=utf-8`.
- **Headers par défaut** (RFC 9110) : `Content-Length` exact (omis sur HEAD/OPTIONS/TRACE + 204/304), `Date`
  (auto Node h1), `x-request-id` (généré ou echo du `X-Request-Id` client), `traceparent` echo. `statusMessage`
  réduit à l'ASCII imprimable avant `writeHead` (sinon `ERR_INVALID_CHAR`).
- **`forward("mod:Ctrl:action")`** = re-dispatch **interne** sur le **même** contexte (RFC : **pas** un 3xx, aucun
  `Location`, URL cliente inchangée, méthode/corps préservés). Status = celui du controller cible (défaut 200).
- **Codes de fermeture WS RFC 6455 §7.4** : coercition via le helper pur `toWsCloseCode(code)` (exporté de
  `WebsocketContext`). Émissibles conservés (1000-1003, 1007-1011, 3000-4999) ; HTTP 5xx→**1011**, 401/403→**1008**,
  autre 4xx (404…)→**4004** privé (⚠️ **PAS** de `4000+code`/`4404` inventé) ; 0-999 + réservés non émissibles
  (1004/1005/1006/1015)→1011. **`connection.on("error")` OBLIGATOIRE** sur toute socket ws (un `error` sans
  listener = crash process). Côté client (RealtimeClient) : politique de reco PAR code (cf `[[project_realtime_close_codes_client]]`).
- **`maxPayload` WS** (config `websocket.maxPayload`, défaut sûr **1 MiB** anti-DoS) → message trop gros = `ws`
  ferme **1009 « Message Too Big »** (RFC 6455 §7.4.1) ; l'`error` est captée par `onConnectionError` (pas de crash).
- **Throws** : pas de `try { … } catch (e) { throw e }` (no-op) ni `return await` dans le hot path (microtask
  en plus) — laisser l'erreur/le rejet remonter seul jusqu'à `HttpKernel.onError`.

### Tests d'intégration (terrain de jeu = `src/modules/test`)

Une route de test = à ajouter dans le **controller approprié** de `src/modules/test/nodefony/controller/`,
**un controller par feature** (ne pas gonfler `DefaultController`). Les tests `.ts` du pipeline tapent ces
routes (serveur requis). Écrire les tests **dans la même session** que le code. Existant : `/nodefony/test/*`
(context, crash sync/async/native, header-echo, memory), `…/rest/*` (session CRUD), `…/html/*` (stream/upload/media),
`…/als-test/*` (sondes ALS). Tout fichier test `.ts` commence par `/// <reference types="node" />`.

### Certificats TLS (HTTPS 5152 / WSS — auto-générés, service `Certificate`)

Le service `Certificate extends Service` (`@nodefony/http`) génère le cert au boot (`onBoot`) — **rien à
lancer à la main** pour un dev HTTPS standard. **3 stratégies** (`resolveStrategy`) :

| Stratégie  | Quand                                                              | Trust navigateur                             |
| ---------- | ------------------------------------------------------------------ | -------------------------------------------- |
| `explicit` | `certificates.{ca,key,cert}` fournis en config (PROD)              | selon ton cert                               |
| `mkcert`   | dev + `dev.useMkcert` + binaire mkcert + CA locale                 | ✅ trustée → **requis HMR cross-origin/WSS** |
| `forge`    | fallback auto-signé node-forge (CI, mkcert absent, prod sans cert) | ❌ non trusté (SAN présent)                  |

```jsonc
// config "module-http" : prod = fournir un vrai cert ; dev = laisser vide (auto)
certificates: { ca: "/etc/ssl/ca.pem", key: "/etc/ssl/private.key", cert: "/etc/ssl/cert.pem",
  dev: { useMkcert: true }, openssl: { size: 2048 } }   // size 4096 reco prod
```

- **HTTPS dev sans erreur navigateur** : `brew install mkcert nss && mkcert -install` (détecté via `mkcert -CAROOT`).
- `https.rejectUnauthorized` = `false` en dev (auto-signé), **TOUJOURS `true` en prod**.
- `npm run certificates` (`bin/generateCertificates.sh`) = **outil AVANCÉ** : PKI maison complète offline
  (root+intermediate CA + cert serveur + **cert client mTLS** + chain/haproxy.pem). CA **non** trustée navigateur.
  PAS le chemin par défaut. mTLS = token étendu sécurité (P6, `project_security_module_design`).

## ▸ Partie B — API, internals & gotchas

> Vérité courante (pas de journal). Permet de **coder avec** `@nodefony/http` sans le source, et de
> le **modifier/débugger**. Ancres `fichier:ligne` relatives à `src/packages/@nodefony/http/nodefony/`.
> **Ne couvre PAS** les recettes copier-coller (→ `references/http.md`) ni les gotchas
> transverses (→ `references/gotchas.md`). Ici = **surface exportée + mécanique interne + gotchas propres à http**.

## Sommaire

- [Purpose](#purpose)
- [API publique](#api-publique)
  - [Module `Http` + config](#module-http--config)
  - [`HttpKernel` (orchestrateur)](#httpkernel-orchestrateur)
  - [Contextes : `Context` / `HttpContext` / `WebsocketContext`](#contextes)
  - [`Request` / `Response` (http, http2, ws)](#request--response)
  - [`SessionsService` / `Session` / storage IoC](#sessionsservice--session)
  - [`Certificate` (TLS)](#certificate-tls)
  - [Loggers de requête (pluggables)](#loggers-de-requête)
  - [`ErrorRenderer` (pluggable)](#errorrenderer)
  - [`Profiler` (dev-only) + data plane admin](#profiler--data-plane-admin)
  - [`domainMatcher` (fonctions pures)](#domainmatcher)
  - [Cookies](#cookies)
  - [Interfaces & types exportés](#interfaces--types-exportés)
- [Internals](#internals)
  - [Pipeline HTTP (phases)](#pipeline-http)
  - [Router-first / static en fallback](#router-first--static-en-fallback)
  - [Pipeline WebSocket (cycle)](#pipeline-websocket)
  - [Durcissement WS (heartbeat, backpressure)](#durcissement-ws)
  - [ALS / `RequestContext`](#als--requestcontext)
  - [Sessions (activation lazy + IoC)](#sessions-internals)
  - [Certificats (stratégies)](#certificats-internals)
  - [Domain matching (2 étages)](#domain-matching-2-étages)
  - [trust-proxy / Forwarded](#trust-proxy--forwarded)
  - [requestId / traceparent](#requestid--traceparent)
  - [Backpressure HTTP + streaming](#backpressure-http--streaming)
  - [Hooks pipeline (security)](#hooks-pipeline)
  - [Statiques natifs `/<module>/` + assets](#statiques-natifs)
- [Config (clés Zod)](#config-clés-zod)
- [Gotchas spécifiques http](#gotchas-spécifiques-http)

---

## Purpose

Module central : **tous les serveurs** (HTTP/HTTPS/HTTP2/WS/WSS) + leurs contextes. Différenciateur
Nodefony : **HTTP et WebSocket partagent le même pipeline Controller**. Ne peut **jamais** importer
`@nodefony/framework` (cycle) → accès au resolver via `(context as any)?.resolver`.

---

## API publique

### Module `Http` + config

`index.ts` : `class Http extends Module` ; `@services([HttpKernel, Certificate, SessionsService, StaticServer, HttpServer, HttpsServer, WebsocketServer, WebsocketSecureServer, UploadService])`.
Hooks notables : `onKernelRegister` valide la config (`defineHttpConfig` → ré-assigne `this.options`) ;
`onKernelBoot` s'enregistre comme producteur admin + instancie le `Profiler` (dev-only) ;
`configSchema()` override → `httpConfigJsonSchema()`.

Exports config : `defineHttpConfig`, `httpConfigSchema`, `httpConfigJsonSchema`, `meta`, types
`IHttpConfig`/`IHttpConfigInput`/`HttpConfig`/`HttpConfigInput`/`INodefonyFieldMeta`.

### `HttpKernel` (orchestrateur)

`service/http-kernel.ts` (export `default`). Cœur du pipeline. Résolu du container (`getModules().http.get("httpKernel")`).

<!-- prettier-ignore -->
| Méthode | Signature | Rôle |
| --- | --- | --- |
| `handle` | `(request, response, type: ServerType): Promise<HttpContext>` `:444` | Entrée HTTP : ouvre un scope DI `request`, délègue à `handleHttp`. |
| `handleHttp` | `(scope, request, response, type): Promise<…>` `:820` | Crée le contexte, wrap ALS, parse, route, firewall, action, teardown. |
| `handleWebsocket` | `(req, ws, type): Promise<…>` `:1067` | Entrée WS : crée le contexte, résout la route **avant accept**, connect, dispatch. |
| `handleFrontController` | `(context, checkFirewall = true): Promise<Controller \| number>` `:465` | Router.resolve → firewall → controller (HTTP **et** WS). Réutilise `context.resolver` si déjà matché. |
| `onError` | `(error, context?, _extraHeaders?): Promise<HttpContext \| WebsocketContext>` `:559` | Rend l'erreur via `errorRenderer` ; HTTP→status, WS→close code (1011/1008/4004). |
| `startSession` | `(context): Promise<Session \| null>` `:709` | Point d'activation **UNIQUE** session (HTTP+WS). Lazy : `null` si pas d'intent ni cookie. |
| `setRequestLogger` / `getRequestLogger` | `(IRequestLogger): void` `:551` / `: IRequestLogger` `:555` | Échange le logger de requête (singleton stateless). |
| `setErrorRenderer` / `getErrorRenderer` | `(IErrorRenderer): void` `:539` / `: IErrorRenderer` `:543` | Échange le renderer d'erreur (RFC 7807, hide-stack prod…). |
| `isValidDomain` / `checkValidDomain` | `(context): boolean` `:1227` / `: number` `:1216` | Barrière Host (trustedHosts) → 401 si Host non trusté. |
| `createHttpContext` / `createWebsocketContext` | `:781` / `:1015` | Fabriques de contexte (wirent teardown via event `finish`/`onFinish`). |

Champs publics : `requestLogger: IRequestLogger` (défaut `DefaultRequestLogger`), `errorRenderer: IErrorRenderer`
(défaut `DefaultErrorRenderer`), `router`, `firewall`, `sessionService`, `profiler` (null en prod).

### Contextes

Base `Context extends Service` (`src/context/Context.ts`). Sous-classes : `HttpContext` (HTTP/HTTPS/HTTP2),
`WebsocketContext`. Props et méthodes héritées par les deux :

| Membre                                           | Ancre           | Note                                                                      |
| ------------------------------------------------ | --------------- | ------------------------------------------------------------------------- |
| `requestId: string`                              | `:194`          | `randomUUID()` au ctor ; override par header `X-Request-Id` entrant.      |
| `type: ServerType`, `scheme: SchemeType`         | `:145` / `:235` | `http`/`https`/`ws`/`wss`.                                                |
| `method: HTTPMethod \| null`, `url: string`      | `:156` / `:155` | WS : `method` = `"WEBSOCKET"`.                                            |
| `session: Session \| null \| undefined`          | `:162`          | `null` tant que pas activée (lazy).                                       |
| `sessionIntent: SessionIntent \| null`           | `:176`          | Posé par `Resolver.match` (`@UseSession`/`@Session`).                     |
| `cookies: Cookies`, `resolver: Resolver \| null` | `:159` / `:170` | `resolver` = seul lien vers framework (cast `any`).                       |
| `metaData: Data`                                 | `:231`          | `setMetaData()` `:318` (inclut `nodefony.requestId`).                     |
| `webSocketState`                                 | `:236`          | État WS (null en HTTP).                                                   |
| `get signal(): AbortSignal`                      | `:383`          | **Lazy** : alloue `AbortController` au 1er accès seulement.               |
| `phaseStart(name)` / `phaseEnd(name)`            | `:330` / `:338` | Instrumentation ; noop si timing off (`EMPTY_PHASES`).                    |
| `onAfterResponse(fn)`                            | `:348`          | Hook post-réponse, fire-once, dédup finish/close.                         |
| `logRequest(error?)`                             | `:498`          | Délègue au `requestLogger` ; gère le sampling (`shouldSample`).           |
| `hasSession()` / `getSessionCookieName()`        | `:597` / `:617` | Reprise de session L1 / nom cookie (`__Host-` selon `cookie.hostPrefix`). |

`HttpContext` ajoute : `handle(): Promise<this>` `:206` (exécute l'action), `render(...)` `:280`,
`redirect(...)` `:460`, `setTimeout()` `:232` (couche pipeline `responseTimeout`).

`WebsocketContext` ajoute : `acceptedProtocol?` `:84`, `rejected` `:86`, `connection: Ws \| null` `:91`
(assigné **dans le ctor**), `wsUrl: URL \| null` `:97`, `request` étendu en `WsIncomingMessage` (url = `URL`).
Méthodes : `connect(): Promise<Ws>` `:222`, `send(data?, encoding?)` `:343`, `broadcast(data?, encoding?)`
`:354`, `close(reasonCode, description)` `:524`, `onClose(code, reason)` `:436`.

Helper pur exporté : `toWsCloseCode(code): number` (`WebsocketContext.ts:50`) — coercition RFC 6455 §7.4.

### Request / Response

- `HttpRequest` / `Http2Request` (`src/context/http/Request.ts`, `http2/Request.ts`) : parse du corps
  (busboy/JSON/QS/XML) ; remplit `request.queryPost`/`queryGet`. **Drain obligatoire** avant lecture
  (`Parser.parse()` `await this.ended()`).
- `Response` (= `HttpResponse`, `src/context/http/Response.ts`) : `setStatusCode(...)` `:233`,
  `setBody(ele, encoding?)` `:296`, `setLength(...)` `:317`, `setHeader(...)` `:133`, `getHeader(...)` `:515`,
  `writeHead(...)` `:364` (sanitize statusMessage ASCII + injecte `x-request-id`), `send(...)` `:426`
  (backpressure : resolve sur `drain` si buffer plein), `redirect(...)` `:534`.
- `Http2Response` (`http2/Response.ts`) : chemin `stream.respond()` ; gardes `stream.destroyed/closed/writable`.
- `WebsocketResponse` (= `wsResponse`, `src/context/websocket/Response.ts`) : `send(...)` `:71`,
  `broadcast(data?, type?)` `:113` (= `wss.clients.forEach` → **inclut l'émetteur**), `close(reasonCode, description)` `:181`.

### `SessionsService` / `Session`

`service/sessions/sessions-service.ts` + `src/session/session.ts`. `SessionsService` = **registre IoC**
des backends (http n'importe **aucun** ORM) :

- `static registerStorage(name, ctor): void` `:141`, `static getStorage(name)` `:150`, `static storageHandlers(): string[]` `:155`.
- `start(context, readOnly?)` `:252`, `createSession(name, options?): Session` `:344`.
- Chaque backend s'auto-enregistre au chargement (`files` par http ; `drizzle`/`mongoose` par leur module).
  Sélection par `session.handler` (défaut reco `drizzle`).

`Session` : CRUD (`get`/`set`/`destroy`), `flash`, `meta`, `save()` (no-op si `readOnly`), `regenerateId()`
(seam anti-fixation). DTO d'admin redacté = `ISessionSummary` (jamais `id` brut → `ref = HMAC(secret, id)`).

### `Certificate` (TLS)

`service/certificates.ts`. Fournit le cert HTTPS/WSS. Stratégies (`certificates.strategy`) : `auto` (défaut :
mkcert si dispo en dev → CA trustée HMR, sinon `selfsigned`) | `mkcert` | `selfsigned` | `explicit`.
`node-forge` chargé **lazy** (jamais importé en prod avec cert explicite). `describe()` = résumé
introspectable. Génération auto au boot (`onBoot` → `generateServerCertificates`, idempotent) + commande CLI.

### Loggers de requête

Interface `IRequestLogger` : `renderHttp(ctx, error?)` + `renderWebsocket(ctx, error?, protocol?)` →
`{text, severity, msgid}` ; option `shouldSample(ctx, err?)`. Implémentations exportées (toutes
singleton stateless, **zéro alloc per-request** au nominal) :

- `DefaultRequestLogger` — format multi-champ legacy (`URL : … FROM : … ID : <uuid>`).
- `PrettyRequestLogger` — 1 ligne human dev (`GET 200 /api 12.3ms 127.0.0.1 [a1b2c3d4]`, ANSI, requestId tronqué 8).
- `JsonAuditLogger` — 1 PDU JSON canonique/req (`msgid="audit"`) : `{ts, requestId, userId, type, scheme, method, url, status, durationMs, remoteAddress, host, userAgent, hasAuthorization, hasCookie, phases?, error?, protocol?}`. Flags `hasAuthorization`/`hasCookie` = booléens (**valeurs jamais loggées**). Sampling via `sampleRate` (≥400/erreurs toujours loggés). Erreur enrichie : `{name, message, code?, errorType?, stack?, cause?}` (cause récursive, `maxCauseDepth` 5, stack si `NODE_ENV !== "production"`).

`severityFromStatus(s)` exporté : 2xx/3xx→INFO, 404/405→WARNING, 5xx→ERROR.

### `ErrorRenderer`

Interface `IErrorRenderer` : `renderHttp(err, ctx) → {status, message, body, headers?}` +
`renderWebsocket(err, ctx) → {code, reason}`. `DefaultErrorRenderer` préserve la shape JSON legacy
`{code, message, error, nodefony:{requestId, scheme,…}, result:null}`. WS : code clampé 1000-4999.
Override via `HttpKernel.setErrorRenderer()` (RFC 7807, hide-stack prod, auth-challenge headers).

### `Profiler` + data plane admin

`Profiler` (`src/profiler/Profiler.ts`) : ring buffer `Map<requestId, ProfileEntry>` (cap 500, éviction
insertion-order). `collect(ctx)` au teardown = snapshot (phases/route/controller/user/traceparent/status +
**queries ORM** via seam `context.profilerQueries`). **Dev-only** (`environment !== "production"`).
Data plane : `GET /nodefony/profiler/api/recent` (`?limit`) / `GET /{id}` / `DELETE recent`.

http est aussi **producteur du data plane Studio** via `createHttpAdminApi(module)` (importe SEULEMENT
`IAdminApi`/`IAdminRegistry` de `"nodefony"`) : `GET /nodefony/http/api/{servers,info,sessions}` +
sessions admin (`sessions/list`, `sessions/{ref}/revoke`, `sessions/revoke-user/{id}`, RBAC `ROLE_NODEFONY_ADMIN`).
Per-instance (header `x-nodefony-instance`) — vue cluster = Redis.

### `domainMatcher`

`src/context/domainMatcher.ts` — fonctions **pures** réutilisées par `@nodefony/framework` (`@Domain`) :

- `compileDomainPattern(pattern): RegExp` `:51`, `compileDomainPatterns(...)` `:68`,
  `compileTrustedHosts(...)` `:95`, `isDomainAllowed(regAlias, domain): boolean` `:124`.
- Types : `DomainPattern = string \| RegExp` `:24`, `TrustedHostsConfig = boolean \| DomainPattern \| DomainPattern[]` `:33`.
- Politique de pattern UNIQUE (partagée kernel ↔ route) : string exact ancré (`.` littéral) / `*` wildcard
  un-label (RFC 6125) / `RegExp` libre. ReDoS-safe (`[^.]+`, ancré). ~40 ns/req, 0 alloc.

### Cookies

`Cookie` (`src/cookies/cookie.ts`) : sérialisation RFC 6265 (SameSite/Secure/HttpOnly/Priority), signature
HMAC optionnelle. `maxAge` déjà en **ms** (pas de `*1000`). Accès via `context.cookies` (map `Cookies`).

### Interfaces & types exportés

Barrel `index.ts`. Interfaces : `IContext`/`IHttpContext`/`IWebsocketContext`, `IHttpKernel`,
`IHttpRequest`/`IHttp2Request`/`IWsRequest`, `IHttpResponse`/`IWebsocketResponse`, `ICookie`/`ICookieOptions`/`IWsCookie`,
`ISession`/`ISessionStorage`/`ISerializedSession`/`ISessionSummary`/`ISessionRecord`/`ISessionListFilter`,
`IUploadedFile`/`IUploadService`/`IParsedUploadFile`/`IUploadOptions`, `IErrorRenderer`/`IErrorHttpResult`/`IErrorWebsocketResult`,
`IRequestLogger`/`IRequestLogEntry`. Types : `ServerType`, `SchemeType`, `WebSocketStateType`, `CookiesMap`,
`SameSiteType`/`PriorityType`, `SessionIntent`/`SessionStatusType`/`SessionStrategyType`/`FlashBagType`/`MetaBagType`,
`HTTPMethodType`, `AuditLogEntry`/`AuditErrorEntry`/`JsonAuditLoggerOptions`, `ProfileEntry`/`ProfileSummary`/`ProfilePhase`,
`ProtocolType`/`ContextType`/`httpRequest`/`httpResponse` (re-export http-kernel).

> `RequestContext` (ALS) n'est **pas** dans http : exporté par le **core** `nodefony` (`src/runtime/RequestContext.ts`).

---

## Internals

### Pipeline HTTP

`server-http.ts` (`IncomingMessage`) → `HttpKernel.handle()` → `handleHttp()` :

1. `enterScope("request")` (DI scope par requête).
2. `createHttpContext()` + hook `onCreateContext`.
3. `RequestContext.run({requestId, scheme}, …)` (bulle ALS) — englobe tout le reste.
4. **phase `parse`** : `request.initialize()` (await parser ; corps drainé). Sauté si l'action déclare `@Body({stream:true})` (flag booléen lu du framework, **pas** d'import).
5. route-match HISSÉ (pur : method+URL) — sert au choix stream/parse.
6. **phase `resolve`** : `handleFrontController` → `Router.resolve`.
7. **phase `firewall`** : `firewall.handleSecurity` (via `onRequestEnd`).
8. **phase `action`** : `context.handle()` → controller (reste ouverte pendant l'action).
9. `Response.writeHead()` (injecte `x-request-id`) → `send()`.
10. Teardown via event `finish` : `logRequest` → `onAfterResponse` → `fireAsync("onFinish")` → `profiler.collect` → `clean()` → `leaveScope()`.

Phases canoniques : `parse` / `resolve` / `firewall` / `action`. Désactivées en prod (opt-in
`kernel.options.timing.enabled`) → `phases` = `EMPTY_PHASES` frozen, `phaseStart/End` noop, 0 Map allouée.
**Pipeline = `async function` plates** (`throw`/`return` directs) : JAMAIS `new Promise(async executor)`
(2ᵉ Promise + microtasks ; les throws hors resolve/reject sont avalés → pending à jamais).

### Router-first / static en fallback

Le serveur statique est tenté **après** un route-match raté (`resolver?.resolve !== true && !resolver?.exception`),
façon Express → une requête qui matche une route ne touche jamais le disque (+~28 % RPS). Avant l'appel
static : `response.removeHeader("Content-Type")` (sinon le défaut `application/octet-stream` posé par
`Response.ts` colle aux fichiers servis, serve-static ne l'écrase pas).

### Pipeline WebSocket

`server-websocket.ts` (event `connection`, ws@8) → `HttpKernel.handleWebsocket(req, ws, type)` :

1. `createWebsocketContext()` → `WebsocketContext` (url étendue en `URL`, `connection` assignée au ctor).
2. `RequestContext.run(...)` (bulle ALS, wsId = `requestId`).
3. `handleFrontController()` → **route résolue + protocole vérifié AVANT accept**.
4. Mismatch protocole → `HttpError(1002)` → `context.close(1002)`.
5. `context.connect()` → handshake accepté.
6. `Controller.execute(null)` → handler de handshake (⚠️ l'action reçoit `undefined`).
7. `ws "message"` → `Controller.execute(message)`.

`onClose` fire `onFinish` (déclenche `onAfterResponse` + abort signal pending). Arrêt gracieux :
`terminate()` envoie `{nodefony:{state:shutDown}}` PUIS `client.close(1001)` AVANT `server.close()` (sinon
le client voit 1006 Abnormal = indistinguable d'une coupure réseau).

### Durcissement WS

ws@8 n'a **aucun keep-alive natif**. Helper `service/servers/wsHeartbeat.ts` :

- `startHeartbeat(server, opts)` = **1 seul `setInterval`/serveur** (jamais 1/conn), `unref` + clear au `terminate()`.
- `trackPong(ws)` = 1 listener `pong` + 2 `number` par conn (`_nfLastPong`/`_nfPingedAt`), **0 alloc/tick**.
- Ping tous les `keepaliveInterval` (déf 20s) ; `terminate()` si pas de pong sous `keepaliveGracePeriod` (déf 10s). `<=0` → désactivé.
- Backpressure **sortante** : `Response.send()`/`broadcast()` gatent via `decideSend(ws, max, policy)`
  (`src/context/websocket/wsBackpressure.ts`) AVANT `client.send()`. Lit `ws.bufferedAmount` (O(1)),
  0 alloc sous le seuil. `maxBackpressure` déf 4 MiB (`0`=off), `backpressurePolicy` `drop`(déf)|`close`
  (1013). `drop` = saute la frame (socket reste OPEN). WARNING 1×/conn au 1er drop.
- Options ws@8 toutes câblées : `perMessageDeflate`(false, anti zip-bomb), `skipUTF8Validation`(false),
  `autoPong`(true), `maxPayload`(1 MiB durci vs 100 MiB). `server`+`clientTracking` **forcés** (broadcast/heartbeat en dépendent).

### ALS / `RequestContext`

`RequestContext` (core `nodefony`, `src/runtime/RequestContext.ts`) : AsyncLocalStorage lazy (1 instance
partagée, créée au 1er `.run()`). API : `run(payload, fn)` (propage le retour de `fn` → `return await RequestContext.run(...)`),
`get()`, `getRequestId()`, `getUser()`, `getUserId()`, `set(key, value)`. Payload open-shape
`{requestId, scheme?, userId?, user?, traceparent?, …}`. Wrap dans `handleHttp` (après createContext, avant
parse) et `handleWebsocket` (avant onConnect). ~50-100 ns/req. **Le teardown lit `ctx.profilerQueries` sur
le context, pas l'ALS** (teardown hors bulle).

### Sessions internals

Activation **lazy** : plus de `startSession()` global. Une session s'ouvre via l'intent `@UseSession({context?, readOnly?, eager?})`
**OU** un param `@Session` **OU** un cookie existant (reprise L1). Point unique `HttpKernel.startSession(context)`
(HTTP+WS symétrique) lit `context.sessionIntent` (posé par le Resolver). 0 session/0 write sinon.
`cookie.hostPrefix` (`auto`|`true`|`false`) → `__Host-` sur scheme **effectif** (honore X-Forwarded-Proto si
trustProxy). Storage = IoC (cf `SessionsService`) : un service infra (Drizzle) doit **tolérer le shutdown**
(`!orm.isConnected()` → read vide, write/gc no-op).

### Certificats internals

Conformité auto-signé : SHA-256 (jamais SHA-1 — `node-forge sign()` sans digest = SHA-1, piège), serial
`crypto.randomBytes(16)` 128 bits (RFC 5280 §4.1.2.2, ≠ `01`), privkey 0600 + dossier 0700, `notBefore`
backdaté, SKI (§4.2.1.2), SAN = vérité d'hôte (RFC 6125 ; CN ignoré ; IP littérale → `iPAddress`). SAN dérivé
kernel si vide (`localhost`+`domain`, `0.0.0.0` exclu). `isCertAdequate` régénère si expiré / SHA-1 / SAN
incomplet. Commandes CLI : `nodefony certificates [--force] [--json]`, `nodefony proxy:generate <nginx|haproxy>`.

### Domain matching (2 étages)

1. **`trustedHosts` (kernel, AVANT routing)** : barrière Host anti-injection. `false` = domaine canonique +
   loopback dev (`localhost`/`127.0.0.1`/`[::1]`) · `true` = bypass (proxy cloud-native) · `string|string[]` = vhosts add.
   `compileTrustedHosts()` → `regAlias` ; `isValidDomain()`/`checkValidDomain()` → **401** si non trusté.
2. **vhosts SERVIS** = `@Domain` côté framework (source unique), pas le kernel (`domainAlias` supprimé).

Host mismatch (Host ≠ authority réelle) → **421 Misdirected Request**.

### trust-proxy / Forwarded

Config `trustProxy` (CIDR / presets / BlockList ; tests `unit/trustProxy.test.ts`). Quand le proxy est de
confiance : `X-Forwarded-Proto` détermine le scheme effectif (cookies `Secure`/`__Host-`),
`X-Forwarded-For` l'IP cliente. Sinon ignoré (anti-spoof).

### requestId / traceparent

`requestId` UUID v4 au ctor de `Context`, overridé par header `X-Request-Id` entrant (HTTP+WS). Réinjecté en
réponse par `Response.writeHead()`. **HTTP/2** : `Http2Response.writeHead` bypasse `super.writeHead`
(chemin `stream.respond()`) → pose `x-request-id` + `traceparent` **là aussi** (sinon réponses 5152 sans
header → corrélation cassée). wsId = `requestId` du `WebsocketContext`, stable sur toute la socket
(ctor → handshake/messages/close), présent dans les 3 logs de cycle de vie WS. Per-message **non loggé** (hot path).

### Backpressure HTTP + streaming

`Response.send` : si `ServerResponse.write() === false` (buffer > highWaterMark) → resolve sur `once("drain")`
(contrat `stream.Writable`), pas avant → producteur freiné, RAM bornée si client lent. Listener `drain`
attaché QUE sous pression (`once` + `removeListener` si erreur). `Content-Length` ⊥ `Transfer-Encoding`
(skip Content-Length si chunked). Timeout 2 couches : **réseau** = `requestTimeout` natif Node (anti-slowloris,
hors pipeline) ; **pipeline** = `responseTimeout` (armé `HttpContext.setTimeout()` → `onTimeout` →
`_abortIfPending` → 408/504). Client part avant tout envoi → 499 interne (observabilité pure, jamais écrit).

### Hooks pipeline

3 hooks `fireAsync` au niveau `HttpKernel` (s'enregistrent via `httpKernel.on(...)` au `onKernelReady` de security) :

| Hook            | Quand                                                           | Payload                |
| --------------- | --------------------------------------------------------------- | ---------------------- |
| `beforeResolve` | AVANT `handleFrontController` (HTTP+WS)                         | `(context)`            |
| `afterAuth`     | APRÈS `firewall.handleSecurity()` SUCCESS                       | `(context)`            |
| `onAuthFailure` | APRÈS firewall THROW (log-only `.catch`, n'arrête pas le throw) | `(context, authError)` |

Tous guardés `if (listenerCount(e))` (0 hook sans security = 0 microtask). Invariant : `afterAuthCount <= beforeResolveCount`.

### Statiques natifs

À `onReady`, `server-static` auto-monte le `public/` de chaque module sous `/<basename>/` (`addMount`,
idempotent). Skip : app root (`./public` → `/`), modules frontend-managed (`/_assets/<name>/`), modules sans
`public/`. Override par module via `module.options.publicMount` (`false` opt-out / `{publicPath?, dir?}`).
`statics.enabled=false` → 0 montage config-driven (prod cloud-native nginx/CDN), n'affecte pas `addMount()`
programmatique. Commande `nodefony assets:publish` assemble un arbre CDN-ready `dist-assets/` + manifest.

---

## Config (clés Zod)

`config/schema.ts` = **source de vérité** (`httpConfigSchema` `:744` ; `config.ts` = `httpConfigSchema.parse({})`).
Validation au boot par `defineHttpConfig` (injecte les défauts kernel APRÈS parse). Config **non gelée** (les
services mutent `module.options`). `strict` (strip, attrape typos) pour **notre code** ; `looseObject`
(passthrough) pour les sections transmises à une lib tierce (`http`/`https`/`http2`/`websocket(s)`/`queryString`/`statics.*.options`).

<!-- prettier-ignore -->
| Section (sous-schéma) | Ancre | Clés clés |
| --- | --- | --- |
| racine `httpConfigSchema` | `:744` | `watch` (reserved), `headerServer` (runtimeMutable, déf `"nodefony"`), `maxBodySize` (→413), `trustProxy`, `trustedHosts` |
| `securityHeadersSchema` | `:75` | `contentTypeOptions`, `frameOptions`, `strictTransportSecurity` (maxAge/includeSubDomains/preload) |
| `uploadSchema` | `:105` | `uploadDir` (kernelDerived ← `kernel.tmpDir`), `maxFileSize`, `maxTotalFileSize`, `maxFiles`, `hashAlgorithm` |
| `queryStringSchema` | `:174` | `parameterLimit`, `delimiter`, `ignoreQueryPrefix` |
| `httpServerSchema` / `httpsServerSchema` | `:200` / `:248` | `keepAliveTimeout`, `timeout`, `requestTimeout`, `responseTimeout`, `headers`, `rejectUnauthorized` (https) |
| `http2Schema` | `:265` | `maxConcurrentStreams`, `maxSessionMemory` |
| `certificatesSchema` | `:375` | `strategy` (auto/mkcert/selfsigned/explicit), `ca`/`key`/`cert`, `privateKeyMode` (0600), `san` ({dns,ip}), `dev.useMkcert`, `openssl` ({size, validityDays, backdateMinutes, attrs kernelDerived}) |
| `websocketSchema` (+ `websocketSecure`) | `:413` | `keepaliveInterval`, `keepaliveGracePeriod`, `closeTimeout`, `maxPayload` (1 MiB), `allowedOrigins` (anti-CSWSH), `perMessageDeflate`, `autoPong`, `maxBackpressure` (4 MiB), `backpressurePolicy` (drop/close) |
| `staticsSchema` | `:600` | `enabled` (déf true), `defaultOptions`, `web` ({path:"public"}), `cacheControl`, `maxAge` |
| `sessionSchema` (+ `sessionCookieSchema` `:631`) | `:665` | `savePath`, `gcIntervalS`, `gcJitter`, `maxLifetimeS`, `absoluteTimeoutS`, `refererCheck`, `cookie` ({maxAge, httpOnly, secure, signed, hostPrefix}) |

Flags `meta()` (`config/configMeta.ts`, helper `meta()`) : `reserved`/`runtimeMutable`/`kernelDerived`/`secret`
→ recopiés dans le JSON Schema (`httpConfigJsonSchema()` via `z.toJSONSchema`) pour Studio/doc. ⚠️ poser le
`.meta()` sur le **nœud final** présent dans `.shape`. Piège Zod 4 : `.default(() => sub.parse({}))` par
section (un `.default({})` plat ne ré-applique pas les sous-défauts).

---

## Gotchas spécifiques http

- **`IWsRequestExtension`** : `IncomingMessage.url` est une `string`, mais `Route.match()` lit `.pathname`.
  Fix : `WsIncomingMessage = IncomingMessage & { url: URL; query; queryGet; path }` assigné dans le ctor
  `WebsocketContext`. Toujours passer par lui (`SecuredArea.match()` exige un `URL`).
- **`ERR_INVALID_CHAR`** : Node pose `ServerResponse.statusMessage` natif AVANT validation → un char invalide
  persiste même si `writeHead()` throw, et **tous** les writes suivants échouent en cascade (jusqu'au timeout).
  Fix : `safeMsg = statusMessage.replace(/[^\x20-\x7E]/g, "")` juste avant `ServerResponse.writeHead()`.
- **`HttpError` champs `controller`/`action`/`jsonResponse`** : `httpError.ts` est dans http (dépendance de
  framework) → import circulaire impossible. Extraits de `(context as any)?.resolver` dans le ctor.
- **Protocol WS = match exact string** : `requirements.protocol: ['a','b']` → header `"a, b"` → ne matche
  pas `"a"` → 1002. `protocol: ""` → accepte tout.
- **`WebsocketResponse.connection` assignée dans le ctor** (pas seulement dans `connect()`) → `onError` peut
  fermer 1002 **avant** l'accept. `acceptedProtocol` = header `Sec-WebSocket-Protocol` brut (string).
- **Body parsing : drain OBLIGATOIRE avant lecture** — `@Body`/`@Query`(POST) lisent `request.queryPost`
  rempli par les parsers, qui doivent attendre `end` (`await this.ended()` + `Buffer.concat`) sinon chunks
  partiels/vides. Ne jamais attacher `on("data")` au ctor de `Request` (flowing mode → chunks écoulés avant
  le parser).
- **HTTP/2 write-after-end** : sur réponse lente / stream fermé, `stream.respond()`/`write()` = `ERR_HTTP2_INVALID_STREAM`
  - `ERR_STREAM_WRITE_AFTER_END` (CRITIC). Gardes `stream.destroyed/closed/writable` dans `Http2Response.{writeHead,send,end}`.
- **`onConnection` (http-kernel) a un `catch` silencieux** — erreurs WS avalées, vérifier les logs DEBUG.
- **Toute socket `ws` SANS `on("error")` peut crasher le process** (`error` non écouté = throw process).
- **`broadcast()` inclut l'émetteur** (`wss.clients.forEach`), ne fan-out que les clients du **même worker**
  (cross-process = Redis pub/sub).
- **`url.parse()` interdit** (deprecated Node 22+) → `new URL(str, "http://localhost")` partout.
- **Comparer `"production"`, jamais `"prod"`** : `setEnv` normalise en `development`/`production`/`test` ; un
  `!== "prod"` laisse Profiler/timing actifs en prod (overhead + fuite d'info `/nodefony/profiler/api/*`).
- **`extend(true, {}, defaultOptions, …)`** (cible `{}`) dans les services — sinon mute la constante partagée.
- Tout fichier test `.ts` commence par `/// <reference types="node" />`.
