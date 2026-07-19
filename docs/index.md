---
title: "Documentation Nodefony"
lang: fr
module: "global"
topic: index
section: "Accueil"
audience: [developer, devops, supervisor, admin]
tags: [index, sommaire, hub, documentation]
version: "doc"
status: stable
updated: 2026-07-19
source: "docs/index.md"
tests: none
---

# Documentation Nodefony

> Nodefony est un framework Node.js **fullstack** en TypeScript : un serveur HTTP/HTTP2 et un serveur
> WebSocket qui partagent le **même contexte de contrôleur**, une injection de dépendances, un noyau
> de modules, et une couche de sécurité complète. Cette page est le point d'entrée : elle t'oriente
> vers le hub du module qui t'intéresse — chaque hub te conduit ensuite à la bonne page.

## 🧭 Par où commencer

Quatre entrées selon ce que tu viens faire. Chaque parcours est **ordonné** : les étapes se
construisent l'une sur l'autre.

**Je découvre Nodefony** — comprendre l'ossature avant d'écrire du code.

1. [Vue d'ensemble](architecture/vue-ensemble.md) — ce qu'est le framework et ce qu'il n'est pas.
2. [Cycle de boot du Kernel](architecture/cycle-boot-kernel.md) — ce qui se passe entre `npm run dev` et le premier octet servi.
3. [Injection & portées](architecture/injection-portees.md) — comment les services se trouvent sans se connaître.
4. [Le cœur](../src/nodefony/docs/index.md) — `Service`, `Container`, `Event`, le socle commun.

**Je construis une application** — du squelette à la première route servie.

1. [Configuration](architecture/configuration.md) — `nodefony.config.ts` + `env.ts`, la seule source de vérité.
2. [Le framework](../src/packages/@nodefony/framework/docs/index.md) — contrôleurs, routes, décorateurs.
3. [Pipeline de requête](architecture/pipeline-requete.md) — le trajet exact d'une requête, HTTP comme WebSocket.
4. [Persistance](guides/persistence.md) — choisir et brancher sa base.
5. [Frontend React](guides/frontend-react.md) — servir une SPA avec le HMR de Vite.

**Je sécurise** — dans cet ordre, parce que chaque étage suppose le précédent.

1. [Sécurité — le hub](../src/packages/@nodefony/security/docs/index.md) — la carte complète des briques.
2. [Firewall](../src/packages/@nodefony/security/docs/firewall.md) — zones, Zero Trust : la fondation.
3. [Authenticators](../src/packages/@nodefony/security/docs/authenticators.md) — prouver **qui** appelle.
4. [Autorisation](../src/packages/@nodefony/security/docs/authorization.md) — décider **ce qu'il a le droit** de faire.

**J'exploite en production** — ce qui compte quand ça tourne pour de vrai.

1. [Docker & cloud-native](guides/docker-cloud-native.md) — 1 process = 1 conteneur, scaling par l'orchestrateur.
2. [Stockage de session](guides/session-storage.md) — le choix qui décide de ton scaling horizontal.
3. [Journal d'audit](../src/packages/@nodefony/security/docs/audit.md) — tracer qui a fait quoi.
4. [Studio](../src/packages/@nodefony/studio/docs/index.md) — l'administration web du framework.

## 🗂️ Les modules

Chaque ligne mène au **hub** du module, qui détaille ses briques.

| Module                                                                             | Ce qu'il apporte                                    | Tu en as besoin quand…                  |
| ---------------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------- |
| [`nodefony`](../src/nodefony/docs/index.md)                                        | le cœur : Service, Container, Kernel, Event, Syslog | toujours — c'est le socle               |
| [`@nodefony/http`](../src/packages/@nodefony/http/docs/index.md)                   | serveurs HTTP/HTTP2/WS, contextes, sessions         | tu touches au transport ou à la session |
| [`@nodefony/framework`](../src/packages/@nodefony/framework/docs/index.md)         | routeur, contrôleurs, décorateurs                   | tu écris des routes                     |
| [`@nodefony/security`](../src/packages/@nodefony/security/docs/index.md)           | firewall, authentification, autorisation, audit     | tu protèges quoi que ce soit            |
| [`@nodefony/user`](../src/packages/@nodefony/user/docs/index.md)                   | l'identité `IUser` et son stockage                  | tu as des comptes utilisateurs          |
| [`@nodefony/orm-core`](../src/packages/@nodefony/orm-core/docs/index.md)           | le contrat ORM commun à tous les backends           | tu écris du code portable entre bases   |
| [`@nodefony/drizzle`](../src/packages/@nodefony/drizzle/docs/index.md)             | SQL (PostgreSQL, MySQL/MariaDB, SQLite) — le défaut | tu utilises une base SQL                |
| [`@nodefony/mongoose`](../src/packages/@nodefony/mongoose/docs/index.md)           | MongoDB                                             | tu utilises MongoDB                     |
| [`@nodefony/redis`](../src/packages/@nodefony/redis/docs/index.md)                 | cache, sessions, backplane temps réel               | tu scales horizontalement               |
| [`@nodefony/realtime`](../src/packages/@nodefony/realtime/docs/index.md)           | la socket Nodefony : canaux multiplexés, fan-out    | tu fais du temps réel                   |
| [`@nodefony/frontend`](../src/packages/@nodefony/frontend/docs/index.md)           | build Vite, HMR, multi-framework                    | tu sers une SPA                         |
| [`@nodefony/studio`](../src/packages/@nodefony/studio/docs/index.md)               | l'administration web du framework                   | tu veux voir l'intérieur en marche      |
| [`@nodefony/documentation`](../src/packages/@nodefony/documentation/docs/index.md) | le portail qui rend ces pages                       | tu écris ou publies de la doc           |

### [`security`](../src/packages/@nodefony/security/docs/index.md) — protéger l'application

Le module le plus fourni : pare-feu applicatif par zones, six stratégies d'authentification
(session, mot de passe, JWT, clé d'API, passkeys, OAuth2), autorisation par rôles et voters,
CSRF/CORS/en-têtes, 2FA, webhooks et journal d'audit. **Commence par son hub**, qui propose ses
propres parcours guidés.

### [`http`](../src/packages/@nodefony/http/docs/index.md) — le transport

Serveurs HTTP/1.1, HTTP/2 et WebSocket, contextes de requête, sessions, certificats TLS. C'est ici
que naît le `Context` que ton contrôleur reçoit — et le différenciateur de Nodefony : **HTTP et
WebSocket sont co-citoyens**, dans le même contexte.

### [`framework`](../src/packages/@nodefony/framework/docs/index.md) — écrire des routes

Routeur, classe `Controller`, décorateurs (`@Get`, `@IsGranted`, `@CurrentUser`…), résolution des
paramètres, idempotence. C'est la surface que tu manipules au quotidien.

### [`realtime`](../src/packages/@nodefony/realtime/docs/index.md) — le temps réel

La socket Nodefony : **une connexion qui multiplexe N canaux bidirectionnels**, avec un backplane
(loopback, cluster, Redis) pour diffuser entre plusieurs processus.

## 🏛️ Architecture transverse

Les pages qui ne relèvent d'aucun module en particulier — elles expliquent comment l'ensemble tient.

- [Vue d'ensemble](architecture/vue-ensemble.md) — la carte du territoire.
- [Cycle de boot du Kernel](architecture/cycle-boot-kernel.md) — l'ordre d'allumage.
- [Injection & portées](architecture/injection-portees.md) — le conteneur de services.
- [Configuration](architecture/configuration.md) — `defineConfig`, `use()`, l'environnement.
- [Pipeline de requête](architecture/pipeline-requete.md) — le trajet d'une requête.
- [Build & bundling](architecture/build-bundling.md) — rolldown, types, distribution.

## 📘 Guides

Orientés tâche : on suit le guide, on obtient un résultat.

- [Configuration](guides/configuration.md) · [Persistance](guides/persistence.md) · [Stockage de session](guides/session-storage.md)
- [Frontend React](guides/frontend-react.md) · [Docker & cloud-native](guides/docker-cloud-native.md)

## 📖 Lexique

Le vocabulaire du framework, en un seul endroit : [lexique général](lexique.md).

## 🔗 Pour aller plus loin

- 🧭 **Décisions d'architecture** : les [ADR](adr/) — pourquoi tel choix a été fait, et ce qu'il coûte.
- 🧪 **Qualité** : chaque page de brique porte l'inventaire de ses tests (unitaires, intégration, E2E,
  attaque, charge) et dit ce qui **manque** — pas seulement ce qui existe.
- 📡 **Voir tourner** : Studio expose la documentation, la configuration résolue, les routes, les
  sessions et le temps réel de l'instance en marche.
