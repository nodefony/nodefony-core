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
> de modules et une couche de sécurité complète. Tout est rangé ci-dessous par type — chaque card
> mène au hub qui détaille sa brique.

```nodefony-cards
[
  { "icon": "🧭", "title": "Par où commencer", "href": "demarrer.md", "featured": true,
    "desc": "Quatre parcours ordonnés selon ce que tu viens faire : découvrir, construire, sécuriser, exploiter. Chaque étape dit pourquoi elle vient là.",
    "meta": "commence ici si tu débutes" }
]
```

## 🏛️ Fondations

Comment l'ensemble tient. Ces pages ne relèvent d'aucun module en particulier.

```nodefony-cards
[
  { "icon": "🗺️", "title": "Vue d'ensemble", "href": "architecture/vue-ensemble.md",
    "desc": "La carte du territoire : ce qu'est Nodefony, ce qu'il n'est pas, ses partis pris et leur coût." },
  { "icon": "🔄", "title": "Cycle de boot du Kernel", "href": "architecture/cycle-boot-kernel.md",
    "desc": "L'ordre d'allumage, les hooks où brancher son code, l'arrêt propre." },
  { "icon": "💉", "title": "Injection & portées", "href": "architecture/injection-portees.md",
    "desc": "Le conteneur de services : déclarer, injecter, choisir une portée." },
  { "icon": "⚙️", "title": "Configuration", "href": "architecture/configuration.md",
    "desc": "`defineConfig`, `use()`, l'environnement — et la validation au boot." },
  { "icon": "🔀", "title": "Pipeline de requête", "href": "architecture/pipeline-requete.md",
    "desc": "Le trajet d'une requête, de l'octet reçu à l'octet renvoyé. HTTP et WebSocket." },
  { "icon": "📦", "title": "Build & bundling", "href": "architecture/build-bundling.md",
    "desc": "Comment le TypeScript devient un paquet publiable : rolldown, types, distribution." }
]
```

## 🧱 Le cœur

Le socle : présent dans toute application, quelle que soit sa forme.

```nodefony-cards
[
  { "icon": "🧩", "title": "nodefony", "href": "../src/nodefony/docs/index.md",
    "desc": "Service, Container, Kernel, Event, Syslog.", "meta": "toujours présent" },
  { "icon": "🔌", "title": "@nodefony/http", "href": "../src/packages/@nodefony/http/docs/index.md",
    "desc": "Serveurs HTTP/HTTP2/WebSocket, contextes de requête, sessions, TLS.", "meta": "le transport" },
  { "icon": "🧭", "title": "@nodefony/framework", "href": "../src/packages/@nodefony/framework/docs/index.md",
    "desc": "Routeur, contrôleurs, décorateurs, idempotence.", "meta": "tu écris des routes" }
]
```

## 🔐 Sécurité & identité

```nodefony-cards
[
  { "icon": "🛡️", "title": "@nodefony/security", "href": "../src/packages/@nodefony/security/docs/index.md",
    "desc": "Firewall par zones, six authenticators, autorisation par voters, CSRF/CORS/en-têtes, 2FA, passkeys, webhooks, audit.",
    "meta": "13 pages — le module le plus fourni" },
  { "icon": "👤", "title": "@nodefony/user", "href": "../src/packages/@nodefony/user/docs/index.md",
    "desc": "L'identité `IUser` et son stockage.", "meta": "comptes utilisateurs" }
]
```

## 🗄️ Données

Un contrat commun, plusieurs implémentations. Écris contre le contrat, choisis le backend ensuite.

```nodefony-cards
[
  { "icon": "📐", "title": "@nodefony/orm-core", "href": "../src/packages/@nodefony/orm-core/docs/index.md",
    "desc": "Le contrat ORM partagé par tous les backends.", "meta": "le contrat" },
  { "icon": "🐘", "title": "@nodefony/drizzle", "href": "../src/packages/@nodefony/drizzle/docs/index.md",
    "desc": "SQL — PostgreSQL, MySQL/MariaDB, SQLite.", "meta": "l'implémentation par défaut" },
  { "icon": "🍃", "title": "@nodefony/mongoose", "href": "../src/packages/@nodefony/mongoose/docs/index.md",
    "desc": "MongoDB — pour les données orientées document.", "meta": "document" },
  { "icon": "⚡", "title": "@nodefony/redis", "href": "../src/packages/@nodefony/redis/docs/index.md",
    "desc": "Cache, sessions partagées, backplane temps réel.", "meta": "scaling horizontal" }
]
```

## 📡 Temps réel & interface

```nodefony-cards
[
  { "icon": "🛰️", "title": "@nodefony/realtime", "href": "../src/packages/@nodefony/realtime/docs/index.md",
    "desc": "La socket Nodefony : une connexion qui multiplexe N canaux bidirectionnels, avec backplane.",
    "meta": "le différenciateur" },
  { "icon": "🎨", "title": "@nodefony/frontend", "href": "../src/packages/@nodefony/frontend/docs/index.md",
    "desc": "Build Vite, rechargement à chaud, multi-framework (React, Vue, Angular).", "meta": "servir une SPA" },
  { "icon": "🛠️", "title": "@nodefony/studio", "href": "../src/packages/@nodefony/studio/docs/index.md",
    "desc": "L'administration web du framework : voir l'intérieur en marche.", "meta": "introspection" },
  { "icon": "📘", "title": "@nodefony/documentation", "href": "../src/packages/@nodefony/documentation/docs/index.md",
    "desc": "Le portail qui rend ces pages, et son data plane.", "meta": "méta" }
]
```

## 📗 Guides

Orientés tâche : on suit le guide, on obtient un résultat.

```nodefony-cards
[
  { "icon": "🎓", "title": "Tutoriel : ta première application", "href": "tutoriels/premiere-application.md",
    "desc": "De zéro à une app qui répond en HTTP, en WebSocket, et persiste des données — pas à pas." },
  { "icon": "⚙️", "title": "Configuration pas à pas", "href": "guides/configuration.md",
    "desc": "La recette, quand l'architecture est déjà comprise." },
  { "icon": "🏗️", "title": "Générer du code", "href": "guides/generer-du-code.md",
    "desc": "`nodefony create` : voir ce qui va changer avant que ça change — et l'appeler depuis un agent." },
  { "icon": "🗄️", "title": "Persistance", "href": "guides/persistence.md",
    "desc": "Choisir et brancher sa base de données." },
  { "icon": "🗝️", "title": "Stockage de session", "href": "guides/session-storage.md",
    "desc": "Le choix qui décide de ton scaling horizontal." },
  { "icon": "⚛️", "title": "Frontend React", "href": "guides/frontend-react.md",
    "desc": "Servir une SPA avec le rechargement à chaud." },
  { "icon": "🐳", "title": "Docker & cloud-native", "href": "guides/docker-cloud-native.md",
    "desc": "Un process = un conteneur, scaling délégué à l'orchestrateur." }
]
```

## 📚 Références

```nodefony-cards
[
  { "icon": "📖", "title": "Lexique général", "href": "lexique.md",
    "desc": "Le vocabulaire du framework, en un seul endroit." },
  { "icon": "🏛️", "title": "Décisions d'architecture", "href": "adr/0001-docs-modules-emplacement-hybride.md",
    "desc": "Les ADR : pourquoi tel choix a été fait, et ce qu'il coûte." },
  { "icon": "🤖", "title": "Outillage agents", "href": "outillage-agents.md",
    "desc": "Les skills du dépôt de développement : ce que chacun fait, combien il sert réellement, sa conformité au standard Agent Skills, et lesquels réparer ou fusionner. Concerne le dépôt, pas le paquet publié." }
]
```

## 🔗 Pour aller plus loin

- 🧭 **Tu ne sais pas par où entrer ?** → [Par où commencer](demarrer.md) : quatre parcours ordonnés.
- 🧪 **Qualité** : chaque page de brique porte l'inventaire de ses tests — unitaires, intégration, E2E,
  attaque, charge — **et dit ce qui manque**. Un trou de couverture nommé vaut mieux qu'un chiffre flatteur.
- 📊 **Ce que ça tient** : le dossier [Performance](performance/index.md) — où part le temps, ce
  que le chantier a rendu, ce qu'il a **annulé après l'avoir écrit**, et combien de pods il faut.
- 📡 **Voir tourner** : Studio expose la documentation, la configuration résolue, les routes, les
  sessions et le temps réel de l'instance en marche.
