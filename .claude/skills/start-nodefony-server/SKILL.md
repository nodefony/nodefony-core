---
name: start-nodefony-server
description: >
  Lance le serveur Nodefony en mode développement pour les tests d'intégration.
  TOUT est consolidé dans un script unique (start.sh) → 1 seule commande, 1 seule approbation.
  Build conditionnel du module test (skip si dist à jour → gain de temps), kill watch+ports,
  spawn detached, wait boot avec fail-fast, health check.
  Utilise ce skill dès que l'utilisateur dit "lance le serveur", "démarre nodefony",
  "relance le serveur", "start server", "redémarre le serveur", ou toute variante.
  Également utile si les tests d'intégration échouent avec des 404 (dist périmé → rebuild + restart).
---

# start-nodefony-server

Démarre le serveur Nodefony (development) de manière fiable. **Workflow consolidé en 2 scripts**
pour éliminer la friction (avant : ~8 commandes Bash, chacune pouvant demander une approbation ;
maintenant : 1 seule).

## ⚡ Usage — 1 commande

```bash
bash .claude/skills/start-nodefony-server/start.sh
```

Variantes :
```bash
bash .claude/skills/start-nodefony-server/start.sh -d            # mode debug (logs DEBUG verbeux)
bash .claude/skills/start-nodefony-server/start.sh --force-build # force rebuild module test
```

Arrêter :
```bash
bash .claude/skills/start-nodefony-server/stop.sh
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

- En mode `development`, Nodefony charge le `dist/` existant au boot, puis recompile (~12s) et l'écrase.
  Si le source a changé depuis le dernier build, les routes seront absentes → `start.sh` build le module
  test conditionnellement avant de spawn.
- `npx nodefony development > log 2>&1 &` meurt immédiatement (SIGHUP du subshell) → le script utilise
  `spawn` Node.js `detached: true` + `unref()`.

## 🚨 Piège ABSOLU — le watch Rollup runtime écrase le dist

En mode `development`, le serveur lance un **watch Rollup runtime** qui re-build chaque workspace ~12s
après le boot et **écrase les `dist/`**. Le piège classique : "mon code est dans le dist mais le runtime
affiche l'ancien comportement" → 99% c'est le watch, pas un bug.

### Protocole "modif code + test via boot"

À CHAQUE itération de fix où on vérifie le comportement runtime :

1. **Tuer le serveur AVANT de modifier** : `bash .claude/skills/start-nodefony-server/stop.sh`
   (libère le watch — sinon il écrase ton dist pendant que tu édites).
2. Modifier le code (`Edit`/`Write` libres — pas de watch actif).
3. Relancer : `bash .claude/skills/start-nodefony-server/start.sh` (build conditionnel inclus).
4. **Grep le log DANS LES ~6s** après `>>> READY` — avant que le nouveau watch ne réécrive.

### Signal d'alarme

`grep "ma_modif" dist/...` OK mais `grep "ma_modif" log` retourne 0 → c'est le watch, pas un bug.
Vérifier mtime : `stat -f "%Sm" dist/.../file.js` — si APRÈS le spawn → le watch a réécrit.

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
| Modifs pas prises malgré rebuild | watch Rollup a écrasé le dist | `stop.sh` AVANT modif, puis `start.sh` |

## Maintenance des scripts

- `start.sh` / `stop.sh` sont dans ce dossier (`.claude/skills/start-nodefony-server/`).
- Ports en dur : 5151 (http/ws) + 5152 (https/wss). Module test : `src/modules/test`.
- Si le port ou le chemin du module test change → éditer les variables en tête de `start.sh`.
- Les scripts dérivent la racine de `$(pwd)` → lancer depuis la racine du repo.

## Liens

- Mémoire IA `feedback_server_startup` — procédure fiable de démarrage
- Mémoire IA `feedback_server_kill_oneshot` — kill one-shot (watch avant lsof)
- Mémoire IA `feedback_watch_rollup_pitfall` — piège watch runtime
