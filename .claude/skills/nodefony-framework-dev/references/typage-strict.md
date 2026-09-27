# Durcir le typage par cliquet — options du compilateur et codemods

> _Maintenance_ : vérité COURANTE, éditée en place ; l'historique vit dans `git log`.

Le dépôt pose, sur **tout** tsconfig non-gabarit, des options plus sévères que `strict` :
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `isolatedModules`,
`noUncheckedSideEffectImports`, `allowUnreachableCode: false`, `allowUnusedLabels: false` (table
`REPO_ONLY` du gate `src/nodefony/src/tests/tsconfigStrictness.test.ts`). Les gabarits
d'application et de module restent sur `strict` seul — le framework paie la rigueur parce que son
code tourne chez tout le monde, le code métier d'une application n'a pas à la payer par défaut.

Ce gate est le **registre des décisions** : les dispenses (`REPO_ONLY_EXEMPT` — le front React du
Studio n'a pas `exactOptionalPropertyTypes`, une prop `undefined` y valant une prop absente) et
les options REFUSÉES (`REFUSED`), chacune avec sa mesure et son motif. Ne pas les reproposer sans
fait nouveau.

## La méthode (un cran = un paquet)

1. **Mesurer sans rien écrire** : `npx tsgo --noEmit -p <tsconfig> --<option>` depuis la racine
   (les chemins sortent relatifs à la racine, donc dédoublonnables — lancé depuis le dossier du
   paquet, un même site apparaît sous plusieurs chemins `../`).
2. **Corriger dans l'ordre du graphe** : cœur, orm-core, user, http + security (ensemble : leurs
   tests compilent les sources l'un de l'autre), framework, ORM, le reste, puis le front Studio.
   **Rebâtir chaque paquet avant le suivant** : un consommateur lit les `.d.ts` de `dist/types`,
   pas la source — sans rebuild, il voit l'ancien type et l'erreur « persiste ».
3. **Aucun `!` en production.** Formes admises : `for…of`, déstructuration avec défaut ou garde,
   `.at()`, types rendus honnêtes. Les tests reçoivent leurs `!` par l'automate.
4. **Poser l'option, étendre le gate, le voir ROUGE** (retirer l'option d'un tsconfig → le gate
   tombe), puis typecheck + lint + suites.

## Les deux automates — `scripts/typing/`

| Script                                                                                                              | Option                       | Ce qu'il fait                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`scripts/typing/exact-optional.mjs`](../scripts/typing/exact-optional.mjs) `<tsconfig>…`                           | `exactOptionalPropertyTypes` | Pour chaque diagnostic, trouve les propriétés OPTIONNELLES de la cible qui reçoivent une valeur pouvant valoir `undefined`, et ajoute `\| undefined` à leur type déclaré. Remonte d'un `.d.ts` de `dist/types` vers la déclaration SOURCE. Point fixe par tours. |
| [`scripts/typing/non-null-index.mjs`](../scripts/typing/non-null-index.mjs) `<tsconfig> [--write] [--only=<regex>]` | `noUncheckedIndexedAccess`   | Pose `!` sur le nœud EXACT de chaque diagnostic — réservé aux TESTS (défaut `--only` = fichiers de test).                                                                                                                                                        |

Lancer depuis la racine du dépôt, formater ensuite (`npx prettier --write` sur les fichiers
modifiés), puis REMESURER : l'automate rend un compte, pas une preuve.

### Pourquoi `| undefined` plutôt qu'un étalement conditionnel

`{ ...(x !== undefined && { x }) }` alloue un objet par appel, dans le chemin de requête ; et la
valeur `undefined` passée explicitement est déjà ce que le code produit. Élargir le type DIT la
vérité sans rien coûter à l'exécution. Exception : quand la PRÉSENCE de la clé porte un sens
(`"total" in page`, `Object.keys`), vérifier les lecteurs avant d'élargir.

### Pièges déjà payés

- **Le correctif natif de TypeScript (`addOptionalPropertyUndefined`) ne se déclenche PAS** sur un
  littéral passé en argument ni sur une classe qui implémente une interface — d'où l'automate maison.
- **Insertions imbriquées** : élargir `a?: { b?: T }` touche deux nœuds emboîtés. Appliquer les
  éditions comme des insertions PONCTUELLES triées par position décroissante — trier par début de
  nœud décale la fin du nœud externe (vécu : `string | undefi | undefinedned`, un `| undefined`
  posé après un commentaire). Contrôle après chaque passe : `tsgo` sans erreur `TS1xxx`.
- **Un membre hérité d'une lib** (`Error.stack`, options Node) ne s'élargit pas : garder
  l'affectation (`if (x !== undefined) e.stack = x`).
- **Un type générique indexé** (`Services[K]`) ne porte pas le `undefined` d'une propriété
  optionnelle : l'écrire dans le type de retour (`Services[K] | undefined`), interface ET classe.
- **Mesurer une option à valeur** (`--allowUnreachableCode false`) : sous zsh, `$o` non découpé
  passe « option + valeur » en UN argument — tsgo refuse, et la boucle compte un faux « 1 site »
  par tsconfig. Contrôler une mesure suspecte sur un seul tsconfig, sortie brute.
- **Poser une option par `sed` après une ancre** : un tsconfig dont l'ancre est la DERNIÈRE clé
  (sans virgule) est sauté en silence — vécu sur le front du Studio. Recompter les tsconfig qui
  portent l'option ; le gate le fait, à condition de l'avoir étendu d'abord.
- `non-null-index.mjs` a posé `!!` sur un nom de propriété et après une parenthèse — relire les
  sites `!!` et `)!` après chaque passe.
