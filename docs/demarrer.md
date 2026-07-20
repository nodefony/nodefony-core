---
title: "Par où commencer"
lang: fr
module: "global"
topic: demarrer
section: "Accueil"
audience: [developer, devops, supervisor, admin]
tags: [demarrage, parcours, onboarding]
version: "doc"
status: stable
updated: 2026-07-19
source: "docs/demarrer.md"
tests: none
hub: true
---

# Par où commencer

> Quatre parcours selon ce que tu viens faire. Chacun est **ordonné** : les étapes se construisent
> l'une sur l'autre, et chaque parcours dit **pourquoi** cet ordre. Si tu cherches une brique précise
> plutôt qu'un chemin, retourne à l'accueil : tout y est rangé par type.

📍 [Documentation](index.md) › **Par où commencer**

## 🧭 Je découvre Nodefony

Comprendre l'ossature avant d'écrire du code — dans cet ordre, chaque page suppose la précédente.

```nodefony-cards
[
  { "icon": "1️⃣", "title": "Vue d'ensemble", "href": "architecture/vue-ensemble.md",
    "desc": "Ce qu'est le framework, ce qu'il n'est pas, et ce que ses partis pris coûtent." },
  { "icon": "2️⃣", "title": "Cycle de boot du Kernel", "href": "architecture/cycle-boot-kernel.md",
    "desc": "Ce qui se passe entre `npm run dev` et le premier octet servi." },
  { "icon": "3️⃣", "title": "Injection & portées", "href": "architecture/injection-portees.md",
    "desc": "Comment les services se trouvent sans se connaître." },
  { "icon": "4️⃣", "title": "Pipeline de requête", "href": "architecture/pipeline-requete.md",
    "desc": "Le trajet exact d'une requête — HTTP comme WebSocket." }
]
```

## 🚀 Je construis une application

Du squelette à la première route servie.

```nodefony-cards
[
  { "icon": "🎓", "title": "Tutoriel : ta première application", "href": "tutoriels/premiere-application.md",
    "desc": "Si tu débutes, commence ici : de `create app` à une entité persistée, pas à pas. Les briques ci-dessous approfondissent chaque étape." },
  { "icon": "1️⃣", "title": "Configuration", "href": "architecture/configuration.md",
    "desc": "`nodefony.config.ts` + `env.ts` : la seule source de vérité, validée au boot." },
  { "icon": "2️⃣", "title": "Écrire des routes", "href": "../src/packages/@nodefony/framework/docs/index.md",
    "desc": "Contrôleurs, décorateurs, résolution des paramètres." },
  { "icon": "3️⃣", "title": "Choisir sa base", "href": "guides/persistence.md",
    "desc": "Brancher une persistance et écrire du code portable entre bases." },
  { "icon": "4️⃣", "title": "Servir une interface", "href": "guides/frontend-react.md",
    "desc": "Une SPA avec le rechargement à chaud de Vite." }
]
```

## 🔐 Je sécurise

Chaque étage suppose le précédent : authentifier sans autoriser ne protège rien.

```nodefony-cards
[
  { "icon": "1️⃣", "title": "Firewall", "href": "../src/packages/@nodefony/security/docs/firewall.md",
    "desc": "Zones et Zero Trust : la fondation dont tout le reste dépend." },
  { "icon": "2️⃣", "title": "Authenticators", "href": "../src/packages/@nodefony/security/docs/authenticators.md",
    "desc": "Les six façons de prouver QUI appelle." },
  { "icon": "3️⃣", "title": "Autorisation", "href": "../src/packages/@nodefony/security/docs/authorization.md",
    "desc": "Rôles, scopes et voters : ce qu'il a le DROIT de faire." },
  { "icon": "4️⃣", "title": "Jetons", "href": "../src/packages/@nodefony/security/docs/tokens.md",
    "desc": "Ce qui matérialise une identité prouvée, et comment on la révoque." }
]
```

## 🛡️ J'audite avant une mise en production

La passe qu'on regrette de ne pas avoir faite.

```nodefony-cards
[
  { "icon": "1️⃣", "title": "En-têtes de sécurité", "href": "../src/packages/@nodefony/security/docs/headers.md",
    "desc": "CSP, HSTS, COOP/COEP : ce que le navigateur applique pour toi." },
  { "icon": "2️⃣", "title": "CSRF", "href": "../src/packages/@nodefony/security/docs/csrf.md",
    "desc": "Empêcher un site tiers d'agir au nom de ton utilisateur." },
  { "icon": "3️⃣", "title": "CORS", "href": "../src/packages/@nodefony/security/docs/cors.md",
    "desc": "Qui a le droit de LIRE tes réponses." },
  { "icon": "4️⃣", "title": "Journal d'audit", "href": "../src/packages/@nodefony/security/docs/audit.md",
    "desc": "Prouver après coup qui a fait quoi." }
]
```

## ⚙️ J'exploite en production

Ce qui compte quand ça tourne pour de vrai.

```nodefony-cards
[
  { "icon": "🐳", "title": "Docker & cloud-native", "href": "guides/docker-cloud-native.md",
    "desc": "Un process = un conteneur, scaling délégué à l'orchestrateur." },
  { "icon": "🗝️", "title": "Stockage de session", "href": "guides/session-storage.md",
    "desc": "Le choix qui décide de ton scaling horizontal." },
  { "icon": "🛠️", "title": "Studio", "href": "../src/packages/@nodefony/studio/docs/index.md",
    "desc": "L'administration web : voir l'intérieur du framework en marche." }
]
```

## 🔗 Pour aller plus loin

- ⬆️ **Retour** : [Accueil de la documentation](index.md) — tout le catalogue, rangé par type.
- 📖 [Lexique général](lexique.md) — le vocabulaire du framework en un seul endroit.
