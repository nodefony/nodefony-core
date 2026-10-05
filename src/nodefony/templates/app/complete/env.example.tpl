# ══════════════════════════════════════════════════════════════════════════
#  Notice des variables de <%= it.appName %> — COMMITÉE, jamais chargée
# ══════════════════════════════════════════════════════════════════════════
# Deux fichiers, une règle — « qui fournit la valeur ? » :
#   .env.example  → CE fichier : la notice. Tout est commenté, aucun secret.
#   .env          → TES valeurs de poste, secrets de dev compris. JAMAIS commité
#                   (créé par `nodefony create app`).
#   production    → AUCUN fichier : secrets par l'orchestrateur ou le gestionnaire
#                   de secrets ; réglages non secrets dans nodefony.config.ts.
# Précédence : variable du process (shell, orchestrateur) > .env.
# Chaque variable est déclarée et validée dans env.ts (seul lecteur de
# process.env) — une variable non déclarée là-bas n'existe pas pour l'app.

# ── Réseau ──────────────────────────────────────────────────────────────────
# Ports d'écoute. Absents = défauts du framework (HTTP 5151, HTTPS 5152).
# En DEV, si le port est déjà pris (une autre app Nodefony), l'app prend le
# suivant libre et l'ANNONCE (`portPolicy: "auto"`). En PRODUCTION le port est un
# CONTRAT (service, ingress, sonde) : occupé = échec franc (`portPolicy: "strict"`).
# `PORT` est l'alias des plateformes (Cloud Run, Heroku, Railway) — elles
# l'injectent elles-mêmes ; `NF_PORT` l'emporte si les deux sont là.
# NF_PORT=5151
# NF_PORT_HTTPS=5152
# DEV : écouter sur toutes les interfaces pour ouvrir l'app depuis un téléphone
# ou un autre poste du réseau local (https://<IP-de-la-machine>:5152). Absent =
# boucle locale seule (127.0.0.1).
# NF_BIND_ALL=true

# ── Observabilité ───────────────────────────────────────────────────────────
# Sink des logs : stdout (cloud-native, défaut) | file | null
# NF_LOG_DRIVER=stdout

# ── Persistance (infra déclarée → stores dérivés automatiquement) ───────────
# URL unique, dialecte déduit du scheme. ABSENTE = profil solo : sqlite local
# (var/databases/) — l'app persiste out-of-the-box (users, sessions, jetons).
<% if (it.db) { %># Tu as retenu <%= it.db.label %> à la création : `.env` pose déjà l'URL du
# service `<%= it.db.service %>` du `compose.yaml` généré (`npm run infra:up`).
# En production, l'orchestrateur la fournit — jamais l'URL de dev.
# NF_DATABASE_URL=<%= it.db.url %>

<% } else { %># NF_DATABASE_URL=postgres://user:pass@localhost:5432/<%= it.appName %> (exemple)

<% } %>
# Cache/éphémère partagé : sa présence CHARGE @nodefony/redis (sessions,
# idempotence, backplane realtime cross-pod).
# NF_REDIS_URL=redis://localhost:6379

# ── Secrets (module security) — VALEURS dans .env (poste), jamais ici ───────
# Générées à la création de l'app ; rotation/rattrapage :
#   npx nodefony security:secrets --write
# NF_TOTP_KEY=        → .env (chiffrement des secrets 2FA au repos)
# NF_WEBHOOK_KEY=     → .env (chiffrement des signatures webhook)
# NF_CSRF_SECRET=     → .env (jetons anti-CSRF, partagé en cluster)
#
# Clé de SIGNATURE des jetons — PRODUCTION seulement, et JAMAIS dans .env.
# En dev, rien à poser : elle vit dans var/keys/. En production, UNE valeur pour
# tous les pods et workers (sinon 401 au hasard), générée une fois :
#   npx nodefony security:secrets --jwt-keyset
# puis rangée dans le gestionnaire de secrets et injectée en NF_JWT_KEYSET.
# NF_JWT_KEYSET=      → gestionnaire de secrets (JSON sur une ligne)
# URL publique de l'app comme émetteur de jetons (https) — la production l'écrit :
# NF_JWT_ISSUER=https://app.example.com

# ── Compte admin (seedé au premier boot — nodefony/security/provisionUsers.ts)
# DEV : défaut admin / nodefony-dev-42 (local). PROD : OBLIGATOIRE, sans lui aucun compte
# n'est créé (le définir via le secret-manager, pas dans un fichier commité).
# NF_ADMIN_PASSWORD=

# ── Connexion par Keycloak (OpenID Connect) — facultative ───────────────────
# Absentes = aucun bouton, aucun avertissement : l'app démarre comme avant.
# Essai local (profil `keycloak` du compose.yaml, realm `<%= it.appName %>` importé
# depuis docker/keycloak/import/, utilisateur alice / alice-dev) :
#   1. npx nodefony http:certificates          (une fois — Keycloak sert en https)
#   2. docker compose --profile keycloak up -d keycloak
#   3. décommenter les trois lignes NF_KEYCLOAK_* dans .env
#   4. démarrer l'app en lui faisant confiance au certificat de dev :
#      NODE_EXTRA_CA_CERTS=nodefony/config/certificates/ca/nodefony-root-ca.crt.pem npm run dev
#   5. https://localhost:5152/nodefony/login → bouton « Keycloak »
# NF_KEYCLOAK_ISSUER=https://localhost:8444/realms/<%= it.appName + "\n" %>
# NF_KEYCLOAK_CLIENT_ID=<%= it.appName + "\n" %>
# NF_KEYCLOAK_CLIENT_SECRET=     → .env
# En production : l'URL publique de l'app, base des retours OAuth.
# NF_OAUTH_REDIRECT_BASE=https://app.example.com
