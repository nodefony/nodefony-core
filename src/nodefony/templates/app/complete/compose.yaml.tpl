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
#   docker compose --profile browser up -d        # + navigateur jetable (voir tes écrans)
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

  # --- browser (profil browser — VOIR tes écrans, sans navigateur sur ta machine) ---
  #
  # Un navigateur jetable, piloté par un agent (ou par un script) : il ouvre une
  # page, lit la CONSOLE, l'arbre d'ACCESSIBILITÉ et les REQUÊTES réelles, et
  # dépose captures et journaux dans `tmp/browser/`. Sert à répondre « l'écran se
  # monte-t-il et s'alimente-t-il ? » sans que quelqu'un ait à regarder pour toi.
  #
  # Pourquoi en conteneur plutôt que sur le poste : un navigateur automatisé lancé
  # à nu peut saturer une machine de développement. Ici il est plafonné et meurt
  # au `down`. Rien à installer non plus : ni Chromium, ni pilote.
  #
  # TROIS RÈGLES qui ne se devinent pas — sans elles la page reste blanche ou
  # refusée, alors que le réseau, lui, passe :
  #   1. Joindre ton app par `host.docker.internal`, JAMAIS `localhost` : dans un
  #      conteneur ce nom désigne le conteneur lui-même. Si tu actives la barrière
  #      Host (`domainCheck`), ajoute ce nom aux `trustedHosts` en développement —
  #      sinon elle répond `421` alors que le réseau, lui, passe.
  #   2. Passer par HTTPS : le cookie de session est `secure`, donc IGNORÉ sur une
  #      origine `http://` qui n'est pas `localhost` — toutes les requêtes
  #      authentifiées reviendraient en `401`, ce qui se lit à tort comme un échec
  #      de connexion. Le certificat auto-signé de développement est accepté ici.
  #   3. Rien à poser pour Vite : l'origine des assets se DÉRIVE du `Host` de la
  #      requête. Arriver par `host.docker.internal` suffit — l'allowlist Vite et
  #      le WebSocket du HMR suivent le même nom, et ton poste continue d'être
  #      servi sur `127.0.0.1` en même temps. Pour forcer une origine unique
  #      (proxy frontal), écris `publicOrigin` dans `nodefony.config.ts`.
  #
  # DEUX façons de s'en servir, et elles ne se valent pas :
  #   - PILOTER directement — l'image embarque Chromium ET Playwright, on y copie
  #     un script et on l'exécute (`docker cp … && docker exec … node …`). C'est
  #     la voie normale : une commande, un JSON, un code de retour, quelques
  #     secondes. Le devkit livre deux sondes prêtes (voir `AGENTS.md`), dont la
  #     MESURE des contrastes et tailles réellement calculés par le moteur.
  #   - EXPLORER par MCP — le conteneur est aussi un serveur MCP, joignable sur
  #     `http://127.0.0.1:${BROWSER_PORT:-3001}/mcp` (il imprime la config à
  #     coller dans ses journaux au démarrage). Utile pour fouiller une page à la
  #     main ; plus lent et non scriptable pour tout le reste.
  browser:
    # Épinglée par empreinte : un `latest` mouvant sous un banc d'observation
    # ferait varier le rendu sans qu'on le sache.
    image: mcp/playwright@sha256:097d978439237cc9b12e10825836a97245add2be0479272cce9d98c368f024d1
    container_name: <%= it.appName %>-browser
    restart: unless-stopped
    profiles: ["browser"]
    networks: [<%= it.appName %>]
    ports:
      - "127.0.0.1:${BROWSER_PORT:-3001}:3000"
    # L'ENTRYPOINT de l'image fixe déjà `--headless --browser chromium
    # --no-sandbox` ; la commande le COMPLÈTE, elle ne le remplace pas.
    command:
      # Sans `--port`, le serveur parle en stdio : personne au bout d'un service.
      - "--port=3000"
      # Le défaut `localhost` ne serait pas joignable depuis l'hôte, même avec la
      # publication de port ci-dessus.
      - "--host=0.0.0.0"
      # Le port n'est publié que sur 127.0.0.1 : la vérification d'hôte ferait
      # doublon et refuserait l'accès par le nom du service.
      - "--allowed-hosts=*"
      # Certificat de développement auto-signé (cf règle 2 ci-dessus).
      - "--ignore-https-errors"
      # Captures, console et arbres écrits en FICHIERS dans le volume monté.
      - "--output-dir=/output"
      - "--output-mode=file"
      # Profil en mémoire : rien sur le disque du conteneur, et un `down` efface
      # l'état d'authentification avec lui.
      - "--isolated"
      # Un seul contexte pour tous les clients : une session ouverte reste ouverte
      # d'un appel à l'autre. Ne survit pas à un `restart` (profil en mémoire).
      - "--shared-browser-context"
      - "--viewport-size=1440x900"
    volumes:
      # `tmp/` est ignoré par git — une capture est une PHOTO, jamais du versionné.
      - ./tmp/browser:/output
    # Le répertoire courant, pas seulement `--output-dir` : une capture demandée
    # sous un nom relatif est résolue par Playwright contre le répertoire COURANT.
    # Sans cette ligne elle reste dans le conteneur pendant que l'appel répond OK.
    working_dir: /output
    extra_hosts:
      # Le nom par lequel le conteneur joint l'app qui tourne sur l'hôte.
      - "host.docker.internal:host-gateway"
    # Précaution : le `/dev/shm` par défaut de Docker (64 Mo) est connu pour faire
    # mourir un onglet Chromium sans message sur une page lourde.
    shm_size: "1gb"
    # Bornes de ressources : c'est ce qui rend « jetable » vérifiable — un
    # navigateur emballé ne peut pas prendre la machine, il se fait tuer.
    deploy:
      resources:
        limits:
          cpus: "2.0"
          memory: 2g

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
