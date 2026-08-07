# Catalogue des scripts — ce que chacun prouve

> Les trente et un scripts de `scripts/`, avec **ce qu'ils prouvent** et comment les lancer. Le corps
> du skill détaille les bancs de charge les plus utilisés ; cette page couvre **tous** les autres,
> qui restaient introuvables autrement qu'en listant le dossier.
>
> **Maintenance** : édition en place. Un script ajouté ici doit apparaître dans une des deux tables,
> sinon `scripts-audit.mjs` le signalera comme non cité.

## Deux familles sous le même toit

Ce skill porte **deux choses différentes**, et il vaut mieux le savoir avant de chercher :

1. **La charge et le dimensionnement** — combien ça tient, combien ça coûte, où ça rompt. C'est le
   sujet annoncé du skill.
2. **Les preuves e2e sans navigateur** — une vingtaine de bancs qui démontrent qu'un mécanisme
   fonctionne bout en bout sur un **vrai serveur** (session, cookies, RBAC, cluster réel). Ils ne
   mesurent rien : ils **prouvent**. Ils vivent ici parce qu'ils exigent le même décor qu'un banc de
   charge — un serveur en marche, parfois plusieurs process, parfois une base réelle.

> Cette cohabitation est un constat, pas une décision : si la famille 2 grossit encore, elle
> mérite son propre skill.

## Comment on lance

```bash
bash .claude/skills/nodefony-load-test/scripts/run.sh <alias>   # 16 scripts ont un alias
node .claude/skills/nodefony-load-test/scripts/<script>.mjs     # les autres, depuis la RACINE du dépôt
```

Le wrapper `run.sh` se place lui-même à la racine du dépôt avant d'exécuter : c'est ce qui évite le
lancement depuis un sous-dossier, qui ferait booter un « projet fantôme ».

## Famille 1 — Charge, mesure, dimensionnement

| Script                    | Alias         | Ce qu'il mesure                                                                                         |
| ------------------------- | ------------- | ------------------------------------------------------------------------------------------------------- |
| `ws-connections.mjs`      | `ws-conn`     | axe 1 : combien de sockets simultanées un process tient, et le coût heap par connexion                  |
| `ws-messages.mjs`         | `ws-msg`      | axe 2 : débit d'écho et fan-out de diffusion                                                            |
| `http-load.mjs`           | `http`        | RPS, latences p50→p99, distribution des codes, sur une route donnée                                     |
| `hub-load.mjs`            | `hub`         | charge de la socket côté hub — fait bouger le panneau « Realtime Hub » et sa sonde                      |
| `supervision-stress.mjs`  | `stress`      | trois voies simultanées (HTTP + WS + base) en rampe, jusqu'à la rupture                                 |
| `capacity.mjs`            | —             | banc de capacité : les constantes d'un pod, pour dimensionner (ne cherche PAS la rupture)               |
| `capacity-html.mjs`       | —             | rend le rapport de capacité (ne contient aucune primitive de rendu : tout vient du skill de rapports)   |
| `bench-ab-mono.sh`        | —             | A/B du coût du pipeline par requête, en production mono-process (CPU-bound, donc lisible)               |
| `bench-report.mjs`        | `report`      | transforme un ou plusieurs résultats de banc en rapport HTML pour un humain qui décide                  |
| `cluster-ipc.mjs`         | `cluster-ipc` | coût réel du fan-out cross-process worker → maître → workers, **avant** Redis                           |
| `log-sink-contention.mjs` | `log-sink`    | microbanc isolé du driver de journal, sans le bruit du RPS HTTP                                         |
| `aimd-demo.mjs`           | `aimd`        | démonstration lisible et déterministe de la cadence adaptative, difficile à observer au navigateur      |
| `boot-bench.mjs`          | —             | temps de démarrage d'un mode, du spawn à l'écoute, et nombre de kernels instanciés                      |
| `boot-profile.mjs`        | —             | le même démarrage, mais **détaillé** : la sortie horodatée jusqu'à l'écoute, pour voir où part le temps |
| `poc-hmr-perf.mjs`        | —             | délai de bout en bout entre le `touch` d'un fichier surveillé et le rechargement Vite                   |
| `poc-bench.mjs`           | —             | latences p50/p95/p99 du back **pendant que Vite compile** — le coût du voisinage en développement       |

## Famille 2 — Preuves e2e sur un vrai serveur, sans navigateur

### Sécurité et anti-abus

| Script                           | Alias             | Ce qu'il prouve                                                                      |
| -------------------------------- | ----------------- | ------------------------------------------------------------------------------------ |
| `ratelimit-e2e.mjs`              | `ratelimit`       | le rate-limit général par IP est bien câblé dans le vrai pipeline HTTP               |
| `ws-conn-cap-e2e.mjs`            | `ws-conn-cap`     | le plafond de connexions WS concurrentes par IP (opt-in) mord réellement             |
| `ws-handshake-ratelimit-e2e.mjs` | `ws-handshake-rl` | le rate-limit s'applique dès la poignée de main WebSocket                            |
| `totp-mfa-e2e.mjs`               | —                 | le second facteur TOTP bout en bout : session, cookies, élévation de privilège       |
| `totp-mfa-attack-e2e.mjs`        | —                 | banc **adversarial** : on attaque l'élévation, chaque défense qui tient est un point |
| `users-admin-factors-e2e.mjs`    | —                 | la remise à zéro administrateur des facteurs forts d'un utilisateur                  |
| `webhooks-dataplane-e2e.mjs`     | —                 | le chemin admin complet des webhooks : HTTP → firewall RBAC → data plane             |

### Idempotence distribuée

| Script                         | Ce qu'il prouve                                                                               |
| ------------------------------ | --------------------------------------------------------------------------------------------- |
| `idempotency-userland-e2e.mjs` | l'anti double-effet en HTTP réel contre un vrai Redis, sur un seul pod                        |
| `idempotency-cluster-e2e.mjs`  | le même, **cross-worker** sur un cluster de deux process — ce qui justifie un store distribué |
| `idempotency-postgres-e2e.mjs` | le même, **cross-pod** sur un PostgreSQL partagé — la preuve que SQLite ne peut pas donner    |

### Cluster et cycle de vie

| Script                            | Alias           | Ce qu'il prouve                                                                   |
| --------------------------------- | --------------- | --------------------------------------------------------------------------------- |
| `cluster-realtime-e2e.mjs`        | `cluster-e2e`   | le temps réel traverse les process d'un cluster Node natif                        |
| `cluster-probe-e2e.mjs`           | `cluster-probe` | la sonde agrégée d'un pod remonte la vue de tous les workers                      |
| `cluster-health-endpoint-e2e.mjs` | —               | la forme JSON exacte que le panneau « Realtime Hub » consomme en mode cluster     |
| `cluster-orm-rich-e2e.mjs`        | —               | le diagnostic ORM d'un worker **précis** (et non au hasard) remonte cross-process |
| `graceful-shutdown-e2e.mjs`       | `graceful`      | le drain complet au SIGTERM — c'est-à-dire un `docker stop` ou une éviction k8s   |

### Plateforme et outillage

| Script                        | Alias        | Ce qu'il prouve                                                                    |
| ----------------------------- | ------------ | ---------------------------------------------------------------------------------- |
| `config-env-override-e2e.mjs` | `config-env` | la surcharge de configuration par variable d'environnement, sur un vrai démarrage  |
| `debug-runtime-e2e.mjs`       | —            | le débogage par module activable à chaud, derrière session et RBAC                 |
| `scaffold-ws-probe.mjs`       | —            | un travail d'échafaudage est bien diffusé sur la socket, étape par étape           |
| `app-download-probe.mjs`      | —            | la variante « téléchargement » de l'échafaudage : l'archive est produite et servie |

## Banc comparatif de frameworks — `bench-frameworks/`

Un décor à part, avec son propre `node_modules` (16 Mo, **non versionné**) : il compare Nodefony à
des serveurs nus pour situer le coût du pipeline. Le résultat de Nodefony vient de
`scripts/bench-ab-mono.sh`, pas d'ici.

| Fichier                    | Rôle                                                                                                                                                                                                                                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bench.sh`                 | orchestre la comparaison des trois cibles et rend le tableau                                                                                                                                                                                                                                               |
| `bare.mjs`                 | serveur `node:http` nu — le plancher absolu, sans routeur ni middleware                                                                                                                                                                                                                                    |
| `express.mjs`              | Express avec sa configuration usuelle                                                                                                                                                                                                                                                                      |
| `express-fair.mjs`         | Express **à parité de fonctionnalités** — c'est celui qui rend la comparaison honnête                                                                                                                                                                                                                      |
| `express-fair-proof.mjs`   | **preuve d'équité** : la cible de banc ne traverse rien de dormant — 1 000 req → 0 Set-Cookie, 0 commit sqlite (`PRAGMA data_version` + counts), profiler 404. À rejouer depuis la RACINE du repo, serveur mono prod au décor du banc lancé au préalable                                                   |
| `fastify.mjs`              | Fastify avec sa configuration usuelle                                                                                                                                                                                                                                                                      |
| `payload.mjs`              | la charge utile commune, pour que les trois répondent exactement la même chose                                                                                                                                                                                                                             |
| `express-drizzle.mjs`      | Express + Drizzle à **parité ORM** avec le banc `NF_BENCH_ORM` (même schéma pg-core via le dist du module test, même version drizzle par résolution racine, même PG). `DRIZZLE_MODE=naive` (build/req, le code idiomatique) ou `prepared` (mémoïsé = le lot du framework). Recoupement croisé d'un A/B ORM |
| `express-fair-drizzle.mjs` | le duel complet : middlewares d'`express-fair` **plus** la même requête Drizzle — l'écart restant face à Nodefony est le vrai surcoût à parité de travail ET d'ORM (mesuré ×1,07)                                                                                                                          |

> Comparer un framework à un serveur nu ne dit presque rien : `express-fair.mjs` existe parce
> qu'une comparaison sans parité de fonctionnalités mesure surtout ce qu'on a oublié de brancher.

## Décor requis par banc e2e — décor manquant ≠ échec

Corollaire de la **RÈGLE N°2** du `SKILL.md` : un banc de la famille 2 « KO » sur un décor
absent n'a rien prouvé de faux — il attend son décor. Trois classes :

**A. Décor OPT-IN** — le banc sort en erreur EN LE DISANT (« relance avec `NF__…` »), à relancer
sur son PROPRE serveur (`<config> bash .claude/skills/nodefony-start-server/start.sh`, puis le banc).
Le décor se pose **entièrement par variables d'env** (override ADR-0006 `NF__<MODULE>__<CHEMIN>`,
appliqué au boot avant le Zod du module) : aucun fichier de config à éditer, donc aucun revert à
oublier avant un commit. Les deux bancs rate-limit demandent des plafonds DIFFÉRENTS → un serveur
chacun, jamais le même :

| Banc                         | À relancer avec                                                                                                                                                                        |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ratelimit-e2e`              | `NF__HTTP__RATELIMIT__ENABLED=true NF__HTTP__RATELIMIT__MAX=5 NF__HTTP__RATELIMIT__WINDOWS=5`                                                                                          |
| `ws-handshake-ratelimit-e2e` | `NF__HTTP__RATELIMIT__ENABLED=true NF__HTTP__RATELIMIT__MAX=15 NF__HTTP__RATELIMIT__WINDOWS=30`                                                                                        |
| `ws-conn-cap-e2e`            | `NF__HTTP__WSMAXCONNECTIONSPERIP=3`                                                                                                                                                    |
| `webhooks-dataplane-e2e`     | `NF__SECURITY__WEBHOOKS__DENYPRIVATEIPS=true` (anti-SSRF strict) — sinon le sous-test « create SSRF → 422 » obtient **201** (le dev autorise le réseau privé, `169.254.169.254` passe) |

**B. Autonomes** (forkent leur propre serveur → 0 serveur dev requis, mais `npm run build` d'abord) :
`cluster-*`, `idempotency-postgres`, `config-env-override`, `graceful-shutdown`.

> ⚠️ `idempotency-cluster` **n'est PAS autonome** malgré son nom : il interroge le serveur de
> développement et tombe en `ECONNREFUSED` sur 5152 sans lui — constaté en l'exécutant. Sa place
> est en **classe C**. Le classement d'un banc se vérifie en le LANÇANT : lu dans ce tableau, il
> a fait échouer un lot entier qui n'avait pourtant rien de faux à dire.

**C. Serveur dev standard** (décor par défaut) : `totp-mfa`, `totp-mfa-attack`,
`users-admin-factors`, `idempotency-userland` (+ `REDIS_URL`), `debug-runtime`.

> ⚠️ **Ne jamais lancer B (destructeurs `graceful-shutdown` / `cluster-*`) dans le même lot que C** :
> ils tuent ou prennent les ports du serveur dev → les bancs C suivants tombent en `ECONNREFUSED`
> (faux « KO »). Isoler les destructeurs, ou relancer le serveur après.

## Variables communes

Les bancs de la famille 2 partagent un décor : un serveur en marche, et pour certains une session
authentifiée. `SETTLE` règle le temps d'installation avant mesure, `E2E_ROLE` distingue le process
parent du process forké dans les bancs cluster. Les bancs de charge prennent leur cible par
`WS_URL` / `URL` / `HOST` / `PORT`, et leur intensité par `N`, `C`, `CAP`, `STEP`, `BATCH`.

Le détail par script figure dans sa fiche générée : `docs/skills/nodefony-load-test.md` liste, pour
chacun, ses options et **toutes** les variables qu'il lit — extraites de son source, donc à jour.
