---
title: "Guides — les recettes, une tâche à la fois"
navTitle: Tous les guides
lang: fr
module: global
topic: guides-index
audience: [human]
tags: [guides, index, howto]
status: stable
last-updated: 2026-05-21
---

# Guides

> Onze recettes, une tâche chacune. On suit, on obtient un résultat. Ce n'est ni un tutoriel
> (qui vous prend par la main du début à la fin) ni de l'architecture (qui explique ce qui se
> passe dessous) : un guide répond à **une** question précise, celle que vous vous posez
> maintenant.

## 🚀 Construire

Ce qu'on fait les premiers jours : régler l'application, la faire grandir, lui donner une
interface.

```nodefony-cards
[
  { "icon": "⚙️", "title": "Configuration", "href": "configuration.md", "featured": true,
    "desc": "Un fichier racine qui grandit par composition, et un seul lecteur de l'environnement. Le réglage qui ne prend pas vient presque toujours d'ici.",
    "meta": "commence par là" },
  { "icon": "🏗️", "title": "Générer du code", "href": "generer-du-code.md",
    "desc": "`nodefony create` : cinq types d'objets, un aperçu avant d'écrire quoi que ce soit, et le pilotage depuis un agent.",
    "meta": "ne pas écrire ce qu'une commande produit" },
  { "icon": "⚛️", "title": "Frontend React", "href": "frontend-react.md",
    "desc": "Greffer une interface React 19 sur un module existant : deux serveurs en développement, un seul en production, et le rechargement à chaud entre les deux.",
    "meta": "React · Vue · Angular · Svelte" }
]
```

## 🗄️ Ranger ses données

Où vivent les données, qui décide, et ce qui change quand il y a plusieurs pods.

```nodefony-cards
[
  { "icon": "🗃️", "title": "Persistance", "href": "persistence.md", "featured": true,
    "desc": "Déclarez votre infrastructure — une ou deux URL — et le framework dérive où va chaque brique. La matrice dit exactement ce que chaque backend porte.",
    "meta": "le tableau de bord de vos données" },
  { "icon": "🗝️", "title": "Stockage de session", "href": "session-storage.md",
    "desc": "Le mécanisme d'inversion de contrôle, les quatre backends livrés, ce que fait le défaut `auto` — et comment en écrire un sur mesure.",
    "meta": "le choix qui décide de votre scaling" }
]
```

## 🚢 Mettre en production

Le passage du poste au conteneur, et ce qu'on promet à ceux qui installent.

```nodefony-cards
[
  { "icon": "🐳", "title": "Docker & cloud-native", "href": "docker-cloud-native.md", "featured": true,
    "desc": "Un process au premier plan, les sondes `/livez` et `/readyz` livrées, l'arrêt gracieux — et les pièges qui font perdre les signaux.",
    "meta": "à lire avant le premier déploiement" },
  { "icon": "🤝", "title": "Compatibilité", "href": "compatibilite.md",
    "desc": "Ce qui casse en montant de version, ce que la garantie couvre vraiment, et comment une dépréciation se signale dans votre éditeur.",
    "meta": "avant de monter de version" },
  { "icon": "📦", "title": "Publier une release", "href": "publier-une-release.md",
    "desc": "La chaîne des quinze paquets, ce que chaque garde refuse, et pourquoi une version publiée ne se rattrape pas.",
    "meta": "côté mainteneur" }
]
```

## 🔬 Éprouver

Comment ce projet se contrôle lui-même — transposable à vos propres bancs.

```nodefony-cards
[
  { "icon": "🏭", "title": "Intégration continue", "href": "integration-continue.md",
    "desc": "Ce que la forge lance, avec quel décor, et comment le rejouer chez vous. La règle qui gouverne tout : un test non exécuté n'est pas un test réussi.",
    "meta": "un saut compte comme un vert" },
  { "icon": "🤖", "title": "Éprouver avec un agent", "href": "eprouver-loutillage-agent.md",
    "desc": "Confier une tâche réelle au modèle le plus faible, dans une application neuve, et compter ce qu'il a dû écrire HORS de l'outil. Le décor décide du résultat.",
    "meta": "la méthode, et ce qu'elle a trouvé" }
]
```

## 🧭 Et si ce n'est pas ici

| Vous cherchez…                                                   | Allez plutôt vers                                                     |
| ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| Un parcours complet, de zéro à une application qui répond        | [le tutoriel](../tutoriels/premiere-application.md)                   |
| Comment ça marche **dedans** — le boot, le pipeline, l'injection | [l'architecture](../architecture/README.md)                           |
| L'API d'une brique précise (routes, sessions, firewall…)         | la documentation de son module                                        |
| Définir des routes, les décorateurs                              | [`framework`](../../src/packages/@nodefony/framework/docs/routing.md) |
| WebSocket : actions, canaux, protocole                           | [`realtime`](../../src/packages/@nodefony/realtime/docs/index.md)     |
| Éprouver ce que vous écrivez                                     | [`core` — tests](../../src/nodefony/docs/testing.md)                  |

📖 [Lexique général](../lexique.md) du framework.
