# Nodefony — application de démonstration

Cette image **n'est pas le framework** : c'est une application Nodefony complète,
**générée** à chaque publication par `nodefony create app --preset complete`, puis
construite avec le `Dockerfile` que ce générateur produit. Elle sert à voir tourner
le framework sans rien installer — et à prouver que ce que le générateur écrit
démarre réellement.

Le framework, lui, s'installe depuis npm ; le code vit sur GitHub.

- **Framework** — <https://www.npmjs.com/package/nodefony>
- **Code source** — <https://github.com/nodefony/nodefony-core>
- **Documentation** — <https://nodefony.github.io/nodefony-core/>
- **Licence** — Apache-2.0

## Lancer

```bash
docker run --rm -p 5151:5151 nodefony/nodefony:alpha
```

L'application répond sur <http://127.0.0.1:5151>. La console d'administration est
sous `/nodefony`.

Elle embarque SQLite et applique ses migrations au démarrage : aucun service
externe n'est requis pour ce premier essai.

## Étiquettes disponibles

| Étiquette        | Ce qu'elle désigne                                  |
| ---------------- | --------------------------------------------------- |
| `10.0.0-alpha.8` | une publication précise — c'est celle à figer en CI |
| `alpha`          | la dernière préversion du canal `alpha` (mobile)    |

**`latest` n'existe pas, et c'est délibéré** : la ligne 10 est en préversion.
Tirer une étiquette mobile sans le savoir est la façon la plus simple de voir une
image changer sous ses pieds.

## Ce que cette image ne promet pas

C'est une **préversion** : ni la stabilité des interfaces, ni la compatibilité
entre deux alphas. Elle n'est pas destinée à porter une charge de production —
elle montre une topologie qui fonctionne, et sert de point de départ.

Pour une application à soi, le chemin est le générateur, pas cette image :

```bash
npm create nodefony@alpha mon-app
cd mon-app
npm run dev
```

## Configuration — deux mécanismes, et un seul à retenir

L'image ne définit pas de variables « à elle ». Elle expose le mécanisme de
configuration du framework, qui vaut pour n'importe quelle application Nodefony.

### 1. Surcharger n'importe quel réglage — `NF__<MODULE>__<CHEMIN>`

Tout réglage de tout module s'écrase par une variable d'environnement, sans
reconstruire l'image et sans monter de fichier. La règle est mécanique : un
**double tiret bas** sépare chaque niveau. Le préfixe `NF__` s'écrit en
majuscules ; le nom du module et le chemin, eux, sont insensibles à la casse —
`NF__HTTP__TRUSTEDHOSTS` atteint bien la clé `trustedHosts`, qu'il est donc inutile
d'orthographier en casse mixte dans un fichier d'environnement.

```bash
# Le module « http », clé « trustProxy »
docker run -e NF__HTTP__TRUSTPROXY=true -p 5151:5151 nodefony/nodefony:alpha

# Un chemin imbriqué : module « security », section « jwt », clé « accessTtls »
docker run -e NF__SECURITY__JWT__ACCESSTTLS=900 nodefony/nodefony:alpha
```

Trois propriétés qui comptent, et qui distinguent ce mécanisme d'un simple
`process.env` :

- **La variable gagne sur la configuration de l'application** — l'ordre est
  `environnement > application > défaut du module`. C'est ce qui rend une image
  identique déployable sur plusieurs environnements.
- **La valeur est VALIDÉE** par le schéma du module avant que l'application ne
  démarre. Une valeur du mauvais type arrête le démarrage en la nommant, au lieu
  de produire un comportement inexplicable plus tard.
- **Un module ou un chemin inconnu est SIGNALÉ**, avec une suggestion
  d'orthographe, et n'interrompt pas le démarrage. Il n'existe pas de réglage
  fantôme accepté en silence — la faute la plus coûteuse à diagnostiquer.

### 2. Déclarer l'infrastructure — une URL, et le reste suit

Plutôt que de configurer chaque brique (sessions, cache, verrous, jetons), on
déclare ce qui est _disponible_, et chaque brique choisit son magasin.

| Variable          | Alias de plateforme accepté | Ce qu'elle déclare                                |
| ----------------- | --------------------------- | ------------------------------------------------- |
| `NF_DATABASE_URL` | `DATABASE_URL`              | un stockage durable (PostgreSQL, MySQL, MongoDB…) |
| `NF_REDIS_URL`    | `REDIS_URL`                 | un stockage éphémère partagé entre exemplaires    |

L'alias sans préfixe existe parce que les hébergeurs le posent eux-mêmes ; la
forme `NF_` gagne quand les deux sont présentes.

```bash
docker run -e NF_DATABASE_URL="postgres://user:mdp@hote:5432/base" \
           -e NF_REDIS_URL="redis://hote:6379" \
           -p 5151:5151 nodefony/nodefony:alpha
```

**Sans aucune de ces variables**, l'application tourne sur SQLite, en un seul
exemplaire — c'est le mode de cette image par défaut, et il suffit pour
l'essayer. Un schéma d'URL non reconnu **arrête le démarrage** : il n'y a jamais
de repli silencieux vers SQLite, parce qu'une application qui croit écrire dans
PostgreSQL et écrit ailleurs est un incident qu'on découvre trop tard.

### Les autres variables utiles

| Variable                 | Effet                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------- |
| `NODE_ENV`               | `production` dans cette image. En `development`, l'outillage de développement s'active |
| `NF__HTTP__TRUSTPROXY`   | faire confiance aux en-têtes d'un frontal (`X-Forwarded-*`)                            |
| `NF__HTTP__TRUSTEDHOSTS` | les noms d'hôte servis — défense contre l'empoisonnement d'en-tête `Host`              |
| `NF_BOOT_TIMEOUT_MS`     | délai au-delà duquel un démarrage est déclaré en échec                                 |
| `NF_BOOT_WARN_MS`        | seuil à partir duquel un démarrage lent est signalé                                    |

**Toute variable lue par Nodefony commence par `NF_`.** Ce n'est pas une
convention d'écriture : c'est ce qui garantit qu'aucun réglage du framework
n'entre en collision avec ceux d'un autre outil présent dans le même conteneur —
une collision ne produit jamais d'erreur, seulement un comportement
incompréhensible.

### Port

Cette image expose **`5151`**, et seulement lui : c'est l'application.

Le `Dockerfile` que le générateur produit contient aussi un étage frontal nginx
(`--target edge`, ports 8080 et 8443, terminaison TLS), mais il n'est **pas** dans
l'image publiée — il se construit depuis son application. En orchestrateur, c'est
l'ingress qui joue ce rôle.

## Ce qu'elle contient

Le préréglage `complete` du générateur, c'est-à-dire : le noyau HTTP/HTTP2 avec
WebSocket dans le même contexte de contrôleur, l'injection de dépendances, le
pare-feu applicatif et les sessions, l'ORM avec ses migrations, un frontend bâti
par Vite, et la console d'administration.

## Sur quelle base elle est bâtie

L'image part de **`node:24-alpine`**. Ce n'est pas une habitude reprise d'un
gabarit trouvé ailleurs : les trois candidates ont été construites avec un
contenu identique, scannées et **démarrées**, et c'est la mesure qui a tranché.

| Base                                  | Image finale | Critiques | Hautes | Node embarqué | libc  | Shell dedans |
| ------------------------------------- | -----------: | --------: | -----: | ------------- | ----- | ------------ |
| **`node:24-alpine`** — celle-ci       |   **438 Mo** |     **0** |  **4** | 24.21         | musl  | oui (`sh`)   |
| `node:24-slim`                        |       519 Mo |         2 |     14 | 24.18         | glibc | oui (`bash`) |
| `gcr.io/distroless/nodejs24-debian12` |       400 Mo |         0 |      8 | 24.14         | glibc | **non**      |

Les comptes de vulnérabilités portent sur les images **finales**, application
comprise — pas sur les bases seules, qui affichent toutes des chiffres flatteurs
et ne disent rien de ce qu'on déploie.

**Ce qui décide, et ce n'est pas le poids.** Distroless est la plus légère et
perd quand même : elle embarque un Node plus ANCIEN, et le suivra toujours avec
du retard. Ce retard n'est pas qu'une affaire de CVE — il nous a coûté un
démarrage impossible, sur une API de `node:crypto` que le framework employait et
que sa version de Node n'avait pas encore. Une base qui décide de ta version de
Node décide de ce que ton code a le droit d'appeler.

**Et l'objection historique contre Alpine est tombée.** On évitait musl à cause
des paquets natifs ; les deux qu'une application `complete` embarque —
`better-sqlite3` et `@node-rs/argon2` — publient désormais leurs binaires musl,
et s'exécutent ici après une installation **sans script d'installation**
(`--ignore-scripts`) : base SQLite créée et relue, empreinte Argon2id produite.
Mesuré, pas supposé.

### En changer dans ton application

Cette image est construite avec le `Dockerfile` que `nodefony create app`
produit — le même que tu reçois. Sa base tient en **deux lignes `FROM`**, qui se
changent **ensemble** : les deux étages doivent partager la même libc, sinon un
binaire natif installé pendant la construction ne se charge pas à l'exécution, et
le message d'erreur ne parle jamais de libc.

```dockerfile
FROM node:24-alpine AS build   # étage de construction
…
FROM node:24-alpine            # étage d'exécution — celui qu'on déploie
```

**Revenir à glibc** — à faire si un paquet natif que tu ajoutes ne publie pas de
binaire musl. Le symptôme arrive au **démarrage** (`.node` introuvable, « Error
relocating »), jamais à l'installation :

```dockerfile
FROM node:24-slim AS build
FROM node:24-slim
```

**Passer en distroless** — la plus petite et la plus fermée, mais ce n'est pas un
remplacement d'une ligne : elle n'a ni shell ni gestionnaire de paquets (plus de
`docker exec … sh` pour diagnostiquer), et son binaire `node` n'est pas sur le
`PATH`. Il faut donc aussi réécrire `CMD` et `HEALTHCHECK` en `/nodejs/bin/node`,
et garder une image complète pour construire :

```dockerfile
FROM node:24-slim AS build
FROM gcr.io/distroless/nodejs24-debian12
```

> **Après tout changement de base : reconstruire, puis DÉMARRER.** « Ça
> construit » ne prouve rien — les trois images se construisaient, et l'une des
> trois ne démarrait pas.

## Remonter d'une image à son commit

Chaque image porte les étiquettes OCI normées, et un contrôle refuse la
publication si l'une d'elles est vide ou fausse :

```bash
docker inspect nodefony/nodefony:alpha \
  --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'
```

## Signaler un problème

<https://github.com/nodefony/nodefony-core/issues>
