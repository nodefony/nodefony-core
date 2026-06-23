---
title: "@nodefony/studio"
module: "@nodefony/studio"
since: "10.0.0-poc.1"
updated: "2026-05-20"
status: draft
order: 0
---

# @nodefony/studio

> Admin web de Nodefony — successeur du legacy `monitoring-bundle`. Backend = controller Nodefony exposant l'UI + des API ; frontend = SPA **React 19** (Mantine v8 + MobX 6) servie via `@nodefony/frontend` (Vite). C'est le **1er consommateur prod** de `@nodefony/frontend` et du **data plane admin** (`IAdminApi`).

## Vue d'ensemble

Studio introspecte le framework — il ne contient **aucune logique métier**. Toute sa donnée provient du data plane admin générique `/nodefony/<module>/api/*` (discovery via le catalogue `/nodefony/framework/api/admin`). Le framework boote sans Studio : l'UI disparaît, le data plane par module reste.

## Partition du namespace `/nodefony` (tranché 2026-05-20)

| Espace                     | Forme                                           | Porté par                    |
| -------------------------- | ----------------------------------------------- | ---------------------------- |
| UI SPA (humain)            | `/nodefony` + `/nodefony/{page}` (mono-segment) | Studio (disparaît si absent) |
| Data plane admin (machine) | `/nodefony/<module>/api/*` (≥ 3 segments)       | chaque module                |

Règle figée : **jamais** de route admin mono-segment `/nodefony/<module>` (collision avec une page SPA).

## Frontend

- React 19 + Mantine v8 + MobX 6 (classes, `makeAutoObservable`) + React Router 7 + TanStack Table 8.
- Theme dark par défaut, primary orange, toggle persisté `localStorage`.
- Pages réelles : Dashboard, Logs (snapshot REST + stream WS, `ansiToReact`), Modules (cartes), ModuleDetail (onglets Vue d'ensemble · **Docs** · **API** · Dépendances · Routes · Services · Config), System (explorer du catalogue admin).
- Stores MobX : Auth, Connection, Ui, Chat, Admin, Root.

## Onglets Docs + API (ModuleDetail)

- **Docs** : prose markdown colocalisée au module (`<module>/docs/*.md`, emplacement hybride — cf ADR-0001), rendue via `react-markdown` + `remark-gfm`. Badge version (`package.json`) + statut (frontmatter) + fraîcheur git (dernier commit du fichier).
- **API** : référence 100 % auto depuis `.ai/symbols.json` (kind, nom, description TSDoc) — jamais de divergence avec le code.

Endpoints (producteur `kernel`) : `module/{name}/docs`, `module/{name}/docs/{slug}`, `module/{name}/symbols`.

## Realtime

WebSocket permanent `WS /nodefony/studio/api/realtime` (JSON-RPC 2.0, pub/sub par canal `syslog:stream` / `dashboard:stats`). Forward-compat `RealtimeService` (P13.4) : providers transport-agnostiques.

## État

**P6 branché** (auth réelle livrée). Auth = firewall `@nodefony/security` (session BFF cookie, RBAC `ROLE_NODEFONY_ADMIN`) — mocks `/auth/*` supprimés. CSP posée par `@nodefony/security` (nonce par requête ; hack POC retiré). Pages Sécurité livrées : Sessions / Users / API Keys / Firewall / Audit / Profil.

## Voir aussi

- `MEMORY.md` — routes, stores, gotchas WS/CSP.
- `@nodefony/frontend` — builder Vite consommé.
- `@nodefony/framework` — data plane `IAdminApi` consommé.
