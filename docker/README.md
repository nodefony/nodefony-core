# Infra de développement Nodefony

Conteneurs nécessaires pour développer et tester la **Socket Nodefony distribuée** (P13 Realtime).

> **Analogie** : en local, un seul process Node se parle à lui-même (mémoire partagée). Dès qu'il
> y a plusieurs process/machines, ils ont besoin d'un **point de rendez-vous** pour se relayer les
> messages — c'est le rôle de Redis (le « tableau d'affichage » où chacun publie et lit). Ce dossier
> démarre ce tableau d'affichage sur ta machine.

## Prérequis

- Docker Desktop (ou Docker Engine) démarré. Vérifier : `docker ps`.

## Démarrage rapide

Aucune config préalable : les valeurs (mot de passe dev `nodefony-dev`, port 6379)
sont en défaut inline dans le compose. Pour surcharger : `export REDIS_PASSWORD=…`
avant le `up`, ou créer un `docker/.env` (lu automatiquement par compose, ignoré par git).

```bash
# 1. Démarrer Redis (Bloc B — fan-out pub/sub)
docker compose -f docker/docker-compose.yml up -d

# 2. Vérifier
docker compose -f docker/docker-compose.yml ps
docker exec -it nodefony-redis redis-cli -a "${REDIS_PASSWORD:-nodefony-dev}" ping   # → PONG
```

## Services

| Service        | Profile    | Port (localhost) | Rôle                                                      |
| -------------- | ---------- | ---------------- | --------------------------------------------------------- |
| `redis`        | _(défaut)_ | `6379`           | Fan-out pub/sub du `RealtimeHub` distribué (Bloc B)       |
| `redisinsight` | `tools`    | `5540`           | UI web de debug Redis (jamais en prod)                    |
| `kafka`        | `kafka`    | `9092`           | Bus d'events persistant, IA-ready (Bloc C — KRaft, no ZK) |

```bash
docker compose -f docker/docker-compose.yml --profile tools up -d   # + RedisInsight → http://localhost:5540
docker compose -f docker/docker-compose.yml --profile kafka up -d   # + Kafka
```

## Arrêt

```bash
docker compose -f docker/docker-compose.yml down       # arrêt, données conservées (volumes)
docker compose -f docker/docker-compose.yml down -v    # arrêt + purge des données
```

## Choix techniques

- **Redis single instance, pas Redis Cluster.** Le backplane realtime utilise `PUB/SUB`, qui
  fonctionne en standalone. Le « cluster » Nodefony désigne **N process Node** (pods derrière un
  orchestrateur), pas du sharding Redis 6-nodes — ce serait de l'over-engineering pour le dev.
- **Auth Redis obligatoire** (`--requirepass`) même en dev : on ne prend pas l'habitude d'un Redis
  ouvert (Zero Trust). Mot de passe dev par défaut `nodefony-dev` (inline dans le compose,
  public) ; surchargeable par `export REDIS_PASSWORD=…` ou un `docker/.env` (ignoré par git).
- **Persistance AOF** (`--appendonly yes`) : les données survivent au restart du conteneur, sans le
  coût d'un snapshot RDB bloquant.
- **Kafka en KRaft mode** (pas de Zookeeper) : Zookeeper est déprécié depuis Kafka 3.5 et retiré en
  4.0. KRaft = 1 conteneur self-managed au lieu de 2.
- **Ports bindés sur `127.0.0.1`** : l'infra dev n'est jamais exposée sur le réseau.
