# BUG_REPORT — Nodefony Core

Bugs structurels identifiés mais non encore corrigés. Triés par criticité.

## Audit exhaustif listeners EventEmitter @nodefony/http (2026-05-20)

43 listeners scannés (grep `.on()/.once()/prependOnceListener` sur tout le module hors tests/commentés) :

| Catégorie | # | Statut |
|-----------|---|--------|
| Boot/teardown kernel | 10 | ✅ OK (hors request scope attendu) |
| Server-level (request/connection/error) | 11 | ✅ OK (eux ouvrent la bulle ALS) |
| **BUGS confirmés** (BUG-001 + BUG-002) | **5** | 🚨 Documentés ci-dessous |
| DANS request scope, handlers triviaux | 7 | ⚠️ Surveillance (voir tableau dans mémoire `project_als_ws_bug`) |
| Code commenté | 5 | — Skip |

**Conclusion audit** : aucun nouveau bug majeur au-delà de BUG-001 + BUG-002. Les 7 listeners catégorie D (Request.ts:93, parser.ts:13, Request.ts:126, http-kernel.ts:269, http-kernel.ts:757, Context.ts:305, HttpContext.ts:132) ont des handlers qui ne lisent PAS l'ALS aujourd'hui — pas de fuite de contexte actuelle, mais si on les étend, appliquer `AsyncResource.bind` au moment du bind.

**Vérifications externes restantes** :
- Pas de `stream.on()/session.on()` HTTP/2 dans le module → OK en l'état
- SSE dans Studio (`rawRes.on("close")` mentionné dans `feedback_sse_http2_request_close`) — à auditer quand Studio scopé sécurité (P10.x)

---

## 🚨 BUG-001 — ALS WebSocket : bulle non propagée aux messages (BLOCKER P6)

**Découvert** : 2026-05-20
**Sévérité** : BLOCKER pour P6 (couche security)
**Phase impactée** : P6 (security décorateurs WS isomorphes), P12 (agents IA WS), P13 (Realtime)
**Statut** : non corrigé — fix proposé, tests à écrire

### Description

`RequestContext` (AsyncLocalStorage façade, `src/nodefony/src/runtime/RequestContext.ts`) est correctement
propagé pour les requêtes HTTP (validé par 6 tests dans `request-context.test.ts`). Mais pour les
connexions WebSocket, la bulle ALS n'est ouverte que pendant le **handshake**, pas autour des messages
suivants.

### Code source du bug

**`src/packages/@nodefony/http/nodefony/service/http-kernel.ts:807-847`** :

```ts
return await RequestContext.run({ requestId, scheme, traceparent }, async () => {
  await this.onConnect(context, error);
  // firewall + context.handle() exécutés ICI dans la bulle ALS
});
// ← La bulle se ferme ici quand le await termine
```

`context.handle()` appelle `context.connect()` (`WebsocketContext.ts:134-150`) qui attache le listener :

```ts
// WebsocketContext.ts:146
this.connection.on("message", this.handleMessage.bind(this));
```

Quand un message arrive après le handshake, Node.js émet l'event `message` dans un **nouveau tick
d'event loop**, **HORS de toute bulle ALS** (la bulle du handshake est fermée depuis longtemps).

### Conséquence

- `RequestContext.getRequestId()` retourne `undefined` dans `handleMessage` → controllers WS perdent le requestId
- `RequestContext.getUser()` retourne `undefined` dans `handleMessage` → décorateurs `@CurrentUser()`,
  `@IsGranted()`, `@AuditLog()` ne marchent pas sur les handlers de message WS
- L'isomorphisme HTTP+WS promis par l'architecture est cassé pour la sécurité par message
- Idem pour `traceparent` (W3C tracing perdu)

### Aucun test ne couvre ça

- `nodefony/tests/integration/request-context.test.ts` : **HTTPS only**, aucun WS
- `nodefony/tests/http/traceparent.test.ts` : ligne 149+ teste le handshake WS, **PAS les messages
  suivants**
- 7 fichiers tests `websockets/*.test.ts` — aucun n'exerce `RequestContext.getStore()` côté handler
  de message

### Fix proposé

Utiliser `AsyncResource.bind()` (Node.js standard idiomatic) pour capturer le store ALS au moment de
l'attachement du listener :

```ts
// WebsocketContext.ts — AVANT (BUG)
this.connection.on("close", this.onClose.bind(this));
this.connection.on("message", this.handleMessage.bind(this));

// APRÈS (FIX)
import { AsyncResource } from "node:async_hooks";
this.connection.on("close", AsyncResource.bind(this.onClose.bind(this)));
this.connection.on("message", AsyncResource.bind(this.handleMessage.bind(this)));
```

`AsyncResource.bind` capture le store actif au moment du `bind` (DANS la bulle ALS du handshake)
et le restaure à chaque appel du listener.

Le store ALS étant un objet par référence, `RequestContext.set('user', user)` après auth propage
automatiquement aux futurs appels du handler bindé. Pas besoin de re-bind après login.

### Coût mémoire / perf

- `AsyncResource.bind` : ~100-150 ns par bind (one-shot), ~20-30 ns surplus par call vs `.bind` simple
- Mémoire : 1 référence supplémentaire par listener bindé (le snapshot du contexte ALS)
- Acceptable selon CLAUDE.md "Règle absolue perf+mémoire" — c'est un coût d'init connexion, pas hot path par message

### Tests à écrire AVANT fix

Créer `nodefony/tests/integration/request-context-ws.test.ts` :

1. **Persistence handshake → message N** : ALS `requestId` survit handshake + 3 messages + close (tous égaux)
2. **Isolation concurrente** : 10 sockets simultanés, chacun voit son propre `requestId` à travers 5 messages
3. **`user` propagation** : simuler `firewall.afterAuth → RequestContext.set('user', user)`, vérifier
   que `handleMessage` suivant le voit
4. **`traceparent` propagation** : header présent au handshake → visible dans handler de message
5. **Memory leak** : 100 connexions × 10 messages → heap delta < 5 MB (cf règle absolue)

### Routes test à ajouter dans `src/modules/test`

```ts
// Controller WS exposant un endpoint qui retourne RequestContext.getRequestId()
// à chaque message reçu, pour validation cross-message
@RealtimeController('/ws/als-test')
class AlsTestWsController {
  @RealtimeEvent('echo-request-id')
  echo() {
    return { requestId: RequestContext.getRequestId(), user: RequestContext.getUser() };
  }
}
```

(adapté au pattern WS Nodefony existant si `@RealtimeController` pas encore présent)

### Plan d'action

1. Session dédiée AVANT démarrage P6
2. Écrire les 5 tests (qui doivent ECHOUER initialement pour prouver le bug)
3. Appliquer le fix `AsyncResource.bind` sur TOUS les listeners persistants (`close`, `message`, `error`)
4. Vérifier que les 5 tests passent
5. Vérifier que la suite complète `memory.test.ts` passe (règle absolue perf+mémoire — voir CLAUDE.md
   et mémoire `feedback_perf_memory_rule`)
6. Commit + push avant de démarrer P6

### Liens

- Mémoire dédiée : `project_als_ws_bug.md`
- Mémoire perf+mémoire règles : `feedback_perf_memory_rule.md`
- Code : `src/packages/@nodefony/http/nodefony/service/http-kernel.ts:807-847`
- Code : `src/packages/@nodefony/http/nodefony/src/context/websocket/WebsocketContext.ts:143-146,253`
- Façade : `src/nodefony/src/runtime/RequestContext.ts`

---

## 🚨 BUG-002 — ALS perdu dans `onAfterResponse` (HTTP + WS) (BLOCKER P6)

**Découvert** : 2026-05-20 (suite à investigation BUG-001)
**Sévérité** : BLOCKER pour P6 (décorateur `@AuditLog`)
**Phase impactée** : P6 (audit log), P3 (logs structurés post-réponse)
**Statut** : non corrigé — fix proposé, tests à écrire

### Description

`Context.onAfterResponse(fn)` (P1.2) permet d'enregistrer des callbacks qui s'exécutent après l'envoi
de la réponse (HTTP) ou la fermeture de la socket (WS). Mécanisme dédup finish/close. Mais ces
callbacks s'exécutent **HORS de la bulle ALS** ouverte par `RequestContext.run()`, perdant ainsi
`requestId`, `user`, `traceparent`, etc.

### Code source du bug

**Côté HTTP** (`http-kernel.ts:548-592`) — `createHttpContext` attache les listeners
`response.once("finish", ...)` / `response.once("close", ...)` **AVANT** que `handleHttp` n'ouvre
la bulle ALS (ligne 616 : `await RequestContext.run(...)`). Les events `finish`/`close`
sont émis par Node.js dans un tick d'event loop distinct (synchronous flush) ou bien plus tard
(client disconnect) — toujours hors de la bulle ALS.

```ts
// http-kernel.ts:573-585 — listeners attachés hors bulle ALS
const teardown = async () => {
  response.removeListener("finish", onFinish);
  response.removeListener("close", onClose);
  if (!context || context.finished) return;
  context.logRequest();
  await context._runAfterResponse();  // ← user callbacks exécutés HORS bulle ALS
  ...
};
const onFinish = () => { didFinish = true; void teardown(); };
const onClose = () => { ...; void teardown(); };
response.once("finish", onFinish);
response.once("close", onClose);
```

**Côté WS** (`http-kernel.ts:741-768`) — `createWebsocketContext` enregistre
`context.once("onFinish", async () => { ... await context._runAfterResponse(); ... })`. Même
problème : l'event `onFinish` fire hors de la bulle ALS du handshake.

### Conséquence

```ts
// Tout pattern @AuditLog ferait :
context.onAfterResponse((ctx) => {
  audit.log({
    user: RequestContext.getUser(),          // ❌ undefined
    requestId: RequestContext.getRequestId(), // ❌ undefined
    traceparent: RequestContext.get('traceparent'), // ❌ undefined
    statusCode: ctx.response.statusCode,
    durationMs: Date.now() - ctx.startTime,
  });
});
```

Workaround possible via `ctx.requestId` (passé en argument du callback), mais asymétrique vs le
reste du framework. Pour `user` post-auth, il faudrait `ctx.user` — pas encore exposé.

### Aucun test ne couvre ça

`nodefony/tests/integration/after-response.test.ts` — 5 tests qui vérifient :
- Hook fire après 200
- Hook fire UNE seule fois (dedup finish vs close)
- Plusieurs requêtes successives
- Plusieurs hooks ordre
- Hook fire après 500 (throw)

**0 test ne vérifie `RequestContext.getRequestId()`/`getUser()` dans le hook user**.

### Fix proposé

`AsyncResource.bind()` au moment de l'enregistrement dans `Context.onAfterResponse`. Le
controller qui enregistre est DANS la bulle ALS de la request — `AsyncResource.bind(fn)` capture
le bon store et le restaure quand le hook fire plus tard.

```ts
// Context.ts:252 — AVANT
onAfterResponse(fn: AfterResponseHandler): void {
  if (this._afterResponseFired) {
    Promise.resolve().then(() => fn(this))
      .catch((e) => this.log(e, "ERROR", "onAfterResponse(late)"));
    return;
  }
  if (this._afterResponseFns === null) this._afterResponseFns = [];
  this._afterResponseFns.push(fn);
}

// APRÈS
import { AsyncResource } from "node:async_hooks";

onAfterResponse(fn: AfterResponseHandler): void {
  // Capture ALS store at registration time (we're in the request's ALS bubble)
  // so the hook restores the correct context when it fires later (outside the bubble).
  const boundFn = AsyncResource.bind(fn);
  if (this._afterResponseFired) {
    Promise.resolve().then(() => boundFn(this))
      .catch((e) => this.log(e, "ERROR", "onAfterResponse(late)"));
    return;
  }
  if (this._afterResponseFns === null) this._afterResponseFns = [];
  this._afterResponseFns.push(boundFn);
}
```

**Avantage Option B (registration-time bind)** vs Option A (refactor kernel) :
- Localisation chirurgicale dans `Context.ts`, pas de touche au kernel
- Couvre automatiquement futurs hooks similaires (`onAfterAuth`, `onPreShutdown`, etc.)
- Compatibilité parfaite : `AsyncResource.bind(fn)` est transparent côté API user
- Pas de re-bind si `RequestContext.set('user', user)` après auth (store par référence)

### Coût mémoire / perf

- `AsyncResource.bind` : 1 alloc par registration (~120 bytes pour le snapshot)
- Hot path inchangé : pas appelé sur chaque request, juste sur chaque `onAfterResponse(fn)`
- Acceptable selon CLAUDE.md "Règle absolue perf+mémoire"

### Tests à écrire AVANT fix

Étendre `after-response.test.ts` ou créer `after-response-als.test.ts` :

1. **ALS context restored in hook (HTTP)** : controller register hook qui retourne `RequestContext.getRequestId()` (via side-effect, ex stocker dans /state). Après request, vérifier que le hook a vu le bon requestId
2. **ALS context restored in hook (WS)** : équivalent côté WebSocket via `nodefony/tests/integration/request-context-ws.test.ts` (cf BUG-001)
3. **User propagation post-auth** : simuler `RequestContext.set('user', user)` au milieu de la request, vérifier que le hook voit le user
4. **Multiple hooks isolation** : 2 requests concurrentes, chacune avec son hook — vérifier que chaque hook voit son propre requestId (pas de cross-talk)
5. **Hook tardif (after fired)** : si `onAfterResponse(fn)` enregistré APRÈS que `_afterResponseFired` est true (late subscribe), le hook fire sur next microtask — vérifier ALS aussi restauré dans ce cas

### Plan d'action

Combiner avec BUG-001 (même session, même fix `AsyncResource.bind` mais à différents endroits) :

1. Session dédiée AVANT P6
2. Tests d'abord (ECHEC initial = bugs confirmés)
3. Fix BUG-001 (`AsyncResource.bind` dans `WebsocketContext` pour `close`, `message`, `error`)
4. Fix BUG-002 (`AsyncResource.bind` dans `Context.onAfterResponse`)
5. Vérifier tous les tests passent
6. **OBLIGATOIRE** `memory.test.ts` (règle absolue perf+mémoire)
7. Commit + push avant P6.0

### Liens

- Mémoire dédiée : `project_als_ws_bug.md` (étendue pour BUG-002)
- Code HTTP : `src/packages/@nodefony/http/nodefony/service/http-kernel.ts:548-592`
- Code WS : `src/packages/@nodefony/http/nodefony/service/http-kernel.ts:741-768`
- Code Context : `src/packages/@nodefony/http/nodefony/src/context/Context.ts:252-279`
- Tests existants : `src/packages/@nodefony/http/nodefony/tests/integration/after-response.test.ts`
