---
name: nodefony-multipod-bench
description: >
  Monte un banc MULTI-PODS réel — plusieurs applications partageant un bus Redis — pour prouver un
  comportement cluster invisible aux tests unitaires : fan-out cross-pod, cloisonnement entre
  applications, injection depuis le bus, latence et débit de bout en bout. Fournit le décor (Redis
  docker, apps liées au framework, ports dédiés), les scripts de mesure (latence, charge, coût de
  publication, forge d'enveloppe scellée), la matrice d'attaque du backplane et les pièges du
  lancement multi-instances. À charger AVANT de monter le décor ou de lancer un script : sans le
  protocole, un banc saturé mesure un backlog et non une latence, et une infra éteinte en route rend
  les tests silencieusement verts. Déclencheurs : "banc multi-pods", "tester en cluster",
  "cross-pod", "deux apps", "plusieurs pods", "injection backplane", "bus Redis partagé", "fan-out
  cross-pod", "prouver en réel", "backplane secret", "est-ce que ça marche à plusieurs instances ?",
  "les apps sont-elles cloisonnées ?".
---

# nodefony-multipod-bench — prouver le cluster en vrai

> **Maintenance** : édition en place, jamais de journal (l'historique est dans `git log`).
> Les scripts de `scripts/` sont la source de vérité — le texte ci-dessous décrit le processus.

Un comportement cluster ne se prouve pas en test unitaire. Un hub mocké répond toujours ce
qu'on attend : c'est le décor réel — deux processus, un bus, un client navigateur — qui
révèle ce qui manque. Ce banc a servi à démontrer une faille d'injection **et** à découvrir
un trou de conception que la suite unitaire ne pouvait pas voir.

## Quand ce banc est le bon outil

| Question                                                                     | Ce banc ?                  |
| ---------------------------------------------------------------------------- | -------------------------- |
| « Un message publié sur un pod atteint-il un client branché sur un autre ? » | oui                        |
| « Une autre application peut-elle écrire dans mes canaux ? »                 | oui                        |
| « Combien coûte le sceau / quelle latence traverse le bus ? »                | oui                        |
| « Ce provider crée-t-il bien un timer par canal ? »                          | non — test unitaire        |
| « Combien de connexions WebSocket tient un pod ? »                           | non — `nodefony-load-test` |

## 1. Monter le banc — deux commandes

```bash
bash .claude/skills/nodefony-multipod-bench/scripts/setup.sh   # décor (idempotent)
bash .claude/skills/nodefony-multipod-bench/scripts/run.sh     # démarre les 3 pods
```

`setup.sh [dossier] [namespace]` monte tout : Redis en conteneur, deux applications générées et
liées au dépôt local, le module `chat` du banc, la configuration du bus, le build. Relancer ne
casse rien — chaque étape vérifie ce qui existe déjà. Pour repartir de zéro : `rm -rf tmp/bench`.

`run.sh` démarre **trois pods** : deux instances de la première application (même secret = pairs
légitimes) et une instance de la seconde **sans secret** — le témoin non protégé, sans lequel aucun
scénario défensif ne prouve quoi que ce soit. Il refuse de démarrer si un port est déjà occupé,
plutôt que d'écraser le travail en cours. `run.sh --stop` arrête les pods du banc, et eux seuls.

## 2. Ce que le décor contient (et pourquoi)

**Un seul conteneur : Redis.** Les applications tournent en processus locaux. La frontière qu'on
teste est celle du **bus**, pas celle du conteneur ; mettre les apps en image coûte un Dockerfile
et ne prouve rien de plus.

**Deux applications distinctes**, `--link`ées au dépôt : elles consomment le framework en cours de
développement, pas une version publiée. Le preset minimal ne lie que `http` et `framework` — le
script ajoute `realtime` et `redis` par lien symbolique **absolu** (un lien relatif dépend du
dossier depuis lequel il a été créé).

**Une cloison de transport commune** (`backplane.namespace`, `bench` par défaut) : les deux
applications se retrouvent volontairement sur le même canal Redis. On retire ainsi la séparation
par nom d'application, pour ne tester **que** l'authenticité des messages.

**Un controller de banc** (`references/controller.md`, recopié par `setup.sh` — source unique) : un
canal diffusable, une route de publication, une route de rafale, une sonde. Tout est pilotable au
`curl`, sans navigateur.

**Le mode `production`, jamais `development`** : le superviseur de développement est instance
unique par racine d'application — un second pod lancé depuis le même dossier évincerait le premier.
C'est aussi le mode qui ressemble au déploiement réel.

## 3. La matrice d'attaque du bus

L'attaquant est un client Redis nu — c'est exactement ce dont dispose une autre application
sur un Redis mutualisé, ou quiconque a récupéré le mot de passe.

| Tir                        | Commande                                                                 | Attendu                                     |
| -------------------------- | ------------------------------------------------------------------------ | ------------------------------------------- |
| Fan-out nominal            | `curl -X POST :5171/api/chat/say` + écouteur sur 5172                    | reçu                                        |
| Injection non scellée      | `redis-cli PUBLISH nodefony:realtime:bench '{"channel":"chat:room1",…}'` | ignorée si un secret est posé               |
| Secret volé, canal système | `node scripts/forge.mjs "security:audit" "<secret>"` puis PUBLISH        | ignorée — l'admission par canal tient seule |
| Application tierce         | `curl -X POST :5183/api/chat/say` (app sans le secret)                   | rien chez les pods scellés                  |
| **Contrôle négatif**       | même injection, sur un pod **sans** secret                               | **reçue**                                   |

> Le contrôle négatif n'est pas optionnel : sans lui, un banc qui ne voit rien passer ne
> prouve pas qu'il défend — il prouve peut-être seulement qu'il est cassé.

```bash
docker exec nodefony-redis redis-cli -a nodefony-dev --no-auth-warning \
  PUBLISH nodefony:realtime:bench '{"channel":"chat:room1","payload":{"msg":"INJECTION"},"originId":"evil"}'
```

## 4. Les mesures

Tous les scripts vivent dans `scripts/` et se lancent depuis le dossier du banc.

| Script              | Ce qu'il rend                                                                                            | Usage                                       |
| ------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `listen.mjs`        | ce qu'un client reçoit vraiment                                                                          | `node listen.mjs <portRx> <secondes>`       |
| `latency.mjs`       | latence pure, hors saturation                                                                            | `node latency.mjs <portRx> <portTx> 60 50`  |
| `bench.mjs`         | débit, pertes, latence sous charge                                                                       | `node bench.mjs <portRx> <portTx> 50 10`    |
| `pubcost.mjs`       | coût de publication (médiane)                                                                            | `node pubcost.mjs <portTx> 9`               |
| `soak.mjs`          | charge par paliers de connexions                                                                         | `node soak.mjs <portRx> <portTx> 50,200 30` |
| `forge.mjs`         | enveloppe scellée d'attaquant                                                                            | `node forge.mjs <canal> <secret>`           |
| `db-outage-pod.mjs` | un POD en production face à la chute de sa BASE : survit-il, répond-il hors base, sa santé dit-elle vrai | `node db-outage-pod.mjs`                    |
| `mempeak.sh`        | pic mémoire pendant une rafale                                                                           | `bash mempeak.sh <portTx> 1000000`          |

**Lire les chiffres correctement** : `bench.mjs` publie en rafale, donc sa latence mesure
surtout le backlog de livraison — c'est une mesure de **débit**. La latence du chemin se lit
sur `latency.mjs`, qui espace les messages. Toujours prendre la **médiane de plusieurs runs**,
jamais un tir isolé.

**Mesurer une mémoire, c'est mesurer un pic, et comparer deux configurations.** Un `ps` avant/après
voit le retour à la normale, pas l'accident : `mempeak.sh` échantillonne pendant la rafale. Et un
pic seul ne dit rien — il faut le second tir avec le garde-fou désarmé. Exemple vécu sur la file
d'envoi du backplane, 1 M de publications synchrones depuis un pod : **388 MB** de pic avec la
borne à 8 MiB, **3 231 MB** avec `maxQueueBytes: 0`. Le détail qui tranche le débat : dans les deux
cas ~1 M de messages sont perdus (le bus ne suit pas), mais sans borne on paie 3,2 Go pour perdre
exactement les mêmes.

Ordre de grandeur observé sur deux pods d'une même machine, Redis en conteneur : latence
bout-en-bout de quelques millisecondes, 50 000 livraisons sans perte, publication de 100
messages en 1 à 3 ms selon que le transport est scellé ou non.

## 5. Le démontage

```bash
bash .claude/skills/nodefony-multipod-bench/scripts/run.sh --stop   # les pods du banc, eux seuls
docker compose -f docker/docker-compose.yml stop redis
rm -rf tmp/bench
```

⚠️ Tuer **par port**, jamais par `pkill -f NF_POD_NAME=…` : une variable d'environnement
n'apparaît pas dans la ligne de commande, le motif ne matche rien et on croit avoir arrêté un
processus qui tourne toujours — puis on diagnostique sur un serveur qui exécute l'ancien code.

## Ce que ce banc a déjà trouvé

- Le backplane réinjectait tout message reçu sans vérifier ni le canal ni l'origine.
- Les préfixes broadcast n'étaient déclarés qu'au handshake d'un client : un pod publiant
  sans abonné local ne propageait rien, en silence.

Les deux étaient invisibles en test unitaire, où l'on appelle toujours `markBroadcastChannel`
à la main et où le bus est un objet en mémoire.

## Liens

- [`references/pieges.md`](references/pieges.md) — les pièges de lancement et de mesure, avec leur symptôme
- [`references/controller.md`](references/controller.md) — le controller du banc, prêt à coller
- `nodefony-load-test` — charge d'un seul pod (connexions, RPS, rupture)
- `nodefony-start-server` — le serveur de développement du repo (≠ pods du banc)
