---
title: "Ce qui reste ouvert — les limites assumées de ce dossier"
lang: fr
module: "global"
topic: perf-ouvertures
section: "Performance"
audience: [developer]
tags: [performance, limites, backlog, honnetete, transposabilite]
status: draft
updated: "2026-08-07"
source: "docs/performance/"
tests: none
---

📍 [Documentation](../index.md) › [Performance](index.md) › **Ce qui reste ouvert**

> Un dossier de performance qui ne dit pas ce qu'il n'a pas mesuré demande qu'on lui fasse
> confiance sur parole. Cette page liste les trous, les mesures non transposables, les pistes
> écartées avec leur condition de réouverture, et ce qui relève d'un choix d'architecture plutôt
> que d'une optimisation. Ce n'est pas une faiblesse du dossier : c'en est la partie vérifiable.

## La vision — pourquoi une page de limites fait partie du dossier

Un dossier de performance se juge moins à ses chiffres qu'à ce qu'il refuse d'affirmer.

Trois raisons rendent cette page nécessaire, et aucune n'est de la modestie. **La première** est
qu'un chiffre sans sa limite sera cité hors contexte : un débit PostgreSQL mesuré derrière une
virtualisation deviendra « la performance de PostgreSQL » dans la bouche du lecteur suivant.
**La deuxième** est qu'une piste écartée sans condition de réouverture se rouvre toute seule, plus
tard, par quelqu'un qui ignore qu'elle l'a été — et le travail est refait. **La troisième** est
que la liste des trous est la seule partie **vérifiable** d'un dossier de mesure : elle dit où
regarder pour le prendre en défaut.

## Les trous de mesure

### Le comparatif inter-frameworks n'a pas été rejoué sur l'état actuel

C'est le trou principal, et il est structurel dans la façon dont le chantier s'est déroulé.

Les rapports publiés dans [Face aux autres](comparaisons.md) — ×3,23 face à `node:http` nu, ×2,82
face à Fastify, ×1,61 face à Express — ont été mesurés dans une fenêtre où Nodefony valait
11 702 requêtes par seconde. Trois lots ont été livrés **depuis**, pour un gain de l'ordre de
+14 % cumulés, et l'état actuel mesure ~13 400 dans une fenêtre ultérieure.

**Ces deux fenêtres ne se comparent pas** — la règle vaut pour nous comme pour les autres. Le
comparatif doit donc être rejoué **intégralement**, les quatre participants dans la même soirée,
avec le protocole complet. Tant que ce n'est pas fait, les rapports publiés sont valides entre eux
à la date de leur mesure, et **sous-estiment** vraisemblablement l'état livré.

### Aucun absolu PostgreSQL de ce dépôt n'est transposable

Toutes les mesures PostgreSQL sont prises derrière la virtualisation réseau de Docker Desktop sur
macOS, dont le coût a été chiffré à un facteur 3,7 sur le chemin de la base
([Le décor ment plus souvent que le code](instruments.md)).

Ce qui **reste valide** : les comparaisons A/B à l'intérieur d'une même fenêtre, puisque le même
décor s'applique des deux côtés. C'est le cas du lot ORM et du duel avec Express.

Ce qui **ne l'est pas** : les débits absolus, et l'écart mesuré entre SQLite et PostgreSQL — qui
n'est pas une propriété de ces deux moteurs.

Ce qu'il faudrait : rejouer la campagne sur un déploiement Linux natif, base locale. Ce n'est pas
fait, et aucune extrapolation n'est proposée à la place.

### L'attribution fine du chemin virtualisé

Le coupable est identifié et son ordre de grandeur mesuré, mais la décomposition — combien pour le
proxy, combien pour la pile réseau de la machine virtuelle, combien pour le passage de frontière —
n'est **pas** établie. Une tentative d'attribution par un aller-retour TCP en boucle locale était
une faute d'instrument : ce chemin ne traverse pas Docker.

### Le renouvellement de connexions WebSocket

Cet axe est **non concluant**, et publié comme tel. C'est une métrique **à rampe** — recyclage des
ports et pression mémoire font monter la mesure au fil des répétitions — avec des dispersions de
9,7 à 28 % malgré un échauffement de six cents connexions. Cinq paires appariées sur six vont dans
le sens positif ou nul : **aucun signe de régression**, ce qui suffisait à l'objectif de
non-régression. Un verdict de **gain** demanderait des séries longues et une fenêtre glissante.

### Deux mesures de dimensionnement écartées

La mémoire par socket sécurisée (régression sans qualité d'ajustement) et les plafonds WebSocket
en clair et en ventilation (fenêtre d'instrument aveugle). Détail dans
[Dimensionnement](dimensionnement.md).

## Les pistes écartées, avec leur condition de réouverture

Une piste écartée sans condition de réouverture se rouvre toute seule, six mois plus tard, par
quelqu'un qui ne sait pas qu'elle l'a été.

<!-- prettier-ignore -->
| Piste | Pourquoi écartée | Ce qui la rouvrirait |
| --- | --- | --- |
| **Index de routes par segment** | N'ajoute au pré-filtre de préfixe qu'au-delà d'environ mille routes, contre une allocation par requête et du risque sur la brique la plus critique | Une application réelle déclarant ≫ 1 000 routes, profil à l'appui |
| **Câblage figé des dépendances** (lot F-D) | A/B en directions opposées entre deux paires, moyenne −0,4 % : bruit. Code annulé. | Un profil qui réimpute plus de 3 µs aux résolutions, ou une fabrique restructurée |
| **Mise en commun des portées d'injection** | Risque de fuite d'état entre requêtes | Rien à ce jour — le risque n'est pas compensable par le gain |
| **Bus d'événements paresseux sur le service** | Casse un contrat consommé par le service de fichiers statiques, pour ~0,3 µs | Un motif d'écartement relu et invalidé |
| **Contrôleurs en instance unique par défaut** | Rupture de compatibilité : du code applicatif porte son état de requête sur l'instance | Une version majeure, avec migration annoncée |
| **Mise en commun des identifiants de requête** | `randomUUID` possède déjà un cache d'entropie interne — gain douteux | Une mesure préalable, pas une intuition |

## Les pistes ORM non entamées

| Piste                                     | État                                                                                                                                         |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Mise à jour et insertion-ou-remplacement  | Non mémoïsées. Hors du chemin chaud des bancs actuels ; à rejuger si un profil les réimpute                                                  |
| Index sur les clés étrangères au scaffold | **Question produit** : le générateur d'entités doit-il indexer les clés étrangères par défaut ? Le corpus de banc ne l'était pas             |
| A/B MySQL du lot préparé                  | Non mesuré. La lecture du source établit qu'il n'y a **aucune préparation au niveau du protocole** — le gain attendu est purement JavaScript |

## Un geste local en attente

Le remplacement d'un appel de correspondance par son équivalent direct dans le scan de routes vaut
**157 nanosecondes par requête**, strictement équivalent en sémantique. Seul, il ne justifie pas un
cycle complet de reconstruction, de tests d'intégration et de porte mémoire. Il attend d'être
embarqué dans un lot voisin.

C'est un exemple de la discipline générale du chantier : **un gain réel mais sous la résolution du
banc ne se publie pas, et ne se livre pas seul.**

## Ce qui ne sera pas optimisé, et pourquoi

Certains postes sont **structurels** — ils découlent du design ou de Node lui-même. Les attaquer
serait dépenser sans rendement, et le profilage l'a établi poste par poste :

<!-- prettier-ignore -->
| Poste | Part du CPU | Pourquoi on n'y touche pas |
| --- | ---: | --- |
| Écouteurs Node (ajout, retrait, émission) | 9–10 % | **94 % des attaches viennent de Node lui-même** |
| Analyse HTTP entrante | 8–9 % | Analyseur natif de Node |
| Écriture sur la socket | ~5 % | Appels système, incompressibles |
| Ramasse-miettes | ~1 % | Mesuré, **réfuté comme goulot** par trois instruments concordants |
| Portée d'injection par requête | ~2 µs/req | C'est le mécanisme, et il a été mesuré : il ne coûte pas ce que le profil lui imputait |

Un socle d'environ 45 à 50 µs par requête relève de Node et de l'architecture : un serveur
`node:http` nu, sur le même décor, coûte déjà ~28 µs par requête.

Aller significativement plus bas ne serait plus de l'optimisation mais un **choix
d'architecture** — un contexte allégé, moins riche, avec les fonctionnalités mises en option.
C'est une décision de produit, pas un lot de performance, et elle n'est pas prise.

## Comment contester un chiffre de ce dossier

Tous les bancs cités sont versionnés dans `.claude/skills/nodefony-load-test/`, avec leur
protocole, leurs variables d'environnement et leurs gardes. Chaque page indique l'instrument qui
produit ses chiffres.

Un chiffre publié se re-audite volontiers. La règle interne est explicite : **quand une mesure est
remise en question, c'est la mesure qu'on rejoue, pas l'argument qu'on renforce.** Deux verdicts
de ce dossier ont été requalifiés de cette façon, et l'un l'a été après une simple question posée
sur un calcul de débit.

## Lexique

Termes propres à ce chapitre. Le vocabulaire général est défini dans
[Méthode de mesure](methode.md#lexique).

| Terme                         | Ce qu'il désigne ici                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Transposable**              | Se dit d'un chiffre qui garde son sens hors de son décor. Un rapport l'est souvent ; un absolu, rarement.    |
| **Condition de réouverture**  | Le fait précis qui justifierait de reprendre une piste écartée. Sans elle, l'écartement ne tient pas.        |
| **Métrique à rampe**          | Grandeur qui dérive au fil des répétitions d'une même série. Elle ne converge pas en trois runs.             |
| **Qualité d'ajustement** (R²) | Mesure de la fidélité d'un modèle aux points observés. Trop basse, elle signale une **absence** de résultat. |
| **Socle structurel**          | Part du coût par requête qui relève de Node et de l'architecture, non d'un défaut d'implémentation.          |

## Pièges

- **Un chiffre publié sans sa limite sera cité sans elle.** Chaque absolu de ce dossier porte donc
  la réserve qui le borne, dans la même page que le chiffre — jamais renvoyée à une note de fin.
- **Une piste écartée sans condition de réouverture n'est pas écartée**, elle est oubliée — et
  redécouverte à grands frais.
- **Une mesure qui ne s'ajuste pas n'est pas une mesure imprécise**, c'est une absence de résultat.
  La rendre sous une forme présentable serait la falsifier.
- **Une absence de régression n'est pas un gain.** L'axe WebSocket établit la première, pas la
  seconde, et ne revendique rien de plus.
- **Un gain réel mais sous la résolution du banc ne se publie pas** — et ne se livre pas seul.

## Pour aller plus loin

- ⬆️ **Retour au hub** : [Performance](index.md)
- 📏 [Méthode de mesure](methode.md) — le protocole et les critères, pour rejouer
- 🎭 [Le décor ment plus souvent que le code](instruments.md) — ce que le décor interdit de conclure
- 🥊 [Face aux autres](comparaisons.md) — le comparatif à rejouer
