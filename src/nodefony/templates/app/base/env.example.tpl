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
#    @requiredWhen           exigée sous condition : sans elle, refus de démarrer
#    @sensitive              c'est un secret : jamais dans git
#    @placement              où la poser en production :
#                              platform     variables du déploiement (hébergeur)
#                              secrets      gestionnaire de secrets
#                              workstation  le poste seulement, sans objet en prod
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
#   3. Framework : déploiement
#        NF_ENV, NF_CLUSTER_PROBE, NF_INSTANCE_ID, NF_BOOT_TIMEOUT_MS,
#        NF_BOOT_WARN_MS
#   4. Framework : poste et diagnostic
#        NF_CLI_DEBUG, NF_NO_UPDATE_CHECK, NF_DEV_UI, NF_DEV_MOUSE,
#        NF_DEV_PORTS, NF_KERNEL_TRACE_FILE, NF_NO_TTY, NF_PERF_PROBE


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
# @placement=platform
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
# @placement=platform
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
# @placement=platform
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
# @placement=platform
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
# @placement=platform
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
# @placement=platform
# @type=enum(stdout, file, null)
# @default=stdout
# NF_LOG_DRIVER=stdout



# ============================================================================
#  3. FRAMEWORK : DÉPLOIEMENT
# ============================================================================


# ─── Environnement de déploiement ───────────────────────────────────────────
#
# Environnement de déploiement quand il diffère du mode runtime (`APP_ENV`
# gagne).
#
# @optional
# @placement=platform
# @default="le mode d'exécution (NODE_ENV)"
# NF_ENV=


# ─── Sonde du maître de grappe ──────────────────────────────────────────────
#
# Coupe la sonde du maître de grappe quand elle vaut `0`.
#
# @optional
# @placement=platform
# @default="active (0 la coupe)"
# NF_CLUSTER_PROBE=


# ─── Identifiant d'instance ─────────────────────────────────────────────────
#
# Identifiant d'instance rendu par le plan d'administration (défaut : le pid).
#
# @optional
# @placement=platform
# @default="le pid du process"
# NF_INSTANCE_ID=


# ─── Délai maximal de démarrage (ms) ────────────────────────────────────────
#
# Délai au-delà duquel un démarrage est déclaré perdu.
#
# @optional
# @placement=platform
# @default="20000 en développement, 60000 en production"
# NF_BOOT_TIMEOUT_MS=


# ─── Seuil de démarrage lent (ms) ───────────────────────────────────────────
#
# Délai au-delà duquel un démarrage lent est signalé.
#
# @optional
# @placement=platform
# @default="5000 (0 désactive la mesure)"
# NF_BOOT_WARN_MS=



# ============================================================================
#  4. FRAMEWORK : POSTE ET DIAGNOSTIC
# ============================================================================


# ─── Trace du lanceur du CLI ────────────────────────────────────────────────
#
# Trace la décision du lanceur du CLI sur la sortie d'erreur.
#
# @optional
# @placement=workstation
# @default=désactivée
# NF_CLI_DEBUG=


# ─── Vérification de version du CLI ─────────────────────────────────────────
#
# Empêche `create app` de demander au registre npm si une version plus récente
# du CLI existe.
#
# @optional
# @placement=workstation
# @default="active (désactivée d'office quand `CI` est posée)"
# NF_NO_UPDATE_CHECK=


# ─── Plein écran du terminal de développement ───────────────────────────────
#
# Plein écran du terminal de développement : `1` le demande, `0` l'interdit —
# défaut : oui hors Windows (`--ui` / `--no-ui` l'emportent).
#
# @optional
# @placement=workstation
# @default="oui, sauf sous Windows"
# NF_DEV_UI=


# ─── Souris en plein écran de développement ─────────────────────────────────
#
# Capture de la souris en plein écran de développement : `1` la demande, `0`
# l'interdit — défaut : oui hors Windows (`--mouse` / `--no-mouse`
# l'emportent).
#
# @optional
# @placement=workstation
# @default="oui, sauf sous Windows"
# NF_DEV_MOUSE=


# ─── Ports libérés par le superviseur de développement ──────────────────────
#
# Ports que le superviseur de développement doit libérer, imposés par
# l'opérateur.
#
# @optional
# @placement=workstation
# @default="les ports déclarés par l'application, sinon 5151,5152"
# NF_DEV_PORTS=


# ─── Trace de démarrage du Kernel ───────────────────────────────────────────
#
# Fichier où le Kernel écrit sa trace de démarrage (diagnostic).
#
# @optional
# @placement=workstation
# @default="aucune trace"
# NF_KERNEL_TRACE_FILE=


# ─── Rendu non interactif forcé ─────────────────────────────────────────────
#
# Force le rendu non interactif, quel que soit le terminal.
#
# @optional
# @placement=workstation
# @default="déduit du terminal"
# NF_NO_TTY=


# ─── Sonde de performance HTTP ──────────────────────────────────────────────
#
# Arme la sonde de performance du pipeline HTTP.
#
# @optional
# @placement=workstation
# @default="désactivée (1 l'arme)"
# NF_PERF_PROBE=
