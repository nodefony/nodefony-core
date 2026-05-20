---
name: load-test
description: >
  Tests de charge / stress HTTP et WebSocket du framework Nodefony. Deux niveaux :
  (1) les SUITES MOCHA versionnées (non-régression de charge, CI-stable + sondes
  rupture derrière un flag), (2) des SCRIPTS NODE client standalone paramétrables
  pour explorer les limites à la main (plafond connexions WS, débit messages/broadcast,
  RPS+percentiles HTTP). Utilise ce skill quand l'utilisateur dit "test de charge",
  "stress", "combien de connexions/messages", "benchmark", "jusqu'à la rupture",
  "RPS", "latence p99", ou veut hammerer le serveur. Prérequis : serveur dev UP.
---

# load-test

Deux niveaux complémentaires. **Toujours s'assurer que le serveur dev tourne d'abord**
(`bash .claude/skills/start-nodefony-server/start.sh`). Le serveur écoute 5151 (http/ws)
+ 5152 (https/wss). Les scripts ciblent **5152 (TLS, `rejectUnauthorized:false`)** par défaut.

## Niveau 1 — Suites mocha versionnées (non-régression)

Le « vrai » filet de sécurité, committé dans `@nodefony/http`, lancé via la config
**dédiée** `.mocharc.load.json` (séparée de la non-régression rapide). Cas CI-stables
+ sondes plafond/rupture **gated** derrière `RUN_WS_RUPTURE=1` (épuisent les ports
éphémères → disruptif, jamais en CI par défaut).

```bash
bash .claude/skills/load-test/scripts/run.sh mocha             # WS load CI-stable
bash .claude/skills/load-test/scripts/run.sh mocha --rupture   # + plafond/rupture
```

Fichiers couverts (cf `src/packages/@nodefony/http/CLAUDE.md` § « Suites séparées ») :

| Fichier | Sujet |
| --- | --- |
| `tests/load/ws-connections-load.test.ts` | axe 1 — connexions concurrentes + churn (drain par poll) |
| `tests/load/ws-messages-load.test.ts` | axe 2 — débit echo + broadcast fan-out |
| `tests/load/als-load.test.ts` | leaks de scopes DI (BUG-001/003/004) sous charge WS |
| `tests/http/memory.test.ts` | deltas heap HTTP + WS (seuils blockers) |

Gate perf seul (avant tout commit touchant Kernel/pipeline/mémoire) :
```bash
cd src/packages/@nodefony/http && npx mocha --config .mocharc.load.json --grep "Memory"
```

## Niveau 2 — Scripts client standalone (exploration)

Pour pousser **à la main** au-delà des seuils CI et trouver les vraies limites.
Node ESM purs (`ws` + builtins), **lancés depuis la racine du repo**, paramétrés par ENV.

### Axe 1 — plafond de connexions WS (`ws-connections.mjs`)
Combien de sockets simultanées le process tient. Rampe par batches jusqu'au 1er
palier incomplet (= plafond) ou `CAP`, mesure le coût heap/connexion, ferme tout.
```bash
bash .claude/skills/load-test/scripts/run.sh ws-conn
CAP=4000 STEP=500 BATCH=80 run.sh ws-conn      # via wrapper, ENV inline
```
ENV : `WS_URL` `CAP`(8000) `STEP`(250) `BATCH`(50) `HOLD_MS`(0) `HEAP_URL`.

### Axe 2 — débit messages / broadcast (`ws-messages.mjs`)
```bash
bash .claude/skills/load-test/scripts/run.sh ws-msg              # echo flood (paliers)
MODE=broadcast CLIENTS=30 BURST=100 run.sh ws-msg               # fan-out N clients
```
ENV : `MODE`(echo|broadcast) `HOST` `WS_URL` `BURSTS`(CSV) `CLIENTS`(20) `BURST`(50) `TIMEOUT_MS`(60000).

### Charge HTTP (`http-load.mjs`)
RPS + latence p50/p90/p95/p99/max + distribution des codes, Agent keep-alive.
```bash
bash .claude/skills/load-test/scripts/run.sh http
N=5000 C=100 URL=https://127.0.0.1:5152/nodefony/test/index run.sh http
METHOD=POST BODY='{"x":1}' URL=https://127.0.0.1:5152/nodefony/test/... run.sh http
```
ENV : `URL` `N`(1000) `C`(50) `METHOD`(GET) `BODY`.

## Repères empiriques (loopback, machine 32 GB) — pour situer un résultat

- **Connexions** : rupture **16 372** simultanées (re-validé 2026-05-21, plage 49152–65535
  = 16384 ports − quelques occupés). Épuisement des ports éphémères loopback, PAS les fd ni
  la RAM ; en réseau réel (IP clientes distinctes) ça remonte. Cleanup propre, 0 leak.
  ⚠️ **Sous-batcher l'ouverture** (`BATCH=50`) pour lire ce plafond : ouvrir des centaines de
  connects d'un coup échoue côté CLIENT (TLS loopback dual-stack) et **sous-estime** (mesuré
  4741 sans sous-batch vs 16372 avec). Le script `ws-connections.mjs` ET la sonde mocha
  `RUPTURE` le font ; lever `WS_RUPTURE_CAP=20000` pour que la sonde atteigne le vrai plafond.
- **Messages** : echo 1 conn ~7 200 msg/s ; broadcast fan-out propre jusqu'à ~**40k msg/s**,
  sature vers ~**120k msg/s** (le serveur bufferise, ne crash pas).
- Détails + historique : mémoire IA `project_ws_stress_studio_lag`.

## Gotchas (vécus — ne pas réapprendre)

- **Ouvrir N centaines de WS en un seul `Promise.all` → `AggregateError`** (connect TLS
  loopback dual-stack `internalConnectMultiple`). Les scripts ouvrent **par batches**
  (`BATCH`) — garder ce pattern.
- **Toujours fermer/tracker les sockets** : un bench qui throw laisse des sockets ouvertes
  qui faussent la mesure suivante (et, en test, polluent la baseline scopes serveur).
- **Release de scope serveur lague le `close` client** → mesurer la propreté par **poll**
  de `/nodefony/test/als-test/scopes`, pas un `sleep` fixe (cf suites mocha).
- **TLS auto-signé** : `rejectUnauthorized:false` partout (déjà dans les scripts).
- **Sondes rupture mocha** : gated `RUN_WS_RUPTURE=1` + `WS_RUPTURE_CAP` — ne PAS les
  activer en CI (disruptif pour la machine hôte).
- Routes test utilisées : `/nodefony/test/ws/echo`, `/nodefony/test/ws/broadcast`,
  `/nodefony/test/memory` (heap), `/nodefony/test/als-test/scopes` (leaks). Fournies par
  `src/modules/test` → rebuild le module test si elles manquent (404).

## Liens

- `start-nodefony-server` — démarrer le serveur (prérequis)
- `tail-error-logs` — corréler une rupture avec les logs serveur
- Mémoires IA : `project_ws_stress_studio_lag`, `feedback_load_tests_separation`, `feedback_perf_memory_rule`
