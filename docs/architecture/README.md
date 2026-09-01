---
title: "Architecture — comment l'ensemble tient"
navTitle: Toute l'architecture
lang: fr
module: global
topic: architecture-index
audience: [human, ai]
tags: [architecture, index]
status: stable
last-updated: 2026-07-22
---

# Architecture

> Sept pages sur ce qui ne relève **d'aucun module en particulier** : ce qui tient l'ensemble
> debout. Un guide vous dit quoi taper ; ces pages-ci vous disent ce qui se passe pendant que
> vous tapez — et c'est ce qui sert quand quelque chose ne se comporte pas comme prévu.

## 🗺️ Commencer par la carte

```nodefony-cards
[
  { "icon": "🗺️", "title": "Vue d'ensemble", "href": "vue-ensemble.md", "featured": true,
    "desc": "Ce qu'est Nodefony, ce qu'il n'est pas, ses partis pris — et ce que chacun coûte. La page à lire en premier si vous évaluez le framework.",
    "meta": "le territoire avant le détail" }
]
```

## ⚡ Le cycle de vie — de l'allumage à l'octet

Ces trois pages se lisent dans l'ordre : ce qui démarre, ce qui se branche, ce qui traverse.

```nodefony-cards
[
  { "icon": "🔄", "title": "Cycle de boot du Kernel", "href": "cycle-boot-kernel.md",
    "desc": "L'ordre d'allumage, les points où brancher son code, ce qui retient la mise en service, et l'arrêt propre.",
    "meta": "1 · ce qui démarre" },
  { "icon": "💉", "title": "Injection & portées", "href": "injection-portees.md",
    "desc": "Comment les services se trouvent sans se connaître, et ce que « portée requête » change vraiment pour votre code.",
    "meta": "2 · ce qui se branche" },
  { "icon": "🔀", "title": "Pipeline d'une requête", "href": "pipeline-requete.md", "featured": true,
    "desc": "Le trajet exact d'une requête, étape par étape — HTTP comme WebSocket. Où s'insèrent la session, le pare-feu, votre contrôleur, et dans quel ordre.",
    "meta": "3 · ce qui traverse" }
]
```

## 🧩 Les partis pris

```nodefony-cards
[
  { "icon": "⚙️", "title": "Configuration", "href": "configuration.md",
    "desc": "Le modèle de résolution : d'où vient chaque valeur, qui gagne sur qui, et ce qui est figé au démarrage.",
    "meta": "le concept ; la recette est dans les guides" },
  { "icon": "📦", "title": "Build & bundling", "href": "build-bundling.md",
    "desc": "Comment le TypeScript devient un paquet qu'on installe : rolldown, types générés, ce qui reste hors du bundle.",
    "meta": "ce que reçoit celui qui installe" },
  { "icon": "🔌", "title": "La socket Nodefony", "href": "realtime-socket-nodefony.md",
    "desc": "La trajectoire du temps réel : ce qui existe, ce qui est visé, et pourquoi HTTP et WebSocket partagent le même contexte de contrôleur.",
    "meta": "le différenciateur, expliqué" }
]
```

## 🧭 Et si ce n'est pas ici

| Vous cherchez…                                   | Allez plutôt vers                                   |
| ------------------------------------------------ | --------------------------------------------------- |
| Une recette applicable tout de suite             | [les guides](../guides/README.md)                   |
| Un parcours complet de zéro à une application    | [le tutoriel](../tutoriels/premiere-application.md) |
| L'API d'une brique (routes, sessions, pare-feu…) | la documentation de son module                      |
| Une décision d'architecture et ses raisons       | les ADR du dépôt (`docs/adr/`)                      |

📖 [Lexique général](../lexique.md) du framework.
