# ══════════════════════════════════════════════════════════════════════════
#  Secrets & valeurs MACHINE de <%= it.appName %> — GITIGNORÉ (règle *.local)
# ══════════════════════════════════════════════════════════════════════════
# Généré par `nodefony create app`. Ne JAMAIS committer ce fichier ; en
# production les secrets viennent du secret-manager (Secret k8s, vault…).
# Rotation / rattrapage : npx nodefony security:secrets --write

# Clés de chiffrement au repos (32 octets aléatoires, base64) :
<%= Object.entries(it.secrets).map(([k, v]) => k + "=" + v).join("\n") + "\n" %>
# Compte admin local : admin / admin par défaut — décommente pour changer :
# NF_ADMIN_PASSWORD=change-me
