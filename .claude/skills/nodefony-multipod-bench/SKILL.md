---
name: nodefony-multipod-bench
description: Monte un banc MULTI-PODS réel de Nodefony — plusieurs applications distinctes partageant un bus Redis — pour prouver un comportement cluster que les tests unitaires ne voient pas : fan-out cross-pod, cloisonnement entre applications, injection depuis le bus, latence et débit de bout en bout. Fournit le décor (Redis docker, apps générées liées au framework, ports dédiés), les scripts de mesure (client WebSocket, latence, charge, coût de publication, forge d'enveloppe scellée), la matrice d'attaque du backplane et les pièges de lancement multi-instances. Déclencheurs : "banc multi-pods", "tester en cluster", "cross-pod", "deux apps", "plusieurs pods", "injection backplane", "bus Redis partagé", "fan-out cross-pod", "latence cross-pod", "prouver en réel", "namespace realtime", "backplane secret".
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

## 1. Le décor

**Un seul conteneur : Redis.** Les applications tournent en processus locaux. La frontière
qu'on teste est celle du **bus**, pas celle du conteneur ; mettre les apps en image coûte un
Dockerfile et ne prouve rien de plus.

```bash
docker compose -f docker/docker-compose.yml up -d redis     # 127.0.0.1:6379, requirepass
```

**Deux applications distinctes** (au moins), générées et liées au framework local :

```bash
mkdir -p tmp/bench && cd tmp/bench
npx nodefony create app appalpha --preset minimal --frontend none --link --yes
npx nodefony create app appbeta  --preset minimal --frontend none --link --yes
```

Le preset minimal ne lie que `http` et `framework`. Ajouter les deux modules du banc :

```bash
cd appalpha
ln -sfn ../../../../../src/packages/@nodefony/realtime node_modules/@nodefony/realtime
ln -sfn ../../../../../src/packages/@nodefony/redis    node_modules/@nodefony/redis
npm pkg set 'dependencies.@nodefony/realtime=file:'"$PWD"'/../../../src/packages/@nodefony/realtime'
npm pkg set 'dependencies.@nodefony/redis=file:'"$PWD"'/../../../src/packages/@nodefony/redis'
npx nodefony create module chat --controller realtime --no-service --no-install --yes
```

Dans `nodefony.config.ts`, **avant** l'entrée du module applicatif (l'ordre du manifeste est
l'ordre de chargement, et le driver lit le service Redis au boot) :

```ts
use("@nodefony/redis", {}),
use("@nodefony/realtime", {
  backplane: {
    driver: "redis",
    // Namespace FORCÉ identique dans toutes les apps du banc : on retire la
    // cloison par nom d'application pour ne tester QUE l'authenticité.
    namespace: "bench",
  },
}),
```

Le controller doit déclarer un canal **broadcast** (sinon rien ne traverse) et exposer de quoi
piloter le banc sans navigateur — publication, rafale, sonde. Modèle prêt à coller :
[`reference/controller.md`](reference/controller.md).

## 2. Le lancement — en `production`, jamais en `development`

```bash
cd appalpha && npm run build
REDIS_URL="redis://:nodefony-dev@127.0.0.1:6379" \
NF_REALTIME_BACKPLANE_SECRET="bench-secret-0123456789abcdefghij" \
NF_POD_NAME=A1 NF_PORT=5171 NF_PORT_HTTPS=5271 \
  nohup npx nodefony production > /tmp/A1.log 2>&1 < /dev/null & disown
```

Trois règles, chacune payée par un échec réel (détail : [`reference/pieges.md`](reference/pieges.md)) :

1. **`production`, pas `development`** — le DevSupervisor est single-instance par racine
   d'application : lancer un second pod depuis le même dossier **évince le premier**.
2. **`nohup … & disown`** — un `&` nu meurt en SIGHUP dès que la commande rend la main.
3. **Ports dédiés (517x / 527x)** — le repo auto-hébergé occupe 5151/5152 et un Vite peut
   tenir 5173. Vérifier avec `lsof -nP -iTCP:<ports> -sTCP:LISTEN`.

Le second pod de la même application se lance depuis le **même dossier** avec d'autres ports :
en `production` il n'y a pas de superviseur, donc pas d'éviction.

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

| Script        | Ce qu'il rend                      | Usage                                      |
| ------------- | ---------------------------------- | ------------------------------------------ |
| `listen.mjs`  | ce qu'un client reçoit vraiment    | `node listen.mjs <portRx> <secondes>`      |
| `latency.mjs` | latence pure, hors saturation      | `node latency.mjs <portRx> <portTx> 60 50` |
| `bench.mjs`   | débit, pertes, latence sous charge | `node bench.mjs <portRx> <portTx> 50 10`   |
| `pubcost.mjs` | coût de publication (médiane)      | `node pubcost.mjs <portTx> 9`              |
| `forge.mjs`   | enveloppe scellée d'attaquant      | `node forge.mjs <canal> <secret>`          |

**Lire les chiffres correctement** : `bench.mjs` publie en rafale, donc sa latence mesure
surtout le backlog de livraison — c'est une mesure de **débit**. La latence du chemin se lit
sur `latency.mjs`, qui espace les messages. Toujours prendre la **médiane de plusieurs runs**,
jamais un tir isolé.

Ordre de grandeur observé sur deux pods d'une même machine, Redis en conteneur : latence
bout-en-bout de quelques millisecondes, 50 000 livraisons sans perte, publication de 100
messages en 1 à 3 ms selon que le transport est scellé ou non.

## 5. Le démontage

```bash
for p in $(lsof -nP -iTCP:5171,5172,5183 -sTCP:LISTEN -t); do kill -9 $p; done
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

- [`reference/pieges.md`](reference/pieges.md) — les pièges de lancement et de mesure, avec leur symptôme
- [`reference/controller.md`](reference/controller.md) — le controller du banc, prêt à coller
- `nodefony-load-test` — charge d'un seul pod (connexions, RPS, rupture)
- `nodefony-start-server` — le serveur de développement du repo (≠ pods du banc)
