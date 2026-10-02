<% if (it.releaseAge && it.releaseAge.file === "bunfig.toml") { %># Réglages bun du projet.

[install]
# Délai de décantation, en SECONDES (<%= it.releaseAge.value %> = <%= it.releaseAgeDays %> jours) : bun n'installe
# pas une version publiée depuis moins longtemps, il retient la précédente. Un
# paquet piégé (compte de mainteneur volé) est presque toujours retiré dans ce
# délai. Sous verrou (`--frozen-lockfile`) le délai ne joue pas.
minimumReleaseAge = <%= it.releaseAge.value %>

# Le framework est exempté : une application créée le jour d'une publication
# réclame cette version précise. L'exemption ne couvre pas ses dépendances.
minimumReleaseAgeExcludes = [<%= it.releaseAge.excludes.map((p) => JSON.stringify(p)).join(", ") %>]
<% } %>
