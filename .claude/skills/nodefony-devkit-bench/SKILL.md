---
name: nodefony-devkit-bench
description: Éprouve ce que le scaffold de Nodefony PRODUIT, par trois mesures — le code généré tient-il debout (compilation, tests, HTTP réel), un agent lâché dans une application fraîche découvre-t-il l'outillage au lieu de deviner, et le modèle de données d'un vrai logiciel libre est-il exprimable avec la grammaire de champs. Vise DEUX buts : que l'agent n'invente rien qu'un générateur produise, et qu'il y arrive en un minimum de TOURS (tours, durée et coût sont dans le transcript). À charger AVANT de déclarer finie une évolution des gabarits ou du moteur de génération : les assertions du dépôt lisent des chaînes dans des fichiers rendus, elles ne voient pas qu'un type généré ne compile pas. Porte l'interprétation des échecs et l'auto-contrôle des juges. Déclencheurs - "j'ai modifié le scaffold", "le code généré compile-t-il ?", "est-ce que create entity marche encore ?", "rejouer le banc devkit", "l'agent trouve-t-il les générateurs ?", "un vrai schéma est-il exprimable ?", "combien de tours a pris l'agent ?".
metadata:
  version: 1.3.0
---

# nodefony-devkit-bench — prouver ce que le scaffold produit

> **Maintenance** : ce fichier décrit la vérité COURANTE des trois bancs. Mettre à
> jour = éditer la section concernée en place. Pas de journal, pas de date :
> l'historique vit dans `git log`, l'avancement dans les **tickets**.

## Les DEUX buts — ne pas inventer, et ne pas tourner en rond

Le premier but est celui qu'on cite toujours : **l'agent ne doit rien inventer**
qu'un générateur produit déjà. Le second est aussi important, et il se rate parce
qu'aucune sonde ne le regarde : **il doit y arriver en un minimum de TOURS.**

Un devkit qui obtient la bonne réponse au bout de trente allers-retours a échoué
autrement — plus lentement, plus cher, et sur un fil : chaque tour est une
occasion de partir dans une impasse, et un agent qui tourne en rond finit par
abandonner l'outil pour écrire à la main. Le nombre de tours n'est donc pas une
métrique de confort, c'est **le même défaut vu par l'autre bout** : ce que l'agent
ne trouve pas du premier coup, il le cherche — ou il l'invente.

Chaque tâche le mesure déjà, sans rien à instrumenter : le transcript porte un
enregistrement final.

```bash
jq -r 'select(.type=="result") | {num_turns, duration_ms, total_cost_usd}' \
  <runDir>/task-<n>.transcript.jsonl
```

**Détail : [`references/methode-de-mesure.md`](references/methode-de-mesure.md)** — trois
résultats mesurés, valables pour les trois bancs : la variance écrase l'écart d'un run à
l'autre (médiane de ≥ 3 runs obligatoire), le modèle par défaut choisi conditionne si le banc
peut seulement VOIR un trou, et un générateur livré abaisse le poids de modèle nécessaire pour
développer avec le framework.

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

### Le formateur de l'application refuse ce que le générateur lui donne

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

**Trois variantes, et pourquoi celles-là** (`scripts/check-scaffold-format.mjs`) :
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

### Deux formateurs, et ce qu'aucun des deux ne regarde

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

## Banc de vérité — le code généré tient-il debout ?

```bash
node .claude/skills/nodefony-devkit-bench/scripts/verify-generated.mjs
node .claude/skills/nodefony-devkit-bench/scripts/verify-generated.mjs --no-e2e  # plus rapide
node .claude/skills/nodefony-devkit-bench/scripts/verify-generated.mjs --keep    # garder le décor
node .claude/skills/nodefony-devkit-bench/scripts/verify-generated.mjs --link    # boucle courte, verdict amputé
node .claude/skills/nodefony-devkit-bench/scripts/verify-generated.mjs --database postgres  # le MÊME banc, un autre moteur
```

### Les trois moteurs — une application PAR moteur, jamais une variable

`--database <sqlite|postgres|mysql|mariadb>` change le moteur de l'application
témoin, et il faut bien qu'il la RECRÉE : le dialecte est une décision prise à
la création, les entités sont écrites pour lui (`createXTable("postgres")`), et
l'ORM refuse de démarrer sur un autre en nommant l'entité fautive. Pointer une
application SQLite vers un serveur PostgreSQL n'éprouve donc rien — c'est
pourquoi `NF_E2E_DATABASE_URL` ne suffit pas, et pourquoi la forge lance trois
passes plutôt qu'une matrice de variables.

Ce que cela a déjà trouvé, et qu'aucune passe SQLite ne pouvait voir : un
échantillon de clé étrangère écrit en TEXTE (`author-1`) face à une colonne
`uuid` — chaque POST rendait 500 en PostgreSQL, pendant que SQLite, où un `uuid`
et un texte sont le MÊME type, restait vert de bout en bout.

**Le décor, sur un moteur serveur : TROIS bases, et c'est structurel.** Une
suite de tests ne fabrique pas sa base — `CREATE DATABASE` est un privilège
d'administration que l'utilisateur applicatif n'a pas (constaté sur MySQL :
`GRANT ALL ON <base>.*` et rien d'autre). Le décor les fournit, ici comme dans
le compose que le générateur écrit :

| Base              | Rôle                                                            |
| ----------------- | --------------------------------------------------------------- |
| `app`             | le développement — celle que le `.env` généré joint             |
| `app_e2e`         | la suite e2e, jamais celle du développement                     |
| `app_e2e_scratch` | la base VIERGE de la suite de migrations (salie, remise à zéro) |

Les noms se dérivent une seule fois (`resolveDatabase`, `engine.ts`) ; le
serveur doit porter le rôle `app` / `app-dev`. À la forge, le job `dialectes`
de `scaffold.yml` les crée ; en local, une fois pour toutes sur le conteneur du
compose. Sans elles, l'étape e2e tombe en nommant la base absente.

**Prérequis : le checkout est BÂTI** (`npm run build`). Les tarballs sont
fabriqués depuis le `dist/` local : le banc éprouve ce que tu viens de compiler,
mais **tel qu'un installeur le reçoit**.

> **Il tourne tout seul à la forge, sur les TROIS systèmes** —
> `.github/workflows/scaffold.yml`, matrice `ubuntu · macos · windows` sur le
> plancher `engines` (Node 24, la version que pose la CI générée pour
> l'application de l'utilisateur), plus une variante haute sur ubuntu. Le lancer
> à la main sert à la boucle courte et au diagnostic, plus à obtenir le verdict :
> il arrive à chaque poussée. **Ce que ce job n'éprouve pas** est nommé dans
> [`docs/guides/integration-continue.md`](../../../docs/guides/integration-continue.md)
> § 6 : le front d'une application générée, et les dialectes autres que SQLite.

> **Un job rouge doit se diagnostiquer SANS remonter le décor** — il pèse
> ~300 Mo et la machine qui l'a produit est jetée à la fin du job. Ce qui part
> en objet déposé (`if: failure()`) : le journal du banc, `report.json`,
> `echec.log` (la sortie ENTIÈRE de la commande tombée), le journal du serveur
> détaché de l'application témoin, l'état de son manifeste — et, sur les
> moteurs serveur, le **journal des conteneurs de base**. Ce dernier n'est pas
> un supplément : la cause d'un échec PostgreSQL tenait en une ligne côté
> serveur, que le banc ne pouvait pas voir depuis son client.
>
> Et l'extrait affiché dans le journal du job n'est plus « la fin de la
> sortie ». Une commande qui échoue derrière une barre de progression noyait sa
> propre cause : les derniers caractères ne portaient que
> `[⣷] 0 views fetching`. `scripts/lib/extrait-echec.mjs` déplie les réécritures de
> ligne, retire l'ANSI, garde les lignes qui NOMMENT l'échec **en plus** de la
> queue, et DIT combien de lignes il écarte — un extrait muet se lit comme une
> sortie complète. Son auto-contrôle rejoue l'ancienne règle sur les sorties
> réelles qui ont produit le défaut.

> **Le décor de ce banc est ISOLÉ, et ce n'est pas un détail d'exécution.**
> Longtemps il vivait sous le dépôt, paquets liés au checkout — la résolution de
> modules de Node remontait alors jusqu'aux `node_modules` du monorepo, et
> l'application témoin trouvait des paquets **qu'elle ne déclare pas**. Mesuré :
> l'étape production restait verte avec ET sans `@node-rs/argon2`, pendant qu'une
> application réellement installée mourait au boot sur cette dépendance. Ce n'est
> pas un cas particulier mais une **famille entière** — toute dépendance absente
> du gabarit était indétectable ici. Le décor sort donc du dépôt et s'installe
> depuis les tarballs (`scripts/lib/isolation.mjs`, partagé avec le banc de
> découvrabilité), et l'isolation est **constatée** avant la première mesure.
> `--link` reste pour la boucle courte : le rapport enregistre alors le décor
> (`decor`) et l'étape production ne vaut plus preuve.

Les étapes, dans l'ordre, et ce que chacune protège :

1. **décor** — application témoin isolée (hors dépôt, tarballs dépaquetés),
   isolation constatée, ports dédiés ;
2. **service + commande** — `create service`, la méthode d'exemple **remplacée**
   (le geste que le gabarit réclame), puis `create command --service` : la
   commande doit appeler la méthode NOUVELLE, et le service être enregistré ;
3. **génération** — cinq entités qui exercent toute la grammaire (unique,
   énumération avec défaut, entier avec défaut, index simple et composite,
   unicité composite, tailles de colonne, relation), dont deux émises pour
   PostgreSQL ;
4. **module** — `create module` : workspace npm, manifeste, entité déposée
   dedans (ce qu'il tient comme PAQUET est jugé plus loin, après le build) ;
5. **compilation** — l'étape qui manquait : un type faux ne se voit pas dans une
   assertion de chaîne ;
6. **le code des `AGENTS.md` compile** — les expressions citées dans les
   documents que l'agent lit d'office sont replacées dans leur classe de base
   et soumises au compilateur : un exemple faux AGIT (`this.context.cspNonce`
   sans le `?.` a été recopié à la lettre par trois agents, typecheck rouge
   3/3) ;
7. **lint du code généré** — un avertissement n'est ni une erreur de type ni une
   chaîne absente : rien d'autre ne le voit. La grille du dépôt est COPIÉE dans
   l'app (les motifs d'exclusion se résolvent depuis le dossier de la config —
   le `tmp/**` du dépôt écartait tout le décor lié, et l'étape rendait vert sans
   rien lire). L'étape se prouve d'abord sur un témoin fautif, puis juge ;
8. **décâblage** — les entités PostgreSQL quittent le manifeste : leur schéma
   enregistré sur un connecteur SQLite ferait échouer le boot, et cet échec ne
   dirait rien du générateur. Leurs fichiers restent — c'est leur type qu'on lit ;
9. **cohérence FK ↔ PK** — une colonne de référence doit avoir le type de la clé
   visée, sinon la jointure est refusée par le moteur ;
10. **build** — le runtime charge le `dist/` : sans lui, une entité neuve est
    invisible du serveur (cause n°1 des « ma route répond 404 ») ;
11. **le module généré tient debout comme un PAQUET** — il compile avec SON
    tsconfig (témoin fautif d'abord : un typecheck qui ne lit rien rend vert),
    ses tests passent, ses types se résolvent depuis l'APPLICATION, et une clé
    de configuration mal orthographiée est REFUSÉE. Ce dernier point a trouvé un
    défaut de produit : le gabarit levait une `Error` ordinaire, absorbée par le
    fail-soft du kernel — `use("@app/blog", { gretting: … })` laissait
    l'application démarrer en IGNORANT ce qui avait été écrit ;
12. **la commande s'exécute** — elle est lancée pour de vrai, et sa SORTIE est
    lue ;
13. **tests générés** — couche donnée ;
14. **HTTP réel** — 201 + `Location`, 422, 409 sur doublon, page `hasNext`,
    PATCH, 204 puis 404 ; et, pour la liste, les deux faces de chaque
    capacité : le **refus** (tri hors allowlist, paramètre inconnu, valeur mal
    formée) **et l'effet** (le tri ordonne, le filtre filtre) — voir l'encadré
    ci-dessous, un `ORDER BY` mort passait les refus sans broncher ;
15. **production** — l'app démarre dans le mode qu'aucune autre étape n'exerce,
    et sert DEUX routes : celle de l'application et celle d'un MODULE — un module
    qui se charge sans monter ses routes rendait 404 sans un mot ;
16. **inspection** — l'application se laisse lire sans ouvrir de port.

> **Le trou n'était pas dans le banc d'agent, il était ici.** Sur les sept types
> de `create`, ce script n'en exerçait que trois — `app`, `module`, `entity` ;
> `controller` l'est indirectement (`create module --controller rest`), mais
> `service`, `command` et `front` : rien. Or sa raison d'être est « le code
> généré tient debout », et c'est exactement par là qu'un défaut est passé :
> `create command --service` **exigeait la méthode `greet()` du gabarit**, que ce
> même gabarit dit de remplacer — suivre le conseil cassait la commande, sur un
> message qui réclamait une méthode d'exemple. D'où l'étape 2, qui fait le geste
> réclamé avant de générer. **Reste `front`, non couvert** (il tirerait un
> écosystème Vite complet dans le décor).
>
> **Et l'étape 12 juge la SORTIE, pas le code de retour** : le gabarit journalise
> « service non enregistré » puis rend la main NORMALEMENT. Vérifié en
> débranchant `@services([…])` — la commande sort **0** sans écrire une ligne de
> JSON. Un banc qui aurait lu le code de retour aurait été vert sur une
> application dont le service n'existe pour personne.

> **Prouver un REFUS ne prouve pas la CAPACITÉ — ce sont deux tests.** La suite
> générée éprouvait « un tri sur un champ non déclaré est refusé » et « une
> valeur de filtre mal formée est refusée », et s'arrêtait là. Un `ORDER BY`
> mort passe ces deux-là sans broncher : mesuré en débranchant le tri dans le
> décor, le test de refus est resté **vert**. D'où deux assertions de plus, et
> la façon de les écrire, qui n'est pas évidente :
>
> - **le tri** se lit en trois affirmations, pas une — le champ est PRÉSENT
>   dans la réponse (sinon on ordonne des `undefined`, qui forment une suite
>   parfaitement triée dans les deux sens — vécu sur une autre suite), ses
>   valeurs sont DISTINCTES (une colonne constante rend « trié » l'ordre que la
>   base a choisi seule), et `DESC` est l'inverse EXACT d'`ASC` sur une page qui
>   contient tout (`hasNext === false`, sinon les deux sens portent sur des
>   ensembles différents) ;
> - **le filtre** exige une ligne TÉMOIN qui ne matche pas. Sans elle,
>   « toutes les lignes rendues portent la valeur demandée » reste vrai avec le
>   filtre débranché, puisque tous les échantillons portent la même valeur.
>   C'est le témoin qui fait le test, pas l'assertion.
>
> Les deux ne sont donc émis que si l'entité s'y prête (`filterProbe`,
> `malformedProbe`, `sortProbe` — moteur) : un booléen ou une énumération à deux
> valeurs offrent un contraire, un filtre `"string"` ne refuse RIEN. Viser
> aveuglément le premier filtre déclaré faisait exiger le refus d'une valeur
> valide sur toute entité dont le seul filtre est une clé étrangère textuelle —
> le banc mettait alors en défaut le générateur au lieu de l'éprouver.

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
# TOUS les contrôles internes du banc, en UNE commande — avant de conclure quoi que ce soit
node .claude/skills/nodefony-devkit-bench/scripts/selftests.mjs --prove
# La remise à zéro du décor sur un run RÉEL — le lot la joue sinon sur un décor jetable :
node .claude/skills/nodefony-devkit-bench/scripts/reinit-decor.selftest.mjs <runDir>
node .claude/skills/nodefony-devkit-bench/scripts/bench-discoverability.mjs
node .claude/skills/nodefony-devkit-bench/scripts/bench-discoverability.mjs --task 1
```

> ⚠️ **Un drapeau inconnu ne lance plus rien** — il rend l'usage et sort en `64`.
> Tant que le banc ignorait ce qu'il ne comprenait pas, un `--help` (qui n'existait
> pas) ou une faute de frappe déroulait le catalogue ENTIER avant qu'on s'en
> aperçoive : des dizaines de minutes d'agents payées pour une lettre en trop.
> `--help` liste maintenant les drapeaux, les variables de décor et les codes de
> sortie. **Une seule implémentation la porte** (`scripts/lib/argv.mjs`), et les quatre
> scripts qu'on tape s'y branchent — les deux bancs de vérité montent un décor
> complet, celui de découvrabilité déroule de vrais agents.
>
> Écrite à la main dans un seul banc, cette garde avait aussitôt recalé
> `--setup-only` : un drapeau que le fichier documentait ET traitait, mais que sa
> liste blanche ignorait. `scripts/lib/argv.selftest.mjs` confronte donc, pour chaque
> script, les drapeaux qu'il LIT à ceux qu'il DÉCLARE — sans exécuter aucun banc,
> en les appelant avec un drapeau bidon EN PREMIER, ce qui fait sortir la garde
> avant que rien ne soit monté. Il a trouvé `--etage` le jour où il est né.

> **Plus aucun contrôle n'est hors du lot.** Deux l'étaient, chacun avec son
> motif écrit — l'un « exige le chemin d'un run déjà consommé », l'autre « exige
> une application démarrée et une porte MCP ouverte ». Nommer un trou n'est pas
> le fermer : ni script npm, ni forge, ni le lot ne les appelaient, et ils
> gardaient précisément ce qui casse sans bruit (la remise à zéro entre deux
> tâches, la validité du jeton pendant tout un run). Le premier monte désormais
> un décor JETABLE quand on ne lui donne pas de run — son `.gitignore` est COPIÉ
> du gabarit du produit, jamais réécrit de tête, puisque c'est lui que le
> contrôle éprouve. Le second n'exigeait RIEN : relu, il ne fait aucun appel
> réseau et rend 10/10 en une seconde. **Une exclusion écrite une fois n'est
> jamais relue ; elle survit à ce qui la justifiait.**
>
> 🔴 **Un contrôle que personne ne lance ne garde rien.** Ces sondes étaient
> écrites, justes, et énumérées ici une par une — donc jamais exécutées :
> personne ne tape autant de commandes avant de conclure. Ce que ça a coûté, en
> une fois : `imputation.selftest.mjs` portait déjà le contrôle d'exhaustivité
> « toute cause émise par un juge est-elle classée ? », capable de nommer les
> quinze causes que trois juges neufs émettaient sans qu'aucune ne soit
> classable. Pendant un mois, le banc a donc écarté des runs PAYÉS en disant
> « trou d'instrument » de ce que son propre juge nommait précisément.
> `selftests.mjs` existe pour rendre le lot atteignable d'une seule commande.
>
> Et le contrôle lui-même était **aveugle par sa forme** : il relevait les causes
> à la source par le motif `CAUSE=<nom>`, que les juges de première génération
> impriment eux-mêmes — mais un juge qui sépare la collecte du verdict REND
> `{ cause: "<nom>" }` et laisse l'impression à l'appelant. Balayer le dossier ne
> suffisait pas : c'est la FORME écrite qui décidait de ce qu'on voyait, et le
> compte affiché (« 86 émises, 85 classées ») donnait le change.

### Le DÉCOR d'un run : quel agent, et quelle porte MCP

Deux réglages indépendants décident de ce qu'un run mesure — **qui** travaille, et **ce qu'il
trouve en arrivant**. Les confondre produit des comparaisons fausses : un agent mieux outillé
qu'un autre n'est pas un agent meilleur.

```bash
B=.claude/skills/nodefony-devkit-bench/scripts/bench-discoverability.mjs

NF_DEVKIT_BENCH_MCP=auth node $B --task 9          # porte authentifiée ET app démarrée
NF_DEVKIT_BENCH_MCP=off  node $B --task 9          # l'agent ignore qu'une porte existe

NF_DEVKIT_BENCH_AGENT=vibe NF_DEVKIT_BENCH_MODEL= \
  NF_DEVKIT_BENCH_AGENT_ARGS="--output streaming --yolo --trust -p" \
  NF_DEVKIT_BENCH_MCP=auth node $B --task 9        # un AUTRE agent, foyer jetable
```

`NF_DEVKIT_BENCH_MCP` : `eteint` (défaut — porte déclarée, **application arrêtée** : le cas réel
« j'ouvre un dépôt, rien ne tourne ») · `auth` (jeton émis **et** application démarrée — les deux
vont ensemble : la porte est une ROUTE) · `off`. Le régime entre dans le décor enregistré, donc le
dépistage refuse de comparer deux régimes. Le défaut reste `eteint` : la référence a été établie
dessus.

**Ce que ces runs coûtent en pièges** — audience à déclarer, build AVANT l'émission du jeton,
démarrage APRÈS la prémisse (sinon la tâche n'est pas jouée), un code de sortie qui n'est pas un
verdict, l'ordre des drapeaux de Vibe, le foyer jetable qui doit emporter la clé d'API, et la sonde
qui comptait ROUGE un agent utilisant le MCP : **`references/agents-et-porte-mcp.md`** — à lire
AVANT de câbler un agent de plus (Codex et Gemini y ont leur ligne, à établir).

## Banc de conformité — l'application tient-elle les promesses du framework ?

```bash
node scripts/verify-generated.mjs --keep        # d'abord : monte le décor et l'éprouve
node scripts/verify-runtime.mjs                 # puis : la conformité, trois étages
node scripts/verify-runtime.mjs --etage unit    # un seul étage (unit | integration | e2e)
```

**Deux bancs, deux questions qu'on confond.** `verify-generated.mjs` demande « ce
qui a été PRODUIT tient-il debout ? » ; celui-ci demande « ce qui a été CÂBLÉ
tient-il les promesses ? ». Une application peut compiler parfaitement, démarrer
sans un mot, et servir une liste dont le client dicte la borne, une suppression
que personne n'a besoin d'autoriser, un controller déclaré dont aucune route
n'est montée.

Il **réutilise le décor** du banc de vérité (`--keep`) : monter le sien coûterait
une minute, et surtout il jugerait une AUTRE application que celle dont on vient
de prouver qu'elle compile.

| Étage         | Décor                                                     | Ce qu'il attrape SEUL                                                                                                                                         |
| ------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unit`        | aucun                                                     | balise de gabarit non résolue, `any`, service `@injectable` non déclaré, `process.env` hors catalogue                                                         |
| `integration` | l'app boote en entier, **zéro port** (`nodefony inspect`) | service non résolu au conteneur, controller déclaré sans route, collision méthode+chemin, route qui contourne le firewall, schéma qui ne produit pas de table |
| `e2e`         | serveur RÉEL, en production                               | CRUD complet (201+Location, 422, PATCH, 204→404), suppression sans identité, borne de pagination, `nosniff`, cookie HttpOnly+SameSite, WebSocket co-citoyen   |

Les suites vivent dans `suites/` (`harness.ts`, `conformite.unit.test.ts`,
`conformite.integration.test.ts`, `conformite.e2e.test.ts`) et sont **injectées**
dans l'application témoin, jouées, puis jetées avec le décor. Elles ne sont
**jamais livrées à l'utilisateur** : « ma commande porte-t-elle son namespace ? »
est une question du générateur, pas de l'application.

> 🔴 **Quatre GARDES anti-suite creuse, et elles ont mordu dès le premier run.**
> Chaque étage commence par un cas qui vérifie que la sonde a trouvé de quoi
> mesurer — des sources, des routes, une ressource REST, une identité. Sans
> elles, la famille CRUD entière rendait la main sur un `null` et comptait
> **quinze cas verts en 0 ms, zéro requête émise**. Le signe ne se voit que dans
> la colonne des durées, et jamais dans le total.

> ⚠️ **La sonde est le premier suspect, pas le produit.** Au premier run, dix cas
> sur onze accusaient le générateur — et tous étaient faux : les suites
> s'analysaient elles-mêmes, un contrôle de code lisait les commentaires,
> `nodefony check` tombait sur le serveur de développement du POSTE faute de
> ports dédiés, et `cluster` — une valeur de configuration — était compté comme
> un module manquant. Un seul défaut réel dans le lot.

### Lancer npm sur les trois systèmes — `scripts/lib/exec-portable.mjs`

Sous Windows, `npm` et `npx` sont des `.cmd`, et Node **refuse** de les
exécuter sans `shell: true` depuis le correctif de CVE-2024-27980. Il ne le dit
pas : il rend `spawnSync npm ENOENT`, qui se lit « npm n'est pas installé » — sur
un runner où `npm ci` vient de réussir. C'est ainsi que le premier passage
Windows du banc du code généré est tombé, à la première étape, pendant que linux
et macOS étaient verts.

La règle a **une seule** implémentation (`needsShell`), appelée par les deux
helpers d'exécution (`scripts/lib/isolation.mjs`, `scripts/verify-generated.mjs`). Elle est
**pure** — plateforme et grammaire de chemins injectées — parce qu'une fonction
qui lit `process.platform` ne s'éprouve que sur la plateforme qu'elle décrit,
c'est-à-dire jamais ici :

```bash
node scripts/lib/exec-portable.selftest.mjs           # les deux branches, partout
node scripts/lib/exec-portable.selftest.mjs --prove   # amputée, elle doit faire tomber 2 cas
```

> ⚠️ **Non couvert** : `bench-schema.mjs` et `bench-discoverability.mjs` ont leurs
> propres helpers et lancent de vrais agents — ils ne tournent pas en intégration
> continue, donc rien ne les éprouve sous Windows. Le défaut y est présent, et il
> est nommé plutôt que corrigé à l'aveugle.

### Rendre la page publique du banc

```bash
node .claude/skills/nodefony-devkit-bench/scripts/build-devkit-report.mjs [--data docs/devkit/data/10.0.0.json] [--out tmp/devkit.html]
```

**Ce rendeur ne MESURE rien**, et c'est le contrat : le banc lance de vrais
agents, coûte de l'argent et prend des heures ; sa sortie est **commitée** dans
`docs/devkit/data/<version>.json`. La page n'est qu'un rendu de ce jeu —
déterministe, rejouable, indépendant de la machine qui l'exécute. Même règle que
le site de performance, et pour le même motif : un chiffre reste attaché à sa
version, définitivement.

### Purger les décors — garder la MESURE, jeter le DÉCOR

```bash
node $B --purge              # ce qui serait libéré, sans rien toucher
node $B --purge --confirmer  # supprime les `app/`, garde tout le reste
```

Un run pèse ~300 Mo, dont **moins de 1 %** est la mesure : le reste est
l'application témoin et ses `node_modules`. Mesuré ici : **47 runs = 13 Go**,
pour 200 Mo de transcripts, verdicts de gates et rapports. Le décor se
reconstruit — c'est tout l'intérêt d'un décor jetable ; les transcripts, non.
Ce sont eux qui permettent d'INSTRUIRE un échec des mois plus tard sans repayer
un run, et deux faux rouges du banc ont été trouvés exactement comme ça.

🔴 **Le run que la référence cite garde son décor**, et ce n'est pas une
politesse : `--analyze-only` rejoue les gates SUR l'application — elle est
reconstruite et interrogée en HTTP. Sans son `app/`, le re-jugement gratuit
devient impossible et il faut repayer des heures d'agent. La purge le nomme et
l'écarte.

Le mode DIT par défaut et n'agit que sur `--confirmer` : c'est une suppression,
elle ne se déclenche pas par inadvertance.

### Dépistage — 1 run sur tout, 3 runs sur ce qui a bougé

Rejouer toutes les tâches trois fois à chaque changement coûte des heures et des
dizaines de dollars. Les rejouer **une** fois ne prouve rien : même gabarit,
même modèle, même décor, la tâche 14 a rendu **2 PASS / 2 FAIL**. La sortie
n'est ni l'un ni l'autre — c'est de comparer un run large à une **référence
écrite**, et de ne payer trois runs que sur le peu qui a bougé.

```bash
B=.claude/skills/nodefony-devkit-bench/scripts/bench-discoverability.mjs
node $B                                  # 1º le run large — c'est LUI qui coûte, et on le décide
node $B --depistage --analyze-only <run> # 2º le compare à baseline.json : gratuit, aucun agent
node $B --task 26 --runs 3               # les 3 runs, décor remis à zéro entre chaque
node $B --task 26 --runs 3 --enregistrer-reference   # fige le résultat dans la référence
node $B --analyze-only <run1>,<run2>,<run3>          # agréger des runs déjà joués
```

**Le dépistage ne produit pas la mesure qu'il compare — elle lui est DONNÉE.**
`--depistage` sans `--analyze-only` refuse en **78** et nomme les runs
comparables : il déroulerait sinon le catalogue entier avec de vrais agents
avant de comparer le rapport du run qu'il vient de payer. Et il ne choisit pas
de run à ta place — « le dernier » serait un run partiel, ou d'un autre décor,
c'est-à-dire la comparaison fausse que la règle 3 ci-dessous existe pour
refuser.

Sorties : **0** rien n'a bougé · **3** des tâches attendent trois runs · **78**
refus (décor incompatible, référence absente, ou dépistage sans run). Un FAIL
_conforme à la référence_ ne sort pas 1 : le mode répond « qu'est-ce qui a
bougé ? », pas « tout est-il vert ? ».

La référence (`baseline.json`, versionnée à la racine du skill) porte le modèle,
le décor, l'agent, et par tâche le verdict, le nombre de runs et les runs
d'origine. Quatre règles la gouvernent, chacune payée par une erreur déjà
commise — et toutes vues rouges par `reference.selftest.mjs --prove` :

0. **Le verdict binaire ne DÉCIDE pas seul — la référence garde aussi les
   TOURS.** L'unanimité sur 3 runs a une résolution catastrophique : une tâche
   que le devkit réussit 4 fois sur 5 sort « instable » une fois sur deux
   (P(3/3 | p=0,8) = 0,51). Rejouer ne la stabilise jamais — la référence
   portait la tâche 13 à `passes: 2, runs: 3` le 2 août ; trois runs repayés
   trois semaines plus tard ont rendu exactement 2/3. Deux mesures, zéro
   information. Les TOURS, eux, sont continus et déjà mesurés à chaque run :
   sur ces mêmes trois runs, 52 · 54 · 88, et le seul qui échoue est le seul où
   l'agent n'a pas trouvé le générateur. Là où le verdict hésite, l'effort
   tranche. `medianeTours` (jamais le dernier run, jamais la moyenne) entre dans
   la référence, et le dépistage classe les tâches **ALLÉGÉES** et **ALOURDIES**
   — verdict inchangé, effort qui bouge. Elles ne se REJOUENT pas : c'est tout
   l'intérêt.
1. **Unanimité** — un verdict agrégé n'est PASS que si TOUS les runs le sont.
   « 2/3 » n'est pas « plutôt bon » : c'est instable, donc non prouvé.
2. **Asymétrie** — une REMONTÉE (référence FAIL → run PASS) se rejoue autant
   qu'une chute. Elle suit une correction, elle arrive quand on l'espère, et
   c'est précisément pour ça qu'on la croit sur un run. L'erreur est vécue.
3. **Le décor est une variable de la mesure** — modèle, isolation, agent : un
   écart REFUSE la comparaison (sortie 78). Un avertissement se lit après coup ;
   une comparaison fausse s'utilise tout de suite.
   ⚠️ **Et ce refus ne se contourne pas à la main.** Vécu : un run large rendu
   dans un décor « MCP atteignable » face à une référence sans MCP a vu sa
   comparaison refusée, puis rejouée au `jq` par l'opérateur — qui a lu trois
   « chutes » qu'aucun changement n'expliquait. Refaire soi-même le calcul que
   la garde interdit, c'est reproduire exactement l'erreur qu'elle empêche.
   3bis. **Le CODE qui rend le verdict est une variable de la mesure, au même
   titre que le décor.** L'empreinte d'une tâche couvre l'énoncé, le `prepare`,
   les noms des sondes — et désormais le **source de chaque `observe`** et le
   **contenu de chaque juge** que la tâche nomme. Sans cela, corriger un juge
   n'invalidait rien : trois juges qui punissaient une protection légitime ont
   été corrigés, un quatrième était mort depuis cinq jours, et pas une référence
   n'a bougé — on opposait des verdicts d'aujourd'hui à des verdicts rendus par
   un juge qui n'existe plus, sous l'étiquette « conforme à la référence ».
   Toucher une ligne d'un `gate-*.mjs` fait donc **refuser** la comparaison sur
   ses tâches, en les NOMMANT : on sait quoi rejouer plutôt que tout redemander.
   Un commentaire compte aussi — refuser à tort coûte un run nommé, comparer à
   tort coûte la mesure entière et ne se voit pas ; seule la remise en forme
   (espaces) est absorbée. L'empreinte est **indépendante de la machine** :
   les tâches composent leurs chemins de juge en absolu, et sans normalisation
   un dépôt cloné ailleurs voyait toutes ses tâches « réécrites ».

4. **Un rouge NON OPPOSABLE écarte le run** — une gate rejouée sur l'app
   d'aujourd'hui (run antérieur aux gates figées) ne juge pas la tâche. Le banc
   le DISAIT déjà dans son texte, sans en tirer la conséquence : le rouge était
   compté, et il a fabriqué un FAIL de référence sur une tâche qui passait.

Le mode **ne relance rien** : il nomme les tâches et rend la commande à copier.
Un banc qui décide seul de rejouer dépense sans qu'on l'ait voulu — c'est ce que
la garde ci-dessus fait tenir, plutôt que de le promettre.

> 🔴 **Ne pas repayer des runs pour reconfirmer un verdict déjà instable.** Une
> tâche que la référence donne à « 2/3 » le restera : la rejouer remesure le même
> aléa. Ce qui apprend quelque chose, c'est d'INSTRUIRE le transcript d'un run
> rouge — c'est ainsi qu'on a trouvé deux bugs du framework (une sortie tronquée
> au-delà de 64 Ko, un `inspect` muet sur son mode) et trois défauts du banc
> lui-même. Le banc sert à ouvrir une enquête, pas à produire un score.

**Détail : [`references/banc-decouvrabilite-lecons.md`](references/banc-decouvrabilite-lecons.md)**
— dix leçons, chacune payée par un défaut réel : les sondes s'éprouvent avant de juger, mesurer
la performance sans jamais comparer une durée, le meilleur juge demande à l'application (pas au
dépôt), un vert par abandon n'est pas un vert, une tâche ne juge pas l'agent sur la saleté de la
précédente, le décor est celui de l'utilisateur, ce banc ne découvre pas les trous — il les garde
fermés, nommer la cause ne suffit pas (il faut dire à qui elle est opposable), la sécurité ne se
juge pas sur une présence de texte, et mesurer qu'on pose une garde ne dit rien sur celle qu'on
retire.

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

Détail : [`references/banc-schema-etudes-de-cas.md`](references/banc-schema-etudes-de-cas.md) —
pourquoi le décor doit sortir du dépôt (isolation constatée, pas supposée), et pourquoi le juge
PostgreSQL doit lui-même s'éprouver avant de rendre un verdict.

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
- **`drizzle-kit` réclame « install either 'better-sqlite3' or '@libsql/client' »**
  et l'étape des migrations tombe en `NF_MIGRATE_UNAVAILABLE`. **Même cause que
  ci-dessus**, et elle mérite sa ligne parce que le message accuse la BASE : le
  pilote SQLite est une dépendance de `@nodefony/drizzle`, que `--link` symlinke
  sans la hisser — `node_modules/better-sqlite3` n'existe tout simplement pas
  dans l'application témoin. Tout ce qui suit cette étape n'est donc **jamais
  atteint** en boucle courte. Le constater d'un `ls` avant de suspecter quoi que
  ce soit, et rejouer en décor ISOLÉ (sans `--link`) pour obtenir le verdict.

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
| le SQL généré, une migration, un type de colonne                 | vérité, `--database postgres` PUIS `--database mysql`           |
| une vague `devkit S<n>` que tu veux déclarer finie               | les deux                                                        |

## Quand passer la main

| Besoin                                                          | Skill                    |
| --------------------------------------------------------------- | ------------------------ |
| Éprouver ce qu'un **installeur** reçoit (npm, conteneur vierge) | `nodefony-release`       |
| Charge, débit, latence                                          | `nodefony-load-test`     |
| Coder dans le cœur backend                                      | `nodefony-framework-dev` |
| Créer ou éditer un skill                                        | `nodefony-skill`         |

## Références

- `references/methode-de-mesure.md` — variance d'un run unique, modèle par défaut, générateur qui abaisse le modèle nécessaire
- `references/banc-decouvrabilite-lecons.md` — dix leçons du banc de découvrabilité, chacune payée par un défaut réel
- `references/banc-schema-etudes-de-cas.md` — pourquoi le décor et le juge PostgreSQL du banc de schéma s'éprouvent avant de juger
- `references/agents-et-porte-mcp.md` — le décor d'un run : régimes de porte MCP, drapeaux par agent, foyer jetable, et les pièges qui font mesurer autre chose que ce qu'on croit
