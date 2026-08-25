# Protocoles détaillés des bancs de charge les plus utilisés

> Détail de chaque banc listé dans [`catalogue.md`](catalogue.md) (Famille 1) : décor exact,
> variables d'environnement, mesures de référence et pièges déjà rencontrés. Le corps du
> `SKILL.md` renvoie ici pour ne garder sous les yeux que le Niveau 1 (non-régression) et les
> deux règles de validité d'une mesure.
>
> **Maintenance** : édition en place. Un script ajouté doit apparaître dans `catalogue.md` ;
> son protocole détaillé, s'il en mérite un, prend place ici.

## Table des matières

- [Axe 1 — plafond de connexions WS](#axe-1--plafond-de-connexions-ws-ws-connectionsmjs)
- [Axe 2 — débit messages / broadcast](#axe-2--débit-messages--broadcast-ws-messagesmjs)
- [Charge HTTP](#charge-http-http-loadmjs)
- [Contre-pression WS sur socket RÉELLE](#contre-pression-ws-sur-socket-réelle-ws-backpressure-e2emjs)
- [Charge du HUB realtime](#charge-du-hub-realtime-hub-loadmjs--panneau-nodefonyhub)
- [Stress COMBINÉ « supervision »](#stress-combiné--supervision--supervision-stressmjs)
- [Démo AIMD — cadence adaptative](#démo-aimd--cadence-adaptative-aimd-demomjs)
- [Cluster sans PM2 — backplane realtime cross-process](#cluster-sans-pm2--backplane-realtime-cross-process-cluster-ipcmjs-cluster-realtime-e2emjs)
- [Config — override par env sur VRAI boot](#config--override-par-env-sur-vrai-boot-config-env-override-e2emjs)

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

### Contre-pression WS sur socket RÉELLE (`ws-backpressure-e2e.mjs`)

Éprouve la contre-pression SORTANTE (serveur → client) sur une **vraie** socket : le
client suspend la lecture (`ws._socket.pause()`), la fenêtre TCP se referme, la file du
serveur enfle pour de bon. Les tests unitaires posent `bufferedAmount` à la main — ils
prouvent la logique du seuil, **jamais la physique du transport**.

Il mesure **côté serveur** (route `/nodefony/test/bench/backpressure/probe`), jamais en
comptant les frames reçues : un client qui n'a pas fini de lire affiche le même déficit
qu'un client dont les frames ont été jetées. Piège vécu — « 129 reçues sur 400 » ne
prouvait rien.

**Décor obligatoire** :

1. seuils bas sur le **bon** serveur — ⚠️ `websocket` (ws://5151) et `websocketSecure`
   (wss://5152) sont **deux sections distinctes**, le banc frappe en `wss` :
   `use("@nodefony/http", { websocketSecure: { maxBackpressure: 65536, backpressureCloseAfterDrops: 20 } })`
2. endpoint de banc + volume de rafale :
   `NF_BENCH_WS_BACKPRESSURE=1 NF_BENCH_WS_FRAMES=400 NF_BENCH_WS_BYTES=32768 bash .claude/skills/nodefony-start-server/start.sh`

```bash
node .claude/skills/nodefony-load-test/scripts/ws-backpressure-e2e.mjs
```

Mesure de référence (seuils ci-dessus, 400 charges de 32 Kio) : **3 frames servies, 20
refusées, fermeture `1013`** — le client zombie est coupé et sait retenter. Ce banc a
trouvé un défaut réel : la fermeture reposait sur un **second seuil d'octets**, que le
drop rend inatteignable (il plafonne la file). Elle repose désormais sur un **solde de
refus**. Si tu le vois échouer sur « socket encore ouverte », c'est ce défaut qui est
revenu.

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
> `NF_CLUSTER_PROBE=0 npx nodefony cluster --workers 4`
> ⇒ aucun reporter/agrégateur (0 timer, 0 IPC sonde), l'endpoint santé sert la vue per-instance.
>
> ⚠️ **Modèle « 2 molettes » (2026-05-24)** : la topologie = `--workers N` > env
> `NF_WORKERS` > config `cluster.workers` > **défaut 1**. Donc `nodefony cluster` SANS
> `--workers` (et config=1) = **mono-process** (zéro machinerie cluster) — pour un VRAI
> cluster, toujours `--workers N` (≥2) ou `NF_WORKERS=N`. `staging`/`preprod` =
> **déprécié**. Pour lancer un runtime cluster à tester :
> `bash .claude/skills/nodefony-start-server/start.sh --cluster -w N`. Les scripts `cluster-*.mjs`
> ci-dessus forkent en DIRECT (harnais de preuve, indépendant du CLI) → non concernés.

Repères fil IPC (loopback) : ~300k pub/s @256B ; master sature @4KB×7sub (~176 MB/s = plafond
gateway → coalescer avant `publish` au-delà) ; RTT 4-sauts p50 ~0.40 / p99 ~0.77 ms.

> Réfs : mémoires `project_cluster_backplane_vision`, `project_realtime_socket_probe`.

### Config — override par env sur VRAI boot (`config-env-override-e2e.mjs`)

Preuve **terrain** du mécanisme générique d'override de config par variable d'environnement
(ADR-0006 : `NF__<APP|MODULE>__<CHEMIN>`). Le script **spawn lui-même** le serveur (process unique,
`NF_DEV_CHILD=1`, ports 7771/7772 pour éviter toute collision) — **PAS de serveur dev requis**
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
