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
