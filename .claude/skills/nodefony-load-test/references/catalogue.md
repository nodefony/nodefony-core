# Catalogue des scripts — ce que chacun prouve

> Les scripts de `scripts/`, avec **ce qu'ils prouvent** et comment les lancer. Le corps
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

| Script                    | Alias         | Ce qu'il mesure                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ws-connections.mjs`      | `ws-conn`     | axe 1 : combien de sockets simultanées un process tient, et le coût heap par connexion                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `ws-messages.mjs`         | `ws-msg`      | axe 2 : débit d'écho et fan-out de diffusion                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `http-load.mjs`           | `http`        | RPS, latences p50→p99, distribution des codes, sur une route donnée                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `hub-load.mjs`            | `hub`         | charge de la socket côté hub — fait bouger le panneau « Realtime Hub » et sa sonde                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `supervision-stress.mjs`  | `stress`      | trois voies simultanées (HTTP + WS + base) en rampe, jusqu'à la rupture                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `capacity.mjs`            | —             | banc de capacité : les constantes d'un pod, pour dimensionner (ne cherche PAS la rupture)                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `ws-tls-batching.mjs`     | —             | serveur `ws` NU, clair contre TLS en paires alternées : messages par lecture et µs de boucle par message — explique pourquoi l'écho de `capacity.mjs` sort plus vite en TLS (5 o : ~7 msg/lecture contre ~2,5) et le prouve réversible (`WS_BATCH_PAYLOAD=4096`)                                                                                                                                                                                                                                                   |
| `capacity-html.mjs`       | —             | rend le rapport de capacité (ne contient aucune primitive de rendu : tout vient du skill de rapports)                                                                                                                                                                                                                                                                                                                                                                                                              |
| `bench-ab-mono.sh`        | —             | A/B du coût du pipeline par requête, en production mono-process (CPU-bound, donc lisible)                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `bench-report.mjs`        | `report`      | transforme un ou plusieurs résultats de banc en rapport HTML pour un humain qui décide                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `soak.mjs`                | —             | TENUE DANS LA DURÉE : trafic continu, pente du heap et dérive du débit — ce qu'un run de 10 s ne voit pas                                                                                                                                                                                                                                                                                                                                                                                                          |
| `perf-campaign.sh`        | —             | CAMPAGNE PUBLIABLE sans surveillance (`--at HH:MM`, sous `caffeinate`) : garde de PARITÉ des 4 témoins équitables (abandon sinon), paires de route triviale + `nest-fair` + test nul, banc ORM face à Express ET NestJS (GET, POST 200, POST 422, test nul ; 25 conn, 60 s, thermique 20, seed recopié par paire), CPU du fil (`wait-compare`), soak — chaque essai rangé, une paire refusée pour dispersion rejouée. `--only "étape…"` refait une pièce manquante sans rejouer la nuit                            |
| `perf-compose.mjs`        | —             | COMPOSE `docs/performance/data/<version>.json` depuis le dossier d'une campagne : séries BRUTES fusionnées (méd = moyenne des médianes de série), dernier essai conclusif de chaque paire, provenance lue dans `campaign.log` (HEAD, Node, arbre sale, HEAD bougé pendant la nuit), `wait-analyze` relancé pour `cpuThread`. `--reuse <étape>=<dossier>` (séries + `meta.json`) : une pièce d'une autre séance garde SON commit. Aperçu par défaut, `--write` refuse s'il manque une pièce. Ne touche pas au récit |
| `cluster-ipc.mjs`         | `cluster-ipc` | coût réel du fan-out cross-process worker → maître → workers, **avant** Redis                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `log-sink-contention.mjs` | `log-sink`    | microbanc isolé du driver de journal, sans le bruit du RPS HTTP                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `aimd-demo.mjs`           | `aimd`        | démonstration lisible et déterministe de la cadence adaptative, difficile à observer au navigateur                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `route-scan-cost.mjs`     | —             | combien de `Route.match` chaque requête paie, ce que ce scan coûte, et comment il grandit à N routes                                                                                                                                                                                                                                                                                                                                                                                                               |
| `db-backend-cost.mjs`     | —             | ce qu'un pilote de base coûte au serveur : latence, blocage de la boucle, et ce qui plafonne vraiment                                                                                                                                                                                                                                                                                                                                                                                                              |
| `profile-compare.sh`      | —             | **« comparé à quoi ? »** — profils `--cpu-prof` de Nodefony et du témoin `nest-fair`, écart poste par poste en µs/req (`profile-cpu.sh`, `profile-analyze.mjs`, `profile-compare.mjs`)                                                                                                                                                                                                                                                                                                                             |
| `wait-compare.sh`         | —             | **ce que le profil ne voit pas** — occupation de la boucle, CPU du FIL principal contre process, GC, tours libuv, écritures socket, changements de contexte, en µs/req, Nodefony contre un témoin en paires alternées (`wait-probe.mjs` préchargé, `wait-analyze.mjs`) — § dédié plus bas                                                                                                                                                                                                                          |
| `native-sample.mjs`       | —             | relit une capture `sample` (macOS) : temps PROPRE du fil principal par famille native (JIT, builtins, chaînes, runtime V8, noyau, parseur HTTP, GC) et par frame, en µs/req — seul ou en écart A − B                                                                                                                                                                                                                                                                                                               |
| `promise-sites.mjs`       | —             | OÙ naissent les Promises d'UNE requête : préchargé (`node --import`), rend la pile de chaque création — compte « Promises + `await` », à comparer au témoin mesuré pareil (garde : `promise-budget.test.ts`)                                                                                                                                                                                                                                                                                                       |
| `promise-map.mjs`         | —             | le PILOTE de `promise-sites.mjs` : app de secours `production` (ports 5396-5398, cohabite avec le dev), chauffe, puis la pile de chaque Promise d'UNE requête — GET ou `--method POST --body '<json>'`, décor par `KEY=VAL` (`NF_BENCH_ORM=1 NF_WITH_DEV_MODULES=1`) ; exit 1 si la cible répond ≥ 400                                                                                                                                                                                                             |
| `boot-bench.mjs`          | —             | temps de démarrage d'un mode, du spawn à l'écoute, et nombre de kernels instanciés                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `boot-profile.mjs`        | —             | le même démarrage, mais **détaillé** : la sortie horodatée jusqu'à l'écoute, pour voir où part le temps                                                                                                                                                                                                                                                                                                                                                                                                            |
| `poc-hmr-perf.mjs`        | —             | délai de bout en bout entre le `touch` d'un fichier surveillé et le rechargement Vite                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `poc-bench.mjs`           | —             | latences p50/p95/p99 du back **pendant que Vite compile** — le coût du voisinage en développement                                                                                                                                                                                                                                                                                                                                                                                                                  |

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

<!-- prettier-ignore -->
| Fichier | Rôle |
| --- | --- |
| `bench.sh` | orchestre la comparaison des trois cibles et rend le tableau |
| `bare.mjs` | serveur `node:http` nu — le plancher absolu, sans routeur ni middleware |
| `express.mjs` | Express avec sa configuration usuelle |
| `express-fair.mjs` | Express **à parité de fonctionnalités** — c'est celui qui rend la comparaison honnête |
| `express-fair-proof.mjs` | **preuve d'équité** : la cible de banc ne traverse rien de dormant — 1 000 req → 0 Set-Cookie, 0 commit sqlite (`PRAGMA data_version` + counts), profiler 404. À rejouer depuis la RACINE du repo, serveur mono prod au décor du banc lancé au préalable |
| `fastify.mjs` | Fastify avec sa configuration usuelle |
| `payload.mjs` | la charge utile commune, pour que les trois répondent exactement la même chose |
| `express-drizzle.mjs` | Express + Drizzle à **parité ORM** avec le banc `NF_BENCH_ORM` (même schéma pg-core via le dist du module test, même version drizzle par résolution racine, même PG). `DRIZZLE_MODE=naive` (build/req, le code idiomatique) ou `prepared` (mémoïsé = le lot du framework). Recoupement croisé d'un A/B ORM |
| `express-fair-drizzle.mjs` | le duel complet : middlewares d'`express-fair` **plus** la même requête Drizzle — l'écart restant face à Nodefony est le vrai surcoût à parité de travail ET d'ORM (mesuré ×1,07) |

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

<!-- prettier-ignore -->
| Banc | À relancer avec |
| --- | --- |
| `ratelimit-e2e` | `NF__HTTP__RATELIMIT__ENABLED=true NF__HTTP__RATELIMIT__MAX=5 NF__HTTP__RATELIMIT__WINDOWS=5` |
| `ws-handshake-ratelimit-e2e` | `NF__HTTP__RATELIMIT__ENABLED=true NF__HTTP__RATELIMIT__MAX=15 NF__HTTP__RATELIMIT__WINDOWS=30` |
| `ws-conn-cap-e2e` | `NF__HTTP__WSMAXCONNECTIONSPERIP=3` |
| `webhooks-dataplane-e2e` | `NF__SECURITY__WEBHOOKS__DENYPRIVATEIPS=true` (anti-SSRF strict) — sinon le sous-test « create SSRF → 422 » obtient **201** (le dev autorise le réseau privé, `169.254.169.254` passe) |

**B. Autonomes** (forkent leur propre serveur → 0 serveur dev requis, mais `npm run build` d'abord) :
`cluster-*`, `idempotency-postgres`, `config-env-override`, `boot-bench`, `boot-profile`, `soak`.

> 🔴 **Un classement ne se lit pas, il se LANCE.** Ce tableau a menti sur quatre bancs, chaque fois
> dans le même sens : un banc rangé « autonome » qui exige en fait un décor. Le coût n'est pas
> l'échec — c'est qu'il se lit comme un rouge du framework et fait ouvrir une enquête. Avant
> d'ajouter une ligne ici, jouer le banc dans la classe où on le range.

**C. Serveur dev standard** (décor par défaut) : `totp-mfa`, `totp-mfa-attack`,
`users-admin-factors`, `idempotency-userland` (+ `NF_REDIS_URL`), `debug-runtime`, `capacity`,
`graceful-shutdown`, et les bancs de mesure de la famille 1 (`http-load`, `ws-*`, `hub-load`,
`supervision-stress`, `log-sink-contention`, `aimd-demo`, `route-scan-cost`, `db-backend-cost`).

> ⚠️ `graceful-shutdown` est en C, PAS en B : il exige un serveur DÉJÀ booté (il le dit —
> « Aucun runtime Nodefony publié […] booter le serveur d'abord »), et le TUE en fin de course.
> C'est un banc de classe C **destructeur** : dernier de son lot, serveur relancé après.
>
> ⚠️ `capacity` exige lui aussi un serveur, et ne le dit PAS : sans serveur il rend une trace
> `ECONNREFUSED` brute, là où ses voisins nomment le geste manquant.

**D. Décor PROPRE** — ni le serveur dev, ni l'autonomie ne suffisent :

<!-- prettier-ignore -->
| Banc | Son décor, et pourquoi |
| --- | --- |
| `idempotency-cluster-e2e` | un **cluster de 2 workers**, pas le serveur dev : il exige ≥ 2 pids servants. `NF_IDEMPOTENCY_STORE=redis NF_REDIS_URL=… NF_ADMIN_PASSWORD=secret-de-dev-42 NF_USER_STORE=memory NF_WITH_DEV_MODULES=1 nodefony cluster --workers 2 --detach --wait 120`. ⚠️ L'entête du script prescrit `NF_REDIS_PASSWORD` : la configuration charge le module Redis sur `NF_REDIS_URL` (`nodefony.config.ts`, `when: () => !!ctx.infra.cache`) — sans elle, le cluster part en **boucle de redémarrage** sur « the @nodefony/redis module is not loaded ». |
| `scaffold-ws-probe`, `app-download-probe` | un **cookie de session** en premier argument, qu'aucune autre ligne ne mentionne. Ils lisent méthode et canal au registre (`PLATFORM_METHODS.scaffoldRun`, `PLATFORM_CHANNELS.scaffoldJob`) : leur `method not found: scaffold:run` venait du passage à l'espace de noms `nodefony:`. La méthode répond de nouveau ; le parcours complet de génération n'a pas été rejoué — voir #217. |
| `micro/micro-route-scan` | la table de routes de l'app : `npx nodefony inspect routes --json > tmp/routes-inspect.json`. Il le dit en sortant. |
| `poc-hmr-perf` | le port Vite du module visé **en `wss://`** — son défaut `ws://127.0.0.1:5173` ne se connecte plus (Vite sert en TLS auto-signé, ports attribués par module). Voir #217. |

> ⚠️ **Ne jamais lancer les destructeurs (`graceful-shutdown`, `cluster-*`) dans le même lot que
> les autres bancs C** : ils tuent ou prennent les ports du serveur dev → les suivants tombent en
> `ECONNREFUSED` (faux « KO »). Isoler les destructeurs, ou relancer le serveur après.

## Mesurer ce que le profil ne voit pas — `wait-compare.sh`, `native-sample.mjs`

**Quand** : le profil comparé (`profile-compare.sh`) ne suffit plus — il annonce une parité que
le débit dément, ou désigne une petite fonction dont le coût paraît invraisemblable. Le profileur
V8 n'échantillonne que le JavaScript : il ne voit ni l'ATTENTE, ni le C++ de Node, ni le runtime
V8, et il **sur-attribue les petites fonctions** (mesuré sur #508 : 8,5 µs/req prêtés au
traitement du `Host`, 0,5 µs au micro-banc — facteur ~15).

### `wait-compare.sh [témoin=nest-fair] [paires=3]`

```bash
bash .claude/skills/nodefony-load-test/scripts/wait-compare.sh nest-fair 3
# + la pile native pendant la même fenêtre :
NF_NATIVE_SAMPLE=1 NF_WAIT_DIR=tmp/profiles/wait-native bash .claude/skills/nodefony-load-test/scripts/wait-compare.sh nest-fair 2
```

Décor posé par le script, identique à `profile-compare.sh` : ports 5151/5161 libérés, serveur
`production` (`NF_LOG_DRIVER=null`, `NF_BENCH_ROUTE=1`, route de banc par dérogation
`NF_WITH_DEV_MODULES`), garde `attendre_machine_calme` avant chaque run, cible prouvée en `200`,
chauffe `wrk` non comptée, puis la fenêtre mesurée (`BENCH_DUR`, défaut 20 s, `BENCH_CONN` 128).
Paires ALTERNÉES Nodefony / témoin. Un run se refuse (exit 1) sur cible ≠ 200, réponse non-2xx
sous charge ou sonde muette.

**Bissection par court-circuit** — `NF_WAIT_CUTS="entry context pipeline route action"` :
chaque manche sert AUSSI Nodefony coupé à chacun de ces étages (`cut-probe.mjs` préchargé par
`NODE_OPTIONS`, `NF_BENCH_CUT=<étage>`, qui remplace UNE méthode de `HttpKernel` / `HttpContext`
par une réponse immédiate au même corps). Les étages sont cumulatifs — `entry` = serveur Node
seul, `context` + scope DI et `HttpContext`, `pipeline` + ALS et CORS, `route` + routeur et
en-têtes de sécurité, `action` + corps et gardes ; le complet ajoute l'action et le rendu.
`cut-analyze.mjs` rend, par étage : cumul, dispersion, débit, nombre d'en-têtes émis (~210 ns
chacun, `micro-write-head.mjs`) et coût = coupe(k) − coupe(k−1) calculé dans chaque manche.
Un run refuse (exit 1) si la ligne `cut-probe: <étage>` manque au journal du serveur : une
coupe non posée mesurerait la requête complète sous un faux nom. ⚠️ Le JIT d'un serveur coupé
voit un autre programme : un étage sous ~1 µs ne se lit pas.

**Chronométrage in situ** — `span-run.sh [runs=3]` : quand une coupe est instable (le JIT
d'un serveur coupé n'est plus celui du serveur complet), `span-probe.mjs` enveloppe les appels
d'un étage sur le serveur COMPLET et rend leur temps inclusif en ns/req (`span-analyze.mjs`),
enveloppe étalonnée, plus l'INVENTAIRE des écouteurs du Kernel et de HttpKernel. Deux appels
qui ne s'emboîtent pas (enfant plus cher que son parent) désignent une frontière ASYNCHRONE.

**Garde de décor** — `decor-probe.mjs`, préchargé dans tout serveur Nodefony de
`wait-compare.sh` et `span-run.sh` : refus (code 3, ligne `decor-probe: REFUS` au journal) si
un hook du chemin de requête (`onRequestScope`, `onServerRequest`, `onCreateContext`,
`beforeResolve`) a un écouteur — un seul rend chaque requête asynchrone. Le module test coupe
les siens sous `NF_BENCH_ROUTE`.

Mécanique : `wait-probe.mjs` est préchargé (`node --import`) dans les DEUX camps ; un premier
`SIGUSR2` ouvre la fenêtre, un second la ferme et écrit `<pid>.json` dans `NF_WAIT_PROBE_OUT`.
Sortie : `tmp/profiles/wait/<camp>-<n>/{<pid>.json, wrk.txt, server.log}` puis le tableau de
`wait-analyze.mjs` (médiane par camp, écart, ratio, colonne « séparé » = les séries des deux
camps ne se chevauchent pas).

| Ligne du tableau               | Source                                 | Ce qu'elle tranche                                                                                    |
| ------------------------------ | -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| occupation boucle (ELU %)      | `performance.eventLoopUtilization`     | ~100 % = le fil est SATURÉ, rien n'attend ; nettement moins = il attend quelque chose — chercher quoi |
| CPU fil principal µs/req       | `process.threadCpuUsage`               | **l'arbitre A/B** : dispersion < 1 % (~0,7 µs), bien plus fin que le débit (±8 %) et que le profil    |
| dont user / système            | idem                                   | système = noyau (écritures, lectures, `kevent`) ; user = JS + C++ + V8                                |
| CPU process / autres fils      | `process.cpuUsage` − fil               | GC parallèle, pool libuv — un majorant, jamais un plafond de débit                                    |
| GC µs/req, GC / 1000 req       | `PerformanceObserver` `gc`             | le ramasse-miettes du fil ; détail par genre sous le tableau                                          |
| tours de boucle / req          | `performance.nodeTiming.uvMetricsInfo` | ≪ 1 sous saturation (des dizaines de requêtes par tour) ; ≥ 1 = la requête enjambe plusieurs tours    |
| écritures socket / req, writev | `net.Socket#_writeGeneric` instrumenté | le proxy des appels système d'écriture (`dtruss` exige root) ; 1 = en-têtes et corps en un seul envoi |
| chgts contexte                 | `process.resourceUsage`                | involontaires = préemption par l'OS (machine chargée) ; volontaires = attente bloquante               |

Pièges :

- La sonde coûte un compteur par écriture et par requête, **pareil pour les deux camps** : les
  ABSOLUS sont légèrement majorés, les ÉCARTS non. Le débit d'un run sondé ne se publie pas.
- Les absolus varient d'une heure à l'autre (mesuré : 11 000 puis 16 000 req/s, ratio stable
  0,77–0,79) — on compare dans la même série, jamais deux séries entre elles.
- Le `wait` d'un pilote shell qui lance le serveur en `&` attend AUSSI le serveur : n'attendre
  que le PID visé (vécu : interblocage de 25 min).

### `native-sample.mjs` — qui paie, en µs/req

La forme usuelle ne se tape pas : `NF_NATIVE_SAMPLE=1 wait-compare.sh` l'appelle en fin de
campagne sur TOUTES les paires, moyennées (`NF_NATIVE_TOP` règle la longueur des listes). À la main :

```bash
S=.claude/skills/nodefony-load-test/scripts
node $S/native-sample.mjs --dir tmp/profiles/wait-native nodefony nest-fair 40   # toutes les paires, moyennées
node $S/native-sample.mjs <capture> <rps>                               # une capture seule
node $S/native-sample.mjs <capA> <rpsA> <capB> <rpsB> [top]             # deux captures
```

Éprouvé par `native-sample.test.mjs` (capture miniature écrite à la main : temps propre, nommage,
imputation, moyenne) — `npx vitest run .claude/skills/nodefony-load-test/scripts/native-sample.test.mjs`.
Un changement du format de `sample` ou de `perf.map` doit le faire tomber, pas fausser un banc.

Il parcourt l'arbre d'appels du FIL PRINCIPAL de la capture (`sample <pid> 10 -file …`, outil
macOS livré, sans root pour ses propres process), calcule le temps PROPRE de chaque frame
(échantillons − enfants), puis convertit en µs/req — le fil étant saturé, 1 s de fil = `rps`
requêtes. Rend : le total, le tableau par **famille**, les frames triées par écart absolu, puis,
**par camp**, « QUI paie » : chaque fonction JS avec son temps propre PLUS le natif qu'elle a
appelé (builtins, chaînes, `setHeader` de Node…), et les trois familles qui dominent.
Importable (`parseMainThread`, `family`, `loadPerfMap`) pour un tri ad hoc.

**Nommer les fonctions JS** : `sample` ne voit les frames JIT que comme `???  [0x…]`. Sous
`NF_NATIVE_SAMPLE=1`, `wait-compare.sh` démarre Node avec `--perf-basic-prof
--interpreted-frames-native-stack` et copie `/tmp/perf-<pid>.map` (adresse, taille, nom de chaque
code compilé) en `perf.map` à côté de la capture ; `native-sample.mjs` la lit s'il la trouve.
Sans elle, pas d'imputation (le script le dit). Les deux camps n'ont pas les mêmes fonctions :
« qui paie » se lit en DEUX listes, jamais en écart fonction par fonction.

⚠️ **Une fonction optimisée absorbe ses appelés INLINÉS.** Mesuré : `applySecurityHeaders` à
10,2 µs/req sur une paire, 6,0 sur la suivante — selon que TurboFan y a inliné `setHeader` ou non ;
côté témoin, `_on` de Fastify portait 20 µs sur une paire. « Qui paie » se lit donc « à partir
d'où » : additionner la CHAÎNE (appelant + appelés visibles), comparer sur ≥ 2 paires, et ne
jamais conclure sur une ligne isolée.

`node --prof` (+ `--prof-process`) nomme aussi les appelants, mais **ne convient pas sous macOS** :
les builtins embarqués dans le binaire y sont imputés à un faux symbole C++ (mesuré : 58 % des
ticks sur `node::ProcessEmitWarningGeneric`, avec ou sans `--mac`). S'il sert malgré tout (Linux) :
`node --prof --logfile=tmp/profiles/v8-%p.log --no-logfile-per-isolate …` — sans ces deux options,
V8 écrit un `isolate-*-v8.log` dans le répertoire courant, c'est-à-dire à la racine du dépôt.

| Famille                                 | Ce qu'elle contient                                                          |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| JS (nommé) / JIT non nommé              | temps propre du JS ; `???` restant = adresse absente de `perf.map`           |
| V8 builtins                             | `Builtins_*` appelés par le JS : ICs mégamorphiques, `join`, regex, `new`…   |
| V8 chaînes (internement, casse, JSON)   | `StringTable` (clés calculées), `toLowerCase`, `JSON.stringify`, aplatissage |
| V8 runtime (objets lents)               | `Runtime_*`, dictionnaires — objets passés en mode dictionnaire, `delete`    |
| noyau (appels système)                  | `libsystem_kernel` : `write`, `read`, `kevent`                               |
| parseur HTTP, libuv, Node C++, GC, libc | le reste de la pile native                                                   |

Pièges : `sample` suspend le fil à chaque relevé — il ATTRIBUE, il ne chiffre pas ; la
catégorisation est par motif de nom, donc une frame nouvelle peut tomber en « V8 autre » (la
regarder avant de conclure) ; et tout poste désigné se **convertit en ns par un micro-banc**
(`scripts/micro/`) avant d'ouvrir un chantier.

## Variables communes

Les bancs de la famille 2 partagent un décor : un serveur en marche, et pour certains une session
authentifiée. `SETTLE` règle le temps d'installation avant mesure, `E2E_ROLE` distingue le process
parent du process forké dans les bancs cluster. Les bancs de charge prennent leur cible par
`WS_URL` / `URL` / `HOST` / `PORT`, et leur intensité par `N`, `C`, `CAP`, `STEP`, `BATCH`.

Le détail par script figure dans sa fiche générée : `docs/skills/nodefony-load-test.md` liste, pour
chacun, ses options et **toutes** les variables qu'il lit — extraites de son source, donc à jour.
