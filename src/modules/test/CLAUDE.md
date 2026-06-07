# CLAUDE.md — module test

## Docs liées

- [`MEMORY.md`](./MEMORY.md) — internals IA (routes, statics, session)
- [`../../packages/@nodefony/framework/CLAUDE.md`](../../packages/@nodefony/framework/CLAUDE.md) — décorateurs `@controller/@route/@Get/@Post/@Param/@Body/@Query`
- [`../../packages/@nodefony/http/CLAUDE.md`](../../packages/@nodefony/http/CLAUDE.md) — Context, HttpError, sanitisation headers
- [`../../../CLAUDE.md`](../../../CLAUDE.md) — règles globales + section "Lancer le serveur"

## Rôle du module

Module exemple de Nodefony — sert de **terrain de jeu pour les tests d'intégration** du framework.
Il expose des routes HTTP/WS couvrant tous les cas : sessions, contextes, crashes, uploads, streams.

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

| Route                  | Méthode | Description                                                             |
| ---------------------- | ------- | ----------------------------------------------------------------------- |
| `/index`               | GET     | 200 JSON `{}` — sanity check                                            |
| `/index2`              | GET     | 502 — `nodefonyError("myError", 502)`                                   |
| `/index3`              | GET     | 503 — `HttpError({foo:"bar"}, 503)`                                     |
| `/context`             | GET     | JSON : type, scheme, method, host, remoteAddress, sessionId             |
| `/header-echo?x-val=X` | GET     | Reflète `X` dans header `x-echoed` — test sanitisation                  |
| `/crash/sync`          | GET     | `throw new Error(...)` → 500                                            |
| `/crash/async`         | GET     | `await Promise.reject(...)` → 500                                       |
| `/crash/native`        | GET     | `throw new TypeError(...)` → 500                                        |
| `/memory`              | GET     | `process.memoryUsage()` du serveur (rss, heapTotal, heapUsed, external) |
| `/forward`             | GET     | Forward vers `app:AppController:method1`                                |

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
| `/upload`   | POST    | Upload fichier (formidable)                                 |

### Fichiers statiques

Servis via `serve-static` depuis `src/modules/test/public/` (clé `test` dans statics) :

- `/test/chico_buarque.mp3` — audio/mpeg
- `/test/oceans-clip.webm` — video/webm
- `/favicon.ico` — image/x-icon

---

## Conventions

- Chaque nouveau test d'intégration qui a besoin d'une route → l'ajouter ici dans le controller approprié
- **Activation de session = `@UseSession()`** (classe/méthode) — plus de `this.startSession()` (refonte 2026-06-07). DefaultController = `@UseSession({ context: "test" })` ; `SessionRuntimeController` = controller DÉDIÉ au cycle de vie (lazy/intent/readOnly/L1/regen/destroy + WS).
- `RestController`/`SessionRuntimeController` utilisent `@Session()` param + `this.session` (getter)

---

## Ce qu'il ne faut JAMAIS faire

- Ajouter de la logique métier (ce module est un outil de test, pas un exemple d'app)
- Supprimer des routes existantes sans vérifier les tests qui en dépendent
- Modifier `config.ts` sans vérifier les tests statiques
