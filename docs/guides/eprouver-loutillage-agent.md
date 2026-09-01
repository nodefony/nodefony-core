---
title: "Éprouver un framework avec un agent — la méthode, et ce qu'elle a trouvé"
navTitle: Éprouver avec un agent
lang: fr
module: global
topic: scaffold
audience: humain
tags: [agent, banc, mesure, generateur, methode, decor]
version: "doc"
status: stable
updated: 2026-09-01
source: "docs/guides/eprouver-loutillage-agent.md"
related: docs/guides/generer-du-code.md, .claude/skills/nodefony-devkit-bench/, src/nodefony/src/cli/scaffold/engine.ts
---

# Éprouver un framework avec un agent

> Comment savoir si l'outillage d'un framework est réellement utilisable — non par nous qui
> l'avons écrit, mais par quelqu'un qui le découvre. La méthode est transposable à n'importe quel
> projet qui expose un générateur, une ligne de commande ou une convention à suivre.

📍 [Documentation](../index.md) › [Guides](README.md) › **Éprouver avec un agent**

## Le modèle — l'agent est l'instrument, le framework est le sujet

On ne peut pas s'auto-évaluer : l'auteur d'un outil sait qu'une option existe, où elle est
documentée, quel nom elle porte. Les tests du dépôt ne comblent pas ce trou, parce qu'ils posent
une autre question — ils vérifient que le générateur, **appelé correctement**, produit les bonnes
chaînes. Ils ne peuvent pas dire si quelqu'un l'aurait **appelé**, si ce qu'il produit **suffit**
face à un besoin qu'on n'a pas choisi, ni ce qu'il faut **corriger à la main** après coup.

D'où la méthode : confier une tâche réelle à un agent — délibérément le modèle **le plus faible**
disponible — dans une application neuve, sans aide, puis regarder ce qu'il a **fait**, pas ce
qu'il a dit. L'agent joue l'utilisateur sans connaissance implicite, qui ne devine rien et prend
toujours le chemin le moins coûteux. C'est un révélateur, au sens photographique.

Le modèle faible n'est pas une économie : un modèle fort **compense** les trous en devinant juste,
et rend donc un verdict flatteur qui ne mesure plus rien.

**Ce qu'on mesure n'est pas la justesse du résultat, mais le coût du contournement.** Un agent
finit toujours par obtenir le bon schéma s'il écrit assez de code à la main — et il aura alors
prouvé que le générateur ne servait à rien. La grandeur utile est donc : _combien a-t-il fallu
écrire hors de l'outil ?_ Chaque correction manuelle désigne, une par une, ce que l'outil n'a pas
su porter.

## Refaire la mesure chez vous

Cinq gestes, dans cet ordre. Les quatre premiers construisent le décor ; sauter l'un d'eux rend la
mesure ininterprétable — c'est ce que montre la section suivante.

1. **Sortir du dépôt.** L'application de mesure vit **hors** de l'arborescence du framework, et
   installe ses paquets depuis de vraies archives — jamais un lien symbolique vers les sources.
2. **Vérifier que les sources sont hors d'atteinte**, avant de lancer quoi que ce soit. C'est un
   contrôle, pas une intention : `find node_modules -name '*.ts' -not -name '*.d.ts'` doit être
   vide.
3. **Choisir une tâche que vous n'avez pas écrite.** Le schéma d'un logiciel libre existant fait
   l'affaire : ses auteurs ne vous connaissent pas, donc il demandera des choses que vos exemples
   n'exercent pas.
4. **Prendre le modèle le plus faible** dont vous disposez, et lui donner la consigne **sans** la
   retoucher entre deux tours.
5. **Compter ce qui a été écrit hors de l'outil** : appels au générateur, corrections manuelles,
   objets au bon nom. Ce sont ces trois nombres qui font la mesure, pas la réussite finale.

Sur Nodefony, ces bancs sont outillés et versionnés — leur protocole, leurs juges et
l'interprétation de leurs échecs vivent dans le skill `nodefony-devkit-bench`, livré avec
`@nodefony/devkit`.

## La leçon la plus coûteuse : le décor décide du résultat

C'est le point à retenir si vous n'en retenez qu'un.

Le premier verdict a été rendu dans une application posée **à l'intérieur du dépôt**, paquets liés
en lien symbolique. L'agent pouvait donc ouvrir le code source du framework et le recopier.
Résultat : **zéro appel au générateur**, tout écrit à la main — et un schéma parfait. On en aurait
conclu que le générateur est ignoré, ou que sa documentation est mauvaise.

Or **un utilisateur réel n'a jamais ce code** : une installation dépose du code compilé, pas les
sources. Le banc mesurait une situation qui n'existe chez personne. Après correction du décor :

|                       | Décor ouvert | Décor réel |
| --------------------- | ------------ | ---------- |
| appels au générateur  | **0**        | **11**     |
| corrections à la main | 10           | 29         |
| tables au bon nom     | 6/6          | 0/6        |

Le même agent, la même consigne, le même schéma. **Seul le décor a changé.** Deux enseignements :

1. **On ne convainc pas un agent d'utiliser un outil — on retire le chemin plus court.** Aucune
   phrase n'a été ajoutée nulle part. Tant que recopier les sources était possible et facile,
   c'était le choix rationnel.
2. **Un banc dont le décor n'est pas celui de l'utilisateur mesure autre chose que ce qu'il
   annonce**, et le fait avec l'aplomb d'une vraie mesure.

## La boucle, et les trois règles qui la rendent honnête

```
mesurer → diagnostiquer la cause → corriger L'OUTIL → remesurer
```

- **On ne change qu'une chose à la fois.** Modifier le décor _et_ la documentation dans le même
  tour rend le résultat ininterprétable.
- **On ne corrige jamais la consigne pour faire passer le banc.** Ce serait ajuster la cible à la
  réponse.
- **On corrige l'outil, pas le discours.** Mesuré ici comme ailleurs : durcir la prose d'un
  fichier lu par l'agent n'a eu aucun effet ; déplacer la même règle dans le fichier chargé
  automatiquement l'a fait appliquer. Et aucune phrase ne fera produire à un générateur une
  colonne qu'il ne sait pas écrire.

## Ce que la mesure a effectivement trouvé

Sur un seul schéma réel :

| Constat mesuré                                                         | Ce qu'il fallait corriger                                             |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `username:string(255)` → `text("username")` — **32 longueurs perdues** | le générateur voyait le mauvais moteur                                |
| `id:uuid` → `text(...)` — **18 identifiants dégradés**                 | idem — et PostgreSQL refuse `text = uuid`, donc toute jointure échoue |
| `create entity Account` → table `accounts` — **6 tables sur 6**        | aucune option n'imposait le nom de table                              |
| 29 corrections à la main                                               | l'essentiel : nommer les colonnes SQL                                 |

Le premier point s'est révélé être un **défaut du produit**, pas un manque : `resolveDatabase()`
(`engine.ts:308`) déduisait le dialecte en lisant le fichier de configuration, alors qu'une
application déclare sa base par URL — le cas normal en conteneur, en intégration continue, en
production. Le générateur produisait donc du code SQLite pour une application tournant sur
PostgreSQL, **en l'annonçant dans une ligne que personne ne relit**. Corrigé en le branchant sur
la même résolution que le noyau, `resolveInfra()` (`infra.ts:134`), appelée depuis
`engine.ts:2738` : l'environnement d'abord, le fichier ensuite.

Aucune relecture de code ne l'avait vu. Il a fallu qu'un tiers ignorant demande au framework
quelque chose de banal.

## ⚠️ Pièges — le banc lui-même

Un juge non éprouvé rend des verdicts faux avec l'aplomb des verdicts justes. Ceux-ci ont tous été
rencontrés :

- **Le juge n'est pas contrôlé.** Un lecteur de schéma perdait les définitions écrites sur
  plusieurs lignes : il annonçait 130 colonnes, ce qui avait exactement l'allure d'un compte
  juste. Remède : recompter par un chemin **indépendant**, et **amputer volontairement** le juge
  pour vérifier que le contrôle tombe.
- **Le contrôle lui-même est faux.** Le tout premier défaut n'était pas dans le lecteur mais dans
  son contrôle — une recherche de texte trop lâche tombait sur la mauvaise table.
- **Un vert par omission.** Une base absente faisait sauter tout un pan de vérification, en
  silence. Un contrôle sauté doit être **annoncé** et changer le code de sortie.
- **Juger ce qu'on n'a pas demandé.** Le juge d'API reprochait à un ancien essai une route non
  protégée, alors que rien ne l'exigeait dans sa consigne. La consigne s'écrit **avec** l'essai.
- **Le rapport qui ment par omission.** Il affichait « 0 colonne sur 83 » quand les 83 existaient
  sous d'autres noms de table. On accusait l'agent au lieu de l'outil.
- **Comparer deux essais de décors différents.** Ils ne sont pas comparables. Le rapport doit
  énoncer son décor.

## 📖 Lexique

| Terme                     | Ce que c'est                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Décor**                 | Tout ce qui entoure la mesure : où vit l'application, d'où viennent ses paquets, ce qui est atteignable. Il décide du résultat. |
| **Juge**                  | Le programme qui lit la production de l'agent et rend un verdict. À éprouver comme n'importe quel autre code.                   |
| **Coût du contournement** | Ce qui a dû être écrit **hors** de l'outil. La seule grandeur qui mesure l'outil plutôt que l'agent.                            |
| **Modèle faible**         | Le moins capable disponible. Choisi exprès : un modèle fort compense les manques et rend un verdict flatteur.                   |
| **Vert par omission**     | Un succès affiché parce qu'un contrôle ne s'est pas exécuté. Le piège central de tout banc.                                     |

## 🧪 Tests & couverture

Ce que les bancs mesurent ne remplace pas les tests du générateur — ils répondent à deux questions
différentes, et c'est tout le propos de cette page. Les deux existent :

<!-- prettier-ignore -->
| Type | Où | Ce qui est prouvé |
| --- | --- | --- |
| Unitaires (génération) | `nodefony` `create.test.ts`, `entityFields.test.ts`, `scaffoldDestination.test.ts` · `@nodefony/studio` `scaffoldService.test.ts` | que le générateur, appelé correctement, produit ce qu'il annonce |
| Bancs (agent) | skill `nodefony-devkit-bench`, livré avec `@nodefony/devkit` | qu'un tiers sans connaissance implicite y arrive — et à quel coût |

> Les tests ne peuvent pas dire si quelqu'un aurait **appelé** le générateur. C'est exactement le
> trou que cette méthode comble, et la raison pour laquelle un dépôt vert peut livrer un outillage
> que personne n'utilise.

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Guides](README.md) · [Toute la documentation](../index.md)
- 🏗️ **Ce que `nodefony create` sait faire**, et comment le piloter depuis un agent :
  [`generer-du-code.md`](./generer-du-code.md)
- 🧰 **L'outillage livré aux applications** :
  [`@nodefony/devkit`](../../src/packages/@nodefony/devkit/docs/index.md)
- 🏭 **Le même principe appliqué aux tests du dépôt** (un saut compte comme un succès) :
  [`integration-continue.md`](./integration-continue.md)
- 📖 [Lexique général](../lexique.md) du framework.
