---
lang: fr
module: global
topic: architecture-index
audience: [human, ai]
tags: [architecture, index]
status: stable
last-updated: 2026-07-22
---

# Architecture — concepts transverses

> Ce dossier porte les concepts qui **ne relèvent d'aucun module en particulier** : comment
> l'ensemble tient debout. Le point d'entrée d'un lecteur est le portail
> [`docs/index.md`](../index.md) (section « Fondations ») ; cet index-ci sert au repérage dans
> l'arborescence.

## Fondations — les pages publiées

| Page                                                         | Sujet                                                                          | Statut |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------ | ------ |
| [`vue-ensemble.md`](vue-ensemble.md)                         | La carte du territoire : ce qu'est Nodefony, ses partis pris et leur coût      | stable |
| [`cycle-boot-kernel.md`](cycle-boot-kernel.md)               | L'ordre d'allumage, les hooks où brancher son code, l'arrêt propre             | stable |
| [`injection-portees.md`](injection-portees.md)               | Le conteneur de services : déclarer, injecter, choisir une portée              | stable |
| [`configuration.md`](configuration.md)                       | `defineConfig`, `use()`, l'environnement, la validation au boot                | stable |
| [`pipeline-requete.md`](pipeline-requete.md)                 | Le trajet d'une requête, de l'octet reçu à l'octet renvoyé — HTTP et WebSocket | stable |
| [`build-bundling.md`](build-bundling.md)                     | De la source au paquet publiable : rolldown, types (tsgo), turbo, `external`   | stable |
| [`realtime-socket-nodefony.md`](realtime-socket-nodefony.md) | La socket Nodefony — hub isomorphe, canaux duplex, backplane cross-pod, SIP    | vision |

## Le cœur est ailleurs (ADR-0001 — emplacement hybride)

Les concepts du **workspace core** sont colocalisés au module dans
[`src/nodefony/docs/`](../../src/nodefony/docs/) et surfacés dans Studio par la carte **Core**
(`/nodefony/modules/core`) :

| Page                                                                                 | Sujet                                           |
| ------------------------------------------------------------------------------------ | ----------------------------------------------- |
| [`src/nodefony/docs/index.md`](../../src/nodefony/docs/index.md)                     | Vue d'ensemble du core                          |
| [`src/nodefony/docs/kernel.md`](../../src/nodefony/docs/kernel.md)                   | API du cœur — Kernel, Module, CliKernel, events |
| [`src/nodefony/docs/service.md`](../../src/nodefony/docs/service.md)                 | Classe de base (DI + Events + Logging)          |
| [`src/nodefony/docs/cli.md`](../../src/nodefony/docs/cli.md)                         | Ligne de commande — `Cli`, `Command`, scaffolds |
| [`src/nodefony/docs/request-context.md`](../../src/nodefony/docs/request-context.md) | `AsyncLocalStorage`, requestId/user             |
| [`src/nodefony/docs/client.md`](../../src/nodefony/docs/client.md)                   | Bibliothèque cliente isomorphe (navigateur)     |
| [`src/nodefony/docs/react-hooks.md`](../../src/nodefony/docs/react-hooks.md)         | Hooks React `nodefony/react`                    |
| [`src/nodefony/docs/syslog.md`](../../src/nodefony/docs/syslog.md)                   | Logger RFC 5424, Pdu, ring buffer               |

## Où mettre une nouvelle doc (cf ADR-0001)

- **Concept d'un module précis** → `<module>/docs/*.md` (colocalisé). Ex. core → `src/nodefony/docs/`,
  frontend → `src/packages/@nodefony/frontend/docs/`.
- **Transverse multi-module** (concept, guide, ADR) → ici, sous `docs/`.
- **Ni l'un ni l'autre** : une spec d'implémentation, un plan de migration, un audit daté ou un
  brouillon ne va dans **aucun** des deux (cf [`../README.md`](../README.md)). Ces textes décrivent
  un état transitoire : une fois exécutés, ils décrivent un code qui n'existe plus, et le lecteur ne
  peut plus distinguer la spec de la description. Ils vivent hors du dépôt, dans la mémoire IA
  (`core-dev/`) ; l'historique, lui, reste dans `git log`.

## Écrire une page ici

Le standard de rédaction (structure, ancres vers le code, Démarrage rapide compilable) et ses gates
sont portés par le skill `nodefony-documentation`. Page modèle :
[`src/packages/@nodefony/security/docs/firewall.md`](../../src/packages/@nodefony/security/docs/firewall.md).
