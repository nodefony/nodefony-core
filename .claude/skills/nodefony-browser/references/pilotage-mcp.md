# Référence — l'autre voie : le serveur MCP du conteneur

> **Maintenance** : vérité courante. Éditer en place ; l'historique vit dans `git log`.

Le conteneur `nodefony-browser` expose aussi un **serveur MCP** (`http://127.0.0.1:3001/mcp`,
transport HTTP streamable). C'est son interface native — mais **ce n'est pas la voie par défaut**.

## 1. Quand cette voie a un sens — et quand elle n'en a pas

| Situation                                                            | Voie                                    |
| -------------------------------------------------------------------- | --------------------------------------- |
| « Ouvre cette page, mesure, capture » — une intention connue         | **`inspect.mjs`** (direct, cf SKILL §3) |
| Explorer sans savoir d'avance : cliquer, revenir, suivre un parcours | MCP                                     |

Le MCP apporte la **découverte d'outils** à un agent qui décide au fil de l'eau. Pour un geste
déterministe, il n'ajoute qu'un protocole, des sessions et un heartbeat — de la complexité pure.
Mesuré sur ce dépôt : pilotage direct **~8 s** et un code de sortie ; par MCP, le même travail en
~40 s, suivi d'un blocage de plusieurs minutes dû au maintien de session.

## 2. 🔴 Le heartbeat — il tue TOUTE session en cinq secondes

C'est le piège qui a coûté le plus cher, et il se présente sous un déguisement parfait.

Playwright MCP démarre un **heartbeat au PREMIER `tools/call`** de chaque session
(`startHeartbeat`, dans le module `playwright-core` du conteneur — fichier `coreBundle.js`) :

```js
startHeartbeat = (server) => {
  const beat = () => {
    Promise.race([
      server.ping(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("ping timeout")), 5e3),
      ),
    ])
      .then(() => {
        setTimeout(beat, 3e3);
      })
      .catch(() => {
        void server.close();
      }); // ← la session est SUPPRIMÉE
  };
  beat();
};
```

Le serveur envoie une requête JSON-RPC `ping` **au client**, toutes les 3 s, sur le **flux GET SSE**
de la session. Un client `curl` « one-shot » ne lit pas ce flux et ne répond jamais : la session
meurt ~5 s après son premier appel, **quoi qu'on fasse**.

**Pourquoi le diagnostic part de travers.** Les symptômes désignent tous un coupable innocent :

| Ce qu'on observe                                               | Ce qu'on en conclut à tort                  |
| -------------------------------------------------------------- | ------------------------------------------- |
| `HTTP 200` au corps VIDE                                       | « l'outil a planté »                        |
| Puis `404 Session not found`                                   | « la session a expiré par inactivité »      |
| Un `evaluate` trivial passe, un `evaluate` avec `fetch` échoue | « le `fetch` casse quelque chose »          |
| Un clic ne fait pas avancer un formulaire                      | « le formulaire React résiste au pilotage » |

Les deux derniers sont de pures **corrélations temporelles** : un appel un peu long franchit
l'échéance que les appels rapides passaient de justesse. Ce n'est ni le `fetch`, ni le formulaire :
**c'est le temps**. Et la réponse de l'outil en cours est produite APRÈS la suppression de la
session, donc elle part au vide.

⚠️ **La règle « attendre par un appel, jamais par une pause » est trompeuse ici** : elle laisse
croire que l'inactivité du CLIENT est en cause. C'est l'inverse — c'est le **silence du client face
aux pings du SERVEUR** qui ferme la session, y compris en travaillant sans arrêt.

Corollaire : **`docker restart` n'est jamais nécessaire** pour ce symptôme. Une session morte n'est
qu'une session ; un nouvel `initialize` suffit.

## 3. Le contournement, si l'on tient à cette voie

Tenir le flux GET ouvert et **répondre à chaque ping** :

```bash
curl -s -N --max-time 3600 "$MCP" -H 'Accept: text/event-stream' -H "mcp-session-id: $SID" \
| while IFS= read -r line; do
    case "$line" in "data: "*)
      pid=$(printf '%s' "${line#data: }" | jq -r 'select(.method=="ping") | .id' 2>/dev/null)
      [ -n "${pid:-}" ] && [ "$pid" != "null" ] &&
        curl -s -o /dev/null -X POST "$MCP" \
          -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
          -H "mcp-session-id: $SID" -d "{\"jsonrpc\":\"2.0\",\"id\":$pid,\"result\":{}}"
    ;; esac
  done &
```

⚠️ Ce keepalive **ne rend pas la main** : lancé en tâche de fond, il survit au `trap` du script
appelant et laisse des processus orphelins (`pkill -f "max-time 3600"`). C'est une raison de plus
de préférer la voie directe.

## 4. Deux conteneurs à ne pas confondre

Le service déclaré dans `docker/docker-compose.yml` **n'est pas** celui que lance l'outillage MCP
d'un éditeur. Ce dernier démarre son propre conteneur, à la demande, **sans `--ignore-https-errors`**
— il refuse donc le certificat de développement et ne peut pas observer une page servie en HTTPS ni
un mode Vite. Le service déclaré, lui, est reproductible et monte son `--output-dir` sur l'hôte.

## 5. Détails d'exécution qui ont coûté du temps

- **`channel: "chromium"`** est requis : l'image embarque le Chromium complet mais **pas** le
  `chrome-headless-shell` que Playwright lance par défaut en headless — sans ce paramètre, il
  réclame un `npx playwright install` sans objet.
- **La résolution ESM part du FICHIER, pas du répertoire courant.** Un script déposé dans `/output`
  ne résout pas `playwright` : le copier dans `/app` (`docker cp`), où vivent les modules.
