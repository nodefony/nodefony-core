---
title: "Environnement — un seul fichier .env, les variables, et qui gagne"
navTitle: Environnement
lang: fr
module: "@nodefony/core"
topic: environnement
coverageModule: nodefony-core
coveragePackage: "nodefony (cœur)"
coverageFiles: "runtime/loadEnv.ts,config/defineEnv.ts,config/envOverride.ts,cli/envReport.ts"
section: "Cœur runtime"
audience: [developer, devops]
tags:
  [
    environnement,
    env,
    dotenv,
    variables,
    precedence,
    secrets,
    configuration,
    NF,
  ]
version: "doc"
status: stable
updated: 2026-10-05
source: "src/nodefony/docs/environnement.md"
---

# Environnement — un seul fichier `.env`, les variables, et qui gagne

📍 [Documentation](../../../docs/index.md) › [Cœur — @nodefony/core](index.md) › **Environnement**

> Une variable d'environnement qui « ne prend pas » est le bug le plus long à comprendre du
> métier : rien n'échoue, rien ne s'affiche, la valeur est simplement ignorée et un défaut
> s'applique en silence. Cette page dit **où poser une valeur**, **qui l'emporte**, et surtout
> comment le **vérifier** au lieu de le supposer.

## 🧭 Démarrage rapide

```bash
nodefony env          # chaque variable, sa valeur EFFECTIVE et sa PROVENANCE
nodefony env --json   # le même rapport, pour un script ou un agent
```

La commande ne démarre rien ([`cli/env.ts:208`](../src/cli/env.ts)) — elle répond même sur une
application qui ne boote plus, ce qui est précisément le moment où on la lance. Elle sort en
**78** (`EX_CONFIG`) si une variable requise manque, pour qu'un script s'arrête là plutôt que de
tenter un démarrage voué à l'échec.

Ce qu'elle montre, et qu'aucune lecture de fichier ne donne :

- le **fichier lu** — `.env`, et s'il existe ;
- chaque variable **déclarée** par l'application, sa valeur effective et **le fichier qui l'a
  fournie** ;
- ce qui est **masqué** : une valeur écrite dans `.env` alors que le shell en pose une autre,
  donc sans effet ;
- les variables `NF_` **inconnues** — presque toujours une faute de frappe, avec la correction
  probable ;
- les variables **posées par le framework** lui-même, à part, avec ce que chacune signale.

> **Pourquoi ces deux dernières listes sont séparées.** Le framework écrit des `NF_*` dans
> l'environnement sans que vous les ayez demandées : le lanceur du CLI marque sa délégation au
> `nodefony` du projet (`NF_CLI_DELEGATED`), les commandes de démarrage inscrivent le mode
> (`NF_MODE_START`), le maître de grappe signale la grappe (`NF_CLUSTER`), la déclaration MCP
> porte son jeton (`NF_MCP_TOKEN`). Rangées parmi les inconnues, elles vous accusaient d'une
> faute de frappe que vous n'aviez pas commise — et proposaient de « corriger »
> `NF_CLI_DELEGATED` en `NF_ADMIN_PASSWORD`. Elles ne sont pas tues pour autant : une variable
> présente que le rapport passe sous silence vous ferait chercher pourquoi votre environnement
> ne ressemble pas à ce qu'il montre.

## Le modèle : deux fichiers, une question, un seul lecteur

Trois décisions gouvernent tout ce qui suit, et rien d'autre n'est à retenir
([ADR-0014](../../../docs/adr/0014-fichiers-environnement.md)).

**Une question décide où va une valeur : qui la fournit ?** Le framework (un défaut : rien à
poser), le poste (`.env`), l'exploitation (l'orchestrateur ou le gestionnaire de secrets), le code
(`nodefony.config.ts`, pour un réglage non secret qui dépend du mode).

**Deux fichiers, pas un de plus** : `.env` porte les valeurs du POSTE et ne se commite jamais ;
`.env.example` est sa notice, commitée et jamais chargée. C'est la convention de Node — dotenv,
`node --env-file`, le `.gitignore` Node de GitHub. La production n'a **aucun** fichier.

**Un seul lecteur de `process.env`** : `env.ts`. Tout le reste de l'application lit un objet
typé, validé au démarrage. Une variable non déclarée là n'existe pas, quoi qu'en dise `.env` —
c'est ce qui rend une faute de frappe muette, et c'est pourquoi `nodefony env` existe.

## Les deux axes : mode et déploiement

Nodefony sépare ce que la plupart des frameworks confondent :

| Axe             | Variable             | Valeurs                             | Ce qu'il décide                                     |
| --------------- | -------------------- | ----------------------------------- | --------------------------------------------------- |
| **Mode**        | `NODE_ENV`           | `development` / `production`        | comment le code s'exécute (optimisations, journaux) |
| **Déploiement** | `APP_ENV` / `NF_ENV` | chaîne libre : `staging`, `canary`… | **où** il s'exécute (quelle base, quels secrets)    |

Un `staging` tourne en mode `production` : ce sont deux questions différentes, et les mélanger
oblige à choisir entre « optimisé » et « pointe la bonne base ». Aucun des deux ne choisit un
fichier : le déploiement reçoit SES valeurs de son orchestrateur, et le mode se lit dans
`nodefony.config.ts` (`ctx.isProd`) ou dans `requiredIn` (ci-dessous).

## Et si `NODE_ENV` n'est pas posé ?

C'est le cas de tous les jours sur une machine de développement — et la réponse n'est pas
« au hasard ». **Poser `NODE_ENV` est un acte de déploiement ; ne rien poser est l'état d'un
poste de développement.**

| `NODE_ENV`                                        | Mode retenu       | Pourquoi                                          |
| ------------------------------------------------- | ----------------- | ------------------------------------------------- |
| `development` / `dev`                             | **`development`** | déclaré                                           |
| `production` / `prod`                             | **`production`**  | déclaré                                           |
| **absent**                                        | **`development`** | personne n'a rien dit → poste de développement    |
| posé mais autre (`staging`, `canary`, `prod-eu`…) | **`production`**  | un DÉPLOIEMENT est nommé — il tourne comme prod   |
| chaîne vide                                       | **`production`**  | choix conservateur : « vidée » ≠ « jamais posée » |

Une chaîne vide compte comme posée : on ne distingue pas « vidée par erreur » de « vidée
exprès », et se tromper vers la production ne coûte qu'une commande utilitaire, là où l'inverse
exposerait la console d'administration d'un serveur.

**Le défaut ne gouverne jamais un serveur.** `nodefony development`, `nodefony production`
(alias `start`, `prod`) et `nodefony cluster` posent leur mode eux-mêmes, et il n'existe pas
d'autre façon d'en démarrer un. Le défaut ne concerne donc que les commandes utilitaires —
`inspect`, `doctor`, `env`, `security:*`.

> ⚠️ **Le piège à connaître : une commande utilitaire ne tourne PAS dans le mode du serveur que
> vous avez lancé.** Chacune démarre son propre noyau. Si votre serveur tourne par
> `nodefony development` mais que `NODE_ENV` n'est pas dans votre shell, une commande lancée à
> côté partira bien en `development` — mais le jour où vous exportez `NODE_ENV=production` pour
> un essai, elle changera de base de données sans rien dire d'autre. **Demandez le mode plutôt
> que de le supposer :**
>
> ```bash
> npx nodefony env                 # le mode, et d'où vient chaque variable
> npx nodefony inspect routes      # la dernière ligne indique l'environnement
> ```
>
> Pour forcer explicitement, préfixez la commande : `NODE_ENV=production npx nodefony …`.

## Les fichiers — qui gagne

| Source         | Commité ? | Lu au démarrage | Rôle                                                      |
| -------------- | --------- | --------------- | --------------------------------------------------------- |
| `process.env`  | —         | oui             | shell, orchestrateur, k8s — **gagne toujours**            |
| `.env`         | ❌ non    | oui             | valeurs du POSTE, secrets de développement compris        |
| `.env.example` | ✅ oui    | **jamais**      | la notice : toutes les variables, commentées, sans valeur |

Il n'y a pas de troisième rang. L'injection
([`loadEnv.ts:174`](../src/runtime/loadEnv.ts)) n'écrase **jamais** une clé déjà posée : une
variable exportée par le shell ou l'orchestrateur ne peut être contredite par `.env`. Le nom du
fichier vit à un seul endroit, [`envFileOrder`](../src/runtime/loadEnv.ts)
([`loadEnv.ts:48`](../src/runtime/loadEnv.ts)) — celui que `nodefony env` affiche.

Le chargement a lieu **une fois**, au démarrage du binaire, **avant** la construction du noyau :
les configurations de modules lisent `process.env` pendant le boot, il doit donc être peuplé
avant elles.

**En production, pas de fichier.** `.env` n'entre ni dans le dépôt ni dans l'image (le
`.gitignore` et le `.dockerignore` générés l'écartent, `nodefony image:check` le refuse) : les
secrets viennent de l'orchestrateur, les réglages non secrets de `nodefony.config.ts`.

**Un module n'a pas de `.env`.** Un process sert une application, donc un environnement : celui
de la racine. Un module reçoit ses valeurs par sa configuration (`use()`), par `NF__<MODULE>__…`
(ci-dessous) ou par une variable du `env.ts` de l'application. Seule exception, qui n'est pas la
nôtre : les `.env.*` d'un front **Vite** (`frontend/.env.production`), lus par Vite lui-même pour
des variables `VITE_` publiques.

### Les fichiers de l'ancienne convention sont refusés

`.env.local`, `.env.development`, `.env.production`, `.env.<APP_ENV>` et leurs `.local` ne sont
plus lus. S'ils restent dans une application, le démarrage **s'arrête** (code 78) en les nommant
([`loadEnv.ts:71`](../src/runtime/loadEnv.ts)) — les ignorer en silence ferait disparaître leurs
variables. Le geste : recopier leurs lignes **actives** dans `.env`, puis les supprimer ; un
réglage de production non secret va dans `nodefony.config.ts`, un secret de production dans le
gestionnaire de secrets.

### Un coéquipier qui clone

`.env` n'est pas dans le dépôt :

```bash
cp .env.example .env                       # puis décommenter ce qu'il te faut
npx nodefony security:secrets --write      # tes propres clés de chiffrement
```

## Déclarer une variable — `env.ts`

`env.ts` est le **seul** endroit du projet qui lit `process.env`
([`defineEnv.ts:270`](../src/config/defineEnv.ts)). Une variable non déclarée là n'existe pas
pour l'application, quoi qu'un fichier `.env` en dise.

```typescript
import { defineEnv, envNumber, envEnum, envString } from "nodefony";

export const env = defineEnv({
  NF_PORT: envNumber({ default: 5151, description: "Port HTTP." }),
  NF_LOG_DRIVER: envEnum(["stdout", "file", "null"], {
    default: "stdout",
    description: "Destination des journaux.",
  }),
  NF_DATABASE_URL: envString({
    optional: true,
    description: "URL de la base.",
  }),
});
```

Ce que la déclaration apporte, et qu'une lecture directe de `process.env` ne donne pas : la
valeur est **typée** (`number`, `boolean`, énumération), **validée au démarrage** (une valeur
hors énumération échoue tout de suite, avec le nom de la variable), **documentée**
(`description` alimente `.env.example` et `nodefony env`), et **atteignable typée** dans la
configuration via `ctx.env`.

Une variable **requise** est celle qui n'a ni défaut ni `optional: true`. `nodefony env` les
nomme, et sort en erreur si l'une manque.

### Lire la notice `.env.example`

Chaque variable s'y présente de la même façon, générée depuis `env.ts` : un **bandeau** avec son
titre, une **explication** en phrases simples (à quoi elle sert, ce qui se passe sans elle), puis
ses **métadonnées**, au format des décorateurs de la spécification
[@env-spec](https://varlock.dev/env-spec/overview/) — une par ligne, `@nom` ou `@nom=valeur`.
Deux lignes vides séparent deux variables :

```bash
# ─── Base de données ────────────────────────────────────────────────────────
#
# L'adresse de ta base de données, en une seule URL : son début dit de quelle
# base il s'agit (sqlite:, postgres://, mysql://, mongodb://).
#
# Sans elle, l'application utilise une base SQLite dans var/databases/ — rien
# à installer, et les données survivent au redémarrage.
#
# @optional
# @default=aucun
# @example=postgres://app:motdepasse@localhost:5432/app
# NF_DATABASE_URL=
```

| Décorateur                     | Ce qu'il dit                                                |
| ------------------------------ | ----------------------------------------------------------- |
| `@required` / `@optional`      | faut-il la poser ?                                          |
| `@required=forEnv(production)` | obligatoire là-bas seulement (`requiredIn`)                 |
| `@sensitive`                   | un secret : jamais dans git, jamais de valeur d'exemple     |
| `@type=enum(a, b)`             | les seules valeurs admises                                  |
| `@default`                     | **toujours présent** — ce qui s'applique si on ne pose rien |
| `@example`                     | une valeur réaliste, pour voir la forme attendue            |

`@default` vaut le défaut déclaré, sinon `defaultNote` quand c'est le CODE qui applique un défaut
(le catalogue ne le connaît pas), sinon `aucun`. Une valeur avec des espaces est entre
guillemets : toute ligne de métadonnée se lit d'une seule expression régulière,
`^# @(\w+)(?:=(.*))?$`.

Les variables sont **rangées par sections** numérotées — leur bandeau est un _séparateur_ au sens
d'@env-spec (une ligne `# ===`), la spec n'ayant pas de décorateur de section — (« Réseau et processus », « Base de données
et cache », « Connexion Keycloak »…), annoncées par un **sommaire** en tête du fichier qui liste,
pour chaque section, les noms qu'elle contient : on trouve une variable par son thème comme par
Ctrl+F. Une section apparaît à la place de sa première variable dans `env.ts` ; une variable sans
section ferme la marche sous « Autres réglages ».

`@sensitive` vient de `sensitive` quand la variable le déclare, sinon de son nom
(`isSensitiveEnvVar`, la même règle que `nodefony env`) : déclare-le quand le nom trompe —
`NF_KEYCLOAK_ISSUER` contient « key » et n'a rien de secret.

Le texte vient de la déclaration : `section`, `title` (le bandeau), `description` (un `\n` sépare deux
paragraphes, le repli à 78 colonnes est automatique ; une ligne qui commence par des espaces
est recopiée telle quelle), `example`, `defaultNote`. Écrire pour quelqu'un qui découvre le
projet : à quoi sert la variable, ce qui se passe si on ne la pose pas, où trouver sa valeur.

```typescript
NF_ADMIN_PASSWORD: envString({
  optional: true,
  section: "Comptes créés au démarrage",
  title: "Mot de passe administrateur",
  description:
    "Le compte « admin » est créé au premier démarrage avec ce mot de passe. " +
    "En production, sans cette variable, aucun compte n'est créé.",
  defaultNote: "secret-de-dev-42 en développement ; aucun en production",
}),
```

### Requise LÀ-BAS seulement — `requiredIn`

Certaines variables ne sont indispensables qu'en production. Les déclarer `optional` est vrai
sur le poste du développeur et faux là où ça compte ; les déclarer requises empêcherait de
démarrer en local. `requiredIn` nomme les environnements où l'absence devient une faute :

```typescript
NF_CSRF_SECRET: envString({
  optional: true,
  requiredIn: ["production"],
  description: "Secret des jetons anti-CSRF — partagé entre process en cluster.",
}),
```

Le cas qui fonde cette règle n'est pas un secret laissé en dur, c'est l'inverse : **un secret
absent est engendré à la volée**. Rien ne va mal au premier démarrage — c'est au deuxième
exemplaire que les jetons émis par l'un se font refuser par l'autre, sans une ligne dans les
journaux.

Les noms sont libres : ils se comparent aux **étiquettes** de l'environnement courant, à savoir
le mode d'exécution (`NODE_ENV`) et l'environnement de déploiement (`NF_ENV`, ou l'alias de
plateforme `APP_ENV`) quand il en diffère. Une préproduction qui tourne en `production` porte
donc les deux, et `requiredIn: ["preprod"]` y mord.

Trois lecteurs appliquent la MÊME règle
([`isEnvVarRequired`](../src/config/defineEnv.ts)) : le démarrage refuse de partir, `nodefony
env` marque la variable, et `nodefony doctor` la nomme avant qu'on déploie.

### Demander ce qui manquera ailleurs — `--env`

`nodefony doctor --env production` et `nodefony env --env production` évaluent les exigences
pour l'environnement **visé**, avec les valeurs présentes **ici** : on ne simule pas un
déploiement, on demande ce qui manquera là-bas. Le rapport l'annonce en tête, et sort en erreur
si une variable requise à destination n'a aucune valeur.

`doctor` signale aussi un `.env` **suivi par git** — l'historique garde les secrets même après
suppression. Sans dépôt git, il ne conclut pas : il énonce le contrôle comme
non fait.

## Secrets : `<VARIABLE>_FILE`

Un secret monté par Docker ou Kubernetes est un **fichier**, pas une valeur. Toute variable
accepte donc la forme `<VARIABLE>_FILE`, qui pointe le fichier à lire :

```bash
NF_TOTP_KEY_FILE=/run/secrets/totp_key    # au lieu de NF_TOTP_KEY=…
```

Poser les deux échoue au démarrage : entre deux sources contradictoires, deviner serait le pire
service. Les valeurs des variables dont le nom évoque un secret ne sont jamais rendues en clair
par `nodefony env` — seulement leur présence, leur longueur et leur provenance.

## Surcharger une clé de module — `NF__`

Deux mécanismes coexistent, et les confondre est l'erreur la plus fréquente :

| Forme                                 | Ce que c'est                                    | Où c'est déclaré                           |
| ------------------------------------- | ----------------------------------------------- | ------------------------------------------ |
| `NF_PORT=5151`                        | variable de l'**application**, typée et validée | `env.ts` — non déclarée = **sans effet**   |
| `NF__HTTP__SERVERS__HTTPS__PORT=8443` | surcharge **directe** d'une clé de module       | rien à déclarer — `__` sépare les segments |

Le second ([`envOverride.ts:80`](../src/config/envOverride.ts)) vise une clé de configuration
par son chemin, sans passer par `env.ts` : `NF__<MODULE>__<CHEMIN…>`. Une liste s'écrit en
valeurs séparées par des virgules. Un segment mal orthographié est signalé au démarrage avec la
clé la plus proche — le « vouliez-vous dire » de git.

Réserve ce mécanisme à ce qu'il fait bien : régler une brique en exploitation sans toucher au
code. Ce que l'application possède en propre se déclare dans `env.ts`.

## 🧪 Tests

Le calcul du rapport est un module **pur** ([`envReport.ts:219`](../src/cli/envReport.ts)) : il
reçoit les fichiers déjà lus et l'environnement effectif, et conclut. Cette séparation est ce qui
rend éprouvables les trois affirmations sur lesquelles on va se fier pour corriger une
configuration — d'où vient une valeur, ce qui est masqué, ce qui n'a aucun effet. Se tromper sur
l'une d'elles est pire que de ne rien afficher : on croit le rapport, et on cherche ailleurs.

## ⚠️ Pièges

- **La valeur est dans `.env`, et n'a aucun effet.** Le shell (ou l'orchestrateur) en pose déjà
  une. `nodefony env` l'affiche comme _ignorée dans …_, avec la source gagnante.
- **Le shell gagne toujours.** Une variable exportée dans le terminal (ou par l'orchestrateur)
  ne peut être contredite par aucun fichier. C'est voulu : en production, l'orchestrateur fait
  autorité.
- **Une faute de frappe est silencieuse.** `NF_PROT` au lieu de `NF_PORT` n'échoue pas : la
  variable est inconnue, donc ignorée, et le défaut s'applique. Aucun démarrage ne le dira —
  `nodefony env` est le seul endroit qui la montre.
- **`.env` n'est jamais commité.** C'est la règle qui rend les secrets tenables ; le `.gitignore`
  généré l'applique dès la création de l'application. Un secret dans `.env.example` part dans le
  dépôt — la notice ne porte que des lignes commentées, sans valeur.
- **Le catalogue se lit dans `env.ts`.** `nodefony env` importe d'abord le source `env.ts` (Node ≥ 24
  l'exécute nativement), puis `dist/index.js` en repli. Si aucun des deux n'est lisible, la
  lecture de `.env` reste exacte et le rapport **dit** que la liste manque — il ne se tait pas.

## 📖 Lexique

- **Notice** — `.env.example` : toutes les variables, commentées, générées depuis `env.ts`.
- **Mode** (`NODE_ENV`) — comment le code s'exécute : `development` ou `production`.
- **Déploiement** (`APP_ENV`) — où il s'exécute : `staging`, `canary`, `prod-eu`… chaîne libre.
- **Masquée** — variable définie dans `.env`, mais fournie par le shell ou l'orchestrateur : elle
  est ignorée.
- **Effective** — la valeur que l'application verra réellement.
- **Catalogue** — l'ensemble des variables qu'une application déclare dans `env.ts`, avec leur
  type, leur défaut et leur description.

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Cœur — @nodefony/core](index.md)
- ⚙️ **Configurer les modules** (le `use()` du manifeste, les schémas Zod) :
  [guide de configuration](../../../docs/guides/configuration.md)
- 🧩 **Quel module installer** : [catalogue des modules](catalogue.md)
- 🖥️ **Les autres commandes** : [CLI](cli.md) · le cycle de vie qui consomme cet
  environnement : [kernel](kernel.md)
