---
title: "Deux paquets nodefony dans un process : reconnaître et corriger"
lang: fr
module: global
topic: duplication-paquet
audience: [human]
tags: [diagnostic, npm, peerDependencies, cli, boot, dualité]
version: "doc"
status: stable
updated: 2026-09-14
source: "docs/guides/deux-paquets-nodefony.md"
navTitle: Deux paquets nodefony
related: docs/guides/configuration.md, docs/guides/compatibilite.md
---

# Deux paquets `nodefony` dans un process

📍 [Documentation](../index.md) › [Guides](README.md) › **Deux paquets nodefony**

> Une panne qui n'a l'air de rien : l'application ne démarre pas, ou démarre
> amputée, et **tout ce qu'on inspecte est sain**. La configuration est juste,
> les versions concordent, le `dist/` est frais. Cette page dit comment la
> reconnaître en une commande, et pourquoi elle est si difficile à voir.

## Le symptôme

Il en existe plusieurs, et aucun ne nomme la cause :

- `nodefony <commande>` échoue **systématiquement** là où `npm run dev` réussit,
  sur la même application ;
- le boot annonce un **manifeste de modules vide** (`modules: []`), aucun
  serveur ne monte, et le diagnostic envoie vérifier `nodefony.config` — qui est
  correct ;
- des modules sont **écartés en fail-soft** avec « Kernel not ready », souvent
  les plus importants (le serveur HTTP, le pare-feu) ;
- un module figure dans la liste des modules chargés **et ne fait rien** : aucune
  de ses routes ne répond, aucun de ses services n'est injectable.

## La cause

Deux copies du paquet `nodefony` ont été chargées dans le même process.

En JavaScript, **l'identité d'un module est son chemin**. Deux fichiers
différents sur le disque donnent deux modules différents, donc deux jeux de
classes, deux registres de symboles, deux singletons — même si les deux fichiers
sont identiques au bit près.

> 🔴 **Les deux copies peuvent être la MÊME version.** C'est ce qui rend la panne
> si déroutante : il n'y a aucune incohérence à repérer, rien de « périmé », rien
> à mettre à jour. Chercher un conflit de versions est une impasse.

Ce qui casse alors, concrètement :

| Ce qui est propre à chaque copie                                          | Conséquence                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| La classe `Container` (`src/nodefony/src/Container.ts:56`)                | `container instanceof Container` échoue à la frontière — le service refusait le container reçu et s'en fabriquait un vide, donc plus de kernel, plus de journal, plus d'injection. C'est la CAUSE RACINE ; depuis, ce cas lève une erreur qui la nomme |
| Le contexte de requête (`src/nodefony/src/runtime/RequestContext.ts:169`) | un `AsyncLocalStorage` par copie : l'identité posée par l'une est **invisible** aux modules de l'autre                                                                                                                                                 |
| Le singleton `Nodefony` (`src/nodefony/src/Nodefony.ts:25`)               | un champ statique privé par copie — `Nodefony.getKernel()` rend `null` du mauvais côté                                                                                                                                                                 |
| Les registres d'injection et de décorateurs                               | un service déclaré d'un côté est introuvable de l'autre                                                                                                                                                                                                |

Un module construit à cette frontière n'attache **aucun hook de cycle de vie**.
Il ne lève pas d'erreur : il est là, et inerte.

## Le diagnostic — deux commandes

```bash
npm ls nodefony          # ou : pnpm why nodefony
```

`deduped` partout ⇒ il n'y a **qu'une** copie dans l'arbre npm :

```
mon-app@1.0.0
├─┬ @nodefony/http@10.0.0
│ └── nodefony@10.0.0 deduped          ← une seule copie
```

Une copie **imbriquée** sous un module ⇒ c'est la cause :

```
├─┬ un-module-tiers@2.0.0
│ └── nodefony@10.0.2                  ← sa copie à lui
```

```bash
NF_CLI_DEBUG=1 nodefony --version
```

Elle dit quel CLI s'exécute vraiment. ⚠️ Elle ne répond qu'à **une** des trois
causes ci-dessous — celle du binaire lié ailleurs. Pour les deux autres, c'est
`npm ls` qui tranche.

## Les trois causes, et leur remède

### 1. Un binaire lié vers un autre dossier

Une installation globale, un `npm link`, ou un lien manuel dans `~/.local/bin`.
Taper `nodefony` prend ce binaire-là ; `npm run dev` et `npx nodefony` prennent
celui de l'application, parce que npm place `node_modules/.bin` en tête du
`PATH`. **C'est exactement ce qui fait qu'une commande marche et l'autre non.**

Ce n'est pas une mauvaise pratique en soi — le binaire global sert à
`nodefony create app`, quand il n'y a pas encore d'application — et le lanceur
passe normalement la main au CLI local. Le remède est de **tenir le binaire lié
à jour** : c'est le noyau réellement exécuté qui porte les gardes, un noyau
ancien ne peut ni se corriger ni se détecter.

### 2. Un module tiers qui déclare `nodefony` en `dependencies`

Il dit alors « j'apporte ma propre copie » au lieu de « je me branche sur la
tienne », et npm l'installe sous lui.

> **Un module Nodefony déclare `nodefony` en `peerDependencies`, jamais en
> `dependencies`.** Un `peer` n'installe rien : il exige que l'application
> fournisse. Tous les paquets officiels le font — c'est ce qui garantit qu'ils
> ne peuvent pas dupliquer le cœur.

Remède : demander au module de corriger sa déclaration ; en attendant, aligner
les versions pour que npm dédoublonne.

### 3. Un monorepo, ou pnpm en mode strict

Deux paquets locaux qui exigent des versions différentes, ou un store strict qui
donne à chacun ses propres dépendances. Remède : une seule version déclarée à la
racine, ou une surcharge de résolution.

## Ce que le framework fait de lui-même

Chaque copie s'inscrit d'elle-même à son évaluation
(`src/nodefony/src/runtime/packageInstances.ts:63`), dans une entrée de
`globalThis` adressée par un symbole du registre global — la seule case mémoire
que deux copies partagent. Le boot les COMPTE, à deux instants : après l'import
de l'application (`src/nodefony/src/kernel/Kernel.ts:2381`), puis après le
chargement des modules du manifeste, qui peut en apporter une seconde
(`src/nodefony/src/kernel/Kernel.ts:1109`). Le
verdict (`src/nodefony/src/kernel/Kernel.ts:2133`) tranche alors :

- **en développement** — l'application démarre, et un avertissement nomme **les
  deux chemins**. Celui qui lance lit son journal, et il a besoin de son serveur.
- **partout ailleurs** (production, `staging`, et aussi les lanceurs de tests,
  que le mode moteur regroupe) — **le démarrage est refusé**, avec une
  `BootConfigurationError` et une sortie `78` (`EX_CONFIG`).

Le refus n'est pas de la rigidité : sous dualité, ce qui disparaît en silence
est exactement ce dont dépend la sécurité — un `@nodefony/security` écarté, et
l'application sert **sans pare-feu**, sans que rien ne le dise.

> ⚠️ **Si le symptôme est là et que le boot ne dit rien**, c'est que le noyau
> exécuté est antérieur à cette garde : le code qui détecte vit dans le noyau
> qui tourne, aucune version ultérieure ne peut le rattraper de l'extérieur.

## Ce que le framework ne fait PAS — et pourquoi

Il ne **recolle jamais** les deux copies en partageant le kernel. Ce serait la
correction la plus tentante, et la pire : le kernel n'est qu'un des états
dupliqués. Le contexte de requête, `instanceof`, les registres d'injection
resteraient scindés — l'application démarrerait, servirait du trafic, et
l'identité de l'utilisateur serait invisible à la moitié des modules. Une
dégradation plus difficile à voir que celle qu'on aurait corrigée.

**On détecte, et on le dit.**

## 📖 Lexique

| Terme                  | Ce que c'est                                                                                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dualité de paquet**  | Deux copies du paquet `nodefony` chargées dans le même process. Elles peuvent porter la MÊME version : c'est le chemin du fichier qui fait l'identité d'un module, pas son contenu. |
| **`peerDependencies`** | Une dépendance qu'un paquet EXIGE sans l'installer : c'est l'application qui la fournit. C'est ce qui empêche un module de dupliquer le cœur.                                       |
| **`deduped`**          | Le mot qu'affiche `npm ls` quand plusieurs paquets partagent une seule copie d'une dépendance. Sa présence partout est la preuve qu'il n'y en a qu'une.                             |
| **Fail-soft**          | Un module dont le chargement échoue est ÉCARTÉ, et le démarrage continue. Utile pour un module optionnel, dangereux quand c'est le pare-feu qui tombe.                              |
| **`EX_CONFIG`**        | Code de sortie `78`, convention BSD : « la configuration est fautive », par opposition à une erreur interne. C'est celui que rend le refus de démarrage.                            |

## ⚠️ Pièges

- **Chercher un conflit de VERSIONS est une impasse.** Les deux copies sont
  souvent identiques : deux fichiers distincts suffisent à produire deux jeux de
  classes. Il n'y a rien de « périmé » à trouver.
- **`nodefony` et `npx nodefony` ne désignent pas le même binaire.** Dans une
  application, `npx` et les scripts `npm` placent `node_modules/.bin` en tête du
  `PATH` ; `nodefony` nu prend celui du `PATH` global. C'est toute la différence
  entre une commande qui marche et une qui échoue, sur la même application.
- **Le message d'erreur peut accuser le mauvais coupable.** Un noyau antérieur à
  la garde annonce un manifeste vide et envoie vérifier `nodefony.config` ou le
  `dist/` — les deux sont sains. Le symptôme ne désigne jamais la cause.
- **Un module écarté en fail-soft reste dans la liste des modules.** Il n'a ni
  container, ni journal, ni hook : il existe et ne fait rien. Ne pas conclure de
  sa présence qu'il fonctionne.
- **Le silence du boot n'est pas une absence de dualité.** Le code qui détecte
  vit dans le noyau qui s'exécute : un binaire lié vers une version ancienne ne
  peut ni se corriger, ni se signaler.

## 🧪 Tests & couverture

Ce qui garde ce comportement, et ce que chaque test prouve :

<!-- prettier-ignore -->
| Type | Où | Ce qui est prouvé |
| --- | --- | --- |
| Unitaires (registre) | `nodefony` `packageInstances.test.ts` | une copie s'inscrit d'elle-même ; deux copies sont détectées et NOMMÉES ; une même URL réenregistrée ne compte pas pour deux (anti-faux-positif) |
| Unitaires (verdict) | `nodefony` `packageInstances.test.ts` | avertissement en développement, `BootConfigurationError` ailleurs, et le mode runtime CONSTATÉ dans le message |
| Unitaires (câblage) | `nodefony` `packageInstances.test.ts` | la garde est consultée par `preRegister()` — donc une copie apportée par un MODULE est vue |
| Unitaires (cause racine) | `nodefony` `packageInstances.test.ts` | un container venu d'une autre copie est REFUSÉ au lieu d'être jeté en silence |
| Bout en bout | `nodefony` `packageDualityBoot.test.ts` | le vrai binaire, sur une application réelle : refus AVANT le chargement des modules, et démarrage avec avertissement en développement |

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Guides](README.md) · [Toute la documentation](../index.md)
- ⚙️ **Ce que la configuration promet, et ce qu'elle retire en silence** :
  [`configuration.md`](./configuration.md)
- 🤝 **Ce qui casse en montant de version** :
  [`compatibilite.md`](./compatibilite.md)
- 📖 [Lexique général](../lexique.md) du framework.
