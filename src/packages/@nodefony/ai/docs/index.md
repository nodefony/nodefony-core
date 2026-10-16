---
title: "@nodefony/ai — la boîte à outils de l'IA dans une application"
navTitle: ai
lang: fr
module: "@nodefony/ai"
topic: overview
audience: [developer]
tags: [module, ia, mcp, agent]
status: draft
updated: 2026-10-16
source: "src/packages/@nodefony/ai/docs/index.md"
---

# ai

> La boîte à outils de l'IA DANS une application Nodefony : exposer ses outils métier à un
> agent par le _Model Context Protocol_, et ouvrir sa propre porte MCP.

📍 [Documentation](../../../../../docs/index.md) › **@nodefony/ai**

Cette page est **surfacée dans Studio** (onglet Docs du module).

## Ce que fait le module

- **Le protocole MCP, tenu pour toi** : versions, erreurs, progression, annulation, flux SSE.
  Un outil n'écrit que sa logique.
- **La mécanique de porte** : `defineMcpGate()` définit une porte, validée au démarrage ;
  `gate.serve(this, body)` la sert depuis une action de controller.
- **Aucune route montée** : une porte se déclare, par le controller de qui en a besoin — la
  porte de développement de `@nodefony/devkit`, ou celle de ton application.

C'est un module **socle** (`policy: "mandatory"`), chargé dans tous les environnements. Il ne
coûte rien par requête tant qu'aucune porte n'est déclarée.

## Configuration

```ts
use("@nodefony/ai", undefined, { policy: "mandatory" }),
```

Les réglages d'une porte se passent à `defineMcpGate()`, pas au module.

## Par où commencer

```nodefony-cards
[
  { "icon": "🤖", "title": "Boîte à outils MCP", "href": "mcp.md",
    "desc": "Écrire un outil, le réserver à un appelant authentifié, signaler la progression d'un outil long, et monter sa propre porte avec defineMcpGate.",
    "meta": "un agent doit interroger ou piloter ton application" }
]
```

## Pour aller plus loin

- La porte de développement et ses outils intégrés → [devkit](../../devkit/docs/index.md)
- [Toute la documentation](../../../../../docs/index.md)
