---
title: Compatibilité et dépréciation — ce que vous risquez en montant de version
lang: fr
module: global
topic: release
audience: [human]
tags: [semver, compatibilité, dépréciation, versions, support, lockstep]
version: "doc"
status: stable
updated: 2026-09-01
source: "docs/guides/compatibilite.md"
navTitle: Compatibilité
related: docs/guides/publier-une-release.md, docs/release/nodefony-10.md, scripts/release/release-core.mjs
---

# Compatibilité et dépréciation

📍 [Documentation](../index.md) › [Guides](README.md) › **Compatibilité**

Avant d'adopter une dépendance, on se pose trois questions : **qu'est-ce qui peut casser**, **quand
on me préviendra**, et **combien de temps l'ancienne version vivra**. Cette page y répond pour
Nodefony, sans détour et sans promesse que le projet ne pourrait pas tenir.

Deux principes la gouvernent :

- **Ce qui n'est pas déclaré public n'est pas public.** La surface couverte par le versionnage est
  celle que les paquets exposent explicitement — rien de plus.
- **Une politique qu'on enfreint fait plus de dégâts que pas de politique.** Les engagements
  ci-dessous sont volontairement étroits ; ils sont tenus.

## Ce qui est couvert, et ce qui ne l'est pas

Nodefony suit [semver 2.0.0](https://semver.org/lang/fr/). La garantie porte **uniquement** sur ce
qu'un paquet déclare dans le champ `exports` de son `package.json`.

| Vous importez…                                             | Couvert ?                                     |
| ---------------------------------------------------------- | --------------------------------------------- |
| `import { Nodefony } from "nodefony"`                      | ✅ oui — chemin déclaré dans `exports`        |
| `import { … } from "@nodefony/http"`                       | ✅ oui                                        |
| Un sous-chemin déclaré, p. ex. `nodefony/bundler`          | ✅ oui                                        |
| `…/dist/quelque-chose.js`, un fichier atteint « en biais » | ❌ non — peut changer ou disparaître en patch |
| Une propriété non documentée d'un objet public             | ❌ non                                        |

Pour savoir ce qu'un paquet expose, la source fait foi et se lit en une commande :

```bash
npm view @nodefony/http exports        # ce que le paquet PUBLIÉ déclare
```

**Le comportement compte autant que la signature.** Un changement qui ne modifie aucun type mais
casse un usage raisonnable — un code d'erreur qui change, un défaut de configuration inversé, un
en-tête qui disparaît — est traité comme une rupture, pas comme un correctif.

## Les versions vont par quinze

Tous les paquets publiés partagent **la même version**, publiée d'un seul lot. Il n'existe pas de
`@nodefony/http@10.1` compatible avec `@nodefony/framework@10.0` : les combinaisons croisées ne sont
ni testées ni supportées.

Ce que ça change pour vous, concrètement : **montez les paquets Nodefony ensemble**. Si votre
gestionnaire de dépendances vous propose de n'en mettre qu'un à jour, ne le faites pas.

```bash
npm update nodefony @nodefony/http @nodefony/framework   # ensemble, jamais l'un sans l'autre
```

## Ce qu'une version veut dire

| Numéro   | Ce qui a changé                                                                   | Ce que vous risquez                                                        |
| -------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `10.0.1` | Un correctif                                                                      | Rien. Aucune API ne change, aucun comportement documenté ne bouge          |
| `10.1.0` | Un ajout, ou une dépréciation annoncée                                            | Rien ne casse. Du code peut devenir « déprécié » — il fonctionne encore    |
| `11.0.0` | Une rupture : retrait d'API, changement de comportement, ou nouveau plancher Node | Relecture nécessaire. Le changelog liste chaque rupture en tête de section |

**Relever le plancher Node est une version majeure.** Passer de Node 24 à Node 26 casse
l'installation de qui n'a pas migré : c'est une rupture, même si pas une ligne de code n'a changé.
Le plancher courant se lit dans le paquet lui-même :

```bash
npm view nodefony engines.node
```

## Le cycle de dépréciation

Rien de public ne disparaît sans avoir été annoncé **déprécié dans une version mineure au moins une
fois**.

1. **Dépréciation** — la fonction, l'option ou le comportement est marqué `@deprecated` dans le code
   publié, avec ce qu'il faut utiliser à la place. Votre éditeur le **barre** à l'écran : le
   marqueur voyage dans les fichiers de types (`.d.ts`) livrés avec le paquet, il n'est pas
   seulement un commentaire du dépôt. L'entrée figure au changelog sous `Changed`.
2. **Vie normale** — la chose dépréciée **continue de fonctionner à l'identique** pendant toute la
   série majeure. Une dépréciation n'est jamais un retrait déguisé.
3. **Retrait** — à la **majeure suivante**, et jamais avant. Le changelog l'annonce sous `Removed`,
   en tête de section.

Jamais de retrait en version mineure ni en correctif. Si vous voyez une API publique disparaître
sans être passée par l'étape 1, c'est un défaut : [ouvrez une
issue](https://github.com/nodefony/nodefony-core/issues).

> **Ce que Nodefony ne fait pas (encore)** : émettre un avertissement à l'exécution quand du code
> déprécié est appelé. Aujourd'hui la dépréciation se voit à l'écriture — dans l'éditeur et au
> changelog — pas au démarrage. Le dire plutôt que le laisser supposer : une politique n'est utile
> que si elle décrit l'outillage réel.

## Combien de temps une version est maintenue

**Seule la dernière version majeure reçoit des correctifs.**

Dès que `11.0.0` sort, la série `10.x` cesse de recevoir des correctifs — y compris de sécurité.
Elle reste téléchargeable indéfiniment sur npm, mais elle n'est plus suivie.

C'est une politique étroite, et c'est délibéré. Nodefony est développé par une seule personne, sans
financement : promettre douze mois de rétroportages produirait un engagement qui serait rompu au
premier trimestre chargé. Mieux vaut une règle courte et vraie qu'une garantie confortable et
fausse — vous pouvez planifier sur celle-ci.

Ce que ça implique pour vous :

- **Prévoyez la montée de majeure** comme une tâche récurrente, pas comme un imprévu.
- Les majeures ne sortent pas au hasard : une rupture est toujours motivée et documentée.
- Si vous devez rester sur une version ancienne, la licence [CeCILL-B](https://cecill.info/) vous
  autorise pleinement à la maintenir vous-même — le code est là, et les correctifs sont publics.

## Signaler une rupture non annoncée

Une rupture qui n'est pas passée par le cycle ci-dessus est un défaut de notre côté, pas une
fatalité de votre côté. [Ouvrez une issue](https://github.com/nodefony/nodefony-core/issues) avec la
version d'où vous venez, celle où vous allez, et le code qui fonctionnait avant. C'est le retour le
plus utile que puisse recevoir ce projet.

## 📖 Lexique

| Terme                         | Ce que c'est                                                                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Surface publique**          | Ce que le champ `exports` d'un paquet déclare. La garantie porte là-dessus, et sur rien d'autre : un chemin atteint en biais n'est pas public. |
| **Rupture**                   | Un changement qui casse du code qui marchait. Elle n'est pas que de signature : un code d'erreur qui change ou un défaut inversé en est une.   |
| **Dépréciation**              | L'annonce qu'une chose disparaîtra. Elle continue de fonctionner à l'identique pendant toute la série majeure.                                 |
| **Verrouillage** (_lockstep_) | Les quinze paquets sortent ensemble, sur la même version. Vous n'avez donc jamais à croiser deux versions entre elles.                         |
| **Plancher Node**             | La version minimale de Node exigée (`engines`). La relever casse l'installation de qui n'a pas migré : c'est une majeure.                      |

## ⚠️ Pièges

- **La garantie porte sur `exports`, pas sur ce qui est atteignable.** Un chemin interne accessible
  parce que rien ne l'interdit techniquement n'est pas public : il peut disparaître dans une
  version corrective, et ce ne sera pas une rupture.
- **Une signature inchangée ne veut pas dire un comportement inchangé.** Un code d'erreur, un
  en-tête retiré, un défaut inversé cassent votre code sans que le typage bouge d'une ligne.
- **Seule la dernière majeure reçoit des correctifs, sécurité comprise.** Il n'y a pas de
  rétroportage : ce projet n'a pas les moyens d'une politique qu'il ne tiendrait pas.
- **Une dépréciation se lit dans votre éditeur, pas dans le changelog.** Elle est portée par le
  TSDoc, qui traverse le build jusqu'aux types publiés — d'où le nom barré dans l'autocomplétion.
- **Rien ne vous oblige à monter les quinze paquets en même temps**, mais rien ne garantit qu'un
  mélange fonctionne : les versions sont conçues, testées et publiées ensemble.

## 🧪 Tests & couverture

Ce qui protège la surface publique est vérifié à chaque exécution — les chiffres exacts vivent dans
la carte de l'aperçu, jamais figés ici.

<!-- prettier-ignore -->
| Type | Où | Ce qui est prouvé |
| --- | --- | --- |
| Unitaires (surface) | `nodefony` `packageDeps.test.ts:38`, `clientSubpathSurface.types.test.ts:164` · `@nodefony/studio` `packageSurface.test.ts` | ce que chaque paquet déclare correspond à ce que son code importe et publie — la règle elle-même vit dans `checkPackageDeps()` (`packageDeps.ts:285`) |
| Unitaires (client) | `nodefony` `clientSurfaceExercised.test.ts` | les sous-chemins navigateur sont réellement exercés, pas seulement déclarés |
| Unitaires (chaîne) | `scripts/release/release-core.test.mjs`, `scripts/check-externals.test.mjs` | l'ordre de publication, les métadonnées exigées, les dépendances externalisées |

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Guides](README.md) · [Toute la documentation](../index.md)
- 📦 **La chaîne côté mainteneur**, et ce que chaque garde refuse :
  [publier une release](./publier-une-release.md)
- ⚙️ **Ce qui se configure sans toucher au code** : [`configuration.md`](./configuration.md)
- 🐳 **Monter de version en conteneur** : [`docker-cloud-native.md`](./docker-cloud-native.md)
- 📖 [Lexique général](../lexique.md) du framework.
