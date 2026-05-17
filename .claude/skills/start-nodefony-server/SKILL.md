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

## Visibilité dans le terminal Claude — règle d'or

Le boot Nodefony prend **~12 secondes**. Pendant ces secondes, le terminal paraît bloqué.
Pour que l'utilisateur (humain ou Claude) ne pense PAS que c'est gelé :

- **AVANT chaque étape**, émettre un marqueur clair en stdout : `>>> STEP X — ...`
- **PENDANT l'attente**, afficher la progression (compteur servers up / 4) à intervalle court
- **APRÈS**, statut final explicite : `>>> READY` ou `>>> FATAL`
- **AU KILL**, marqueur : `>>> KILL ports 5151/5152`

Format adopté ci-dessous. Ne pas le simplifier — la verbosité est volontaire.

## 🚨 Piège ABSOLU — le watch Rollup runtime écrase le dist

**Lu et appliqué AVANT toute modification de code pendant qu'un serveur dev tourne.**

En mode `development`, le serveur Nodefony lance un **watch Rollup runtime** qui re-build chaque workspace ~12s après le boot et **écrase les `dist/`**. Toute édition de fichier `.ts` source déclenche un rebuild du watch. Le piège :

1. Modif code source TS
2. `npm run build` manuel → dist contient la modif
3. Spawn nodefony → Node.js charge le dist en mémoire (avec la modif) ✅
4. ~12s plus tard, le watch du serveur re-build et écrit un nouveau dist
5. Si entre-temps tu as modifié à nouveau le source, ton dist final ne reflète plus ce que Node.js a chargé
6. Tu `grep` le dist (avec la modif), tu `grep` le log (avec l'ancien format) → mismatch dist/log

**Symptôme classique** : "mon code est dans le dist mais le runtime affiche l'ancien comportement" → 99% le piège, pas un bug.

### Protocole "modif code + test via boot"

À CHAQUE itération de fix où on doit vérifier le comportement runtime :

1. **Vérifier serveur en cours** : `lsof -ti:5151 -ti:5152` — si PID retourné, **tuer**
2. **Annoncer** au user : "serveur tué pour libérer le watch, je modifie X, je relance"
3. **Modifier le code** (`Edit` / `Write` libres — pas de watch actif pour interférer)
4. **`npm run clean && npm run build`** (pas juste `build`, turbo peut skip à tort)
5. **Spawn nodefony** dans la foulée
6. **Grep le log DANS LES 6 PREMIÈRES SECONDES** après `Server Listen` — avant que le nouveau watch n'écrase
7. **Tuer le serveur** avant la prochaine modif si on re-itère

### Signaux d'alarme

- `stat -f "%Sm" dist/.../file.js` — si mtime APRÈS le moment du spawn → watch a réécrit, ta vue du dist ne reflète plus ce que Node.js a chargé
- `grep ma_modif dist/...` retourne OK mais `grep ma_modif log` retourne 0 → c'est le piège, pas un bug
- `npm run build` affiche "X cached" pour un workspace modifié → turbo skip à tort, faire `clean` d'abord

### Trick de debug — marqueur unique

Si tu doutes que ton code est exécuté, ajoute un marqueur unique dans le log que tu modifies :

```ts
this.log(`>>>NEW route + ${r.toLogLine()}`, "DEBUG");
```

Puis `grep ">>>NEW"` dans le log — si présent → ton code tourne, mismatch ailleurs. Si absent → le dist chargé en mémoire au boot n'avait PAS ta modif (problème de timing watch).

## Quand lancer en debug (`-d`) ou pas

| Cas d'usage                                            | Flag             | Pourquoi                                          |
| ------------------------------------------------------ | ---------------- | ------------------------------------------------- |
| Tests d'intégration `npm run test:integration`         | **SANS `-d`**    | INFO seul, ~30 lignes au boot, suffisant          |
| Diagnostiquer un crash au démarrage                    | **AVEC `-d`**    | DEBUG révèle SERVICE ADD, MODULE ADD, EVENT KERNEL — voir où ça plante |
| Routes 404 inattendues                                 | **AVEC `-d`**    | Le log `route + [METHODS] path → @module/Ctrl.action` liste tout ce qui est enregistré |
| Bench / mesure de perf du boot                         | **AVEC `-d`**    | Les timestamps ms (`HH:MM:SS.mmm`) permettent de mesurer chaque phase |
| Mode "tourne en arrière-plan, je teste mes requêtes"   | **SANS `-d`**    | Moins de bruit dans le log, plus rapide à parser  |

Par défaut → SANS `-d` pour les workflows automatisés. AVEC `-d` seulement quand on diagnostique.

## Étapes à exécuter dans l'ordre

### 1. Tuer les processus existants sur 5151/5152

```bash
echo ">>> KILL ports 5151/5152"
PIDS=$(lsof -ti:5151 -ti:5152 2>/dev/null)
[ -n "$PIDS" ] && kill -9 $PIDS 2>/dev/null
sleep 1
echo ">>> ports libres"
```

> **Pourquoi ce pattern et pas `lsof ... | xargs kill -9`** : sur macOS, `xargs` (BSD) n'a pas l'option `-r`/`--no-run-if-empty`. Si aucun port n'est pris, `xargs` exécute `kill -9` sans argument → l'erreur `kill: usage: kill ...` est imprimée. Le pattern `PIDS=$(...); [ -n "$PIDS" ] && kill ...` évite ce bruit et reste portable.

### 2. Rebuilder le module test

> **Pré-requis** : être dans la racine du repo (`pwd` doit contenir `package.json` avec `"workspaces"`). Le chemin n'est plus codé en dur — on dérive de `$(pwd)` pour rester portable (autre dev, CI, container).

```bash
echo ">>> BUILD src/modules/test (cwd=$(pwd))"
(cd "$(pwd)/src/modules/test" && npm run build 2>&1 | tail -3)
echo ">>> build OK"
```

Vérifier que le build se termine par `created dist in X.Xs`.

### 3. Démarrer le serveur (technique fiable)

> **Trois durcissements vs version précédente** :
>
> 1. **`rm -f` du log AVANT spawn** — sinon le waiter (étape 4) compte les `Server Listen on` du boot précédent et déclare `>>> READY` immédiatement (faux positif).
> 2. **`stdio: ['ignore', out, out]` avec un descripteur de fichier ouvert** — au lieu de `'pipe'` + `child.stdout.pipe(process.stdout)` + `> log 2>&1 &`. Plus robuste : quand le launcher Node parent s'arrête (après `unref()`), les pipes JS se cassent, alors que le descripteur de fichier reste valide tant que le child vit. **Pas de coût** : Node passe juste l'fd au child via `dup2()`.
> 3. **`process.cwd()`** au lieu d'un chemin en dur — portable.

```bash
echo ">>> SPAWN nodefony development (detached)"
rm -f /tmp/nodefony-server.log
node -e "
const { spawn } = require('child_process');
const fs = require('fs');
const out = fs.openSync('/tmp/nodefony-server.log', 'w');
const child = spawn('npx', ['nodefony', 'development'], {
  cwd: process.cwd(),
  stdio: ['ignore', out, out],
  detached: true
});
child.unref();
fs.writeFileSync('/tmp/srv.pid', String(child.pid));
console.log('SERVER PID=' + child.pid);
"
```

> **Avec debug** : remplacer `['nodefony', 'development']` par `['nodefony', '-d', 'development']`.

### 4. Attendre le démarrage AVEC progression visible + fail-fast

Le serveur prend ~12 s pour charger les modules + ~8 s pour Rollup.
**IMPORTANT** : ne JAMAIS `sleep 20` en aveugle. Surveiller le log, afficher la progression, abandonner immédiatement si crash.

```bash
echo ">>> WAIT boot (max 20s, check every 0.5s)"
for i in $(seq 1 40); do
  if grep -q -E "SyntaxError|CRITIC|EADDRINUSE|ALREADY USE|terminate :" /tmp/nodefony-server.log 2>/dev/null; then
    echo ">>> FATAL — le serveur a crashé au démarrage"
    grep -E "SyntaxError|CRITIC|terminate|EADDRINUSE" /tmp/nodefony-server.log | sed 's/\x1b\[[0-9;]*m//g' | tail -15
    exit 1
  fi
  COUNT=$(grep -c "Server Listen on" /tmp/nodefony-server.log 2>/dev/null || echo 0)
  if [ "$COUNT" -ge 4 ]; then
    echo ">>> READY — $COUNT servers listening (took ${i} × 0.5s)"
    break
  fi
  # Progression visible toutes les 2s pour rassurer
  if [ $((i % 4)) -eq 0 ]; then
    echo ">>> ... booting ($COUNT/4 servers up, ${i}×0.5s elapsed)"
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
echo ">>> VERIFY servers listening"
grep "Server Listen" /tmp/nodefony-server.log | sed 's/\x1b\[[0-9;]*m//g'
```

Résultat attendu (4 lignes) :

```
INFO server-http    : Server Listen on http://127.0.0.1:5151
INFO server-https   : Server Listen on https://127.0.0.1:5152
INFO server-websocket : Server Listen on ws://127.0.0.1:5151
INFO server-websocket-secure : Server Listen on wss://127.0.0.1:5152
```

### 6. Test de santé rapide

> **Pourquoi le `timeout: 2000`** : sans ça, si le serveur accepte la connexion TCP mais freeze AVANT d'envoyer les headers HTTP (boucle synchrone Rollup, lock GC, etc.), `https.request` attend indéfiniment et bloque la session Claude. Le `req.destroy()` sur timeout force `error` et déverrouille.

```bash
echo ">>> HEALTH check /nodefony/test/index"
node -e "
const https = require('https');
const req = https.request({
  hostname:'127.0.0.1', port:5152, path:'/nodefony/test/index',
  rejectUnauthorized:false, timeout: 2000
}, r => { console.log('HEALTH ' + r.statusCode); r.resume(); req.destroy(); });
req.on('error', e => { if (e.code !== 'ECONNRESET') console.log('ERR ' + e.code); });
req.on('timeout', () => { console.log('ERR TIMEOUT'); req.destroy(); });
req.end();
" 2>/dev/null
```

Attendu : `HEALTH 200`. Si `ERR ECONNREFUSED`, le serveur n'a pas démarré. Si `ERR TIMEOUT`, le serveur écoute mais freeze sur la requête — vérifier les logs serveur pour un blocage event-loop.

> **Pourquoi `r.resume()` + `req.destroy()` dans le callback** : Node.js garde le socket TCP en keep-alive après la réception du status. Sans destroy explicite, l'event `timeout` fire 2s plus tard et imprime un faux `ERR TIMEOUT` après le `HEALTH 200`. Le `r.resume()` draine le body (sinon le socket reste half-open). Le filtre `e.code !== 'ECONNRESET'` masque l'erreur attendue qui suit `req.destroy()`.

## Parsing des logs de démarrage — debug rapide

Le format Pdu (depuis 2026-05-17) est `HH:MM:SS.mmm SEVERITY MSGID : payload`. Tous les filtres ci-dessous fonctionnent quel que soit le mode (avec ou sans `-d`).

### Tout en un — état de santé global

```bash
sed 's/\x1b\[[0-9;]*m//g' /tmp/nodefony-server.log | grep -oE " (DEBUG|INFO|NOTICE|WARNING|ERROR|CRITIC|ALERT|EMERGENCY) " | sort | uniq -c | sort -rn
```

Résultat normal : 0 ERROR, 0 CRITIC. Si > 0 → investiguer.

### Erreurs et crashs uniquement

```bash
sed 's/\x1b\[[0-9;]*m//g' /tmp/nodefony-server.log | grep -E " (ERROR|CRITIC|EMERGENCY) "
```

### Warnings (overrides config, ORM, TS compile)

```bash
sed 's/\x1b\[[0-9;]*m//g' /tmp/nodefony-server.log | grep " WARNING "
```

### Timeline du boot (perf par phase, résolution ms)

```bash
sed 's/\x1b\[[0-9;]*m//g' /tmp/nodefony-server.log | grep -E "EVENT KERNEL|MODULE ADD|SERVICE ADD|Server Listen"
```

Ordre attendu :

```
SERVICE ADD : rollup / watcher
EVENT KERNEL onPreStart
MODULE ADD : app / sequelize / http / framework / security / test
EVENT KERNEL onCluster / onRegister / onPreBoot
SERVICE ADD : HttpKernel / certificates / sessions / server-http / ...
EVENT KERNEL onBoot / onReady / onServersReady / onPostReady
Server Listen on http://127.0.0.1:5151 ...
```

Pour mesurer une phase : prendre les 2 timestamps qui l'encadrent et soustraire.

### Routes enregistrées (debug `-d` requis)

```bash
sed 's/\x1b\[[0-9;]*m//g' /tmp/nodefony-server.log | grep "route +"
```

Chaque ligne :

```
DEBUG MODULE test : route + [GET|HEAD]  /nodefony/test/index → @test/DefaultController.index
DEBUG MODULE test : route + [ANY]       /nodefony/test/crash/sync → @test/DefaultController.crashSync
DEBUG MODULE app  : route + [ANY]       /                          → @app/AppController.index  (no auth)
```

Utile pour :

- Lister toutes les routes connues du routeur
- Trouver d'où vient une route 404 (chercher le path : si absent → route pas enregistrée)
- Vérifier qu'un nouveau controller a bien été pris en compte après rebuild

### Routes 404 réellement servies

```bash
sed 's/\x1b\[[0-9;]*m//g' /tmp/nodefony-server.log | grep " 404 "
```

→ Si la route existe en `route +` mais sert 404 : problème de matching path/method.
→ Si absente des `route +` : dist du module périmé, rebuild requis.

### Détection rapide "watch Rollup runtime a écrasé le dist"

Le watch Rollup runtime du serveur en mode dev re-compile les workspaces ~12s après le boot et écrase les `dist/`. Si tu modifies un source et relances le serveur SANS rebuild manuel, le nouveau dist sera celui que Rollup runtime produira — pas celui que tu as compilé entre temps.

```bash
sed 's/\x1b\[[0-9;]*m//g' /tmp/nodefony-server.log | grep "Rollup Module" | grep "write rollup"
```

→ Liste les modules re-buildés par le watch runtime, avec timestamp.
→ Si timestamp > moment du boot : le dist a été écrasé après le démarrage. Pour un test reproductible, tuer le serveur AVANT de modifier les sources, rebuilder manuellement, et seulement APRÈS relancer.

## Symptômes courants

| Symptôme dans le log                                                                  | Cause                                              | Fix                                                                    |
| ------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------- |
| `SyntaxError: does not provide an export named 'X'`                                   | dist d'un module périmé qui n'a pas le symbole X    | `cd src/packages/@nodefony/<module> && npm run build` puis relancer    |
| `CRITIC KERNEL ... terminate : 0` juste après boot                                    | crash au chargement, voir lignes précédentes        | Lire le stack trace dans le log                                        |
| Pas de "Server Listen on" après 20s + aucune erreur                                   | Rollup est lent, ou le kernel est bloqué            | Vérifier `ps aux \| grep rollup` ; relancer si bloqué                  |
| `EADDRINUSE 5151/5152`                                                                | Autre process sur les ports                         | `lsof -ti:5151 -ti:5152 \| xargs kill -9`                              |
| 4 serveurs OK mais routes 404 pour `/nodefony/test/...`                               | dist du module test périmé                          | `cd src/modules/test && npm run build` puis relancer                   |
| Mes modifs ne sont pas prises en compte malgré rebuild                                | Watch Rollup runtime du serveur a écrasé le dist    | Kill serveur AVANT modif, rebuild, PUIS relance                        |

## Rapport final à donner à l'utilisateur

- PID du serveur : `cat /tmp/srv.pid`
- Ports actifs : `lsof -ti:5151 -ti:5152`
- Résumé : `>>> Serveur UP — http://127.0.0.1:5151 | https://127.0.0.1:5152`

## Arrêter le serveur

```bash
echo ">>> KILL nodefony server"
PIDS=$(lsof -ti:5151 -ti:5152 2>/dev/null)
[ -n "$PIDS" ] && kill -9 $PIDS 2>/dev/null
sleep 1
echo ">>> ports libres ($(lsof -ti:5151 -ti:5152 2>/dev/null | wc -l) processes restants)"
```

Pattern `PIDS=...; [ -n "$PIDS" ] && kill ...` (cf. étape 1) : portable macOS, pas d'erreur si aucun port n'est pris. L'echo final confirme l'arrêt (`0 processes restants`) — évite l'ambiguïté "il reste un orphelin".
