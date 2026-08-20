---
name: nodefony-start-server
description: >
  Lance le serveur Nodefony en mode développement pour les tests d'intégration — script unique
  start.sh (1 commande, 1 approbation) : build conditionnel du module test, kill ports, spawn detached
  du DevSupervisor (auto-restart), wait boot fail-fast, health check. Commandes natives standalone
  nodefony status / nodefony stop (introspection + arrêt propre, de partout).
  Déclencheurs : "lance le serveur", "démarre nodefony", "relance le serveur", "start server",
  "redémarre le serveur", tests d'intégration en 404 (dist périmé).
---

# nodefony-start-server

Démarre le serveur Nodefony (development) de manière fiable. **Workflow consolidé en 2 scripts**
pour éliminer la friction (avant : ~8 commandes Bash, chacune pouvant demander une approbation ;
maintenant : 1 seule).

## ⚡ Usage — 1 commande

```bash
bash .claude/skills/nodefony-start-server/start.sh
```

Variantes :

```bash
bash .claude/skills/nodefony-start-server/start.sh -d            # mode debug (logs DEBUG verbeux)
bash .claude/skills/nodefony-start-server/start.sh --force-build # force rebuild module test
bash .claude/skills/nodefony-start-server/start.sh --cluster        # runtime cluster (défaut 2 workers)
bash .claude/skills/nodefony-start-server/start.sh --cluster -w 4   # cluster à 4 workers
```

Arrêter :

```bash
bash .claude/skills/nodefony-start-server/stop.sh   # tue dev ET cluster (master + workers) + ports
```

### `nodefony status` / `nodefony stop` — outils natifs (standalone, de partout)

Depuis 2026-06-20, deux commandes CLI **standalone** — exécutées par le fast-path de
`CliKernel.start` **sans booter le kernel**, donc utilisables **hors d'un projet
Nodefony** (pratique pour des zombies, ou quand le dist est cassé) :

```bash
node node_modules/nodefony/bin/nodefony status   # arbre process dev (superviseur/serveur/Vite) + PID/uptime/RSS/%CPU + ports
node node_modules/nodefony/bin/nodefony stop      # arrêt PROPRE du mode dev (group-kill : superviseur → enfant + Vite)
```

- Lancées via le **binaire en direct** (`node $BIN`, `$BIN=node_modules/nodefony/bin/nodefony`) :
  pas de wrapper `npx`/`npm exec` parasite, et le standalone n'a même pas besoin d'un projet valide.
- `status` = diagnostic « ne plus être perdu » : **vérité = `ps`** (pas le pidfile). Signale
  les états incohérents (pidfile périmé, process orphelins, empilement). Idempotent : aucune
  instance → « aucune instance en cours ».
- `stop` group-kill les **racines** (superviseur → emporte enfant + Vite ; orphelins = leur propre
  racine) SIGTERM→SIGKILL + attente ports libres + nettoyage pidfile. Couvre les Vite
  `nodefony-vite[...]` qu'aucun `pkill` ne matchait. Idempotent.
- `stop.sh` **délègue à `nodefony stop`** pour le mode dev, PUIS garde sa rafale `pkill` comme
  **filet** pour les modes non couverts : cluster (master/worker), server/production.
- ⚠️ `nodefony stop` cible le **mode dev** uniquement → pour tuer un **cluster**, utiliser `stop.sh`.
- **PLUSIEURS projets sur le poste** — le cas courant ici (le dépôt + une app générée par un banc).
  Les deux commandes sont **scopées au projet du répertoire courant** : elles ne comptent ni
  n'arrêtent jamais le runtime du voisin. Quand un autre projet tourne, `status` le NOMME dans une
  table (nom du `package.json`, process, ports tenus, racine) et **ce nom est ce que `stop`
  accepte** — inutile de se déplacer :

  ```bash
  node $BIN status                 # la table apparaît dès qu'un projet voisin tourne
  node $BIN stop bench-app         # par nom (ou nom de dossier)
  node $BIN stop /chemin/complet   # par chemin, quand deux projets sont homonymes
  ```

  Une cible qui ne désigne pas exactement UN projet est **refusée** (sortie `1`, rien n'est tué),
  avec la liste pour corriger. C'est voulu : un arrêt est irréversible, et « le plus proche »
  tuerait le mauvais serveur. Corollaire pour un agent : **ne jamais enchaîner `stop <cible>` sans
  lire son code de sortie** — un refus n'arrête rien, et le silence ressemble à un succès.

> **Modèle « 2 molettes » (2026-05-24)** : front (dev/prod) × topologie (`workers`).
>
> - **défaut = `development`** → TOUJOURS 1 process (Vite/HMR exige 1 maître).
> - **`--cluster [-w N]`** → runtime prod `nodefony cluster --workers N` (front prod, pas
>   de Vite), pour exercer la **vue pod / l'observabilité multi-process**. Défaut N=2 (un
>   vrai cluster). En cluster le front n'est pas servi tant que `renderProdTags()` (14.2)
>   n'est pas fait → l'API/observabilité (`/nodefony/realtime/api/health` → `cluster:true`)
>   reste testable. `staging`/`preprod` = **déprécié** (→ `cluster`). Topologie : voir
>   `nodefony/config/cluster/cluster.config.ts` (`cluster.workers`) ou `NODEFONY_WORKERS`.

Le script gère **tout** : kill des process Nodefony résiduels (+ rolldown) + ports → build conditionnel
module test → spawn detached du superviseur → wait boot (fail-fast) → verify 4 servers réseau → health
check. Sortie : marqueurs `>>>` sur stdout. Exit 0 = UP, exit 1 = crash/timeout. Log :
`/tmp/nodefony-server.log`, PID : `/tmp/srv.pid`.

> ✅ **Édit de la config app** (`nodefony.config.ts` / `env.ts` racine) en `development` : pris en
> compte **automatiquement**. Le DevSupervisor surveille ces fichiers (`#paths`) → une modif rebuild
> le root (`rolldown -c`) puis restart l'enfant. Au lancement, `#ensureBuilt` (turbo + vérif des `dist`
> sur disque) et `#rootDistStale` (mtime `index.ts`/`nodefony.config.ts`/`env.ts` vs `dist/index.js`)
> garantissent déjà un dist root frais. Le boot lit la config depuis `dist/{index,nodefony.config,env}.js`,
> pas la source → c'est le superviseur qui referme l'écart. cf [[feedback_root_dist_stale_modules]].
> ⚠️ En **`--cluster`** (runtime prod, PAS de superviseur), rebuilder le root manuellement avant le
> boot — `start.sh --cluster` le fait (turbo + `rolldown -c`).

## Pourquoi un script (et pas des commandes inline)

- **1 approbation au lieu de 8** — fini les prompts de permission à chaque étape.
- **Plus rapide** — build conditionnel (mtime source vs dist) : skip le rebuild ~10s si rien n'a changé.
- **Robuste** — kill des process Nodefony résiduels AVANT lsof (sinon le superviseur respawn sur le
  port), `rm` log avant spawn (faux positif READY), spawn `stdio` fd ouvert (pas pipe), wait fail-fast,
  health avec retry.
- **Reproductible** — même comportement à chaque fois, versionné, testé.

## Contexte critique (pourquoi spawn detached + binaire direct)

- En mode `development`, `start.sh` spawn le **DevSupervisor** (`nodefony development`), pas le serveur
  directement. Le superviseur garantit le dist au boot (`#ensureBuilt`), spawn l'enfant serveur, et
  auto-restart au changement backend. `start.sh` build aussi le module test conditionnellement (mtime
  source vs dist) — défense en profondeur côté routes de test.
- `nodefony development > log 2>&1 &` meurt immédiatement (SIGHUP du subshell) → le script utilise
  `spawn` Node.js `detached: true` + `unref()`.
- **Binaire en direct** (`node $BIN development`, `$BIN=node_modules/nodefony/bin/nodefony`) et **pas**
  `npx nodefony` : `npx` laissait un wrapper `npm exec nodefony` parasite en parent du superviseur
  (3 process au lieu de 2) et `srv.pid` pointait ce wrapper. En direct → superviseur en PPID 1,
  `srv.pid` = le vrai superviseur. (Le respawn de l'enfant par le superviseur était déjà direct.)

## Serveur dev = DevSupervisor auto-restart (actif depuis 2026-05-22)

`nodefony development` lance le **DevSupervisor** (`src/nodefony/src/service/dev/DevSupervisor.ts`) —
un superviseur « nodemon-like » cloud-native : le process serveur est jetable, recréé à chaque modif.

**Topologie** (confirmée par `ps` / `nodefony status`) :

```
node $BIN development                     ← lancé par start.sh (binaire direct, pas npx)
└─ nodefony-dev-supervisor (PPID 1)       ← parent CONSOLE, 0 serveur : watch + rebuild + restart
   └─ nodefony-dev-server                 ← enfant (NODEFONY_DEV_CHILD=1, leader de groupe detached)
      └─ nodefony-vite[...]               ← N instances Vite (ViteProcessSupervisor)
```

### `--no-watch` — développement SANS superviseur (1 seul process)

`nodefony development --no-watch` boote le serveur de dev **directement** : mêmes modules
(`policy:"dev"` inclus), mêmes erreurs détaillées, mais **aucun watcher, aucun rebuild, aucun
redémarrage**. La topologie tombe à `nodefony-dev-server` seul — pas de superviseur, donc rien
dans le pidfile de superviseur.

**Quand le prendre** : pour faire tourner une SUITE contre un serveur. Le rechargement automatique
est ce qu'on veut en codant et ce qu'on ne veut pas pendant un run — il coupe les connexions sous
les tests, et le rouge qui en sort accuse le code alors que le fautif est le décor (c'est
l'avertissement « ne pas éditer pendant un run intégration » du `CLAUDE.md` de `@nodefony/http`,
mais côté serveur). Se combine avec `--detach` : le drapeau survit au relais vers l'enfant.

### Éprouver la PRODUCTION avec les modules de banc — `NF_WITH_DEV_MODULES=1`

Par défaut, un runtime `production` ne charge pas les modules `policy:"dev"` — dont
`@nodefony/test`, qui porte les routes qu'interrogent les suites. Une suite lancée contre un
serveur de production reçoit donc `404` sur tout, et ce n'est pas un réglage à contourner : c'est
le rôle de cette politique.

Quand on veut malgré tout mesurer **le mode production** (intégration de bout en bout, banc de
charge, RPS) :

```bash
NF_WITH_DEV_MODULES=1 nodefony production --detach --wait      # modules dev chargés en prod
NF_WITH_DEV_MODULES=1 NF_WITH_DEV_MODULES_TTL_MIN=120 …        # campagne longue (charge)
```

**Le runtime s'arrête tout seul** — 30 min par défaut, réglable jusqu'à 4 h, **jamais
désarmable** (une valeur plus courte est ignorée). L'échéance est annoncée au démarrage, un
préavis tombe 5 min avant, et l'arrêt dit sa raison en `CRITIC`. Le but n'est pas de gêner le
banc : c'est qu'une variable oubliée dans une image ou un manifeste devienne un incident
immédiat au lieu d'une surface offerte pendant des mois.

⚠️ **Pour une campagne de charge, règle le TTL AVANT de lancer.** Un serveur qui tombe au milieu
d'une mesure ne rend pas une mesure fausse, il rend une mesure qu'on croira vraie.

Ce qu'il fait :

- **Boot durci** : `#ensureBuilt` AVANT le 1er spawn — `turbo run build` PUIS vérification des `dist`
  **sur disque** (anti « cache turbo trompeur » : exit 0 sans restaurer un dist supprimé = 404
  silencieux) ; `#rootDistStale` rebuild le root (`rolldown -c`) si une source racine a bougé.
- **Auto-restart backend** : watch chokidar des sources backend (`frontend/`, `dist/`, `tests/`
  exclus) → rebuild **ciblé** (`turbo --filter` + `rolldown -c` root si touché) → **group-kill** de
  l'enfant (`process.kill(-pid)` emporte les Vite → 0 orphelin) → attente ports libres
  (anti-`EADDRINUSE`) → respawn. Pas de HMR backend : Node ne décharge pas un module ESM importé.
- **HMR frontend préservé** : `frontend/` exclu du watch → une modif front passe en HMR Vite (0 restart).
- **framework-ready** par **sonde de ports** (0 IPC, observation externe) : `✓ serveur prêt en Xms`,
  ou `⚠ pas à l'écoute` si le boot ne vient jamais.
- **Single-instance robuste** : au démarrage, balaie `ps` et tue TOUT résiduel — superviseur empilé
  ET orphelins `nodefony-dev-server`/`-vite` laissés par un `kill -9` (pidfile périmé). Plus
  d'empilement.
- **Résilience « pas de dégradation silencieuse »** : (1) vérif dist sur disque ci-dessus ;
  (2) le superviseur interroge `livez` après « ports up » → `⚠ boot DÉGRADÉ` (au lieu de « ready »)
  si des modules sont tombés en fail-soft. cf [[project_resilience_no_silent_degradation]].

> **Tout le chantier DX du DevSupervisor est bouclé** (boot durci, auto-restart, status/stop natifs,
> single-instance, topologie propre, 3 parades). Détail : [[project_dev_supervisor_dx_kit]].

### Protocole "modif code + test via boot"

- **Modif backend pendant une session UP** → **rien à faire** : sauvegarde → le superviseur rebuild
  (ciblé) + restart automatiquement (`↻ changement` / `✓ build OK — rechargement` / `✓ serveur prêt`).
  Build en échec → serveur courant **conservé** (corrige puis sauvegarde). Pour un refactor
  multi-fichiers : l'anti-rebond regroupe les sauvegardes rapprochées en un seul restart.
- **Lancer / arrêter proprement** → `start.sh` (lancement initial des tests d'intégration) /
  `stop.sh` ou `nodefony stop` (arrêt complet). Plus besoin d'un `stop → start` manuel à chaque
  modif backend : le superviseur s'en charge en session.
- **Modif frontend** → HMR Vite (0 restart). Si le HMR ne s'applique pas (cert self-signed non
  _trusté_ → assets 5173 cross-origin bloqués), accepter le cert OU le rendre trusté (mkcert).

## Quand lancer en debug (`-d`)

| Cas                                            | Flag                                                |
| ---------------------------------------------- | --------------------------------------------------- |
| Tests d'intégration `npm run test:integration` | SANS `-d` (INFO suffit)                             |
| Diagnostiquer un crash au démarrage            | AVEC `-d` (révèle SERVICE/MODULE ADD, EVENT KERNEL) |
| Routes 404 inattendues                         | AVEC `-d` (liste les `route +` enregistrées)        |
| Mode "tourne en fond, je teste"                | SANS `-d` (moins de bruit)                          |

## Parsing des logs (debug rapide)

Format Pdu : `HH:MM:SS.mmm SEVERITY MSGID : payload`. Strip ANSI : `sed 's/\x1b\[[0-9;]*m//g'`.

```bash
# État de santé global (0 ERROR/CRITIC attendu)
sed 's/\x1b\[[0-9;]*m//g' /tmp/nodefony-server.log | grep -oE " (ERROR|CRITIC|WARNING) " | sort | uniq -c

# Erreurs uniquement
sed 's/\x1b\[[0-9;]*m//g' /tmp/nodefony-server.log | grep -E " (ERROR|CRITIC|EMERGENCY) "

# Routes enregistrées (debug -d requis)
sed 's/\x1b\[[0-9;]*m//g' /tmp/nodefony-server.log | grep "route +"

# Timeline boot (perf par phase)
sed 's/\x1b\[[0-9;]*m//g' /tmp/nodefony-server.log | grep -E "EVENT KERNEL|MODULE ADD|SERVICE ADD|Server Listen"

# Activité du DevSupervisor (boot durci, ready/dégradé, auto-restart, nettoyage orphelins)
sed 's/\x1b\[[0-9;]*m//g' /tmp/nodefony-server.log | grep -E "^\[dev\]"

# Le boot est-il sain ? (✓ framework ready) ou dégradé ? (⚠ DÉGRADÉ) ou muet ? (pas à l'écoute)
sed 's/\x1b\[[0-9;]*m//g' /tmp/nodefony-server.log | grep -E "framework ready|DÉGRADÉ|pas à l'écoute|résiduel"
```

## Symptômes courants

<!-- prettier-ignore -->
| Symptôme | Cause | Fix |
| --- | --- | --- |
| `SyntaxError: does not provide an export named 'X'` | dist d'un module périmé | `cd src/packages/@nodefony/<module> && npm run build` puis relancer (ou `--force-build`) |
| `start.sh` → `>>> FATAL` | crash au boot | Le script affiche le stack trace ; lire `/tmp/nodefony-server.log` |
| `start.sh` → `>>> TIMEOUT` | log FIGÉ 20s (hang réel) ou build > 120s | Plafond 120s + fail-fast (crash/process mort/log figé) : un TIMEOUT est un VRAI problème — lire `/tmp/nodefony-server.log` |
| `EADDRINUSE` | port occupé | `start.sh` kill avant spawn ; sinon `nodefony stop` (group-kill + attente ports) |
| 4 servers OK mais 404 sur `/nodefony/test/*` | dist module test périmé | `start.sh --force-build` |
| `⚠ boot DÉGRADÉ` au démarrage | modules tombés en fail-soft (dist absent/erreur) | `nodefony status` + lire les logs ; cause = un `dist` manquant → rebuild le module fautif |
| Plusieurs superviseurs / process orphelins | `kill -9` brutal (pidfile périmé) | `nodefony stop` (ou relancer : le superviseur balaie `ps` et nettoie au démarrage) |
| Modif backend pas prise | superviseur mort, OU fichier hors watch (`frontend/`/`tests/`) | `nodefony status` (superviseur vivant ?) ; sinon `start.sh` |
| Page front noire / `ERR_CERT_AUTHORITY_INVALID` | cert self-signed non _trusté_ → assets cross-origin 5173 bloqués | accepter le cert OU (vrai fix) cert trusté via mkcert — cf kit `project_dev_supervisor_hmr_kit` |

## Maintenance des scripts

- `start.sh` / `stop.sh` sont dans ce dossier (`.claude/skills/nodefony-start-server/`).
- Ports en dur : 5151 (http/ws) + 5152 (https/wss). Module test : `src/modules/test`.
- Si le port ou le chemin du module test change → éditer les variables en tête de `start.sh`.
- `start.sh` **et** `stop.sh` dérivent la racine repo de **`BASH_SOURCE`** (chemin absolu) → invocables depuis n'importe quel cwd, y compris après un `cd <subdir>` (piège `feedback_cd_startsh_relative_path` corrigé 2026-05-21).
- Les deux lancent le binaire **en direct** (`node "$ROOT/node_modules/nodefony/bin/nodefony" …`), jamais `npx` → pas de wrapper `npm exec` parasite, et économie de ~1,3 s d'overhead npx par appel.
- **Le décor posé par `start.sh` fait partie du contrat des bancs** — trois variables, chacune surchargeable :
  `NODE_OPTIONS=--expose-gc` (le gate mémoire mesure le heap RETENU), `NF__SECURITY__RATELIMIT__ENABLED=false`
  (le backoff de login est global et épuiserait le compte de banc), et `NODE_EXTRA_CA_CERTS` = la CA de
  développement du dépôt (le serveur se joint **lui-même en https** pour découvrir ses propres métadonnées
  RFC 8414 — banc `http/external-jwt-e2e.test.ts`). C'est une ancre de confiance AJOUTÉE, jamais un
  `NODE_TLS_REJECT_UNAUTHORIZED` : un vrai défaut de certificat reste visible. Serveur lancé autrement ⇒ la
  zone `test-self-external` rend **503** et le banc le dit dans son message d'échec.

## Liens

- Mémoire IA `project_dev_supervisor_dx_kit` — **chantier DevSupervisor** (boot durci, auto-restart, status/stop, single-instance, topologie) — référence à jour
- Mémoire IA `project_resilience_no_silent_degradation` — principe « pas de dégradation silencieuse » (fail-soft dispo / fail-loud dégradation)
- Mémoire IA `feedback_server_startup` — procédure fiable de démarrage
- Mémoire IA `feedback_server_kill_oneshot` — kill one-shot (watch avant lsof)
- Mémoire IA `feedback_watch_rollup_pitfall` — piège watch Rollup runtime (**historique** : ce watch a été retiré, remplacé par le DevSupervisor)
- Code : `src/nodefony/src/service/dev/` — `DevSupervisor.ts`, `devProcess.ts` (`status`), `devStop.ts` (`stop`)
