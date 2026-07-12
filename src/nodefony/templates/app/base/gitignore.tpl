node_modules/
dist/
var/
public/dist/
*.log

# Fichiers d'environnement — convention B (Vite/Next), celle du framework :
#   COMMITÉS (défauts NON-secrets)  : .env, .env.<env>, .env.example
#   GITIGNORÉS (secrets / machine)  : *.local → .env.local, .env.<env>.local
# Les clés de chiffrement générées à la création de l'app vivent dans
# .env.local — ne JAMAIS les committer (rotation : nodefony security:secrets).
*.local
