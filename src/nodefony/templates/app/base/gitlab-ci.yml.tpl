# CI de <%= it.appName %> — générée par `nodefony create app` (GitLab).
#
# Même filet que le workflow GitHub, même doctrine : `verify` (typecheck +
# lint + tests + `nodefony doctor`) puis la suite e2e qui démarre l'application
# POUR DE VRAI et l'interroge en HTTP. Le fichier est inerte hors GitLab —
# les deux forges sont servies, le dépôt choisit en poussant.

verify:
  image: node:24
  cache:
    key:
      files:
        - package-lock.json
    paths:
      - .npm/
<% if (it.db) { %>  # La base retenue à la création — même image que le compose (même
  # catalogue du générateur). ⚠️ Sur GitLab, un service se joint par son
  # ALIAS, jamais par l'adresse locale du `.env` (il tourne dans un autre
  # conteneur) : la variable ci-dessous PRIME sur le `.env` — le shell gagne
  # toujours dans la cascade d'environnement de Nodefony.
  services:
    - name: <%= it.db.image %>
      alias: <%= it.db.service %>
  variables:
    NF_DATABASE_URL: "<%= it.db.scheme %>://<%= it.appName %>:<%= it.appName %>-dev@<%= it.db.service %>:<%= it.db.port %>/<%= it.appName %>"
<% if (it.db.choice === "postgres") { %>    POSTGRES_USER: <%= it.appName %>
    POSTGRES_PASSWORD: <%= it.appName %>-dev
    POSTGRES_DB: <%= it.appName %>
<% } %><% if (it.db.choice === "mariadb") { %>    MARIADB_ROOT_PASSWORD: <%= it.appName %>-dev
    MARIADB_USER: <%= it.appName %>
    MARIADB_PASSWORD: <%= it.appName %>-dev
    MARIADB_DATABASE: <%= it.appName %>
<% } %><% if (it.db.choice === "mysql") { %>    MYSQL_ROOT_PASSWORD: <%= it.appName %>-dev
    MYSQL_USER: <%= it.appName %>
    MYSQL_PASSWORD: <%= it.appName %>-dev
    MYSQL_DATABASE: <%= it.appName %>
<% } %><% } %>  script:
    - npm ci --cache .npm --prefer-offline
    # typecheck + lint + tests + `nodefony doctor` — l'ordre du script.
    - npm run verify
    # L'application DÉMARRE et répond en HTTP : la seule preuve qui compte.
    - npm run test:e2e
