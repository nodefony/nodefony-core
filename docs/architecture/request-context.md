---
module: "@nodefony/core"
topic: request-context
audience: [human, ai]
tags: [als, async-local-storage, request-context, request-id, user, traceparent, p1.4]
status: draft
last-updated: 2026-05-20
---

# RequestContext — AsyncLocalStorage façade

> Propagation transparente du contexte par requête (HTTP ou WebSocket) à travers tout le pipeline async, sans threader manuellement `requestId`/`user`/`traceparent` dans chaque appel de fonction.

## Métaphore

> Imagine un restaurant. Plusieurs serveurs s'occupent de ta table : l'un apporte l'entrée, l'autre le vin, un troisième l'addition. Aucun ne se trompe de table — ils regardent le numéro inscrit dessus.
>
> `RequestContext` c'est exactement ça : une "table" invisible attachée à chaque requête. Tous les services qui s'exécutent pour cette requête peuvent lire les infos de la table (`requestId`, `user`...), sans qu'on leur passe explicitement.

## Vue d'ensemble

```
[ Requête HTTP arrive ]
       │
       ▼
 ┌────────────────────────────────────────────────────────┐
 │ HttpKernel.handleHttp()                                │
 │                                                        │
 │  RequestContext.run({ requestId, scheme }, async () => │  ← Bulle ALS ouverte
 │    await context.handle()                              │
 │      → Resolver                                        │
 │        → Firewall                                      │
 │          → Controller.action()                         │
 │            → MyService.query()                         │
 │              → RequestContext.getRequestId() ✓         │
 │  )                                                     │  ← Bulle ALS fermée
 └────────────────────────────────────────────────────────┘
```

Chaque service du pipeline peut faire `RequestContext.getRequestId()` ou `RequestContext.getUser()` sans qu'on ait transporté ces valeurs en argument à travers les couches.

## Sans `RequestContext` — la douleur

```typescript
// ❌ AVANT : il faut threader userId partout
async function controller(req): Promise<Response> {
  const userId = req.userId;
  return await service.createProject(dto, userId);
}

async function createProject(dto: Dto, userId: string): Promise<Project> {
  return await repo.save(dto, userId);
}

async function save(dto: Dto, userId: string): Promise<Project> {
  console.log(`User ${userId} created project`);  // ← obligé de l'avoir ici
  return await db.insert(dto);
}
```

## Avec `RequestContext` — propre

```typescript
// ✅ APRÈS : userId disponible partout sans le threader
async function controller(req): Promise<Response> {
  return await service.createProject(dto);
}

async function createProject(dto: Dto): Promise<Project> {
  return await repo.save(dto);
}

async function save(dto: Dto): Promise<Project> {
  const userId = RequestContext.getUserId();   // ← magique
  console.log(`User ${userId} created project`);
  return await db.insert(dto);
}
```

## API

```typescript
import { RequestContext } from "nodefony";

// Ouvrir une bulle (fait par HttpKernel automatiquement)
RequestContext.run({ requestId, scheme, user, traceparent }, async () => {
  // tout code à l'intérieur voit le payload
  await deepFunction();
});

// Lire (depuis n'importe où dans le code async DESCENDANT)
RequestContext.get();                  // payload entier ou undefined
RequestContext.getRequestId();         // string | undefined
RequestContext.getUser();              // unknown | undefined (set par firewall post-auth)
RequestContext.getUserId();            // string | undefined

// Muter le store actuel (par exemple après auth)
RequestContext.set("user", userInstance);   // pas besoin de re-run
```

## Payload — shape ouverte

```typescript
interface RequestContextPayload {
  requestId: string;       // toujours présent — généré au boot du context
  scheme?: string;         // "http" | "https" | "ws" | "wss"
  userId?: string;         // set par Firewall après afterAuth (P6)
  user?: unknown;          // set par Firewall après afterAuth (P6)
  traceparent?: string;    // W3C traceparent (P2.7) — OpenTelemetry compat
  [key: string]: unknown;  // les modules peuvent ajouter leurs propres clés
}
```

Les modules consommateurs ajoutent leurs propres clés sans interférer (Open/Closed Principle).

## Performance

- `AsyncLocalStorage.run()` : ~50-100 ns par requête (Node.js 22+)
- `getStore()` : ~20-30 ns (hot path)
- L'instance ALS est **lazy** dans `RequestContext` : créée au premier appel à `run()`. Importer la classe coûte 0 si jamais utilisée.

## Implémentation

```typescript
// src/nodefony/src/runtime/RequestContext.ts
import { AsyncLocalStorage } from "node:async_hooks";

class RequestContext {
  private static _als: AsyncLocalStorage<RequestContextPayload> | null = null;

  private static get als(): AsyncLocalStorage<RequestContextPayload> {
    if (this._als === null) {
      this._als = new AsyncLocalStorage<RequestContextPayload>();
    }
    return this._als;
  }

  static run<T>(payload: RequestContextPayload, fn: () => T): T {
    return this.als.run(payload, fn);
  }

  static get(): RequestContextPayload | undefined {
    if (this._als === null) return undefined;  // jamais ouvert → fast path
    return this._als.getStore();
  }

  static getRequestId(): string | undefined {
    return this.get()?.requestId;
  }

  static getUser(): unknown | undefined {
    return this.get()?.user;
  }

  static getUserId(): string | undefined {
    return this.get()?.userId;
  }

  static set<K extends keyof RequestContextPayload>(
    key: K,
    value: RequestContextPayload[K],
  ): void {
    const store = this.get();
    if (store) store[key] = value;
  }
}
```

## Où la bulle est ouverte

Dans `@nodefony/http/service/http-kernel.ts` :

### HTTP

```typescript
// http-kernel.ts:594
async handleHttp(scope, request, response, type) {
  const context = this.createHttpContext(scope, request, response, type);
  // ...
  return await RequestContext.run(
    { requestId: context.requestId, scheme: context.scheme, traceparent: context.traceparent },
    async () => {
      await context.request.initialize();
      const ctx = await this.onRequestEnd(context);
      if (ctx instanceof Context) return await ctx.handle();
      return context;
    },
  );
}
```

### WebSocket (handshake)

```typescript
// http-kernel.ts:807
async handleWebsocket(scope, ws, req, type) {
  const context = this.createWebsocketContext(scope, req, ws, type);
  // ...
  return await RequestContext.run(
    { requestId: context.requestId, scheme: context.scheme, traceparent: context.traceparent },
    async () => {
      await this.onConnect(context, error);
      if (this.firewall) await this.firewall.handleSecurity(context);
      return await context.handle();
    },
  );
}
```

## ⚠️ Bugs connus (BLOCKER P6)

Voir [`BUG_REPORT.md`](../../BUG_REPORT.md) racine.

### BUG-001 — ALS WS messages

Le listener `connection.on("message", handleMessage.bind(this))` (`WebsocketContext.ts:146`) est attaché DANS la bulle ALS du handshake, mais quand un message arrive plus tard, Node.js l'émet dans un **tick d'event loop distinct**, HORS de la bulle ALS.

**Conséquence** : `RequestContext.getUser()` retourne `undefined` dans les handlers de message WS.

**Fix proposé** : `AsyncResource.bind()` pour capturer/restaurer le store ALS :

```typescript
import { AsyncResource } from "node:async_hooks";

// AVANT (BUG)
this.connection.on("message", this.handleMessage.bind(this));

// APRÈS (FIX)
this.connection.on("message", AsyncResource.bind(this.handleMessage.bind(this)));
```

### BUG-002 — ALS perdu dans `onAfterResponse`

Le listener `response.once("finish", onFinish)` est attaché DANS `createHttpContext()` qui est appelé **AVANT** `RequestContext.run()`. Quand l'event `finish` se déclenche (souvent un tick plus tard), `_runAfterResponse()` exécute les callbacks user HORS bulle ALS.

**Conséquence** : `@AuditLog` post-réponse ne voit pas `requestId`/`user`.

**Fix proposé** : `AsyncResource.bind()` au moment du `onAfterResponse(fn)` :

```typescript
// Context.ts:onAfterResponse — APRÈS
onAfterResponse(fn: AfterResponseHandler): void {
  const boundFn = AsyncResource.bind(fn);   // capture la bulle ALS active
  // ...
  this._afterResponseFns.push(boundFn);
}
```

## Isolation concurrente

`AsyncLocalStorage` garantit que **chaque requête voit son propre store**, même quand N requêtes s'exécutent en concurrence. Validé par `request-context.test.ts` (10 requêtes concurrentes, chacune voit son propre `requestId`).

## Tests

```bash
cd src/packages/@nodefony/http
npm run test:integration 2>&1 | grep -A 30 "P1.4 — RequestContext"
```

Tests existants (6) :
- ALS requestId == context.requestId
- ALS requestId == X-Request-Id header
- X-Request-Id client honored
- ALS scheme set
- ALS survives async hop (await setTimeout)
- Isolation 10 concurrent requests

**⚠️ Pas de test WS messages** ni `onAfterResponse` ALS → BUG-001/002 non couverts.

## Liens

- **Code source** : `src/nodefony/src/runtime/RequestContext.ts`
- **Export** : `src/nodefony/src/index.ts` (re-export depuis le barrel)
- **Tests** : `src/packages/@nodefony/http/nodefony/tests/integration/request-context.test.ts`
- **MEMORY.md** : `src/nodefony/MEMORY.md` (section runtime)
- **BUG_REPORT** : `BUG_REPORT.md` racine (BUG-001, BUG-002)
- **Mémoire IA** : `project_als_ws_bug.md`
- **Graphe symbolique** : `jq '.symbols.RequestContext' .ai/symbols.json`
