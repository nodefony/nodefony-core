---
name: nodefony-devkit-bench
description: Éprouve ce que le scaffold de Nodefony PRODUIT, par deux mesures — le code généré tient-il debout (il compile, ses tests passent, sa ressource répond vraiment en HTTP), et un agent lâché dans une application fraîche découvre-t-il l'outillage au lieu de deviner. À charger AVANT de déclarer finie une évolution des gabarits, de la grammaire de champs, du moteur de génération ou du contrat de ressource : les assertions du dépôt lisent des chaînes dans des fichiers rendus, elles ne voient pas qu'un échantillon viole son propre schéma, qu'une relation déclarée fait lever l'ORM au démarrage, ou qu'un type généré ne compile pas. Porte l'interprétation des échecs et les pièges de décor. Déclencheurs - "j'ai modifié le scaffold", "le code généré compile-t-il ?", "est-ce que create entity marche encore ?", "rejouer le banc devkit", "l'agent trouve-t-il les générateurs ?", "prouver qu'une vague devkit est finie", "tester une app témoin".
metadata:
  version: 1.0.0
---

# nodefony-devkit-bench — prouver ce que le scaffold produit

> **Maintenance** : ce fichier décrit la vérité COURANTE des deux bancs. Mettre à
> jour = éditer la section concernée en place. Pas de journal, pas de date :
> l'historique vit dans `git log`, l'avancement dans `MIGRATION_STATUS.md`.

## Pourquoi deux bancs, et pas un

Ils répondent à deux questions qu'on confond facilement, et un seul des deux ne
protège de rien :

| Banc                            | Question                              | Ce qu'il ne voit pas          |
| ------------------------------- | ------------------------------------- | ----------------------------- |
| **`verify-generated.mjs`**      | Le code produit **tient-il debout** ? | Si l'agent l'a trouvé         |
| **`bench-discoverability.mjs`** | Un agent le **trouve-t-il** ?         | Si ce qu'il trouve fonctionne |

Un scaffold peut générer du code parfait que personne ne lance, et un scaffold
parfaitement documenté qui produit du code qui ne compile pas.

## Ce que les tests du dépôt ne peuvent pas prouver

`create.test.ts` vérifie que les fichiers rendus **contiennent** les bonnes
chaînes. C'est utile et rapide, mais aveugle à tout ce qui ne se voit qu'à
l'exécution. Trois pannes réelles, trouvées par le banc de vérité et invisibles
aux assertions :

- un échantillon de test généré violait le schéma Zod de sa propre entité (une
  valeur d'énumération fabriquée par interpolation) ;
- une relation déclarée faisait **lever l'ORM au démarrage**, parce que le test
  généré n'enregistrait que son entité, pas la cible du lien ;
- un type généré ne compilait pas chez le consommateur, l'export utilisé
  n'existant que sous condition.

Aucune de ces trois n'aurait été vue autrement qu'en compilant et en exécutant.

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
2. **génération** — deux entités qui exercent toute la grammaire (unique,
   énumération avec défaut, entier avec défaut, index, relation) ;
3. **compilation** — l'étape qui manquait : un type faux ne se voit pas dans une
   assertion de chaîne ;
4. **build** — le runtime charge le `dist/` : sans lui, une entité neuve est
   invisible du serveur (cause n°1 des « ma route répond 404 ») ;
5. **tests générés** — couche donnée ;
6. **HTTP réel** — 201 + `Location`, 422, 409 sur doublon, page `hasNext`,
   PATCH, 204 puis 404 ;
7. **inspection** — l'application se laisse lire sans ouvrir de port.

Le décor est **conservé** quand une étape échoue (le chemin est affiché) : la
première chose à faire est d'y entrer et de rejouer la commande fautive à la
main.

## Banc de découvrabilité — l'agent trouve-t-il ?

```bash
node .claude/skills/nodefony-devkit-bench/scripts/bench-discoverability.mjs
node .claude/skills/nodefony-devkit-bench/scripts/bench-discoverability.mjs --task 1
```

Neuf tâches déroulées par un agent réel, en mode autonome, dans une application
fraîche : « CRUD produit », « protège une route », « canal temps réel »,
« commande CLI », « démarre puis arrête le serveur », « configuration par
l'environnement », « choisir la bonne brique », « appeler le générateur au lieu
de l'imiter », « interroger l'application plutôt que lire ses sources ». Jugées
sur pièces — le transcript (a-t-il APPELÉ l'outil ?) et le diff git (qu'a-t-il
ÉCRIT ?).
**Aucun juge automatique n'est un modèle de langage** : uniquement des sondes
objectives.

Les meilleurs gates ne lisent pas le dépôt, ils interrogent l'**état** ou
utilisent **l'outil lui-même comme juge** : plus aucun port tenu après la tâche 5 ;
`nodefony env --json` pour la 6 (une variable inventée y apparaît « inconnue ») ;
le catalogue publié pour la 7 (un paquet inventé n'y figure pas) ; le nombre réel
de routes pour la 9. Un « je l'ai fait » dans un transcript ne prouve rien.

Et une tâche de configuration ne se juge JAMAIS sur le diff git : la bonne
réponse vit dans `.env.local`, qui est **gitignoré**. Vécu — deux sondes ont
déclaré en échec un agent qui avait fait juste.

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
