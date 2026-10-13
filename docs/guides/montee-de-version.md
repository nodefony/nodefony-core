---
title: Monter de version — les paquets, puis l'application
lang: fr
module: global
topic: release
audience: [developer, devops]
tags: [montée de version, upgrade, npm, AGENTS.md, skills, lockstep, beta]
version: "doc"
status: stable
updated: 2026-10-13
source: "docs/guides/montee-de-version.md"
navTitle: Monter de version
related: docs/guides/compatibilite.md, src/nodefony/src/cli/upgrade.ts, src/nodefony/src/kernel/checks/freshness.ts
---

# Monter de version

📍 [Documentation](../index.md) › [Guides](README.md) › **Monter de version**

## Le modèle — ce qu'un `npm install` ne refait pas

Monter Nodefony de version, c'est comme changer la version d'un manuel scolaire : on remplace les
livres (les paquets), mais les fiches que la classe a recopiées à la rentrée restent celles de
l'ancienne édition tant que personne ne les refait. Une application générée porte trois de ces
« fiches » : la page d'accueil des agents de code (`AGENTS.md`), les renvois vers les skills
d'agent, et les fichiers que les paquets ont déposés à sa création (le décor Keycloak, par
exemple). `npm install` ne touche à aucun des trois.

Rien ne casse pour autant — c'est bien le problème. L'application démarre, les tests passent, et un
agent lâché dedans lit une porte qui décrit l'ancienne version. Cette page donne les gestes, dans
l'ordre, et ce que chacun prouve.

## Démarrage rapide

Depuis la racine d'une application créée par `npm create nodefony@beta` :

```bash
npx nodefony outdated                      # 1. voir le retard, groupé par paquet
npm install nodefony@beta @nodefony/http@beta @nodefony/framework@beta   # 2. TOUS les paquets nodefony de l'app, même version
npx nodefony upgrade                       # 3. remettre l'application au niveau
npm run build                              # 4. reconstruire…
npx nodefony doctor                        #    …puis vérifier
```

Ce qu'on observe à l'étape 3, sur une application née en `10.0.0-beta.2` et montée ensuite :

```text
Nodefony 10.0.0-beta.3 installé.

  AGENTS.md        bloc framework réécrit
  skills           3 posé(s), 1 remplacé(s)
    + nodefony-authentication
    + nodefony-security-review
    + nodefony-troubleshoot
    ~ nodefony-protect-route
  fichiers livrés  41 rafraîchi(s)
    + docker/keycloak/import/realm.json
    …
```

> [!IMPORTANT]
> Pendant la série 10, **le tag `beta` désigne la dernière préversion** ; `latest` sert encore
> l'ancienne lignée 7, en JavaScript. Un `npm install nodefony` sans tag installe donc la 7.

## Étape par étape

### 1. Voir le retard

`nodefony outdated` interroge npm une seule fois, à la racine, et regroupe le résultat par paquet.
Il distingue une plage **épinglée** (où `npm update` ne fera rien : c'est la plage qu'il faut
changer) d'un simple retard.

### 2. Monter les paquets ensemble

Les paquets Nodefony sortent **verrouillés** : `nodefony` et chaque `@nodefony/*` portent la même
version, conçue, testée et publiée ensemble. Montez-les dans la même commande, en nommant chacun de
ceux que votre `package.json` déclare — y compris en `devDependencies` (`@nodefony/devkit`).
Un mélange de versions n'est pas garanti ; la politique complète est dans
[Compatibilité](./compatibilite.md).

### 3. Remettre l'application au niveau — `nodefony upgrade`

La commande rejoue trois gestes, chacun par l'implémentation qui le fait déjà ailleurs :

| Geste                                              | Implémentation                                                                                                   | Ce qu'il ne fait jamais                                                                             |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Réécrit le **bloc framework** d'`AGENTS.md`        | `refreshAgentsGuide()` (`engine.ts:2743`), le remplacement borné par `replaceFrameworkBlock()` (`engine.ts:934`) | toucher au texte hors des marqueurs `<!-- nodefony:start/end -->` ; recréer un `AGENTS.md` supprimé |
| Pose les **pointeurs de skills**, nouveaux compris | `syncSkillPointers()` (`aiSync.ts:212`), le geste d'`ai:sync`                                                    | remplacer un `SKILL.md` écrit à la main ; supprimer un orphelin                                     |
| Rafraîchit les **copies livrées** restées intactes | `runAppContributions()` (`contributions.ts:399`), celui de `scaffold:sync --update`                              | écraser une copie que l'application a retouchée                                                     |

Le tout est orchestré par `runUpgrade()` (`upgrade.ts:121`). Ce que la commande ne tranche pas —
une copie retouchée, un skill écrit à la main, un pointeur orphelin — est **nommé** sous
« À trancher à la main », jamais tu.

Elle ne démarre pas l'application et n'installe rien : elle sert précisément au moment où le
`dist/` n'a pas encore été reconstruit sur les nouveaux paquets.

### 4. Reconstruire et vérifier

`npm run build` recompile l'application contre les nouveaux paquets. `nodefony doctor` le confirme :
sa famille « Fraîcheur du build » signale désormais un bloc d'`AGENTS.md` ou des pointeurs de
skills en retard — `checkAgentsGuide()` (`freshness.ts:409`), qui appelle le même jugement que
`upgrade` en simulation — en nommant `nodefony upgrade` comme geste. Si le changelog annonce un
changement de schéma, appliquez ensuite les migrations (`nodefony orm:migrate`).

## En intégration continue

`nodefony upgrade --check` n'écrit rien et sort en **1** si un des trois gestes reste à faire —
`isUpgradePending()` (`upgrade.ts:97`) en décide. Placé dans la CI, il refuse une branche qui a
monté ses paquets sans remettre l'application au niveau :

```bash
npx nodefony upgrade --check   # 0 : au niveau · 1 : en retard (le rapport dit quoi)
```

Une copie retouchée ou un `AGENTS.md` absent ne le font **pas** échouer : aucun des deux ne se
corrige sans décision humaine, et une vérification qui rougirait pour eux ne passerait plus jamais.

## 📖 Lexique

| Terme                         | Ce que c'est                                                                                                                             |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Bloc framework**            | La partie d'`AGENTS.md` entre `<!-- nodefony:start -->` et `<!-- nodefony:end -->`, rendue par le framework. Le reste vous appartient.   |
| **Pointeur de skill**         | Un court fichier sous `.agents/skills/` qui renvoie au skill livré dans `node_modules` : le contenu suit `npm install`, le pointeur non. |
| **Copie livrée**              | Un fichier qu'un paquet dépose dans l'application (thème Keycloak, realm d'import), suivi par empreinte dans `scaffold.lock.json`.       |
| **Intacte / retouchée**       | Une copie dont l'empreinte est celle de la livraison précédente est intacte, donc remplaçable ; sinon elle est à vous, et gardée.        |
| **Verrouillage** (_lockstep_) | Tous les paquets Nodefony sortent sur la même version : on les monte ensemble.                                                           |

## ⚠️ Pièges

- **`npm install nodefony` sans tag installe la 7.** Pendant la série 10, écrivez toujours
  `@beta` (ou la version exacte).
- **Monter un seul paquet n'est pas monter Nodefony.** `@nodefony/devkit`, en `devDependencies`,
  s'oublie facilement — c'est lui qui livre les skills d'agent.
- **Un vert ne prouve pas qu'un agent lit la bonne porte.** Le bloc périmé ne fait échouer aucun
  test : c'est `nodefony doctor`, ou `upgrade --check` en CI, qui le voit.
- **`upgrade` ne recrée pas un `AGENTS.md` supprimé.** L'absence peut être un choix ; il le dit
  et passe.
- **Dans un monorepo de paquets** (workspaces `packages/@scope/*`), l'`AGENTS.md` racine décrit le
  dépôt et s'écrit à la main : `upgrade` n'y touche pas.

## 🧪 Tests & couverture

<!-- prettier-ignore -->
| Type | Où | Ce qui est prouvé |
| --- | --- | --- |
| Unitaires | `nodefony` `upgradeCommand.test.ts` | le bloc périmé est réécrit et lui seul, la simulation n'écrit rien, une absence n'est pas comblée, un monorepo n'est pas touché, `doctor` nomme `nodefony upgrade`, `--check` ne compte ni copie retouchée ni absence |
| Unitaires (CLI) | `nodefony` `standaloneHelp.test.ts`, `manPage.test.ts` | `upgrade` répond à `--help` sans démarrer l'application ; la page de manuel décrit le CLI réel |
| Bout en bout | application créée par `nodefony@10.0.0-beta.2` publiée, montée sur les tarballs de la version suivante | avant : `--check` sort en 1 et `doctor` signale ; après : `--check` sort en 0, le texte hors marqueurs est identique octet pour octet |

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Guides](README.md) · [Toute la documentation](../index.md)
- 🤝 **Ce qui peut casser en montant**, et la politique de dépréciation : [Compatibilité](./compatibilite.md)
- 🐳 **Monter de version en conteneur** : [`docker-cloud-native.md`](./docker-cloud-native.md)
- 📖 [Lexique général](../lexique.md) du framework.
