# <%= it.appName %>

Application [Nodefony](https://github.com/nodefony/nodefony-core) — générée par `nodefony create app`.

<% if (it.complete) { %>Cette app n'est pas un « hello world » : c'est le **framework complet, câblé et
prouvé** — HTTP + WebSocket dans le même controller, ORM avec persistance
out-of-the-box, firewall applicatif, temps réel, console d'administration,
tests, lint, infra docker. Chaque fichier est commenté : lis-les, ils expliquent
le POURQUOI, pas juste le quoi.
<% } else { %>App **minimale** : le socle serveur (`@nodefony/http`) + le router et les
controllers (`@nodefony/framework`)<% if (it.front) { %> + le frontend <%= it.frontend %> servi par Vite<% } %> — la
base saine, à faire grandir. Pour la vitrine complète (ORM, firewall, realtime,
Studio, infra docker) : régénère avec `--preset complete`.
<% } %>
---

## 1. Démarrage express (60 secondes)

```bash
npm install
npm run build        # bundle rolldown → dist/
npm run dev          # serveur de développement
```

Puis :

- http://127.0.0.1:5151/api/hello — ta première route
<% if (it.front) { %>- http://127.0.0.1:5151/ — ton app <%= it.frontend %> (HMR Vite en dev)
<% } %><% if (it.complete) { %>- http://127.0.0.1:5151/nodefony — **Studio**, la console d'administration (dev)

> L'app **persiste déjà** : sans aucune base déclarée, l'ORM Drizzle crée une
> sqlite locale (`var/databases/`) — users, sessions et jetons y survivent aux
> redémarrages. Aucun service externe requis pour commencer.
<% } %>
## 2. Visite guidée — ce que l'app démontre

- **Route HTTP** — `curl http://127.0.0.1:5151/api/hello`
- **WebSocket, _même controller_** — `npx wscat -c ws://127.0.0.1:5151/api/echo` puis tape un message
<% if (it.front) { %>- **Frontend <%= it.frontend %> (Vite + HMR)** — http://127.0.0.1:5151/ — l'app fetch le backend via `/api`
<% } %><% if (it.complete) { %>- **Studio (console admin, dev)** — http://127.0.0.1:5151/nodefony — config, sessions, logs, routes
- **ORM + persistance** — Drizzle : sans `NF_DATABASE_URL`, sqlite locale automatique
- **Firewall + audit** — chaque requête traverse le pipeline sécurité (logs `audit`)
- **Temps réel — socket Nodefony** — `nodefony/controllers/LiveController.ts` : canal `live:events` (alimenté par `live:dire`, jamais par une horloge) + RPC `live:ping`<% if (it.front) { %> — la carte « Temps réel » de la page d'accueil le consomme par la façade client<% } %>
- **Redis (opt-in)** — `NF_REDIS_URL` présente ⇔ module chargé, stores basculent dessus
<% } %>- **Probes cloud-native** — `curl http://127.0.0.1:5151/livez` (liveness k8s)

Le différenciateur Nodefony tient dans `nodefony/controllers/HelloController.ts` :
**une route GET et une route WEBSOCKET dans la même classe** — même pipeline,
pas deux mondes séparés.

## 3. Structure du projet

- `nodefony.config.ts` — LA config de l'app : uniquement les ÉCARTS aux défauts du framework
- `env.ts` — catalogue **typé** des variables d'environnement (seul lecteur de `process.env`, validé au boot)
- `index.ts` — point d'entrée : la classe `App` (module racine) + ses controllers<% if (it.front) { %> + l'entry frontend (`registerEntry`)<% } %>
- `nodefony/controllers/` — tes controllers (`@controller` + `@route`, HTTP **et** WS)
<% if (it.front) { %>- `frontend/src/` — ton app <%= it.frontend %>, servie par Vite (HMR dev, build prod)
<% } %>- `tests/` — tests vitest : unitaires (`npm test`) + e2e réel (`npm run test:e2e`)
- `AGENTS.md` — instructions pour un agent IA, 100 % généré (régénéré par `create`) ; tes notes vivent dans sa zone préservée
<% if (it.complete) { %>- `compose.yaml` — infra de dev docker : Redis<% if (it.db) { %>, <%= it.db.label %><% } %>, Loki/Grafana (profil)
<% } %>- `rolldown.config.ts` — build : 3 lignes, délègue tout au socle publié `nodefony/bundler`
- `.oxlintrc.json` — lint non-intrusif (warn) ; le style est délégué à Prettier
- `vitest.config.ts` — tests unitaires ; porte le bloc `oxc` décorateurs (OBLIGATOIRE, commenté)
- `vitest.e2e.config.ts` — tests e2e, config séparée : `npm test` ne montre que ce qu'il exécute
- `var/` — données locales (sqlite, logs fichiers), gitignoré
<% if (it.complete) { %>
## 4. Infra de développement (docker)

<% if (it.db) { %>Tu as retenu **<%= it.db.label %>** à la création : le `compose.yaml` ne porte que
ce service (plus Redis), et `.env` déclare déjà `NF_DATABASE_URL` dessus. Lance
l'infra **avant** l'app :

```bash
npm run infra:up     # docker : Redis + <%= it.db.label %> (le compose ne porte qu'eux)
npm run dev
npm run infra:down   # arrêt (les volumes survivent)
```

Redis n'est utilisé que si `NF_REDIS_URL` est déclarée — sinon l'app reste en
mémoire de process, ce qui suffit tant qu'elle tourne en un seul exemplaire :

```bash
NF_REDIS_URL="redis://:<%= it.appName %>-dev@127.0.0.1:6379"   # dans .env
```

Repasser en **sqlite locale** : commente `NF_DATABASE_URL` dans `.env`, rien
d'autre. Le dialecte SQL est déduit du **scheme de l'URL** (`postgres://`,
`mysql://`, `sqlite:`) — changer de base ne change **rien d'autre** dans l'app.
Les mots de passe par défaut du compose sont publics, pour le dev local uniquement.
<% } else { %>L'app démarre **sans docker** : la base est une **sqlite locale** (`var/databases/`),
retenue à la création. Le `compose.yaml` fournit le cran au-dessus :

```bash
npm run infra:up                          # Redis (sessions partagées, realtime multi-process)
docker compose --profile loki up -d       # + Loki + Grafana (logs centralisés)
npm run infra:down                        # arrêt (les volumes survivent)
```

Câblage côté app — une variable, tout le reste se dérive (`store: "auto"`) :

```bash
NF_REDIS_URL="redis://:<%= it.appName %>-dev@127.0.0.1:6379"   # dans .env
```

Pour passer sur une vraie base SQL : déclare `NF_DATABASE_URL`. Le dialecte est
déduit du **scheme de l'URL** (`postgres://`, `mysql://`, `sqlite:`) — changer de
base ne change **rien d'autre** dans l'app. Le service docker correspondant n'est
pas dans ce `compose.yaml` (une app y retient un seul dialecte) : ajoute-le, ou
recrée une app avec `nodefony create app <nom> --database postgres`.
<% } %><% } %>
## 5. Tests — `npm test` est ton PREMIER diagnostic

```bash
npm test             # unitaires : l'app se CHARGE (imports, décorateurs, config) — < 1 s
npm run test:e2e     # build + boot RÉEL (production --detach --wait) + HTTP + WS + probes
```

**Réflexe** : quelque chose semble cassé → `npm test` AVANT de relire du code ou
de redémarrer. En une seconde il prouve que l'app s'importe, que les décorateurs
compilent et que la config valide — ou te donne le fichier exact qui casse.

Le rapport est **franc** : les e2e ont leur propre config (`vitest.e2e.config.ts`),
`npm test` n'affiche jamais de tests « skipped » qui semblent verts sans avoir
rien prouvé. Le test e2e utilise le lancement détaché natif du framework :
`--wait` ne rend la main que quand la readiness est sondée (aucun `sleep`
arbitraire), et `nodefony stop` arrête proprement. Le client WebSocket est le
`WebSocket` **natif** de Node — zéro dépendance de test.

## 6. Qualité du code

```bash
npm run typecheck    # tsgo — le bundler ne type-check PAS : gate séparé, obligatoire
npm run check        # cohérence du projet : config, modules déclarés, wiring
npm run lint         # oxlint — garde-fous en warn, non-intrusif
npm run format       # prettier — le style, c'est lui qui décide
```

Le lint et le typecheck sont **deux gates distincts**, et c'est volontaire :
`tsgo` juge les TYPES, `oxlint` juge tout ce qu'un type ne dit pas — code mort,
promesse mal formée, import Node sans son préfixe. Aucun des deux ne remplace
l'autre.

`oxlint` s'appuie sur le même analyseur que le bundler (`rolldown`) : un seul
lecteur de ta syntaxe, donc aucun risque que l'un accepte ce que l'autre refuse.
Il n'a **pas** besoin du paquet `typescript` — celui-ci ne reste dans les
dépendances que pour ton éditeur.

Les règles sont dans `.oxlintrc.json`, commentées par leur intention. Deux
familles ne pardonnent pas : le code mort (il finit par mentir) et le préfixe
`node:` sur les modules du runtime (sans lui, un paquet npm homonyme peut prendre
la place d'un module natif). Le reste avertit sans bloquer.

## 7. Quand ça casse (troubleshooting)

Dans l'ordre — chaque étape isole un étage, du moins cher au plus cher :

1. **`npm test`** — l'app se charge-t-elle ? Import cassé, décorateur, config
   invalide : le fichier fautif est nommé.
2. **`npm run typecheck`** — un vert vitest ne type-check RIEN (les types sont
   effacés à la transpilation) ; `tsgo` attrape ce que le build laisse passer.
3. **`npx nodefony status`** — un serveur tourne-t-il déjà ? (port occupé,
   vieux process détaché). `npx nodefony stop` arrête proprement. Si le port est
   tenu par une AUTRE application Nodefony, `status` la nomme :
   `npx nodefony stop <nom>` l'arrête sans changer de dossier.
4. **Rebuild** — comportement fantôme après un gros changement : `npm run build`
   puis relance (le serveur charge `dist/`, pas tes sources).

## 8. Production (cloud-native)

```bash
npm run build        # backend (rolldown)<% if (it.front) { %> + frontend (vite → public/dist, fingerprinté)<% } %>
npm start            # nodefony production — bind 0.0.0.0, logs stdout, probes /livez /readyz
```
<% if (it.front) { %>
> Le front de production est un build Vite figé (`public/dist/`), servi en
> statics par Nodefony — `npm run build` le produit (il chaîne
> `nodefony frontend:build`). Si tu lances `npm start` sans build, le boot le
> construit une fois pour toi quand Vite est installé (poste de dev) et le DIT
> dans les logs ; dans une image de production sans devDependencies, builde à
> l'image — sinon la page est servie sans interface et le boot le signale en
> ERROR.
<% } %>
### Image de container

`Dockerfile` et `.dockerignore` sont générés avec l'app ; la doctrine y est
commentée ligne à ligne (multi-stage, `USER node`, sonde sur `/readyz`, forme
exec du `CMD`).

```bash
docker build -t <%= it.appName %> .
docker run -p 5151:5151 <%= it.appName %>
docker stop -t 20 <container>   # SIGTERM → drain → exit 0
```

> ⚠️ **La période de grâce doit rester au-dessus de `shutdownDeadline`** (15 s
> par défaut) : `docker stop` n'attend que 10 s sans `-t`, et k8s 30 s. En
> dessous, le drain est coupé par un SIGKILL et les requêtes en vol meurent —
> sans erreur ni trace, à chaque déploiement.

Un process Node = un pod/container ; le scaling horizontal vient de
l'orchestrateur (k8s, Swarm, Cloud Run…).<% if (it.complete) { %> Studio est chargé en dev seulement
(`policy: "dev"`) — pour l'exposer en production, protège `/nodefony` par une
zone firewall puis passe la policy à `"mandatory"` (la recette est commentée
dans `nodefony.config.ts`).<% } %>

## 9. Développer le framework lui-même (`--link`)

Si cette app a été générée avec `--link`, les dépendances `nodefony`/`@nodefony/*`
pointent en `file:` vers un checkout local de `nodefony-core` : tu modifies le
framework, tu rebuilds le checkout, ton app le voit. Ne publie pas ce
`package.json` tel quel — après la release npm, régénère sans `--link`
(versions `^<%= it.nodefonyVersion %>`).

## 10. Aller plus loin

- **Ajouter une route** : une méthode décorée `@route` dans un controller — c'est tout.
- **Régénérer autrement** : `nodefony create app` (interactif) ou
  `--preset <complete|minimal> --frontend <none|react|vue|angular|svelte>`
  `--database <sqlite|postgres|mariadb|mysql>` (scriptable).
<% if (it.complete) { %>- **Protéger une zone** : `use("@nodefony/security", { firewalls: { … } })` dans
  `nodefony.config.ts` (validée Zod au boot, config invalide = échec franc).
- **Canaux temps réel** : le module realtime multiplexe N canaux duplex sur une
  seule socket — voir la doc du framework.
- **Studio** est ta carte du territoire : modules chargés, routes, config
  résolue, sessions, logs — tout ce que le framework sait, il te le montre.
<% } %>