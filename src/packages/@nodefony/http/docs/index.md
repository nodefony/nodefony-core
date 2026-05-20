---
title: "@nodefony/http"
module: "@nodefony/http"
since: "10.0.0"
updated: "2026-05-20"
status: stable
order: 0
---

# @nodefony/http

> Couche transport bas niveau de Nodefony — serveurs HTTP/1.1, HTTPS, HTTP/2 et WebSocket (`ws`) construits sur les modules natifs `node:http`, `node:http2` et `node:tls`, plus les **Contextes** unifiés qui portent une requête HTTP **ou** WS à travers tout le pipeline.

## Vue d'ensemble

`@nodefony/http` est la **base technique** sur laquelle reposent `@nodefony/framework` (Router/Controller) et tous les modules applicatifs. Il ne connaît ni les routes ni les controllers : il accepte une connexion, en fabrique un `Context`, ouvre un scope DI par requête, puis délègue la résolution au resolver injecté par framework (`(context as any)?.resolver`) — jamais d'import direct de framework (dépendance circulaire interdite).

Différenciateur Nodefony : **HTTP et WebSocket sont co-citoyens**. Un `HttpContext` et un `WebsocketContext` partagent la même classe de base `Context`, le même cycle de vie (`onRequest` → … → `onFinish`) et la même propagation `requestId` via `AsyncLocalStorage` (`RequestContext`).

## Serveurs

| Serveur | Module natif | Port défaut (dev) |
| --- | --- | --- |
| HTTP/1.1 | `node:http` | 5151 |
| HTTPS / HTTP/2 | `node:http2` (ALPN h2 + fallback h1) | 5152 |
| WebSocket / WSS | `ws` (greffé sur les serveurs HTTP/HTTPS) | — |

Chaque serveur est un `Service` injectable, démarré par le `HttpKernel` au boot (gate `initServers` selon le `KernelType`).

## Cycle de vie d'une requête

```
connexion → HttpKernel.handleHttp / handleWebsocket
  → RequestContext.run({ requestId, scheme, user }, …)   // ALS
  → new Context(...) + scope DI par requête
  → fire("onRequest") … phases pipeline …
  → resolver.resolve(context)                            // délégué à framework
  → réponse / upgrade WS
  → fire("onFinish") + teardown scope                    // cleanup garanti
```

## Pièges mémoire (règle perf ABSOLUE)

- Pas d'allocation dans le constructeur de `Context` sans usage **sur chaque** requête → `null` + lazy init.
- Tout `response.on(...)` / `ws.on(...)` doit prévoir son `removeListener` (ou `once` + cleanup).
- SSE / long-polling : écouter `rawRes.once("close")` sur la **RESPONSE**, jamais `request.on("close")` (fire trop tôt en HTTP/2).
- Avant tout commit touchant le pipeline : suite mémoire `memory.test.ts` (seuils 35 MB/1000 req HTTP, 30 MB/100 WS).

## Data plane admin (Studio)

Producteur `IAdminApi` namespace `http` → `/nodefony/http/api/*` (ex `sessions`). Convention : toujours `≥ 3` segments (jamais `/nodefony/http` mono-segment, réservé aux pages SPA Studio).

## Voir aussi

- `MEMORY.md` du module — internals, signatures `node:http2`, gotchas.
- `@nodefony/framework` — Router/Controller bâtis au-dessus.
