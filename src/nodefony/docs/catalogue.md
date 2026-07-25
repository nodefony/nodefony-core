---
title: "Catalogue des modules — quel module pour quel besoin"
lang: fr
module: "@nodefony/core"
topic: catalogue
section: "Cœur runtime"
audience: [developer]
tags:
  [
    catalogue,
    modules,
    dependances,
    choix,
    orm,
    realtime,
    security,
    redis,
    manifeste,
  ]
version: "doc"
status: stable
updated: 2026-07-25
source: "src/nodefony/docs/catalogue.md"
# Page d'ORIENTATION, pas de référence : elle envoie vers des modules et n'explique
# aucune brique. Lui réclamer des ancres `fichier:ligne` fabriquerait du faux.
hub: true
---

# Catalogue des modules — quel module pour quel besoin

📍 [Documentation](../../../docs/index.md) › [Cœur — @nodefony/core](index.md) › **Catalogue des modules**

> Nodefony ne fournit pas UNE façon de tout faire : il fournit un socle, et des modules qu'une
> application **déclare**. Cette page répond à la seule question qu'on se pose avant d'écrire du
> code : _quel paquet installer pour ce besoin, et lequel ne PAS installer_. Elle est publiée
> avec le cœur — une application l'a donc sous la main dans
> `node_modules/nodefony/docs/catalogue.md`, sans réseau ni dépôt.

## 🧭 Par où commencer

1. Trouve ton besoin dans les familles ci-dessous — chaque entrée dit aussi **quand ne PAS**
   prendre le module, ce qu'aucune page de vente ne fait.
2. Déclare-le (trois pas, section suivante).
3. Vérifie sur pièce : `nodefony inspect modules --json` liste ce qui est **réellement** chargé.

## Déclarer un module — le geste, une fois pour toutes

Trois pas, toujours les mêmes :

```bash
npm install @nodefony/<module>
```

```typescript
// nodefony.config.ts — manifeste `modules`
use("@nodefony/<module>", {/* options */});
```

```bash
nodefony inspect modules --json   # ce qui est RÉELLEMENT chargé, sans ouvrir de port
```

**Les clés de configuration ne sont pas dans cette page** — et c'est voulu : elles vivent dans le
schéma du module, `node_modules/@nodefony/<module>/dist/nodefony/config/config.js`, où chaque clé
porte son défaut et sa description. Une page qui les recopierait mentirait à la première évolution.
`nodefony inspect config <module>` en donne la valeur **effective** et sa provenance.

## Le socle — présent dans toute application

Ces trois-là ne se choisissent pas : `nodefony create app` les pose.

| Paquet                | Ce qu'il apporte                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| `nodefony`            | Le cœur : `Service`, conteneur d'injection, `Kernel`, `Module`, journal, CLI, client isomorphe |
| `@nodefony/http`      | Serveurs HTTP/HTTP2/WebSocket, contextes de requête, sessions, TLS                             |
| `@nodefony/framework` | Routeur, contrôleurs, décorateurs de route, idempotence                                        |

## Sécurité & identité

| Paquet               | Prends-le quand…                                                                                                                                                      | Ne le prends pas si…                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `@nodefony/security` | une partie de l'application doit être fermée : zones de pare-feu, six méthodes d'authentification, autorisation par voters, CSRF/CORS, 2FA, passkeys, journal d'audit | l'application est entièrement publique — mais la fermer plus tard coûte alors une reprise des routes |
| `@nodefony/user`     | tu veux des comptes utilisateurs (contrat `IUser`, encodeurs de mot de passe) sans dépendre du pare-feu                                                               | l'identité vient d'ailleurs (jeton d'un fournisseur externe, service amont)                          |

`@nodefony/security` embarque déjà `@nodefony/user` : le déclarer seul n'a de sens que pour gérer
des comptes **sans** fermer de routes.

## Données

Un contrat commun, plusieurs implémentations : écris contre le contrat, choisis le moteur ensuite.

| Paquet               | Prends-le quand…                                                                            | Ne le prends pas si…                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `@nodefony/orm-core` | jamais directement — c'est le contrat, tiré par l'adaptateur que tu choisis                 | —                                                                                                                       |
| `@nodefony/drizzle`  | **le défaut** : SQL (PostgreSQL, MySQL/MariaDB, SQLite), `nodefony create entity` cible lui | tes données sont des documents sans schéma stable                                                                       |
| `@nodefony/mongoose` | MongoDB, données orientées document                                                         | tu attends la couverture complète du contrat : elle est **adaptée à la nature du moteur**, pas identique à celle de SQL |
| `@nodefony/redis`    | cache, sessions partagées entre pods, backplane du temps réel en cluster                    | un seul processus : les sessions en mémoire et le backplane local suffisent                                             |

**L'arbitrage qui revient le plus souvent** : `drizzle` ou `mongoose` ? Le générateur d'entités
(`nodefony create entity`) produit du Drizzle natif du dialecte ; partir sur Mongoose, c'est écrire
ses modèles à la main. Prends `mongoose` parce que tes données SONT des documents, pas pour éviter
de choisir un dialecte SQL.

**Et `redis` ?** Il ne sert à rien tant que l'application tourne dans un seul processus. Il devient
nécessaire à l'instant où il y en a deux : sans lui, deux pods ont deux annuaires de sessions et
deux hubs temps réel qui ne se parlent pas.

## Temps réel & interface

| Paquet                    | Prends-le quand…                                                                                                                      | Ne le prends pas si…                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `@nodefony/realtime`      | le serveur doit **pousser** : une connexion qui multiplexe N canaux bidirectionnels, actions RPC, backplane cluster                   | un simple echo WebSocket suffit — `@nodefony/http` le fait déjà             |
| `@nodefony/frontend`      | l'application sert une interface Vite (React, Vue, Angular), en rechargement à chaud en développement et pré-construite en production | l'application n'est qu'une API                                              |
| `@nodefony/studio`        | tu veux voir l'intérieur en marche : routes, services, configuration, sessions, journaux, en **développement**                        | production — c'est un outil de développement, pas un tableau de bord public |
| `@nodefony/documentation` | tu publies des pages de documentation servies par l'application elle-même                                                             | tu écris de la documentation lue seulement dans le dépôt                    |

`@nodefony/studio` tire `@nodefony/frontend` : le déclarer suffit à avoir les deux.

## 🗂️ La documentation de chaque module

Une fois le module choisi, sa documentation est **installée avec lui** — lis ciblé, jamais tout le
dossier.

```nodefony-cards
[
  { "icon": "🔌", "title": "@nodefony/http", "href": "../../packages/@nodefony/http/docs/index.md",
    "desc": "Serveurs, contextes, sessions, TLS.", "meta": "le transport" },
  { "icon": "🧭", "title": "@nodefony/framework", "href": "../../packages/@nodefony/framework/docs/index.md",
    "desc": "Routeur, contrôleurs, décorateurs.", "meta": "tu écris des routes" },
  { "icon": "🛡️", "title": "@nodefony/security", "href": "../../packages/@nodefony/security/docs/index.md",
    "desc": "Pare-feu par zones, authentification, autorisation, audit.", "meta": "fermer l'application" },
  { "icon": "👤", "title": "@nodefony/user", "href": "../../packages/@nodefony/user/docs/index.md",
    "desc": "Contrat `IUser`, stockage des comptes, mots de passe.", "meta": "les comptes" },
  { "icon": "📐", "title": "@nodefony/orm-core", "href": "../../packages/@nodefony/orm-core/docs/index.md",
    "desc": "Le contrat commun à tous les moteurs.", "meta": "le contrat" },
  { "icon": "🐘", "title": "@nodefony/drizzle", "href": "../../packages/@nodefony/drizzle/docs/index.md",
    "desc": "SQL — PostgreSQL, MySQL/MariaDB, SQLite.", "meta": "le défaut" },
  { "icon": "🍃", "title": "@nodefony/mongoose", "href": "../../packages/@nodefony/mongoose/docs/index.md",
    "desc": "MongoDB, données orientées document.", "meta": "document" },
  { "icon": "⚡", "title": "@nodefony/redis", "href": "../../packages/@nodefony/redis/docs/index.md",
    "desc": "Cache, sessions partagées, backplane du temps réel.", "meta": "dès le 2ᵉ processus" },
  { "icon": "🛰️", "title": "@nodefony/realtime", "href": "../../packages/@nodefony/realtime/docs/index.md",
    "desc": "Une connexion, N canaux bidirectionnels, backplane cluster.", "meta": "le serveur pousse" },
  { "icon": "🎨", "title": "@nodefony/frontend", "href": "../../packages/@nodefony/frontend/docs/index.md",
    "desc": "Build Vite, rechargement à chaud, React/Vue/Angular.", "meta": "servir une interface" },
  { "icon": "🛠️", "title": "@nodefony/studio", "href": "../../packages/@nodefony/studio/docs/index.md",
    "desc": "L'administration web : voir l'intérieur en marche.", "meta": "développement" },
  { "icon": "📘", "title": "@nodefony/documentation", "href": "../../packages/@nodefony/documentation/docs/index.md",
    "desc": "Le portail qui rend ces pages, et son data plane.", "meta": "méta" }
]
```

## Ce que ce catalogue ne dit pas

- **Les clés de configuration** — elles vivent dans le schéma du module (voir plus haut). Les
  recopier ici les périmerait.
- **Les versions** — une publication les fixe toutes ensemble ; `npm install @nodefony/<module>`
  prend celle qui correspond à ton cœur.
- **Ce que ton application charge vraiment** — `nodefony inspect modules --json` le dit, et lui ne
  peut pas se tromper.

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Cœur — @nodefony/core](index.md)
- 🧭 **Le cycle de vie** qui charge ces modules : [kernel.md](kernel.md) · les commandes qui les
  interrogent : [cli.md](cli.md)
- 📖 [Lexique général](../../../docs/lexique.md) du framework.
