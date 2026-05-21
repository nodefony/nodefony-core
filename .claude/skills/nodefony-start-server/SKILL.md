---
name: nodefony-start-server
description: >
  Lance le serveur Nodefony en mode développement pour les tests d'intégration — script unique
  start.sh (1 commande, 1 approbation) : build conditionnel du module test, kill watch+ports, spawn
  detached, wait boot fail-fast, health check.
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
```

Arrêter :
```bash
bash .claude/skills/nodefony-start-server/stop.sh
```

Le script gère **tout** : kill watch+rollup+ports → build conditionnel module test → spawn detached
→ wait boot (fail-fast) → verify 4 servers réseau → health check. Sortie : marqueurs `>>>` sur stdout.
Exit 0 = UP, exit 1 = crash/timeout. Log : `/tmp/nodefony-server.log`, PID : `/tmp/srv.pid`.

## Pourquoi un script (et pas des commandes inline)

- **1 approbation au lieu de 8** — fini les prompts de permission à chaque étape.
- **Plus rapide** — build conditionnel (mtime source vs dist) : skip le rebuild ~10s si rien n'a changé.
- **Robuste** — kill watch/rollup AVANT lsof (sinon respawn), `rm` log avant spawn (faux positif READY),
  spawn `stdio` fd ouvert (pas pipe), wait fail-fast, health avec retry.
- **Reproductible** — même comportement à chaque fois, versionné, testé.

## Contexte critique (pourquoi spawn detached)

- En mode `development`, Nodefony charge le `dist/` existant au boot. `start.sh` build le module test
  conditionnellement (mtime source vs dist) avant de spawn pour garantir les routes à jour.
- `npx nodefony development > log 2>&1 &` meurt immédiatement (SIGHUP du subshell) → le script utilise
  `spawn` Node.js `detached: true` + `unref()`.

## Serveur dev = DevSupervisor (auto-restart, depuis 2026-05-22)

`npx nodefony development` lance un **`DevSupervisor`** (process parent) qui spawn le serveur dans un
process **enfant** (`NODEFONY_DEV_CHILD=1`) et surveille les sources **backend**. À chaque save d'un
`.ts` backend : **rebuild ciblé** (`turbo --filter=<module>...`) → **restart de l'enfant** (~5s),
visible en logs `[dev] changement → rebuild → restart`. Les modifs **frontend** (`**/frontend/**`)
restent en **HMR Vite** → **0 restart**.

> L'ancien **watch Rollup write-only** (qui écrasait le `dist/` ~12s après boot → mismatch dist/log
> silencieux) a été **SUPPRIMÉ**. Plus de piège silencieux : un changement backend = restart explicite.

### Protocole "modif code + test via boot"

- **Modif backend pendant que le serveur tourne** → le superviseur rebuild + restart **tout seul** (~5s).
  Attendre le `[dev] build OK — restart` puis tester. **NE PAS** lancer de `npm run build` manuel en
  parallèle (le superviseur build déjà → race sur le dist).
- **Refactor multi-fichiers** : soit `stop.sh` avant (édite tout, puis `start.sh`), soit laisser le
  superviseur enchaîner (anti-rebond 250ms regroupe les saves quasi-simultanées).
- **Tests d'intégration / memory** : serveur stable suffit (pas de modif `.ts` pendant). Pour 0 bruit →
  `stop.sh` + serveur enfant direct `NODEFONY_DEV_CHILD=1`.

## Quand lancer en debug (`-d`)

| Cas | Flag |
| --- | ---- |
| Tests d'intégration `npm run test:integration` | SANS `-d` (INFO suffit) |
| Diagnostiquer un crash au démarrage | AVEC `-d` (révèle SERVICE/MODULE ADD, EVENT KERNEL) |
| Routes 404 inattendues | AVEC `-d` (liste les `route +` enregistrées) |
| Mode "tourne en fond, je teste" | SANS `-d` (moins de bruit) |

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

# Le watch a-t-il réécrit le dist après boot ?
sed 's/\x1b\[[0-9;]*m//g' /tmp/nodefony-server.log | grep "Rollup Module" | grep "write rollup"
```

## Symptômes courants

| Symptôme | Cause | Fix |
| -------- | ----- | --- |
| `SyntaxError: does not provide an export named 'X'` | dist d'un module périmé | `cd src/packages/@nodefony/<module> && npm run build` puis relancer (ou `--force-build`) |
| `start.sh` → `>>> FATAL` | crash au boot | Le script affiche le stack trace ; lire `/tmp/nodefony-server.log` |
| `start.sh` → `>>> TIMEOUT` | Rollup lent / kernel bloqué | Vérifier `ps aux \| grep rollup` ; relancer |
| `EADDRINUSE` | port occupé | `start.sh` kill avant spawn ; si persiste, process zombie hors lsof |
| 4 servers OK mais 404 sur `/nodefony/test/*` | dist module test périmé | `start.sh --force-build` |
| Modif backend pas prise | le superviseur n'a pas fini son cycle, ou build en échec | regarder les logs `[dev]` ; attendre `build OK — restart` ; ne pas lancer de build manuel concurrent |
| `ERR_MODULE_NOT_FOUND` au boot enfant | build manuel concurrent du superviseur (race dist) | relancer ; ne pas builder en parallèle du superviseur |

## Maintenance des scripts

- `start.sh` / `stop.sh` sont dans ce dossier (`.claude/skills/nodefony-start-server/`).
- Ports en dur : 5151 (http/ws) + 5152 (https/wss). Module test : `src/modules/test`.
- Si le port ou le chemin du module test change → éditer les variables en tête de `start.sh`.
- `start.sh` dérive la racine repo de **`BASH_SOURCE`** (chemin absolu) → invocable depuis n'importe quel cwd, y compris après un `cd <subdir>` (piège `feedback_cd_startsh_relative_path` corrigé 2026-05-21).

## Liens

- Mémoire IA `feedback_server_startup` — procédure fiable de démarrage
- Mémoire IA `feedback_server_kill_oneshot` — kill one-shot (watch avant lsof)
- Mémoire IA `feedback_watch_rollup_pitfall` — piège watch runtime
