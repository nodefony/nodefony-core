---
name: nodefony-load-test
description: >
  Tests de charge / stress HTTP et WebSocket de Nodefony. Deux niveaux : suites Vitest versionnées
  (config dédiée vitest.load.config.ts — non-régression de charge + sondes rupture derrière un flag) et scripts Node standalone pour
  explorer les limites (plafond connexions WS, débit messages, RPS + percentiles). Prérequis : serveur dev UP.
  Déclencheurs : "test de charge", "stress", "benchmark", "combien de connexions",
  "jusqu'à la rupture", "RPS", "latence p99", "hammerer le serveur".
---

# load-test

Deux niveaux complémentaires. **Toujours s'assurer que le serveur dev tourne d'abord**
(`bash .claude/skills/nodefony-start-server/start.sh`). Le serveur écoute 5151 (http/ws)

- 5152 (https/wss). Les scripts ciblent **5152 (TLS, `rejectUnauthorized:false`)** par défaut.

## Niveau 1 — Suites vitest versionnées (non-régression)

Le « vrai » filet de sécurité, committé dans `@nodefony/http`, lancé via la config
**dédiée** `vitest.load.config.ts` (séparée de la non-régression rapide ; mocha SUPPRIMÉ
2026-06-05). Séquentielle (`fileParallelism:false`). Cas CI-stables

- sondes plafond/rupture **gated** derrière `RUN_WS_RUPTURE=1` (épuisent les ports
  éphémères → disruptif, jamais en CI par défaut).

```bash
bash .claude/skills/nodefony-load-test/scripts/run.sh load             # WS load CI-stable
bash .claude/skills/nodefony-load-test/scripts/run.sh load --rupture   # + plafond/rupture
# ou directement : cd src/packages/@nodefony/http && npm run test:load
```

Fichiers couverts (cf `src/packages/@nodefony/http/CLAUDE.md` § « Suites séparées ») :

| Fichier                                  | Sujet                                                    |
| ---------------------------------------- | -------------------------------------------------------- |
| `tests/load/ws-connections-load.test.ts` | axe 1 — connexions concurrentes + churn (drain par poll) |
| `tests/load/ws-messages-load.test.ts`    | axe 2 — débit echo + broadcast fan-out                   |
| `tests/load/als-load.test.ts`            | leaks de scopes DI (BUG-001/003/004) sous charge WS      |
| `tests/http/memory.test.ts`              | deltas heap HTTP + WS (seuils blockers)                  |

Gate perf seul (avant tout commit touchant Kernel/pipeline/mémoire) :

```bash
cd src/packages/@nodefony/http && npm run test:memory
```

## Niveau 2 — Scripts client standalone (exploration)

Pour pousser **à la main** au-delà des seuils CI et trouver les vraies limites.
Node ESM purs (`ws` + builtins), **lancés depuis la racine du repo**, paramétrés par ENV.

### Axe 1 — plafond de connexions WS (`ws-connections.mjs`)

Combien de sockets simultanées le process tient. Rampe par batches jusqu'au 1er
palier incomplet (= plafond) ou `CAP`, mesure le coût heap/connexion, ferme tout.

```bash
bash .claude/skills/nodefony-load-test/scripts/run.sh ws-conn
CAP=4000 STEP=500 BATCH=80 run.sh ws-conn      # via wrapper, ENV inline
```

ENV : `WS_URL` `CAP`(8000) `STEP`(250) `BATCH`(50) `HOLD_MS`(0) `HEAP_URL`.

### Axe 2 — débit messages / broadcast (`ws-messages.mjs`)

```bash
bash .claude/skills/nodefony-load-test/scripts/run.sh ws-msg              # echo flood (paliers)
MODE=broadcast CLIENTS=30 BURST=100 run.sh ws-msg               # fan-out N clients
```

ENV : `MODE`(echo|broadcast) `HOST` `WS_URL` `BURSTS`(CSV) `CLIENTS`(20) `BURST`(50) `TIMEOUT_MS`(60000).

### Charge HTTP (`http-load.mjs`)

RPS + latence p50/p90/p95/p99/max + distribution des codes, Agent keep-alive.

```bash
bash .claude/skills/nodefony-load-test/scripts/run.sh http
N=5000 C=100 URL=https://127.0.0.1:5152/nodefony/test/index run.sh http
METHOD=POST BODY='{"x":1}' URL=https://127.0.0.1:5152/nodefony/test/... run.sh http
```

ENV : `URL` `N`(1000) `C`(50) `METHOD`(GET) `BODY`.

### Charge du HUB realtime (`hub-load.mjs`) — panneau `/nodefony/hub`

Fait bouger la sonde de **la Socket Nodefony** (`RealtimeHub.probe` → endpoint
`/nodefony/realtime/api/health` + canal `realtime:health` + panneau « Realtime Hub »
de Studio). **Vise la socket STUDIO** `/nodefony/studio/api/realtime` (JSON-RPC
pub/sub) — c'est elle qui passe par le hub. ⚠️ Les routes WS du module test
(`ws/echo`, `ws/broadcast`) **BYPASSENT le hub** → elles ne bougent PAS `realtime:health`.
Le script **sonde lui-même** l'endpoint toutes les 2 s (conn/abonnés/diffusion/backpressure).

```bash
bash .claude/skills/nodefony-load-test/scripts/run.sh hub        # MODE=fanout (défaut)
MODE=slow run.sh hub                                             # backpressure (consommateurs lents)
N=400 CH=dashboard:supervision:250 run.sh hub                    # plus d'abonnés / cadence + fine
```

Deux modes :

- **`MODE=fanout`** (défaut) — N abonnés **SAINS** (drainent) à un canal qui tique
  (`dashboard:supervision:500`) → **connexions / abonnés / Diffusion (fan-out) / débit**
  montent ; **backpressure reste 0** (loopback + lecteurs sains = aucune congestion, c'est sain).
- **`MODE=slow`** — N **consommateurs LENTS** : ils s'abonnent (défaut `syslog:stream`)
  puis **cessent de lire** (`socket.pause()`). Couplé à un flot de logs (`HTTP_RPS` →
  remplit `syslog:stream`), la file d'envoi du serveur (`ws.bufferedAmount`) grossit pour
  eux → **backpressure grimpe** (jauge jaune/rouge), `slowConsumers` ↑. C'est LE moyen de
  voir la congestion bouger (impossible avec des lecteurs sains sur loopback).

> **Pourquoi `backpressure` reste 0 en `fanout`** : `ws.bufferedAmount` = octets que le
> serveur a voulu envoyer mais que le client n'a pas encore acceptés. Sur loopback (BP quasi
> infinie) avec des clients qui lisent, l'OS draine instantanément → rien ne s'accumule. Il
> faut un **client qui n'avale pas** (`MODE=slow`) pour le faire monter. Cf panneau Hub
> (mémoire `project_realtime_socket_probe`).

ENV : `MODE`(fanout|slow) `N`(fanout 250 / slow 150) `BATCH`(40) `HOLD_MS`(60000)
`CH`(fanout `dashboard:supervision:500` / slow `syslog:stream`) `HTTP_RPS`(slow 300, fanout 0)
`HTTP_PATH`(/nodefony/test/index) `HOST` `PORT`.

### Stress COMBINÉ « supervision » (`supervision-stress.mjs`)

Pousse **simultanément** 3 lanes (HTTP + connexions/messages WS + ORM/DB) en **rampe
par paliers** pour voir le **dashboard Supervision** (CPU, heap, GC, event-loop, handles)
ET le **dashboard ORM** bouger d'un coup d'œil, jusqu'à la **rupture**. La charge
s'ACCUMULE par palier ; chaque palier est tenu `STAGE_MS` (≥ la granularité du hub) ;
arrêt à la rupture (taux d'erreur du palier > `ERR_RUPTURE`) ou après `STAGES` paliers.

```bash
# AVANT : ouvrir /nodefony/supervision (switch « Temps réel » ON) + /nodefony/orm
bash .claude/skills/nodefony-load-test/scripts/run.sh stress
STAGES=10 WS_STEP=400 HTTP_STEP=80 ORM_STEP=8 run.sh stress   # plus agressif → rupture
```

ENV : `STAGES`(6) `STAGE_MS`(10000) `WS_STEP`(200) `HTTP_STEP`(40) `ORM_STEP`(4)
`MSG_HZ`(4) `BATCH`(50) `ERR_RUPTURE`(0.30) `HTTP_PATH`(/nodefony/test/index)
`ORM_PATH`(/nodefony/orm/api/orms) `WS_PATH`(/nodefony/test/ws/echo) `HOST` `PORT`.

> Lanes : HTTP = workers concurrents sur une route test ; WS = connexions persistantes
> (handles ↑) + echo à `MSG_HZ` (CPU/event-loop ↑) ; ORM = workers sur le data-plane
> `/nodefony/orm/api/orms` (touche les connexions/versions DB → latence ORM ↑). Pour une
> charge DB lourde, pointer `ORM_PATH` sur une route qui exécute des requêtes (ex. counts
> si exposée). Reporter live 1/s : `WS open | HTTP rps ⌀ms %err | ORM rps ⌀ms %err | msgIn/s`.

> 🔥 **Wedge event-loop pour démo supervision (2026-05-23)** : `ORM_PATH=/nodefony/orm/api/counts`
> = ~412 `COUNT(*)` **synchrones** (better-sqlite3) + table `session` 104k lignes → bloque la boucle
> **plusieurs secondes** d'affilée. C'est LE levier pour faire bouger d'un coup TOUT le dashboard
> Supervision : **ELU → 100 %**, **event-loop → 500-600 ms**, CPU 100 %, ctx switch **involontaires** ↑
> (préemption OS), flux ORM (débit) explose, **indice de santé → « Dégradé »**, et le **badge « retard »**
> (famine realtime) s'allume (le ticker ne pousse plus à temps — il faut un wedge **> 3 s** à granularité
> 1 s, seuil = 3× la cadence). Pour forcer le badge : rafale `counts` ultra-concurrente
> (`for i in $(seq 1 35); do curl -sk .../orm/api/counts & done; wait`, en boucle ~25 s).

### Démo AIMD — cadence adaptative (`aimd-demo.mjs`)

Montre la **cadence adaptative (AIMD)** « en action », LISIBLE et déterministe — sans navigateur
(l'AIMD est client-driven → dur à observer dans le DOM). Exerce la **vraie lib** (`bindAdaptiveChannel`
du core buildé) contre une socket MOCK + horloge contrôlée, et imprime chaque changement de cadence :
on VOIT la socket reculer sous famine (Multiplicative Decrease → re-`subscribe` d'un canal `:<ms>` plus
grossier) puis remonter quand c'est sain (Additive Increase). **Prérequis : core buildé** (`cd
src/nodefony && npm run build`). Aucun serveur requis.

```bash
bash .claude/skills/nodefony-load-test/scripts/run.sh aimd
```

Sortie type : `1000ms (init) → 2000 → 4000 → 8000 (decrease, famine) → 4000 → 2000 → 1000 (increase, reprise)`.

> **Voir l'AIMD sous VRAIE charge (navigateur)** : ouvrir `/nodefony/supervision` ou `/nodefony/orm`,
> activer **Cadence auto (AIMD)** (Hub) + **Temps réel** (granularité 2 s = seuil bas), puis lancer
> `run.sh stress` (wedge `ORM_PATH=/nodefony/orm/api/counts`) → le badge `auto ~Xs` grimpe sous charge
> puis redescend à l'arrêt. La démo `aimd` prouve l'algorithme ; le stress le montre de bout en bout.
> Réf : mémoire `project_realtime_granularity_clientlib`.

### Cluster sans PM2 — backplane realtime cross-process (`cluster-ipc.mjs`, `cluster-realtime-e2e.mjs`)

Ces deux scripts **forkent eux-mêmes** un cluster Node natif (master `ClusterRelay` + workers
`ClusterBackplane`) — **PAS de serveur dev requis** ; ils importent les dist (**prérequis :
`npm run build` core + framework**). Le master sert 0 HTTP : il est la gateway IPC qui relaie les
publications realtime d'un worker aux **autres** (fan-out cross-process intra-pod « comme si Redis
était là », gratuit).

```bash
# Bench du FIL IPC (coût brut worker→master→workers) — pub/s, MB/s, RTT 4-sauts.
bash .claude/skills/nodefony-load-test/scripts/run.sh cluster-ipc
WORKERS=8 PAYLOAD=1024 DURATION=8 run.sh cluster-ipc       # throughput
MODE=rtt WORKERS=2 RATE=2000 run.sh cluster-ipc            # latence aller-retour

# Preuve E2E (Phase 4b) : monte le RealtimeHub COMPLET + la politique de forward (4a)
# et ASSERTE (exit 0/1) : broadcast cross-process, anti-echo, canal instance-local NON
# forwardé (realtime:health), fan-out local intact. 8 checks.
bash .claude/skills/nodefony-load-test/scripts/run.sh cluster-e2e

# Preuve E2E (Phase 4c) : sonde agrégée pod en PUSH — chaque worker reporte sa santé au
# master (ClusterProbeAggregator), qui rediffuse le snapshot ; ASSERTE que chaque worker
# voit la vue POD (instanceCount=2, connectionCount agrégé). 4 checks, exit 0/1.
bash .claude/skills/nodefony-load-test/scripts/run.sh cluster-probe
```

> Sonde agrégée **désactivable** → bypass total :
> `NODEFONY_CLUSTER_PROBE=0 npx nodefony cluster --workers 4`
> ⇒ aucun reporter/agrégateur (0 timer, 0 IPC sonde), l'endpoint santé sert la vue per-instance.
>
> ⚠️ **Modèle « 2 molettes » (2026-05-24)** : la topologie = `--workers N` > env
> `NODEFONY_WORKERS` > config `cluster.workers` > **défaut 1**. Donc `nodefony cluster` SANS
> `--workers` (et config=1) = **mono-process** (zéro machinerie cluster) — pour un VRAI
> cluster, toujours `--workers N` (≥2) ou `NODEFONY_WORKERS=N`. `staging`/`preprod` =
> **déprécié**. Pour lancer un runtime cluster à tester :
> `bash .claude/skills/nodefony-start-server/start.sh --cluster -w N`. Les scripts `cluster-*.mjs`
> ci-dessus forkent en DIRECT (harnais de preuve, indépendant du CLI) → non concernés.

Repères fil IPC (loopback) : ~300k pub/s @256B ; master sature @4KB×7sub (~176 MB/s = plafond
gateway → coalescer avant `publish` au-delà) ; RTT 4-sauts p50 ~0.40 / p99 ~0.77 ms.

> Réfs : mémoires `project_cluster_backplane_vision`, `project_realtime_socket_probe`.

### Config — override par env sur VRAI boot (`config-env-override-e2e.mjs`)

Preuve **terrain** du mécanisme générique d'override de config par variable d'environnement
(ADR-0006 : `NF__<APP|MODULE>__<CHEMIN>`). Le script **spawn lui-même** le serveur (process unique,
`NODEFONY_DEV_CHILD=1`, ports 7771/7772 pour éviter toute collision) — **PAS de serveur dev requis**
(**prérequis : `npm run build`**). Il ASSERTE (exit 0/1) :

- `NF__APP__SERVERS__HTTP__PORT=7771` (+ https 7772) → le serveur **écoute sur le port surchargé** (override appliqué au boot, 0 code) ;
- `NF__APP__SERVERS__HTTP__PORT=abc` → **boot rejeté** (exit ≠ 0) : la valeur invalide est rattrapée par le Zod app (**fail-closed**).

```bash
bash .claude/skills/nodefony-load-test/scripts/run.sh config-env
```

> Complète les tests unitaires (`envOverride.test.ts`, `configBoot.test.ts`) par la preuve LIVE que
> l'override traverse le boot réel. Les vars **catalogue** `NF_X` (typées, `ctx.env`, secrets `*_FILE`,
> gating de module) restent câblées dans `env.ts`/`nodefony.config.ts` — couche distincte, non couverte
> par ce banc générique.

## Niveau 3 — A/B perf MONO PROD (coût du pipeline par requête)

Pour **chiffrer une optimisation du pipeline HTTP** (pas explorer une limite). Le RPS d'un
**1 process `production`** sous `wrk` est CPU-bound (~119 % CPU) → il reflète directement le
travail par requête. Le cluster est co-location-bound (ne montre PAS un gain CPU/req).

```bash
# A/B atomique — paires ALTERNÉES (annule la dérive thermique de la machine) :
S=.claude/skills/nodefony-load-test/scripts/bench-ab-mono.sh
bash $S old1 NF_BENCH_X=0 ; bash $S new1 NF_BENCH_X=1
bash $S old2 NF_BENCH_X=0 ; bash $S new2 NF_BENCH_X=1
# Comparer médianes old* vs new*. Garder le gain SSI il dépasse le bruit (±~3 %)
# ET les deux new > les deux old (séparation nette). Sinon = bruit → jeter.
```

Le script (`bench-ab-mono.sh`) : banc propre (kill ports + Vite, attend la libération) →
spawn mono `production` **detached** (`NODE_ENV=production` + `NF_LOG_DRIVER=null` FORCÉS) →
attend le boot → 3× `wrk` → **médiane** → arrêt gracieux. Toggles A/B = env vars passées au
serveur (`KEY=VAL`), à lire **1× au boot** côté code (jamais `process.env` dans le hot path).

**Diff STRUCTUREL sans toggle env** (RETEX 06-11) : flipper par
`git stash push -- <fichiers du diff>` / `git stash pop` — ⚠️ **le dist ne suit PAS le stash** →
rebuild du package après CHAQUE flip (new→stash→rebuild→old→pop→rebuild→new2…), et une dernière
fois après le pop final, sinon on benche l'autre code. **Verdict honnête = 3 issues** : gain net
(2 paires disjointes, > bruit ±5 %), structurel-gardé-en-le-disant (médiane positive MAIS
chevauchement → écrire « RPS bruit » dans le commit), ou rejet. Un levier profilé ~2 % est
INDISTINGUABLE du bruit machine → prévoir d'emblée l'argument structurel (Pdu/GC/closures).
Pour tout poste O(N) (scan routes…) : mesurer AUSSI un cas défavorable (fin de table) — un profil
mono-route position-dépendante ment (vécu : « 0,9 % » → +15,3 % NET une fois indexé).

🚨 **Pré-requis banc** (sinon mesures fausses — vécu) :

- **Module test en prod** : la route de réf `/nodefony/test/als-test/state` (session-free, 0 ORM)
  vit dans `@nodefony/test`, gaté `policy:"dev"` → **404 en prod**. Pour bencher : passer à
  `{ name:"@nodefony/test", policy:"optional" }` dans `nodefony.config.ts` + `npm run build`,
  **puis REVERT en "dev"** avant tout commit.
- `wrk` requis (`brew install wrk`) ; build à jour (`npm run build`) ; tuer les **Vite orphelins**
  (le script le fait : `pkill -f vite.js`) sinon throttle fantôme.
- Profilage CPU complémentaire (`node --prof` + `--prof-process`, piège macOS du faux symbole
  `BlobSerializerDeserializer`) : méthode complète en mémoire IA `reference_perf_profiling_method`.

Résultats engrangés avec ce banc (mono prod, route session-free) : **router-first +28 %**,
**retrait `setParameters("query.*")` morts +3.2 %** ; **différer le `JSON.stringify` audit −5.3 %**
(REJETÉ — le ring buffer paie un objet plus cher qu'une string → discipline A/B = ne garder que
le mesuré). L'audit complet reste ON par défaut ; `log.requestLogger.sampleRate` = levier opt-in.

### Matrice store — memory vs sqlite (coût du backend sur route authentifiée)

Valide que le choix de store (`NF_STORE`) se comporte comme attendu : `memory` est
~gratuit, `sqlite` (`better-sqlite3`, **sync**) paie un SELECT **bloquant** par reprise
de session. On compare une route qui TOUCHE le store à une route session-free (contrôle),
**INTRA-RUN** (même serveur → aucune dérive machine ; jamais comparer des absolus cross-run).

```bash
# 1 serveur par backend (start.sh propage process.env) :
NF_STORE=memory bash .claude/skills/nodefony-start-server/start.sh   # tout en memory
bash .claude/skills/nodefony-start-server/start.sh                   # défaut = sqlite (drizzle)
# Login → cookie de session, puis wrk (baseline + route session DANS LE MÊME run) :
JAR=$(mktemp); curl -sk -c "$JAR" -X POST \
  https://127.0.0.1:5152/nodefony/security/api/auth/login \
  -H 'Content-Type: application/json' -d '{"username":"admin","password":"secret"}' -o /dev/null
COOKIE=$(awk 'NF>=7 && $6 ~ /nodefony/ {print $6"="$7}' "$JAR" | head -1)
wrk -t4 -c25 -d8s https://127.0.0.1:5152/nodefony/test/als-test/state              # contrôle session-free 0-ORM
wrk -t4 -c25 -d8s -H "Cookie: $COOKIE" https://127.0.0.1:5152/nodefony/security/api/auth/me  # reprise session/req
```

**Lecture (ce qui est LOGIQUE)** — comparer les RATIOS intra-run :

- `als-test/state` (contrôle) ~IDENTIQUE memory vs sqlite (ne touche AUCUN store) → un écart
  ici = **dérive machine**, PAS le store. ⚠️ NE PAS prendre `/nodefony/test/index` comme baseline
  (rend du HTML lourd → fausse le ratio).
- `auth/me` **memory** ≈ son propre `als-test/state` (Map.get ≈ gratuit, coût ~10 %).
- `auth/me` **sqlite** ~2× plus lent que SON baseline (le `.get()` `better-sqlite3` sérialise
  l'event-loop) → **memory ~1.9× sqlite** sur la reprise de session.
- Direction STABLE dans le temps ([[project_session_store_perf_finding]]) ; l'écart absolu a
  rétréci (6×→~2×) au fil des optims session (dirty-tracking, touch throttlé, modèle NIST). En
  prod multi-nœud le store async (`redis`) restaure le débit ; `better-sqlite3` reste mono-nœud.

### Banc comparatif frameworks (`bench-frameworks/`) — Nodefony vs Express/Fastify/nu

Sandbox **isolé** (`bench-frameworks/`, package.json propre, node_modules gitignoré — ne touche
PAS aux workspaces) : apps minimales **à conditions égales** (186 routes, route de bench en #31,
payload JSON identique à `als-test/state`, prod, logs off). Chiffre l'écart aux concurrents et le
ROI d'un chantier structurel AVANT de l'engager.

```bash
cd .claude/skills/nodefony-load-test/bench-frameworks && npm install   # 1er usage
bash bench.sh bare 5161 ; bash bench.sh express 5162 ; bash bench.sh fastify 5163
FASTIFY_SCHEMA=1 bash bench.sh fastify 5163 FASTIFY_SCHEMA=1           # fast-json-stringify
# Nodefony via bench-ab-mono.sh (flip policy module test, cf pré-requis ci-dessus)
```

**Mesuré 2026-06-11** (mémoire IA `core-dev/audits/bench-frameworks-2026-06.md`) : nu **23 985** · Fastify
**20 782** (schema neutre) · Express **11 740** · **Nodefony 5 264** RPS. Décomposition :
Nodefony→Express ×2,23 = **coût par requête** (Express scanne linéairement AUSSI → pas le
routing) ; Express→Fastify ×1,77 = index radix. → fast path : attaquer le coût/req AVANT
l'index de routes. ⚠️ Fenêtre : re-bencher une cible en fin de série (dérive ≤ ~2 % = propre).

## Repères empiriques (loopback, machine 32 GB) — pour situer un résultat

- **Connexions** : rupture **16 372** simultanées (re-validé 2026-05-21, plage 49152–65535
  = 16384 ports − quelques occupés). Épuisement des ports éphémères loopback, PAS les fd ni
  la RAM ; en réseau réel (IP clientes distinctes) ça remonte. Cleanup propre, 0 leak.
  ⚠️ **Sous-batcher l'ouverture** (`BATCH=50`) pour lire ce plafond : ouvrir des centaines de
  connects d'un coup échoue côté CLIENT (TLS loopback dual-stack) et **sous-estime** (mesuré
  4741 sans sous-batch vs 16372 avec). Le script `ws-connections.mjs` ET la sonde vitest
  `RUPTURE` le font ; lever `WS_RUPTURE_CAP=20000` pour que la sonde atteigne le vrai plafond.
- **Messages** : echo 1 conn ~7 200 msg/s ; broadcast fan-out propre jusqu'à ~**40k msg/s**,
  sature vers ~**120k msg/s** (le serveur bufferise, ne crash pas).
- **Stress combiné supervision (2026-05-23, ORM_PATH=counts)** : sous `WS_STEP=400 HTTP_STEP=80
ORM_STEP=4` (≈ 4000 WS + counts qui wedgent la boucle), mesuré **CPU 100 %, ELU 100 % (idle 0),
  event-loop 500-600 ms, flux ORM ~180k req comptées**. ⚠️ **Le serveur NE TOMBE PAS** : il a répondu
  HTTP **200 en ~5,3 s** (vs ~240 ms à vide) — il **dégrade la latence mais sert toujours, 0 crash, 0 % err**.
  C'est la thèse confirmée : sous charge, le **différenciateur (realtime) meurt en premier** par famine
  event-loop, pas le service HTTP. **Indice de santé** = « Dégradé » (saturation planchée), PAS « Critique »
  (réservé aux pannes : erreurs, connecteur coupé, heap proche OOM). Cf [[project_realtime_granularity_clientlib]]
  (cadence adaptative AIMD = la suite). heap/rss gonflés PENDANT le stress (WS tenues) = normal, PAS une fuite
  (vérifier le reclaim APRÈS drain, pas pendant).
- Détails + historique : mémoire IA `project_ws_stress_studio_lag`.

## Gotchas (vécus — ne pas réapprendre)

- **Ouvrir N centaines de WS en un seul `Promise.all` → `AggregateError`** (connect TLS
  loopback dual-stack `internalConnectMultiple`). Les scripts ouvrent **par batches**
  (`BATCH`) — garder ce pattern.
- **Toujours fermer/tracker les sockets** : un bench qui throw laisse des sockets ouvertes
  qui faussent la mesure suivante (et, en test, polluent la baseline scopes serveur).
- **Release de scope serveur lague le `close` client** → mesurer la propreté par **poll**
  de `/nodefony/test/als-test/scopes`, pas un `sleep` fixe (cf suites `tests/load/`).
- **TLS auto-signé** : `rejectUnauthorized:false` partout (déjà dans les scripts).
- **Sondes rupture vitest** : gated `RUN_WS_RUPTURE=1` + `WS_RUPTURE_CAP` — ne PAS les
  activer en CI (disruptif pour la machine hôte).
- Routes test utilisées : `/nodefony/test/ws/echo`, `/nodefony/test/ws/broadcast`,
  `/nodefony/test/memory` (heap), `/nodefony/test/als-test/scopes` (leaks). Fournies par
  `src/modules/test` → rebuild le module test si elles manquent (404).

## Liens

- `nodefony-start-server` — démarrer le serveur (prérequis)
- `nodefony-tail-error-logs` — corréler une rupture avec les logs serveur
- Mémoires IA : `project_ws_stress_studio_lag`, `feedback_load_tests_separation`, `feedback_perf_memory_rule`
