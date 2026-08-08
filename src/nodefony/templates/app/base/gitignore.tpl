node_modules/
dist/
var/
public/dist/
*.log

# Artefacts jetables — captures d'écran, journaux de console et arbres produits
# par le navigateur du compose (`--profile browser`). Ce sont des PHOTOS d'un
# instant : elles se refont, elles ne se versionnent pas.
tmp/

# Fichiers d'environnement — convention B (Vite/Next), celle du framework :
#   COMMITÉS (défauts NON-secrets)  : .env, .env.<env>, .env.example
#   GITIGNORÉS (secrets / machine)  : *.local → .env.local, .env.<env>.local
# Les clés de chiffrement générées à la création de l'app vivent dans
# .env.local — ne JAMAIS les committer (rotation : nodefony security:secrets).
*.local
