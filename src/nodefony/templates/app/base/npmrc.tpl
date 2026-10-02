<% if (it.releaseAge && it.releaseAge.file === ".npmrc") { %># Réglages npm du PROJET — versionnés, partagés par toute l'équipe et la CI.
# 🔴 Aucun jeton ici (`_authToken`) : ce fichier est commité. Un registre privé
# s'authentifie dans ~/.npmrc, celui du poste.

# Délai de décantation : npm n'installe pas une version publiée depuis moins de
# <%= it.releaseAge.value %> jours, il retient la précédente. Un paquet piégé (compte de
# mainteneur volé) est presque toujours retiré dans ce délai. Sous verrou
# (`npm ci`) le délai ne joue pas : il ne filtre que la résolution.
# Exige npm ≥ 11.17 — de 11.10 à 11.16, npm applique le délai mais IGNORE les
# exemptions ci-dessous (`nodefony doctor` le signale).
min-release-age=<%= it.releaseAge.value %>

# Le framework est exempté : une application créée le jour d'une publication
# réclame cette version précise. L'exemption ne couvre pas ses dépendances.
<% for (const pattern of it.releaseAge.excludes) { %>min-release-age-exclude[]=<%= pattern %>
<% } %><% } %>
