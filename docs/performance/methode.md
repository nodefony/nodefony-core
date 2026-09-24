---
title: "Méthode de mesure — comment un chiffre devient une mesure"
navTitle: Méthode de mesure
updated: 2026-09-14
lang: fr
module: "global"
topic: perf-methode
section: "Performance"
audience: [developer]
tags:
  [
    performance,
    methode,
    benchmark,
    protocole,
    mesure,
    instruments,
    boucle-evenements,
  ]
status: stable
source: ".claude/skills/nodefony-load-test/"
tests: none
---

📍 [Documentation](../index.md) › [Performance](index.md) › **Méthode de mesure**

> Un banc rend toujours un nombre. Il le rend même quand le serveur est éteint, même quand la
> machine est bridée, même quand l'instrument mesure sa propre granularité. Cette page décrit ce
> qui sépare ce nombre d'une **mesure** : le décor, les contrôles de validité, les critères
> décidés **avant** de regarder le résultat, et le vocabulaire qui permet de lire les autres
> pages du dossier sans se tromper de grandeur.
>
> Elle porte aussi les **instruments qui ont menti** et les **deux grandeurs qu'on confond** —
> latence et blocage. Ce ne sont pas des annexes : ce sont les deux sources de verdicts faux les
> plus fréquentes de ce dossier.

## Le modèle — ce qu'on mesure, et pourquoi ce n'est pas « la vitesse de Nodefony »

Nodefony est un framework de **runtime**. Ce qui l'intéresse n'est pas un record, c'est le
**travail effectué par requête** : combien d'objets sont construits, combien d'appels système
sont payés, combien de microsecondes de CPU sont consommées pour rendre une réponse. Le débit
n'est qu'une façon commode de lire ce travail à l'envers.

D'où le dispositif retenu, et ses trois choix :

**Un seul processus.** Un serveur mono-processus sous charge est **borné par le CPU**
(~119 % d'un cœur observé). Son débit reflète donc directement le coût par requête : diviser
une optimisation par le nombre de cœurs la rendrait invisible. Un banc en cluster mesure autre
chose — la co-location du générateur de charge et des workers sur la même machine — et ne sait
pas montrer un gain de CPU par requête.

**Une cible dédiée.** `GET /nodefony/kernel/bench` est un controller ordinaire qui rend un objet
**figé** (`Object.freeze`, donc zéro allocation par requête), sur un chemin **hors de l'aire
d'administration**. Elle emprunte le trajet complet d'une route applicative — routage, contexte,
sécurité, sérialisation, écriture — et **rien de plus**. Elle n'existe que sous `NF_BENCH_ROUTE=1` :
aucune surface n'est ajoutée en production par défaut.

Ce choix se paie d'une discipline : on ne lui substitue pas une route qui passerait pour
équivalente. `/nodefony/kernel/api/livez` ajoute une résolution de zone, un authentificateur, le
broker d'administration et un rapport de démarrage dans le handler. Une route d'un module de
développement, elle, **n'existe pas en production** — et un 404 répond plus vite qu'une vraie
réponse, donc il améliore le score.

**Des rapports, pas des absolus.** Le générateur de charge tourne sur la même machine que le
serveur. Les valeurs absolues sont donc basses pour **tous** les participants, y compris les
points de comparaison. Seuls les rapports entre eux sont exploitables, à décor identique et dans
la même fenêtre de mesure.

## Le décor

Commun à toutes les mesures du dossier :

|                      |                                                                  |
| -------------------- | ---------------------------------------------------------------- |
| Processeur           | Intel Core i9-8950HK @ 2,90 GHz — 6 cœurs physiques, 12 logiques |
| Mémoire              | 32 Go                                                            |
| Système              | macOS 15.7.7 (Darwin 24.6)                                       |
| Serveur              | mono-processus, `NODE_ENV=production`, boucle locale             |
| Journalisation       | `NF_LOG_DRIVER=null` pendant la mesure                           |
| Générateur de charge | `wrk` 4.2.0 `[kqueue]`, `-t4`                                    |

Et ce qui **change d'une famille de bancs à l'autre** — parce qu'une comparaison ne vit qu'à
l'intérieur d'une famille :

| Famille de bancs               | Node    | Charge        | Cible                                      | Table de routes |
| ------------------------------ | ------- | ------------- | ------------------------------------------ | --------------- |
| Pipeline HTTP (A/B et profils) | v26.5.0 | `-c128`, 10 s | cible de banc du framework                 | 136             |
| Comparatif de frameworks       | v26.5.0 | `-c128`, 10 s | route équivalente répliquée par chaque app | 186             |
| ORM et bases de données        | v26.7.0 | `-c25`, 7 s   | routes de banc ORM, corpus réaliste        | 186             |

> **Machine portable de 2018, sujette au bridage thermique.** C'est un défaut pour publier des
> absolus, et un avantage pour concevoir un protocole : tous les pièges de mesure s'y manifestent
> avec une amplitude qu'une machine de salle serveur masquerait. Plusieurs gardes décrites plus
> bas n'existent que parce que cette machine les a rendues nécessaires.

> **Pourquoi 25 connexions sur les bancs ORM et 128 sur le pipeline.** Au-delà de la saturation,
> la concurrence supplémentaire ne produit plus du débit mais de la file d'attente — et sur un
> magasin synchrone, elle produit des expirations. Mesurer une route ORM à 128 connexions revient
> à mesurer une file. Le détail est dans [la boucle d'événements](#la-boucle-dévénements--latence-et-blocage-sont-deux-grandeurs).

## Les contrôles de validité

### La règle qui précède toutes les autres

> **Un banc qui ne vérifie pas que le travail a eu lieu mesure la vitesse à laquelle on échoue.**

Ce n'est pas une précaution théorique. Un banc de ce dépôt annonçait **1 626 requêtes par seconde
sur un port fermé** : les requêtes étaient comptées au lancement, pas au succès. Rien dans le
chiffre ne paraissait anormal — c'est exactement ce qui le rendait dangereux. Une erreur revient
plus vite qu'une vraie réponse : **échouer améliore le score**, sur le débit comme sur les
percentiles.

Tout banc du dépôt doit donc :

1. **prouver la cible avant de mesurer** — code HTTP attendu, corps attendu, ou volume attendu ;
2. **prouver le travail pendant la mesure** — réponses hors 2xx/3xx signalées par `wrk`, octets
   réellement écrits, messages réellement reçus ;
3. **ne compter que le succès**, dans le débit comme dans les percentiles ;
4. **refuser de conclure sous la variance** — deux mesures à 21 et 23 ms avec 27 % de dispersion
   ne se classent pas, et le banc doit l'écrire ;
5. **sortir en code d'erreur quand rien n'a été mesuré** — un banc muet ne doit pas ressembler à
   un banc réussi.

Un corollaire a coûté cher avant d'être formulé : **un contrôle de cible qui échoue doit arrêter
la série, pas l'imprimer**. Une campagne entière a mesuré ~5 500 réponses `401` par run parce que
la ligne « cible : 401 » s'affichait sans interrompre quoi que ce soit — le cookie de session
avait expiré pendant une campagne longue.

### Le protocole A/B

Une optimisation du pipeline se juge par **paires alternées** : `old1`, `new1`, `old2`, `new2`.
L'alternance annule la dérive de la machine sur la durée de la série ; deux paires permettent de
voir si la direction du gain est stable ou si elle change de signe.

Chaque run comprend un **échauffement non compté** (le compilateur à la volée de V8 a besoin de
quelques secondes), puis trois mesures dont on garde la **médiane**, avec publication du
minimum, du maximum et de la **dispersion**. Une série dont la dispersion dépasse 3 % est
**refusée** : un seuil de décision ne peut pas trancher dans une fenêtre plus bruyante que lui.

Le verdict a **trois issues, jamais deux** :

| Issue                             | Condition                                                            | Ce qu'on en fait                                         |
| --------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------- |
| **Gain net**                      | les deux `new` au-dessus des deux `old`, sans chevauchement, > bruit | on garde et on publie le chiffre                         |
| **Structurel gardé en le disant** | médiane favorable mais chevauchement des séries                      | on garde pour l'argument mécanique, **sans revendiquer** |
| **Rejet**                         | directions opposées entre paires, ou moyenne dans le bruit           | on **annule** le lot                                     |

Le critère est **engagé avant la mesure**. C'est ce qui a permis de rejeter un lot entier
(`F-D`, décrit dans [le pipeline HTTP](analyses.md)) après l'avoir écrit, testé et prouvé
correct : son A/B rendait des directions opposées entre deux paires, moyenne −0,4 %. Le code a
été annulé.

### Les gardes de décor

Elles ne sont pas des précautions de principe : chacune est née d'un verdict faux.

| Garde                            | Ce qu'elle empêche                                                                                       |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Régime CPU** (`cpuRegime`)     | Comparer une fenêtre bridée à une fenêtre libre — écart mesuré ×1,62 **à code identique**                |
| **Niveau thermique**             | Comparer un run à froid à un run après vingt minutes de charge — la chaleur peut **inverser** un verdict |
| **Indexation Spotlight** (`mds`) | Mesurer pendant qu'un processus système réindexe les fichiers reconstruits (11–22 % de CPU par vagues)   |
| **Hyperviseur éteint**           | Mesurer sur une machine partagée avec une machine virtuelle — la garde a dû être élargie, voir plus bas  |
| **Purge des résultats**          | Laisser un résultat d'un autre lot entrer dans une comparaison qui ne le concerne pas                    |
| **`LC_ALL=C`**                   | Une locale française rendant « 4,1 » là où le script attend « 4.1 » — garde numérique **muette**         |
| **Un seul serveur**              | Un superviseur résiduel qui tient le port et fait échouer le démarrage du serveur mesuré                 |

Le détail de ce que chacune a rattrapé est raconté dans
[Le décor ment plus souvent que le code](#le-décor-ment-plus-souvent-que-le-code).

#### La garde qui parlait des conteneurs, et qu'il a fallu élargir

Cette table a longtemps porté « **Docker arrêté** — mesurer pendant qu'un conteneur inactif
consomme 64 % du CPU ». C'était vrai, et insuffisant : **arrêter les conteneurs ne rend pas les
vCPU**. La machine virtuelle qui les héberge continue de réserver ses cœurs à vide.

Le cas a été payé en établissant la référence de la version 10. Tous les conteneurs arrêtés, la
charge moyenne de l'hôte au repos, une paire de camps mesurée en entier avec des dispersions
intra-série **parfaites** — 0,5 % et 1,5 %. Le seul instrument à l'avoir vu était le banc de tenue
dans la durée, qui **constate** l'hyperviseur au lieu de le déduire :

> ⚠ hyperviseur ACTIF — 8 vCPU réservés sur 12 cœurs.

Rejouée hyperviseur éteint, la paire ne déplace pas seulement les absolus : elle déplace le
**rapport entre les deux camps**, de 89,8 % à 88,3 %, la virtualisation pénalisant plus le camp
témoin que le nôtre. Une comparaison entre moteurs prise derrière un hyperviseur n'est donc pas
« un peu optimiste » : elle est **fausse dans son résultat même**.

La garde est désormais portée par `scripts/machine-regime.sh` — implémentation unique, partagée
par tous les bancs de paires — et le constat entre dans le décor de chaque série, à côté du
régime CPU et du niveau thermique.

#### Un processus tué n'est pas un arbre tué

Le banc de tenue a été interrompu par un signal envoyé à son processus. Le générateur de charge
qu'il avait lancé, lui, a survécu : **308 % de CPU** consommés par un `wrk` orphelin, prêt à
fausser toute mesure suivante sans qu'aucun compteur ne le signale. On tue un arbre, jamais un
processus — et on le **constate** avant de mesurer, plutôt que de le supposer.

## Le décor ment plus souvent que le code

> Cette partie était une page à part. Elle vit ici parce qu'elle n'est pas une annexe : sur ce
> dossier, les verdicts faux sont venus **plus souvent de l'instrument et du décor que du code
> mesuré**. La lire après le protocole, c'est comprendre pourquoi chaque garde existe.

### La vision — pourquoi cette page existe

Un chiffre faux ne ressemble pas à un chiffre faux. Il ressemble à un résultat.

Pire : les fenêtres de mesure les plus **stables** ont produit les résultats les plus **faux**. Un
processeur bridé tient un plafond bas sans effort — dispersion parfaite, verdict erroné d'un
facteur 1,62. La stabilité d'une série n'est pas un gage de justesse ; c'est seulement un gage de
répétabilité.

D'où la règle qui organise tout le reste : **l'instrument est le premier suspect, jamais le code
qu'il juge.** Et son corollaire, plus dur : **suspecter son propre diff** — la ligne qui échoue est
souvent celle qu'on vient d'ajouter.

### Les quatre instruments faux — une seule question

La question était : « qui bloque la boucle d'événements, SQLite ou PostgreSQL ? ». Quatre
instruments y ont répondu, tous faux, tous du même vice — mesurer autre chose que ce qu'on croit.

### 1. Un minuteur pour mesurer un blocage court

Un `setInterval` de deux millisecondes plus un `setTimeout(0)` entre les requêtes. Node **borne un
délai de zéro à environ une milliseconde** : on ne mesure pas le blocage, on mesure la granularité
du minuteur.

Verdict produit : « SQLite bloque 0,43 ms » pour une requête de 33 µs. **Facteur 13.**

### 2. `monitorEventLoopDelay`, dont la résolution est le problème

Cet outil a une résolution de l'ordre de la milliseconde. Un blocage de quelques dizaines de
microsecondes lui est **invisible** : il rendait son propre plancher pour les **deux** pilotes,
donc « aucune différence ».

### 3. Une colonne qui répondait sans avoir mesuré

Un tableau portait la colonne « bloque la boucle ? » et la valeur « non ». Cette valeur n'était
issue d'**aucune mesure** : c'était une déduction, présentée dans la forme d'un résultat.

C'est le plus dangereux des quatre, parce qu'il ne ressemble pas à une erreur — il ressemble à une
réponse. **Un banc qui n'a pas mesuré doit se taire, pas répondre « non ».**

### 4. `process.cpuUsage()` lu comme « le CPU du fil principal »

Il compte **tous** les fils, ramasse-miettes compris. C'est un majorant, jamais un plafond de
débit : sur une réponse volumineuse, il a rendu **110 % du temps mural**.

### Ce qui a fini par trancher

Pas un cinquième instrument fin : un **changement d'ordre de grandeur**. Armer un rappel avant la
requête et regarder quand il part, sur une requête d'une demi-seconde. À cette échelle, aucun
défaut d'instrument n'intervient — et la réponse est nette (voir
[la boucle d'événements](#la-boucle-dévénements--latence-et-blocage-sont-deux-grandeurs)).

> **Quand plusieurs mesures fines se contredisent, changer d'échelle plutôt que d'instrument.**

### Les deux explications réfutées — dont la correction de la première

Les deux étaient de nous. La seconde a été écrite **pour corriger** la première, et elle était
fausse aussi.

**Explication n°1 — « le round-trip réseau PostgreSQL est incompressible dans chaque requête ».**
Réfutée : l'attente réseau **ne consomme pas la boucle**, elle se masque par la concurrence. Ce
qui borne un processus est le CPU de boucle, et il se mesure.

**Explication n°2 — « c'est PostgreSQL qui sature ».** L'argument semblait solide : le conteneur
montait à 460 % de CPU, ce qui « concordait » avec un `EXPLAIN ANALYZE` à environ une milliseconde.

C'était une **coïncidence de deux erreurs** :

- ce ~1 ms était le **premier plan d'une session** fraîchement ouverte ; à chaud, la planification
  vaut 0,02 à 0,06 ms ;
- 460 % n'est pas une saturation : la machine virtuelle dispose de **8 processeurs virtuels sur
  6 cœurs physiques**, et un serveur réellement saturé monterait le conteneur à ~800 %.

Trois réfutations indépendantes ont réglé la question — et aucune n'est une mesure de plus, ce
sont des **questions posées à la base elle-même** :

| Question posée                                         | Comment                                             | Réponse                                      |
| ------------------------------------------------------ | --------------------------------------------------- | -------------------------------------------- |
| Les connexions travaillent-elles, ou attendent-elles ? | `pg_stat_activity` pendant la charge                | **40 sur 40 en attente du client**           |
| La base est-elle au bout d'elle-même ?                 | `pgbench` **dans** le conteneur, même requête       | **16 222 transactions/s** (~4 400 de l'hôte) |
| Est-ce une butée de ressource ?                        | le « plafond » varie de 4 400 à 6 500 selon le jour | congestion molle, pas une butée              |

### Le coupable réel — la virtualisation réseau, pas la base

Le plafond mesuré n'était ni la base de données, ni le framework : c'est le **chemin réseau
virtualisé de Docker Desktop sur macOS**.

| Élément mesuré pendant la charge  | Valeur                    |
| --------------------------------- | ------------------------- |
| Machine virtuelle, vue de l'hôte  | ~685 % (plafond pratique) |
| Proxy `com.docker.backend`        | ~152 %                    |
| Processus Node                    | ~50 %                     |
| Enveloppe disponible              | 6 cœurs physiques         |
| **Facteur intérieur / extérieur** | **3,7**                   |

**Conséquence pour tout ce dossier, et elle est stricte** : aucun **absolu** PostgreSQL mesuré ici
n'est transposable. Les comparaisons A/B à l'intérieur d'une fenêtre restent valides — le même
décor s'applique des deux côtés — mais l'écart mesuré entre SQLite et PostgreSQL **n'est pas une
propriété de ces deux moteurs**. Sur un déploiement Linux natif, ce plafond n'existe pas.

Une faute d'instrument mérite d'être notée ici, parce qu'elle est tentante : un aller-retour TCP
nu en boucle locale (~74 µs) **ne traverse pas Docker**. S'en servir pour attribuer une part du
coût au chemin virtualisé ne décompose rien. Cette erreur a été commise.

### Le décor machine — sept gardes, sept verdicts faux évités

Chacune de ces gardes existe parce qu'un résultat faux l'a rendue nécessaire.

### Le régime du processeur — ×1,62 à code identique

macOS active le mode basse consommation **tout seul** sur batterie, et bride l'accélération du
processeur. Mesuré : **7 800 contre 12 600 requêtes par seconde sur un code identique**.

Le plus troublant est que **les deux séries étaient impeccables** — dispersions de 0,4 % et 1,6 %.
Le niveau thermique ne le voit pas : les deux paires partaient de la même valeur. Seule la lecture
du régime d'alimentation le révèle.

La garde lit désormais l'alimentation **et** le mode basse consommation (qui peut aussi être forcé
à la main sur secteur), l'affiche à chaque run et l'écrit dans les données de sortie. **Comparer
deux médianes de régimes différents est faux.** Garde éprouvée dans quatre états.

### La chaleur — elle peut inverser un verdict

Sur secteur, la rampe thermique atteint une vingtaine de points en trois runs de dix secondes. Une
série partant à 43 finit à 60, et le troisième run décroche.

Concrètement : une paire mesurée à chaud rendait **−2 %** là où la paire à froid disait **+10 %**.
Tout run partant d'un niveau thermique supérieur à ~45 est jeté, et l'attente de refroidissement
se fait **avant** la série.

### L'indexation système — des vagues invisibles

Chaque reconstruction complète réécrit des milliers de fichiers, et l'indexeur de recherche macOS
réindexe **par vagues** de 11 à 22 % de CPU. Il a fait refuser trois séries sur sept, à niveau
thermique pourtant parfait.

La garde attend un niveau thermique acceptable **et** un indexeur sous 2 % **sur deux contrôles
espacés de trente secondes** — une vague repart d'un coup. Avec la double garde : 0,7 à 1,0 % de
dispersion.

### La veille douce — une pause longue coûte 13 %

Au-delà de deux minutes d'inactivité, le processus détaché est mis en veille douce par le système.
Le run suivant paie **−13 %**, reproduit trois fois sur trois. Le refroidissement se fait donc
**avant** la série, jamais entre les runs, et l'échauffement est doublé après une attente.

### La locale — une garde numérique muette

Une locale française fait rendre « 4,1 » là où le script attend « 4.1 ». La comparaison de
dispersion devient **muette entre 3 et 4 %** : elle n'échoue pas, elle ne dit rien.

Ce piège a été gravé dans un script, puis **reproduit à l'identique** dans un script de garde
écrit ensuite — il produisait cette fois une attente infinie sur un décor parfait. D'où la règle :
`LC_ALL=C` en tête de **tout** script de banc, par réflexe d'ouverture et non par correctif.

> Une leçon gravée dans **un** artefact ne protège pas le suivant. C'est vrai des scripts, et
> aussi des documents : le script portait les quatre pièges d'instrument dans son en-tête, quand
> le document du kit n'en disait rien — donc invisible à qui lit le kit sans ouvrir le dossier des
> scripts.

### L'agent qui pilote le banc fait partie du décor

Trois séries de contrôle ont été refusées pour dispersion excessive. Le pollueur était le
**processus qui pilotait la mesure**, à 32 % de CPU. Seules les marches limitées par le processeur
le voient ; les marches sérialisées par l'attente restent propres.

### Un serveur résiduel, un port qui ne se libère pas

Un superviseur de développement dont le titre de processus avait été renommé échappait au filtre
de terminaison et tenait le port. Le serveur mesuré ne démarrait pas — et un banc qui mesure un
serveur qui n'est pas celui qu'on croit ne s'annonce pas.

### Deux pièges d'outillage, pour finir

**Une commande absente n'est pas un verdict.** Sur macOS nu, `timeout` n'existe pas : le code de
retour 127 signifie « commande introuvable ». Lu comme un résultat, il a produit **deux faux
diagnostics d'un coup** — un démarrage déclaré mort et une garde déclarée confirmée.

**Un mode machine ne doit jamais couper le canal d'erreur.** Une sortie en mode JSON rendait une
commande **muette** en cas d'échec : zéro octet, erreur standard vide, code 1. Et une variable qui
désactive la journalisation a rendu muet un plantage au démarrage d'un banc — deux lignes de
journal, processus mort sans un mot. Un décor de banc se démarre **avec** son journal ; on ne
coupe la journalisation qu'au moment de mesurer.

### La méthode qui a fini par payer

Les deux explications fausses ont été renversées par des **audits adversariaux** confiés à un
agent en lecture seule. Ce qui a fait la différence n'est pas l'outil, ce sont les quatre
consignes :

1. **Donner son angle mort explicitement** — « 460 % ne prouve la saturation que si la machine
   virtuelle a 4 ou 5 cœurs, et je ne l'ai pas vérifié ».
2. **Exiger la commande et sa sortie pour chaque affirmation.**
3. **Faire distinguer ce qui est mesuré, déduit, et supposé.**
4. **Demander une explication concurrente**, et la faire valider ou écarter.

Les deux passes ont chacune renversé une conclusion, et la seconde a corrigé la première. Elles
ont aussi trouvé ce qu'aucune relecture n'avait vu : un banc qui publiait « ~173 762 requêtes par
seconde » sur une **table vide**, en sortant avec un code de succès.

## La boucle d'événements — latence et blocage sont deux grandeurs

> Deuxième source de verdicts faux, et la plus coûteuse : confondre le temps qu'une requête
> **attend** avec le temps pendant lequel elle **empêche** le processus de travailler. Une seule
> des deux plafonne un processus.

### Le modèle — un fil, deux grandeurs

Node exécute le code applicatif sur **un seul fil**. Tout ce qui s'y passe est sérialisé : pendant
qu'une fonction s'exécute, aucune autre requête n'avance.

De là, deux grandeurs qu'on confond spontanément :

- La **latence** est le temps d'attente d'une réponse. Elle se mesure à la montre.
- Le **blocage** est le temps pendant lequel la boucle d'événements **ne peut rien faire d'autre**.

Elles n'ont pas les mêmes conséquences. La latence dégrade l'expérience d'**une** requête ; elle
se masque par la concurrence, puisque le serveur sert d'autres requêtes pendant l'attente. Le
blocage, lui, **plafonne le processus tout entier** : c'est du temps que personne d'autre ne peut
utiliser.

**C'est le blocage qui borne un débit, jamais la latence.** Cette phrase paraît évidente écrite
ainsi ; elle a coûté deux explications fausses avant d'être formulée.

### La preuve — un rappel armé avant la requête

L'expérience est simple et se lit sans instrument fin : on arme un rappel (`setImmediate`) **juste
avant** de lancer une requête, puis on regarde **quand il part**. Si la boucle est bloquée, il
attend ; si elle est libre, il part immédiatement.

| Pilote                       | Durée de la requête | Retard du rappel | Verdict              |
| ---------------------------- | ------------------: | ---------------: | -------------------- |
| SQLite (`better-sqlite3`)    |              133 ms |       **134 ms** | **bloque** la boucle |
| PostgreSQL (`pg_sleep(0.5)`) |              503 ms |      **0,22 ms** | ne bloque **pas**    |

L'effet est à l'échelle de la **centaine de millisecondes**. À cette échelle, aucune erreur
d'instrument fin n'intervient : c'est la seule pièce du dossier que deux audits successifs n'ont
pas entamée.

SQLite exécute la requête **sur le fil applicatif** : sa latence **est** son blocage. PostgreSQL
attend le réseau, et cette attente ne consomme rien.

> **La leçon d'instrument.** Quand quatre mesures fines se contredisent, il ne faut pas changer
> d'instrument — il faut **changer d'ordre de grandeur**. Une demi-seconde de sommeil provoqué
> côté serveur rend visible à l'œil nu ce que des sondes à la microseconde n'arrivaient pas à
> départager.

### Ce qu'un pilote coûte vraiment

La conséquence pratique est qu'il faut mesurer, pour chaque pilote, non pas sa latence mais le
**CPU de boucle** qu'il consomme par requête — le temps pendant lequel il occupe le fil unique
à écrire une requête, analyser un protocole, construire des objets de résultat.

Mesures sur trois séries de 400 lectures de 20 lignes, avec l'instrument versionné
`db-backend-cost.mjs` :

| Pilote                | Latence par requête | CPU de boucle par requête | Plafond théorique d'un processus |
| --------------------- | ------------------: | ------------------------: | -------------------------------: |
| SQLite synchrone      |               22 µs |                 **24 µs** |               ~41 700 requêtes/s |
| PostgreSQL asynchrone |            1 232 µs |                **194 µs** |                ~5 100 requêtes/s |

**C'est ce CPU huit fois supérieur qui explique l'écart de débit, pas le réseau.** Écrire puis
analyser le protocole d'un serveur de base de données coûte du travail sur le fil applicatif, et
ce travail-là ne se masque pas.

Le recoupement avec le banc réel tient : sur la route de lecture, PostgreSQL rend 1 647 requêtes
par seconde, soit 607 µs par requête, dont ~194 µs de pilote — **environ 32 % du budget**.

### Le renversement — un pilote synchrone peut être plus rapide, jusqu'à un certain point

Il en découle un résultat contre-intuitif, et important pour choisir un magasin de sessions :

**Un pilote synchrone court peut rendre plus de requêtes par seconde qu'un pilote asynchrone
coûteux.** Vingt-quatre microsecondes de blocage laissent passer 41 700 requêtes par seconde ;
194 µs de travail asynchrone n'en laissent passer que 5 100.

**Et il s'effondre dès que la concurrence dépasse ce qu'un fil sérialise.** Sur une vraie table,
via l'ORM, le blocage ne vaut plus 22 µs mais ~850 µs. À 128 connexions simultanées, la file
dépasse deux secondes et le générateur de charge enregistre 29 à 35 expirations par run. La
médiane reste correcte ; le 99ᵉ centile explose.

C'est pour cette raison que les bancs ORM de ce dossier sont mesurés à **25 connexions** et non à
128 : au-delà, on ne mesure plus un débit, on mesure une file d'attente.

| Situation                                          | Ce qui plafonne         | Ce qu'il faut regarder |
| -------------------------------------------------- | ----------------------- | ---------------------- |
| Pilote synchrone, requêtes courtes, peu de monde   | rien, c'est très rapide | le débit               |
| Pilote synchrone, vraie requête, forte concurrence | la sérialisation        | **le p99**             |
| Pilote asynchrone                                  | le CPU de protocole     | le débit               |

**Conséquence produit** : SQLite reste excellent pour un déploiement mono-nœud à charge modérée,
et c'est le défaut de développement du framework. Dès qu'il y a plusieurs nœuds — ou de la
concurrence réelle sur une table vivante — un magasin asynchrone est le bon choix, et l'argument
n'est pas « c'est plus rapide » mais « ça ne sérialise pas ».

## Lexique

| Terme                              | Ce qu'il désigne ici                                                                                                                                              |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RPS**                            | Requêtes servies par seconde, succès uniquement. Toujours accompagné de son décor.                                                                                |
| **µs/req**                         | Budget d'une requête, soit `1 000 000 / RPS`. C'est la grandeur qu'on additionne et qu'on décompose ; le RPS, non.                                                |
| **p50 / p99**                      | Latences médiane et au 99ᵉ centile. Le p99 dit ce que subit la requête malchanceuse — il révèle la sérialisation là où la moyenne la cache.                       |
| **Dispersion**                     | `(max − min) / médiane` sur les runs d'une série. Au-delà de 3 %, la série ne tranche rien.                                                                       |
| **Séparation**                     | Les deux séries d'un camp toutes deux au-dessus des deux séries de l'autre. Sans elle, un écart de médianes ne classe rien.                                       |
| **Concordance inter-séries**       | Écart entre les médianes de deux séries indépendantes. Critère de repli quand la dispersion intra-série est structurellement impassable.                          |
| **Niveau thermique**               | `machdep.xcpm.cpu_thermal_level` sur macOS — indicateur du bridage en cours. Une série qui chauffe peut **inverser** un verdict.                                  |
| **Régime CPU**                     | Secteur, batterie, ou mode basse consommation. macOS l'active **seul** sur batterie et bride l'accélération du processeur — facteur 1,62 mesuré à code identique. |
| **Hyperviseur**                    | Machine virtuelle active sur l'hôte. Elle réserve des cœurs **même sans conteneur en marche**, et la charge moyenne ne la voit pas.                               |
| **Veille douce**                   | Mise en sommeil d'un processus inactif par le système. Elle coûte ~13 % au run suivant.                                                                           |
| **ELU** (_event loop utilization_) | Part du temps où la boucle d'événements travaille au lieu d'attendre. Un ELU à 1,00 dit « saturé » ; c'est la mesure de saturation, jamais `ps`.                  |
| **Boucle d'événements**            | Le fil unique qui exécute le code applicatif. Tout ce qui s'y passe est sérialisé.                                                                                |
| **CPU de boucle**                  | Temps de calcul qu'une opération consomme **sur ce fil**. C'est lui qui plafonne un processus.                                                                    |
| **Blocage**                        | Temps pendant lequel la boucle d'événements **ne peut rien faire d'autre**. C'est cette grandeur qui plafonne un processus.                                       |
| **Latence**                        | Temps d'attente d'une réponse. Elle **ne plafonne rien** si elle se passe hors de la boucle.                                                                      |
| **Pilote synchrone**               | Il exécute la requête sur le fil applicatif : sa latence **est** son blocage.                                                                                     |
| **Pilote asynchrone**              | Il rend la main pendant l'attente : son attente ne coûte aucun débit tant qu'il reste du travail à servir.                                                        |
| **Rappel armé**                    | Un `setImmediate` programmé avant l'opération à juger. Son **retard** mesure le blocage, sans instrument fin.                                                     |
| **Sérialisation**                  | Mise en file de requêtes derrière une opération bloquante. Elle épargne la médiane et détruit le 99ᵉ centile.                                                     |
| **Plafond théorique**              | `1 s ÷ CPU de boucle par requête`. Une borne haute, jamais un débit observé.                                                                                      |
| **Granularité d'un minuteur**      | Plus petit délai qu'un minuteur sait rendre. En dessous, on mesure le minuteur, pas le phénomène.                                                                 |
| **Résolution d'un instrument**     | Plus petit écart qu'il sait distinguer. Un instrument sous sa résolution rend **son propre plancher**, pas un zéro.                                               |
| **Majorant**                       | Valeur garantie supérieure à la vraie. `process.cpuUsage()` en est un : il compte tous les fils.                                                                  |
| **Audit adversarial**              | Relecture menée pour **réfuter** une conclusion, avec obligation de produire commande et sortie pour chaque affirmation.                                          |
| **Congestion molle**               | Plafond qui varie d'un jour à l'autre et cède quand on ajoute des connexions — donc pas une butée de ressource.                                                   |
| **Structurel**                     | Coût qui découle du design (contexte unifié, injection de dépendances, sécurité par défaut). On l'assume ou l'on change d'architecture.                           |
| **Accidentel**                     | Travail fait pour rien. C'est la cible légitime d'une optimisation.                                                                                               |

## Pièges

**Ceux du protocole.**

- **Un pourcentage de profil n'est pas un pourcentage de budget.** Un profil échantillonné
  rapporte du CPU **occupé** ; quand une part du temps de requête part en attente, les deux
  échelles divergent. Trois fois de suite, un poste imputé à 18–31 µs par le profil s'est révélé
  valoir 0,6–1,3 µs au micro-banc — un écart de facteur 25 à 30. **Tout pourcentage de profil se
  convertit en nanosecondes par un micro-banc avant d'ouvrir un chantier.**
- **Un compte, lui, ne ment pas.** « 43 exécutions de motif de route par requête » est exact,
  déterministe, et ne dépend ni de la machine ni de l'instrument. Quand un diagnostic peut se
  poser en compte plutôt qu'en durée, le préférer.
- **Deux fenêtres de mesure ne se comparent pas.** Les mêmes binaires ont rendu 7 000 et 9 800 RPS
  à quelques jours d'écart, décor apparemment identique. Toute comparaison vit **à l'intérieur**
  d'une fenêtre.
- **Une pause longue endort le serveur.** Au-delà de deux minutes d'inactivité, macOS met le
  processus en veille douce et le run suivant paie −13 %, reproduit trois fois sur trois. Le
  refroidissement se fait **avant** la série, jamais entre les runs.
- **Un refus de garde n'est pas un chiffre faux, c'est un chiffre non prouvable.** Une série
  refusée cinq fois avait des médianes à ±1 % de celles finalement retenues. On ne négocie pas la
  garde, on attend une fenêtre propre.

**Ceux du décor.**

- **La fenêtre la plus stable peut être la plus fausse.** Un processeur bridé tient un plafond bas
  sans effort : la dispersion était parfaite des deux côtés (0,4 % et 1,6 %) et le résultat faux
  d'un facteur 1,62. Même forme pour l'hyperviseur — dispersions de 0,5 % et 1,5 %, rapport faux.
- **Arrêter les conteneurs ne rend pas les vCPU.** C'est la machine virtuelle qu'il faut éteindre,
  et le **constater** plutôt que le déduire de l'absence de conteneur.
- **Tuer un processus ne tue pas son arbre.** Un générateur de charge orphelin a été mesuré à
  308 % de CPU après l'arrêt du banc qui l'avait lancé.
- **Un contrôle de cible rouge doit interrompre la série**, pas s'imprimer. Une campagne entière a
  mesuré des réponses d'erreur parce que le contrôle se contentait d'afficher.
- **Un code de retour d'outil n'est pas un verdict du code mesuré.**
- **Après avoir corrigé un artefact, chercher les autres endroits qui répètent la même
  affirmation.** Une correction locale laisse le catalogue et la documentation dire le contraire.

**Ceux des deux grandeurs.**

- **Un minuteur ne mesure pas un blocage court.** Un délai de zéro est borné par Node à ~1 ms :
  on mesure la granularité du minuteur. Verdict produit : « SQLite bloque 0,43 ms » pour une
  requête de 33 µs — un facteur 13.
- **`monitorEventLoopDelay` a une résolution de l'ordre de la milliseconde.** Il rendait son
  propre plancher pour les **deux** pilotes, donc « aucune différence ».
- **`process.cpuUsage()` compte tous les fils**, ramasse-miettes compris. C'est un majorant, pas
  un plafond de débit : sur une réponse volumineuse, il a rendu 110 % du temps mural.
- **Une colonne « bloque la boucle ? non » qui n'a jamais mesuré.** C'est le pire des quatre,
  parce qu'il ne ressemble pas à une erreur. **Un banc qui n'a pas mesuré doit se taire, pas
  répondre « non ».**

## Pour aller plus loin

- ⬆️ **Retour au hub** : [Performance](index.md) — les chiffres et ce qu'ils valent
- 🔬 [Où part le temps](analyses.md) — pipeline HTTP, comparaisons, ORM, et ce qui reste ouvert
- 🧰 Outillage : `.claude/skills/nodefony-load-test/` — bancs, protocoles, scripts rejouables
