---
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
status: stable
last-updated: 2026-07-05
related: project_config_clarity_chantier_kit, project_resilience_no_silent_degradation
---

# Guide — Persistance & stores (infra déclarée)

> Où Nodefony range ses données durables — utilisateurs, jetons, passkeys, audit, webhooks,
> idempotence, sessions — **sans configurer onze briques une par une**. Tu déclares ton
> **infra** (une ou deux URLs), le framework **dérive** où va chaque brique.

## L'idée en une phrase

**Tu déclares ton infra, le framework choisit les stores.** Comme Rails/Django : une
`DATABASE_URL` suffit à câbler tout le durable ; ajoute une `REDIS_URL` et le partagé
inter-process suit. Zéro réglage brique par brique tant que les défauts te conviennent.

## Déclarer l'infra

Trois familles d'infra, déclarées par **URL** (le scheme décide du backend) :

| Variable                                 | Infra                        | Exemples de valeur                                                   |
| ---------------------------------------- | ---------------------------- | -------------------------------------------------------------------- |
| `NF_DATABASE_URL` (alias `DATABASE_URL`) | **durable** (base)           | `sqlite:./var/app.db` · `postgres://…` · `mysql://…` · `mongodb://…` |
| `NF_REDIS_URL` (alias `REDIS_URL`)       | **cache** (éphémère partagé) | `redis://localhost:6379` — sa présence **charge** `@nodefony/redis`  |
| `NF_LOKI_URL` / `NF_OPENSEARCH_URL`      | **logs** (relecture)         | `http://loki:3100` · `https://opensearch:9200`                       |

Les alias plateforme (`DATABASE_URL`, `REDIS_URL`) sont acceptés out-of-the-box (Heroku,
Railway…). Le **scheme** de `NF_DATABASE_URL` déduit le dialecte : `sqlite:`→SQLite,
`postgres://`→PostgreSQL, `mysql://`→MySQL, `mongodb://`→MongoDB. Un scheme inconnu **échoue
au boot** (jamais de choix silencieux).

## Les trois profils

| Profil      | Infra déclarée                     | Ce que ça donne                                                        |
| ----------- | ---------------------------------- | ---------------------------------------------------------------------- |
| **solo**    | aucune URL                         | SQLite + `memory` + `files` — dev / petit déploiement mono-process     |
| **serveur** | `NF_DATABASE_URL`                  | tout le durable sur la base déclarée                                   |
| **cluster** | `NF_DATABASE_URL` + `NF_REDIS_URL` | durable sur la base, éphémère + sessions sur Redis (partagé inter-pod) |

## `store: "auto"` — comment le framework choisit

Chaque brique a `store: "auto"` **par défaut**. La résolution (`resolveAutoStore`) suit la
nature de la donnée :

- **durable** (users, tokens, passkeys, webhooks, audit) → l'infra `database` si déclarée,
  sinon le repli de la brique ;
- **éphémère** (idempotence) → l'infra `cache` si déclarée, sinon `database`, sinon `memory` ;
- **session** → `redis` > `database` > `files` ;
- **logs** (relecture) → driver dérivé de l'URL (`loki`/`opensearch`), le sink d'écriture
  restant `stdout` (cloud-native).

Le choix retenu **et sa provenance** (défaut-infra / surcharge / env) sont **loggés au boot**
par chaque consommateur — jamais de résolution opaque.

## Matrice brique × backend

`✅` = sélectionnable par son nom · `—` = non applicable. La colonne « Défaut » = la valeur
`auto` **sans infra déclarée** (le repli) ; dès qu'une infra `database` est déclarée, les
briques durables basculent dessus.

| Brique               | Défaut (repli sans infra) | memory | file | drizzle | mongoose | redis |
| -------------------- | ------------------------- | :----: | :--: | :-----: | :------: | :---: |
| Session              | `files`                   |   —    |  ✅  |   ✅    |    ✅    |  ✅   |
| Utilisateurs         | `drizzle`                 |   ✅   |  —   |   ✅    |    —     |   —   |
| Jetons (refresh JWT) | `memory`                  |   ✅   |  ✅  |   ✅    |    ✅    |  ✅   |
| Passkeys (WebAuthn)  | `memory`                  |   ✅   |  ✅  |   ✅    |    ✅    |  ✅   |
| TOTP (2FA)           | `memory`                  |   ✅   |  ✅  |    —    |    —     |   —   |
| Audit                | `memory`                  |   ✅   |  —   |   ✅    |    —     |   —   |
| Webhooks             | `memory`                  |   ✅   |  —   |   ✅    |    ✅    |   —   |
| Idempotence          | `memory`                  |   ✅   |  —   |   ✅    |    —     |  ✅   |

> **Couverture partielle assumée** : tous les backends ne portent pas toutes les briques
> (ex. audit/idempotence ne sont pas encore sur MongoDB). Quand `auto` tombe sur une brique
> non portée par l'infra déclarée, le **repli est annoncé** dans la raison loggée — jamais
> silencieux. La progression des cases vides est suivie hors release (backlog 10.x).

## Audit ≠ logs

Deux chemins distincts, à ne pas confondre :

- **Audit** = journal de **conformité durable** (qui a fait quoi : login, révocation, accès
  refusé…). Va dans la **base** (`database`), append-only, protégé par RBAC. C'est une
  **donnée**, pas de la télémétrie.
- **Logs** = **télémétrie** (débit de requêtes, erreurs, traces). Va sur **stdout** →
  collecteur centralisé (Loki/OpenSearch pour la relecture). Volatile par nature.

Un événement d'audit **ne doit jamais** finir uniquement dans les logs, et une trace de debug
n'a rien à faire dans le store d'audit.

## Doctrine d'échec — jamais de dégradation silencieuse

Nodefony **fail-loud** sur la dégradation, **fail-soft** sur la disponibilité (cf
[résilience sans dégradation silencieuse](../../CLAUDE.md)) :

- un `store` **explicite** introuvable (ex. `store: "redis"` sans adapter chargé) →
  **production : le boot avorte** (pas de dédup/persistance silencieusement absente en
  cluster) ; **dev : dégradation ANNONCÉE** (WARNING nommant le repli — session→`files`,
  ou brique désactivée) ;
- une **brique durable** résolue en `memory` **en production** (auto ou explicite) →
  **WARNING nommant l'impact** (jetons/passkeys/audit/webhooks/idempotence perdus au
  redémarrage, pas de partage inter-pod).

Le principe : toute dégradation est **visible** (log + Studio), jamais subie en silence.

## Forcer un store (exception d'expert)

L'`auto` couvre l'immense majorité des cas. Pour épingler une brique à un backend précis,
donne un nom explicite dans la config du module — il **gagne** sur l'`auto`, et sa provenance
reste visible dans Studio :

```ts
// nodefony.config.ts
use("@nodefony/security", {
  tokenStore: { store: "redis" }, // jetons sur Redis même si la base est PostgreSQL
  audit: { store: "drizzle" }, // audit sur la base SQL
});
```

## Liens

- [`session-storage.md`](./session-storage.md) — détail du mécanisme IoC des sessions + storage sur mesure
- [`configuration.md`](./configuration.md) — `defineConfig` / `env.ts` / `use()` / manifeste `modules`
- Docs modules : [`@nodefony/drizzle`](../../src/packages/@nodefony/drizzle/docs/) ·
  [`@nodefony/mongoose`](../../src/packages/@nodefony/mongoose/docs/) ·
  [`@nodefony/redis`](../../src/packages/@nodefony/redis/docs/)
