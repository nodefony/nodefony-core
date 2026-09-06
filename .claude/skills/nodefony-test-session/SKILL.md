---
name: nodefony-test-session
metadata:
  version: 1.0.0
description: >
  Conduit une passe de test COMPLÈTE du dépôt Nodefony — toutes les suites, tous les
  interrupteurs, tous les bancs — dans l'ordre où chacune ne fausse pas la suivante, et rend
  un verdict qui distingue une régression du produit d'un artefact de décor. Porte la matrice
  des étages, le décor exact de chacun, ce qu'un run vert ne prouve PAS, et l'arbre de décision
  qui instruit un rouge avant de l'imputer au code. À charger AVANT de lancer la première
  commande : l'ordre des étages EST le protocole, et un lot joué à l'envers fabrique des rouges
  qui n'appartiennent à personne. Déclencheurs : "session de test", "passe de test complète",
  "lance tous les tests", "tous les bancs", "test:all", "on teste tout", "avant la publication
  on teste quoi ?", "qu'est-ce qui n'a pas été testé ?", "ce rouge est-il une régression ?",
  "un banc rouge sans changement de code", "tests verts en isolé rouges en suite", "combien de
  tests sont sautés", "quels bancs restent à jouer".
---

# nodefony-test-session — la passe complète, et ce qu'elle ne prouve pas

> **Maintenance** : vérité courante, jamais un journal. Éditer en place ; l'historique vit dans
> `git log`, l'avancement dans les tickets. **Aucun chiffre de mesure ici** — ils se périment et
> vivent dans `nodefony-load-test` (`references/reperes-empiriques.md`).

## Ce que ce skill fait — et ce qu'il ne refait pas

Il **ORDONNE**. Les recettes appartiennent aux quatre skills qui les portent, et les recopier ici
les rendrait inatteignables — c'est le défaut connu du dépôt : une règle redonnée dans un fichier
lu d'office fait que personne n'ouvre jamais le skill qui portait le diagnostic.

| Ce qu'il faut faire                    | Où vit la recette                |
| -------------------------------------- | -------------------------------- |
| Charge, RPS, rupture, fuite, capacité  | `nodefony-load-test`             |
| Fan-out cross-pod, cloisonnement       | `nodefony-multipod-bench`        |
| Ce que le scaffold PRODUIT             | `nodefony-devkit-bench`          |
| Seuils mémoire et conduite si ça saute | `nodefony-check-memory-health`   |
| Ce qu'un installeur npm reçoit         | `nodefony-release`               |
| Lire un journal capturé en entier      | `@agent-nodefony-run-log-report` |

## La matrice — six étages, et l'ordre n'est pas négociable

Chaque étage suppose que le précédent est **fini**, pas qu'il tourne encore. Deux étages en
parallèle, ce sont deux mesures fausses et des rouges de saturation à instruire.

| #     | Étage                      | Commande                                         | Serveur dev                | Ce qu'il ajoute                                      |
| ----- | -------------------------- | ------------------------------------------------ | -------------------------- | ---------------------------------------------------- |
| **A** | Non-régression + dialectes | `npm run test:all -- --dialects`                 | **arrêté**                 | tout le socle, plus l'ORM rejoué sur MySQL Community |
| **B** | Charge + mémoire           | `npm run test:all -- --load`                     | **arrêté**                 | seuils de heap (blockers), charge WS, scopes DI      |
| **C** | Interrupteurs de coût      | voir § Interrupteurs                             | **arrêté**                 | ce que le socle SAUTE par défaut                     |
| **D** | Bancs de charge et e2e     | par lots, voir § Lots                            | **selon le lot**           | le comportement sur un vrai serveur                  |
| **E** | Ce que le scaffold produit | `verify-generated.mjs` puis `verify-runtime.mjs` | indifférent (ports dédiés) | l'application d'un utilisateur                       |
| **F** | Multi-pods                 | `setup.sh` puis `run.sh`                         | **arrêté**                 | ce qui n'existe qu'à plusieurs process               |

> 🔴 **Arrêter le serveur de développement avant A, B, C et F.** Deux applications Nodefony
> peuvent écouter le MÊME port sur macOS et les BSD (`127.0.0.1:5151` et `*:5151` sont deux
> liaisons distinctes) : le noyau ne lève jamais, la seconde se dit prête, et tout le trafic va à
> la première. Un banc interroge alors le serveur du VOISIN et son verdict porte sur lui — #214.
> `npx nodefony stop`, puis `lsof -nP -iTCP:5151,5152 -sTCP:LISTEN` pour le CONSTATER.

## Ce qu'un run vert ne prouve pas

Quatre angles morts, tous vécus. Les nommer fait partie du verdict : **avant de dire « tout est
vert », dire ce qui n'a pas tourné.**

1. **Les interrupteurs fermés.** `test:all` saute par défaut les micro-bancs de performance, les
   boots CLI réels, le cluster e2e, les sondes de rupture WS et les coupures réelles de base. Il
   le DIT en fin de run (« Interrupteurs fermés ») — c'est ce bloc qu'on lit, pas le total.
2. **Les cibles d'infrastructure absentes.** Une variable manquante ne lève presque jamais : elle
   fait sauter un banc, et **un banc sauté compte comme vert**. Source unique des variables :
   `vitest.gates.ts` ; le `gateReporter` les affiche en fin de suite. En CI (`CI` posé) la passe
   ÉCHOUE si une cible déclarée n'a pas été exercée.
3. **Les bancs hors périmètre.** Les scripts de `nodefony-load-test` et `nodefony-multipod-bench`
   ne sont JAMAIS joués par `test:all`, même avec `--load`. Le rapport les compte et le dit.
4. **La chaîne de publication.** Rien de ce qui précède n'éprouve ce qu'un installeur npm reçoit —
   tarball, surface `exports`, `peerDependencies`, gabarits livrés. C'est `nodefony-release`, et
   c'est un étage à part entière avant toute publication.

> ⚠️ **Le code de sortie se lit SANS pipe.** `npm run test:all … | tee fichier` rend le code de
> `tee`, jamais celui de npm — et une notification de tâche de fond annonce alors « exit 0 » sur
> un run rouge. Écrire `cmd > fichier 2>&1; echo "EXIT=$?" >> fichier`, puis lire cette ligne.

## Instruire un rouge — l'arbre de décision

**Le produit est le DERNIER suspect, pas le premier.** Sur une passe complète, la majorité des
rouges ne lui appartiennent pas. L'ordre des questions, du moins cher au plus cher :

1. **Le même cas passe-t-il ISOLÉ ?** Si oui → **saturation**, pas régression. Une passe turbo
   fait tourner des dizaines d'espaces de travail en parallèle ; les timeouts écrits en dur
   (5 s, 6 s, 20 s, 30 s) sautent sans que rien ne soit cassé. Le rejeu isolé coûte une minute et
   tranche.
2. **Le décor est-il celui que le banc suppose ?** Serveur requis ou interdit, variables `NF__…`,
   conteneur, cookie, cluster. Un banc de classe A « KO » sur un décor absent n'a rien prouvé de
   faux — il attend son décor (catalogue de `nodefony-load-test`).
3. **Un ÉTAT PARTAGÉ s'est-il accumulé ?** C'est le rouge le plus trompeur, parce qu'il grossit
   avec le nombre de runs et finit par franchir un seuil un jour donné. Cas vécu : des milliers de
   sessions résiduelles dans Redis faisaient sauter le garde-fou de pagination d'un test — dont le
   commentaire annonçait pourtant la dépendance au keyspace entier. Le compte se demande
   (`redis-cli INFO keyspace`), il ne se devine pas.
4. **L'instrument dit-il vrai ?** Un banc périmé (symbole ou méthode disparue), un classement de
   décor faux, un défaut d'URL. Signe distinctif : l'échec est immédiat et structurel, pas une
   assertion métier.
5. **Alors seulement : le produit.** Et à ce stade, suspecter son propre diff avant tout.

> 🔴 **Un banc qui REFUSE de mesurer est un bon banc.** « la base n'a pas pu être migrée — le banc
> ne mesurerait rien », « INDÉTERMINÉ — moins de 10 min d'observation », « DANS LE BRUIT » : ce
> sont des succès de l'instrument, pas des échecs. Le mauvais banc est celui qui rend un chiffre
> quoi qu'il arrive.

## Les interrupteurs — étage C

Ils s'ouvrent **par familles**, jamais tous d'un coup : un run qui échoue pour quinze causes
mélangées est ininterprétable.

| Lot | Variables                                                        | Pourquoi séparé                                                                |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| C1  | `NF_RUN_PERF=1 NF_RUN_CLI_BOOT=1 NF_RUN_CLUSTER_E2E=1`           | non disruptifs — se jouent dans `test:all`                                     |
| C2  | `NF_RUN_WS_RUPTURE=1`                                            | épuise les ports éphémères — isolé, via `run.sh load --rupture`                |
| C3  | `NF_RUN_DB_OUTAGE=1` + `NF_DB_OUTAGE_{PG,MYSQL,MONGO}_CONTAINER` | **arrête et relance des conteneurs** — annoncer avant, contrôler l'infra après |

C3 vise le conteneur qui sert la variable d'infra, pas celui qui porte le nom attendu : `NF_MYSQL_URL`
peut pointer MariaDB pendant qu'un conteneur nommé `mysql` sert un autre port.

## Les lots de l'étage D

Le catalogue de `nodefony-load-test` porte le décor de chaque banc. Ce qui relève du **protocole
de session**, et seulement lui :

- **Les destructeurs se jouent en dernier de leur lot** — ceux qui tuent le serveur (arrêt
  gracieux) ou prennent ses ports (cluster). Sinon tous les suivants tombent en `ECONNREFUSED`,
  et l'on instruit des faux rouges en cascade.
- **Un banc à décor opt-in prend son PROPRE serveur** : un serveur par décor, jamais un serveur
  pour deux plafonds différents.
- **Les mesures ne se chevauchent pas.** Une installation, une compilation ou un second banc qui
  tourne pendant une mesure la fausse — et c'est invisible dans le chiffre rendu.

## Clore la passe

1. **Dire ce qui n'a pas tourné** (les quatre angles morts ci-dessus), pas seulement le total.
2. **Rendre le décor** : `npx nodefony stop`, `run.sh --stop` pour les pods, conteneurs laissés
   dans l'état où on les a trouvés.
3. **Instruire chaque rouge restant** par l'arbre ci-dessus, et **ouvrir un ticket par famille** —
   un rouge d'instrument est un ticket d'instrument, jamais une ligne de plus dans un rapport.

## Références

- [`references/pieges-de-session.md`](references/pieges-de-session.md) — le catalogue des pièges,
  symptôme → cause → geste, chacun payé au moins une fois
