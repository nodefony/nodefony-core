# L'image — le `Dockerfile` rendu, étage par étage

> **Maintenance** : vérité courante. Éditer en place.

Quatre étages, deux images finales possibles. Tu ne construis normalement que la dernière ; l'étage
du frontal ne sort que si tu le demandes explicitement.

## 1. La carte

| Étage       | Base                | Ce qu'il fait                                                         | Descend dans l'image finale ? |
| ----------- | ------------------- | --------------------------------------------------------------------- | ----------------------------- |
| `build`     | `node:24-alpine`    | Installe, compile, élague les dépendances de développement            | seulement son `/app`          |
| `proxyconf` | hérite de `build`   | **Dérive** la configuration nginx et rassemble les fichiers statiques | non — étage intermédiaire     |
| `edge`      | `nginx:1.27-alpine` | Le frontal, avec la configuration dérivée ci-dessus                   | non — cible séparée           |
| _(final)_   | `node:24-alpine`    | L'application en production                                           | **oui**                       |

```bash
docker build -t <app> .                      # l'application
docker build -t <app>-edge --target edge .   # le frontal, seulement si tu le veux
```

## 2. L'image finale — ce qui te concerne

| Directive     | Valeur                                                                         |
| ------------- | ------------------------------------------------------------------------------ |
| `WORKDIR`     | `/app`                                                                         |
| `USER`        | **`1000:1000`** — numérique, donc reportable tel quel dans un `runAsUser`      |
| `ENV`         | `NODE_ENV=production`                                                          |
| `EXPOSE`      | `5151`                                                                         |
| `CMD`         | `["node_modules/.bin/nodefony", "production"]`                                 |
| `HEALTHCHECK` | `/readyz`, intervalle 10 s, délai 2 s, **période de démarrage 20 s**, 3 essais |

**`node` est le process n° 1.** Il n'y a pas d'`ENTRYPOINT` d'init : le signal `SIGTERM` arrive
donc **directement** au process qui sait drainer. N'ajoute pas un init « pour les signaux » — tu
t'interposerais entre l'ordonnanceur et le seul process qui sait quoi en faire.

### Les deux dossiers inscriptibles

```dockerfile
RUN mkdir -p /app/tmp /app/var && chown 1000:1000 /app/tmp /app/var
```

Ils sont créés **et donnés au bon porteur avant** tout montage. C'est ce qui fait qu'un **volume
nommé** neuf hérite du bon propriétaire : Docker recopie le porteur du dossier sous-jacent. Un
**montage lié** (`bind`), lui, ne le fait pas — il arrive `root:root`, et le premier `mkdir` de
l'application échoue en `EACCES`. C'est la cause n° 1 des « ça marche chez moi ».

**Le reste du code appartient à `root`** : l'application tourne en `1000` et ne peut donc pas se
réécrire elle-même. C'est voulu, et c'est ce qui rend `readOnlyRootFilesystem: true` atteignable
dès que ces deux dossiers sont montés.

### Les arguments de construction

| `ARG`        | Défaut    | À quoi il sert                             |
| ------------ | --------- | ------------------------------------------ |
| `VERSION`    | `"0.1.0"` | Étiquette OCI `image.version`              |
| `VCS_REF`    | `""`      | Étiquette OCI `image.revision` — le commit |
| `BUILD_DATE` | `""`      | Étiquette OCI `image.created`              |

```bash
docker build -t <app>:$(git describe --tags --always) \
  --build-arg VERSION="$(node -p 'require("./package.json").version')" \
  --build-arg VCS_REF="$(git rev-parse --short HEAD)" \
  --build-arg BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)" .
```

Sans eux l'image se construit quand même — avec des étiquettes vides. Une image de production sans
`revision` est une image dont personne ne saura dire de quel code elle vient.

## 3. Changer la base — c'est prévu, et c'est écrit dans le fichier

Le gabarit porte deux alternatives en commentaire, avec leur mode d'emploi. La règle commune :
**remplacer les DEUX `FROM`, jamais un seul** — un étage de compilation `alpine` et une exécution
`slim` produisent des binaires natifs qui ne se chargeront pas.

| Tu veux…                                              | Bascule                                                          | Ce qu'il faut aussi changer                                     |
| ----------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------- |
| Un paquet natif qui ne publie **pas** de binaire musl | `node:24-slim` (glibc) sur les deux `FROM`                       | rien                                                            |
| La surface d'attaque minimale                         | `gcr.io/distroless/nodejs24-debian12` en finale, `slim` en build | **`CMD` et `HEALTHCHECK` en `/nodejs/bin/node`** — pas de shell |

Le symptôme d'un mélange musl/glibc est franc : un `.node` introuvable, ou `Error relocating`, **au
démarrage** — jamais à la construction. L'image se construit parfaitement et ne démarre pas.

## 4. L'étage du frontal — la configuration est DÉRIVÉE

L'étage `proxyconf` lance `proxy:generate` : il démarre l'application **sans ouvrir de port**, lit
ses montages statiques réels, sa taille de corps maximale et son battement de cœur temps réel, puis
écrit la configuration nginx. Tu ne l'écris pas à la main, et tu ne la corriges pas à la main : au
premier fichier statique ajouté, ta correction serait fausse et personne ne le verrait.

Ses arguments :

| `ARG`            | Défaut      | Rôle                                                |
| ---------------- | ----------- | --------------------------------------------------- |
| `EDGE_BACKEND`   | `app`       | Le nom par lequel le frontal joint l'application    |
| `EDGE_HOSTS`     | `localhost` | Les hôtes servis — devient `NF__HTTP__TRUSTEDHOSTS` |
| `EDGE_HTTP_PORT` | `8080`      | Port en clair                                       |
| `EDGE_TLS_PORT`  | `8443`      | Port TLS                                            |

Les ports sont **au-dessus de 1024** exprès : le frontal tourne donc sans capacité privilégiée, y
compris sous Podman sans privilèges.

🔴 **Aucun certificat n'est gravé dans l'image.** Ils se **montent** à l'exécution. Une clé privée
dans une couche est publiée avec l'image, et l'effacer dans une couche ultérieure ne l'enlève pas —
voir [`secrets.md`](secrets.md).

L'étage `edge` expose `8080` et `8443`, avec son propre `HEALTHCHECK` sur `/livez` (période de
démarrage 5 s, plus courte : nginx démarre vite).

## 5. Ce qu'on ne touche pas, et pourquoi

| La ligne                                                             | Pourquoi elle est là                                                                                                                                                        |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--ignore-scripts` à l'installation                                  | Un script d'installation d'une dépendance s'exécute pendant ta construction, avec ton réseau et ton cache. C'est la porte d'entrée classique d'une compromission de chaîne. |
| `npm ci` si le verrou existe, sinon `npm install`                    | `npm ci` refuse de démarrer sans verrou ; le gabarit doit marcher dans les deux cas                                                                                         |
| `npm prune --omit=dev` après la compilation                          | Les dépendances de développement sont dans l'image de construction, pas dans la finale                                                                                      |
| `rm -rf nodefony/config/certificates var tmp` en fin de construction | La matière de développement — certificats auto-signés, base locale — ne descend pas en production                                                                           |
| Le code laissé à `root`                                              | L'application ne peut pas se réécrire. Condition de la racine scellée.                                                                                                      |

## 6. Vérifier l'image qu'on a RÉELLEMENT construite

```bash
npx nodefony image:check <app>
```

Il lit les **couches**, pas l'image aplatie. La différence est tout le sujet : un fichier copié puis
supprimé plus loin n'apparaît plus dans un conteneur qui démarre, mais il est toujours **dans
l'archive** — et quiconque tire l'image peut l'extraire. Un contrôle qui regarde l'image aplatie
serait vert dans le cas exactement le plus fautif.

```bash
docker history <app> --no-trunc     # d'où vient chaque couche, et son poids
docker image inspect <app> --format '{{json .Config.Labels}}' | jq   # les étiquettes OCI
```
