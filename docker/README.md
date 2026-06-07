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
| `haproxy`      | `proxy`    | `8081` + `8443`  | Banc `Forwarded` RFC 7239 ; `8081` clair, `8443` TLS E2E  |

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
> **injoignable depuis un conteneur**. Lancer le serveur avec **`NF_BIND_ALL=1`**
> → bind `0.0.0.0` + `trustProxy` (loopback + uniquelocal) activés pour le banc :
>
> ```bash
> NF_BIND_ALL=1 bash .claude/skills/nodefony-start-server/start.sh
> ```
>
> Côté **client**, `nodefony.com` doit pointer sur `127.0.0.1` dans `/etc/hosts`
> de l'hôte (`127.0.0.1   nodefony.com`) pour taper `http://nodefony.com:8080`.

```bash
# 1. Démarrer les proxies (Docker Desktop doit tourner : `docker ps`)
docker compose -f docker/docker-compose.yml --profile proxy up -d
#    nginx   → http://nodefony.com:8080   (ou http://localhost:8080)
#    haproxy → http://nodefony.com:8081   (ou http://localhost:8081)
```

**`trustProxy`** : le serveur n'honore les en-têtes forwarded que si le socket
vient d'un proxy de confiance. `NF_BIND_ALL=1` l'active automatiquement avec
`["loopback", "uniquelocal"]` (couvre les réseaux Docker privés 172.16/12,
192.168/16, 10/8 d'où viennent les conteneurs). Hors banc, `trustProxy` reste
`false` (zéro confiance). En prod, le régler explicitement selon l'ingress.

**Scénario anti-spoof (cœur du fix #1)** :

```bash
# Le client FORGE un X-Forwarded-For. nginx APPEND l'IP réelle → chaîne
# "6.6.6.6, <gateway>". Le serveur (from-right) doit logger <gateway>, PAS 6.6.6.6.
curl -s -H "X-Forwarded-For: 6.6.6.6" http://localhost:8080/nodefony/test/index >/dev/null

# Vérifier l'IP retenue côté serveur (jamais 6.6.6.6) :
grep "FROM" /tmp/nodefony-server.log | tail -3 | sed 's/\x1b\[[0-9;]*m//g'
```

### TLS du lien de forward + chaîne de certification ✅

Les deux proxies illustrent **deux topologies de lien proxy↔backend** :

| Proxy   | Lien de forward  | Cas réel illustré                                             |
| ------- | ---------------- | ------------------------------------------------------------- |
| nginx   | **HTTP** (5151)  | TLS terminé au proxy, lien interne **de confiance** (même DC) |
| haproxy | **HTTPS** (5152) | **Re-encrypt** VALIDÉ : proxy/PoP ailleurs → lien protégé     |

`proto` (X-Forwarded-Proto / Forwarded) = scheme **côté client**, indépendant du
chiffrement du lien interne. haproxy expose **deux frontends** :

| Frontend          | `proto` posé | Cas                                              |
| ----------------- | ------------ | ------------------------------------------------ |
| `:8081` (clair)   | `http`       | client en clair vers le proxy                    |
| `:8443` (**TLS**) | `https`      | **client TLS vers le proxy** → `proto=https` E2E |

**🔐 Chaîne de certification — VALIDÉE (plus de `verify none`).** Le re-encrypt
haproxy→`nodefony.com:5152` valide désormais complètement le cert backend :

```
server nodefony nodefony.com:5152 check ssl \
  ca-file /etc/haproxy/certs/ca.pem verify required \
  verifyhost nodefony.com sni str(nodefony.com)
```

- `verify required` : refuse le forward si le cert n'est pas signé par la CA.
- `verifyhost nodefony.com` : exige que le **SAN** couvre `nodefony.com` (sinon un
  cert valide pour tout autre nom passerait).
- `sni str(nodefony.com)` : SNI envoyé au backend.

**Pré-requis** (le cert dev a SAN=`localhost` par défaut ; il faut `nodefony.com`) :

```bash
# 1) Nodefony génère un cert SAN=nodefony.com (config: san sous NF_BIND_ALL).
NF_BIND_ALL=1 bash .claude/skills/nodefony-start-server/start.sh
# 2) Dériver les PEM haproxy (ca.pem + haproxy.pem) des certs Nodefony.
bash docker/certs/build-haproxy-pem.sh
# 3) Lancer le banc.
docker compose -f docker/docker-compose.yml --profile proxy up -d
```

Test **E2E `proto=https`** (TLS client→proxy, re-encrypt validé, **sans `-k`**) :

```bash
# scheme=https vu par le backend (vs http via :8081) ; edge cert validé par la CA.
curl --cacert docker/certs/ca.pem --resolve nodefony.com:8443:127.0.0.1 \
  https://nodefony.com:8443/nodefony/test/context
# → {"scheme":"https", "host":"nodefony.com", "remoteAddress":"172.x.0.1", ...}
```

> `ca.pem` = la CA qui a signé le cert backend (mkcert rootCA). `haproxy.pem` =
> cert + clé que haproxy présente au client. Les deux sont **gitignorés** (clé
> privée) et régénérés par `build-haproxy-pem.sh`. La PKI offline complète
> (root + intermediate + client mTLS) reste `bin/generateCertificates.sh`.

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
