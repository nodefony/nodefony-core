# {{appName}}

Application [Nodefony](https://github.com/nodefony/nodefony-core) — générée par `nodefony create app`.

Cette app n'est pas un « hello world » : c'est le **framework complet, câblé et
prouvé** — HTTP + WebSocket dans le même controller, ORM avec persistance
out-of-the-box, firewall applicatif, temps réel, console d'administration,
tests, lint, infra docker. Chaque fichier est commenté : lis-les, ils expliquent
le POURQUOI, pas juste le quoi.

---

## 1. Démarrage express (60 secondes)

```bash
npm install
npm run build        # bundle rolldown → dist/
npm run dev          # serveur de développement
```

Puis :

- http://127.0.0.1:5151/api/hello — ta première route
- http://127.0.0.1:5151/nodefony — **Studio**, la console d'administration (dev)

> L'app **persiste déjà** : sans aucune base déclarée, l'ORM Drizzle crée une
> sqlite locale (`var/databases/`) — users, sessions et jetons y survivent aux
> redémarrages. Aucun service externe requis pour commencer.

## 2. Visite guidée — ce que l'app démontre

| Quoi                            | Comment le voir                                                    |
| ------------------------------- | ------------------------------------------------------------------ |
| Route HTTP                      | `curl http://127.0.0.1:5151/api/hello`                             |
| WebSocket — **même controller** | `npx wscat -c ws://127.0.0.1:5151/api/echo` puis tape un message   |
| Studio (console admin, dev)     | http://127.0.0.1:5151/nodefony — config, sessions, logs, routes    |
| ORM + persistance               | Drizzle : sans `NF_DATABASE_URL`, sqlite locale automatique        |
| Firewall + audit                | chaque requête traverse le pipeline sécurité (logs `audit`)        |
| Realtime (canaux multiplexés)   | `@nodefony/realtime` chargé (backplane cluster, zéro dépendance)   |
| Probes cloud-native             | `curl http://127.0.0.1:5151/livez` (liveness k8s)                  |
| Redis (opt-in)                  | `NF_REDIS_URL` présente ⇔ module chargé, stores basculent dessus   |

Le différenciateur Nodefony tient dans `nodefony/controllers/HelloController.ts` :
**une route GET et une route WEBSOCKET dans la même classe** — même pipeline
(firewall, audit, logs), pas deux mondes séparés.

## 3. Structure du projet

| Fichier / dossier          | Rôle                                                                       |
| -------------------------- | --------------------------------------------------------------------------- |
| `nodefony.config.ts`       | LA config de l'app — uniquement les ÉCARTS aux défauts du framework         |
| `env.ts`                   | Catalogue **typé** des variables d'environnement (seul lecteur de `process.env`, validé au boot) |
| `index.ts`                 | Point d'entrée : la classe `App` (module racine) + ses controllers          |
| `nodefony/controllers/`    | Tes controllers (`@controller` + `@route`, HTTP **et** WS)                  |
| `tests/`                   | Tests vitest — unitaires (`npm test`) + e2e réel (`npm run test:e2e`)       |
| `compose.yaml`             | Infra de dev docker : Redis, Postgres, MariaDB, MySQL, Loki/Grafana (profils) |
| `rolldown.config.ts`       | Build — 3 lignes, délègue tout au socle publié `nodefony/bundler`           |
| `eslint.config.mjs`        | Lint non-intrusif (warn) ; le style est délégué à Prettier                  |
| `vitest.config.ts`         | Config tests — porte le bloc `oxc` décorateurs (OBLIGATOIRE, commenté)      |
| `var/`                     | Données locales (sqlite, logs fichiers) — gitignoré                         |

## 4. Infra de développement (docker)

L'app démarre **sans docker** (sqlite locale). Le `compose.yaml` fournit l'infra
du cran au-dessus, par **profils** — rien ne tourne « au cas où » :

```bash
npm run infra:up                          # Redis seul (sessions partagées, realtime multi-process)
docker compose --profile postgres up -d   # + PostgreSQL
docker compose --profile loki up -d       # + Loki + Grafana (logs centralisés)
npm run infra:down                        # arrêt (les volumes survivent)
```

Câblage côté app — deux variables, tout le reste se dérive (`store: "auto"`) :

```bash
export NF_REDIS_URL="redis://:{{appName}}-dev@127.0.0.1:6379"
export NF_DATABASE_URL="postgres://{{appName}}:{{appName}}-dev@127.0.0.1:5432/{{appName}}"
npm run dev
```

Le dialecte SQL est déduit du **scheme de l'URL** (`postgres://`, `mysql://`,
`sqlite:`) — changer de base ne change **rien d'autre** dans l'app. Les mots de
passe par défaut du compose sont publics, pour le dev local uniquement.

## 5. Tests

```bash
npm test             # unitaires : l'app se CHARGE (imports, décorateurs, config) — < 1 s
npm run test:e2e     # build + boot RÉEL (production --detach --wait) + HTTP + WS + probes
```

Le test e2e utilise le lancement détaché natif du framework : `--wait` ne rend
la main que quand la readiness est sondée (aucun `sleep` arbitraire), et
`nodefony stop` arrête proprement. Le client WebSocket est le `WebSocket`
**natif** de Node — zéro dépendance de test.

## 6. Qualité du code

```bash
npm run typecheck    # tsgo — le compilateur TypeScript porté en Go (rapide)
npm run lint         # eslint — garde-fous en warn, non-intrusif
npm run format       # prettier — le style, c'est lui qui décide
```

Pourquoi **deux** TypeScript dans les devDependencies ? `@typescript/native-preview`
fournit `tsgo` (typecheck, rapide) ; `typescript@6` fournit l'**API JS** dont
eslint a besoin pour parser tes fichiers. Deux outils, deux rôles.

## 7. Production (cloud-native)

```bash
npm run build
npm start            # nodefony production — bind 0.0.0.0, logs stdout, probes /livez /readyz
```

Un process Node = un pod/container ; le scaling horizontal vient de
l'orchestrateur (k8s, Swarm, Cloud Run…). Studio est chargé en dev seulement
(`policy: "dev"`) — pour l'exposer en production, protège `/nodefony` par une
zone firewall puis passe la policy à `"mandatory"` (la recette est commentée
dans `nodefony.config.ts`).

## 8. Développer le framework lui-même (`--link`)

Cette app a peut-être été générée avec `nodefony create app <nom> --link` :
les dépendances `nodefony`/`@nodefony/*` pointent alors en `file:` vers un
checkout local de `nodefony-core` (elles ne sont pas encore sur npm). C'est le
mode **développement du framework** : tu modifies le framework, tu rebuilds le
checkout, ton app le voit. Ne publie pas ce `package.json` tel quel — après la
release npm, régénère sans `--link` (versions `^{{nodefonyVersion}}`).

## 9. Aller plus loin

- **Ajouter une route** : une méthode décorée `@route` dans un controller — c'est tout.
- **Protéger une zone** : `use("@nodefony/security", { firewalls: { … } })` dans
  `nodefony.config.ts` (validée Zod au boot, config invalide = échec franc).
- **Canaux temps réel** : le module realtime multiplexe N canaux duplex sur une
  seule socket — voir la doc du framework.
- **Studio** est ta carte du territoire : modules chargés, routes, config
  résolue, sessions, logs — tout ce que le framework sait, il te le montre.
