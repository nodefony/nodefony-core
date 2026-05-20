---
module: global
topic: architecture-index
audience: [human, ai]
tags: [architecture, index]
status: stable
last-updated: 2026-05-17
---

# Architecture — concepts transverses

Concepts qui dépassent un seul module. Pour la doc d'un module précis : voir `../packages/`.

## Pages

| Page                                     | Sujet                                                  | Statut  |
| ---------------------------------------- | ------------------------------------------------------ | ------- |
| [container.md](./container.md)           | DI Container, Scope, services, parameters              | stable  |
| [kernel.md](./kernel.md)                 | Kernel lifecycle, modules, boot phases, CliKernel      | draft   |
| [service.md](./service.md)               | Classe de base (DI + Events + Logging), API complète   | draft   |
| [request-context.md](./request-context.md) | `AsyncLocalStorage`, propagation requestId/user      | draft   |
| [injection.md](./injection.md)           | `@injectable`, `@inject`, scopes, résolution           | draft   |
| [syslog.md](./syslog.md)                 | Logger structuré RFC 5424, Pdu, ring buffer            | draft   |
| `pipeline-http.md` (à venir)             | Pipeline HTTP : request → resolver → controller → send | TODO    |
| `pipeline-ws.md` (à venir)               | Pipeline WebSocket : handshake → message → broadcast   | TODO    |

Créer une nouvelle page : copier le frontmatter ci-dessus, garder `status: draft` tant qu'elle n'est pas relue.
