---
title: "Environnement — variables, cascade des .env, et qui gagne"
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
    cascade,
    secrets,
    configuration,
    NF,
  ]
version: "doc"
status: stable
updated: 2026-07-25
source: "src/nodefony/docs/environnement.md"
---

# Environnement — variables, cascade des `.env`, et qui gagne

📍 [Documentation](../../../docs/index.md) › [Cœur — @nodefony/core](index.md) › **Environnement**

> Une variable d'environnement qui « ne prend pas » est le bug le plus long à comprendre du
> métier : rien n'échoue, rien ne s'affiche, la valeur est simplement ignorée et un défaut
> s'applique en silence. Cette page dit **où poser une valeur**, **qui l'emporte**, et surtout
> comment le **vérifier** au lieu de le supposer.

## 🧭 Démarrage rapide

```bash
nodefony env          # la cascade, chaque variable, sa valeur EFFECTIVE et sa PROVENANCE
nodefony env --json   # le même rapport, pour un script ou un agent
```

La commande ne démarre rien ([`cli/env.ts:208`](../src/cli/env.ts)) — elle répond même sur une
application qui ne boote plus, ce qui est précisément le moment où on la lance. Elle sort en
**78** (`EX_CONFIG`) si une variable requise manque, pour qu'un script s'arrête là plutôt que de
tenter un démarrage voué à l'échec.

Ce qu'elle montre, et qu'aucune lecture de fichier ne donne :

- la **cascade réelle** — quels fichiers sont lus, dans quel ordre, lesquels existent ;
- chaque variable **déclarée** par l'application, sa valeur effective et **le fichier qui l'a
  fournie** ;
- ce qui est **masqué** : une valeur écrite dans un fichier de rang inférieur, donc sans effet ;
- les variables `NF_` **inconnues** — presque toujours une faute de frappe, avec la correction
  probable.

## Le modèle : deux axes, une cascade, un seul lecteur

Trois décisions gouvernent tout ce qui suit, et rien d'autre n'est à retenir.

**Deux axes plutôt qu'un** : _comment_ le code s'exécute (le mode) et _où_ il s'exécute (le
déploiement) sont deux questions distinctes — un `staging` tourne en mode `production`.

**Une cascade, jamais un écrasement** : chaque source pose ce que les plus fortes n'ont pas déjà
posé. La précédence n'est donc pas une règle appliquée quelque part, c'est une **conséquence** de
l'ordre de lecture — il n'y a rien à synchroniser, et rien qui puisse diverger.

**Un seul lecteur de `process.env`** : `env.ts`. Tout le reste de l'application lit un objet
typé, validé au démarrage. Une variable non déclarée là n'existe pas, quoi qu'en dise un fichier
`.env` — c'est ce qui rend une faute de frappe muette, et c'est pourquoi `nodefony env` existe.

## Les deux axes : mode et déploiement

Nodefony sépare ce que la plupart des frameworks confondent :

| Axe             | Variable                   | Valeurs                             | Ce qu'il décide                                     |
| --------------- | -------------------------- | ----------------------------------- | --------------------------------------------------- |
| **Mode**        | `NODE_ENV`                 | `development` / `production`        | comment le code s'exécute (optimisations, journaux) |
| **Déploiement** | `APP_ENV` / `NODEFONY_ENV` | chaîne libre : `staging`, `canary`… | **où** il s'exécute (quelle base, quels secrets)    |

Un `staging` tourne en mode `production` : ce sont deux questions différentes, et les mélanger
oblige à choisir entre « optimisé » et « pointe la bonne base ». Le déploiement est **plus
spécifique** que le mode, donc plus fort dans la cascade.

## La cascade — qui gagne

Du **plus fort** au **plus faible**. Le premier niveau qui pose une valeur gagne ; les suivants
sont ignorés, sans message.

| Rang | Source                     | Committé ? | Rôle                                           |
| ---- | -------------------------- | ---------- | ---------------------------------------------- |
| 1    | `process.env`              | —          | shell, orchestrateur, k8s — **gagne toujours** |
| 2    | `.env.<déploiement>.local` | ❌ non     | secrets de CE déploiement, sur CETTE machine   |
| 3    | `.env.<mode>.local`        | ❌ non     | secrets du mode                                |
| 4    | `.env.local`               | ❌ non     | secrets communs, machine du développeur        |
| 5    | `.env.<déploiement>`       | ✅ oui     | réglages partagés du déploiement               |
| 6    | `.env.<mode>`              | ✅ oui     | réglages partagés du mode                      |
| 7    | `.env`                     | ✅ oui     | défauts communs — le plus faible               |

Deux règles suffisent à retrouver cet ordre de mémoire : **les `*.local` priment sur les
committés**, et **à rang égal, le plus spécifique gagne**.

L'ordre est produit par une fonction unique, [`envFileOrder`](../src/runtime/loadEnv.ts)
([`loadEnv.ts:72`](../src/runtime/loadEnv.ts)) — celle-là même que `nodefony env` affiche : un
ordre montré qui différerait de l'ordre appliqué serait pire que pas d'affichage du tout.
L'injection ([`loadEnv.ts:88`](../src/runtime/loadEnv.ts)) n'écrase **jamais** une clé déjà
posée, ce dont toute la précédence découle.

Le chargement a lieu **une fois**, au démarrage du binaire, **avant** la construction du noyau :
les configurations de modules lisent `process.env` pendant le boot, il doit donc être peuplé
avant elles.

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

Le calcul du rapport est un module **pur** ([`envReport.ts:147`](../src/cli/envReport.ts)) : il
reçoit la cascade déjà lue et l'environnement effectif, et conclut. Cette séparation est ce qui
rend éprouvables les trois affirmations sur lesquelles on va se fier pour corriger une
configuration — d'où vient une valeur, ce qui est masqué, ce qui n'a aucun effet. Se tromper sur
l'une d'elles est pire que de ne rien afficher : on croit le rapport, et on cherche ailleurs.

## ⚠️ Pièges

- **La valeur est dans le fichier, et n'a aucun effet.** Elle est posée à un rang inférieur à
  celui qui la définit déjà — typiquement `.env` alors que `.env.local` la porte. `nodefony env`
  l'affiche comme _ignorée dans …_, avec le fichier gagnant.
- **Le shell gagne toujours.** Une variable exportée dans le terminal (ou par l'orchestrateur)
  ne peut être contredite par aucun fichier. C'est voulu : en production, l'orchestrateur fait
  autorité.
- **Une faute de frappe est silencieuse.** `NF_PROT` au lieu de `NF_PORT` n'échoue pas : la
  variable est inconnue, donc ignorée, et le défaut s'applique. Aucun démarrage ne le dira —
  `nodefony env` est le seul endroit qui la montre.
- **Un `.env.local` n'est jamais committé.** C'est la règle qui rend les secrets tenables ; le
  `.gitignore` généré l'applique dès la création de l'application. Un secret dans `.env` part
  dans le dépôt.
- **Le catalogue exige un build.** `nodefony env` lit les variables déclarées dans le `dist/` de
  l'application. Sans build, la cascade reste exacte et le rapport **dit** que la liste manque —
  il ne se tait pas.

## 📖 Lexique

- **Cascade** — la suite ordonnée des sources d'environnement, du shell au `.env` commun.
- **Mode** (`NODE_ENV`) — comment le code s'exécute : `development` ou `production`.
- **Déploiement** (`APP_ENV`) — où il s'exécute : `staging`, `canary`, `prod-eu`… chaîne libre.
- **Masquée** — variable définie dans un fichier, mais fournie par une source plus forte : elle
  est ignorée.
- **Effective** — la valeur que l'application verra réellement, après application de la cascade.
- **Catalogue** — l'ensemble des variables qu'une application déclare dans `env.ts`, avec leur
  type, leur défaut et leur description.

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Cœur — @nodefony/core](index.md)
- ⚙️ **Configurer les modules** (le `use()` du manifeste, les schémas Zod) :
  [guide de configuration](../../../docs/guides/configuration.md)
- 🧩 **Quel module installer** : [catalogue des modules](catalogue.md)
- 🖥️ **Les autres commandes** : [CLI](cli.md) · le cycle de vie qui consomme cet
  environnement : [kernel](kernel.md)
