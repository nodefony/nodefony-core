---
adr: 17
title: "@nodefony/ai — la mécanique MCP hors du cœur, une porte se déclare"
lang: fr
navTitle: MCP dans @nodefony/ai
date: 2026-10-16
status: accepted
publish: true
deciders: [Christophe CAMENSULI]
tags: [mcp, ia, agent, modules, securite]
---

# ADR-0017 — `@nodefony/ai` : la mécanique MCP hors du cœur, une porte se déclare

> **Summary.** The MCP protocol engine used to live in the framework core, and the only HTTP
> gate was a development-only one: an application could not open its own MCP endpoint in
> production without re-implementing the protocol. This decision moves the whole MCP mechanics
> into a separate package, `@nodefony/ai`, which mounts no route by itself: a gate is _declared_
> with `defineMcpGate({ … })` and served from a controller action of the application that needs
> it. For a user, this means an MCP endpoint at the address of your choice, in development or in
> production, safe by default (an unprotected gate grants no role), and at zero per-request cost
> as long as no gate is declared.

Cette page porte le **pourquoi** de la décision ; le **comment** — déclarer une porte, la
protéger, y exposer des outils — vit dans le guide
[MCP dans `@nodefony/ai`](../../src/packages/@nodefony/ai/docs/mcp.md).

📍 [Documentation](../index.md) › [Décisions d'architecture](README.md) › **ADR-0017**

## Statut

**Accepté** le 2026-10-16 — en vigueur, ni remplacé ni amendé. Complète l'[ADR-0004](0004-inference-llm-backend-supervise.md) :
l'inférence reste hors du process ; c'est l'OUTILLAGE de l'IA dans l'application qui trouve ici
sa place. Après la 10.0.0, déplacer un symbole public de `@nodefony/ai`, ou renommer une clé de
réglage d'une porte, est une rupture.

## Contexte

Le protocole MCP (moteur JSON-RPC, progression, flux SSE, garde d'origine, rôles des appelants,
collecte des outils) vivait dans le paquet `nodefony`, et l'unique porte HTTP était celle de
`@nodefony/devkit` : `POST /nodefony/mcp`, `policy: "dev"`. Trois défauts en découlaient.

1. **Une application ne pouvait pas ouvrir SA porte en production.** La seule porte existante
   disparaît hors développement — c'est voulu pour les outils `nodefony_*`, qui divulguent
   l'architecture —, et en écrire une seconde exigeait de recoder le protocole avec des briques
   du cœur jamais pensées pour être assemblées.
2. **Le cœur portait un protocole que la plupart des applications n'emploient pas**, et un
   protocole qui évolue vite : la révision `2026-07-28` a retiré les sessions et le flux ouvert
   par `GET`. Le cœur publie la version la plus lente du dépôt.
3. **Les capacités d'IA à venir** (accès modèle, index vectoriel, mémoire, agents) n'avaient
   pas de maison : cinq esquisses de paquets privés, chacune à `0.0.0`.

Un premier plan prévoyait un service `McpService` qui MONTAIT la porte depuis `@nodefony/ai`.
C'était un contresens : un module socle, chargé partout, aurait servi une route en production à
toutes les applications, qu'elles l'aient demandée ou non.

## Décision

1. **`@nodefony/ai` est un module SOCLE** (`policy: "mandatory"`), paquet distinct du cœur. Il
   porte le protocole MCP, le moteur `handleMcpMessage`, la progression, le flux, la garde, les
   rôles des appelants, la collecte et l'appel des outils. Les gabarits `create app` (minimal et
   complete) le déclarent en `dependencies` et le chargent avant devkit.
2. **Il ne monte AUCUNE route.** Une porte se DÉCLARE : `defineMcpGate({ … })` la définit une
   fois, validée et figée au chargement ; `gate.serve(this, body)` la sert depuis l'action d'un
   controller de qui en a besoin. Une application ouvre la sienne, en développement ou en
   production, à l'adresse qu'elle choisit.
3. **Frontières** :

   | Où                     | Ce qui y vit                                                                                                                                 |
   | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
   | **cœur `nodefony`**    | les CONTRATS en types (`IMcpTool`, hook `getMcpTools()`), JSON-RPC 2.0, serveur de ressource OAuth, `MCP_ENDPOINT_PATH`, `ai:mcp`, `ai:sync` |
   | **`@nodefony/ai`**     | le protocole et la mécanique de porte (`defineMcpGate`, `gate.serve`, `gate.respond`, `gate.protectedResources`, `mcpConfigSchema`)          |
   | **`@nodefony/devkit`** | les outils `nodefony_*` et SA porte de développement `/nodefony/mcp`, `policy: "dev"`, bâtie sur `defineMcpGate`                             |

   Le cœur n'importe jamais `@nodefony/ai` (`scripts/gates/check-package-deps.mjs`).

4. **Défaut sûr** : une porte non protégée n'accorde AUCUN rôle ; ses outils réservés restent
   retenus. Seule une porte que son PÉRIMÈTRE protège (devkit, `policy: "dev"`) élargit, et
   l'écrit (`unprotectedRoles`). Une porte qui déclare un serveur d'autorisation exige un jeton.
5. **Un seul vocabulaire de réglages** : les clés d'une porte sont celles de `mcpConfigSchema`,
   déjà publiques sous `devkit.mcp.*`. Aucune cassure pour qui avait réglé la porte de dev.
6. **Coût nul par requête** tant qu'aucune porte n'est déclarée : aucun écouteur, aucun
   registre peuplé au démarrage, collecte des outils à la requête.

## Conséquences

- **Rupture, sans alias** : 22 exports d'exécution et 39 types quittent le barrel de `nodefony`
  (`release:api-diff`). Chacun est publié par `@nodefony/ai` (ou, pour le catalogue
  `nodefony_*`, par `@nodefony/devkit`). Pré-version : aucune compatibilité n'est engagée
  (semver §9) ; l'entrée de changelog naît sous `Changed` au brouillon de la release.
- **Versions verrouillées** : un `@nodefony/devkit` antérieur ne charge pas avec le nouveau
  `nodefony`. Les paquets se publient ensemble, à la même version — le modèle de release déjà
  en place.
- La doc MCP vit dans le paquet qui l'emploie : `@nodefony/ai/docs/mcp.md`, pointée par
  l'`AGENTS.md` des applications générées.
- À la date de la décision, une application qui voulait sa porte l'écrivait à la main. Le
  générateur `nodefony create controller <nom> --kind mcp`, annoncé ici comme la suite, l'écrit
  désormais, test compris (voir le guide).
- Les capacités d'IA à venir naîtront dans `@nodefony/ai` ; les esquisses sont supprimées.

## Alternatives écartées

- **Laisser le protocole au cœur** — le cœur se publie au rythme le plus lent, et une porte a
  besoin d'un controller (`@nodefony/framework`) que le cœur ne peut pas importer.
- **Une porte montée par `@nodefony/ai` (`McpService`, `ai.mcp`)** — un module socle aurait
  servi une route en production à toutes les applications. Retiré avant toute publication.
- **Un paquet par capacité** (`@nodefony/llm`, `/vector`…) — autant de versions à verrouiller,
  pour des capacités qui partagent appelants, garde et conteneur.
- **Un interrupteur « stdout réservé » au cœur** pour une porte `stdio` — sa prémisse était
  fausse : `CliKernel` pose déjà `quietBoot` pour toute commande de module
  (`dispatchModuleCommand`, `CliKernel.ts#CliKernel.dispatchModuleCommand`).
