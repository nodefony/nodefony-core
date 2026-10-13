---
name: nodefony-upgrade
description: >
  Monte une application Nodefony vers une nouvelle version du framework sans rien laisser derrière :
  tous les paquets ensemble et sous le bon canal, puis `nodefony upgrade` pour la documentation des
  agents, les skills et les fichiers livrés qu'un `npm install` ne refait pas, puis les ruptures
  annoncées corrigées dans le code, le schéma migré et la preuve que tout tient. À charger AVANT de
  lancer la montée de version, pas après un premier rouge. Une panne sans rapport avec une montée →
  `nodefony-troubleshoot`.
  Déclencheurs : "monter nodefony de version", "mettre à jour nodefony", "passer à la nouvelle
  beta", "upgrade nodefony", "npm update nodefony", "une nouvelle version est sortie", "mes paquets
  nodefony sont en retard", "après la mise à jour plus rien ne compile", "AGENTS.md est périmé".
metadata:
  version: 1.0.0
---

# nodefony-upgrade — les paquets, puis l'application, puis la preuve

> **Maintenance** : vérité courante, jamais un journal. Éditer en place ; l'historique vit dans
> `git log`. Pas de `references/` : ce qui doit atteindre un agent s'exécute ou vit dans ce corps.

## Passer la main

| Ce que tu fais en réalité                                        | Le skill                  |
| ---------------------------------------------------------------- | ------------------------- |
| Rien n'a été mis à jour, et quelque chose a cessé de marcher     | `nodefony-troubleshoot`   |
| Une rupture touche une table ou une colonne : migration à écrire | `nodefony-migrate-schema` |
| Une rupture touche la connexion, `/me`, l'identité de la requête | `nodefony-authentication` |
| Monter l'image et la déployer une fois l'application au niveau   | `nodefony-devops`         |
| Coder autre chose dans la foulée                                 | `nodefony-dev`            |

## 1. La règle — trois couches, trois gestes

Une montée de version touche trois couches, et `npm install` n'en fait qu'une :

1. **Les paquets** (`node_modules`) — `npm install`.
2. **Ce que les paquets ont déposé dans l'application** à sa création : le bloc framework
   d'`AGENTS.md`, les pointeurs de `.agents/skills/`, les copies livrées (décor Keycloak…). Ils
   restent sur l'ancienne version sans que rien ne casse — `nodefony upgrade`.
3. **Ton code**, quand la version annonce une rupture — toi, guidé par le changelog et le
   compilateur.

Sauter la couche 2 ne fait échouer aucun test : un agent lit simplement une porte qui décrit
l'ancienne version. Sauter la couche 3 se voit au premier `typecheck`.

## 2. La procédure

**Avant** : arbre propre, tests verts. Une montée sur un arbre déjà rouge mélange deux pannes.

```bash
git status
npm test
npx nodefony outdated
```

`outdated` liste les paquets en retard, regroupés. Note la version cible.

**Monter TOUS les paquets Nodefony, ensemble, sous le bon canal.** Ils sortent verrouillés : même
version pour `nodefony` et chaque `@nodefony/*`, devDependencies comprises (`@nodefony/devkit`
porte les skills). Nomme chacun de ceux que ton `package.json` déclare :

```bash
npm install nodefony@beta @nodefony/http@beta @nodefony/framework@beta @nodefony/security@beta
npm install -D @nodefony/devkit@beta
```

⚠️ Pendant la série 10, **`beta` est le canal de la préversion** ; `latest` sert encore l'ancienne
lignée 7 en JavaScript. Un `npm install nodefony` sans canal fait REDESCENDRE l'application.

**Remettre l'application au niveau des paquets** :

```bash
npx nodefony upgrade
```

Elle réécrit le bloc framework d'`AGENTS.md` (le texte hors des marqueurs `<!-- nodefony:start -->`
/ `<!-- nodefony:end -->` ne bouge pas), pose les pointeurs des skills apparus, rafraîchit les
copies livrées restées intactes. Ce qu'elle ne tranche pas est listé sous « À trancher à la main » :
une copie que l'application a retouchée, un `SKILL.md` écrit à la main, un skill que plus aucun
paquet ne livre. **Lis cette liste** : chaque ligne est une décision qui t'appartient.

**Lire les ruptures annoncées.** Le changelog est livré dans le paquet `nodefony` :
`node_modules/nodefony/CHANGELOG.md`, celui de la version INSTALLÉE — lu après la montée, il
couvre donc toutes les versions franchies, sans réseau. Absent (une version qui ne le livrait pas
encore) : `https://github.com/nodefony/nodefony-core/blob/main/CHANGELOG.md`. Dans la
section de chaque version franchie, les entrées marquées **`(breaking)`** sont celles qui
demandent une retouche de ton code — un nom renvoyé qui change, une option retirée, un défaut
inversé. Une rupture de comportement ne se voit pas au compilateur : seul le changelog la dit.

**Reconstruire, puis laisser le compilateur et les tests désigner le reste** :

```bash
npm run build
npm run typecheck
npm test
npx nodefony doctor
```

Un symbole renommé ou retiré sort au `typecheck` avec son fichier et sa ligne. Un symbole
**déprécié** apparaît barré dans l'éditeur : il marche encore toute la série, son TSDoc nomme le
remplaçant. `doctor` signale ce qui reste en retard, chaque constat avec son geste.

**Si une rupture touche le schéma**, ou si le changelog l'annonce : `npx nodefony orm:migrate:status`,
puis la procédure de `nodefony-migrate-schema`.

## 3. Pièges

- **Monter un paquet seul n'est pas monter Nodefony.** Deux versions différentes de `nodefony`
  dans `node_modules` se voient comme deux copies du cœur : l'application démarre amputée, ou pas
  du tout. `npm ls nodefony` doit rendre une seule version.
- **Le canal par défaut ment pendant la série 10** : sans `@beta`, npm installe la 7.
- **Un vert ne prouve pas que la documentation des agents a suivi.** Seuls `doctor` ou
  `npx nodefony upgrade --check` le voient.
- **`upgrade` ne recrée pas un `AGENTS.md` supprimé** : l'absence peut être un choix. Elle le dit.
- **Ne corrige pas une copie livrée « en retard » à la main** : si elle est intacte, `upgrade` la
  remplace ; si tu l'as retouchée, reporte tes retouches sur la nouvelle version du paquet, à la
  main et en connaissance de cause.

## 4. Gate — la montée est faite quand

```bash
npx nodefony upgrade --check
npm run typecheck
npm test
npx nodefony doctor
```

`upgrade --check` sort en 0 (sinon il dit ce qui reste en retard), le typecheck et les tests sont
verts, `doctor` ne signale rien de neuf. En intégration continue, `upgrade --check` refuse une
branche qui a monté ses paquets sans remettre l'application au niveau.
