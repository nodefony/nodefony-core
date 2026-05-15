---
name: test-module-memory
description: "module test — routes HTTP/WS de test d'intégration, controllers, statics"
metadata:
  type: project
---

# module test MEMORY

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

## Statics
Config surcharge `"module-http".statics.test` → `src/modules/test/public/`
- `/test/chico_buarque.mp3` (audio/mpeg)
- `/test/oceans-clip.webm` (video/webm)
- `/favicon.ico`

## Session
DefaultController + RestController : `initialize()` → `this.startSession("test")`.
RestController injecte `@inject("session")`.

## Dépendances
`@nodefony/framework`, `@nodefony/http`, `nodefony` — pas de deps externes.
