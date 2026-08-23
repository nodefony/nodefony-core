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

# Secrets posés chez les agents de développement (nodefony security:token --write).
# 🔴 `.gemini/.env` porte un JETON PORTEUR : la déclaration de la porte MCP,
# elle, reste versionnable (.gemini/settings.json, .mcp.json) — c'est la CLÉ qui
# ne se commite pas. Un jeton commité est un jeton publié.
.gemini/.env
.gemini/.env.*

# Agents de développement : leur dossier est le home REDIRIGÉ que `ai:mcp` leur
# donne pour que la porte MCP soit déclarée par PROJET (son URL porte un port —
# une déclaration globale ne pourrait désigner qu'une application). Ils y
# déposent aussi leurs fichiers de travail : seule la DÉCLARATION se versionne.
.vibe/*
!.vibe/config.toml
.codex/*
!.codex/config.toml
