---
name: test-module-memory
description: "module test — routes HTTP/WS de test d'intégration, controllers, statics"
metadata:
  type: project
---

# module test MEMORY

## Docs liées

- [`CLAUDE.md`](./CLAUDE.md) — instructions module + liste des routes
- [`../../packages/@nodefony/framework/MEMORY.md`](../../packages/@nodefony/framework/MEMORY.md) — Resolver pipeline, décorateurs
- [`../../packages/@nodefony/http/MEMORY.md`](../../packages/@nodefony/http/MEMORY.md) — Context, requestId, gotchas

## Purpose

Module Nodefony d'intégration. Expose routes de test pour valider le pipeline HTTP/WS du framework. Pas de logique métier.

## Controllers + Routes clés

**DefaultController** (`/nodefony/test`) :

- `/index` → 200 `{}`
- `/context` → type/scheme/method/host/remoteAddress/userAgent/sessionId
- `/header-echo?x-val=X` → header `x-echoed: X` (test sanitisation CR/LF)
- `/crash/sync`, `/crash/async`, `/crash/native` → 500 (resilience tests)
- `/index2` → 502 nodefonyError | `/index3` → 503 HttpError

**RestController** (`/nodefony/test/rest`) :

- `/session` GET/DELETE — info + destroy
- `/session/set/{key}/{value}` GET — session.set()
- `/session/get/{key}` GET — session.get()
- `/session/flash/{key}/{value}` GET — setFlashBag
- `/session/flash/{key}` GET — getFlashBag (consomme)

**HtmlController** (`/nodefony/test/html`) :

- `/stream` → stream JSON | `/download` → tsconfig.json attachment | `/media` → video/webm + Range
- `/upload` GET form | `/upload` POST formidable

**Zones « serveur de ressource » (P6.9, jetons émis AILLEURS)** — 3 zones, 3 verdicts :

- `test-external` → `/nodefony/test/external/whoami` (`ExternalJwtController`) : émetteur `.invalid`
  INJOIGNABLE par construction ⇒ éprouve la **PANNE** (503, jamais 401).
- `test-self-external` → `/nodefony/test/self-external/{whoami,scoped/read}` (`SelfExternalController`) :
  l'app est son PROPRE émetteur de confiance (découvrable RFC 8414, aucun `jwksUri` déclaré ⇒ découverte
  réelle) ⇒ éprouve le **SUCCÈS** + `@RequireScope("selfext:read")`.
- `test-foreign-audience` → `/nodefony/test/foreign-audience/whoami` (même fichier) : `resource`
  DIFFÉRENTE ⇒ le MÊME jeton valide est refusé (RFC 8707). Préfixe DISJOINT (deux zones qui se
  recouvrent feraient dépendre le verdict de l'ORDRE de déclaration).
- ⚠️ Le succès exige `NODE_EXTRA_CA_CERTS` (CA de dev, posé par `start.sh`) : le serveur se joint en
  https pour se découvrir. Sans, 503 — fidèle mais hors sujet.

**BenchOrmController** (`/nodefony/test/bench-orm`, OPT-IN `NF_BENCH_ORM=1`) :

- `/read` · `/read-lean` · `/write` · `/reset` · `/status` — cycle ORM sur corpus dolibarr (connector `default`, seed 50/200/10 k, `entity/benchOrm.ts`)
- `/nodefony/test/secure/bench-orm/read` — même lecture en zone `test-secure` (cycle session+entité)

## Statics — préfixe natif `/test/`

`public/` auto-monté sous `/test/` (server-static `mountModulePublics`, basename `@nodefony/test`). PLUS de `statics.test` ; fichiers à la RACINE de `public/` (pas `public/test/`).

- `/test/chico_buarque.mp3` (audio/mpeg) ← `public/chico_buarque.mp3`
- `/test/oceans-clip.webm` (video/webm) ← `public/oceans-clip.webm`
- `/favicon.ico` = racine app (`statics.web`→`./public`), PAS ce module
- ⚠️ `/media` lit `public/oceans-clip.webm` par chemin DIRECT (`module.path`), pas l'URL → bouger un fichier = MAJ HtmlController

## Debug bar sur page EJS (démo serveur-rendu)

- `RouteController` `/nodefony/test/route/ejs/{name}` rend `views/index.ejs` (lu depuis la **source**, pas dist).
- `DefaultController` `/nodefony/test/debugbar.js` sert le bundle **standalone** `nodefony/debugbar.js` (résolu+caché) + `mountDebugBar();` appended (auto-montant).
- `index.ejs` charge `<script type="module" src="/nodefony/test/debugbar.js">` — **externe** (pas inline) car la page EJS a CSP `script-src 'self'` (un inline serait bloqué ; les pages React surchargent la CSP, pas l'EJS).
- Pas de carte HMR (hors Vite) ; env/branche/realtime OK via WS studio même origine.

## Session

DefaultController + RestController : `initialize()` → `this.startSession("test")`.
RestController injecte `@inject("session")`.

## Sécurité (banc P6)

Zone `test-secure` (`SecureController`, routes `/nodefony/test/secure/*`) — bancs firewall/garde `@IsGranted`. ⚠️ Le service `"users"` (identité admin/user) n'est **PAS** posé ici : c'est l'**APP racine** (`provisionUsers`, `NF_USER_STORE` drizzle|memory) qui le fournit, dev ET prod. Ce module ne porte que les routes protégées. Fixtures `admin/user:secret` = `nodefony/security/devUsers.ts` (app).

## Dépendances

`@nodefony/framework`, `@nodefony/http`, `nodefony` — pas de deps externes.
