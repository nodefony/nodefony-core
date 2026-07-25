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
serveur → http-kernel.handle() → rate-limit IP → createContext()
   → Firewall.handleCors()           (preflight OPTIONS → 204, court-circuit)
   → Router.resolve()                (match avant le parse du body)
   → Firewall.applySecurityHeaders() → fallback statique si aucune route
   → parse du body
   → handleFrontController() (Resolver.resolve → controller + initialize())
   → Firewall.enforceCsrf() → startSession() → Firewall.handleSecurity()
   → action du controller → Response.send()
```

Chaque contexte (HTTP + WS) porte un `requestId` (UUID v4, ou `X-Request-Id` client),
réinjecté dans la réponse et corrélé dans les logs via AsyncLocalStorage.

## Rate-limit général par IP

Plafond de trafic **par IP cliente** sur toutes les routes HTTP — protège la capacité du serveur
(anti-abus, scraping, DoS applicatif). À distinguer du backoff de login anti-bruteforce de
`@nodefony/security` (par identifiant saisi). **Désactivé par défaut** (opt-in : en cloud-native, le
rate-limit est souvent délégué à l'ingress / la gateway).

```ts
// nodefony.config.ts
use("@nodefony/http", {
  rateLimit: {
    enabled: true, // défaut false
    windowS: 60, // fenêtre fixe (s)
    max: 300, // requêtes max / IP / fenêtre → au-delà : 429
    maxTracked: 100_000, // borne mémoire (nb d'IP suivies)
  },
});
```

Chaque réponse porte `X-RateLimit-Limit`, `X-RateLimit-Remaining` et `X-RateLimit-Reset` (epoch s).
Au-delà du plafond → `429 Too Many Requests` + `Retry-After` (RFC 6585). L'IP est résolue en
respectant `trustProxy` (non spoofable via `X-Forwarded-For` tant qu'aucun proxy n'est déclaré de
confiance). Compteur en mémoire (borné + purge planifiée hors hot-path) ; un store distribué Redis
(multi-pod) est prévu en surcouche. Banc e2e :
`.claude/skills/nodefony-load-test/scripts/ratelimit-e2e.mjs`.

## Tests

```bash
npm test                 # unit (vitest, sans serveur)
npm run test:integration # http/intégration/routing/websockets (serveur dev requis)
npm run test:load        # charge + heap + leak (serveur requis)
npm run test:memory      # GATE mémoire (memory.test.ts) — AVANT tout commit pipeline
```

> ⚠️ Les suites intégration/load sont **séquentielles** (serveur live partagé). Le gate
> mémoire se mesure sur un **serveur fraîchement redémarré** (bruit GC sinon).

## Licence

CeCILL-B — Christophe CAMENSULI.
