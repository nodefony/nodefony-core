# <%= it.appName %> — infra de développement (docker compose)
#
# Ce fichier ne porte QUE ce que ton app utilise : le dialecte SQL a été retenu à
# la création, les deux autres ne sont pas là. Ce qu'il fournit :
#   - Redis    → sessions/idempotence partagées + backplane realtime multi-process
<% if (it.db) { %>#   - <%= it.db.label %> → LA base de l'app — `NF_DATABASE_URL` est déjà posée dans
#     `.env` sur ce service, il n'y a rien à câbler
<% } %>#   - Loki + Grafana → centralisation des logs (driver `loki` du framework)
#
# Usage :
#   docker compose up -d                          # Redis<%= it.db ? " + " + it.db.label : "" %> (ce qu'il faut à l'app)
#   docker compose --profile tools up -d          # + RedisInsight (UI Redis)
#   docker compose --profile loki up -d           # + Loki + Grafana (logs)
#   docker compose down                           # arrêt (volumes conservés)
#   docker compose down -v                        # arrêt + PURGE des données
#
<% if (it.db) { %># Câblage côté app (env.ts est le SEUL lecteur de process.env) — `.env` porte
# déjà l'URL de la base ; Redis reste commenté tant que tu n'en as pas besoin :
#   NF_DATABASE_URL="<%= it.db.url %>"
#   NF_REDIS_URL="redis://:<%= it.appName %>-dev@127.0.0.1:6379"
<% } else { %># Base SQL : aucune ici — l'app persiste en sqlite local (`var/databases/`), ce
# qui la fait démarrer sans rien allumer. Pour passer sur une vraie base, ajoute
# son service et déclare `NF_DATABASE_URL` : l'ORM déduit le dialecte du scheme
# (`postgres://`, `mysql://`) et RIEN d'autre ne change dans l'app.
#
# Câblage côté app (env.ts est le SEUL lecteur de process.env) :
#   NF_REDIS_URL="redis://:<%= it.appName %>-dev@127.0.0.1:6379"
<% } %>#
# Config : chaque valeur a un défaut inline `${VAR:-défaut}` → AUCUN fichier .env requis.
# Pour surcharger (autre port, vrai secret) : `export VAR=…` avant le `up`.
# Les mots de passe dev sont PUBLICS — JAMAIS en production.
#
# Réseau : un bridge nommé unique ; les conteneurs se parlent par NOM de service
# (DNS interne Docker), jamais par localhost. Les ports ne sont publiés que sur
# 127.0.0.1 : l'app tourne sur l'HÔTE et joint l'infra via 127.0.0.1:<port>.

name: <%= it.appName %>

services:
  # --- Redis (défaut — sessions, idempotence, backplane realtime) ---
  # Auth obligatoire même en dev (Zero Trust). AOF : survit au restart du conteneur.
  redis:
    image: redis:7-alpine
    container_name: <%= it.appName %>-redis
    restart: unless-stopped
    networks: [<%= it.appName %>]
    command: >
      redis-server
      --requirepass ${REDIS_PASSWORD:-<%= it.appName %>-dev}
      --appendonly yes
      --maxmemory 256mb
      --maxmemory-policy noeviction
    ports:
      # Loopback uniquement — surface réseau minimale en dev.
      - "127.0.0.1:${REDIS_PORT:-6379}:6379"
    volumes:
      - redis-data:/data
    healthcheck:
      # -a : sans auth, PING renvoie NOAUTH. « healthy » = Redis répond PONG.
      test:
        [
          "CMD-SHELL",
          "redis-cli -a ${REDIS_PASSWORD:-<%= it.appName %>-dev} ping | grep -q PONG",
        ]
      interval: 5s
      timeout: 3s
      retries: 5
      start_period: 5s

<% if (it.db && it.db.choice === "postgres") { %>  # --- PostgreSQL 16 — LA base de l'app (dialecte retenu à la création) ---
  # Pas de `profiles:` : ce service n'est pas une option, c'est la base que
  # `NF_DATABASE_URL` joint. `docker compose up -d` le monte avec Redis.
  postgres:
    image: postgres:16-alpine
    container_name: <%= it.appName %>-postgres
    restart: unless-stopped
    networks: [<%= it.appName %>]
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-<%= it.appName %>}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-<%= it.appName %>-dev}
      POSTGRES_DB: ${POSTGRES_DB:-<%= it.appName %>}
    ports:
      - "127.0.0.1:${POSTGRES_PORT:-5432}:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test:
        [
          "CMD-SHELL",
          "pg_isready -U ${POSTGRES_USER:-<%= it.appName %>} -d ${POSTGRES_DB:-<%= it.appName %>}",
        ]
      interval: 5s
      timeout: 3s
      retries: 5
      start_period: 5s

<% } %><% if (it.db && it.db.choice === "mariadb") { %>  # --- MariaDB 11.4 — LA base de l'app (fork libre de MySQL, même dialecte) ---
  # Pas de `profiles:` : ce service n'est pas une option, c'est la base que
  # `NF_DATABASE_URL` joint. `docker compose up -d` le monte avec Redis.
  mariadb:
    image: mariadb:11.4
    container_name: <%= it.appName %>-mariadb
    restart: unless-stopped
    networks: [<%= it.appName %>]
    environment:
      MARIADB_ROOT_PASSWORD: ${MARIADB_ROOT_PASSWORD:-<%= it.appName %>-dev}
      MARIADB_USER: ${MARIADB_USER:-<%= it.appName %>}
      MARIADB_PASSWORD: ${MARIADB_PASSWORD:-<%= it.appName %>-dev}
      MARIADB_DATABASE: ${MARIADB_DATABASE:-<%= it.appName %>}
    ports:
      - "127.0.0.1:${MARIADB_PORT:-3306}:3306"
    volumes:
      - mariadb-data:/var/lib/mysql
    healthcheck:
      # healthcheck.sh = outil officiel de l'image mariadb.
      test: ["CMD", "healthcheck.sh", "--connect", "--innodb_initialized"]
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 10s

<% } %><% if (it.db && it.db.choice === "mysql") { %>  # --- MySQL 8.4 — LA base de l'app (dialecte retenu à la création) ---
  # Pas de `profiles:` : ce service n'est pas une option, c'est la base que
  # `NF_DATABASE_URL` joint. `docker compose up -d` le monte avec Redis.
  mysql:
    image: mysql:8.4
    container_name: <%= it.appName %>-mysql
    restart: unless-stopped
    networks: [<%= it.appName %>]
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD:-<%= it.appName %>-dev}
      MYSQL_USER: ${MYSQL_USER:-<%= it.appName %>}
      MYSQL_PASSWORD: ${MYSQL_PASSWORD:-<%= it.appName %>-dev}
      MYSQL_DATABASE: ${MYSQL_DATABASE:-<%= it.appName %>}
    ports:
      # 3306 : le port décalé n'existait que pour cohabiter avec MariaDB dans un
      # compose qui portait les deux — une app retient UN dialecte.
      - "127.0.0.1:${MYSQL_PORT:-3306}:3306"
    volumes:
      - mysql-data:/var/lib/mysql
    healthcheck:
      test:
        [
          "CMD-SHELL",
          "mysqladmin ping -h 127.0.0.1 -u${MYSQL_USER:-<%= it.appName %>} -p${MYSQL_PASSWORD:-<%= it.appName %>-dev} --silent",
        ]
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 10s

<% } %>  # --- RedisInsight (profile tools — UI de debug Redis, jamais en prod) ---
  redisinsight:
    image: redis/redisinsight:latest
    container_name: <%= it.appName %>-redisinsight
    restart: unless-stopped
    profiles: ["tools"]
    networks: [<%= it.appName %>]
    ports:
      - "127.0.0.1:${REDISINSIGHT_PORT:-5540}:5540"
    depends_on:
      redis:
        condition: service_healthy

  # --- Loki (profile loki — centralisation des logs, driver `loki` du framework) ---
  # Léger : Loki indexe les LABELS (basse cardinalité), pas le texte → peu de RAM.
  loki:
    image: grafana/loki:3.7.2
    container_name: <%= it.appName %>-loki
    restart: unless-stopped
    profiles: ["loki"]
    networks: [<%= it.appName %>]
    command: -config.file=/etc/loki/local-config.yaml
    ports:
      - "127.0.0.1:${LOKI_PORT:-3100}:3100"
    volumes:
      - loki-data:/loki
    # PAS de healthcheck : image DISTROLESS (aucun shell dans le conteneur) — un
    # healthcheck Docker la marquerait « unhealthy » à tort. Santé côté hôte :
    # curl http://127.0.0.1:3100/ready

  # --- Grafana (profile loki — visualisation des logs, datasource auto-provisionnée) ---
  # Anonyme + rôle Admin pour un dev sans friction (JAMAIS en prod).
  grafana:
    image: grafana/grafana:latest
    container_name: <%= it.appName %>-grafana
    restart: unless-stopped
    profiles: ["loki"]
    networks: [<%= it.appName %>]
    environment:
      GF_AUTH_ANONYMOUS_ENABLED: "true"
      GF_AUTH_ANONYMOUS_ORG_ROLE: Admin
      GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_PASSWORD:-<%= it.appName %>-dev}
      GF_ANALYTICS_REPORTING_ENABLED: "false"
      GF_ANALYTICS_CHECK_FOR_UPDATES: "false"
    ports:
      - "127.0.0.1:${GRAFANA_PORT:-3000}:3000"
    volumes:
      - grafana-data:/var/lib/grafana
      # Datasource Loki pré-câblée (lecture seule) → Grafana ouvre prêt, 0 setup.
      - ./docker/grafana/provisioning:/etc/grafana/provisioning:ro
    depends_on:
      # service_started (pas healthy) : Loki est distroless, pas de healthcheck.
      loki:
        condition: service_started

# Bridge nommé explicite : résolution DNS par nom de service, isolation des autres
# projets compose, nettoyage propre au down. Pas de sous-réseau figé (anti-collision).
networks:
  <%= it.appName %>:
    name: <%= it.appName %>-net
    driver: bridge

volumes:
  redis-data:
<% if (it.db) { %>  <%= it.db.service %>-data:
<% } %>  loki-data:
  grafana-data:
