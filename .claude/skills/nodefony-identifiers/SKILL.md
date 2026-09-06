---
name: nodefony-identifiers
metadata:
  version: 1.0.0
description: >
  Les identifiants du code Nodefony, de bout en bout : le gate de langue qui dit LESQUELS sont
  français (dictionnaire, banc anti-faux-positif, exceptions déclarées), puis le renommage en masse
  par le LanguageService TypeScript — jamais par regex — avec la preuve qu'aucun symbole n'a dérivé
  ni aucune chaîne affichée bougé. Porte ce qu'un typecheck vert ne dit PAS : un membre privé rendu
  public, un raccourci d'objet relié à la mauvaise déclaration, un alias qui annule la rupture, les
  consommateurs qu'aucun tsconfig ne voit. À charger AVANT de lancer le gate ou d'écrire un plan :
  les outils rendent un compte rassurant sans le protocole. Déclencheurs : "renommer un symbole partout", "renommer en masse", "écrire le code
  en anglais", "des identifiants sont en français", "ce nom de variable est en français", "quels
  identifiants restent à traduire", "ce renommage a-t-il tout attrapé ?", "prouver qu'un renommage
  est complet", "un membre privé est devenu public".
---

# nodefony-identifiers — nommer en anglais, renommer sans qu'un symbole dérive

> **Maintenance** : vérité courante, jamais un journal. Éditer en place ; l'historique vit dans
> `git log`, l'état d'une campagne dans ses tickets.

La règle du dépôt — **le code s'écrit en anglais, la prose en français** — vit dans le `CLAUDE.md`.
Ce skill porte les deux gestes qu'elle appelle : **CONSTATER** ce qui est encore français, et
**RENOMMER** sans rien casser. Les huit outils vivent ici parce qu'aucun ne rend un verdict
utilisable sans le protocole de cette page.

## 1. Quand m'utiliser — et quand passer la main

| Le besoin                                                      | Où aller                                            |
| -------------------------------------------------------------- | --------------------------------------------------- |
| Savoir quels identifiants sont encore français, et où          | **ici** (§2)                                        |
| Renommer un lot et **prouver** que rien n'a dérivé             | **ici** (§3 à §7)                                   |
| Comprendre POURQUOI la règle existe, et ses exemptions         | `CLAUDE.md`, section « le code s'écrit en anglais » |
| Renommer un fichier, déplacer un module, changer une structure | `nodefony-framework-dev`                            |
| Trouver qui utilise un symbole avant de décider                | `nodefony-inspect` (graphe symbolique, O(1))        |

**Le principe qui gouverne tout** : un renommage n'est pas une transformation de texte, c'est une
opération sur un arbre syntaxique. **Jamais de regex** — `options` renommé sans discernement a cassé
un `Kernel.ts` entier. Et un renommage n'est **prouvé** que par un contrôle qui compare le résultat
au plan : `export function state(state: X)` compile parfaitement.

## 2. Constater — le gate de langue

```bash
S=.claude/skills/nodefony-identifiers/scripts
node $S/check-identifier-language.mjs              # le relevé : compte, fichier, ligne, traduction proposée
node $S/check-identifier-language.mjs --json       # pour un autre outil
node $S/check-identifier-language.mjs src/nodefony # un périmètre seulement
node --test $S/check-identifier-language.test.mjs  # ses 66 tests
node $S/bench-identifier-language.mjs              # 0 faux positif sur ~80 000 identifiants tiers
```

Ce qu'il faut savoir avant de s'en servir :

- **Il agrège par nom et par fichier.** `nom (×8)` signale huit déclarations et ne cite que la
  première ligne — un plan écrit sur cette seule ligne en renomme pourtant huit.
- **La traduction proposée est une suggestion mécanique**, souvent mauvaise (`essaiBlanc` →
  `attemptBlanc`, `TOUCHE_LES_LIGNES` → `TOUCHE_LES_LINES`). Elle sert à repérer, jamais à décider.
- **C'est un dictionnaire, pas une compréhension.** Des mots français lui échappent (`qualifie`,
  `brut`, `vise`, `echappe`). Un « 0 constat » veut dire « rien de ce que je connais », pas
  « tout est en anglais ».
- **Une tolérance se DÉCLARE**, avec sa raison, dans `DEFAULT_EXCEPTIONS` — et une exception que
  rien n'active est signalée, parce qu'elle mentirait. Le cas typique : une clé de données
  désignée par une chaîne (§4.3), ou un mot que le dictionnaire prend pour du français.
- **Le banc est ce qui rend le gate croyable** : il le passe sur du code tiers entièrement anglais
  et exige zéro accusation. À relancer après toute retouche du dictionnaire.

## 3. Renommer — la recette, dans cet ordre

Chaque étape a déjà rattrapé une faute.

```bash
S=.claude/skills/nodefony-identifiers/scripts
# 1. compter sans rien écrire — c'est ici que la garde de collision refuse
node $S/rename-identifiers.mjs --project <tsconfig> --plan plan.json --dry
# 2. appliquer
node $S/rename-identifiers.mjs --project <tsconfig> --plan plan.json
# 3. recoller les `{ x: x }` en `{ x }`
npx oxlint --fix $(git diff --name-only | grep '\.ts$' | tr '\n' ' ')
# 4. la dérive, plan par plan (cf §6 pour le découpage)
node $S/check-rename-drift.mjs --plan plan.json
# 5. aucune chaîne affichée n'a bougé
node $S/check-literals-unchanged.mjs
# 6. dans le module
npm run typecheck && npx vitest run
# 7. À LA RACINE — les autres paquets ne sont pas dans le programme du module
npm run typecheck -- --force
```

L'étape 3 n'est pas cosmétique : sans elle le crochet de pre-commit REFUSE le commit
(`no-useless-rename`) et lint-staged rend l'arbre à son état d'avant.

**Le `--project` décide de ce qui sera mis à jour.** Un `tsconfig.json` de module exclut souvent
`tests/` : les usages qui y vivent ne seront pas renommés, et l'on ne s'en aperçoit qu'au typecheck
des tests. Écrire un `tsconfig` jetable qui inclut les deux (`extends` le vrai, `include:
["index.ts", "nodefony/**/*.ts", "tests/**/*.ts"]`), le passer en `--project`, et le **supprimer
avant de commiter**.

**Découper en lots par fichier ou par famille**, pas en un plan géant : un lot se contrôle, se
typecheck et se commit ; un plan de 120 entrées qui échoue au milieu laisse un arbre à moitié
renommé qu'aucun contrôle ne sait plus juger.

## 4. Écrire le plan — cinq règles, toutes payées

1. **Une cible déjà déclarée dans le fichier est un piège, pas une erreur.** L'outil la refuse en la
   nommant (§5.2). Quand le refus tombe, ce n'est pas l'outil qu'il faut contourner : c'est le nom
   qu'il faut choisir sur le SENS (`cible` → `parsedUrl`, pas `target`).
2. **Un membre privé s'écrit `#nom` dans le plan**, des deux côtés. Son `text` porte le croisillon,
   et le span de rename aussi.
3. **Une clé de données désignée par une chaîne n'est PAS un identifiant.** `group: "LANCER"` dans
   dix commandes : renommer la constante fait disparaître deux groupes d'un menu, sans une erreur.
   Chercher ce motif AVANT de renommer une constante en MAJUSCULES — et la déclarer en exception
   du gate (§2).
4. **Un littéral d'union est un contrat**, pas un nom : `type SectionState = "ok" | "echec"` ne se
   traduit pas — c'est une valeur qui voyage.
5. **Un même mot dans deux fichiers a souvent deux sens.** `borne` était à la fois « la borne
   atteinte », « tronquer pour l'affichage » et « ajouter une ligne bornée ». Trois cibles, donc
   trois entrées — et l'épinglage `@ligne` pour que le contrôle de dérive s'y retrouve (§6).

**Ce qui ne change pas** : TSDoc, commentaires, titres de test, messages affichés. Les tests sont
exemptés pour leurs identifiants LOCAUX. **Mais la prose qui NOMME un symbole se recale avec lui** :
un `` `cible.portee` `` dans un commentaire désigne un nom disparu — pire que pas de commentaire.
Les trouver : chercher, dans les fichiers modifiés, les noms du plan entourés d'accents graves.

## 5. Ce que le typecheck NE protège PAS — huit trous, tous rencontrés

1. **Un membre privé rendu PUBLIC.** Le span d'un `PrivateIdentifier` porte le croisillon : sans
   précaution, `#prendreVerrou` devient `takeLock`, membre public. Compile sans un mot. _(Corrigé
   dans l'outil ; l'auto-contrôle le garde.)_
2. **Un raccourci d'objet relié à la MAUVAISE déclaration.** Renommer `cible` → `target` à côté d'un
   `target` existant : `{ target }` cesse de désigner ce qu'il désignait. Vécu — une fonction s'est
   mise à renvoyer l'URL analysée au lieu de la cible de migration, **contrôle de dérive muet**,
   trouvé par `oxlint` (`no-unused-vars`). _(L'outil refuse désormais.)_
3. **Le renommage NE ROMPT PAS la surface publique tout seul.** `findRenameLocations` préserve le
   nom exporté en ajoutant un ALIAS : le barrel publie `request as demande` et l'utilisateur ne voit
   rien changer. **Après chaque lot, chercher `as <ancienNom>` dans le barrel** et retirer les
   alias — c'est seulement là que les vrais consommateurs apparaissent.
4. **Les autres paquets ne sont pas dans le programme du module.** Seul `npm run typecheck` à la
   RACINE le dit.
5. **Quatre familles de consommateurs échappent à TOUT programme TypeScript** — et un lot de
   renommage les trouve toutes : du `.mjs` (crie au moins une `SyntaxError`), un `.ts` **hors de
   tout `tsconfig`**, un **import dynamique** (`({x} = await import(…))` rend `undefined` en
   SILENCE), et un test qui **type son sujet à la main** (`JSON.parse(t) as {…}`), où le cast
   continue de compiler. **Après un lot, chercher l'ancien nom dans TOUT le dépôt**, pas dans ce que
   le compilateur voit.
6. **Un accès sur `any`** — `v.map((c) => c.cle)` compile et rend `undefined`. Seuls les tests le voient.
7. **Le code écrit DANS UNE CHAÎNE** — un worker lancé par `node -e` porte un protocole que le
   renommage côté appelant rompt sans un mot.
8. **Le dictionnaire du gate a des angles morts** (§2) : un fichier « propre » peut garder des noms
   français qu'il ne connaît pas.

## 6. Le contrôle de dérive — son modèle, et ses trois bords

Son modèle tient en une phrase : **une entrée SANS `@ligne` engage TOUTES les déclarations de ce nom,
dans tout le lot.** D'où trois comportements qui ressemblent à des défauts et n'en sont pas :

- **« plan ambigu — `X` visé à la fois par `A` et `B` »** : deux fichiers renomment le même mot vers
  deux cibles. C'est licite (§4.5) — il faut **épingler** les entrées concernées avec `@ligne`, et
  les lignes s'entendent sur l'état d'AVANT (le contrôle lit `git show HEAD:`).
- **« aucune liaison de ce nom avant » sur un fichier d'un lot antérieur** : le contrôle compare au
  `--base` (HEAD par défaut). Un fichier déjà modifié par un lot précédent doit être contrôlé avec
  le plan **CUMULÉ** de tous les lots qui l'ont touché, pas avec le dernier.
- **« `X` : n liaisons de plus, le plan en promettait m »** entre fichiers sans rapport : un
  renommage global promet un gain dans CHAQUE fichier du plan. Quand deux fichiers du plan ne
  partagent aucun symbole, **les contrôler séparément** rend le verdict juste. Quand ils en
  partagent, les garder ensemble — sinon un import renommé passe pour un symbole écrasé.

Ce que le contrôle ne voit pas : le cas 2 du §5. **Il valide un plan qui a produit la régression** —
parce que la transformation demandée est exactement celle qui a eu lieu. C'est la garde de collision
qui protège, en amont, et rien d'autre.

## 7. Pièges vécus

- **Un offset relevé AVANT la première édition désigne ensuite un autre symbole.** `symbole()` s'est
  retrouvée nommée `state()`, homonyme de son propre paramètre, **sous un typecheck vert**. D'où la
  recollecte à chaque tour dans l'outil — ne jamais réutiliser un relevé de positions.
- **`--dry` compte les déclarations, pas les entrées du plan.** Un nom porté par quatre déclarations
  en fait quatre ; comparer les SYMBOLES entre `--dry` et l'application, jamais les sites.
- **Un renommage qui « ne fait rien » est un avertissement, pas un succès.** L'outil énumère les
  entrées sans effet ; les lire.
- **Un test dont le nom de FICHIER porte le symbole se renomme avec lui** — sinon le dossier de
  tests désigne des fonctions qui n'existent plus.
- **Ces scripts vivent dans un skill, à quatre niveaux de la racine.** Ceux qui balaient le dépôt la
  trouvent en REMONTANT jusqu'à `.git` : un `path.resolve(dirname, "..")` désignerait le dossier du
  skill et rendrait « 0 identifiant » — un vert parfaitement faux. Toute reprise doit garder cette
  résolution.

## 8. Gate — comment on prouve

| Preuve                                                   | Ce qu'elle ferme                                 |
| -------------------------------------------------------- | ------------------------------------------------ |
| `check-identifier-language` : 0 constat sur le périmètre | plus rien de ce que le dictionnaire connaît      |
| `check-rename-drift` vert sur les plans (§6)             | aucun symbole n'a dérivé vers un autre nom       |
| `check-literals-unchanged` vert                          | aucun message affiché n'a bougé                  |
| `npm run typecheck -- --force` à la RACINE               | les consommateurs des autres paquets suivent     |
| La suite du module, **avec son infra**                   | ce que le typecheck ne voit pas (`any`, chaînes) |
| `rg` de l'ancien nom dans TOUT le dépôt, `--hidden`      | les quatre familles hors TypeScript (§5.5)       |
| `rg 'as <ancienNom>'` dans le barrel                     | l'alias qui annulait la rupture (§5.3)           |

**Le compte dans un `.d.ts` publié ne prouve rien** — le barrel n'y expose qu'une poignée de
symboles, et ce compte vaut souvent 0 avant tout travail.

## 9. Les scripts de ce skill

| Script                                                                                       | Ce qu'il fait                                                                                                         |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| [`scripts/check-identifier-language.mjs`](scripts/check-identifier-language.mjs)             | Le gate : relève les identifiants français, avec fichier, ligne, compte et traduction proposée. Exceptions déclarées. |
| [`scripts/check-identifier-language.test.mjs`](scripts/check-identifier-language.test.mjs)   | Ses 66 tests.                                                                                                         |
| [`scripts/bench-identifier-language.mjs`](scripts/bench-identifier-language.mjs)             | Le passe sur du code tiers anglais : prouve qu'il n'accuse personne à tort.                                           |
| [`scripts/identifier-language-dictionary.json`](scripts/identifier-language-dictionary.json) | Le dictionnaire, lu par le gate et par le banc.                                                                       |
| [`scripts/rename-identifiers.mjs`](scripts/rename-identifiers.mjs)                           | Renomme par le LanguageService depuis la DÉCLARATION. Plan JSON, `--dry`, `"nom@512"` pour une ligne précise.         |
| [`scripts/rename-identifiers.test.mjs`](scripts/rename-identifiers.test.mjs)                 | Ses 3 cas — les deux régressions silencieuses du §5, et la garde de collision tenue honnête.                          |
| [`scripts/check-rename-drift.mjs`](scripts/check-rename-drift.mjs)                           | Confronte le résultat au plan, liaison par liaison.                                                                   |
| [`scripts/check-literals-unchanged.mjs`](scripts/check-literals-unchanged.mjs)               | Prouve qu'aucune chaîne affichée n'a changé. `--except <fichier>` pour un cas justifié, nommé à l'appel.              |

Aucun n'est câblé au `package.json` : ce sont des outils de chantier, lancés sciemment, dont le
résultat n'a de sens qu'avec le protocole ci-dessus. Le jour où le chantier de langue se ferme, le
skill part avec ses scripts, sans laisser de script npm orphelin derrière lui.
