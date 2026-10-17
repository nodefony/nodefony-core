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
#   Choix : a | b  les valeurs acceptées.
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
# Choix (le préfixe désigne le moteur) : sqlite:./var/app.db · postgres://… ·
#   mysql://… (MySQL ou MariaDB) · mongodb://…
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
# Format : redis://:<mot de passe>@<hôte>:<port>
# NF_REDIS_URL=redis://:<%= it.appName %>-dev@127.0.0.1:6379

# ─── Temps réel : relais entre exemplaires (backplane) ──────────────────────
# Quand un exemplaire de l'application publie sur un canal temps réel, le
# backplane fait suivre le message aux AUTRES exemplaires, pour que tous les
# navigateurs abonnés le reçoivent. Sur ce poste (un seul process), rien à
# poser : le défaut `cluster` suffit.
# Choix :
#   loopback  un seul process, aucun relais ;
#   cluster   (défaut) relais entre les workers d'UNE machine
#             (`nodefony cluster`), sans rien d'externe ;
#   redis     relais entre PLUSIEURS machines ou pods, par Redis — exige
#             NF_REDIS_URL, et le secret ci-dessous.
# NF_REALTIME_DRIVER=redis
# Scelle les messages du relais Redis : sans lui, quiconque écrit dans ce Redis
# publie chez tous les exemplaires (l'application le signale). Au moins 32
# caractères, le MÊME sur tous les exemplaires. Tiré au hasard pour ce projet :
# NF_REALTIME_BACKPLANE_SECRET=<%= it.realtime.backplaneSecret %>
# Cloisonne deux déploiements de la même application sur un Redis partagé
# (préproduction et production). Défaut : le nom de l'application.
# NF_REALTIME_BACKPLANE_NAMESPACE=<%= it.appName %>-preprod

# ─── Connexion par Keycloak (OpenID Connect) ────────────────────────────────
# Keycloak du compose, à lancer à part : `docker compose --profile keycloak up -d`.
# Valeurs PUBLIQUES de développement, les mêmes que dans
# docker/keycloak/import/realm.json. Keycloak éteint : pas de bouton
# « Keycloak » sur /login, un avertissement au démarrage, et le bouton revient
# tout seul dès qu'il répond. Commente les quatre lignes pour t'en passer.
# Format de l'émetteur : https://<hôte>/realms/<realm> (toujours en https).
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
# Choix : un texte libre (en production, aucun défaut : pas de compte créé).
# NF_ADMIN_PASSWORD=a-changer-avant-la-mise-en-ligne

# ─── Réseau ─────────────────────────────────────────────────────────────────
# Ports d'écoute. Laisse-les en commentaire en développement : un port déjà
# pris est remplacé par le suivant, annoncé au démarrage. Fixe-les si un outil
# attend l'application à un port précis.
# Choix : un numéro de port (1 à 65535). Défauts : 5151 (http), 5152 (https).
# NF_PORT=5151
# NF_PORT_HTTPS=5152
# Ouvre l'application à ton réseau local, pour l'essayer depuis un téléphone
# (https://<IP-de-ta-machine>:5152). Fermée par défaut : le serveur de
# développement expose des outils d'administration.
# Choix : true | false (défaut false ; sans effet en production).
# NF_BIND_ALL=true

# ─── Journaux ───────────────────────────────────────────────────────────────
# Deux réglages distincts : où l'application ÉCRIT ses journaux, et d'où la
# console d'administration les RELIT (le backplane des journaux).
#
# Écriture. Choix :
#   stdout  (défaut) le terminal — en conteneur, l'hébergeur les collecte ;
#   file    des fichiers dans logs/ ;
#   null    nulle part (banc de mesure).
# NF_LOG_DRIVER=file
#
# Relecture (console d'administration). Choix :
#   auto          (défaut) Loki ou OpenSearch si leur adresse est posée,
#                 sinon la mémoire (un process) ou des fichiers (cluster) ;
#   memory        la mémoire du process (perdue au redémarrage) ;
#   file          les fichiers de logs/ ;
#   cluster-file  les fichiers de tous les workers de `nodefony cluster` ;
#   loki          Grafana Loki (NF_LOKI_URL) ;
#   opensearch    OpenSearch (NF_OPENSEARCH_URL).
# Laisse `auto` : poser une adresse ci-dessous suffit à choisir.
# NF_LOG_QUERY_DRIVER=auto
#
# 🧭 Recommandé en PRODUCTION : l'application écrit sur stdout, et un
# COLLECTEUR de l'hébergeur (Alloy, Fluent Bit, Vector, agent Datadog…)
# transporte les journaux. Il les a déjà pris si le process meurt, ne coûte
# rien aux requêtes, et changer d'outil ne touche pas au code. L'envoi DIRECT
# ci-dessous est une OPTION — démo, poste de dev, serveur sans collecteur.
# Aujourd'hui, une adresse posée fait les deux : l'application y ENVOIE ses
# journaux, et la console les y relit.
#
# Loki du compose : `docker compose --profile loki up -d` (+ Grafana). Loki
# éteint : rien ne plante, la relecture repasse en mémoire.
# NF_LOKI_URL=http://localhost:3100
# OpenSearch (pas dans le compose : un serveur à toi). Ne pose pas Loki ET
# OpenSearch sans choisir NF_LOG_QUERY_DRIVER : le démarrage refuserait.
# NF_OPENSEARCH_URL=http://localhost:9200

# ─── Essayer la PRODUCTION sur ce poste (`npm run build` puis `npm start`) ──
# Le développement fait deux choses pour toi que la production refuse de faire
# en silence :
#
# 1. Reconnaître l'autorité de développement, qui signe le certificat du
#    Keycloak du compose. En production, il faut la déclarer — sans elle,
#    « certificat refusé (SELF_SIGNED_CERT_IN_CHAIN) ». Ce fichier naît au
#    premier `npm run dev` : avant, le développement l'ignore (le journal le
#    dit), la production refuse de démarrer.
#    Choix : le chemin d'un fichier PEM, relatif à l'application ou absolu.
# NF_TLS_CA_FILE=nodefony/config/certificates/ca/nodefony-root-ca.crt.pem
#    Un Keycloak signé par l'autorité de TON entreprise : même variable, son
#    fichier PEM.
#
# 2. Fournir la clé de signature des jetons (NF_JWT_KEYSET). En production,
#    un serveur refuse de démarrer sans elle. Génère une clé d'ESSAI avec
#    `npx nodefony security:secrets --jwt-keyset` et pose-la dans ton terminal
#    le temps de l'essai, jamais ici : ce fichier ne porte pas de clé de
#    production.
#
# Nombre de processus. Choix : 1 (défaut, un par conteneur — l'hébergeur
# multiplie les conteneurs) | auto (un par cœur alloué) | un nombre.
# NF_WORKERS=auto
