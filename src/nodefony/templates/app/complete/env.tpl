# ══════════════════════════════════════════════════════════════════════════
#  Environnement de <%= it.appName %> sur CE poste — JAMAIS commité (.gitignore)
# ══════════════════════════════════════════════════════════════════════════
# Généré par `nodefony create app`. Ce sont TES valeurs, secrets de dev compris.
# La notice de toutes les variables : .env.example (commitée, jamais chargée).
# En production ce fichier n'existe pas : les secrets viennent de
# l'orchestrateur ou du gestionnaire de secrets (Secret k8s, vault…).
# Rotation / rattrapage des clés : npx nodefony security:secrets --write

# Clés de chiffrement au repos (32 octets aléatoires, base64) :
<%= Object.entries(it.secrets).map(([k, v]) => k + "=" + v).join("\n") + "\n" %>
<% if (it.db) { %>
# Base du compose de dev (<%= it.db.label %>, service `<%= it.db.service %>`) —
# lance-le avant l'app : `npm run infra:up`.
<% if (it.mongo) { %># 🔴 Ne la commente pas : sans elle, @nodefony/mongoose n'a aucune base, et les
# comptes, jetons et sessions retombent en MÉMOIRE — perdus au redémarrage.
<% } else { %># Commente-la pour repasser en sqlite local (var/databases/), rien d'autre à changer.
<% } %>NF_DATABASE_URL=<%= it.db.url %>
<% } %>
# PAS de clé de signature des jetons ici (NF_JWT_KEYSET) : en dev elle vit dans
# var/keys/, et la clé de PRODUCTION n'a rien à faire sur un poste.

# Compte admin local : admin / nodefony-dev-42 par défaut — décommente pour changer :
# NF_ADMIN_PASSWORD=a-changer-avant-la-mise-en-ligne

# Keycloak de DÉVELOPPEMENT (profil `keycloak` du compose) — valeurs PUBLIQUES,
# écrites dans docker/keycloak/import/realm.json. Décommente les trois lignes
# (marche à suivre complète : .env.example, section Keycloak) :
# NF_KEYCLOAK_ISSUER=https://localhost:8444/realms/<%= it.appName + "\n" %>
# NF_KEYCLOAK_CLIENT_ID=<%= it.appName + "\n" %>
# NF_KEYCLOAK_CLIENT_SECRET=<%= it.keycloak.clientSecret %>
