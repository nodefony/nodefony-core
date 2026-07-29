---
name: nodefony-devkit-bench
description: Éprouve ce que le scaffold de Nodefony PRODUIT, par trois mesures — le code généré tient-il debout (il compile, ses tests passent, sa ressource répond en HTTP), un agent lâché dans une application fraîche découvre-t-il l'outillage au lieu de deviner, et le modèle de données d'un vrai logiciel libre est-il exprimable avec la grammaire de champs. À charger AVANT de déclarer finie une évolution des gabarits, de la grammaire de champs ou du moteur de génération : les assertions du dépôt lisent des chaînes dans des fichiers rendus, elles ne voient pas qu'un échantillon viole son propre schéma ni qu'un type généré ne compile pas. Porte l'interprétation des échecs, l'isolation du décor et l'auto-contrôle des juges. Déclencheurs - "j'ai modifié le scaffold", "le code généré compile-t-il ?", "est-ce que create entity marche encore ?", "rejouer le banc devkit", "l'agent trouve-t-il les générateurs ?", "un vrai schéma est-il exprimable ?", "prouver qu'une vague devkit est finie".
metadata:
  version: 1.1.0
---

# nodefony-devkit-bench — prouver ce que le scaffold produit

> **Maintenance** : ce fichier décrit la vérité COURANTE des deux bancs. Mettre à
> jour = éditer la section concernée en place. Pas de journal, pas de date :
> l'historique vit dans `git log`, l'avancement dans `MIGRATION_STATUS.md`.

## Pourquoi trois bancs, et pas un

Ils répondent à trois questions qu'on confond facilement, et aucun ne protège
seul :

| Banc                            | Question                                          | Ce qu'il ne voit pas               |
| ------------------------------- | ------------------------------------------------- | ---------------------------------- |
| **`verify-generated.mjs`**      | Le code produit **tient-il debout** ?             | Si l'agent l'a trouvé              |
| **`bench-discoverability.mjs`** | Un agent le **trouve-t-il** ?                     | Si ce qu'il trouve fonctionne      |
| **`bench-schema.mjs`**          | Un **vrai** modèle de données est-il exprimable ? | Ce qu'aucun schéma réel ne demande |

Un scaffold peut générer du code parfait que personne ne lance, un scaffold
parfaitement documenté qui produit du code qui ne compile pas — et une grammaire
que ses propres exemples valident, jusqu'au jour où on lui donne le schéma de
quelqu'un d'autre.

## Ce que les tests du dépôt ne peuvent pas prouver

`create.test.ts` vérifie que les fichiers rendus **contiennent** les bonnes
chaînes. C'est utile et rapide, mais aveugle à tout ce qui ne se voit qu'à
l'exécution. Trois pannes réelles, trouvées par le banc de vérité et invisibles
aux assertions :

- un échantillon de test généré violait le schéma Zod de sa propre entité (une
  valeur d'énumération fabriquée par interpolation — puis, plus tard, un décimal
  et un caractère fixe : le même piège trois fois) ;
- une relation déclarée faisait **lever l'ORM au démarrage**, parce que le test
  généré n'enregistrait que son entité, pas la cible du lien ;
- un type généré ne compilait pas chez le consommateur, l'export utilisé
  n'existant que sous condition ;
- une colonne de référence sortait en texte face à une clé `uuid` : le code
  compile, les tests passent, la ressource répond — et toute jointure SQL écrite
  ensuite est refusée par PostgreSQL.

Aucune de ces quatre n'aurait été vue autrement qu'en compilant et en exécutant.

## Banc de vérité — le code généré tient-il debout ?

```bash
node .claude/skills/nodefony-devkit-bench/scripts/verify-generated.mjs
node .claude/skills/nodefony-devkit-bench/scripts/verify-generated.mjs --no-e2e  # plus rapide
node .claude/skills/nodefony-devkit-bench/scripts/verify-generated.mjs --keep    # garder le décor
```

**Prérequis : le checkout est BÂTI** (`npm run build`). L'application témoin se
lie au `dist/` local (`--link`), donc elle éprouve ce que tu viens de compiler —
pas ce qui est publié.

Les étapes, dans l'ordre, et ce que chacune protège :

1. **décor** — application témoin liée, ports dédiés ;
2. **génération** — cinq entités qui exercent toute la grammaire (unique,
   énumération avec défaut, entier avec défaut, index simple et composite,
   unicité composite, tailles de colonne, relation), dont deux émises pour
   PostgreSQL ;
3. **compilation** — l'étape qui manquait : un type faux ne se voit pas dans une
   assertion de chaîne ;
4. **décâblage** — les entités PostgreSQL quittent le manifeste : leur schéma
   enregistré sur un connecteur SQLite ferait échouer le boot, et cet échec ne
   dirait rien du générateur. Leurs fichiers restent — c'est leur type qu'on lit ;
5. **cohérence FK ↔ PK** — une colonne de référence doit avoir le type de la clé
   visée, sinon la jointure est refusée par le moteur ;
6. **build** — le runtime charge le `dist/` : sans lui, une entité neuve est
   invisible du serveur (cause n°1 des « ma route répond 404 ») ;
7. **tests générés** — couche donnée ;
8. **HTTP réel** — 201 + `Location`, 422, 409 sur doublon, page `hasNext`,
   PATCH, 204 puis 404 ;
9. **inspection** — l'application se laisse lire sans ouvrir de port.

> **Une sonde de type doit porter sur un moteur qui DISTINGUE les types.** La
> cohérence FK ↔ PK a d'abord été écrite sur les entités SQLite du banc, et elle
> passait quel que soit le générateur : en SQLite, une clé `uuid` et une colonne
> texte sont le **même** type. La sonde ne pouvait rien voir. D'où les deux
> entités PostgreSQL — aucune base n'est requise, Drizzle déclare ces types sans
> se connecter. C'est la preuve négative qui l'a révélé, pas la relecture.

Le décor est **conservé** quand une étape échoue (le chemin est affiché) : la
première chose à faire est d'y entrer et de rejouer la commande fautive à la
main.

## Banc de découvrabilité — l'agent trouve-t-il ?

```bash
node .claude/skills/nodefony-devkit-bench/scripts/bench-discoverability.selftest.mjs   # les sondes, AVANT le verdict
node .claude/skills/nodefony-devkit-bench/scripts/bench-discoverability.selftest.mjs --prove
node .claude/skills/nodefony-devkit-bench/scripts/bench-discoverability.mjs
node .claude/skills/nodefony-devkit-bench/scripts/bench-discoverability.mjs --task 1
```

### Les sondes s'éprouvent AVANT de juger

**Le mode de défaillance n° 1 de ce banc n'est pas un agent qui échoue : c'est
une sonde qui recale un agent ayant fait JUSTE.** Quatre fois — la valeur posée
dans un `.env` gitignoré, le test pris pour de la configuration en dur,
l'instanciation en fixture prise pour un contournement, la regex qui ne
franchissait pas la parenthèse d'un appel imbriqué. À chaque fois, le défaut n'a
été vu qu'après avoir lancé de vrais agents et relu les diffs à la main.

Le danger n'est pas le rouge : c'est qu'un banc faux fasse **dégrader le devkit
pour lui plaire**. Vécu — une sonde exigeait `@services([…])` alors que
l'application répondait 200 sans lui ; seul le fait de démarrer le serveur et de
frapper la route a évité de « corriger » un code qui marchait.

D'où `bench-discoverability.selftest.mjs` : chaque sonde reçoit deux échantillons
FIGÉS, un qu'elle doit accepter et un qu'elle doit refuser. Aucun agent lancé,
aucun décor monté — quelques secondes, zéro token. Il appelle `evaluateProbe`
exportée par le banc, jamais une copie : un auto-contrôle qui réimplémente la
règle ne valide que lui-même.

`--prove` **ampute** chaque sonde (motif qui ne reconnaît plus rien) et exige
qu'au moins un cas tombe. Une sonde qui reste verte amputée n'est pas exercée
par ses échantillons — le contrôle le dit au lieu de la compter comme couverte.

Trois sorties, et la distinction est volontaire : `0` tout bon et couverture
complète · `1` une sonde MENT · `2` couverture **incomplète, sondes nommées**.
Une sonde ajoutée sans son échantillon doit se voir, pas se fondre dans le vert —
c'est la règle « une capacité arrive AVEC sa tâche », appliquée à la tâche
elle-même.

Treize tâches déroulées par un agent réel, en mode autonome, dans une
application fraîche. Neuf visent les **générateurs** : « CRUD produit »,
« protège une route », « canal temps réel », « commande CLI », « démarre puis
arrête le serveur », « configuration par l'environnement », « choisir la bonne
brique », « appeler le générateur au lieu de l'imiter », « interroger
l'application plutôt que lire ses sources ». Quatre visent le **socle**, qui n'a
pas de générateur et s'imite ou s'ignore : « un service au conteneur »,
« une trace exploitable en production », « une initialisation au bon moment du
démarrage », « consommer un service depuis un autre composant ». Jugées sur
pièces — le transcript (a-t-il APPELÉ l'outil ?) et le diff git (qu'a-t-il
ÉCRIT ?).
**Aucun juge automatique n'est un modèle de langage** : uniquement des sondes
objectives.

Les meilleurs gates ne lisent pas le dépôt, ils interrogent l'**état** ou
utilisent **l'outil lui-même comme juge** : plus aucun port tenu après la tâche 5 ;
`nodefony env --json` pour la 6 (une variable inventée y apparaît « inconnue ») ;
le catalogue publié pour la 7 (un paquet inventé n'y figure pas) ; le nombre réel
de routes pour la 9 ; le conteneur de l'application EXÉCUTÉE pour les 10 et 13
(un service jamais enregistré, ou une dépendance injectée sous un nom qui
n'existe pas, ne se voient ni à la compilation ni dans une assertion de chaîne).
Un « je l'ai fait » dans un transcript ne prouve rien.

**Un gate ne littéralise pas ce qu'il peut DÉDUIRE.** Celui de la tâche 13
demande deux services « à l'application » : écrit `module === "app"`, il
recalerait un agent qui les range dans un module local — une réponse juste. Il
croise donc les modules chargés (tout ce qui n'est pas un paquet `@nodefony/*`)
avec les services enregistrés. Même famille de faute que les sondes qui lisaient
les tests : le raccourci d'écriture devient un faux rouge.

Et une tâche de configuration ne se juge JAMAIS sur le diff git : la bonne
réponse vit dans `.env.local`, qui est **gitignoré**. Vécu — deux sondes ont
déclaré en échec un agent qui avait fait juste.

### Le décor, ici aussi, est celui de l'utilisateur

Par défaut le décor est **isolé** — application hors du dépôt, paquets installés
depuis les tarballs, isolation **constatée** avant le premier agent (le banc
s'arrête si le constat échoue). Même exigence et **même implémentation** que le
banc de schéma : `scripts/lib/isolation.mjs`, partagé par les deux. Les recopier
les ferait diverger en silence, chacun passant ses propres contrôles avec sa
propre idée de ce qu'« isolé » veut dire.

La raison est vécue, pas théorique : sous le checkout, un agent a lu
`/…/src/nodefony/src/Service.ts` **en chemin absolu** pendant une tâche. Pointé
sur une telle application, le constat rend `ok: false` sur les trois faits, et
nomme jusqu'au fichier atteignable (`node_modules/nodefony/rolldown.config.ts`).

`--link` reste pour la boucle courte ; le rapport enregistre alors le décor
(`decor`) et annonce que la mesure n'est pas transposable. **Deux runs de décors
différents ne se comparent pas** — le décor est une variable de la mesure, au
même titre que le modèle.

### Ce banc ne découvre pas les trous — il les garde fermés

Les libellés des tâches sont **figés** : les reformuler change ce qui est
mesuré, et deux runs cessent d'être comparables. La conséquence est à connaître :
le banc ne voit QUE ce qu'on lui a appris à voir. Un générateur ajouté sans sa
tâche reste un angle mort — `create command` a manqué pendant tout le temps où
aucune tâche ne le demandait, et aucun run ne l'a signalé.

D'où la règle : **une capacité destinée à un agent arrive AVEC sa tâche**, comme
du code arrive avec ses tests. Ajouter une tâche = une entrée dans `TASKS`
(prompt figé + sondes), jamais retoucher une existante.

Une sonde se conçoit par paire quand l'énoncé peut être satisfait par abandon :
une positive (la bonne façade est là) et une négative (la mauvaise n'est pas
apparue **dans les lignes ajoutées**). Une négative seule passe aussi quand
l'agent n'a rien fait.

**Ce qui JUGE et ce qui OBSERVE.** Une sonde exige un **acte** quand aucune autre
voie ne donne l'information de façon fiable — lancer le générateur, puisque le
code écrit à la main diverge du gabarit ; interroger l'environnement, puisque la
précédence est un mécanisme et non un contenu qu'on lirait dans un fichier. Elle
se contente d'**observer** (`observe: true`, affichée `👁`, sans faire échouer)
quand plusieurs voies mènent au même savoir : exiger l'ouverture du catalogue
alors que l'`AGENTS.md` porte déjà la réponse mesurerait la conformité à un
chemin, pas la découvrabilité — un agent qui a lu l'index et répondu juste serait
recalé. Le critère n'est pas « l'agent a-t-il fait comme je l'imaginais » mais
« pouvait-il savoir autrement ? ».

Une sonde de moyen garde sa valeur **le temps qu'elle révèle quelque chose** :
celle du catalogue a prouvé que pointer un document ne suffit pas. Une fois
l'information hissée dans le fichier lu par défaut, elle devient redondante — on
la déclasse en observation plutôt que de la supprimer, pour continuer à voir
comment l'agent s'y prend.

**Une sonde de contenu ne regarde pas les tests.** Une valeur littérale dans un
fichier de test est une **fixture**, pas une configuration en dur. Vécu : un
agent avait tout fait juste — valeur dans le fichier d'environnement,
configuration qui le lit, vérification verte — et se voyait recalé parce que son
test citait l'URL qu'il venait de poser. La sonde visait la configuration, elle
mordait sur la preuve.

Le modèle par défaut est volontairement le plus **défavorable**. Un banc qui ne
passe qu'avec le modèle le plus fort ne mesure pas la découvrabilité, il mesure
la culture générale du modèle.

Ce banc a produit la leçon qui gouverne tout le devkit : **une règle lue s'érode,
une règle affichée agit.** Durcir la prose d'un fichier que l'agent lit n'a eu
aucun effet ; déplacer la même règle dans le fichier chargé automatiquement l'a
fait appliquer.

## Banc de schéma — un vrai modèle de données est-il exprimable ?

```bash
node .claude/skills/nodefony-devkit-bench/scripts/bench-schema.mjs
node .claude/skills/nodefony-devkit-bench/scripts/bench-schema.mjs --schema calcom
node .claude/skills/nodefony-devkit-bench/scripts/bench-schema.mjs --dump-only    # la cible, sans agent
node .claude/skills/nodefony-devkit-bench/scripts/bench-schema.mjs --analyze-only <runDir>
node .claude/skills/nodefony-devkit-bench/scripts/bench-schema.selftest.mjs       # le juge, AVANT le verdict
```

Un agent reçoit le schéma d'un logiciel libre — umami, cal.com, Ghost — et doit
le reproduire. Les cinq entités du banc de vérité ont été écrites POUR exercer
la grammaire : elles ne peuvent, par construction, rien demander qu'elle ne
sache faire. Un schéma que quelqu'un d'autre a écrit sans nous connaître n'a pas
cette complaisance.

**Trois schémas, pas un plus gros** : ils stressent des axes disjoints. Sur
umami seul on conclurait « la grammaire ne sait pas nommer » sans voir qu'elle
ne sait pas non plus déclarer une énumération PARTAGÉE par dix tables (46 chez
cal.com), ni une cascade de suppression (53 chez Ghost).

**Ce qui juge : la base réellement créée**, jamais les fichiers. Les `.ts`
disent ce que l'agent a écrit ; `information_schema` dit ce qui EXISTE.

**Sur PostgreSQL, et c'est structurel** — SQLite ne distingue pas
`varchar(255)` de `char(2)` de `text` : un juge posé dessus serait aveugle
exactement là où les schémas réels sont exigeants (onze longueurs distinctes
chez umami, `maxlength` sur chaque colonne chez Ghost). Même leçon que la sonde
FK ↔ PK du banc de vérité.

**La mesure qui compte n'est pas la justesse du schéma** mais le nombre
d'éditions faites à la MAIN : un agent finit toujours par obtenir le bon schéma
s'il écrit assez de Drizzle — et il aura alors prouvé que le générateur ne
servait à rien.

### Le décor doit être celui de l'utilisateur, pas celui du mainteneur

Le premier verdict a été rendu dans un décor qui le faussait : l'application
vivait sous le checkout, paquets symlinkés. L'agent est allé lire
`src/packages/@nodefony/drizzle/` — un savoir qu'aucun installeur npm ne
possède, puisqu'un tarball ne contient que `dist/`. **Le banc mesurait un agent
mieux servi que l'utilisateur réel**, et le seul chiffre qui compte en dépendait.

Deux gestes, tous deux nécessaires : le décor **sort du dépôt** (sinon `../..`
y ramène) et les paquets s'installent **depuis les tarballs** de `pack-all.mjs`
(sinon le lien expose les sources malgré la distance). L'isolation est ensuite
**constatée** avant l'agent — run hors dépôt, aucun lien qui sorte, aucune
source `.ts` atteignable — et le banc s'arrête si le constat échoue : mieux vaut
aucun verdict qu'un verdict sur autre chose.

`--link` reste là pour la boucle courte ; le rapport énonce alors que la mesure
n'est pas transposable. **Deux runs de décors différents ne se comparent pas.**

Le rapport compte aussi les **accès hors de l'application** : zéro est le
résultat attendu en décor fermé, et c'est ce chiffre qu'on relit quand un
verdict surprend.

### Le juge s'éprouve AVANT de juger

`bench-schema.selftest.mjs` refait chaque compte par un chemin **indépendant**
du lecteur, et `--prove` ampute les lecteurs pour montrer que le contrôle mord.
Il existe parce que ce banc a livré des verdicts faux avec l'aplomb des justes :
un lecteur knex perdant les définitions multi-lignes (130 colonnes — l'allure
d'un compte juste), un `array_agg` rendu en chaîne brute que le pilote ne décode
pas, un `String @db.Uuid` pris pour une chaîne — **18 faux positifs qui noyaient
le seul vrai écart**. Et le tout premier de ces défauts était **dans le
contrôle**, pas dans le lecteur : `indexOf("posts: {")` tombait sur
`show_latest_posts: {`.

Le juge PostgreSQL est exercé contre une table au **DDL écrit à la main** — la
référence n'emprunte pas une ligne au banc. S'il n'y a pas de base, le contrôle
n'est pas silencieusement sauté : il est **annoncé non exécuté** et la sortie
vaut **2**, parce qu'un vert incomplet lu comme un vert complet est le piège
maison n°1.

## Interpréter un échec — commencer par le décor

Trois causes ont déjà envoyé chercher très loin du vrai problème. Les écarter
avant de suspecter le code généré :

- **Tout répond 404, y compris les routes du gabarit.** Un autre serveur
  Nodefony occupe les ports. `--detach --wait` sonde les ports, l'autre serveur
  répond, la readiness est déclarée — et les tests interrogent une application
  qui n'est pas celle qu'on éprouve. Le banc de vérité s'en protège par des
  ports dédiés ; en manuel, `nodefony status` puis `nodefony stop`.
- **Une route existe dans les sources mais répond 404.** Le `dist/` est périmé.
  Le runtime charge le build, pas le source.
- **Le typecheck échoue sur `drizzle-orm` introuvable.** Artefact du mode
  `--link` : npm symlinke les paquets du framework sans hisser leurs
  dépendances. Sans rapport avec le code généré.

Et un piège qui, lui, n'est pas du décor : **une entité nommée `User` entre en
collision avec celle du module de sécurité** — l'application ne démarre plus, sur
un message qui parle de colonne inconnue. Nommer autrement dans un banc.

## Quand les lancer

| Tu viens de toucher…                                             | Lance                                                           |
| ---------------------------------------------------------------- | --------------------------------------------------------------- |
| gabarits, `entityFields.ts`, `engine.ts`                         | vérité (`--no-e2e` en boucle courte, complet avant de conclure) |
| `ResourceController`, contrat de ressource, DDL de développement | vérité, complet                                                 |
| `AGENTS.md` généré, docs embarquées, nommage des générateurs     | découvrabilité                                                  |
| une capacité NEUVE offerte aux agents (générateur, commande)     | découvrabilité — **après y avoir ajouté sa tâche**              |
| une vague `devkit S<n>` que tu veux déclarer finie               | les deux                                                        |

## Quand passer la main

| Besoin                                                          | Skill                    |
| --------------------------------------------------------------- | ------------------------ |
| Éprouver ce qu'un **installeur** reçoit (npm, conteneur vierge) | `nodefony-release`       |
| Charge, débit, latence                                          | `nodefony-load-test`     |
| Coder dans le cœur backend                                      | `nodefony-framework-dev` |
| Créer ou éditer un skill                                        | `nodefony-skill`         |
