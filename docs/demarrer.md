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
updated: 2026-10-25
source: "docs/demarrer.md"
tests: none
hub: true
---

# Par où commencer

> Cinq parcours selon **qui tu es**. Chacun est **ordonné** : les étapes se construisent l'une sur
> l'autre, et chaque parcours dit **pourquoi** cet ordre. Si tu cherches une brique précise plutôt
> qu'un chemin, retourne à l'accueil : tout y est rangé par type.

📍 [Documentation](index.md) › **Par où commencer**

## 🧑‍💼 Directeur technique

Ce que tu évalues, c'est la reprise. Rien ici ne promet un support : tout montre ce qui permet à une
équipe de corriger ou de maintenir le code seule. L'ordre va de l'engagement légal à ce qui le rend
tenable.

```nodefony-cards
[
  { "icon": "📜", "title": "Licence Apache 2.0", "href": "https://github.com/nodefony/nodefony-core/blob/main/LICENSE.txt",
    "desc": "Le code se reprend, se modifie et se redistribue — y compris pour maintenir soi-même une version que le projet ne suit plus." },
  { "icon": "🤝", "title": "Compatibilité et support", "href": "guides/compatibilite.md",
    "desc": "Ce que la garantie couvre (`exports`, comportement compris) et la règle de support : seule la dernière majeure reçoit des correctifs. Courte, et tenue." },
  { "icon": "⬆️", "title": "Monter de version", "href": "guides/montee-de-version.md",
    "desc": "Les paquets montent ensemble ; ce qu'un `npm install` ne refait pas dans l'application." },
  { "icon": "🔒", "title": "Politique de sécurité", "href": "https://github.com/nodefony/nodefony-core/blob/main/SECURITY.md",
    "desc": "Comment signaler une faille, et des délais dits plutôt que promis." },
  { "icon": "🛠️", "title": "Contribuer", "href": "https://github.com/nodefony/nodefony-core/blob/main/CONTRIBUTING.md",
    "desc": "Prérequis, règles non négociables, tests : ce qu'il faut pour qu'un correctif soit accepté." }
]
```

## ⚙️ Exploitation

Un process = un conteneur, le reste se délègue à l'orchestrateur. Le premier bloc déploie ; le second
est la passe qu'on regrette de ne pas avoir faite avant d'ouvrir au public.

### Déployer

```nodefony-cards
[
  { "icon": "🐳", "title": "Docker & cloud-native", "href": "guides/docker-cloud-native.md",
    "desc": "Un process = un conteneur, scaling délégué à l'orchestrateur." },
  { "icon": "☸️", "title": "Kubernetes", "href": "guides/kubernetes.md",
    "desc": "Les manifests, l'identité du pod, et les migrations qui passent avant les exemplaires." },
  { "icon": "🛡️", "title": "Reverse-proxy", "href": "guides/reverse-proxy.md",
    "desc": "nginx, HAProxy, Traefik — et la configuration qui se dérive de l'app au lieu de dériver." },
  { "icon": "🔧", "title": "Variables d'environnement", "href": "guides/variables-environnement.md",
    "desc": "Ce que le framework lit, et ce qui se passe quand une variable manque." },
  { "icon": "🗝️", "title": "Stockage de session", "href": "guides/session-storage.md",
    "desc": "Le choix qui décide de ton scaling horizontal." },
  { "icon": "🛠️", "title": "Studio", "href": "../src/packages/@nodefony/studio/docs/index.md",
    "desc": "L'administration web : voir l'intérieur du framework en marche." }
]
```

### Avant d'ouvrir au public

C'est qui met en ligne qui tient cette liste : en-têtes et CORS parlent d'origines et de domaines.

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

## 🎨 Développeur front

Deux serveurs en développement, un seul en production, et le navigateur n'en voit jamais qu'un.
L'ordre suit le trajet : déclarer l'interface, comprendre qui la sert, puis ce qui se passe quand ça
casse.

```nodefony-cards
[
  { "icon": "⚛️", "title": "Servir une interface", "href": "guides/frontend-react.md",
    "desc": "Une SPA avec le rechargement à chaud de Vite." },
  { "icon": "🧩", "title": "Le module frontend", "href": "../src/packages/@nodefony/frontend/docs/index.md",
    "desc": "Le modèle mental — deux serveurs, un seul site — et la déclaration `registerEntry`." },
  { "icon": "🔄", "title": "Le superviseur Vite : le trajet", "href": "../src/packages/@nodefony/frontend/docs/index.md#le-trajet-du-démarrage",
    "desc": "Qui lance Vite, quand, ce qu'il relaie sous `/_vite/`, et comment il l'arrête." },
  { "icon": "🩹", "title": "Quand Vite tombe", "href": "../src/packages/@nodefony/frontend/docs/index.md#résilience--ce-qui-se-passe-quand-vite-tombe",
    "desc": "Port occupé, plantage, gel : ce que le superviseur fait à ta place." },
  { "icon": "📦", "title": "Livrer en production", "href": "../src/packages/@nodefony/frontend/docs/index.md#-les-deux-modes-de-livraison-de-linterface",
    "desc": "Ce qui remplace Vite quand il n'est plus là, et qui décide." },
  { "icon": "📡", "title": "La socket Nodefony", "href": "../src/packages/@nodefony/realtime/docs/index.md",
    "desc": "Une connexion, N canaux : le temps réel côté client." }
]
```

## 🗄️ Développeur back

Du squelette à la donnée persistée, puis protégée. Trois blocs qui se suivent — construire,
persister, sécuriser — et chaque étage suppose le précédent.

### Construire

```nodefony-cards
[
  { "icon": "🎓", "title": "Tutoriel : ta première application", "href": "tutoriels/premiere-application.md",
    "desc": "Si tu débutes, commence ici : de `create app` à une entité persistée, pas à pas. Les briques ci-dessous approfondissent chaque étape." },
  { "icon": "1️⃣", "title": "Configuration", "href": "architecture/configuration.md",
    "desc": "`nodefony.config.ts` + `env.ts` : la seule source de vérité, validée au boot." },
  { "icon": "2️⃣", "title": "Écrire des routes", "href": "../src/packages/@nodefony/framework/docs/index.md",
    "desc": "Contrôleurs, décorateurs, résolution des paramètres." },
  { "icon": "3️⃣", "title": "Éprouver ce que tu as écrit", "href": "../src/nodefony/docs/testing.md",
    "desc": "Le harnais de test livré avec l'application : ce qu'il fait, et comment en écrire un second." }
]
```

### Persister

```nodefony-cards
[
  { "icon": "🏗️", "title": "Générer une entité", "href": "guides/generer-du-code.md",
    "desc": "`nodefony create entity` : l'aperçu avant d'écrire, le code produit, et pourquoi partir de là plutôt que de la main." },
  { "icon": "🗃️", "title": "Choisir sa base", "href": "guides/persistence.md",
    "desc": "Brancher une persistance et écrire du code portable entre bases." },
  { "icon": "🧱", "title": "Drizzle, l'ORM par défaut", "href": "../src/packages/@nodefony/drizzle/docs/index.md",
    "desc": "Trois étages, une seule vérité, et les stores du framework clé en main." },
  { "icon": "🧬", "title": "Migrations de schéma", "href": "../src/packages/@nodefony/drizzle/docs/migrations.md",
    "desc": "Du schéma dérivé en développement au déploiement sans interruption : `orm:generate`, `orm:migrate`, et ce qui passe avant les exemplaires." },
  { "icon": "🍃", "title": "MongoDB avec Mongoose", "href": "../src/packages/@nodefony/mongoose/docs/index.md",
    "desc": "Le modèle documentaire : connexions, schémas, et ce qui n'exige aucune migration." },
  { "icon": "🔌", "title": "Le contrat `IRepository`", "href": "../src/packages/@nodefony/orm-core/docs/index.md",
    "desc": "La prise de courant que les deux moteurs honorent — pour du code portable, ou pour brancher un autre moteur." }
]
```

### Sécuriser

Authentifier sans autoriser ne protège rien.

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

## 🏛️ Architecte

Comprendre l'ossature avant de juger les choix — chaque page suppose la précédente. Les décisions
écrites viennent en dernier, parce qu'elles ne se lisent bien qu'avec le modèle en tête.

```nodefony-cards
[
  { "icon": "1️⃣", "title": "Vue d'ensemble", "href": "architecture/vue-ensemble.md",
    "desc": "Ce qu'est le framework, ce qu'il n'est pas, et ce que ses partis pris coûtent." },
  { "icon": "2️⃣", "title": "Injection & portées", "href": "architecture/injection-portees.md",
    "desc": "Chaque requête pose un calque sur le conteneur de l'application : elle lit tout, n'écrit que sur le sien, et le calque part avec elle. Le mécanisme qui isole deux requêtes concurrentes." },
  { "icon": "3️⃣", "title": "Cycle de boot du Kernel", "href": "architecture/cycle-boot-kernel.md",
    "desc": "Ce qui se passe entre `npm run dev` et le premier octet servi." },
  { "icon": "4️⃣", "title": "Pipeline de requête", "href": "architecture/pipeline-requete.md",
    "desc": "Le trajet exact d'une requête — HTTP comme WebSocket." },
  { "icon": "🏛️", "title": "Décisions d'architecture", "href": "adr/README.md",
    "desc": "Les ADR : pourquoi tel choix, ce qu'il coûte, et ce qu'il a remplacé." },
  { "icon": "🔌", "title": "Étendre le framework", "href": "guides/etendre.md",
    "desc": "Les endroits où brancher le tien sans modifier une ligne du framework." }
]
```

## 🔗 Pour aller plus loin

- ⬆️ **Retour** : [Accueil de la documentation](index.md) — tout le catalogue, rangé par type.
- 📖 [Lexique général](lexique.md) — le vocabulaire du framework en un seul endroit.
