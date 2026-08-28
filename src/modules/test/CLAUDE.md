# CLAUDE.md — module test

## Docs liées

- [`MEMORY.md`](./MEMORY.md) — internals IA (routes, statics, session)
- [`../../packages/@nodefony/framework/CLAUDE.md`](../../packages/@nodefony/framework/CLAUDE.md) — décorateurs `@controller/@route/@Get/@Post/@Param/@Body/@Query`
- [`../../packages/@nodefony/http/CLAUDE.md`](../../packages/@nodefony/http/CLAUDE.md) — Context, HttpError, sanitisation headers
- [`../../../CLAUDE.md`](../../../CLAUDE.md) — règles globales + section "Lancer le serveur"

## Rôle du module

Module exemple de Nodefony — sert de **terrain de jeu pour les tests d'intégration** du framework.
Il expose des routes HTTP/WS couvrant tous les cas : sessions, contextes, crashes, uploads, streams.

> **Identité / `users`** : ce module ne pose **PLUS** le service `"users"`
> (source d'identité du firewall, comptes `admin`/`user` de la zone `test-secure`). C'est désormais
> l'**APP racine** qui le provisionne au boot, en dev ET en prod (`nodefony/security/provisionUsers.ts`,
> dépôt `NF_USER_STORE` = drizzle par défaut | memory pour la charge). Ce module ne fournit que les
> **routes protégées** (`SecureController`). Raison : avant, seul ce module dev-only posait `"users"`
> → l'auth était morte en production.

---

## Structure

```
src/modules/test/
├── index.ts
├── package.json
└── nodefony/
    ├── config/config.ts        ← surcharge "module-http" statics + sqlite connector
    ├── controller/
    │   ├── DefaultController.ts  ← /nodefony/test/* — context, header-echo, crashes
    │   ├── RestController.ts     ← /nodefony/test/rest/* — session CRUD + REST
    │   ├── HtmlController.ts     ← /nodefony/test/html/* — stream, download, upload, media
    │   ├── RouteController.ts    ← /nodefony/test/route/* — routing params, constraints
    │   ├── WebSocketController.ts ← WS echo, binary, broadcast, protocol
    │   ├── OpenapiController.ts  ← /nodefony/test/openapi/*
    │   └── GraphqlController.ts  ← /nodefony/test/graphql/*
    └── entity/BoatEntity.ts
```

---

## Routes disponibles pour les tests d'intégration

### DefaultController (`/nodefony/test`)

<!-- prettier-ignore -->
| Route | Méthode | Description |
| --- | --- | --- |
| `/index` | GET | 200 JSON `{}` — sanity check |
| `/index2` | GET | 502 — `nodefonyError("myError", 502)` |
| `/index3` | GET | 503 — `HttpError({foo:"bar"}, 503)` |
| `/context` | GET | JSON : type, scheme, method, host, remoteAddress, sessionId |
| `/header-echo?x-val=X` | GET | Reflète `X` dans header `x-echoed` — test sanitisation |
| `/crash/sync` | GET | `throw new Error(...)` → 500 |
| `/crash/async` | GET | `await Promise.reject(...)` → 500 |
| `/crash/native` | GET | `throw new TypeError(...)` → 500 |
| `/memory` | GET | `process.memoryUsage()` du serveur (rss, heapTotal, heapUsed, external) |
| `/forward` | GET | Forward vers `app:AppController:method1` |

### AlsController (`/nodefony/test/als-test`)

Sondes ALS (AsyncLocalStorage) pour BUG-001 (WS messages) + BUG-002 (`onAfterResponse`). État partagé `alsTestState` exporté, relu via `/state`.

| Route               | Méthode   | Description                                                                        |
| ------------------- | --------- | ---------------------------------------------------------------------------------- |
| `/after`            | GET       | register hook `onAfterResponse` → capture `requestId` ALS dans `byContext`         |
| `/after/user`       | GET       | `RequestContext.set("user")` puis hook lit le user                                 |
| `/after/late`       | GET       | hook1 (ALS restauré) register hook2 late → exerce la branche `_afterResponseFired` |
| `/state` / `/reset` | GET       | lecture / reset de `alsTestState`                                                  |
| `/ws`               | WEBSOCKET | echo `requestId`/`user`/`traceparent` ALS à chaque message + handshake             |
| `/ws/user`          | WEBSOCKET | message "login" → `set("user")`, persiste au message suivant                       |
| `/ws/after`         | WEBSOCKET | hook `onAfterResponse` au handshake → lit ALS à la fermeture                       |

> ⚠️ Au handshake WS, l'action reçoit `undefined` (pas `null`) → détecter via `message == null`, jamais `.toString()` un message absent.

### LifecycleController (`/nodefony/test/lifecycle`) — `initialize()` qui lève

Son `initialize()` **lève toujours** : toute route posée dessus exerce la frontière d'erreur du hook.
Isolé dans son propre controller pour que le throw n'empoisonne aucun controller partagé.

| Route            | Méthode   | Contrat observable                                                                       |
| ---------------- | --------- | ---------------------------------------------------------------------------------------- |
| `/init-crash`    | GET       | 500 JSON cohérent (code, message, `nodefony.requestId`), serveur sain                    |
| `/init-crash-ws` | WEBSOCKET | fermeture **1011** (RFC 6455 §7.4.1) — jamais une socket muette ni un handshake qui pend |

Les deux transports diffèrent parce que l'**ordre** diffère : en WS le controller est instancié au
handshake (avant `connect()`), donc l'échec ne peut pas se rendre en réponse HTTP. Banc :
`http/tests/http/lifecycle-init-crash.test.ts`.

### ReadinessController (`/nodefony/test/readiness`) — télécommande du registre de disponibilité

Décor du banc S5-R : le registre vit sur le Kernel, le banc parle à un serveur RÉEL dans un autre
process. Sans ces routes il ne pourrait qu'observer `/readyz` répondre 200 — c'est-à-dire ne rien
prouver.

| Route                 | Méthode | Description                                                            |
| --------------------- | ------- | ---------------------------------------------------------------------- |
| `/set/{name}/{state}` | GET     | `kernel.setReadiness(name, state === "ready")` — `blocked` sinon       |
| `/clear/{name}`       | GET     | `kernel.clearReadiness(name)`                                          |
| `/report`             | GET     | `{ blocked, contributors }` — l'état que la sonde, elle, ne lit jamais |

Attendu : un contributeur `blocked` fait passer `/readyz` de 200 à **503** pendant que `/livez`
reste **200**, et le retour à 200 se fait sans redémarrage. Bancs :
`http/tests/http/health.test.ts` et `framework/tests/integration/admin-dataplane.test.ts` (accord
de `livez.ready` avec `/readyz`). ⚠️ Un contributeur oublié laisse tout le reste de la suite devant
un pod hors service — le banc nettoie dans un `afterEach`.

### PipelineOrderController (`/nodefony/test/pipeline-order`) — mouchard d'ORDRE

Prouve **quand** le hook `initialize()` d'un controller s'exécute. Le mouchard est écrit par
`SecureController.initialize()` — qui vit en **zone protégée** — et l'état vit hors des instances
(`nodefony/secure/initializeProbe.ts`), sans quoi il ne survivrait pas à sa requête. Ces deux routes
sont **publiques** parce qu'un banc anonyme doit pouvoir relire ce qu'une zone fermée a écrit.

| Route          | Méthode | Description                                                           |
| -------------- | ------- | --------------------------------------------------------------------- |
| `/probe`       | GET     | `{ runs, identity, session }` — état vu par le dernier `initialize()` |
| `/probe/reset` | GET     | Remise à zéro entre deux cas de banc                                  |

Attendu : après un **401** (firewall) ou un **403** (`@IsGranted`), `runs` reste à **0** — rien du
controller ne s'exécute pour une requête refusée. Sur une requête servie, `identity` porte
l'utilisateur (le hook tourne après le firewall). Banc : `http/tests/http/pipeline-order.test.ts`.

### BackpressureRealtimeController (`/nodefony/test/bench`) — décor de banc, OPT-IN

Monté **uniquement** si `NF_BENCH_WS_BACKPRESSURE=1` (voir `index.ts`). Un endpoint
capable d'inonder une connexion sur demande est une amplification offerte à qui la
demande : il n'existe que le temps d'une mesure.

| Route           | Méthode   | Description                                                               |
| --------------- | --------- | ------------------------------------------------------------------------- |
| `/backpressure` | WEBSOCKET | endpoint realtime (JSON-RPC) — canal `bench:flood` + action `bench:flood` |

L'action `bench:flood {frames, bytes}` pousse N charges sur le canal et rend ce que
la sonde de CETTE connexion voit ensuite (`bufferedAmount`, `dropped`, `readyState`).
Elle sert le banc `ws-backpressure-e2e.mjs` (skill `nodefony-load-test`), qui vérifie
que les seuils `config.backpressure` mordent sur une socket réelle — ce qu'aucun test
unitaire ne peut faire, puisqu'ils simulent `bufferedAmount`.

> ⚠️ **Le banc n'est pas encore vert** : le verrou de frame refuse `subscribe` et
> l'action pour une connexion anonyme, cause non isolée. Détail et conduite à tenir
> dans le SKILL.md du banc — ne pas désarmer la garde pour faire passer la mesure.

### BenchOrmController (`/nodefony/test/bench-orm`) — décor de banc, OPT-IN

Monté **uniquement** si `NF_BENCH_ORM=1` (voir `index.ts`) : profil du cycle ORM sur le corpus
Dolibarr (entités `llx_user`/`llx_societe`/`llx_facture` enregistrées sur le connector `default`,
seed idempotent 50/200/10 000 au boot — `entity/benchOrm.ts` (corpus dolibarr gitignoré chargé dynamiquement)). Tout traverse la couche
repository framework (orm-core → Drizzle), jamais le driver nu. Routes en GET (wrk sans script Lua).

**Multi-dialecte** : le décor suit le connector `default` — `NF_DATABASE_URL=postgres://…` charge
la variante pg-core du corpus (`dolibarr/bench-pg.js`, générée localement par
`dolibarr/gen-bench-pg.mjs` avec son DDL PG complet `bench-pg.sql` à poser AVANT le boot : le DDL
dérivé dev n'émet ni `DEFAULT` ni identity). `mysql` → fail-loud (variante non générée). En prod,
`NF_ADMIN_PASSWORD` est requis pour la route secure (aucun compte seedé sinon), et le login doit
se faire sur le MÊME canal (http/https) que le banc.

| Route                                  | Description                                                            |
| -------------------------------------- | ---------------------------------------------------------------------- |
| `/read`                                | 20 factures `WHERE fk_user_author = 7`, rows entières                  |
| `/read-lean`                           | même SELECT, réponse `{n}` — isole le coût JSON par soustraction       |
| `/write`                               | INSERT facture FK user+societe (`ref: BENCH-<seq>`)                    |
| `/reset`                               | DELETE des `BENCH-%` — AVANT chaque run d'écriture                     |
| `/status`                              | comptes (preuve « cible valide » avant mesure)                         |
| `/nodefony/test/secure/bench-orm/read` | même lecture DERRIÈRE le firewall (zone `test-secure`) = cycle complet |

### RestController (`/nodefony/test/rest`)

| Route                          | Méthode | Description                               |
| ------------------------------ | ------- | ----------------------------------------- |
| `/session`                     | GET     | Session info : id, name, status, strategy |
| `/session`                     | DELETE  | Détruit la session                        |
| `/session/set/{key}/{value}`   | GET     | `session.set(key, value)`                 |
| `/session/get/{key}`           | GET     | `session.get(key)` → JSON                 |
| `/session/flash/{key}/{value}` | GET     | `session.setFlashBag(key, value)`         |
| `/session/flash/{key}`         | GET     | `session.getFlashBag(key)` (consomme)     |

### HtmlController (`/nodefony/test/html`)

| Route       | Méthode | Description                                                 |
| ----------- | ------- | ----------------------------------------------------------- |
| `/stream`   | GET     | Stream JSON                                                 |
| `/download` | GET     | `content-disposition: attachment; filename="tsconfig.json"` |
| `/media`    | GET     | Stream video/webm (Range headers supportés)                 |
| `/upload`   | GET     | Form HTML upload                                            |
| `/upload`   | POST    | Upload fichier (multipart — `@fastify/busboy`)              |

### Fichiers statiques — préfixe natif `/test/`

Le `public/` du module est **auto-monté sous `/test/`** par `server-static`
(`mountModulePublics`, préfixe = basename du nom `@nodefony/test`). Plus de clé
`statics.test` dans `config.ts` ; les fichiers vivent **à la racine de `public/`**
(pas `public/test/` — sinon double préfixe `/test/test/`).

> Surchargeable par module : `config.ts` top-level `publicMount: { publicPath, dir }`
> (ou `false` pour opt-out) — défaut `{ publicPath: "/<basename>/", dir: "public" }`.

- `/test/chico_buarque.mp3` — audio/mpeg (← `public/chico_buarque.mp3`)
- `/test/oceans-clip.webm` — video/webm (← `public/oceans-clip.webm`)
- `/favicon.ico` — servi par la **racine app** (`statics.web` → `./public`), pas par ce module

> ⚠️ `HtmlController` `/media` lit `public/oceans-clip.webm` **par chemin direct**
> (`resolve(module.path, "public", "oceans-clip.webm")`) — pas via l'URL. Déplacer
> un fichier de `public/` = mettre à jour ce chemin.

---

## Conventions

- Chaque nouveau test d'intégration qui a besoin d'une route → l'ajouter ici dans le controller approprié
- **Activation de session = `@UseSession()`** (classe/méthode) — plus de `this.startSession()` (refonte). DefaultController = `@UseSession()` ; `SessionRuntimeController` = controller DÉDIÉ au cycle de vie (lazy/intent/readOnly/L1/regen/destroy + WS). Plus d'« aire » de session (`context`) — concept legacy retiré.
- `RestController`/`SessionRuntimeController` utilisent `@Session()` param + `this.session` (getter)

---

## Ce qu'il ne faut JAMAIS faire

- Ajouter de la logique métier (ce module est un outil de test, pas un exemple d'app)
- Supprimer des routes existantes sans vérifier les tests qui en dépendent
- Modifier `config.ts` sans vérifier les tests statiques
