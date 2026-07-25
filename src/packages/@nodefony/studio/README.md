# @nodefony/studio

**Studio** — l'admin web de Nodefony (successeur du `monitoring-bundle`). Tableau de bord
d'introspection et de supervision du framework : modules, services (DI), routes, config, logs,
santé runtime, cluster, ORM, realtime.

Frontend **React 19 + Mantine v9 + MobX**, servi par `@nodefony/frontend` (Vite). Application admin embarquée : le paquet ne publie pas de types, il n'est pas destiné à être
consommé comme librairie.

> Docs IA : [`CLAUDE.md`](./CLAUDE.md) · [`MEMORY.md`](./MEMORY.md) · [`docs/`](./docs).
> **Développement frontend** : invoquer d'abord le skill `nodefony-studio-dev` (UI kit, hooks
> temps réel `nodefony/react`, recette route/data plane, gate `npm run typecheck`).

## Surface

- **UI** montée sous `/nodefony` (SPA React).
- **Data plane** : chaque module expose `/nodefony/<module>/api/*` (REST/WS JSON) ; Studio en est
  un client générique (pas de couplage à la vue).
- Temps réel via WebSocket (JSON-RPC 2.0) — stats, logs, sondes poussées.

## Stack

| Brique  | Choix                                           |
| ------- | ----------------------------------------------- |
| UI      | React 19 + Mantine v9                           |
| État    | MobX (stores) + hooks `nodefony/react`          |
| Build   | Vite via `@nodefony/frontend` (mono-supervisor) |
| Graphes | SVG maison (recharts incompatible React 19)     |

## Tests

```bash
npm test   # unit (vitest)
```

## Licence

CeCILL-B — Christophe CAMENSULI.
