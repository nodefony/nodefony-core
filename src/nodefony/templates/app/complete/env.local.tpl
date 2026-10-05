# ══════════════════════════════════════════════════════════════════════════
#  Secrets & valeurs MACHINE de <%= it.appName %> — GITIGNORÉ (règle *.local)
# ══════════════════════════════════════════════════════════════════════════
# Généré par `nodefony create app`. Ne JAMAIS committer ce fichier ; en
# production les secrets viennent du secret-manager (Secret k8s, vault…).
# Rotation / rattrapage : npx nodefony security:secrets --write

# Clés de chiffrement au repos (32 octets aléatoires, base64) :
<%= Object.entries(it.secrets).map(([k, v]) => k + "=" + v).join("\n") + "\n" %>
# PAS de clé de signature des jetons ici (NF_JWT_KEYSET) : en dev elle vit dans
# var/keys/, et la clé de PRODUCTION n'a rien à faire sur un poste — voir .env.

# Compte admin local : admin / nodefony-dev-42 par défaut — décommente pour changer :
# NF_ADMIN_PASSWORD=a-changer-avant-la-mise-en-ligne

# Keycloak de DÉVELOPPEMENT (profil `keycloak` du compose) — secret PUBLIC, écrit
# dans docker/keycloak/import/realm.json ; décommente avec les lignes de `.env` :
# NF_KEYCLOAK_CLIENT_SECRET=<%= it.keycloak.clientSecret %>

