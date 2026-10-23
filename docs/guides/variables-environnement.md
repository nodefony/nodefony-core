---
title: "Variables d'environnement — la référence"
navTitle: Variables d'environnement
lang: fr
module: global
topic: environment-variables
audience: [devops, developer]
status: stable
generated: scripts/generate/env-snapshot.ts
source: src/nodefony/src/config/reservedEnv.ts
---

<!-- GÉNÉRÉ par scripts/generate/env-snapshot.ts (npm run env:snapshot).
     NE PAS ÉDITER À LA MAIN : corriger une variable de l'application dans
     src/nodefony/templates/app/base/env.ts.tpl, un réglage du framework dans
     src/nodefony/src/config/reservedEnv.ts, un réglage de module dans le
     schéma de sa configuration (.meta({ env })), puis régénérer. -->

# Variables d'environnement — la référence

📍 [Documentation](../index.md) › [Guides](README.md) › **Variables d'environnement**

> Cette page liste les variables d'environnement d'une application Nodefony,
> et surtout **ce qui se passe quand l'une d'elles manque**. C'est la
> question utile : une variable absente ne fait presque jamais échouer le
> démarrage. Le framework applique alors un défaut, et ce défaut est celui
> que tu vas obtenir en production si tu oublies de la poser.

Elle est générée depuis le code, comme la notice `.env.example` de chaque
application : les deux ne peuvent pas se contredire.

## La commande qui fait foi pour TON application

Les variables d'une application vivent dans son `env.ts`. Cette page montre
celles d'une application tout juste générée (`npx nodefony create app mon-app`,
préréglage complet) : la tienne en a peut-être ajouté, ou retiré, et un
préréglage minimal en déclare moins. Pour savoir exactement ce qu'elle lit,
demande-le-lui :

```bash
npx nodefony env             # chaque variable, sa valeur effective et d'où elle vient
npx nodefony env --example   # réécrit la notice .env.example de l'application
```

`nodefony env` ne démarre pas l'application : il répond même quand elle ne
démarre plus, et il masque les secrets. Il sort en `78` si une variable
requise manque.

La colonne « Où la poser » dit à qui confier la valeur en production : les
**variables de la plateforme** (le manifeste de déploiement, un `ConfigMap`),
le **gestionnaire de secrets** (un `Secret` Kubernetes, un coffre), ou le
**poste seulement** — un réglage de développement ou de diagnostic, qui n'a
rien à faire dans un déploiement.

## Ce que déclare une application générée (28)

Le nom de l'application (`mon-app`) paraît dans certains exemples : c'est le tien qui
les remplace. La colonne « Exigée » dit quand l'absence arrête le démarrage.

### Réseau et processus

| Variable | Rôle | Exigée | Absente ⇒ | Où la poser |
| --- | --- | --- | --- | --- |
| `NF_PORT` | Le port sur lequel l'application répond en HTTP (sans chiffrement). En développement, laisse vide : si le port est déjà pris par une autre application, le suivant est choisi et annoncé au démarrage. En production, fixe-le : c'est le port qu'attendent l'hébergeur et ses sondes de santé — s'il est occupé, le démarrage échoue. | non | 5151 | variables de la plateforme |
| `PORT` | Cloud Run, Heroku, Railway ou Fly posent eux-mêmes cette variable et attendent que l'application écoute dessus : tu n'as rien à écrire. Si NF_PORT est aussi posée, c'est NF_PORT qui l'emporte. | non | aucun | variables de la plateforme |
| `NF_PORT_HTTPS` | Le port sur lequel l'application répond en HTTPS (chiffré, HTTP/2). En développement, laisse vide. Dans le cloud, le chiffrement se fait souvent devant l'application (ingress, répartiteur de charge) : ce port ne sert alors pas. | non | 5152 | variables de la plateforme |
| `NF_BIND_ALL` | En développement, l'application n'écoute que ta propre machine. true l'ouvre à toutes les interfaces, pour l'essayer depuis un téléphone ou un autre poste : https://\<IP-de-ta-machine>:5152. Une seule exception de certificat à accepter sur l'appareil. Laisse false sinon : le serveur de développement expose des outils d'administration. Sans effet en production, qui écoute déjà partout. | non | false | variables de la plateforme |
| `NF_TLS_CA_FILE` | Le fichier PEM d'une autorité de certification que l'application doit reconnaître pour ses appels sortants : celle de ton entreprise, ou celle qui a signé le certificat d'un Keycloak interne. Chemin absolu, ou relatif à la racine de l'application ; un fichier peut contenir toute une chaîne. Inutile pour l'autorité de développement de Nodefony, reconnue d'office. Remplace NODE_EXTRA_CA_CERTS, et s'écrit pareil sous Windows. Fichier introuvable = l'application refuse de démarrer. | non | aucun | variables de la plateforme |
| `NF_WORKERS` | Combien de processus Node lance nodefony production : 1 (un par conteneur, l'hébergeur multiplie les conteneurs), auto (un par cœur alloué au conteneur), ou un nombre. L'option --workers l'emporte. Sans effet en développement. | non | 1 | variables de la plateforme |

### Journaux

| Variable | Rôle | Exigée | Absente ⇒ | Où la poser |
| --- | --- | --- | --- | --- |
| `NF_LOG_DRIVER` | Où partent les journaux de l'application : stdout (la sortie standard — le bon choix dans un conteneur, l'hébergeur les collecte), file (des fichiers dans logs/), ou null (nulle part, pour un banc de mesure). | non | stdout | variables de la plateforme |
| `NF_LOG_FORMAT` | text : une ligne lisible par un humain. json : un enregistrement complet par ligne (date, module, identifiant de requête) — ce qu'un collecteur (Alloy, Fluent Bit, Vector) transporte vers Loki ou OpenSearch, et la seule forme que la console d'administration sait y relire. En production derrière un collecteur, choisis json. | non | text | variables de la plateforme |
| `NF_LOG_PUSH` | true : l'application envoie elle-même ses journaux à NF_LOKI_URL ou NF_OPENSEARCH_URL. false : elle ne fait que les y relire — un collecteur de l'hébergeur les y a mis (avec NF_LOG_FORMAT=json). Sans adresse posée, sans effet. | non | true | variables de la plateforme |
| `NF_LOG_QUERY_DRIVER` | D'où la console d'administration relit les journaux. auto choisit seul : Loki ou OpenSearch si leur adresse est posée, sinon la mémoire (un process) ou des fichiers (cluster). Valeurs possibles : auto, memory, file, cluster-file, loki, opensearch. À ne changer qu'en connaissance de cause. | non | auto | variables de la plateforme |
| `NF_LOKI_URL` | L'adresse d'un serveur Grafana Loki. Posée, la console d'administration y relit les journaux, et l'application y envoie les siens — sauf NF_LOG_PUSH=false, quand un collecteur s'en charge. Si Loki ne répond pas, rien ne plante : la relecture repasse en mémoire. Ne pose pas Loki ET OpenSearch sans choisir NF_LOG_QUERY_DRIVER : le démarrage refuserait. | non | aucun | variables de la plateforme |
| `NF_OPENSEARCH_URL` | L'adresse d'un serveur OpenSearch. Posée, la console d'administration y relit les journaux, et l'application y envoie les siens — sauf NF_LOG_PUSH=false, quand un collecteur s'en charge. Ne pose pas OpenSearch ET Loki sans choisir NF_LOG_QUERY_DRIVER : le démarrage refuserait. | non | aucun | variables de la plateforme |

### Base de données et cache

| Variable | Rôle | Exigée | Absente ⇒ | Où la poser |
| --- | --- | --- | --- | --- |
| `NF_DATABASE_URL` | L'adresse de ta base de données, en une seule URL : son début dit de quelle base il s'agit (sqlite:, postgres://, mysql://, mongodb://). Sans elle, l'application utilise une base SQLite dans var/databases/ — rien à installer, et les données survivent au redémarrage. Elle contient un mot de passe : jamais commitée. DATABASE_URL (Heroku, Railway) est aussi acceptée. | non | aucun | 🔒 gestionnaire de secrets |
| `NF_REDIS_URL` | L'adresse d'un serveur Redis. Sa seule présence branche Redis : les sessions et l'anti-double-envoi des formulaires sont alors partagés entre plusieurs exemplaires de l'application. Sans elle, tout reste en mémoire — parfait pour un seul exemplaire. REDIS_URL est aussi acceptée. | non | aucun | 🔒 gestionnaire de secrets |

### Comptes créés au démarrage

| Variable | Rôle | Exigée | Absente ⇒ | Où la poser |
| --- | --- | --- | --- | --- |
| `NF_ADMIN_PASSWORD` | Le compte « admin » est créé au premier démarrage avec ce mot de passe. En développement, un mot de passe connu s'applique si tu ne mets rien. En production, aucun : sans cette variable, aucun compte n'est créé. Une fois le compte créé, la variable ne sert plus. | non | nodefony-dev-42 en développement ; aucun en production | 🔒 gestionnaire de secrets |

### Clés et secrets

| Variable | Rôle | Exigée | Absente ⇒ | Où la poser |
| --- | --- | --- | --- | --- |
| `NF_TOTP_KEY` | Chiffre, dans la base, le secret de double authentification (le code à six chiffres) de chaque compte. Générée à la création de l'application. En production, sans elle, la double authentification est désactivée. | non | clé éphémère en développement ; 2FA désactivée en production | 🔒 gestionnaire de secrets |
| `NF_WEBHOOK_KEY` | Chiffre, dans la base, les secrets qui signent les webhooks. Générée à la création de l'application (npx nodefony security:secrets --write). En production, sans elle, les webhooks sont désactivés : une clé qui change à chaque démarrage rendrait les secrets illisibles. | non | clé éphémère en développement ; webhooks désactivés en production | 🔒 gestionnaire de secrets |
| `NF_CSRF_SECRET` | Signe les jetons qui protègent les formulaires contre les envois forgés depuis un autre site (CSRF). Généré à la création de l'application. Avec plusieurs exemplaires, il doit être le même partout — sinon un formulaire est refusé au hasard. Obligatoire en production : sans lui, le démarrage refuse. | en production | tiré au démarrage (un par process) | 🔒 gestionnaire de secrets |

### Jetons (JWT)

| Variable | Rôle | Exigée | Absente ⇒ | Où la poser |
| --- | --- | --- | --- | --- |
| `NF_JWT_ISSUER` | L'adresse publique de l'application, gravée dans chaque jeton qu'elle émet. Posée, elle permet à d'autres services de vérifier ces jetons. Sans elle, les jetons marchent pour l'application elle-même, mais personne d'autre ne peut les vérifier. Ne la change plus ensuite : les jetons déjà émis seraient refusés. | non | https://localhost:5152 en développement ; aucune en production | variables de la plateforme |
| `NF_JWT_KEYSET` | En développement, rien à poser : la clé est créée dans var/keys/. En production, tous les exemplaires de l'application doivent signer avec la MÊME clé — sinon un utilisateur est déconnecté au hasard. Génère-la une fois (npx nodefony security:secrets --jwt-keyset) et range-la dans le gestionnaire de secrets de ton hébergeur, jamais dans un fichier. | en production, si l'application émet des jetons — sinon refus de démarrer | var/keys/ en développement ; aucune en production | 🔒 gestionnaire de secrets |

### Connexion Keycloak

| Variable | Rôle | Exigée | Absente ⇒ | Où la poser |
| --- | --- | --- | --- | --- |
| `NF_KEYCLOAK_ISSUER` | Pour se connecter avec un serveur Keycloak (OpenID Connect) : l'adresse du realm, en https. Le bouton « Keycloak » n'apparaît que si les trois variables NF_KEYCLOAK_* sont posées. | non | aucun | variables de la plateforme |
| `NF_KEYCLOAK_DISCOVERY_URL` | Seulement si l'application ne joint pas Keycloak par l'adresse du realm (NF_KEYCLOAK_ISSUER) — en Kubernetes, par son service interne. L'adresse COMPLÈTE du document de configuration du realm, en http ou https. Le navigateur part toujours vers NF_KEYCLOAK_ISSUER, et Keycloak doit toujours s'annoncer sous ce nom : seul le chemin du serveur vers Keycloak change. Côté Keycloak : --hostname-backchannel-dynamic=true. | non | aucun | variables de la plateforme |
| `NF_KEYCLOAK_CLIENT_ID` | Le nom du client déclaré pour cette application dans le realm Keycloak. | non | aucun | variables de la plateforme |
| `NF_KEYCLOAK_CLIENT_SECRET` | Le secret de ce client, copié depuis la console Keycloak (onglet « Credentials » du client). | non | aucun | 🔒 gestionnaire de secrets |
| `NF_KEYCLOAK_MACHINE_SECRET` | Le secret du client mon-app-machine, qui obtient un jeton au nom d'un programme (script, service partenaire), sans utilisateur. Lu par la commande app:partner:call, jamais par le serveur. | non | aucun | 🔒 gestionnaire de secrets |
| `NF_KEYCLOAK_ADMIN_USERNAME` | Identifiant de l'administrateur du Keycloak de DÉVELOPPEMENT, pour que sa page de connexion suive l'habillage choisi. Jamais lu en production. | non | admin | variables de la plateforme |
| `NF_KEYCLOAK_ADMIN_PASSWORD` | Mot de passe de cet administrateur — celui du compose de développement par défaut. Jamais lu en production. | non | mon-app-dev | 🔒 gestionnaire de secrets |

### Connexion externe : réglage commun

| Variable | Rôle | Exigée | Absente ⇒ | Où la poser |
| --- | --- | --- | --- | --- |
| `NF_OAUTH_REDIRECT_BASE` | Google, GitHub ou Keycloak renvoient l'utilisateur vers l'application après la connexion, à une adresse qu'ils comparent au caractère près à celle enregistrée chez eux : \<NF_OAUTH_REDIRECT_BASE>/nodefony/security/api/oauth2/\<fournisseur>/callback En production, mets l'URL publique de l'application. En développement, garde localhost — jamais 127.0.0.1 : les passkeys refusent une adresse IP. Si Google refuse https://localhost, utilise http://localhost:5151. | non | https://localhost:5152 | variables de la plateforme |

## Réglages du framework : déploiement (8)

Lus par le cœur, quelle que soit l'application.

| Variable | Rôle | Absente ⇒ | Où la poser |
| --- | --- | --- | --- |
| `NF_ENV` | Environnement de déploiement quand il diffère du mode runtime (`APP_ENV` gagne). | le mode d'exécution (NODE_ENV) | variables de la plateforme |
| `NF_CLUSTER_PROBE` | Coupe la sonde du maître de grappe quand elle vaut `0`. | active (0 la coupe) | variables de la plateforme |
| `NF_POD_NAME` | Nom du pod, dont se dérive l'identité d'origine du backplane temps réel. | le nom de la machine | variables de la plateforme |
| `NF_INSTANCE_ID` | Identifiant d'instance rendu par le plan d'administration (défaut : le pid). | le pid du process | variables de la plateforme |
| `NF_BOOT_TIMEOUT_MS` | Délai au-delà duquel un démarrage est déclaré perdu. | 20000 en développement, 60000 en production | variables de la plateforme |
| `NF_BOOT_WARN_MS` | Délai au-delà duquel un démarrage lent est signalé. | 5000 (0 désactive la mesure) | variables de la plateforme |
| `NF_ORM_HEARTBEAT_MS` | Période du battement de cœur qui surveille les connecteurs de l'ORM. | 30000 (0 le désactive) | variables de la plateforme |
| `NF_MIGRATE_DATABASE_URL` | Base visée par `orm:migrate`, quand le compte qui migre n'est pas celui qui sert. | l'URL du connecteur | 🔒 gestionnaire de secrets |

## Réglages du framework : poste et diagnostic (16)

Utiles sur le poste du développeur ou pour une mesure ponctuelle.

| Variable | Rôle | Absente ⇒ | Où la poser |
| --- | --- | --- | --- |
| `NF_CLI_DEBUG` | Trace la décision du lanceur du CLI sur la sortie d'erreur. | désactivée | le poste seulement |
| `NF_NO_UPDATE_CHECK` | Empêche `create app` de demander au registre npm si une version plus récente du CLI existe. | active (désactivée d'office quand `CI` est posée) | le poste seulement |
| `NF_DEV_UI` | Plein écran du terminal de développement : `1` le demande, `0` l'interdit — défaut : oui hors Windows (`--ui` / `--no-ui` l'emportent). | oui, sauf sous Windows | le poste seulement |
| `NF_DEV_MOUSE` | Capture de la souris en plein écran de développement : `1` la demande, `0` l'interdit — défaut : oui hors Windows (`--mouse` / `--no-mouse` l'emportent). | oui, sauf sous Windows | le poste seulement |
| `NF_DEV_PORTS` | Ports que le superviseur de développement doit libérer, imposés par l'opérateur. | les ports déclarés par l'application, sinon 5151,5152 | le poste seulement |
| `NF_KERNEL_TRACE_FILE` | Fichier où le Kernel écrit sa trace de démarrage (diagnostic). | aucune trace | le poste seulement |
| `NF_NO_TTY` | Force le rendu non interactif, quel que soit le terminal. | déduit du terminal | le poste seulement |
| `NF__DEBUG` | Rallume au démarrage le débogage de modules nommés (`FIREWALL,SESSION:NOTICE`, `*` pour tous). | aucun débogage ciblé (un redémarrage remet à zéro) | le poste seulement |
| `NF_PERF_PROBE` | Arme la sonde de performance du pipeline HTTP. | désactivée (1 l'arme) | le poste seulement |
| `NF_ORM_FLOW` | Arme la sonde de flux de l'ORM. | active en développement, coupée en production (1 la force) | le poste seulement |
| `NF_OUTPUT` | Rendu du démarrage : human, plain ou json (`--output` l'emporte). | human dans un terminal, plain sinon | le poste seulement |
| `NF_NO_PROGRESS` | Coupe les barres de progression du CLI. | affichées dans un terminal (jamais en CI) | le poste seulement |
| `NF_BANNER_ASCII` | Bannière du CLI en ASCII pur (`1`), pour une police sans caractères de dessin. | déduite du terminal | le poste seulement |
| `NF_NODE_DIST_URL` | Liste des versions de Node lue par `nodefony doctor` (URL d'un miroir ou chemin). | https://nodejs.org/dist/index.json | le poste seulement |
| `NF_WITH_DEV_MODULES` | Dérogation : charge les modules de développement hors développement (`1`), pour une mesure. | non chargés | le poste seulement |
| `NF_WITH_DEV_MODULES_TTL_MIN` | Durée de vie, en minutes, d'un runtime en dérogation NF_WITH_DEV_MODULES. | 30 (plafond 240) | le poste seulement |

## Réglages des modules (10)

Chaque module peut donner un nom court à un réglage de sa configuration.
La variable n'est lue que si l'application charge le module. Sa valeur est
validée par le schéma du module : une valeur invalide arrête le démarrage
en nommant la variable. Chacune accepte aussi la forme `<NOM>_FILE`, qui
désigne un fichier dont le contenu est la valeur (un secret monté).

Absente, la variable laisse le réglage à sa valeur de configuration, et à
défaut au **défaut du schéma**. « aucun » signifie que le module calcule la
valeur lui-même ou s'en passe : la colonne « Rôle » dit lequel.

### `@nodefony/documentation`

| Variable | Réglage | Rôle | Défaut du schéma | Où la poser |
| --- | --- | --- | --- | --- |
| `NF_DOCS_REPO_URL` | `repo.url` | URL de base du dépôt (sans slash final), pour construire le lien « Modifier sur GitHub » d'une page. Surchargeable par l'env `NF_DOCS_REPO_URL`. Aucun secret — URL publique uniquement. | https://github.com/nodefony/nodefony-core | variables de la plateforme |
| `NF_DOCS_REPO_BRANCH` | `repo.branch` | Branche utilisée dans le lien d'édition. Si OMISE (défaut), la branche RÉELLE est résolue au runtime via `GitService.branch()` du core (lecture `.git/HEAD`, 0 spawn) → le lien suit toujours la branche courante. Surchargeable par l'env `NF_DOCS_REPO_BRANCH` (utile en CI/prod détaché de git, ex. conteneur sans `.git`). | aucun | variables de la plateforme |

### `@nodefony/mongoose`

| Variable | Réglage | Rôle | Défaut du schéma | Où la poser |
| --- | --- | --- | --- | --- |
| `NF_MONGODB_DEBUG` | `debug` | Active la trace Mongoose des requêtes (`mongoose.set('debug')`). Défaut false. Mettre true en dev pour voir chaque opération. Surchargé par l'env `NF_MONGODB_DEBUG` (true/false, 1/0, yes/no, on/off). Reco prod : false. | false | le poste seulement |

### `@nodefony/realtime`

| Variable | Réglage | Rôle | Défaut du schéma | Où la poser |
| --- | --- | --- | --- | --- |
| `NF_REALTIME_DRIVER` | `backplane.driver` | Nom du driver IBackplane, résolu dans le registre de drivers (`listBackplaneDrivers()`) — PAS d'enum en dur ici : la liste réelle est la source de vérité du registre, ouverte aux drivers custom utilisateur (`registerBackplaneDriver(name, factory)`). Natifs : `loopback` (mono, hub local sans IPC), `cluster` (IPC workers `nodefony cluster`, actif si NF_CLUSTER=1), `redis` (multi-host pub/sub). Driver inconnu au boot → warn fail-soft, le hub reste local. | loopback | variables de la plateforme |
| `NF_REALTIME_BACKPLANE_NAMESPACE` | `backplane.namespace` | Cloison logique du transport partagé (drivers cross-pod : redis, futur kafka) — suffixe le canal pub/sub (`nodefony:realtime:<ns>`). Le `database` Redis ne cloisonnant PAS le pub/sub, deux apps sur un Redis mutualisé SANS namespace se parleraient (cross-talk). Défaut : dérivé du nom d'app (`kernel.projectName`). À poser EXPLICITEMENT quand deux déploiements de la même app (staging/prod) partagent un Redis. Caractères : alphanumériques, `_`, `.`, `-`. Env : `NF_REALTIME_BACKPLANE_NAMESPACE` (prioritaire — le namespace distingue des DÉPLOIEMENTS, il n'a pas à être figé dans le code). | aucun | variables de la plateforme |
| `NF_REALTIME_BACKPLANE_SECRET` | `backplane.secret` | Secret de SCELLEMENT des messages du backplane, partagé par tous les pods de l'app (drivers à transport PARTAGÉ : redis, futurs drivers cross-host). Un bus pub/sub n'authentifie PAS l'émetteur : sans ce secret, quiconque écrit dans le Redis (autre app d'un Redis mutualisé, credential fuité, SSRF) publie sur les canaux de TOUS les pods. Posé, chaque message porte un HMAC-SHA256 et l'ingress devient fail-closed strict (non scellé ou mal scellé = ignoré, aucun downgrade). Sans lui, le boot ALERTE et le bus reste ouvert. Inutile pour `cluster` (IPC master↔workers : aucun tiers ne peut y écrire). Env : `NF_REALTIME_BACKPLANE_SECRET`. Minimum 32 caractères. | aucun | 🔒 gestionnaire de secrets |

### `@nodefony/redis`

| Variable | Réglage | Rôle | Défaut du schéma | Où la poser |
| --- | --- | --- | --- | --- |
| `NF_REDIS_HOST` | `globalOptions.socket.host` | Hôte du serveur Redis. Défaut `localhost` (jamais d'hôte d'infra hardcodé). Surchargeable par l'env `NF_REDIS_HOST`. Aligné sur l'infra `docker/docker-compose.yml` (Redis bindé `127.0.0.1:6379`). | localhost | variables de la plateforme |
| `NF_REDIS_PORT` | `globalOptions.socket.port` | Port TCP du serveur Redis. Défaut 6379. Env `NF_REDIS_PORT`. | 6379 | variables de la plateforme |
| `NF_REDIS_PASSWORD` | `globalOptions.password` | Mot de passe Redis (`requirepass` ou ACL). Optionnel en dev sans auth. ⚠️ Zero Trust : Redis DOIT avoir une auth même en dev (cf docker compose `--requirepass`). Surchargé par l'env `NF_REDIS_PASSWORD` — NE JAMAIS committer un secret dans la config. | aucun | 🔒 gestionnaire de secrets |
| `NF_REDIS_KEY_NAMESPACE` | `keyNamespace` | Cloison des CLÉS par application sur un Redis mutualisé — préfixe `nf:<keyNamespace>:<type>` au lieu de `nf:<type>`. Sans elle, deux applications écrivent dans le même espace de clés (`database` vaut 0 par défaut et ne cloisonne rien de plus) : l'écran Sessions de l'une LISTE les sessions de l'autre, son balayage `nf:sess:*` ne pouvant pas les distinguer. Défaut : dérivé du nom d'app (`kernel.projectName`). À poser EXPLICITEMENT quand deux déploiements de la même app (préproduction/production) partagent un Redis. Caractères : alphanumériques, `_`, `.`, `-`. Env : `NF_REDIS_KEY_NAMESPACE` (prioritaire — une cloison distingue des DÉPLOIEMENTS, elle n'a pas à être figée dans le code). | aucun | variables de la plateforme |

## Ce que cette page ne liste pas

- **Les variables que ton application a ajoutées** à son `env.ts` :
  `npx nodefony env` les rend, et la notice `.env.example` les explique une
  par une. Le guide [Configuration](configuration.md) montre comment en
  déclarer une.
- **La surcharge générique** `NF__<MODULE>__<CHEMIN>` : elle atteint
  n'importe quel réglage d'un module, sans nom court. Voir le guide
  [Configuration](configuration.md).
- **Les variables qui ne sont pas à Nodefony**, comme `NODE_ENV`, qui se
  lisent sous leur propre nom. Toute variable que Nodefony possède porte le
  préfixe `NF_`, pour ne jamais entrer en collision avec celles d'un autre
  outil.

## Pour aller plus loin

- ⬆️ **Retour au hub** : [Guides](README.md) · [Toute la documentation](../index.md)
- ☸️ [Kubernetes](kubernetes.md) — où ces variables se posent dans un déploiement.
- 🗄️ [Persistance](persistence.md) — les URL des bases et des services de données.
