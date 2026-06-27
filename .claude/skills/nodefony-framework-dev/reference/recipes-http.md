# Recettes HTTP — Controller, décorateurs, contrat RFC, TLS

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
- `@Redirect("/url", 302)`. `redirect()` : whitelist RFC 9110 §15.4 `{301,302,303,307,308}`, **défaut = 302** (Found) ; code hors liste → fallback 302 + WARNING. 307/308 **préservent** méthode+corps, 303 force GET ; 301/302 peuvent muter POST→GET. (F5 2026-05-30 : avant, tout ≠ 302 était écrasé en 301 = bug fonctionnel.) Réponses : `renderJson` / `renderView`/`renderTwig`/`renderEjs` / `forward("mod:ctrl:action")`.
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
| Stratégie | Quand | Trust navigateur |
| --------- | ----- | ---------------- |
| `explicit` | `certificates.{ca,key,cert}` fournis en config (PROD) | selon ton cert |
| `mkcert` | dev + `dev.useMkcert` + binaire mkcert + CA locale | ✅ trustée → **requis HMR cross-origin/WSS** |
| `forge` | fallback auto-signé node-forge (CI, mkcert absent, prod sans cert) | ❌ non trusté (SAN présent) |

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
