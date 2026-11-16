# Les formateurs — un gabarit rendu doit sortir déjà formaté

> Détail chargé à la demande depuis le `SKILL.md` (§ « Les formateurs »). Vérité courante — éditer en place, historique = `git log`.

## Le formateur de l'application refuse ce que le générateur lui donne

Cinquième panne du même genre, et la plus silencieuse : une application
fraîchement générée arrivait avec **sept fichiers** que son propre
`npm run format` réécrivait au premier passage — `AGENTS.md`, `README.md`,
`env.ts`, `nodefony.config.ts`, `package.json`, `.oxlintrc.json`,
`tests/e2e.test.ts`. Rien ne le signalait : le dépôt ne formate pas les `.tpl`
(prettier ignore les extensions qu'il ne connaît pas), et les assertions
lisent des chaînes, pas une mise en forme.

```bash
npm run format:scaffold            # les trois variantes
npm run format:scaffold -- --diff  # ce que prettier changerait, ligne à ligne
npm run format:scaffold -- --keep  # conserve les apps générées pour inspection
```

**Trois variantes, et pourquoi celles-là** (`scripts/scaffold/check-scaffold-format.mjs`) :
`complete+react` allume tout ce qui est conditionnel, `minimal` n'en allume
rien — une non-conformité qui n'apparaîtrait que dans un cas intermédiaire
supposerait un contenu présent dans NI l'un NI l'autre. La troisième,
`nom-long`, est le seul régime qui exerce **les lignes dont la longueur dépend
d'une valeur interpolée** : `content="<nom> — application Nodefony."` tient sur
une ligne pour `probe` et doit être éclatée pour un nom de vingt caractères.
Sans elle, on livre un rendu conforme aux noms courts seulement.

**Quatre pièges, tous payés au moins une fois :**

| Symptôme                                                | Cause                                                                                                                                                                                                                                                          | Le geste                                                                                                                                                  |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Une table markdown revient toujours non conforme        | prettier impose l'alignement canonique, calculé sur la cellule la plus large — donc sur un contenu qui n'existe que dans certaines variantes                                                                                                                   | **une table à lignes conditionnelles devient une LISTE** ; aucun alignement écrit à la main ne peut être juste pour toutes                                |
| Un `prettier --write` sur un `.tpl` markdown            | il lit une balise eta suivie d'une barre verticale comme une CELLULE, et en injecte d'autres                                                                                                                                                                   | ne formater directement QUE les gabarits sans balise (`npm run format:templates`)                                                                         |
| Formater un gabarit À BALISES « pour bien faire »       | prettier formate le texte qu'il voit ; une fois les balises remplacées, les lignes changent de longueur et la forme canonique n'est plus la même — **le rendu peut se DÉGRADER** (vécu : deux fichiers de test acceptés par le gate en sont ressortis refusés) | corriger à la main en lisant le RENDU (`format:scaffold -- --diff`), jamais la source ; `npm run format:templates` ne traite QUE les gabarits sans balise |
| Une correction du moteur reste sans effet               | le CLI s'exécute depuis `dist` ; un gabarit se lit au disque, pas le moteur                                                                                                                                                                                    | **build avant de mesurer** — sinon on conclut sur du code inchangé                                                                                        |
| Deux lignes vides ou zéro autour d'un bloc conditionnel | la newline vit du mauvais côté de la balise                                                                                                                                                                                                                    | placer la ligne vide **DANS** le bloc (`…\n\n<% } %>## Titre`), jamais après                                                                              |

**Ce que le script ne peut pas rendre conforme, et pourquoi ce n'est plus un
problème** : la forme canonique d'une ligne dépend souvent d'un identifiant que
l'utilisateur choisit. `content="<nom> — application Nodefony."` tient sur une
ligne pour `probe` et doit être éclatée pour un nom de vingt caractères ;
`export type ReportingMensuelConfigInput = z.input<…>` fait 87 colonnes, et
tiendrait sous 80 pour un module nommé `blog`. Un gabarit rend UNE forme : aucune
écriture ne peut être juste pour tous les noms. Ce n'est pas un cas particulier —
c'est la règle, puisque presque tout ce qu'un générateur produit porte un nom
dérivé.

**C'est donc le RÉSULTAT qui est mis en forme, avec le prettier du projet.**
`create` formate ce qu'il écrit : dans la transaction quand le projet est déjà
installé (`create module|entity|service|command|controller`, où le dry-run
montre alors le texte exact qui sera écrit), et juste après `npm install` pour
`create app`, dont les dépendances n'existent pas encore au moment où ses
fichiers sont rendus. Le coût qui avait fait écarter cette solution — embarquer
prettier dans le CLI — n'existait pas : l'application générée a DÉJÀ prettier en
dépendance de développement. Prettier absent (`--no-install`, registre
injoignable) : les fichiers sont écrits tels quels et `unformatted` le dit.

> 🔴 **Un rouge PERMANENT cache les vrais défauts.** Tant que ces cas faisaient
> échouer le gate, on lisait son rouge comme « les cas connus » — et `App.tsx` a
> pu accumuler **onze** écarts que personne n'a vus, livrés tels quels. Le gate
> CONSTATE désormais qu'une non-conformité dépend du nom (sa première ligne
> fautive porte le nom de l'application), la nomme, et n'échoue que sur le reste.
> Il garde ce qui lui reste à garder : la forme des GABARITS, et le cas où
> l'installation échoue — c'est alors le rendu brut que l'utilisateur reçoit.

## Deux formateurs, et ce qu'aucun des deux ne regarde

```bash
npm run format:templates            # les gabarits SANS balise, formatés à la SOURCE
npm run format:templates -- --check # sort 1 si l'un d'eux changerait
```

| Gabarits                                     | Qui juge leur forme                                                              |
| -------------------------------------------- | -------------------------------------------------------------------------------- |
| sans balise eta                              | `format:templates`, sur la source — c'est exact                                  |
| à balises, rendus par `create app`           | `format:scaffold`, sur le RENDU des 3 variantes                                  |
| à balises, appartenant à un AUTRE générateur | **personne** — 29 gabarits : module, controller, entity, front, service, command |

`format:templates` **refuse** délibérément un gabarit à balises : formater sa
source ne rend pas son RENDU conforme et peut le DÉGRADER (deux fichiers de test
acceptés en sont ressortis refusés). Le script nomme lui-même les 29, groupés par
générateur, à chaque exécution : un « 0 à reformater » ne veut pas dire « tout est
propre », mais « propre là où je regarde ». Ces 29 ne sont plus livrés bruts — le
formatage à la génération les couvre — mais leur forme reste celle qu'on LIT dans
le dépôt.

> ⚠️ Deux instruments mentent en silence quand on mesure ça soi-même. Prettier
> lancé sur une copie sous `tmp/` ne traite RIEN — le `.prettierignore` du dépôt
> écarte ce dossier, et la commande sort 0 sans avoir lu le fichier. Et le gate
> formate depuis le dossier de l'app générée (`cwd: dest`) : c'est la seule cible
> dont le verdict vaille.
