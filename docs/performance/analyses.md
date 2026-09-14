---
title: "Où part le temps — pipeline, comparaisons, bases de données"
lang: fr
module: "global"
topic: perf-analyses
section: "Performance"
audience: [developer]
tags: [performance, pipeline, profilage, comparaison, orm, limites]
status: stable
source: ".claude/skills/nodefony-load-test/"
tests: none
---

📍 [Documentation](../index.md) › [Performance](index.md) › **Où part le temps**

> Cette page répond à une seule question, sous quatre angles : **où part le temps d'une requête**.
> Dans le pipeline HTTP d'abord — ce qui est structurel et ce qui est du travail fait pour rien.
> Face aux autres frameworks ensuite, à trois niveaux d'équité croissante. Dans les bases de
> données enfin, où le framework cesse vite d'être le poste dominant. Elle se termine par ce que
> ce dossier **n'a pas** su mesurer, et par la façon d'en contester un chiffre.
>
> Le protocole qui rend ces chiffres opposables — décor, gardes, instruments qui ont menti — vit
> dans [Méthode de mesure](methode.md). Les chiffres de référence courants sont dans
> [le hub](index.md).

## Le pipeline HTTP — structurel contre accidentel

### La vision — structurel contre accidentel

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

### Le point de départ — une analyse statique, et ce qu'elle a eu faux

Le chantier commence par une lecture du chemin chaud, sans exécuter quoi que ce soit : cinq
goulots identifiés, chacun ancré à un `fichier:ligne`, avec des estimations de coût annoncées
comme telles. Ce document existe toujours ([rapport du 23-07](#lanalyse-initiale-et-ce-quelle-avait-faux)) ;
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

### Le profilage — où part réellement le CPU

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

### Les lots livrés

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

### Le routeur — un lot qui ne revendique aucun gain de débit

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

### Les WebSockets — ce qu'il fallait prouver

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

### Où en est le pipeline

Sur la fenêtre de mesure la plus récente, la cible de banc rend **~13 400 requêtes par seconde**
en mono-processus, contre ~9 750 avant le chantier — les deux mesurés dans leurs fenêtres
respectives, avec le même protocole.

Ce que ce chiffre ne dit pas, et qui est écrit dans [Ce qui reste ouvert](#ce-qui-reste-ouvert) : la
comparaison avec les autres frameworks n'a **pas** été rejouée dans cette fenêtre. Les rapports
publiés dans [Face aux autres](#face-aux-autres--trois-niveaux-déquité) datent d'une fenêtre antérieure aux lots F, et
deux fenêtres ne se comparent pas.

## Face aux autres — trois niveaux d'équité

### La vision — un écart n'a de sens qu'à travail égal

Comparer deux frameworks sur une route qui renvoie un objet constant ne compare pas deux
frameworks : cela compare **ce qu'ils font**, et ils ne font pas la même chose.

Nodefony exécute sur **chaque** requête un contexte d'injection de dépendances, un identifiant de
requête, une corrélation de traçage au format W3C, la résolution des zones du pare-feu, les
contrôles d'origine et de méta-données de récupération, et la pose des en-têtes de sécurité.
Express ne fait rien de tout cela tant qu'on ne l'a pas installé, configuré et branché.

Le protocole retenu construit donc **trois niveaux de comparaison**, du plus flatteur pour la
concurrence au plus honnête :

1. **Pipeline nu contre pipeline nu** — ce que chacun coûte pour ne rien faire.
2. **À service égal** — Express équipé des middlewares qui rendent le même travail par requête.
3. **À service égal et à ORM égal** — les deux interrogent la même base, avec le même pilote.

Le décor est identique aux trois niveaux : même charge utile JSON, **mêmes 186 routes** avec la
cible en position 31, mode production, journalisation coupée des deux côtés, même générateur de
charge, même fenêtre de mesure.

### Niveau 1 — pipeline contre pipeline

| Cible          | RPS médian | Dispersion | Rapport vs Nodefony |
| -------------- | ---------: | ---------: | ------------------: |
| `node:http` nu |     37 770 |      0,7 % |               ×3,23 |
| Fastify        |     33 024 |      0,5 % |               ×2,82 |
| Express        |     18 845 |      2,0 % |               ×1,61 |
| **Nodefony**   | **11 702** |      0,8 % |                   — |

Aucun des points de comparaison ne fait quoi que ce soit de particulier — au sens littéral :

```js
// fastify.mjs — sans schéma de sérialisation rapide (JSON.stringify, comme les autres)
app.get(BENCH_PATH, async () => state);

// express.mjs
app.get(BENCH_PATH, (_req, res) => res.json(state));
```

> ⚠️ **Ces mesures datent d'une fenêtre antérieure aux derniers lots du pipeline.** Nodefony y
> valait 11 702 RPS ; l'état livré mesure ~13 400 dans une fenêtre ultérieure. Deux fenêtres ne se
> comparent pas — le comparatif reste donc **à rejouer sur l'état actuel**, et il l'est dans
> [Ce qui reste ouvert](#ce-qui-reste-ouvert). Les rapports ci-dessus sont valides **entre eux**, à la
> date de leur mesure.

### Niveau 2 — à service égal

Le banc « équitable » ajoute à Express les middlewares qui rendent le travail que Nodefony rend
par requête : le stockage asynchrone local et l'identifiant de requête, la corrélation de traçage,
les partages d'origine, les en-têtes de sécurité, la protection contre la falsification de requête
par méta-données, et la mise en correspondance des zones.

| Cible                             | RPS médian |
| --------------------------------- | ---------: |
| `node:http` nu                    |     37 161 |
| Express nu                        |     18 497 |
| **Express équipé** (même travail) | **14 891** |
| Nodefony                          |     11 512 |

Deux verdicts :

- **Le prix de ces fonctionnalités est de −19,5 % pour Express.** Ce n'est pas un coût de
  framework, c'est le coût du travail lui-même : quelqu'un doit le payer.
- **L'écart honnête tombe à ×1,29.**

### La preuve d'équité — ce que la cible ne fait pas

Une comparaison à service égal ne vaut que si la cible Nodefony ne traîne pas de travail dormant
que l'Express équipé n'aurait pas. Cela ne se suppose pas : c'est **prouvé par un instrument
versionné**, sur mille requêtes dans le décor exact du banc.

| Ce qui est vérifié                | Comment                                                                              | Résultat |
| --------------------------------- | ------------------------------------------------------------------------------------ | -------- |
| Aucune session démarrée           | Aucun en-tête `Set-Cookie` sur les 1 000 réponses                                    | 0        |
| Aucune écriture en base           | `PRAGMA data_version` depuis une connexion en lecture ouverte **pendant** la fenêtre | stable   |
| Aucune ligne ajoutée              | Écarts sur les six tables du framework                                               | 0        |
| Profileur non monté en production | Son plan de données répond 404                                                       | 404      |
| Chronométrage inactif             | Vérifié au code : désactivé hors développement                                       | inactif  |

Le choix de `PRAGMA data_version` est délibéré : il change dès qu'**une autre connexion** valide
une transaction, **toutes tables confondues** — là où un comptage par table ne couvre que ce
qu'on a pensé à compter. Une fenêtre de repos témoin de dix secondes discrimine un éventuel
écrivain périodique.

**Et l'instrument lui-même a été vérifié mordant** : une écriture témoin par une autre connexion
fait bien bouger la valeur. Le « 0 » n'a été cru qu'après ce rouge.

Ce qui reste **volontairement** dans l'écart de 1,29 : les effets de second ordre — pression sur
les caches d'instructions, débit d'allocation, ramasse-miettes. C'est le prix réel d'un contexte
riche, et il n'est pas soustrait.

### Niveau 3 — à service égal **et** à ORM égal

Le niveau le plus proche d'une application réelle : les deux interrogent la même base PostgreSQL,
avec le même ORM, la même version résolue depuis le même arbre de dépendances, le même schéma, le
même pool, la même requête.

Deux modes sont mesurés des deux côtés : **naïf** (la requête est construite à chaque appel — le
code idiomatique de l'ORM) et **préparé** (la requête est mémoïsée — ce que fait Nodefony depuis
[le lot ORM](#orm-et-bases-de-données--un-escalier-pas-un-chiffre)).

| Application                      | Mode ORM                 | RPS médian |
| -------------------------------- | ------------------------ | ---------: |
| Express nu + ORM naïf            | construction par requête |      1 089 |
| Nodefony avant le lot            | construction par requête |      1 017 |
| **Nodefony livré**               | **requête mémoïsée**     |  **1 640** |
| **Express équipé + ORM préparé** | parité totale            |  **1 758** |
| Express nu + ORM préparé         | zéro middleware          |      1 801 |

Les verdicts, dans l'ordre où ils comptent :

- **À parité de travail et d'ORM : ×1,07.** Nodefony rend ~93 % du débit d'un Express équipé du
  même service. C'est le chiffre le plus honnête du dossier.
- **À parité d'ORM mais sans aucun middleware Express : ~90 %** d'un Express nu — c'est-à-dire
  d'un serveur qui ne rend ni pare-feu, ni session, ni audit, ni corrélation.
- **Le prix des middlewares Express sur une route ORM n'est plus que de −2,4 %** (1 801 nu contre
  1 758 équipé), là où il valait −19,5 % sur une route sans base. **L'ORM dilue tout.**

### Le recoupement qui valide la mesure

Express passe de 1 089 à 1 801 en mémoïsant sa requête : **+65 %**. Nodefony passe de 1 017 à
1 640 : **+60 à 62 %**.

Même goulot, même remède, **deux frameworks indépendants**. Une prédiction avait d'ailleurs été
engagée **avant** la mesure — « naïf ≈ avant, préparé ≈ après, écart inférieur à 10 % » — et elle
s'est vérifiée. C'est ce recoupement croisé qui donne confiance dans l'A/B PostgreSQL : un gain
qui se reproduit à l'identique chez un tiers n'est pas un artefact de banc.

### Le banc SQLite — un renversement, et l'enquête qu'il a demandée

Le banc PostgreSQL ci-dessus donne Nodefony à **93 %** d'un Express à parité. Le banc applicatif
SQLite — vingt lignes lues puis l'`UPDATE` de la ligne lue — donne **146 %** : 1 041 req/s contre
714, séparation nette, dispersions inter-séries de 0,3 % et 0,5 %.

Les deux mesures ne se contredisent pas, elles ne portent pas sur le même décor : PostgreSQL a un
pilote **asynchrone** qui rend la main, SQLite un pilote **synchrone** dont la latence EST son
blocage. Mais un renversement de cette ampleur ne se publie pas sans l'avoir instruit.

#### L'équité, éprouvée plutôt qu'affirmée

Une équité ne se démontre pas par le raisonnement : elle s'éprouve en tentant d'**améliorer le camp
adverse** jusqu'à échouer. Quatre écritures du camp témoin ont été mesurées :

| Écriture du camp Express                                  |     RPS |
| --------------------------------------------------------- | ------: |
| `prepare()` à valeur figée puis `.all()` — celle en place | **714** |
| `prepare()` + `sql.placeholder()` + paramètres liés       |     670 |
| `.execute()`, l'entrée même qu'emprunte Nodefony          |     663 |
| aucune préparation, requête reconstruite à chaque appel   |     530 |

La variante en place est la meilleure, et adopter la méthode d'appel de Nodefony **dégrade** le
témoin. L'écart ne vient donc pas d'un adversaire mal écrit. S'y ajoutent les contrôles de décor :
même ORM et même pilote aux versions du dépôt, schéma importé du `dist` et jamais recopié, base en
copie binaire du même seed, PRAGMA constatés **par le pilote** (WAL, `synchronous` NORMAL), et le
même objet rendu — 74 champs, mêmes types, vérifiés par requête sur chaque camp.

#### Où part le temps

Profil CPU des deux camps sous la charge du banc, self-time agrégé :

| Poste                                                                      |    Témoin | Nodefony |
| -------------------------------------------------------------------------- | --------: | -------: |
| `drizzle-orm`, total                                                       | 11 723 ms | 6 921 ms |
| dont `is` via `mapResultRow`                                               |  4 055 ms | 1 092 ms |
| dont `mapResultRow` lui-même                                               |  1 399 ms |   193 ms |
| construction des requêtes (`buildSelection`, `buildQueryFromSourceParams`) | ~1 040 ms |  ~845 ms |
| pipeline Nodefony                                                          |         — | 3 439 ms |
| `express` et son routeur                                                   |    222 ms |        — |

Nodefony **paie bien son pipeline** — 3 439 ms que le témoin n'a pas — mais en économise 4 802 dans
l'ORM. Le solde est en sa faveur. Et **ce n'est pas un défaut d'Express** : le profil lui attribue
0,7 % du temps.

#### Le fait qui reste sans explication

Le volume de travail est **strictement identique**, mesuré et non déduit : **21 appels** à
`mapResultRow` par requête de chaque côté, environ 74 colonnes par appel. Rapporté aux requêtes
réellement servies, le même code coûte **25,3 µs par appel au témoin contre 4,6 µs à Nodefony**.

Dix hypothèses ont été **réfutées par la mesure** : Express lui-même, les PRAGMA, les versions
d'ORM et de pilote, le schéma, la base, le plan SQL, un éventuel cluster face à un mono-process,
l'écriture, la sérialisation, la déoptimisation V8 — `--trace-deopt` ne montre aucune
déoptimisation sur le chemin de service — et les quatre écritures du camp témoin.

Il reste une seule famille d'explications : **le même code ne s'exécute pas à la même vitesse selon
le site d'appel**, `is()` effectuant trois tests de type par colonne, soit environ 4 600 tests par
requête. L'instrument qui trancherait est `--trace-ic`. Tant qu'il n'a pas parlé, ce paragraphe
énonce un fait mesuré et une piste, jamais une conclusion.

#### Ce que cela vaut pour Nodefony

Rien à gagner : notre chemin est déjà le rapide. Le bénéfice est **défensif et chiffré** — le site
d'appel de `find()` vaut **0,44 ms par requête**. Une évolution qui le rendrait polymorphe coûterait
près de 30 % du débit applicatif **sans qu'aucun test ne le voie**.

### Ce que ces trois niveaux disent

**L'écart fond à mesure que l'application grandit.**

| Ce que fait l'application                | Écart avec un Express à service comparable |
| ---------------------------------------- | -----------------------------------------: |
| Rien (objet constant)                    |                                      ×1,61 |
| Le même travail par requête              |                                      ×1,29 |
| Le même travail **et** une vraie requête |                                  **×1,07** |

La lecture est simple : le coût fixe du framework se dilue dans le travail utile. Sur une
application qui interroge une base — c'est-à-dire toutes — il devient marginal.

**Ce qui n'est pas revendiqué, et ne le sera pas** : Nodefony n'est pas « plus performant » en
absolu. Sur une route qui ne fait rien, il est plus lent, et le dossier le publie en première
ligne. Ce qui est démontré, c'est que **le prix du service rendu est comparable à celui que
n'importe qui paierait pour rendre le même service**, et qu'il cesse d'être discriminant dès
qu'une requête SQL entre dans le budget.

## ORM et bases de données — un escalier, pas un chiffre

> 🕰️ **Les chiffres de cette partie viennent d'une fenêtre de mesure ANTÉRIEURE**, sur une version
> de Node plus ancienne et un décor qui n'enregistrait ni le régime CPU ni l'état de
> virtualisation de la machine. Ils **ne se comparent pas** à ceux du [hub](index.md), et surtout
> pas terme à terme : entre deux versions de Node, un même code a vu son débit bouger de plusieurs
> dizaines de pour cent.
>
> Ce qui reste valable ici n'est pas la valeur absolue de chaque marche, c'est la **méthode** —
> l'escalier, l'additivité vérifiée, et l'ordre de grandeur des postes les uns par rapport aux
> autres. C'est d'ailleurs ce qui permet de constater que les mesures neuves **concordent** avec
> lui : une lecture de vingt lignes coûtait ~936 µs sur cette échelle, et le banc applicatif
> actuel place le cycle complet dans le même ordre de grandeur.

### Le modèle — un escalier, pas un chiffre

Comparer « une route ORM » à « une route nue » ne dit rien : trop de choses changent d'un coup.
La méthode retenue est un **escalier** — une suite de routes qui n'ajoutent qu'**une** chose
chacune, mesurées dans la même fenêtre, avec le même protocole. La différence entre deux marches
est le coût de ce qu'on vient d'ajouter.

Médianes de trois runs, dispersion inférieure à 3 %, magasin SQLite sauf mention contraire :

| Route                                | Ce que la marche ajoute           |    RPS | µs/req | Dispersion |
| ------------------------------------ | --------------------------------- | -----: | -----: | ---------: |
| Cible de banc (contrôle)             | pipeline nu                       | 11 580 |     86 |      1,9 % |
| Reprise de session — magasin mémoire | session en mémoire                |  9 664 |    103 |      1,7 % |
| Reprise de session — SQLite          | session via l'ORM                 |  2 350 |    426 |      1,5 % |
| Écriture d'une facture               | INSERT avec deux clés étrangères  |  1 329 |    752 |      1,4 % |
| Lecture allégée                      | `find()` 20 lignes, réponse `{n}` |  1 068 |    936 |      2,5 % |
| Lecture complète                     | `find()` 20 lignes + JSON complet |  1 022 |    978 |      3,0 % |
| Cycle utilisateur — magasin mémoire  | session mémoire + lecture         |    983 |  1 017 |      0,6 % |
| Cycle utilisateur — SQLite           | session ORM + lecture             |    719 |  1 391 |      1,3 % |

Par soustraction :

| Poste                              |   Coût | Calcul                             |
| ---------------------------------- | -----: | ---------------------------------- |
| Pipeline nu                        |  86 µs | contrôle                           |
| Cycle de session **hors** ORM      |  17 µs | session mémoire − contrôle         |
| Reprise de session — part ORM      | 322 µs | session SQLite − session mémoire   |
| `find()` de 20 lignes via le dépôt | 850 µs | lecture allégée − contrôle         |
| Sérialisation JSON des 20 lignes   |  43 µs | lecture complète − lecture allégée |
| INSERT via le dépôt                | 666 µs | écriture − contrôle                |

**L'additivité a été vérifiée** : 979 + 322 + ~90 de zone = 1 391 µs, ce que rend effectivement la
marche complète. Un escalier dont les marches ne s'additionnent pas mesure autre chose que ce
qu'il prétend.

### Le profilage — la couche Nodefony est innocente

Profil échantillonné fenêtré sur trente secondes de charge, attribution par couche :

<!-- prettier-ignore -->
| Couche | % du CPU |
| --- | ---: |
| `drizzle-orm` — construction de la requête | **39,0** |
| pilote `drizzle` → `better-sqlite3` (préparation 9,4 + exécution 17,2) | **27,0** |
| Node interne | 5,5 |
| V8 (anonyme / natif) | 5,1 |
| `@nodefony/framework` | 4,8 |
| repos | 4,6 |
| `@nodefony/http` | 3,6 |
| V8 (programme / natif) | 3,1 |
| cœur `nodefony` | 2,9 |
| divers | 1,5 |
| ramasse-miettes V8 | 1,1 |
| `@nodefony/orm-core` | **0,9** |
| `@nodefony/security` + module de test + adaptateur | **0,8** |

**La couche d'abstraction ORM de Nodefony pèse moins de 2,5 % du CPU.** Ce n'est pas une bonne
nouvelle qu'on s'accorde : c'est un résultat qui **ferme** une piste. Optimiser l'adaptateur
n'aurait rien rendu.

Le détail par fonction désigne le vrai coupable :

| Fonction                              | Où                                      |    % |
| ------------------------------------- | --------------------------------------- | ---: |
| `is`                                  | `drizzle-orm/entity.js`                 | 17,8 |
| `values` (exécution + parcours natif) | `drizzle-orm/better-sqlite3/session.js` | 17,2 |
| `prepare`                             | `better-sqlite3/methods/wrappers.js`    |  9,4 |
| fonction anonyme                      | `drizzle-orm/utils.js`                  |  8,1 |
| `orderSelectedFields`                 | `drizzle-orm/utils.js`                  |  3,1 |
| rendu JSON du contrôleur              | `@nodefony/framework`                   |  2,8 |
| `writev` (écriture de la réponse)     | natif                                   |  2,0 |
| filtre `where` de l'adaptateur        | `@nodefony/drizzle`                     |  0,4 |

Le diagnostic tient en une phrase : **l'ORM refabrique et re-prépare la requête à chaque requête
HTTP**. La construction représente 39 % du CPU, la préparation 9,4 % — et l'exécution réelle, le
parcours de la base, seulement 17 %. On passe deux fois plus de temps à _décrire_ la requête qu'à
la _faire_.

### Le lot livré — mémoïser la requête préparée

### Le principe

Le dépôt calcule une **empreinte de forme** pour chaque requête : quels champs sont filtrés,
lesquels sont comparés à `null`, quel ordre de tri, y a-t-il une limite, un décalage. Cette forme
— et non les valeurs — sert de clé de cache. À la première occurrence, la requête est construite
puis **préparée une seule fois**. Ensuite, seules les valeurs sont re-liées à chaque exécution.

**Ce que ce cache ne fait pas**, et il faut le dire d'emblée parce que le mot « cache » inquiète à
raison : il ne mémorise **aucune donnée**. Il mémorise la **forme de la requête**. Les valeurs sont
re-liées à chaque appel, la base est interrogée à chaque appel, et les résultats sont toujours
lus depuis la base. Un test anti-obsolescence garde ce contrat et a été vu rouge en le débranchant.

Le chemin classique est conservé comme repli : disjonctions, opérateurs riches, valeurs
indéfinies, transactions. Le nombre de formes mémorisées est plafonné par dépôt.

### Le piège qui a coûté une session

`eq(colonne, sql.placeholder())` **nu court-circuite la conversion des valeurs vers le pilote** :
la fonction de liaison de drizzle exclut explicitement les emplacements réservés. Conséquence, un
tableau JSON était passé **brut** au pilote, qui levait une erreur de plage — vu rouge en test.

La forme correcte force la branche encodée. Ce contrat n'est écrit nulle part dans la
documentation officielle : il a été trouvé en lisant le **source de la bibliothèque** dans
`node_modules`, méthode par méthode, sur exigence explicite. La même lecture a rendu une seconde
découverte, qui change une conclusion (voir le tableau des dialectes ci-dessous).

### Ce que le lot rend, par moteur

Mesures A/B, paires alternées, protocole complet. **Ces chiffres valident le lot ; ils ne sont pas
une mesure de la performance actuelle du framework** — pour ça, voir l'état livré ci-dessous.

| Route                        | SQLite avant | SQLite après |  Gain | PostgreSQL avant | PostgreSQL après |  Gain |
| ---------------------------- | -----------: | -----------: | ----: | ---------------: | ---------------: | ----: |
| Lecture allégée              |        1 083 |        2 019 | +86 % |            1 017 |            1 640 | +61 % |
| Session + lecture (connecté) |          773 |        1 516 | +96 % |              642 |            1 021 | +59 % |

Détail des séries PostgreSQL, pour montrer la dispersion réelle :

| Route             | État  | Médianes de séries                                    | Retenu |
| ----------------- | ----- | ----------------------------------------------------- | -----: |
| Lecture allégée   | avant | 1 005,7 · 1 016,7 · 1 019,3 (étendue 1,3 %)           |  1 017 |
| Lecture allégée   | après | 1 655,0 · 1 639,0 · 1 625,6 · 1 640,6 (étendue 1,8 %) |  1 641 |
| Session + lecture | avant | 638,2 · 647,0 (étendue 1,4 %)                         |    647 |
| Session + lecture | après | 1 020,8 · 926,4 · 1 032,2 (étendue 10,4 %)            |  1 021 |

Aucun chevauchement entre avant et après, sur dix séries.

### Une attribution fausse, corrigée

Il était tentant d'expliquer le gain PostgreSQL par le **planificateur du serveur** : une requête
nommée est planifiée une fois, donc le serveur travaille moins. **C'est faux, et la mesure le
dit** : `pgbench` en mode simple contre le même en mode préparé ne rend que **+3,3 %**.

Le gain est **côté client**. Il était d'ailleurs déjà dans le profil, lu avant l'A/B :
construction 39 % + préparation 9,4 % du CPU JavaScript. L'explication par le planificateur a été
inventée en cours de session, puis retirée. Elle n'est pas republiée ici.

### Ce que « préparé » veut dire, dialecte par dialecte

Trois moteurs, trois mécanismes réellement différents — et le troisième contredit ce que
l'intuition suggère :

| Moteur         | Ce qui se passe réellement                                                           | Nature du gain            |
| -------------- | ------------------------------------------------------------------------------------ | ------------------------- |
| **SQLite**     | Instruction native compilée une fois, réutilisée                                     | compilation + JavaScript  |
| **PostgreSQL** | Requête **nommée** ; le plan est mis en cache **par connexion** du pool              | JavaScript, surtout       |
| **MySQL**      | Le pilote passe par `client.query()` — **aucune préparation au niveau du protocole** | **JavaScript uniquement** |

La conséquence pratique pour PostgreSQL : les requêtes nommées se compilent **par connexion**.
Le premier run d'une série est donc toujours le plus bas, et un échauffement de trente secondes
est obligatoire avant de mesurer. Ne jamais lire le premier run seul.

### Ce qui garde le lot

| Gate                              | Résultat                                        |
| --------------------------------- | ----------------------------------------------- |
| Suite du module ORM               | 425 tests verts                                 |
| Test dédié aux requêtes préparées | 11 cas — dont **4 vus rouges** au débranchement |
| Test anti-obsolescence            | vu rouge au débranchement                       |
| Intégration HTTP                  | 619 verts                                       |
| Porte mémoire                     | 9/9                                             |
| Vérification de types             | 0 erreur                                        |

Le test dédié espionne la méthode de préparation du pilote et **compte les compilations** : c'est
la seule façon de prouver qu'un cache **opère**, plutôt que de constater qu'il ne casse rien.

### Ce qui plafonne une route ORM

En rapprochant cette page de [la boucle d'événements](methode.md#la-boucle-dévénements--latence-et-blocage-sont-deux-grandeurs), le budget d'une
lecture PostgreSQL se décompose ainsi : 607 µs par requête, dont **~194 µs de pilote** — le coût
d'écrire et d'analyser le protocole sur le fil applicatif — et le reste en attente, qui ne coûte
rien tant qu'il y a d'autres requêtes à servir.

Autrement dit : après ce lot, **ce qui borne une route ORM n'est ni le framework ni la base, c'est
le pilote**.

## L'analyse initiale, et ce qu'elle avait faux

Le dossier a commencé par une **analyse statique** du pipeline, sans exécution : lecture du code,
comptage des appels, estimation des coûts. Elle a orienté le chantier, et elle s'est trompée sur
l'essentiel. La table ci-dessous est conservée telle qu'elle a été établie par le profilage
runtime — c'est la seule partie de ce rapport initial qui garde une valeur, et c'est la plus utile.

#

C'est la raison pour laquelle cette page est conservée. Le profilage runtime a tranché ainsi :

| Affirmation de cette page                | Verdict de la mesure                                              |
| ---------------------------------------- | ----------------------------------------------------------------- |
| En-têtes : 1,5–3 µs par requête          | **Sous-estimé d'un facteur 5** — ≈13–14 µs, c'était le levier n°1 |
| « Le reste est vraisemblablement le GC » | **Réfuté** — 0,93 %, sur trois instruments concordants            |
| Trois gardes zéro-listener côté kernel   | **Faux** — il n'y en avait qu'une                                 |
| Trois `Reflect.getMetadata` par requête  | **Faux** — deux                                                   |
| Nonce CSP                                | **Absent de cette page** — découvert au profilage, ≈1,7 % du CPU  |
| 22 ancrages `fichier:ligne`              | **14 exacts, 5 déplacés, 2 faux**                                 |

La leçon générale a été gravée dans la méthode : **une analyse sans exécution oriente, elle ne
prouve pas** — et tout pourcentage estimé se convertit en nanosecondes par une mesure avant
d'ouvrir un chantier.

## Ce qui reste ouvert

### La vision — pourquoi une page de limites fait partie du dossier

Un dossier de performance se juge moins à ses chiffres qu'à ce qu'il refuse d'affirmer.

Trois raisons rendent cette page nécessaire, et aucune n'est de la modestie. **La première** est
qu'un chiffre sans sa limite sera cité hors contexte : un débit PostgreSQL mesuré derrière une
virtualisation deviendra « la performance de PostgreSQL » dans la bouche du lecteur suivant.
**La deuxième** est qu'une piste écartée sans condition de réouverture se rouvre toute seule, plus
tard, par quelqu'un qui ignore qu'elle l'a été — et le travail est refait. **La troisième** est
que la liste des trous est la seule partie **vérifiable** d'un dossier de mesure : elle dit où
regarder pour le prendre en défaut.

### Les trous de mesure

### Le comparatif inter-frameworks n'a pas été rejoué sur l'état actuel

C'est le trou principal, et il est structurel dans la façon dont le chantier s'est déroulé.

Les rapports publiés dans [Face aux autres](#face-aux-autres--trois-niveaux-déquité) — ×3,23 face à `node:http` nu, ×2,82
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
([Le décor ment plus souvent que le code](methode.md#le-décor-ment-plus-souvent-que-le-code)).

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
[Dimensionnement](index.md).

### Les pistes écartées, avec leur condition de réouverture

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

### Les pistes ORM non entamées

| Piste                                     | État                                                                                                                                         |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Mise à jour et insertion-ou-remplacement  | Non mémoïsées. Hors du chemin chaud des bancs actuels ; à rejuger si un profil les réimpute                                                  |
| Index sur les clés étrangères au scaffold | **Question produit** : le générateur d'entités doit-il indexer les clés étrangères par défaut ? Le corpus de banc ne l'était pas             |
| A/B MySQL du lot préparé                  | Non mesuré. La lecture du source établit qu'il n'y a **aucune préparation au niveau du protocole** — le gain attendu est purement JavaScript |

### Un geste local en attente

Le remplacement d'un appel de correspondance par son équivalent direct dans le scan de routes vaut
**157 nanosecondes par requête**, strictement équivalent en sémantique. Seul, il ne justifie pas un
cycle complet de reconstruction, de tests d'intégration et de porte mémoire. Il attend d'être
embarqué dans un lot voisin.

C'est un exemple de la discipline générale du chantier : **un gain réel mais sous la résolution du
banc ne se publie pas, et ne se livre pas seul.**

### Ce qui ne sera pas optimisé, et pourquoi

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

### Comment contester un chiffre de ce dossier

Tous les bancs cités sont versionnés dans `.claude/skills/nodefony-load-test/`, avec leur
protocole, leurs variables d'environnement et leurs gardes. Chaque page indique l'instrument qui
produit ses chiffres.

Un chiffre publié se re-audite volontiers. La règle interne est explicite : **quand une mesure est
remise en question, c'est la mesure qu'on rejoue, pas l'argument qu'on renforce.** Deux verdicts
de ce dossier ont été requalifiés de cette façon, et l'un l'a été après une simple question posée
sur un calcul de débit.

## Lexique

Le vocabulaire général — débit, dispersion, blocage, structurel, accidentel — est défini dans
[Méthode de mesure](methode.md#lexique). Ci-dessous, ce qui est propre aux analyses.

| Terme                           | Ce qu'il désigne ici                                                                                                               |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Profil échantillonné**        | Relevé périodique de la pile d'appels. Il désigne des postes, il ne les chiffre pas à la microseconde près.                        |
| **Temps propre**                | Temps passé **dans** une fonction, hors de ses appelées. C'est ce qu'on additionne ; le temps total, non.                          |
| **Lecture ascendante**          | Attribution d'un poste à ses appelants réels, plutôt qu'à la fonction où l'échantillon est tombé.                                  |
| **Micro-banc**                  | Mesure d'un mécanisme isolé, hors du serveur. Précis sur la mécanique, optimiste sur le réel (tas froid, caches propres).          |
| **Sonde in-situ**               | Compteurs placés **dans** le serveur réel sous charge. L'arbitre entre un profil et un micro-banc.                                 |
| **Chemin rapide / repli**       | Traitement court quand l'entrée est triviale, retour au traitement complet sinon. La sûreté vit dans la condition de repli.        |
| **Motif de route**              | Expression régulière compilée à partir d'un chemin déclaré. Le scan consiste à en exécuter un par route candidate.                 |
| **Pré-filtre de préfixe**       | Test bon marché qui écarte une route avant d'exécuter son motif.                                                                   |
| **Équité d'un banc**            | Les deux participants font le **même travail** par requête. Sans elle, on mesure une différence de périmètre.                      |
| **Express « équipé »**          | Express plus les middlewares qui rendent le service que Nodefony rend par défaut.                                                  |
| **Travail dormant**             | Traitement qu'une cible pourrait exécuter sans qu'on le sache (session, audit, chronométrage). Prouvé absent des cibles comparées. |
| **Prix des fonctionnalités**    | Écart entre un serveur nu et le même serveur rendant le service. Il est payé quel que soit le framework.                           |
| **Recoupement croisé**          | Reproduire un résultat sur un système indépendant. Un gain qui se reproduit ailleurs n'est pas un artefact.                        |
| **Prédiction engagée**          | Résultat attendu écrit **avant** de mesurer. Il rend la mesure réfutable.                                                          |
| **Escalier**                    | Suite de routes n'ajoutant **qu'une** chose chacune. La différence entre deux marches est le coût de ce qu'on a ajouté.            |
| **Additivité**                  | Contrôle de validité d'un escalier : la somme des marches doit rendre la marche complète. Sinon on mesure autre chose.             |
| **Forme de requête**            | Ce qui identifie une requête indépendamment de ses **valeurs** : champs filtrés, comparaisons à `null`, tri, limite.               |
| **Requête préparée**            | Requête compilée une fois, exécutée ensuite avec des valeurs re-liées.                                                             |
| **Requête nommée** (PostgreSQL) | Forme de requête préparée dont le plan est mis en cache **par connexion** du pool — d'où l'échauffement obligatoire.               |
| **Emplacement réservé**         | Marqueur de valeur dans une requête préparée. Il court-circuite la conversion de valeurs s'il est employé nu.                      |
| **Repli**                       | Chemin de construction classique, conservé pour les cas que le cache de forme ne couvre pas.                                       |
| **Transposable**                | Se dit d'un chiffre qui garde son sens hors de son décor. Un rapport l'est souvent ; un absolu, rarement.                          |
| **Condition de réouverture**    | Le fait précis qui justifierait de reprendre une piste écartée. Sans elle, l'écartement ne tient pas.                              |
| **Métrique à rampe**            | Grandeur qui dérive au fil des répétitions d'une même série. Elle ne converge pas en trois runs.                                   |
| **Qualité d'ajustement** (R²)   | Mesure de la fidélité d'un modèle aux points observés. Trop basse, elle signale une **absence** de résultat.                       |
| **Socle structurel**            | Part du coût par requête qui relève de Node et de l'architecture, non d'un défaut d'implémentation.                                |

## Pièges

**Profilage et attribution.**

- **Un profil désigne un poste, il ne le dimensionne pas.** Trois fois sur ce chantier, un
  pourcentage de CPU occupé a surestimé un coût réel d'un facteur 25 à 30. Convertir en
  nanosecondes par un micro-banc **avant** d'ouvrir un chantier.
- **Un micro-banc isolé ment dans l'autre sens** — tas froid, sites d'appel monomorphes. L'arbitre
  est la sonde placée dans le serveur réel sous charge.
- **Un champ de classe masque un accesseur de sous-classe.** Conséquence directe de la sémantique
  des champs de classe : ils sont des propriétés propres de l'instance.
- **Un pré-filtre inerte passe tous les tests de non-régression.** Il faut un test qui prouve que
  le filtre **opère**, pas seulement qu'il ne casse rien.

**Comparaison entre frameworks.**

- **Un banc de framework se fausse par le décor avant de se fausser par le code.** Les apps de
  comparaison vivent dans un bac à sable isolé, avec leur propre arbre de dépendances, pour ne pas
  emprunter au dépôt une version différente de celle qu'elles annoncent — et le banc **refuse de
  mesurer** si l'installé ne correspond pas au déclaré.
- **Un échauffement donné à l'un et pas à l'autre inverse un classement serré.** Les deux scripts
  de banc partagent le même protocole et doivent rester alignés.
- **Fastify est mesuré sans son sérialiseur rapide**, comme les autres, pour comparer la même
  opération. Avec, il irait plus vite — c'est une option, pas le défaut.
- **Une comparaison entre deux fenêtres n'existe pas.** Les lignes d'un même tableau viennent de
  la même fenêtre de mesure ; aucune ne se compare à une ligne d'un autre tableau.
- **Un camp plus rapide que le serveur nu de référence est un signal d'alarme**, pas un exploit :
  au-delà d'un certain débit, le générateur de charge entre en concurrence avec le serveur sur les
  mêmes cœurs, et c'est lui qu'on mesure.

**Bases de données.**

- **Le mot « cache » sans son périmètre déclenche à raison une inquiétude.** Dire d'emblée ce
  qu'un cache ne mémorise **pas**, et livrer le test anti-obsolescence avec le lot.
- **La documentation officielle d'une bibliothèque montre l'API, pas ses contrats.** Deux
  découvertes de ce chantier — l'exclusion des emplacements réservés par la fonction de liaison,
  et l'absence de préparation au niveau du protocole MySQL — ne sont écrites que dans le source.
- **Le premier run d'une série PostgreSQL est structurellement bas** (compilation par connexion du
  pool). Échauffement obligatoire, et ne jamais lire un run isolé.
- **À 128 connexions sur un magasin synchrone, on mesure une file d'attente**, pas un débit.
- **Une base en conteneur ne se compare pas à une base en processus.** Sur ce dépôt, le seul
  chemin virtualisé vaut un facteur 3,7 — mesurer PostgreSQL derrière une machine virtuelle, c'est
  mesurer l'hyperviseur.
- **Une table sans index sur ses clés étrangères** fausse la lecture du profil : une part du
  parcours natif est du travail que l'application aurait pu éviter. C'est une question de schéma
  d'application, pas de framework.

**Publication d'un résultat.**

- **Un chiffre publié sans sa limite sera cité sans elle.** Chaque absolu porte donc la réserve qui
  le borne, dans la même page que le chiffre — jamais renvoyée à une note de fin.
- **Une piste écartée sans condition de réouverture n'est pas écartée**, elle est oubliée — et
  redécouverte à grands frais.
- **Une mesure qui ne s'ajuste pas n'est pas une mesure imprécise**, c'est une absence de résultat.
- **Une absence de régression n'est pas un gain.**
- **Un gain réel mais sous la résolution du banc ne se publie pas** — et ne se livre pas seul.

## Pour aller plus loin

- ⬆️ **Retour au hub** : [Performance](index.md) — les chiffres et ce qu'ils valent
- 📐 [Méthode de mesure](methode.md) — le protocole, les instruments qui ont menti, les deux grandeurs
- 🧰 Outillage : `.claude/skills/nodefony-load-test/` — bancs, protocoles, scripts rejouables
