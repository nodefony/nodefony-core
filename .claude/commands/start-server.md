---
description: Serveur Nodefony dev — start / stop / restart / debug / build (délègue au skill nodefony-start-server)
argument-hint: "[start | stop | restart | debug | build | help]"
---

Tu exécutes `/start-server` avec l'argument : **"$ARGUMENTS"**

Toute la logique vit dans le skill `nodefony-start-server`
(`.claude/skills/nodefony-start-server/{start.sh,stop.sh}`). Cette command ne fait
que **router l'argument vers le bon appel de script** — ne réimplémente rien.

Mappe l'argument (insensible casse/accents ; vide → `start`) puis lance la commande Bash correspondante :

| Argument (alias) | Commande Bash à exécuter |
|------------------|--------------------------|
| `start` (vide, `up`, `lance`, `démarre`) | `bash .claude/skills/nodefony-start-server/start.sh` |
| `stop` (`down`, `kill`, `arrête`) | `bash .claude/skills/nodefony-start-server/stop.sh` |
| `restart` (`relance`, `redémarre`) | `bash .claude/skills/nodefony-start-server/stop.sh && bash .claude/skills/nodefony-start-server/start.sh` |
| `debug` (`-d`, `verbose`) | `bash .claude/skills/nodefony-start-server/start.sh -d` |
| `build` (`rebuild`, `--force-build`, `force`) | `bash .claude/skills/nodefony-start-server/start.sh --force-build` |
| `debug build` (combinés) | `bash .claude/skills/nodefony-start-server/start.sh -d --force-build` |
| `help` (`aide`, `?`) | **N'exécute rien** — affiche seulement ce tableau |

Flags combinables : `-d` (logs DEBUG verbeux) et `--force-build` (rebuild module test
même si dist à jour) peuvent coexister.

Après un `start`/`restart`/`debug`/`build` : reporte l'état final (PID, ports 5151/5152,
HEALTH) tel que sorti par `start.sh`. Si le boot échoue, lis les logs via le skill
`nodefony-tail-error-logs`.
