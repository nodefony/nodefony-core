<% if (it.packageManager === "pnpm") { %># Réglages pnpm du projet — pnpm ne lit plus le champ "pnpm" du package.json
# depuis sa version 11 : c'est ICI que vivent les modules, les builds et les
# overrides.

# Les modules locaux (`nodefony create module`) : pnpm ne lie à la racine que
# les paquets de son workspace, et ne lit pas le champ `workspaces`.
packages:
  - "modules/*"

# Scripts d'installation des dépendances : refusés par défaut, et chaque refus
# est ÉCRIT plutôt que laissé à une erreur au premier `pnpm install`
# (`strictDepBuilds` vaut `true`). Le même choix que l'`allowScripts` d'npm.
allowBuilds:
  better-sqlite3: false
  esbuild: false

# Une dépendance qui n'est listée nulle part ci-dessus n'est PAS construite
# non plus — `false` ici change seulement l'erreur en avertissement, pour
# qu'une pile front qui embarque un module natif n'arrête pas l'installation.
# Approuver un build : `pnpm approve-builds`.
strictDepBuilds: false

# Délai de décantation, en MINUTES (<%= it.releaseAge.value %> = <%= it.releaseAgeDays %> jours) : pnpm
# n'installe pas une version publiée depuis moins longtemps. Un paquet piégé
# (compte de mainteneur volé) est presque toujours retiré dans ce délai. Sous
# verrou (`--frozen-lockfile`) le délai ne joue pas. Le framework est exempté :
# une application créée le jour d'une publication réclame cette version
# précise — l'exemption ne couvre pas ses dépendances.
minimumReleaseAge: <%= it.releaseAge.value %>

minimumReleaseAgeExclude:
<% for (const pattern of it.releaseAge.excludes) { %>  - "<%= pattern %>"
<% } %>

overrides:
  "@esbuild-kit/core-utils>esbuild": "<%= it.pkg["esbuild"] %>"
<% } %>