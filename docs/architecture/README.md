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
| `kernel.md` (à venir)                    | Kernel lifecycle, modules, boot phases                 | draft   |
| `injection.md` (à venir)                 | `@injectable`, `@inject`, scopes, résolution           | draft   |
| `pipeline-http.md` (à venir)             | Pipeline HTTP : request → resolver → controller → send | draft   |
| `pipeline-ws.md` (à venir)               | Pipeline WebSocket : handshake → message → broadcast   | draft   |
| `request-context.md` (à venir)           | `AsyncLocalStorage`, propagation requestId             | draft   |

Créer une nouvelle page : copier le frontmatter ci-dessus, garder `status: draft` tant qu'elle n'est pas relue.
