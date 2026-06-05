# @nodefony/http

Module **central** de Nodefony : tous les serveurs (HTTP / HTTPS / HTTP2 / WS / WSS) et leurs
**contextes**. C'est le différenciateur du framework — HTTP et WebSocket partagent le même
pipeline de contexte/controller.

> Docs IA : [`CLAUDE.md`](./CLAUDE.md) · [`MEMORY.md`](./MEMORY.md) · [`docs/`](./docs).
> Règle dure : ce module ne peut PAS importer `@nodefony/framework` (cycle) — accès au resolver
> via `(context as any)?.resolver`.

## Serveurs

| Serveur                   | Protocole         | Port défaut |
| ------------------------- | ----------------- | ----------- |
| `server-http`             | `node:http` 1.1   | 5151        |
| `server-https`            | `node:https` + H2 | 5152        |
| `server-websocket`        | `ws` sur http     | ws://5151   |
| `server-websocket-secure` | `ws` sur https    | wss://5152  |
| `server-static`           | `serve-static`    | —           |

## Pipeline

```
serveur → http-kernel.handle() → createContext()
   → handleFrontController() (Router.match → Resolver.resolve)
   → Firewall.check() → Controller.execute() → Response.send()
```

Chaque contexte (HTTP + WS) porte un `requestId` (UUID v4, ou `X-Request-Id` client),
réinjecté dans la réponse et corrélé dans les logs via AsyncLocalStorage.

## Tests

```bash
npm test                 # unit (vitest, 337 tests, sans serveur)
npm run test:integration # http/intégration/routing/websockets (serveur dev requis)
npm run test:load        # charge + heap + leak (serveur requis)
npm run test:memory      # GATE mémoire (memory.test.ts) — AVANT tout commit pipeline
```

> ⚠️ Les suites intégration/load sont **séquentielles** (serveur live partagé). Le gate
> mémoire se mesure sur un **serveur fraîchement redémarré** (bruit GC sinon).

## Licence

CeCILL-B — Christophe CAMENSULI.
