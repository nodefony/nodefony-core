---
title: "Le pipeline HTTP — treize sessions de mesure, huit lots, un rejet"
lang: fr
module: "global"
topic: perf-pipeline
coverageModule: http
section: "Performance"
audience: [developer]
tags: [performance, http, pipeline, profilage, routeur, websocket]
status: draft
updated: "2026-08-07"
source: "src/packages/@nodefony/http, src/packages/@nodefony/framework"
tests: none
---

📍 [Documentation](../index.md) › [Performance](index.md) › **Le pipeline HTTP**

> Ce que coûte une requête qui ne fait rien. Nodefony construit un contexte complet, traverse un
> pare-feu applicatif, ouvre une portée d'injection de dépendances et écrit une réponse — même
> pour rendre un objet figé de huit champs. Cette page raconte comment ce coût a été localisé,
> ce qui a été récupéré, et le lot qui a été **annulé après avoir été écrit** parce que sa propre
> mesure ne le justifiait pas.

## La vision — structurel contre accidentel

La distinction qui organise tout le chantier tient en deux lignes.

Le **structurel** découle du design : contexte unifié HTTP et WebSocket, injection de dépendances
par requête, sécurité appliquée par défaut, observabilité. On ne le corrige pas — on l'assume, ou
l'on change d'architecture.

L'**accidentel** est du travail fait pour rien : un en-tête constant reposé à chaque requête, une
URL analysée trois fois, une promesse attendue sans abonné, un objet alloué qui ne servira jamais.
C'est la seule cible légitime d'une optimisation, et c'est là qu'a porté l'intégralité du travail
décrit ici.

Aucun lot n'a retiré une fonctionnalité, changé un défaut de sécurité, ni dégradé un contrat
public. Le pare-feu passe toujours sur toutes les requêtes ; l'identifiant de requête est toujours
un UUID ; la corrélation par stockage asynchrone local est toujours active.

## Le point de départ — une analyse statique, et ce qu'elle a eu faux

Le chantier commence par une lecture du chemin chaud, sans exécuter quoi que ce soit : cinq
goulots identifiés, chacun ancré à un `fichier:ligne`, avec des estimations de coût annoncées
comme telles. Ce document existe toujours ([rapport du 23-07](2026-07-23-pipeline-http-vs-express-fastify.md)) ;
il est conservé parce que **la suite l'a en partie contredit**, et que c'est instructif.

Le profilage runtime a tranché, poste par poste :

| Ce que l'analyse statique affirmait       | Ce que la mesure a répondu                                                             |
| ----------------------------------------- | -------------------------------------------------------------------------------------- |
| En-têtes : 1,5–3 µs par requête           | **Sous-estimé d'un facteur 5** : 13–14 µs. Devient le levier n°1.                      |
| « Le reste est vraisemblablement le GC »  | **Réfuté** : 0,93 à 1,3 % de pauses selon l'instrument — trois mesures concordantes.   |
| Nonce CSP — absent du rapport             | **Découvert** : un tirage aléatoire, un encodage et une recomposition **par requête**. |
| Promesses non gardées                     | **Confirmé**, et la correction s'étend : une seule garde existait, pas trois.          |
| Ré-armement de délai par requête          | **Confirmé et quantifié** : 3 par requête, dont 1 prouvé supprimable.                  |
| Écart attribué aux écouteurs du framework | **Non** : 94 % des attaches viennent de Node lui-même. Structurel, ne pas dépenser là. |

Sur vingt-deux ancrages `fichier:ligne` produits par l'analyse statique, **quatorze étaient
exacts, cinq avaient glissé, deux étaient faux**. C'est le taux qu'il faut avoir en tête quand une
analyse sans exécution propose un plan : elle oriente, elle ne prouve pas.

## Le profilage — où part réellement le CPU

Profils échantillonnés (`--cpu-prof`) fenêtrés sur la charge, deux runs indépendants, lecture
ascendante pour attribuer chaque poste à son appelant réel.

| Poste                                               |  Run 1 |  Run 2 | µs/req | Verdict                         |
| --------------------------------------------------- | -----: | -----: | -----: | ------------------------------- |
| Pose des en-têtes sortants (écriture + validations) | 13,4 % | 12,6 % |  13–14 | **accidentel dominant**         |
| Écouteurs Node (ajout/retrait/émission)             |  9,0 % |  8,5 % |   9–10 | structurel — 94 % vient de Node |
| Analyse HTTP entrante (`llhttp`)                    |  8,0 % |  7,5 % |    8–9 | structurel                      |
| Écriture sur la socket (`writev`, flux)             |  5,0 % |  4,8 % |     ≈5 | structurel                      |
| Portée d'injection de dépendances                   |  4,4 % |  8,0 % |    5–8 | à requalifier (voir plus bas)   |
| Code du noyau HTTP (temps propre)                   |  4,4 % |  4,1 % |    4–5 | à décomposer                    |
| Micro-tâches (échelle asynchrone)                   |  4,1 % |  4,3 % |    4–5 | accidentel partiel              |
| Fabrique de contexte (constructeurs)                |  3,4 % |  4,4 % |    4–5 | accidentel partiel              |
| Nonce CSP                                           |  1,7 % |  1,7 % |     ≈2 | **accidentel — amorti depuis**  |
| Minuteurs (3 armements par requête)                 |  1,6 % |  1,5 % |     ≈2 | 1/3 prouvé supprimable          |
| Ramasse-miettes                                     | 0,98 % | 1,08 % |     ≈1 | **réfuté comme goulot**         |

Le profil a été doublé d'une **sonde de comptage** — pas une mesure de temps, un compte exact sur
107 618 requêtes :

<!-- prettier-ignore -->
| Opération | Par requête | Détail |
| --- | ---: | --- |
| `res.setHeader` | 10,0 | serveur · nosniff · cadre · référent · CSP · id de requête · traçage · type ×2 · longueur |
| `res.removeHeader` | 3,0 | type de contenu ×2 (aller-retour) · longueur |
| `socket.setTimeout` | 3,0 | 2 par Node (délais désalignés) + 1 par le framework |
| `res.writeHead` avec message personnalisé | 1,0 | à **chaque** requête → chemin lent de Node |
| `res.getHeaders()` (copie intégrale) | 1,0 | un `hasHeader` maison qui copiait tout |
| Écouteurs attachés | 4,0 | fermeture ×2 · fin · terminé — majoritairement internes à Node |
| `res.write` + `res.end` | 2,0 | deux écritures logiques par requête |

Un compte de ce genre ne dépend ni de la machine, ni de la charge, ni de l'instrument. C'est lui
qui a rendu les corrections évidentes : trois armements de délai par requête quand un seul a du
sens, deux poses et deux retraits du même en-tête, une copie intégrale des en-têtes pour répondre
à une question que le natif traite en temps constant.

## Les lots livrés

Chaque lot est mesuré par paires alternées, passé par les suites de non-régression et par la
porte mémoire, et **annulé** si son A/B ne le justifie pas. Un test qui garde un nouveau
comportement est **vu échouer** au moins une fois, le débranchement prouvé par le diff.

### Lot A — les en-têtes

Le type de contenu n'est plus posé au constructeur pour être retiré deux fois puis reposé : il
est posé **une fois**, au moment du choix réel, avec un filet qui garantit sa présence sur les
chemins statiques et d'erreur. La longueur de contenu fait un aller net. Le message de statut
n'est transmis à `writeHead` que s'il **diffère** du standard — sinon Node réutilise sa ligne de
statut pré-calculée, et la double expression régulière de nettoyage disparaît. `hasHeader` passe
au natif.

Une piste a été **rejetée par contre-épreuve** : poser tous les en-têtes constants en un bloc
unique. Le chemin rapide de Node n'existe que si aucun en-tête n'a été posé auparavant ; avec deux
poses préalables — cas réel, cookie et traçage — il redevient plus lent que la voie normale.

### Lot B — le nonce CSP et les délais

Chaque requête tirait seize octets aléatoires, les encodait, et recomposait la politique de
sécurité de contenu. Le tirage passe à un **pool amorti** : quatre kilo-octets d'entropie tirés
d'un coup, découpés à la demande, rechargés à épuisement. La garantie cryptographique est
identique — c'est exactement le mécanisme interne de `randomUUID` — et **le nonce reste unique
par requête**, ce que garde un test qui vérifie que deux requêtes obtiennent deux valeurs
différentes, vu échouer en figeant l'accesseur.

Le délai serveur est aligné sur le délai de réponse. Trois armements par requête tombent à deux,
prouvé par un compteur, sans changement de sémantique : l'armement du framework dominait déjà le
comportement effectif.

### Lot C — les promesses à vide

Trois points d'extension du contexte programmaient une enveloppe asynchrone **sans aucun abonné**.
Une garde sur le nombre d'écouteurs les court-circuite. La sauvegarde de session est court-circuitée
quand aucune session n'a démarré.

Le gain isolé mesure ~0,4 µs par requête au micro-banc — **sous la résolution du banc ce soir-là**.
Verdict rendu tel quel : structurel, gardé en le disant, aucun gain de débit revendiqué.

### Lot D — l'URL et un bug de disponibilité

Le reformatage d'URL est remplacé par la chaîne déjà construite ; l'URL d'origine devient
paresseuse ; un objet constant déjà défini mais ignoré est enfin retourné.

En chemin, ce lot **corrige un vrai défaut** : un en-tête `Origin: null` — cas légitime prévu par
la RFC 6454 — faisait échouer la construction du contexte, et la requête restait **sans réponse**,
socket suspendue. Le repli est aligné sur celui du chemin WebSocket, et le test a été vu rouge
avant d'être vert.

### Le verdict cumulé A→D

Ré-audité au banc durci, en quatre séries dont la dispersion ne dépasse pas 1,5 % :

| Série                   |    min |   méd. |    max | dispersion |
| ----------------------- | -----: | -----: | -----: | ---------: |
| `old1` — avant le lot A |  9 720 |  9 742 |  9 792 |      0,7 % |
| `new1` — après A→D      | 10 545 | 10 572 | 10 609 |      0,6 % |
| `old2` — avant le lot A |  9 777 |  9 816 |  9 876 |      1,0 % |
| `new2` — après A→D      | 10 680 | 10 731 | 10 843 |      1,5 % |

**+8,9 % [7,7 – 10,1]**, sans chevauchement.

Ce chiffre **remplace** les annonces faites lot par lot. Le banc de l'époque comptait le premier
run à froid et les fenêtres différaient : les pourcentages par lot ne s'additionnaient pas. Le
banc a été durci **avant** de re-mesurer — échauffement non compté, dispersion publiée et
opposable, niveau thermique noté, purge des résultats antérieurs, locale forcée.

### Le re-profil, et le poste qui n'existait pas

Après les lots, les postes attaqués sont tombés :

| Poste                      |  Avant |  Après |
| -------------------------- | -----: | -----: |
| Pose des en-têtes sortants | 13,4 % |  7,3 % |
| Nonce CSP                  |  1,7 % | 0,16 % |
| Armements de délai         |  3/req | 0,05 % |
| Reformatage d'URL          |   ≈1 % | 0,16 % |
| Promesses à vide           |  4,1 % | 0,00 % |

Et un nouveau premier poste est apparu : la **portée d'injection de dépendances**, à 22,4 % du CPU
occupé. C'est là que le chantier a failli partir dans le mur.

Un micro-banc isolé du mécanisme rend **557 nanosecondes** pour entrer et sortir d'une portée.
Sur un budget de 87 µs, cela fait **0,7 %** — là où le profil impute 21,6 %. Facteur 25 à 30.

Une **sonde placée dans le serveur réel** (compteurs cumulés, activée par variable
d'environnement, branche morte quand elle est éteinte) a tranché : le poste total vaut bien
~18,7 µs par requête — **le profil avait raison sur le total et faux sur la répartition**.
L'entrée de portée vaut ~2,1 µs, pas 17 %. Le vrai coût est dans la **fabrique** : construction
de la requête et de la réponse (~47 % du poste), constructeur du service de base (~36 %).

Deux chantiers déjà planifiés ont été **enterrés** sur ce constat, et un troisième réorienté. La
sonde est restée dans le code, désactivée par défaut.

### Lots F — la fabrique

Trois lots livrés ensemble, mesurés ensemble : **+4,0 à +10,5 %** (`old` 10 932 / 11 566 · `new`
12 077 / 12 026, sans chevauchement).

- **Le service de base ne mute plus sa classe cachée** : la suppression d'une clé d'options après
  construction est remplacée par une déstructuration qui ne la pose jamais. Le contrat attendu par
  un consommateur du framework est préservé **par construction**, pas par une précaution.
- **La table d'écouteurs suivis devient paresseuse** : `null` par défaut, allouée au premier
  usage, remise à `null` au nettoyage.
- **La négociation de contenu devient paresseuse et mémoïsée** : le chemin JSON nominal n'analyse
  plus jamais l'en-tête `Accept`.

Ce dernier point a révélé un piège de langage qui vaut d'être noté : un champ de classe déclaré
dans la classe de base **masque** un accesseur défini dans la sous-classe, parce qu'un champ est
une propriété propre de l'instance. La solution est un accesseur porté par la base et un point de
surcharge explicite.

Quatre mesures valides sur sept runs : **tout run partant d'un niveau thermique supérieur à 45 a
été jeté**. Une paire à chaud rendait −2 % là où la paire à froid disait +10 %.

### Lot F-B — l'URL analysée une fois

Le plus gros de la série. Construire l'URL complète d'une requête revenait à **concaténer une
chaîne puis la faire ré-analyser** par l'analyseur standard, à chaque requête.

Le principe retenu est un **chemin rapide avec repli** : si le chemin brut est déjà canonique —
ni pourcentage, ni antislash, ni segment relatif, ni double barre, test en un passage bon marché —
alors le chemin et la requête s'extraient par découpe, et l'URL complète devient **paresseuse**.
Sinon, l'analyseur standard est construit comme avant. Le contrat public est intact.

**Mesure** : +10,5 % sans chevauchement sur la première paire ; deux séries refusées pour
dispersion excessive ; une fenêtre antérieure donnait +3,8 %. **Retenu : +4 à +10 %.** Aucune
comparaison valide ne place le nouveau code sous l'ancien, sur deux fenêtres.

**Et surtout : un banc d'attaque dédié.** La normalisation par l'analyseur standard n'est pas
cosmétique — elle protège le routage. L'attaque conçue est précise : une forme dont le chemin
**brut** échappe au motif qui délimite une zone protégée, mais dont la forme **normalisée** y
retombe — la route serait alors atteinte hors de sa zone. Sept vecteurs, tous attendus en `401`
**exact** (un 404 ne prouverait rien sur l'autorisation), plus la réciproque en 200 pour montrer
que la route vit, plus les cas d'`Host` cassé. **Cinq cas sur quatorze ont été vus rouges** en
débranchant le chemin rapide. L'équivalence caractère par caractère est couverte en test unitaire.

### Lot F-D — écrit, prouvé, puis annulé

Le lot suivant supprimait six résolutions de conteneur par requête en figeant leur câblage une
fois pour toutes au démarrage. Il a été **entièrement implémenté**, ses tests vus rouges au
débranchement, et toutes les suites passées au vert.

Son A/B :

| Série  |    RPS | dispersion |
| ------ | -----: | ---------: |
| `old1` | 13 426 |      1,4 % |
| `new1` | 13 203 |      2,9 % |
| `old2` | 13 418 |      0,7 % |
| `new2` | 13 539 |      1,0 % |

**Directions opposées entre les deux paires** (−1,7 % puis +0,9 %), moyenne −0,4 %. C'est du bruit.
Le gain mécanique (~0,5–1 µs par requête) est réel mais sous la résolution du banc — et le critère
avait été engagé avant la mesure. **Le lot a été annulé**, l'arbre remis à son état antérieur, les
tests unitaires re-confirmés.

C'est la décision la plus instructive du chantier : un code correct, testé, mesurable en théorie,
supprimé parce que la mesure ne le soutenait pas.

## Le routeur — un lot qui ne revendique aucun gain de débit

Le routeur possède depuis juin un **index des routes littérales** : une table associative par
chemin exact, livrée avec +15,3 % de débit à l'époque. Le coût de résolution est donc en
`O(routes dynamiques)`, pas en `O(routes)` — mais les routes à variable restent scannées une à
une, quel que soit le chemin demandé.

Ce résidu a d'abord été **mal évalué**. Le profil imputait 7,4 % à l'exécution des motifs sur une
route donnée, soit ~31 µs. Le micro-banc a rendu **1,15 µs**. Le troisième écart de facteur 25 à
30 de ce chantier — et cette fois, il a servi : le lot a été requalifié **avant** d'être écrit.

Ce qui est exact, en revanche, c'est le **compte** : sur la table de ce dépôt, une route
d'authentification déclenche **43 exécutions de motif** par requête (moyenne 27, maximum 47 sur
136 routes). Ce compte ne dépend d'aucune mesure de temps.

Le lot livré ajoute à chaque route dynamique le **préfixe littéral** de son chemin, calculé une
fois à la construction de l'index. Le scan écarte une candidate si le chemin demandé ne commence
pas par ce préfixe. La mise en minuscules du chemin existait **déjà** pour la table des littérales :
**zéro allocation par requête**. On saute une candidate, on n'en réordonne aucune — l'ordre
d'insertion, qui est le contrat du routeur, est tenu par construction.

| Table de routes | Motifs exécutés/req (avant) | Motifs exécutés/req (après) |
| --------------: | --------------------------: | --------------------------: |
|             136 |                        26,3 |                     **2,8** |

Pire cas : 47 → 11. Soit **−89 %**.

En temps, cela fait ~0,54 µs sur 86 — **0,6 % du budget, sous le bruit d'un A/B**. Aucun gain de
débit n'est revendiqué, **et aucun A/B n'a été lancé** : le critère de succès annoncé était la
courbe, pas le débit. Ce qui change est l'échelle — le nombre de motifs exécutés ne suit plus le
nombre de routes **déclarées**, mais celui des routes qui **partagent le préfixe** :

| Routes déclarées | Dynamiques scannées | Scan sans index | Scan indexé | Part d'un budget de 86 µs |
| ---------------: | ------------------: | --------------: | ----------: | ------------------------: |
|              136 |                  47 |         1,09 µs |     0,09 µs |                     1,3 % |
|              300 |                 101 |         2,62 µs |     0,05 µs |                     3,0 % |
|              600 |                 201 |         8,89 µs |     0,07 µs |                    10,3 % |
|            1 200 |                 401 |        31,54 µs |     0,07 µs |                    36,7 % |
|            2 400 |                 801 |        56,77 µs |     0,06 µs |                    66,0 % |

La croissance est **super-linéaire** — 8,8 fois plus de routes pour 29 fois plus de temps : la
table de motifs sort des caches du processeur. C'est un problème d'application, pas de dépôt : ce
dépôt en déclare 136.

> **Ce tableau est une fenêtre de mesure, pas un barème.** Rejouer le même banc un autre jour rend
> des absolus sensiblement différents — une re-mesure a donné 1,44 · 2,92 · 15,55 µs sur les trois
> premières lignes. Ce qui se transpose est la **forme** de la courbe et le rapport entre les deux
> colonnes ; les microsecondes, non. Le banc se rejoue :
> `node .claude/skills/nodefony-load-test/scripts/micro/micro-route-scale.mjs`.

**Une garde qui n'est pas une précaution de principe.** Le préfixe s'arrête au premier caractère
non ASCII, et il existe un cas de rupture réel : un motif compilé avec l'option insensible à la
casse fait correspondre le sigma final grec au sigma minuscule, là où la mise en minuscules ne le
fait pas. Comparer le préfixe entier rendrait **404 sur une route qui correspond**. Via une URL le
chemin est encodé, donc ASCII ; le cas vit sur le pont d'appel de procédure par WebSocket, qui
transporte un chemin brut. Le test a été vu rouge en retirant la garde.

**La preuve que le lot opère** — et pas seulement qu'il ne casse rien : un test espionne la
méthode de correspondance et **compte les appels**. Sur 31 routes dynamiques, **une seule
exécution de motif**. Débranché, il tombe sur « 31 attendu, 1 obtenu ». Sans ce test, un
pré-filtre **inerte** passerait tous les autres.

## Les WebSockets — ce qu'il fallait prouver

Les lots ci-dessus touchent des briques **partagées** entre HTTP et WebSocket : le service de
base, le contexte, la table d'écouteurs. Un gain HTTP payé par une régression WebSocket serait un
mauvais marché.

La comparaison a été faite entre l'état d'avant tout le chantier et l'état livré, **deux arbres
construits côte à côte**, serveurs alternés sans reconstruction entre les runs.

| Axe            | Verdict                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------- |
| Écho           | **Bruit** — paire propre à +1,0 %, dispersion 0,4 à 1,6 %                                |
| Diffusion      | **Bruit** — le +5,9/+10,7 % d'une première série disparaît en seconde série              |
| Renouvellement | **Non concluant** — rampe intrinsèque, dispersion 9,7 à 28 % ; aucun signe de régression |

Les lots HTTP sont **neutres côté WebSocket**. C'est le résultat attendu, et il est publié tel
quel : aucun gain n'est revendiqué là où la mesure n'en montre pas.

Le renouvellement de connexions s'est révélé être une métrique **à rampe** — recyclage des ports
et pression mémoire font monter la mesure au fil des répétitions. Trois répétitions ne convergent
pas. Un verdict de gain sur cet axe demanderait des séries longues et une fenêtre glissante.

## Où en est le pipeline

Sur la fenêtre de mesure la plus récente, la cible de banc rend **~13 400 requêtes par seconde**
en mono-processus, contre ~9 750 avant le chantier — les deux mesurés dans leurs fenêtres
respectives, avec le même protocole.

Ce que ce chiffre ne dit pas, et qui est écrit dans [Ce qui reste ouvert](ouvertures.md) : la
comparaison avec les autres frameworks n'a **pas** été rejouée dans cette fenêtre. Les rapports
publiés dans [Face aux autres](comparaisons.md) datent d'une fenêtre antérieure aux lots F, et
deux fenêtres ne se comparent pas.

## Lexique

Termes propres à ce chapitre. Le vocabulaire général — débit, dispersion, blocage, structurel —
est défini dans [Méthode de mesure](methode.md#lexique).

| Terme                     | Ce qu'il désigne ici                                                                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Profil échantillonné**  | Relevé périodique de la pile d'appels. Il désigne des postes, il ne les chiffre pas à la microseconde près.                 |
| **Temps propre**          | Temps passé **dans** une fonction, hors de ses appelées. C'est ce qu'on additionne ; le temps total, non.                   |
| **Lecture ascendante**    | Attribution d'un poste à ses appelants réels, plutôt qu'à la fonction où l'échantillon est tombé.                           |
| **Micro-banc**            | Mesure d'un mécanisme isolé, hors du serveur. Précis sur la mécanique, optimiste sur le réel (tas froid, caches propres).   |
| **Sonde in-situ**         | Compteurs placés **dans** le serveur réel sous charge. L'arbitre entre un profil et un micro-banc.                          |
| **Chemin rapide / repli** | Traitement court quand l'entrée est triviale, retour au traitement complet sinon. La sûreté vit dans la condition de repli. |
| **Motif de route**        | Expression régulière compilée à partir d'un chemin déclaré. Le scan consiste à en exécuter un par route candidate.          |
| **Pré-filtre de préfixe** | Test bon marché qui écarte une route avant d'exécuter son motif.                                                            |

## Pièges

- **Un profil désigne un poste, il ne le dimensionne pas.** Trois fois sur ce chantier, un
  pourcentage de CPU occupé a surestimé un coût réel d'un facteur 25 à 30. Convertir en
  nanosecondes par un micro-banc **avant** d'ouvrir un chantier.
- **Un micro-banc isolé ment dans l'autre sens** — tas froid, sites d'appel monomorphes. L'arbitre
  est la sonde placée dans le serveur réel sous charge.
- **Un champ de classe masque un accesseur de sous-classe.** Conséquence directe de la sémantique
  des champs de classe : ils sont des propriétés propres de l'instance.
- **Un pré-filtre inerte passe tous les tests de non-régression.** Il faut un test qui prouve que
  le filtre **opère**, pas seulement qu'il ne casse rien.
- **La reconstruction complète du projet déclenche l'indexation système**, qui pollue les runs
  suivants par vagues. Attendre que l'indexeur retombe sous 2 % sur deux contrôles espacés.

## Pour aller plus loin

- ⬆️ **Retour au hub** : [Performance](index.md)
- 📏 [Méthode de mesure](methode.md) — protocole A/B, gardes, lexique
- 🗄️ [ORM et bases de données](orm.md) — là où partent réellement les microsecondes d'une vraie app
- 🥊 [Face aux autres](comparaisons.md) — Express, Fastify, `node:http` nu
- 🎭 [Le décor ment plus souvent que le code](instruments.md)
