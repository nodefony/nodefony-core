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

Depuis la racine d'une application créée par `npm create nodefony` :

```bash
npx nodefony upgrade --check              # 1. voir le retard, et la version publiée
npx nodefony upgrade --to <version>       # 2 et 3. monter TOUS les paquets, installer, remettre l'application au niveau
npm run build                             # 4. reconstruire…
npx nodefony doctor                        #    …puis vérifier
```

Ce qu'on observe à la remise au niveau, sur une application née en `10.0.0-beta.2` et montée sur la `10.0.0-beta.3` :

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
> La série 10 est une réécriture en TypeScript : une application de la série 7, en JavaScript, ne
> se monte pas par ce guide — leurs API n'ont rien de commun.

## Étape par étape

### 1. Voir le retard

`nodefony upgrade --check` annonce une version publiée plus récente que l'installée, avec la ligne
à taper (`nodefony upgrade --to <version>`). Il nomme aussi, champ par champ, chaque plage
`@nodefony/*` qui vise une autre version que `nodefony` installé — surcharges comprises — et
l'outillage du gabarit resté sous son plancher. La demande au registre est bornée dans le temps,
se coupe comme celle de `create app` (`NF_NO_UPDATE_CHECK=1`, et toujours en intégration
continue), et hors ligne elle ne dit rien.

`nodefony outdated` interroge npm une seule fois, à la racine, et regroupe le résultat par paquet.
Il distingue une plage **épinglée** (où `npm update` ne fera rien : c'est la plage qu'il faut
changer) d'un simple retard.

### 2. Monter les paquets ensemble — `nodefony upgrade --to`

Les paquets Nodefony sortent **verrouillés** : `nodefony` et chaque `@nodefony/*` portent la même
version, conçue, testée et publiée ensemble. Un mélange de versions n'est pas garanti ; la
politique complète est dans [Compatibilité](./compatibilite.md).

`nodefony upgrade --to <version|canal>` les monte d'un geste (`upgrade.ts#runUpgradeCommand`) :

- chaque plage `nodefony` et `@nodefony/*` du `package.json` passe à la même version —
  `dependencies`, `devDependencies` (`@nodefony/devkit` y reste), et toute entrée d'`overrides`,
  de `resolutions` ou de `pnpm.overrides`, qu'aucune commande `npm install` ne monterait
  (`upgradeRanges.ts#frameworkRangeChanges`). Une version épinglée le reste ; `workspace:`,
  `file:`, `$paquet` et `*` ne sont pas touchés ;
- l'outillage que le gabarit livré déclare (`vitest`, `oxlint`, `vite`, `better-sqlite3`…) est
  relevé à son plancher s'il est en dessous (`upgradeRanges.ts#toolingRangeChanges`). Rien ne
  descend, rien ne s'ajoute, et `typescript` reste à l'application. Pas `npm update` : il
  monterait aussi vos dépendances métier, et ne corrige pas une version épinglée ;
- une seule installation, par le gestionnaire de l'application (champ `packageManager`, sinon
  son verrou) ;
- puis la version **installée** rejoue la remise au niveau (étape 3). Le binaire lancé est
  l'ancien : il relance `nodefony upgrade` par le nouveau, pour que le bloc d'`AGENTS.md` et les
  planchers d'outillage soient ceux de la version visée. Une seconde installation n'a lieu que
  si ces planchers ont bougé entre les deux versions.

Un canal (`--to beta`) se résout auprès du registre ; une cible sous la majeure installée est
refusée. `--to <version> --dry-run` montre le plan sans rien écrire.

Monter à la main reste possible : nommer chaque paquet que le `package.json` déclare, à la même
version, `devDependencies` comprises, puis lancer `nodefony upgrade`.

### 3. Remettre l'application au niveau — `nodefony upgrade`

La commande rejoue quatre gestes, chacun par l'implémentation qui le fait déjà ailleurs :

| Geste                                              | Implémentation                                                                                                                                   | Ce qu'il ne fait jamais                                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Réécrit le **bloc framework** d'`AGENTS.md`        | `refreshAgentsGuide()` (`engine.ts#refreshAgentsGuide`), le remplacement borné par `replaceFrameworkBlock()` (`engine.ts#replaceFrameworkBlock`) | toucher au texte hors des marqueurs `<!-- nodefony:start/end -->` ; recréer un `AGENTS.md` supprimé |
| Pose les **pointeurs de skills**, nouveaux compris | `syncSkillPointers()` (`aiSync.ts#syncSkillPointers`), le geste d'`ai:sync`                                                                      | remplacer un `SKILL.md` écrit à la main ; supprimer un orphelin                                     |
| Rafraîchit les **copies livrées** restées intactes | `runAppContributions()` (`contributions.ts#runAppContributions`), celui de `scaffold:sync --update`                                              | écraser une copie que l'application a retouchée                                                     |
| Régénère **`.env.example`**                        | `syncEnvExample()` (`env.ts#syncEnvExample`), celui de `env --example` — le modèle dérive aussi des modules installés                            | conclure « à jour » sur un catalogue illisible : il est rapporté « non vérifié »                    |

Le tout est orchestré par `runUpgrade()` (`upgrade.ts#runUpgrade`). Ce que la commande ne tranche pas —
une copie retouchée, un skill écrit à la main, un pointeur orphelin — est **nommé** sous
« À trancher à la main », jamais tu.

Elle ne démarre pas l'application ; sans `--to`, elle n'installe rien et ne touche pas au
`package.json` : elle sert précisément au moment où le `dist/` n'a pas encore été reconstruit
sur les nouveaux paquets.

### 4. Reconstruire et vérifier

`npm run build` recompile l'application contre les nouveaux paquets. `nodefony doctor` le confirme :
sa famille « Fraîcheur du build » signale désormais un bloc d'`AGENTS.md` ou des pointeurs de
skills en retard — `checkAgentsGuide()` (`freshness.ts#checkAgentsGuide`), qui appelle le même jugement que
`upgrade` en simulation — en nommant `nodefony upgrade` comme geste. Si le changelog annonce un
changement de schéma, appliquez ensuite les migrations (`nodefony orm:migrate`).

## En intégration continue

`nodefony upgrade --check` n'écrit rien et sort en **1** si un des quatre gestes reste à faire,
si une plage du framework vise une autre version que l'installée, ou si l'outillage est sous son
plancher —
`isUpgradePending()` (`upgrade.ts#isUpgradePending`) en décide. Placé dans la CI, il refuse une branche qui a
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
| **Copie livrée**              | Un fichier qu'un paquet dépose dans l'application (`Dockerfile`, thème Keycloak), suivi par empreinte dans `scaffold.lock.json`.         |
| **Intacte / retouchée**       | Une copie dont l'empreinte est celle de la livraison précédente est intacte, donc remplaçable ; sinon elle est à vous, et gardée.        |
| **Verrouillage** (_lockstep_) | Tous les paquets Nodefony sortent sur la même version : on les monte ensemble.                                                           |

## ⚠️ Pièges

- **À la main, `npm install nodefony` suit le canal `latest`.** Pour viser une version précise,
  l'écrire (`nodefony@<version>`) — la même sur TOUS les paquets de l'application. `upgrade --to`
  le fait pour vous.
- **Monter un seul paquet n'est pas monter Nodefony.** `@nodefony/devkit`, en `devDependencies`,
  s'oublie facilement — c'est lui qui livre les skills d'agent. Une surcharge écrite en dur
  (`overrides`) aussi : aucune commande `npm install` ne la monte, `upgrade --to` si.
- **L'aide lue est celle de la version INSTALLÉE.** Une consigne corrigée depuis ne vous parvient
  qu'après la montée ; c'est pourquoi `upgrade --help` et `--check` annoncent la version publiée.
- **Un vert ne prouve pas qu'un agent lit la bonne porte.** Le bloc périmé ne fait échouer aucun
  test : c'est `nodefony doctor`, ou `upgrade --check` en CI, qui le voit.
- **`upgrade` ne recrée pas un `AGENTS.md` supprimé.** L'absence peut être un choix ; il le dit
  et passe.
- **Dans un monorepo de paquets** (workspaces `packages/@scope/*`), l'`AGENTS.md` racine décrit le
  dépôt et s'écrit à la main : `upgrade` n'y touche pas.
- **Le `Dockerfile` est une copie livrée par le paquet `nodefony`** (`contribute()`,
  `contribute.ts#contribute`) : il est rafraîchi tant qu'il est intact. Une base, des paquets
  système ou une cible se règlent sans le retoucher (`--build-arg`, `NF_IMAGE_TARGET`,
  `NF_IMAGE_PACKAGES`, `NF_IMAGE_NODE`, `NF_IMAGE_RUNTIME`). Le gestionnaire se relit dans
  l'application — champ `packageManager`, sinon le verrou ; sans l'un ni l'autre, rien n'est posé.
- **Une application créée pendant la bêta, avant ce suivi** : son `Dockerfile` n'est pas encore au
  registre. S'il est identique à la livraison, la première montée l'y inscrit d'elle-même ; s'il
  diffère (retouché, ou rendu par une bêta plus ancienne), il est rapporté `modified` et reste à
  vous. Pour le remettre sous suivi : supprimez-le, puis `npx nodefony scaffold:sync` le repose.

## 🧪 Tests & couverture

<!-- prettier-ignore -->
| Type | Où | Ce qui est prouvé |
| --- | --- | --- |
| Unitaires | `nodefony` `upgradeCommand.test.ts` | le bloc périmé est réécrit et lui seul, la simulation n'écrit rien, une absence n'est pas comblée, un monorepo n'est pas touché, `doctor` nomme `nodefony upgrade`, `--check` ne compte ni copie retouchée ni absence |
| Unitaires | `nodefony` `upgradeTo.test.ts` | `--to` réécrit dépendances, `devDependencies` et surcharges à la même version (épinglée gardée, `workspace:`/`$`/`*` intacts), relève l'outillage sous le plancher sans rien descendre ni ajouter, `typescript` intact ; installe une fois par le gestionnaire de l'app ; passe la main au binaire installé quand la cible n'est pas la version qui tourne ; refuse de descendre de majeure ; hors ligne, un canal ne s'écrit pas ; `--check` nomme chaque plage avec son champ et la version publiée, se tait en CI ; sans `--to`, rien ne change — registre et installation injectés, sans réseau |
| Unitaires | `nodefony` `appDockerfile.test.ts` | `create app` et la contribution rendent le même `Dockerfile` pour npm, pnpm, yarn et bun ; une copie intacte est remplacée par `--update`, une retouchée gardée `modified` ; gestionnaire introuvable = rien posé ; le paquet `nodefony` est découvert, sauf dans le dépôt qui le produit |
| Unitaires (CLI) | `nodefony` `standaloneHelp.test.ts`, `manPage.test.ts` | `upgrade` répond à `--help` sans démarrer l'application ; la page de manuel décrit le CLI réel |
| Bout en bout | application créée par `nodefony@10.0.0-beta.2` publiée, montée sur les tarballs de la version suivante | avant : `--check` sort en 1 et `doctor` signale ; après : `--check` sort en 0, le texte hors marqueurs est identique octet pour octet |

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Guides](README.md) · [Toute la documentation](../index.md)
- 🤝 **Ce qui peut casser en montant**, et la politique de dépréciation : [Compatibilité](./compatibilite.md)
- 🐳 **Monter de version en conteneur** : [`docker-cloud-native.md`](./docker-cloud-native.md)
- 📖 [Lexique général](../lexique.md) du framework.
