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

Trois tâches déroulées par un agent réel, en mode autonome, dans une application
fraîche : « CRUD produit », « protège une route », « canal temps réel ». Jugées
sur pièces — le transcript (a-t-il APPELÉ l'outil ?) et le diff git (qu'a-t-il
ÉCRIT ?). **Aucun juge automatique n'est un modèle de langage** : uniquement des
sondes objectives.

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
| une vague `devkit S<n>` que tu veux déclarer finie               | les deux                                                        |

## Quand passer la main

| Besoin                                                          | Skill                    |
| --------------------------------------------------------------- | ------------------------ |
| Éprouver ce qu'un **installeur** reçoit (npm, conteneur vierge) | `nodefony-release`       |
| Charge, débit, latence                                          | `nodefony-load-test`     |
| Coder dans le cœur backend                                      | `nodefony-framework-dev` |
| Créer ou éditer un skill                                        | `nodefony-skill`         |
