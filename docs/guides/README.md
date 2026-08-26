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
| [`generer-du-code.md`](./generer-du-code.md) | `nodefony create` : les cinq types, voir avant d'écrire, piloter depuis un agent   | stable |
| [`frontend-react.md`](./frontend-react.md)   | Ajouter un frontend React 19 (Vite) à un module Nodefony                           | stable |
| [`session-storage.md`](./session-storage.md) | Stockage de session : mécanisme IoC, backends, storage sur mesure                  | stable |
| [`persistence.md`](./persistence.md)         | Persistance & stores : infra déclarée, profils, matrice brique×backend, audit≠logs | stable |
| [`compatibilite.md`](./compatibilite.md)     | Ce qui casse en montant de version : surface couverte, dépréciation, support       | stable |

> ⚠️ [`integration-continue.md`](./integration-continue.md) fait exception à la
> règle ci-dessus : il documente la forge du **dépôt du framework** (ce que la CI
> lance, avec quel décor, comment le rejouer), pas l'usage du framework dans une
> application. Il est ici parce qu'il n'a pas de meilleur endroit — et parce que
> le savoir qu'il porte n'était lisible que dans des commentaires YAML.

| Page                                                             | Sujet                                                                             | Statut |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------ |
| [`integration-continue.md`](./integration-continue.md)           | Forge du dépôt : ce qui tourne, le décor, les gates, rejouer en local             | stable |
| [`publier-une-release.md`](./publier-une-release.md)             | Publier les 15 paquets : la chaîne, ce que chaque garde refuse, le smoke, l'OIDC  | stable |
| [`eprouver-loutillage-agent.md`](./eprouver-loutillage-agent.md) | Mesurer un framework avec un agent : méthode, pièges du juge, ce qu'elle a trouvé | stable |

## Pages (à venir)

| Page                  | Sujet                                                               |
| --------------------- | ------------------------------------------------------------------- |
| `writing-a-module.md` | Créer un nouveau module Nodefony (structure, config, lifecycle)     |
| `routing.md`          | Définir des routes avec `@controller` / `@route` / `@Get` / `@Post` |
| `decorators.md`       | `@inject`, `@injectable`, `@Service`, `@Param`, `@Body`, `@Query`   |
| `websockets.md`       | Endpoints WS, broadcast, protocoles, sessions WS                    |
| `error-handling.md`   | `nodefonyError`, `HttpError`, error renderers, error logging        |
| `testing.md`          | Tests unitaires + intégration, mocha + bun, mocks                   |
