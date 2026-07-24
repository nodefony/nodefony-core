---
lang: fr
module: global
topic: guides-index
audience: [human]
tags: [guides, index, howto]
status: stable
last-updated: 2026-05-21
---

# Guides — how-to

> Tutoriels pas-à-pas orientés utilisateur du framework — on suit le guide et on obtient un
> résultat. À distinguer des pages `architecture/`, qui expliquent _comment ça marche dedans_,
> et de la doc des modules, qui décrit l'API.

## Pages disponibles

| Page                                         | Sujet                                                                              | Statut |
| -------------------------------------------- | ---------------------------------------------------------------------------------- | ------ |
| [`configuration.md`](./configuration.md)     | Configurer une app (`defineConfig` / `env.ts` / `use` / manifeste `modules`)       | stable |
| [`frontend-react.md`](./frontend-react.md)   | Ajouter un frontend React 19 (Vite) à un module Nodefony                           | stable |
| [`session-storage.md`](./session-storage.md) | Stockage de session : mécanisme IoC, backends, storage sur mesure                  | stable |
| [`persistence.md`](./persistence.md)         | Persistance & stores : infra déclarée, profils, matrice brique×backend, audit≠logs | stable |

## Pages (à venir)

| Page                  | Sujet                                                               |
| --------------------- | ------------------------------------------------------------------- |
| `writing-a-module.md` | Créer un nouveau module Nodefony (structure, config, lifecycle)     |
| `routing.md`          | Définir des routes avec `@controller` / `@route` / `@Get` / `@Post` |
| `decorators.md`       | `@inject`, `@injectable`, `@Service`, `@Param`, `@Body`, `@Query`   |
| `websockets.md`       | Endpoints WS, broadcast, protocoles, sessions WS                    |
| `error-handling.md`   | `nodefonyError`, `HttpError`, error renderers, error logging        |
| `testing.md`          | Tests unitaires + intégration, mocha + bun, mocks                   |
