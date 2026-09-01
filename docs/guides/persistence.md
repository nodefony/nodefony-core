---
title: "Persistance & stores — déclarer son infrastructure, pas onze backends"
navTitle: Persistance
lang: fr
module: global
topic: persistence-guide
audience: [human, ai]
tags:
  [
    persistence,
    stores,
    infra,
    database,
    redis,
    session,
    audit,
    idempotency,
    guide,
  ]
version: "doc"
status: stable
updated: 2026-09-01
source: "docs/guides/persistence.md"
related: project_config_clarity_chantier_kit, project_resilience_no_silent_degradation
---

# Guide — Persistance & stores (infra déclarée)

> Où Nodefony range ses données durables — utilisateurs, jetons, passkeys, audit, webhooks,
> idempotence, sessions — **sans configurer huit briques une par une**. Vous déclarez votre
> **infrastructure** (une ou deux URL), le framework **dérive** où va chaque brique.

📍 [Documentation](../index.md) › [Guides](README.md) › **Persistance & stores**

## Le modèle — vous déclarez, le framework dérive

**Vous déclarez votre infrastructure, le framework choisit les stores.** Une `NF_DATABASE_URL`
suffit à câbler tout le durable ; ajoutez une `NF_REDIS_URL` et le partagé entre process suit.
Aucun réglage brique par brique tant que les défauts conviennent.

## Déclarer l'infrastructure

Trois familles, déclarées par **URL** — le schéma décide du backend :

| Variable                                 | Infrastructure               | Exemples de valeur                                                   |
| ---------------------------------------- | ---------------------------- | -------------------------------------------------------------------- |
| `NF_DATABASE_URL` (alias `DATABASE_URL`) | **durable** (base)           | `sqlite:./var/app.db` · `postgres://…` · `mysql://…` · `mongodb://…` |
| `NF_REDIS_URL` (alias `REDIS_URL`)       | **cache** (éphémère partagé) | `redis://localhost:6379` — sa présence **charge** `@nodefony/redis`  |
| `NF_LOKI_URL` / `NF_OPENSEARCH_URL`      | **journaux** (relecture)     | `http://loki:3100` · `https://opensearch:9200`                       |

Les alias de plateforme (`DATABASE_URL`, `REDIS_URL`) sont acceptés tels quels — ce sont les noms
qu'un hébergeur pose lui-même. La lecture est faite une seule fois, par `resolveInfra()`
(`infra.ts:134`).

Le **schéma** de `NF_DATABASE_URL` déduit le dialecte : `sqlite:` → SQLite, `postgres://` →
PostgreSQL, `mysql://` → MySQL, `mongodb://` → MongoDB. Un schéma inconnu **fait échouer le boot**
(`infra.ts:106`) : jamais de choix silencieux.

## Les trois profils

| Profil      | Infrastructure déclarée            | Ce que ça donne                                                          |
| ----------- | ---------------------------------- | ------------------------------------------------------------------------ |
| **solo**    | aucune URL                         | SQLite local via drizzle, s'il est chargé ; sinon `memory` (volatil)     |
| **serveur** | `NF_DATABASE_URL`                  | tout le durable sur la base déclarée                                     |
| **cluster** | `NF_DATABASE_URL` + `NF_REDIS_URL` | durable sur la base, éphémère et sessions sur Redis (partagé entre pods) |

## `store: "auto"` — comment le framework choisit

Chaque brique a `store: "auto"` **par défaut**. La résolution est portée par une fonction unique,
`resolveAutoStore()` (`infra.ts:241`), et suit la nature de la donnée :

- **durable** (utilisateurs, jetons, passkeys, webhooks, audit, TOTP) → l'infrastructure
  `database` si déclarée ;
- **éphémère** (idempotence) et **session** → l'infrastructure `cache` d'abord, puis `database` ;
- **journaux** (relecture) → pilote dérivé de l'URL (`loki` / `opensearch`), l'écriture restant
  sur la sortie standard (cloud-native).

**Sans aucune infrastructure réseau déclarée**, `auto` ne se rabat pas tout de suite sur le
volatil : il prend le premier backend **local persistant** réellement chargé — `drizzle` (SQLite),
puis `mongoose` — et seulement à défaut `memory`. C'est ce qui fait qu'une application neuve
persiste ses données sans une ligne de configuration.

À chaque étape, le choix est **borné aux backends réellement enregistrés** pour cette brique, et
la raison est **écrite dans les journaux** par le consommateur — jamais de résolution opaque :

```
session.store "auto" → "drizzle" (aucune infra déclarée — backend local persistant "drizzle" (mono-nœud))
```

> **Un interrupteur global existe** : `NF_STORE` force toute brique `auto` sur un backend donné,
> quand il est enregistré pour elle (`infra.ts:247`). Il sert aux bancs de charge — pas à la
> production.

## Matrice brique × backend

`✅` = sélectionnable par son nom · `—` = pas d'implémentation enregistrée. Chaque case ci-dessous
correspond à un `register…Store("<nom>", …)` présent dans le code.

| Brique                    | memory | drizzle | mongoose | redis |
| ------------------------- | :----: | :-----: | :------: | :---: |
| Session                   |   ✅   |   ✅    |    ✅    |  ✅   |
| Utilisateurs              |   ✅   |   ✅    |    ✅    |   —   |
| Jetons (rafraîchissement) |   ✅   |   ✅    |    ✅    |  ✅   |
| Passkeys (WebAuthn)       |   ✅   |   ✅    |    ✅    |  ✅   |
| TOTP (double facteur)     |   ✅   |   ✅    |    —     |   —   |
| Audit                     |   ✅   |   ✅    |    —     |   —   |
| Webhooks                  |   ✅   |   ✅    |    ✅    |   —   |
| Idempotence               |   ✅   |   ✅    |    —     |  ✅   |

> **Couverture partielle assumée** : tous les backends ne portent pas toutes les briques — MongoDB
> n'a ni audit, ni idempotence, ni TOTP. Quand `auto` tombe sur une brique que l'infrastructure
> déclarée ne porte pas, le **repli est annoncé** dans la raison écrite au journal, jamais
> silencieux.

## Audit ≠ journaux

Deux chemins distincts, à ne pas confondre :

- **Audit** = journal de **conformité durable** (qui a fait quoi : connexion, révocation, accès
  refusé). Va dans la **base**, en ajout seul, protégé par les droits. C'est une **donnée**, pas
  de la télémétrie.
- **Journaux** = **télémétrie** (débit de requêtes, erreurs, traces). Va sur la sortie standard,
  vers un collecteur centralisé. Volatile par nature.

Un événement d'audit **ne doit jamais** finir uniquement dans les journaux, et une trace de mise au
point n'a rien à faire dans le store d'audit.

## Doctrine d'échec — jamais de dégradation silencieuse

Nodefony échoue **bruyamment** sur la dégradation, et **doucement** sur la disponibilité :

- un `store` **explicite** introuvable (par exemple `store: "redis"` sans l'adaptateur chargé) →
  **en production, le boot avorte** (`sessions-service.ts:269`) : une persistance silencieusement
  absente casse le pare-feu en cascade, alors qu'un pod qui refuse de démarrer se voit tout de
  suite ; **en développement, la dégradation est ANNONCÉE** (un avertissement nomme le repli) ;
- une **brique durable** résolue en `memory` **en production** → avertissement nommant l'impact
  (jetons, passkeys, audit, webhooks et idempotence perdus au redémarrage, rien de partagé entre
  pods).

Le principe : toute dégradation est **visible**, jamais subie en silence.

## Forcer un store (exception d'expert)

L'`auto` couvre l'immense majorité des cas. Pour épingler une brique à un backend précis, donnez un
nom explicite dans la configuration du module — il **gagne** sur l'`auto`, et sa provenance reste
visible :

```ts
// nodefony.config.ts
use("@nodefony/security", {
  tokenStore: { store: "redis" }, // jetons sur Redis même si la base est PostgreSQL
  audit: { store: "drizzle" }, // audit sur la base SQL
});
```

## 📖 Lexique

| Terme                  | Ce que c'est                                                                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Infrastructure**     | Ce que vous déclarez : une base, un cache, un collecteur de journaux — par URL. Trois familles, jamais plus.                            |
| **Store**              | Où une brique donnée range ses données. Se choisit par un nom (`drizzle`, `redis`…) ou se laisse à `auto`.                              |
| **`auto`**             | La sentinelle par défaut : ne nomme pas un backend, laisse `resolveAutoStore()` le dériver de l'infrastructure et de ce qui est chargé. |
| **Durable / éphémère** | La nature de la donnée. Le durable survit au redémarrage et va en base ; l'éphémère peut vivre en cache.                                |
| **Repli** (_fallback_) | Le backend pris quand le préféré n'est pas enregistré pour cette brique. Toujours **annoncé** dans la raison écrite au journal.         |
| **Provenance**         | D'où vient la valeur retenue : `infra` (dérivée) ou `explicit` (nommée dans la configuration). Elle reste lisible après le boot.        |

## ⚠️ Pièges

- **`memory` n'est pas un choix de production.** Il ne survit pas au redémarrage et n'est pas
  partagé entre pods : deux exemplaires de l'application ne voient pas les mêmes jetons. C'est un
  repli annoncé, jamais une cible.
- **Une case vide de la matrice ne se contourne pas par la configuration.** Nommer
  `audit: { store: "mongoose" }` ne crée pas l'implémentation : le nom est absent du registre, et
  la doctrine d'échec ci-dessus s'applique.
- **Déclarer `NF_REDIS_URL` ne déplace pas le durable.** Le cache ne sert qu'à l'éphémère et aux
  sessions ; les jetons, l'audit et les webhooks restent sur la base — c'est la nature de la donnée
  qui décide, pas la disponibilité du backend.
- **Sans `NF_DATABASE_URL`, une application avec drizzle chargé écrit quand même sur disque**
  (SQLite local). C'est voulu, mais cela surprend qui croyait tourner « en mémoire » : vérifiez la
  raison écrite au boot avant de conclure.
- **Un schéma d'URL inconnu ne dégrade pas, il arrête le boot** (`infra.ts:106`). C'est le seul
  endroit où une erreur de configuration d'infrastructure est fatale — et c'est délibéré.

## 🧪 Tests & couverture

Les chiffres exacts vivent dans la carte de l'aperçu, régénérée depuis vitest — jamais figés ici.

<!-- prettier-ignore -->
| Type | Où | Ce qui est prouvé |
| --- | --- | --- |
| Unitaires (cœur) | `nodefony` `tests/infra.test.ts` | lecture des URL et de leurs alias, schéma inconnu fatal, résolution `auto` par nature de donnée, priorité de `NF_STORE` |
| Unitaires (registres) | `@nodefony/security` `unit/auditStoreRegistry.test.ts`, `unit/tokenStore.test.ts` · `@nodefony/framework` `unit/idempotencyStoreRegistry.test.ts`, `unit/resolverIdempotency.test.ts` | ce que chaque registre accepte, et ce qu'il refuse |
| Intégration | `@nodefony/drizzle` `auto-register.test.ts` | l'inscription automatique des stores au chargement du module |
| E2E (base réelle) | `@nodefony/drizzle` `auto-register-postgres.test.ts`, `auto-register-mysql.test.ts` | la même inscription sur des dialectes réels |

> [!CAUTION]
> Les suites E2E se **skippent** sans leurs variables d'infrastructure, et un skip compte comme
> vert. Source unique des variables : `vitest.gates.ts` à la racine.

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Guides](README.md) · [Toute la documentation](../index.md)
- 🗝️ **Le détail des sessions** (mécanisme d'inversion de contrôle, backend sur mesure) :
  [`session-storage.md`](./session-storage.md)
- ⚙️ **Déclarer tout ça** : [`configuration.md`](./configuration.md) — `defineConfig`, `env.ts`,
  `use()` et le manifeste `modules`.
- 🗃️ **Les modules de persistance** :
  [`@nodefony/drizzle`](../../src/packages/@nodefony/drizzle/docs/index.md) ·
  [`@nodefony/mongoose`](../../src/packages/@nodefony/mongoose/docs/index.md) ·
  [`@nodefony/redis`](../../src/packages/@nodefony/redis/docs/index.md)
- 🐳 **Ce que ça change en conteneur** : [`docker-cloud-native.md`](./docker-cloud-native.md)
- 📖 [Lexique général](../lexique.md) du framework.
