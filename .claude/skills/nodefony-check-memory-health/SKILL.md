---
name: nodefony-check-memory-health
metadata:
  version: 2.0.0
description: >
  Gate mémoire de Nodefony : lance le banc de @nodefony/http (requêtes GET, crashs, uploads,
  connexions WebSocket) qui mesure les octets RETENUS par itération, les scopes restés ouverts et les
  contextes jamais réclamés — et surtout dit QUOI FAIRE quand il rougit (blocker, ne pas commiter,
  distinguer une fuite d'un client extérieur ou d'un décor faux, où chercher). Porte le décor exigé
  et les pièges de mesure. À charger AVANT de lancer la commande, pas après un résultat rouge.
  Symptôme runtime plus large → nodefony-debug ; fuite lente sur la durée → nodefony-load-test.
  Déclencheurs : "vérifier la mémoire", "memory leak", "test mémoire", "heap delta", "fuite mémoire",
  "gate mémoire", "j'ai touché au pipeline", "j'ai modifié le Kernel ou le Container",
  "je vais commiter une modif http/framework", "le seuil mémoire a sauté", "heap qui monte",
  "octets retenus par requête".
---

# nodefony-check-memory-health — le gate mémoire, son décor et la lecture d'un rouge

> **Maintenance** : vérité courante, jamais un journal. Éditer en place ; historique = `git log`.
> 🔴 **Aucun seuil chiffré ici** : ils vivent dans la table `THRESHOLDS` de
> `src/packages/@nodefony/http/nodefony/tests/helpers/retention.ts`, seule source, partagée par le
> gate (`memory.test.ts`) et les bancs de charge (`tests/load/*`). Un seuil recopié dans un document
> se périme au premier resserrement.

## 1. Quand m'utiliser / quand passer la main

**Obligatoire avant de commiter** une modification de `@nodefony/http`, `@nodefony/framework`, du
pipeline de requête, du conteneur d'injection ou du syslog.

| Besoin                                                     | Skill                         |
| ---------------------------------------------------------- | ----------------------------- |
| Le gate avant commit, et lire son verdict                  | **ici**                       |
| Fuite LENTE, RSS sur la durée (minutes, heures)            | `nodefony-load-test` (`soak`) |
| Symptôme runtime large (crash, rouge en suite, régression) | `nodefony-debug`              |
| Démarrer / redémarrer le serveur de banc                   | `nodefony-start-server`       |

## 2. Ce que le gate mesure — trois familles, trois garanties

| Famille       | Ligne publiée | Ce qu'elle voit                                                                  |
| ------------- | ------------- | -------------------------------------------------------------------------------- |
| **Rétention** | `[retention]` | octets de tas retenus PAR itération — pente, pas écart (§4)                      |
| **Scopes**    | `[scopes]`    | scopes `request` jamais refermés — compte EXACT du registre du conteneur         |
| **Contextes** | `[contexts]`  | contextes HTTP jamais réclamés par le GC — compte EXACT (`FinalizationRegistry`) |

Les deux comptes exacts voient ce que le tas ne voit pas : un millier de scopes épinglés tient dans
le bruit d'un tas de 90 Mo. La pente voit ce que les comptes ne voient pas : un tampon, un cache ou
un écouteur qui grossit sans retenir de contexte.

Les **bancs de charge** (`npm run test:load`, qui inclut le gate) appliquent la même pente à leurs
unités : connexion WebSocket porteuse de messages (`als-load`), trame (`ws-messages-load`), stream
servi (`stream-load`). `ws-connections-load` mesure autre chose : le **coût d'une connexion tenue**
ouverte (ligne `[held]`), ce que le serveur paye tant qu'elle vit — pas une rétention.

## 3. Lancer

Le gate **tape un serveur vivant**, il ne le démarre pas.

```bash
bash .claude/skills/nodefony-start-server/start.sh            # décor : --expose-gc posé
lsof -nP -iTCP:5152 -sTCP:ESTABLISHED                        # aucun AUTRE client que le banc
cd src/packages/@nodefony/http && npm run test:memory > /tmp/memory.log 2>&1; echo "exit=$?"
grep -E "^\[(retention|scopes|contexts)\]|✓|×|Tests " /tmp/memory.log
```

Capturer la sortie ENTIÈRE, puis filtrer : un `tail` coupe la ligne qui dit pourquoi c'est rouge.
En CI, le même fichier tourne dans `npm run test:load` (workflow `memory.yml`, trois systèmes).

## 4. Pourquoi une pente, et pourquoi ces précautions

Chaque précaution ci-dessous corrige un faux verdict déjà publié.

- **Une pente (Theil–Sen sur 7 paliers), jamais un écart avant/après.** Un écart est la différence
  de deux mesures bruitées : un à-coup du serveur de développement (profileur, HMR) de 2,5 Mo se lit
  comme 2,5 Ko « retenus par requête ». La médiane des pentes ignore un point aberrant.
- **Fenêtre de confirmation.** Une pente au-dessus du seuil est remesurée ; le rouge exige les deux.
  Une fuite retient à chaque itération et se retrouve, un à-coup ne tombe qu'une fois. C'est ce qui
  tient la CI verte sans élargir le seuil.
- **Échauffement global** (`WARMUP`) : sur un serveur neuf, V8 compile et optimise les chemins chauds
  et les caches paresseux se remplissent — +3 Mo sur les ~1 000 premières requêtes, puis plat.
  Mesurer avant ce plateau publie l'échauffement comme une fuite.
- **Ring du syslog coupé pendant la mesure** (rétabli à la fin) : 2 000 Pdu en développement,
  re-remplis par chaque scénario avec des lignes d'une autre taille — plusieurs Ko de pente qui ne
  sont pas une rétention du pipeline.
- **GC forcé** par la sonde `/nodefony/test/memory` — possible seulement avec `--expose-gc`, que
  `start.sh` et la CI posent. La sonde rend `gcForced` : sans lui, on mesure du déchet en attente.

## 5. Lire un rouge — dans cet ordre

1. **Quelle famille ?** Le message d'assertion nomme la boucle, la valeur et, pour la rétention, les
   deux fenêtres et les points relevés.
2. **`[scopes]` à 1 ou 2, ou `[contexts]` positif, sans rien toucher au pipeline** → d'abord un
   **client extérieur** : onglet Studio ouvert, client MCP de la session qui se reconnecte après un
   redémarrage. `lsof -nP -iTCP:5152 -sTCP:ESTABLISHED` les nomme ; les fermer, relancer. Un client
   n'existe pas en CI : un rouge de compte en CI est un défaut.
3. **`[retention]` rouge confirmé** → c'est un **blocker**. Ne pas commiter. Chercher dans le diff :
   - écouteur attaché sans `removeListener` (`once` ne détache pas son jumeau `finish`/`close`) ;
   - structure allouée par requête et gardée par un objet à longue vie (cache, registre, tableau
     module-level) ;
   - hook utilisateur qui ne revient pas à `null` après exécution (règle lazy du `CLAUDE.md`).
4. **Qualifier avant d'accuser son diff** : rejouer le gate sur la base stashée (skill
   `nodefony-debug`, « baseline »). Un rouge présent sans le diff n'est pas le sien.
5. **Ne jamais relever un seuil pour faire passer** : il est posé sur le bruit mesuré. Un seuil se
   resserre ou se re-mesure (10 passages, serveur neuf, distribution jointe au ticket), il ne se
   desserre pas pour un run.

## 6. Pièges

- **Ne pas éditer sous `src/` pendant un run** : le superviseur de développement redémarre le
  serveur à chaque sauvegarde — `ECONNREFUSED` au milieu du banc.
- **Ne pas enchaîner avec le filet CLI** (`NF_RUN_CLI_BOOT=1`) : il lance `production`/`cluster` sur
  les mêmes ports. Séquencer.
- **Un serveur lancé autrement que par `start.sh`** n'a pas `--expose-gc` : `gcForced: false`,
  mesures fausses.
- **La journalisation retient en vol.** Hors production, le contenu des trames WS est journalisé en
  DEBUG, et le transport fichier du syslog écrit ligne par ligne : sous un flot de trames, des
  centaines d'écritures sont en attente à un instant donné (`Pdu`, `FileHandle` en tête d'un diff
  d'instantanés). Le tas monte puis plafonne, et redescend quand le flot s'arrête — ce n'est pas une
  rétention. Diagnostic : diff de deux instantanés du tas (`kill -USR1 <pid>` ouvre l'inspecteur sous
  linux/macOS, puis `HeapProfiler.takeHeapSnapshot`), agrégé par constructeur.
- **Serveur resté longtemps en marche** : état accumulé par d'autres suites. En cas de doute,
  redémarrer — la CI mesure toujours un serveur neuf.

## 7. Rapport au user (3 lignes)

```
Mémoire : 9/9 verts · rétention max 0,xx Ko/itér. (GET) · 0 scope, 0 contexte résiduel
```
