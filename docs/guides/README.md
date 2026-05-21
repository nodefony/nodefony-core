---
module: global
topic: guides-index
audience: [human]
tags: [guides, index, howto]
status: stable
last-updated: 2026-05-21
---

# Guides — how-to

Tutoriels pas-à-pas orientés utilisateur du framework (vs les pages `architecture/` qui décrivent *comment ça marche dedans*, et `packages/` qui décrivent l'API).

## Pages disponibles

| Page                                                 | Sujet                                                              | Statut |
| ---------------------------------------------------- | ------------------------------------------------------------------ | ------ |
| [`frontend-react.md`](./frontend-react.md)           | Ajouter un frontend React 19 (Vite) à un module Nodefony           | stable |
| [`session-storage.md`](./session-storage.md)         | Stockage de session : mécanisme IoC, backends, storage sur mesure  | stable |

## Pages (à venir)

| Page                                | Sujet                                                  |
| ----------------------------------- | ------------------------------------------------------ |
| `writing-a-module.md`               | Créer un nouveau module Nodefony (structure, config, lifecycle) |
| `routing.md`                        | Définir des routes avec `@controller` / `@route` / `@Get` / `@Post` |
| `decorators.md`                     | `@inject`, `@injectable`, `@Service`, `@Param`, `@Body`, `@Query` |
| `websockets.md`                     | Endpoints WS, broadcast, protocoles, sessions WS       |
| `error-handling.md`                 | `nodefonyError`, `HttpError`, error renderers, error logging |
| `testing.md`                        | Tests unitaires + intégration, mocha + bun, mocks      |
