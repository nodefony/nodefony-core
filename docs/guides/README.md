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

| Page                                                 | Sujet                                                                              | Statut |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------- | ------ |
| [`configuration.md`](./configuration.md)             | Configurer une app (`defineConfig` / `env.ts` / `use` / manifeste `modules`)       | stable |
| [`generer-du-code.md`](./generer-du-code.md)         | `nodefony create` : les cinq types, voir avant d'écrire, piloter depuis un agent   | stable |
| [`frontend-react.md`](./frontend-react.md)           | Ajouter un frontend React 19 (Vite) à un module Nodefony                           | stable |
| [`session-storage.md`](./session-storage.md)         | Stockage de session : mécanisme IoC, backends, storage sur mesure                  | stable |
| [`persistence.md`](./persistence.md)                 | Persistance & stores : infra déclarée, profils, matrice brique×backend, audit≠logs | stable |
| [`docker-cloud-native.md`](./docker-cloud-native.md) | Déployer en conteneur : premier plan, sondes de vivacité, arrêt gracieux, k8s      | stable |
| [`compatibilite.md`](./compatibilite.md)             | Ce qui casse en montant de version : surface couverte, dépréciation, support       | stable |

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

## Ces sujets sont documentés dans leur module

Trois questions arrivent souvent sur ce hub alors que leur page vit **avec le code de la brique**
concernée : la doc d'un module est co-localisée avec lui, et part dans le paquet npm — elle décrit
donc toujours la version que vous avez installée.

| La question                                                   | La page                                                                                                                        |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Définir des routes (`@Get`, `@Post`, paramètres, priorités)   | [`framework` — routage](../../src/packages/@nodefony/framework/docs/routing.md)                                                |
| Les décorateurs (`@injectable`, `@Inject`, `@Body`, `@Query`) | [`framework` — décorateurs](../../src/packages/@nodefony/framework/docs/decorateurs.md)                                        |
| WebSocket : actions, canaux, protocole, sécurité              | [`realtime` — sommaire du module](../../src/packages/@nodefony/realtime/docs/index.md)                                         |
| Le cycle de vie d'un module, ses services, sa configuration   | [`generer-du-code.md`](./generer-du-code.md) pour le créer, [`core` — Kernel](../../src/nodefony/docs/kernel.md) pour le cycle |
