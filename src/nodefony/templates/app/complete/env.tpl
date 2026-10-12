# ══════════════════════════════════════════════════════════════════════════
#  Environnement de <%= it.appName %> sur CE poste — JAMAIS commité (.gitignore)
# ══════════════════════════════════════════════════════════════════════════
#
#  👉 TOUTES les variables que l'application lit sont dans .env.example, une à
#     une, avec leur rôle, leur défaut et un exemple (ou `npx nodefony env`).
#     Ce fichier-ci ne reprend que les plus utiles sur un poste de dev.
#
# Généré par `nodefony create app`. Ce sont TES valeurs, secrets de dev compris.
# En production ce fichier n'existe pas : les valeurs viennent de
# l'orchestrateur ou du gestionnaire de secrets (Secret k8s, vault…).
#
# Comment le lire :
#   NOM=valeur     ACTIVE — déjà remplie pour le décor de ce poste.
#   # NOM=valeur   PRÊTE — la valeur exacte de ce poste ; enlève le « # » le
#                  jour où tu en as besoin, rien d'autre à chercher.
#
# Deux cas, deux réponses :
#   - un service ÉTEINT (Redis, Keycloak pas encore lancé) se répare en le
#     démarrant : en développement, l'application démarre quand même, le
#     signale, et le rejoint dès qu'il répond. En production, elle refuse.
#   - une valeur FAUSSE (fichier introuvable, adresse mal écrite) ne marchera
#     jamais en attendant : l'application REFUSE de démarrer, en développement
#     comme en production, et dit quelle ligne corriger.

# ─── Clés de chiffrement ────────────────────────────────────────────────────
# Tirées au hasard à la création (32 octets, base64), propres à CE projet.
# Ne les retouche pas : ce qui a été chiffré avec deviendrait illisible.
# Rotation, ou clé perdue : npx nodefony security:secrets --write
#
# Chiffre, dans la base, le secret de double authentification de chaque compte.
NF_TOTP_KEY=<%= it.secrets.NF_TOTP_KEY %>
# Chiffre, dans la base, les secrets qui signent les webhooks.
NF_WEBHOOK_KEY=<%= it.secrets.NF_WEBHOOK_KEY %>
# Signe les jetons qui protègent les formulaires contre les envois forgés
# depuis un autre site (CSRF).
NF_CSRF_SECRET=<%= it.secrets.NF_CSRF_SECRET %>
#
# PAS de clé de signature des jetons ici (NF_JWT_KEYSET) : en développement
# elle vit dans var/keys/, et celle de PRODUCTION n'a rien à faire sur un poste.
<% if (it.db) { %>
# ─── Base de données ────────────────────────────────────────────────────────
# <%= it.db.label %> du compose (service `<%= it.db.service %>`), lancée par `npm run infra:up`.
<% if (it.mongo) { %># 🔴 Ne la commente pas : sans elle, @nodefony/mongoose n'a aucune base, et les
# comptes, jetons et sessions retombent en MÉMOIRE — perdus au redémarrage.
<% } else { %># Commente-la pour repasser en sqlite local (var/databases/), rien d'autre à changer.
<% } %>NF_DATABASE_URL=<%= it.db.url %>
<% } %>
# ─── Cache partagé (Redis) ──────────────────────────────────────────────────
# Sans elle, sessions et anti-double-envoi des formulaires vivent en mémoire :
# parfait pour un seul exemplaire, perdus au redémarrage.
# Avec elle, ils vivent dans le Redis du compose (service `redis`), partagés
# entre plusieurs exemplaires — comme dans le conteneur de l'app (compose.yaml).
# Décommente-la APRÈS `npm run infra:up` : Redis éteint, l'application démarre
# mais AUCUNE connexion ne marche (la session n'a nulle part où vivre).
# NF_REDIS_URL=redis://:<%= it.appName %>-dev@127.0.0.1:6379

# ─── Connexion par Keycloak (OpenID Connect) ────────────────────────────────
# Keycloak du compose, à lancer à part : `docker compose --profile keycloak up -d`.
# Valeurs PUBLIQUES de développement, les mêmes que dans
# docker/keycloak/import/realm.json. Keycloak éteint : pas de bouton
# « Keycloak » sur /login, un avertissement au démarrage, et le bouton revient
# tout seul dès qu'il répond. Commente les quatre lignes pour t'en passer.
NF_KEYCLOAK_ISSUER=https://localhost:8444/realms/<%= it.appName %>
NF_KEYCLOAK_CLIENT_ID=<%= it.appName %>
NF_KEYCLOAK_CLIENT_SECRET=<%= it.keycloak.clientSecret %>
# Appelant MACHINE du même realm (client <%= it.appName %>-machine), pour
# `npx nodefony app:partner:call --issuer keycloak` :
NF_KEYCLOAK_MACHINE_SECRET=<%= it.keycloak.machineSecret %>
#
# Compte d'administration de ce Keycloak (console https://localhost:8444/admin,
# commandes `security:keycloak:*`) — ce sont les valeurs du compose :
# NF_KEYCLOAK_ADMIN_USERNAME=admin
# NF_KEYCLOAK_ADMIN_PASSWORD=<%= it.appName %>-dev

# ─── Compte administrateur de l'application ─────────────────────────────────
# Créé au PREMIER démarrage : admin / nodefony-dev-42 si tu ne mets rien.
# Change-le avant ce premier démarrage — ensuite la variable ne sert plus.
# NF_ADMIN_PASSWORD=a-changer-avant-la-mise-en-ligne

# ─── Réseau ─────────────────────────────────────────────────────────────────
# Ports d'écoute. Laisse-les en commentaire en développement : un port déjà
# pris est remplacé par le suivant, annoncé au démarrage. Fixe-les si un outil
# attend l'application à un port précis.
# NF_PORT=5151
# NF_PORT_HTTPS=5152
# Ouvre l'application à ton réseau local, pour l'essayer depuis un téléphone
# (https://<IP-de-ta-machine>:5152). Fermée par défaut : le serveur de
# développement expose des outils d'administration.
# NF_BIND_ALL=true

# ─── Journaux ───────────────────────────────────────────────────────────────
# Où partent les journaux : stdout (le terminal, par défaut), file (logs/),
# null (nulle part).
# NF_LOG_DRIVER=file

# ─── Essayer la PRODUCTION sur ce poste (`npm run build` puis `npm start`) ──
# Le développement fait deux choses pour toi que la production refuse de faire
# en silence :
#
# 1. Reconnaître l'autorité de développement, qui signe le certificat du
#    Keycloak du compose. En production, il faut la déclarer — sans elle,
#    « certificat refusé (SELF_SIGNED_CERT_IN_CHAIN) ». Ce fichier naît au
#    premier `npm run dev` : déclaré avant, il bloquerait le démarrage.
# NF_TLS_CA_FILE=nodefony/config/certificates/ca/nodefony-root-ca.crt.pem
#    Un Keycloak signé par l'autorité de TON entreprise : même variable, son
#    fichier PEM (chemin relatif à l'application, ou absolu).
#
# 2. Fournir la clé de signature des jetons (NF_JWT_KEYSET). En production,
#    un serveur refuse de démarrer sans elle. Génère une clé d'ESSAI avec
#    `npx nodefony security:secrets --jwt-keyset` et pose-la dans ton terminal
#    le temps de l'essai, jamais ici : ce fichier ne porte pas de clé de
#    production.
#
# Nombre de processus : 1 (un par conteneur), auto (un par cœur), ou un nombre.
# NF_WORKERS=auto
