---
title: "Le décor ment plus souvent que le code"
lang: fr
module: "global"
topic: perf-instruments
section: "Performance"
audience: [developer]
tags: [performance, mesure, instrumentation, docker, thermal, faux-positifs]
status: draft
updated: "2026-08-07"
source: ".claude/skills/nodefony-load-test/"
tests: none
---

📍 [Documentation](../index.md) › [Performance](index.md) › **Le décor ment plus souvent que le code**

> Sur ce chantier, **aucun** verdict faux n'est venu d'une erreur de raisonnement sur le code.
> Tous sont venus de l'instrument ou du décor : un minuteur qui mesurait sa propre granularité,
> un processeur bridé sans qu'on le sache, un indexeur système, une virtualisation réseau prise
> pour une saturation de base de données. Cette page les recense — c'est le chapitre le plus utile
> du dossier, et le moins flatteur.

## La vision — pourquoi cette page existe

Un chiffre faux ne ressemble pas à un chiffre faux. Il ressemble à un résultat.

Pire : les fenêtres de mesure les plus **stables** ont produit les résultats les plus **faux**. Un
processeur bridé tient un plafond bas sans effort — dispersion parfaite, verdict erroné d'un
facteur 1,62. La stabilité d'une série n'est pas un gage de justesse ; c'est seulement un gage de
répétabilité.

D'où la règle qui organise tout le reste : **l'instrument est le premier suspect, jamais le code
qu'il juge.** Et son corollaire, plus dur : **suspecter son propre diff** — la ligne qui échoue est
souvent celle qu'on vient d'ajouter.

## Les quatre instruments faux — une seule question

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
[la boucle d'événements](boucle-evenements.md)).

> **Quand plusieurs mesures fines se contredisent, changer d'échelle plutôt que d'instrument.**

## Les deux explications réfutées — dont la correction de la première

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

## Le coupable réel — la virtualisation réseau, pas la base

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

## Le décor machine — sept gardes, sept verdicts faux évités

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

## Deux pièges d'outillage, pour finir

**Une commande absente n'est pas un verdict.** Sur macOS nu, `timeout` n'existe pas : le code de
retour 127 signifie « commande introuvable ». Lu comme un résultat, il a produit **deux faux
diagnostics d'un coup** — un démarrage déclaré mort et une garde déclarée confirmée.

**Un mode machine ne doit jamais couper le canal d'erreur.** Une sortie en mode JSON rendait une
commande **muette** en cas d'échec : zéro octet, erreur standard vide, code 1. Et une variable qui
désactive la journalisation a rendu muet un plantage au démarrage d'un banc — deux lignes de
journal, processus mort sans un mot. Un décor de banc se démarre **avec** son journal ; on ne
coupe la journalisation qu'au moment de mesurer.

## La méthode qui a fini par payer

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

## Lexique

Termes propres à ce chapitre. Le vocabulaire général est défini dans
[Méthode de mesure](methode.md#lexique).

| Terme                          | Ce qu'il désigne ici                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| **Granularité d'un minuteur**  | Plus petit délai qu'un minuteur sait rendre. En dessous, on mesure le minuteur, pas le phénomène.                        |
| **Résolution d'un instrument** | Plus petit écart qu'il sait distinguer. Un instrument sous sa résolution rend **son propre plancher**, pas un zéro.      |
| **Majorant**                   | Valeur garantie supérieure à la vraie. `process.cpuUsage()` en est un : il compte tous les fils.                         |
| **Régime CPU**                 | Alimentation et mode d'économie d'énergie. Il change les absolus d'un facteur 1,62 sans qu'une ligne de code bouge.      |
| **Niveau thermique**           | Indicateur de bridage en cours. Une série qui chauffe peut **inverser** un verdict.                                      |
| **Veille douce**               | Mise en sommeil d'un processus inactif par le système. Elle coûte ~13 % au run suivant.                                  |
| **Audit adversarial**          | Relecture menée pour **réfuter** une conclusion, avec obligation de produire commande et sortie pour chaque affirmation. |
| **Congestion molle**           | Plafond qui varie d'un jour à l'autre et cède quand on ajoute des connexions — donc pas une butée de ressource.          |

## Pièges

- **La fenêtre la plus stable peut être la plus fausse.** Vérifier le régime, pas seulement la
  dispersion.
- **Un refus de garde n'est pas un chiffre faux** — c'est un chiffre non prouvable. Ne pas
  négocier la garde, attendre une fenêtre propre. Les séries refusées avaient d'ailleurs des
  médianes à ±1 % de celles finalement retenues.
- **Un contrôle de cible rouge doit interrompre la série**, pas s'imprimer. Une campagne entière a
  mesuré des réponses d'erreur parce que le contrôle se contentait d'afficher.
- **Un code de retour d'outil n'est pas un verdict du code mesuré.**
- **Après avoir corrigé un artefact, chercher les autres endroits qui répètent la même
  affirmation.** Une correction locale laisse le catalogue et la documentation dire le contraire.

## Pour aller plus loin

- ⬆️ **Retour au hub** : [Performance](index.md)
- ⏱️ [La boucle d'événements](boucle-evenements.md) — la question que ces instruments n'ont pas su trancher
- 📏 [Méthode de mesure](methode.md) — les gardes, sous forme de protocole
- 📐 [Ce qui reste ouvert](ouvertures.md) — ce que ce décor interdit de conclure
