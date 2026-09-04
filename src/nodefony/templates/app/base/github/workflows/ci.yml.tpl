# CI de <%= it.appName %> — générée par `nodefony create app`.
#
# C'est ICI que vit le filet complet, pas dans des hooks git : `verify`
# enchaîne typecheck, lint, tests et `nodefony doctor`, puis la suite e2e
# démarre l'application POUR DE VRAI (--detach --wait) et l'interroge en HTTP.
# Un hook local est un doublon contournable (--no-verify) ; la forge, non.
name: CI

on:
  push:
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
<% if (it.db) { %>    # La base retenue à la création (`NF_DATABASE_URL` du `.env` la joint sur
    # 127.0.0.1) — même image que le compose : les deux viennent du MÊME
    # catalogue du générateur, elles ne peuvent pas diverger.
    services:
      <%= it.db.service %>:
        image: <%= it.db.image %>
        ports:
          - "127.0.0.1:<%= it.db.port %>:<%= it.db.port %>"
<% if (it.db.choice === "postgres") { %>        env:
          POSTGRES_USER: <%= it.appName %>
          POSTGRES_PASSWORD: <%= it.appName %>-dev
          POSTGRES_DB: <%= it.appName %>
        options: >-
          --health-cmd "pg_isready -U <%= it.appName %> -d <%= it.appName %>"
          --health-interval 5s
          --health-timeout 3s
          --health-retries 10
<% } %><% if (it.db.choice === "mariadb") { %>        env:
          MARIADB_ROOT_PASSWORD: <%= it.appName %>-dev
          MARIADB_USER: <%= it.appName %>
          MARIADB_PASSWORD: <%= it.appName %>-dev
          MARIADB_DATABASE: <%= it.appName %>
        options: >-
          --health-cmd "healthcheck.sh --connect --innodb_initialized"
          --health-interval 5s
          --health-timeout 3s
          --health-retries 10
<% } %><% if (it.db.choice === "mysql") { %>        env:
          MYSQL_ROOT_PASSWORD: <%= it.appName %>-dev
          MYSQL_USER: <%= it.appName %>
          MYSQL_PASSWORD: <%= it.appName %>-dev
          MYSQL_DATABASE: <%= it.appName %>
        options: >-
          --health-cmd "mysqladmin ping -h 127.0.0.1 -u<%= it.appName %> -p<%= it.appName %>-dev --silent"
          --health-interval 5s
          --health-timeout 3s
          --health-retries 10
<% } %><% } %>    steps:
      - uses: actions/checkout@v7

      - uses: actions/setup-node@v7
        with:
          # Le plancher des `engines` du framework — la forge éprouve la
          # version la plus ANCIENNE qu'on prétend servir.
          node-version: 24
          cache: npm

      - run: npm ci
<% if (it.db) { %>
      # Les deux bases que la suite e2e exige — le service n'en crée qu'une.
      # `CREATE DATABASE` est un privilège d'administration : c'est le décor qui
      # les fournit, jamais la suite (elle n'aurait pas le droit, et ne doit pas
      # l'avoir). Même raison et mêmes noms que `docker/db/init-nodefony-e2e.sql`
      # côté compose. `shell:` est déclaré : sans lui, la forge prend celui de la
      # plateforme.
      - name: bases de la suite e2e
        shell: bash
        run: |
<% if (it.db.choice === "postgres") { %>          export PGPASSWORD='<%= it.appName %>-dev'
          for base in <%= it.db.databaseE2e %> <%= it.db.databaseScratch %>; do
            psql -h 127.0.0.1 -p <%= it.db.port %> -U <%= it.appName %> -d <%= it.appName %> \
              -c "CREATE DATABASE \"$base\""
          done
<% } else { %>          mysql -h 127.0.0.1 -P <%= it.db.port %> -uroot -p'<%= it.appName %>-dev' <<'SQL'
          CREATE DATABASE IF NOT EXISTS `<%= it.db.databaseE2e %>`;
          CREATE DATABASE IF NOT EXISTS `<%= it.db.databaseScratch %>`;
          GRANT ALL PRIVILEGES ON `<%= it.db.databaseE2e %>`.* TO '<%= it.appName %>'@'%';
          GRANT ALL PRIVILEGES ON `<%= it.db.databaseScratch %>`.* TO '<%= it.appName %>'@'%';
          FLUSH PRIVILEGES;
          SQL
<% } %><% } %>
      # typecheck + lint + tests + `nodefony doctor` — l'ordre du script.
      - run: npm run verify

      # L'application DÉMARRE et répond en HTTP : la seule preuve qui compte.
      - run: npm run test:e2e
