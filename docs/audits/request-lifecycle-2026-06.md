---
title: Audit cycle de vie requête — perf · sécurité · mémoire (HTTP + WS)
date: 2026-06-10
status: findings — à arbitrer
scope: "@nodefony/http (pipeline, contextes, parsers, sessions) + @nodefony/framework (router, resolver, controller)"
---

# Audit du cycle de vie d'une requête — entrée → controller → sortie

**Méthode** : lecture intégrale du hot path (~7 200 lignes) : `server-http` → `http-kernel`
→ `Context`/`HttpContext`/`Request`/`Response` → `router`/`Resolver`/`Route`/`Controller`
→ `WebsocketContext`/`Response WS` → `sessions-service` → `audit-logger` → `parser`.
Rappel baseline (2026-06-05) : Nodefony mono prod ≈ **10 400 RPS** vs `node:http` nu
**111 600 RPS** (×11). Gains déjà pris : router-first +28 %, query morts +3,2 %.

---

## 🔴 BLOQUANTS (sécurité / mémoire)

### B1 — Body non-multipart SANS limite de taille → DoS RAM trivial

`parser.ts:22` — `Parser.write()` accumule `chunks.push(buffer)` **sans aucune borne**.
Concerne JSON (`ParserJson`), urlencoded (`ParserQs`), XML (`ParserXml`), raw (`Parser`).
Un `POST application/json` de N GB est **bufferisé intégralement en RAM** avant parse.
Seul le multipart est borné (busboy `limits` + `maxTotalFileSize`, `Request.ts:310`).
`requestTimeout` borne la durée, pas la taille.

**Fix** : compteur cumulé dans `write()` + `HttpError 413` au dépassement
(`request.unpipe`/`destroy` + drain), config `http.maxBodySize` (défaut ~1 Mo, à la
Express `body-parser` 100 Ko / Fastify 1 Mo). Symétrique du pattern busboy déjà en place.

### B2 — `Request.origin` toujours `undefined` (bug d'ordre) → détection cross-origin morte

`Request.ts:131-133` :

```ts
this.origin = this.headers.origin; // ← this.headers est encore {} ici
this.headers = request.headers; // ← assigné APRÈS
```

`origin` ne vaut **jamais** la valeur du header. En aval `HttpContext.originUrl`
retombe silencieusement sur l'URL de la requête → toute logique cross-domain
(`context.crossDomain`, future CORS P6) est aveugle. 2 lignes à inverser + test.

### B3 — CORS / preflight / CSRF = code mort dans le pipeline

`http-kernel.ts:343-351` — `handleCrossDomain` commenté, `res` forcé `null`, le
`OPTIONS → 204` ne part jamais. CSRF commenté ×2 (`onRequestEnd`). Aujourd'hui
**aucune politique CORS centralisée** n'existe : un navigateur tiers peut appeler
les API (mitigé seulement par SameSite cookie). À nettoyer (retirer le mort) et
**figer comme entrée P6** : preflight 204 + `Access-Control-*` + CSRF token.

### B4 — Handshake WS sans validation d'Origin → CSWSH (Cross-Site WebSocket Hijacking)

`WebsocketContext.ts` lit `req.headers.origin` mais **ne le valide jamais** contre une
allowlist. Avec la reprise de session par cookie (L1, `cookieSession`), une page
malveillante peut ouvrir un WS **authentifié par le cookie de la victime** (le
navigateur n'applique pas CORS aux WS — OWASP WSTG-CLNT-10). `validDomain` vérifie le
header `Host`, pas `Origin`.

**Fix** (avant ou avec P6) : check Origin au handshake (allowlist = `trustedHosts` par
défaut + config dédiée), refus = `1008 Policy Violation`. Coût : 1 comparaison/handshake.

---

## 🟠 PERF — le coût par requête (classé par gain estimé)

### P1 — Events de cycle de vie : 4-6 Pdu alloués PAR REQUÊTE, même en prod 🥇

`Context.ts:427-463` — les overrides `fire`/`emit`/`fireAsync`/`emitAsync` appellent
**inconditionnellement** `this.log(\`${colorLogEvent()} ${event}\`, …)`. Chaque event
= 1 template string + 1 string colorée + **1 Pdu complet** (uid, timestamp, push ring
Syslog) — même en prod où la sévérité DEBUG n'est jamais affichée.

Par requête HTTP : `onRequest` ×2 (context + kernel, `HttpContext.ts:196-197`) +
`onSend` + `onClose` + `onRequestEnd` ≈ **5 Pdu/req**. Par **frame WS** :
`onMessage` (fireAsync) + `onMessage`/`onSend` au send ≈ **3 Pdu/frame**
(`WebsocketContext.ts:346-347, 409`). S'ajoute `router.ts:94` (« Match route » → 1 Pdu/req).

Double peine : alloc + **rétention dans le ring buffer Syslog** (les Pdu DEBUG
remplissent le ring en prod et en éjectent les logs utiles).

**Fix** : résoudre 1× au boot un flag `lifecycleEventLogging` (même pattern que
`lifecyclePromoted`/`wsContentLogging`) → en prod, `fire()` ne logge **rien** (appel
direct `super.fire`). Gain attendu : c'est le frère du poste audit (+14,6 % mesuré au
skip) — vraisemblablement **le plus gros poisson restant**. À mesurer A/B
(`bench-ab-mono.sh`).

### P2 — 3 `Service` instanciés par requête : Context + Resolver + Controller 🥈

- `Resolver` **extends Service** (`Resolver.ts:56`) : ctor Service complet + lookup
  `injector` par requête — pour un objet qui ne sert qu'à porter le match.
- `Controller` **extends Service** (`Controller.ts:86`) : instancié par
  `Injector.instantiate` à CHAQUE requête + `get("template")` + listener
  `once("onRequestEnd")` + `initialize()` éventuel.

C'est LE différenciateur structurel vs NestJS : Nest instancie le controller **1 fois**
(scope singleton par défaut), seuls les `REQUEST`-scoped paient l'instanciation. Express
n'a même pas d'objet. Piste (chantier « fast path ») : Resolver **POJO** (pas Service) +
controllers **singleton opt-in** quand la classe est stateless (décorateur
`@Scope("singleton")`), instanciation par requête conservée par défaut (compat).

### P3 — Routing O(N routes) en regex + requirements recompilés par match

- `router.ts:86` : scan linéaire, `pattern.exec` par route scannée. Express paie pareil ;
  **Fastify (find-my-way, radix tree) ne paie pas** — c'est une part du ×11.
- `Route.matchRequirements` (`Route.ts:448-453`) : par match,
  `replace(/\s/g)+toUpperCase()+split(",")` (méthodes string) et
  `new RegExp(req)` (`Route.ts:233`) pour un requirement string → **compiler au boot**
  (Set de méthodes, RegExp pré-compilées) = 0 alloc/req, fix trivial.
- Piste structurelle : index par méthode HTTP + préfixe statique (map exacte d'abord,
  regex ensuite) — 80 % des routes réelles sont statiques.

### P4 — WS : re-match complet de la route À CHAQUE frame

`WebsocketContext.handleMessage:404` — `resolver.match(route, this)` re-exécute
regex + `hydrateDefaultParameters` + requirements + hostname **par message**, alors que
la route d'une connexion ne change jamais. Plus `setMetaData` (alloc) + 4
`Reflect.getMetadata` + `set("action")/set("route")` + `controller.setRoute` par frame
(via `executeAction`). Pour le realtime (33-38 k msg/s mesurés), c'est le poste #1.
**Fix** : mémoïser le résultat du match à la connexion ; chemin message = lookup direct.

### P5 — Métadonnées décorateurs relues par requête (Reflect)

`Resolver.executeAction` (`Resolver.ts:237-250`) + `_applyResponseDecorators` : 4 ×
`Reflect.getMetadata` par requête. Le pattern memo existe déjà (`route.bodyStream`,
`routeExpectsBodyStream`) → généraliser : figer `paramsMeta`/`redirectMeta`/`httpCode`/
`headers` **sur la Route au boot** (ou 1er hit). Supprime reflect-metadata du hot path.

### P6 — Allocations du ctor Context évitables (#5 connu, précisé)

- `requestId = randomUUID()` (`Context.ts:164`) : field initializer → payé même quand
  le client fournit `X-Request-Id` (écrasé 3 lignes plus loin, `HttpContext.ts:149`).
  Lazy getter possible (générer au 1er accès).
- `setMetaData()` au ctor (`Context.ts:203`) → enveloppe construite même pour un 404/static.
- `setContentTypeByExtension("bin")` au ctor Response (`Response.ts:51`) : lookup
  `mime.contentType` + `setHeader` par requête pour poser une **constante**
  (`application/octet-stream`) souvent écrasée ensuite — remplacer par des littéraux.
- `Context.router = this.get("router")` field init + `get("template")` (Controller) :
  lookups container par requête, cachables au niveau service.

### P7 — `new Promise(async executor)` restants (L4 incomplet)

`HttpContext.handle()` (:182), `HttpResponse.send()` (:411),
`SessionsService.start()` (:170). Anti-pattern : double wrapper + rejets avalables.
Même refacto que L4 (`a545d64`).

### P8 — Micro (à prendre en passant)

- `ansiRegex()` **recompile une RegExp à chaque** `setStatusCode(message)`
  (`Response.ts:9-19`) → const module-level.
- `setHeader` : `toLocaleLowerCase()` → `toLowerCase()` (`Response.ts:125`).
- `getContentType` : `replace(" ", "")` ne retire que la 1ʳᵉ espace (`Request.ts:590`).
- `eventSeverity`/`routeNoticePromoted` comparent encore `"prod"` (env normalisé =
  `"production"` uniquement — dead check).

---

## 🟡 Robustesse / conformité RFC

- **R1 — `renderMediaStream` Range non validé** (`Controller.ts:453-459`) : `parseInt`
  NaN, `start > end`, `start ≥ length` non gérés → `createReadStream` throw → **500**
  au lieu de **416 Range Not Satisfiable** (RFC 9110 §14.2) + `Content-Range: bytes */N`.
- **R2 — `void teardown()`** (`http-kernel.ts:658, 674`) : un throw d'un listener
  `onFinish` (`.catch((e) => { throw e; })`) part en **unhandledRejection** process.
  Catcher + logguer dans teardown.
- **R3 — `checkValidDomain` → 401** (`http-kernel.ts:1067`) : un Host non autorisé
  n'est pas un problème d'authentification → **421 Misdirected Request** (ou 400).
  (Le niveau route fait déjà 403 correctement, `Route.ts:407`.)
- **R4 — Broadcast WS force la conversion en string** (`Response WS :119`) :
  `payload.toString(encoding)` même pour un Buffer binaire → un broadcast binaire est
  émis en frame texte (et alloue une string par broadcast). `send()` unitaire gère le
  binaire, pas `broadcast()`.
- **R5 — Client parti pendant `streamFile`** (`Controller.ts:384-432`) : `pipe(response,
{end:false})` sans écoute du `close` de la response → le ReadStream **lit le fichier
  jusqu'au bout** après déconnexion (I/O gaspillée, mini-DoS sur gros fichiers). Détruire
  le stream sur `response.close`. (Pas de fuite FD : `close` → `fsClose` OK.)

---

## 🧷 Fuites mémoire — état des lieux

**Solide** (vérifié dans le code, cohérent avec le gate `memory.test` 9/9) :

- HTTP teardown : dédup `finish`/`close` + `removeListener` des deux + `leaveScope` +
  `clean()` (`http-kernel.ts:619-677`) ✓. 499 interne ✓.
- WS : `releaseOrphanWsScope` (BUG-003) couvre l'abandon pré-`connect()` ✓ ;
  `saveSession` déterministe au close (BUG-004) ✓ ; listener `error` obligatoire posé ✓ ;
  heartbeat 1 interval/serveur (chantier G2) ✓ ; backpressure bornée 4 MiB (G1) ✓.
- Parsers : jumeaux `end`/`error` détachés explicitement (`parser.ts:48-57`) ✓ ;
  multipart : cleanup temp + destroy streams sur abort ✓.
- `signal` lazy (0 alloc si non lu) ✓ ; hooks after-response lazy + null après fire ✓.

**Points de vigilance** :

- **M1 = B1** : le body non borné est LA fuite-DoS (pas un leak, une bombe).
- **M2 — pression ring Syslog** : les ~5 Pdu/req de P1 sont _retenus_ dans le
  CircularBuffer en prod — pas une fuite (borné) mais une pollution qui éjecte les
  logs utiles et gonfle la RSS de base.
- **M3 — Profiler dev-only** : `collect(context)` au teardown — vérifier que le ring du
  Profiler ne retient pas le contexte entier (sinon N contextes + Request/Response
  pinned en dev ; sans impact prod).

---

## 🔐 Seams P6 — ce que `@nodefony/security` devra brancher ici

Les hooks `beforeResolve` / `afterAuth` / `onAuthFailure` existent et sont guardés
0-listener (coût nul sans security) ✓. Points de greffe à figer :

1. **CORS + preflight 204 + CSRF** : reprendre B3 (le code mort marque l'emplacement
   exact dans `handleFrontController`/`onRequestEnd`). Dépend du fix B2 (origin).
2. **Origin WS au handshake** (B4) — le firewall WS doit le porter ; en attendant, un
   check core gated `trustedHosts` est légitime (défense en profondeur).
3. **Session sur zone sécurisée** : la branche `context.secure` (`http-kernel.ts:824-851`,
   et `onConnect` WS :1048) **return avant `startSession`** → c'est le firewall qui devra
   démarrer/reprendre la session (sinon zones sécurisées sans session cookie). À écrire
   noir sur blanc dans le contrat Firewall.
4. **Anti session-fixation** : seam déjà commenté (`startSession`, `http-kernel.ts:602`)
   → `session.regenerateId()` post-auth.
5. **`context.user` → session** : cast string transitoire (`sessions-service.ts:261`) à
   remplacer par le principal P6 (`IUser`/token).
6. **Enveloppe `metaData.nodefony`** : `route.name`/`variablesMap` partent au client
   (frames WS + JSON). Inoffensif en dev, mais P6 devra décider ce qui est exposé en
   prod (introspection = reconnaissance).

---

## Plan d'attaque proposé (ordre)

| #   | Action                                                                 | Type     | Effort | Gain                                |
| --- | ---------------------------------------------------------------------- | -------- | ------ | ----------------------------------- |
| 1   | **B1** limite body 413 (`maxBodySize`)                                 | sécu/mém | S      | bloque le DoS RAM                   |
| 2   | **B2** fix ordre `origin` + test                                       | bug      | XS     | débloque CORS P6                    |
| 3   | **P1** gate boot-time des logs d'events lifecycle                      | perf     | S      | à mesurer — gros                    |
| 4   | **B4** check Origin handshake WS (1008)                                | sécu     | S      | tue CSWSH                           |
| 5   | **P4** mémo match WS par connexion                                     | perf WS  | M      | hot path realtime                   |
| 6   | **P5** metadata décorateurs figées sur Route                           | perf     | M      | reflect hors hot path               |
| 7   | **P3a** requirements pré-compilés au boot                              | perf     | S      | 0 alloc/match                       |
| 8   | **R1-R5 + P7-P8** lot robustesse/micro                                 | quali    | S      | RFC + bruit                         |
| 9   | **P2/P3b** Resolver POJO · controllers singleton opt-in · index routes | perf     | L      | structurel — chantier « fast path » |

Gates obligatoires à chaque lot : `npm run test:integration` + `npm run test:memory`
(+ `bench-ab-mono.sh` pour tout lot perf — ne garder que > bruit ±5 %).
