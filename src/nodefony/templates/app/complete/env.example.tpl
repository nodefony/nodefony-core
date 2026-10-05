# ══════════════════════════════════════════════════════════════════════
#  .env.example — la NOTICE des variables d'environnement
# ══════════════════════════════════════════════════════════════════════
#
#  Commitée, jamais lue au démarrage, aucun secret.
#
#  Pour démarrer :
#
#    cp .env.example .env
#
#  puis, dans .env, retire le « # » devant ce dont tu as besoin.
#
#    .env         TES valeurs, sur ton poste. JAMAIS commité.
#    production   aucun fichier : l'hébergeur fournit les variables.
#
#  Une variable posée dans le terminal l'emporte sur .env.
#  Ce que l'application lit vraiment, et d'où :  npx nodefony env
#
#  Sous chaque variable :
#    @required / @optional   faut-il la poser ?
#    @sensitive              c'est un secret : jamais dans git
#    @default                ce qui s'applique si tu ne poses rien
#
#  Avancé : NF__<MODULE>__<CHEMIN>=valeur règle n'importe quelle clé de
#  configuration ; <NOM>_FILE=/chemin lit un secret monté (Docker, k8s).
#
#  ⚙️  Généré depuis env.ts — ne pas éditer à la main :
#      npx nodefony env --example


#  SOMMAIRE — cherche une variable par son nom (Ctrl+F) ou par son thème :
#
#   1. Réseau et processus
#        NF_PORT, PORT, NF_PORT_HTTPS, NF_BIND_ALL, NF_WORKERS
#   2. Journaux
#        NF_LOG_DRIVER
#   3. Base de données et cache
#        NF_DATABASE_URL, NF_REDIS_URL
#   4. Comptes créés au démarrage
#        NF_ADMIN_PASSWORD
#   5. Clés et secrets
#        NF_TOTP_KEY, NF_WEBHOOK_KEY, NF_CSRF_SECRET
#   6. Jetons (JWT)
#        NF_JWT_ISSUER, NF_JWT_KEYSET
#   7. Connexion Keycloak
#        NF_KEYCLOAK_ISSUER, NF_KEYCLOAK_CLIENT_ID, NF_KEYCLOAK_CLIENT_SECRET
#   8. Connexion externe : réglage commun
#        NF_OAUTH_REDIRECT_BASE


# ============================================================================
#  1. RÉSEAU ET PROCESSUS
# ============================================================================


# ─── Port HTTP ──────────────────────────────────────────────────────────────
#
# Le port sur lequel l'application répond en HTTP (sans chiffrement).
#
# En développement, laisse vide : si le port est déjà pris par une autre
# application, le suivant est choisi et annoncé au démarrage. En production,
# fixe-le : c'est le port qu'attendent l'hébergeur et ses sondes de santé —
# s'il est occupé, le démarrage échoue.
#
# @optional
# @default=5151
# @example=8080
# NF_PORT=


# ─── Port HTTP fourni par l'hébergeur ───────────────────────────────────────
#
# Cloud Run, Heroku, Railway ou Fly posent eux-mêmes cette variable et
# attendent que l'application écoute dessus : tu n'as rien à écrire. Si
# NF_PORT est aussi posée, c'est NF_PORT qui l'emporte.
#
# @optional
# @default=aucun
# PORT=


# ─── Port HTTPS ─────────────────────────────────────────────────────────────
#
# Le port sur lequel l'application répond en HTTPS (chiffré, HTTP/2).
#
# En développement, laisse vide. Dans le cloud, le chiffrement se fait souvent
# devant l'application (ingress, répartiteur de charge) : ce port ne sert
# alors pas.
#
# @optional
# @default=5152
# @example=8443
# NF_PORT_HTTPS=


# ─── Ouvrir au réseau local (développement) ─────────────────────────────────
#
# En développement, l'application n'écoute que ta propre machine. true l'ouvre
# à toutes les interfaces, pour l'essayer depuis un téléphone ou un autre
# poste : https://<IP-de-ta-machine>:5152. Une seule exception de certificat à
# accepter sur l'appareil.
#
# Laisse false sinon : le serveur de développement expose des outils
# d'administration. Sans effet en production, qui écoute déjà partout.
#
# @optional
# @default=false
# NF_BIND_ALL=false


# ─── Nombre de processus en production ──────────────────────────────────────
#
# Combien de processus Node lance nodefony production : 1 (un par conteneur,
# l'hébergeur multiplie les conteneurs), auto (un par cœur alloué au
# conteneur), ou un nombre. L'option --workers l'emporte. Sans effet en
# développement.
#
# @optional
# @default=1
# @example=auto
# NF_WORKERS=



# ============================================================================
#  2. JOURNAUX
# ============================================================================


# ─── Destination des journaux ───────────────────────────────────────────────
#
# Où partent les journaux de l'application : stdout (la sortie standard — le
# bon choix dans un conteneur, l'hébergeur les collecte), file (des fichiers
# dans logs/), ou null (nulle part, pour un banc de mesure).
#
# @optional
# @type=enum(stdout, file, null)
# @default=stdout
# NF_LOG_DRIVER=stdout



# ============================================================================
#  3. BASE DE DONNÉES ET CACHE
# ============================================================================


# ─── Base de données ────────────────────────────────────────────────────────
#
# L'adresse de ta base de données, en une seule URL : son début dit de quelle
# base il s'agit (sqlite:, postgres://, mysql://, mongodb://).
#
# Sans elle, l'application utilise une base SQLite dans var/databases/ — rien
# à installer, et les données survivent au redémarrage. Elle contient un mot
# de passe : jamais commitée. DATABASE_URL (Heroku, Railway) est aussi
# acceptée.
#
# @optional
# @default=aucun
# @example=postgres://app:motdepasse@localhost:5432/app
# NF_DATABASE_URL=


# ─── Redis (cache partagé) ──────────────────────────────────────────────────
#
# L'adresse d'un serveur Redis. Sa seule présence branche Redis : les sessions
# et l'anti-double-envoi des formulaires sont alors partagés entre plusieurs
# exemplaires de l'application.
#
# Sans elle, tout reste en mémoire — parfait pour un seul exemplaire.
# REDIS_URL est aussi acceptée.
#
# @optional
# @default=aucun
# @example=redis://:motdepasse@localhost:6379
# NF_REDIS_URL=



# ============================================================================
#  4. COMPTES CRÉÉS AU DÉMARRAGE
# ============================================================================


# ─── Mot de passe administrateur ────────────────────────────────────────────
#
# Le compte « admin » est créé au premier démarrage avec ce mot de passe. En
# développement, un mot de passe connu s'applique si tu ne mets rien. En
# production, aucun : sans cette variable, aucun compte n'est créé. Une fois
# le compte créé, la variable ne sert plus.
#
# @optional
# @sensitive
# @default="nodefony-dev-42 en développement ; aucun en production"
# NF_ADMIN_PASSWORD=



# ============================================================================
#  5. CLÉS ET SECRETS
# ============================================================================


# ─── Clé de chiffrement de la double authentification ───────────────────────
#
# Chiffre, dans la base, le secret de double authentification (le code à six
# chiffres) de chaque compte. Générée à la création de l'application.
#
# En production, sans elle, la double authentification est désactivée.
#
# @optional
# @sensitive
# @default="clé éphémère en développement ; 2FA désactivée en production"
# NF_TOTP_KEY=


# ─── Clé de chiffrement des webhooks ────────────────────────────────────────
#
# Chiffre, dans la base, les secrets qui signent les webhooks. Générée à la
# création de l'application (npx nodefony security:secrets --write).
#
# En production, sans elle, les webhooks sont désactivés : une clé qui change
# à chaque démarrage rendrait les secrets illisibles.
#
# @optional
# @sensitive
# @default="clé éphémère en développement ; webhooks désactivés en production"
# NF_WEBHOOK_KEY=


# ─── Secret anti-falsification des formulaires ──────────────────────────────
#
# Signe les jetons qui protègent les formulaires contre les envois forgés
# depuis un autre site (CSRF). Généré à la création de l'application.
#
# Avec plusieurs exemplaires, il doit être le même partout — sinon un
# formulaire est refusé au hasard. Obligatoire en production : sans lui, le
# démarrage refuse.
#
# @optional
# @required=forEnv(production)
# @sensitive
# @default="tiré au démarrage (un par process)"
# NF_CSRF_SECRET=



# ============================================================================
#  6. JETONS (JWT)
# ============================================================================


# ─── Adresse publique de l'émetteur de jetons ───────────────────────────────
#
# L'adresse publique de l'application, gravée dans chaque jeton qu'elle émet.
# Posée, elle permet à d'autres services de vérifier ces jetons. Sans elle,
# les jetons marchent pour l'application elle-même, mais personne d'autre ne
# peut les vérifier.
#
# Ne la change plus ensuite : les jetons déjà émis seraient refusés.
#
# @optional
# @default="https://localhost:5152 en développement ; aucune en production"
# @example=https://app.example.com
# NF_JWT_ISSUER=


# ─── Clé de signature des jetons (production) ───────────────────────────────
#
# En développement, rien à poser : la clé est créée dans var/keys/.
#
# En production, tous les exemplaires de l'application doivent signer avec la
# MÊME clé — sinon un utilisateur est déconnecté au hasard. Génère-la une fois
# (npx nodefony security:secrets --jwt-keyset) et range-la dans le
# gestionnaire de secrets de ton hébergeur, jamais dans un fichier.
#
# @optional
# @sensitive
# @default="var/keys/ en développement ; une clé par process en production"
# NF_JWT_KEYSET=



# ============================================================================
#  7. CONNEXION KEYCLOAK
# ============================================================================


# ─── Keycloak : adresse du realm ────────────────────────────────────────────
#
# Pour se connecter avec un serveur Keycloak (OpenID Connect) : l'adresse du
# realm, en https. Le bouton « Keycloak » n'apparaît que si les trois
# variables NF_KEYCLOAK_* sont posées.
#
# @optional
# @default=aucun
# @example=https://localhost:8444/realms/<%= it.appName %>
# NF_KEYCLOAK_ISSUER=


# ─── Keycloak : identifiant du client ───────────────────────────────────────
#
# Le nom du client déclaré pour cette application dans le realm Keycloak.
#
# @optional
# @default=aucun
# @example=<%= it.appName %>
# NF_KEYCLOAK_CLIENT_ID=


# ─── Keycloak : secret du client ────────────────────────────────────────────
#
# Le secret de ce client, copié depuis la console Keycloak (onglet «
# Credentials » du client).
#
# @optional
# @sensitive
# @default=aucun
# NF_KEYCLOAK_CLIENT_SECRET=



# ============================================================================
#  8. CONNEXION EXTERNE : RÉGLAGE COMMUN
# ============================================================================


# ─── Adresse publique pour les retours de connexion ─────────────────────────
#
# Google, GitHub ou Keycloak renvoient l'utilisateur vers l'application après
# la connexion, à une adresse qu'ils comparent au caractère près à celle
# enregistrée chez eux :
#     <NF_OAUTH_REDIRECT_BASE>/nodefony/security/api/oauth2/<fournisseur>/callback
#
# En production, mets l'URL publique de l'application. En développement, garde
# localhost — jamais 127.0.0.1 : les passkeys refusent une adresse IP. Si
# Google refuse https://localhost, utilise http://localhost:5151.
#
# @optional
# @default=https://localhost:5152
# @example=https://app.example.com
# NF_OAUTH_REDIRECT_BASE=
