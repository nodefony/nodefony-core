---
module: global
topic: architecture-index
audience: [human, ai]
tags: [architecture, index]
status: stable
last-updated: 2026-05-20
---

# Architecture — concepts transverses

> ⚠️ **Relocalisé (ADR-0001, 2026-05-20)** — emplacement HYBRIDE des docs. Les concepts du **core** (DI, kernel, service, syslog, ALS) sont désormais **colocalisés au workspace core** dans [`src/nodefony/docs/`](../../src/nodefony/docs/) et surfacés dans Studio via la carte **Core** (`/nodefony/modules/core`).

## Pages (nouvel emplacement)

| Page                                                                                 | Sujet                                           | Statut |
| ------------------------------------------------------------------------------------ | ----------------------------------------------- | ------ |
| [`src/nodefony/docs/index.md`](../../src/nodefony/docs/index.md)                     | Vue d'ensemble du core                          | stable |
| [`src/nodefony/docs/kernel.md`](../../src/nodefony/docs/kernel.md)                   | API du cœur — Kernel, Module, CliKernel, events | stable |
| [`src/nodefony/docs/service.md`](../../src/nodefony/docs/service.md)                 | Classe de base (DI + Events + Logging)          | stable |
| [`src/nodefony/docs/request-context.md`](../../src/nodefony/docs/request-context.md) | `AsyncLocalStorage`, requestId/user             | stable |
| [`src/nodefony/docs/client.md`](../../src/nodefony/docs/client.md)                   | Bibliothèque cliente isomorphe (navigateur)     | stable |
| [`src/nodefony/docs/react-hooks.md`](../../src/nodefony/docs/react-hooks.md)         | Hooks React `nodefony/react`                    | stable |
| [`src/nodefony/docs/syslog.md`](../../src/nodefony/docs/syslog.md)                   | Logger RFC 5424, Pdu, ring buffer               | stable |

## Vision / architecture transverse (multi-module)

| Page                                                         | Sujet                                                                                                                                                                                | Statut |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| [`realtime-socket-nodefony.md`](realtime-socket-nodefony.md) | « La socket Nodefony » — hub realtime isomorphe, canaux duplex à backing pluggable (pubsub/SIP/bridge/proxy), backplane Redis cross-pod, portage SIP depuis `nodefony-client` (prod) | vision |

## Où mettre une nouvelle doc (cf ADR-0001)

- **Concept d'un module précis** → `<module>/docs/*.md` (colocalisé). Ex core → `src/nodefony/docs/`, frontend → `src/packages/@nodefony/frontend/docs/`.
- **Transverse multi-module** (guide, audit, ADR) → reste sous `docs/` (racine).

Ce dossier `docs/architecture/` ne contient plus que cet index ; les pipelines HTTP/WS à venir iront dans `src/packages/@nodefony/http/docs/`.
