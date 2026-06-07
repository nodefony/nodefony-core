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
| `nginx`        | `proxy`    | `8080`           | Banc reverse-proxy `X-Forwarded-*` (test forwarded)       |
| `haproxy`      | `proxy`    | `8081`           | Banc reverse-proxy `Forwarded` RFC 7239 (test forwarded)  |

```bash
docker compose -f docker/docker-compose.yml --profile tools up -d   # + RedisInsight → http://localhost:5540
docker compose -f docker/docker-compose.yml --profile kafka up -d   # + Kafka
```

## Banc reverse-proxy — test des en-têtes forwarded (profile `proxy`)

Valide la résolution de l'**IP cliente réelle** (anti-spoof `extractClientIp`,
dépouillement `X-Forwarded-For` **de droite à gauche**) et le scheme effectif
derrière un vrai reverse-proxy. `nginx` pose les `X-Forwarded-*` (de-facto),
`haproxy` pose en plus le header **standard `Forwarded`** (RFC 7239).

> Le serveur Nodefony tourne sur l'**hôte** ; les proxies (conteneurs) le joignent
> par son **nom de domaine** `nodefony.com` (→ host-gateway via `extra_hosts`).
> Les proxies forcent `Host: nodefony.com` vers le backend → le banc teste
> toujours ce vhost (qui doit être dans `http.trustedHosts` — déjà configuré).
>
> ⚠️ **Prérequis bind** : en dev, Nodefony écoute sur `127.0.0.1` (`domain`),
> **injoignable depuis un conteneur**. Lancer le serveur en bindant une IP
> joignable depuis Docker (`domain: "0.0.0.0"`), sinon les upstreams tombent.
> Côté **client**, `nodefony.com` doit pointer sur `127.0.0.1` dans `/etc/hosts`
> de l'hôte (`127.0.0.1   nodefony.com`) pour taper `http://nodefony.com:8080`.

```bash
# 1. Démarrer les proxies
docker compose -f docker/docker-compose.yml --profile proxy up -d
#    nginx   → http://nodefony.com:8080   (ou http://localhost:8080)
#    haproxy → http://nodefony.com:8081   (ou http://localhost:8081)
```

**Prérequis `trustProxy`** : le serveur n'honore les en-têtes forwarded que si le
socket vient d'un proxy de confiance. L'IP source des conteneurs = la **gateway
Docker** (variable selon la plateforme). La repérer dans le 1ᵉʳ log de requête
(`FROM : …`), puis configurer dans `nodefony.config.ts` :

```ts
use("@nodefony/http", { trustProxy: ["loopback", "uniquelocal"] }); // couvre 172.16/12, 192.168/16…
// ou, en DEV seulement, confiance totale : trustProxy: true
```

**Scénario anti-spoof (cœur du fix #1)** :

```bash
# Le client FORGE un X-Forwarded-For. nginx APPEND l'IP réelle → chaîne
# "6.6.6.6, <gateway>". Le serveur (from-right) doit logger <gateway>, PAS 6.6.6.6.
curl -s -H "X-Forwarded-For: 6.6.6.6" http://localhost:8080/nodefony/test/index >/dev/null

# Vérifier l'IP retenue côté serveur (jamais 6.6.6.6) :
grep "FROM" /tmp/nodefony-server.log | tail -3 | sed 's/\x1b\[[0-9;]*m//g'
```

> ⚠️ **Statiques non offloadés** par ce banc : Nodefony sert N répertoires
> `public/` (racine + un par module) → un montage volume unique serait un trou.
> L'offload correct (montages + `location` par module + domaines) relève du futur
> générateur de config CLI (`nodefony proxy:generate`). Ici nginx proxifie tout.

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
