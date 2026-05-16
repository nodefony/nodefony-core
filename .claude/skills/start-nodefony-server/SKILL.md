---
name: start-nodefony-server
description: >
  Lance le serveur Nodefony en mode développement pour les tests d'intégration.
  Rebuilde le module test, tue les ports 5151/5152, démarre le serveur avec la technique
  spawn Node.js (detached), attend le démarrage, et confirme que les 4 serveurs écoutent.
  Utilise ce skill dès que l'utilisateur dit "lance le serveur", "démarre nodefony",
  "relance le serveur", "start server", "start nodefony", "redémarre le serveur",
  ou toute variante indiquant qu'il faut démarrer ou redémarrer le serveur Nodefony.
  Également utile si les tests d'intégration échouent avec des 404 (dist périmé → rebuild + restart).
---

# start-nodefony-server

Lance le serveur Nodefony en mode développement de manière fiable pour les tests d'intégration `@nodefony/http`.

## Contexte critique

En mode `development`, Nodefony charge le `dist/` existant au démarrage (les routes sont enregistrées à ce moment),
puis recompile avec Rollup ~12 s plus tard et écrase le dist.
**Si le source a changé depuis le dernier build manuel, les nouvelles routes seront absentes du routeur.**

De plus, `npx nodefony development > log 2>&1 &` meurt immédiatement (SIGHUP du subshell).
Il faut utiliser `spawn` Node.js avec `detached: true`.

## Étapes à exécuter dans l'ordre

### 1. Tuer les processus existants sur 5151/5152

```bash
lsof -ti:5151 -ti:5152 | xargs kill -9 2>/dev/null; sleep 1; echo "ports libérés"
```

### 2. Rebuilder le module test

```bash
cd /Users/cci/repository/nodefony-core/src/modules/test && npm run build 2>&1 | tail -3
```

Vérifier que le build se termine par `created dist in X.Xs`.

### 3. Démarrer le serveur (technique fiable)

```bash
node -e "
const { spawn } = require('child_process');
const child = spawn('npx', ['nodefony', 'development'], {
  cwd: '/Users/cci/repository/nodefony-core',
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true
});
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
child.unref();
require('fs').writeFileSync('/tmp/srv.pid', String(child.pid));
console.log('SERVER PID=' + child.pid);
" > /tmp/nodefony-server.log 2>&1 &
echo "launcher PID=$!"
```

### 4. Attendre le démarrage AVEC fail-fast sur erreur fatale

Le serveur prend ~12 s pour charger les modules + ~8 s pour Rollup.
**IMPORTANT** : ne JAMAIS `sleep 20` en aveugle. Surveiller le log et abandonner immédiatement si le kernel crash (SyntaxError, CRITIC, terminate, EADDRINUSE).

Lancer cette boucle qui termine soit en succès, soit en échec rapide :

```bash
for i in $(seq 1 40); do
  if grep -q -E "SyntaxError|CRITIC|EADDRINUSE|ALREADY USE|terminate :" /tmp/nodefony-server.log 2>/dev/null; then
    echo "FATAL — le serveur a crashé au démarrage"
    grep -E "SyntaxError|CRITIC|terminate|EADDRINUSE" /tmp/nodefony-server.log | sed 's/\x1b\[[0-9;]*m//g' | tail -15
    exit 1
  fi
  if [ "$(grep -c 'Server Listen on' /tmp/nodefony-server.log 2>/dev/null)" -ge 4 ]; then
    echo "READY"
    break
  fi
  sleep 0.5
done
```

**Heuristique de détection fatale** :
- `SyntaxError` → import manquant (dist d'un module périmé → `npm run build` sur ce workspace)
- `CRITIC` → erreur niveau kernel
- `terminate :` → le kernel s'est éteint
- `EADDRINUSE` / `ALREADY USE` → port déjà occupé (autre process à tuer)

**Quand fatal** : NE PAS sleep ni continuer. Diagnostiquer et corriger AVANT toute autre action.

### 5. Vérifier que les 4 serveurs écoutent

```bash
grep "Server Listen" /tmp/nodefony-server.log | sed 's/\x1b\[[0-9;]*m//g'
```

Résultat attendu (4 lignes) :
```
INFO server-static  : Server Listen on .../public
INFO server-http    : Server Listen on http://127.0.0.1:5151
INFO server-https   : Server Listen on https://127.0.0.1:5152
INFO server-websocket : Server Listen on ws://127.0.0.1:5151
INFO server-websocket-secure : Server Listen on wss://127.0.0.1:5152
```

### 6. Test de santé rapide

```bash
node -e "
const https = require('https');
https.request({hostname:'127.0.0.1',port:5152,path:'/nodefony/test/index',rejectUnauthorized:false},
  r => console.log('HEALTH ' + r.statusCode)).on('error', e => console.log('ERR ' + e.code)).end();
" 2>/dev/null
```

Attendu : `HEALTH 200`. Si `ERR ECONNREFUSED`, le serveur n'a pas démarré — vérifier les logs.

## Lecture des logs pour diagnostiquer les bugs

```bash
# Toutes les erreurs
grep -E "ERROR|CRITIC|SyntaxError|terminate" /tmp/nodefony-server.log | sed 's/\x1b\[[0-9;]*m//g'

# Routes 404 (dist périmé → rebuild + restart)
grep "404" /tmp/nodefony-server.log | sed 's/\x1b\[[0-9;]*m//g' | tail -10

# Erreur port déjà utilisé
grep "ALREADY USE\|EADDRINUSE" /tmp/nodefony-server.log | sed 's/\x1b\[[0-9;]*m//g'
```

### Symptômes courants

| Symptôme dans le log                                                                  | Cause                                              | Fix                                                                    |
| ------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------- |
| `SyntaxError: does not provide an export named 'X'`                                   | dist d'un module périmé qui n'a pas le symbole X    | `cd src/packages/@nodefony/<module> && npm run build` puis relancer    |
| `CRITIC KERNEL ... terminate : 0` juste après boot                                    | crash au chargement, voir lignes précédentes        | Lire le stack trace dans le log                                        |
| Pas de "Server Listen on" après 20s + aucune erreur                                   | Rollup est lent, ou le kernel est bloqué            | Vérifier `ps aux \| grep rollup` ; relancer si bloqué                  |
| `EADDRINUSE 5151/5152`                                                                | Autre process sur les ports                         | `lsof -ti:5151 -ti:5152 \| xargs kill -9`                              |
| 4 serveurs OK mais routes 404 pour `/nodefony/test/...`                               | dist du module test périmé                          | `cd src/modules/test && npm run build` puis relancer                   |

## Rapport final à donner à l'utilisateur

- PID du serveur : `cat /tmp/srv.pid`
- Ports actifs : `lsof -ti:5151 -ti:5152`
- Résumé : "Serveur UP — http://127.0.0.1:5151 | https://127.0.0.1:5152"

## Arrêter le serveur

```bash
lsof -ti:5151 -ti:5152 | xargs kill -9 2>/dev/null
```
