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

## Lancer — trois lignes, et pourquoi trois

```bash
# 1. L'image fabrique ses propres secrets — une seule fois, gardés dans un fichier
docker run --rm nodefony/nodefony:beta node_modules/.bin/nodefony security:secrets --env > nodefony.env

# 2. Le mot de passe du compte « admin » de la console — choisis-le
echo "NF_ADMIN_PASSWORD=choisis-un-mot-de-passe" >> nodefony.env

# 3. Lancer, avec ce fichier
docker run --rm -p 5151:5151 --env-file nodefony.env nodefony/nodefony:beta
```

L'application répond sur <http://127.0.0.1:5151>. La console d'administration est
sous <http://127.0.0.1:5151/nodefony> : identifiant `admin`, le mot de passe de la
ligne 2.

### Pourquoi pas une seule ligne ?

Parce que cette image tourne **comme en production**, et qu'une application
Nodefony en production **refuse de démarrer sans ses secrets**. Lancée sans rien,
elle s'arrête aussitôt (code de sortie `78`) en nommant la variable qui manque.
C'est voulu.

Un secret, ici, c'est une longue valeur aléatoire qui signe ou chiffre quelque
chose : le jeton anti-falsification des formulaires, la signature des jetons de
connexion. Si l'application en tirait un au hasard à chaque démarrage, tout ce
qu'elle a signé deviendrait invalide au redémarrage suivant — les utilisateurs
seraient déconnectés — et, avec plusieurs exemplaires, chacun aurait le sien :
une connexion acceptée par l'un serait refusée par l'autre. Un framework qui
« dépanne » en inventant la valeur cache donc une panne qu'on découvre en
production. Nodefony préfère s'arrêter et le dire.

Ligne par ligne :

1. **Les secrets, sans rien installer.** C'est l'image elle-même qui les fabrique
   (`security:secrets --env`) : aucun outil sur ton poste, pas même Node. Le
   fichier `nodefony.env` en reçoit quatre — voir le tableau plus bas. **Garde ce
   fichier** et réutilise-le : le régénérer revient à changer les clés, donc à
   invalider ce qui a été signé avec les précédentes. **Ne le commite jamais**.
2. **Le compte administrateur.** En production, Nodefony ne crée aucun compte avec
   un mot de passe par défaut — un mot de passe connu de tous ouvrirait toutes les
   installations. Sans cette ligne, l'application démarre, mais personne ne peut
   entrer dans la console.
3. **Le lancement.** `--env-file` passe chaque ligne du fichier comme une variable
   d'environnement. C'est exactement ce que fait un orchestrateur (Kubernetes,
   Compose) avec ses secrets : tu fais, en trois lignes, le geste d'un vrai
   déploiement.

`--rm` supprime le conteneur à l'arrêt, **et la base SQLite avec lui** : chaque
lancement repart d'une base neuve. Pour garder les données, retire `--rm` et
relance le même conteneur (`docker start -a <nom>`), ou donne une base externe
(voir « Déclarer l'infrastructure » plus bas).

Elle embarque SQLite, déjà migrée à la construction de l'image : aucun service
externe n'est requis pour ce premier essai. Une application réelle garde, elle, sa
base hors de l'image, et applique ses migrations par un job AVANT de démarrer ses
exemplaires.

## Étiquettes disponibles

| Étiquette       | Ce qu'elle désigne                                             |
| --------------- | -------------------------------------------------------------- |
| `10.0.0-beta.2` | une publication précise — c'est celle à figer en CI            |
| `beta`          | la dernière préversion du canal `beta` (mobile)                |
| `alpha`         | l'ancien canal, figé sur `10.0.0-alpha.9` — ne plus l'employer |

**`latest` n'existe pas, et c'est délibéré** : la ligne 10 est en préversion.
Tirer une étiquette mobile sans le savoir est la façon la plus simple de voir une
image changer sous ses pieds.

## Ce que cette image ne promet pas

C'est une **préversion** : ni la stabilité des interfaces, ni la compatibilité
entre deux bêtas — une rupture y reste possible, et chacune est annoncée en tête du
CHANGELOG. Elle n'est pas destinée à porter une charge de production —
elle montre une topologie qui fonctionne, et sert de point de départ.

**Elle accepte un mot de passe envoyé en clair (HTTP)**, et c'est la seule entorse
qu'elle fait à la production : sans elle, la connexion à la console sur
<http://127.0.0.1:5151> serait refusée (« Credentials must be sent over HTTPS »).
Une application Nodefony en production refuse un mot de passe qui n'arrive pas en
HTTPS ; cette image le déclare explicitement
(`NF__SECURITY__ALLOWINSECURECREDENTIALS=true`) parce qu'elle sert à un essai sur
ton poste. **Ne l'expose pas telle quelle** : derrière un frontal TLS, repasse la
variable à `false` et déclare le frontal (`NF__HTTP__TRUSTPROXY`).

Pour une application à soi, le chemin est le générateur, pas cette image :

```bash
npm create nodefony@beta mon-app
cd mon-app
npm run dev
```

## Configuration — deux mécanismes, et un seul à retenir

L'image ne définit pas de variables « à elle ». Elle expose le mécanisme de
configuration du framework, qui vaut pour n'importe quelle application Nodefony.

### Les secrets de la production — ce que fait chacun, et ce qui arrive sans lui

Les quatre premiers sont ceux que `security:secrets --env` écrit (ligne 1 de
« Lancer ») ; le cinquième, c'est toi qui le choisis (ligne 2).

| Variable            | À quoi elle sert                                                        | Sans elle, en production                         |
| ------------------- | ----------------------------------------------------------------------- | ------------------------------------------------ |
| `NF_CSRF_SECRET`    | signe le jeton qui empêche un autre site de soumettre tes formulaires   | **démarrage refusé** (code `78`)                 |
| `NF_JWT_KEYSET`     | signe les jetons de connexion — une paire de clés, écrite en JSON       | **démarrage refusé**                             |
| `NF_TOTP_KEY`       | chiffre, dans la base, le secret de double authentification des comptes | démarre, **double authentification désactivée**  |
| `NF_WEBHOOK_KEY`    | chiffre, dans la base, les secrets qui signent les webhooks             | démarre, **webhooks désactivés**                 |
| `NF_ADMIN_PASSWORD` | mot de passe du compte `admin`, créé au premier démarrage               | démarre, **aucun compte : console inaccessible** |

Les trois du bas ne bloquent pas le démarrage : une application peut vivre sans
double authentification ni webhooks. Mais rien n'est remplacé en silence — le
journal le signale à chaque démarrage (`CRITIC` pour les deux clés, `WARNING`
pour le compte).

**Dans un vrai déploiement**, ces valeurs ne vivent pas dans un fichier sur un
disque : elles vont dans le gestionnaire de secrets de l'hébergeur (Secret
Kubernetes, coffre-fort), qui les injecte en variables d'environnement — le même
geste que `--env-file`, en plus sûr. Elles se génèrent **une fois** et restent
**les mêmes pour tous les exemplaires** de l'application.

### 1. Surcharger n'importe quel réglage — `NF__<MODULE>__<CHEMIN>`

Tout réglage de tout module s'écrase par une variable d'environnement, sans
reconstruire l'image et sans monter de fichier. La règle est mécanique : un
**double tiret bas** sépare chaque niveau. Le préfixe `NF__` s'écrit en
majuscules ; le nom du module et le chemin, eux, sont insensibles à la casse —
`NF__HTTP__TRUSTEDHOSTS` atteint bien la clé `trustedHosts`, qu'il est donc inutile
d'orthographier en casse mixte dans un fichier d'environnement.

```bash
# Le module « http », clé « trustProxy »
docker run --env-file nodefony.env -e NF__HTTP__TRUSTPROXY=true -p 5151:5151 nodefony/nodefony:beta

# Un chemin imbriqué : module « security », section « jwt », clé « accessTtls »
docker run --env-file nodefony.env -e NF__SECURITY__JWT__ACCESSTTLS=900 -p 5151:5151 nodefony/nodefony:beta
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
docker run --env-file nodefony.env \
           -e NF_DATABASE_URL="postgres://user:mdp@hote:5432/base" \
           -e NF_REDIS_URL="redis://hote:6379" \
           -p 5151:5151 nodefony/nodefony:beta
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
| `NF_WORKERS`             | nombre de processus dans le conteneur — `1` par défaut ; `auto` suit le quota CPU      |
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
docker inspect nodefony/nodefony:beta \
  --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'
```

## Signaler un problème

<https://github.com/nodefony/nodefony-core/issues>
