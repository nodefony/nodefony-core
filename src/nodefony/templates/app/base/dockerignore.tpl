# Ce qui n'entre PAS dans le contexte de construction de l'image.
# Motifs relatifs à la racine du contexte — `**/` pour atteindre les modules
# locaux (`modules/*/node_modules`, `modules/*/dist`).

# Reconstruits DANS l'image. Entrés depuis la machine, ils masqueraient le
# build de l'étape et l'image partirait avec le code de la veille.
**/node_modules
**/dist

# Écritures du runtime (journaux, pid, sockets) — propres à une machine.
var
*.log

# Secrets — convention B : `*.local` n'est jamais commité, et n'entre pas
# davantage dans une image. Les couches d'une image sont lisibles par qui la
# télécharge, et un secret y reste même effacé par une couche suivante. En
# production, les valeurs viennent de l'orchestrateur (variables
# d'environnement, gestionnaire de secrets).
*.local
**/*.local

# 🔴 MATIÈRE CRYPTOGRAPHIQUE. Le `.gitignore` d'à côté écrit « la clé qui va
# avec, jamais » et exclut `*.key`, `privkey*.pem`, `*-key.pem` — ce fichier ne
# le faisait pas, alors que le `COPY . ./` du Dockerfile emporte tout et que
# l'image, elle, est PUBLIÉE. Quiconque avait lancé son application en
# développement expédiait la clé privée de son poste dans un dépôt d'images :
# le framework écrit celle qu'il fabrique sous `nodefony/config/certificates`
# (`certificates.ts:134`), et une couche reste lisible même effacée plus loin.
# Le motif porte sur l'EXTENSION, pas sur le chemin : un dossier se déplace, un
# suffixe non. Aucune construction n'a jamais besoin d'un certificat — en
# production il vient de l'orchestrateur, du proxy frontal ou de l'ingress.
nodefony/config/certificates
**/*.key
**/*.pem
**/*.crt
**/*.p12
**/*.pfx

# Rien de tout ceci ne sert à `npm run build`, et tout se retrouverait dans une
# image publique : bancs d'essai, artefacts jetables, chaînes d'intégration,
# décor de développement et consignes d'agents. Ce n'est pas que du poids —
# c'est de la surface qu'on donne à lire.
tests
tmp
.github
.gitlab-ci.yml
.claude
.agents
AGENTS.md
compose.yaml
docker
deploy

# Bruit — sans effet sur l'exécution, mais chaque octet du contexte est envoyé
# au démon Docker à chaque construction.
.git
.gitignore
Dockerfile
.dockerignore
.DS_Store
