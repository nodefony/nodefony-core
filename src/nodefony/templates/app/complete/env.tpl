# ══════════════════════════════════════════════════════════════════════════
#  Environnement de <%= it.appName %> — fichier COMMITÉ (défauts NON-secrets)
# ══════════════════════════════════════════════════════════════════════════
# Convention (celle du framework, style Vite/Next) :
#   .env        → CE fichier : catalogue + défauts partagés, JAMAIS de secret
#   .env.local  → tes valeurs machine + SECRETS (gitignoré via *.local,
#                 généré à la création de l'app)
# Priorité de chargement : .env.local PRIME sur .env (première clé gagne).
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
<% if (it.db) { %># Tu as retenu <%= it.db.label %> à la création : l'URL ci-dessous joint le service
# du `compose.yaml` généré. Lance-le avant l'app — `npm run infra:up`.
<% if (it.mongo) { %># 🔴 Ne la commente pas : sans elle, @nodefony/mongoose n'a aucune base, et les
# comptes, jetons et sessions retombent en MÉMOIRE — perdus au redémarrage.
# Cette application ne porte pas d'ORM SQL vers lequel se replier.
<% } else { %># (Repasser en sqlite local : commente cette ligne, rien d'autre à changer.)
<% } %># Elle joint le service `<%= it.db.service %>` du compose, avec ses identifiants de dev.
NF_DATABASE_URL=<%= it.db.url %>

<% } else { %># NF_DATABASE_URL=postgres://user:pass@localhost:5432/<%= it.appName %> (exemple)

<% } %>

# Cache/éphémère partagé : sa présence CHARGE @nodefony/redis (sessions,
# idempotence, backplane realtime cross-pod).
# NF_REDIS_URL=redis://localhost:6379

# ── Secrets (module security) — VALEURS dans .env.local, jamais ici ─────────
# Générées à la création de l'app ; rotation/rattrapage :
#   npx nodefony security:secrets --write
# NF_TOTP_KEY=        → .env.local (chiffrement des secrets 2FA au repos)
# NF_WEBHOOK_KEY=     → .env.local (chiffrement des signatures webhook)
# NF_CSRF_SECRET=     → .env.local (jetons anti-CSRF, partagé en cluster)
#
# Clé de SIGNATURE des jetons — PRODUCTION seulement, et JAMAIS dans .env.local.
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
#   3. décommenter les deux lignes ci-dessous ET le secret dans .env.local
#   4. démarrer l'app en lui faisant confiance au certificat de dev :
#      NODE_EXTRA_CA_CERTS=nodefony/config/certificates/ca/nodefony-root-ca.crt.pem npm run dev
#   5. https://localhost:5152/nodefony/login → bouton « Keycloak »
# NF_KEYCLOAK_ISSUER=https://localhost:8444/realms/<%= it.appName + "\n" %>
# NF_KEYCLOAK_CLIENT_ID=<%= it.appName + "\n" %>
# NF_KEYCLOAK_CLIENT_SECRET=     → .env.local
# En production : l'URL publique de l'app, base des retours OAuth.
# NF_OAUTH_REDIRECT_BASE=https://app.example.com
