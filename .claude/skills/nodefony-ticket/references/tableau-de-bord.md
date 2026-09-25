# Le tableau de bord — labels, champs, ordre, et quand prendre un ticket

> Référence du skill `nodefony-ticket`, chargée quand on **inscrit, ordonne, priorise ou date** un
> ticket, et pour décider **quel ticket prendre maintenant**. Déclencheurs : « estimer un ticket »,
> « priorité d'un ticket », « dater les tickets », « quel ticket prendre maintenant ? »,
> « la roadmap du projet est vide », « recaler les estimations », « ticket parent »,
> « découper cette issue », « ouvre une issue », « crée un ticket ».
>
> **Maintenance** : vérité courante, jamais un journal. Éditer en place ; historique = `git log`.

## Labels et champs

|                       |                                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Jalon**             | promet une **DATE** — `10.0.0-beta` et son échéance · **aucun jalon** = le backlog, label `backlog`                  |
| **`beta-N`**          | un **LOT** de contenu, qui ne promet aucune date — sa fermeture complète DÉCLENCHE la publication (§ ci-dessous)     |
| **`irrattrapable`**   | une version suivante ne peut PAS le réparer — dépendance publiée, contrat gelé                                       |
| **`rattrapable`**     | une 10.0.1 le répare — premier à glisser si la date se tend                                                          |
| **`arbitrage`**       | une décision à rendre, pas du travail à faire                                                                        |
| **`Jours`**           | l'estimation, en nombre                                                                                              |
| **`Priorité`**        | `P0` bloque le reste ou chemin critique · `P1` doit sortir dans le jalon · `P2` décision · `P3` fin de cycle ou 10.1 |
| **`Ordre`**           | encode les DÉPENDANCES, pas une préférence — c'est lui qui se trie                                                   |
| **`Début` / `Cible`** | une TRANCHE de calendrier, posée à la main sur ce qui est engagé — jamais dérivée de `Jours` (§ ci-dessous)          |

### Les dates — la frise, et surtout le RECALAGE

Deux champs `Date` (`Début` / `Cible`) posés à la main sur ce qui est ENGAGÉ, plus l'échéance des
jalons : c'est ce qui remplit la vue _Roadmap_. Leur intérêt n'est pas la frise mais la mesure —
l'écart entre le jour où l'on comptait faire un ticket et celui où il s'est fermé est la seule
façon de savoir si c'est l'estimation qui était fausse ou l'ordre de travail.

> 🔴 **Ne JAMAIS dériver ces dates en cumulant `Jours`** : ce serait une frise qui a l'air d'une
> mesure et qui est fausse d'un ordre de grandeur ([[feedback_board_days_are_not_calendar]]).

Méthode de pose, réglage de la vue (non pilotable par l'API), et ce que la pose révèle
immédiatement → **[`references/dates.md`](dates.md)**.

### 🔴 Ces règles ne mordent que parce qu'un AUTOMATE les relit

Tout ce qui précède est de la prose, et **une règle en prose n'est appliquée que si quelqu'un y
pense au bon moment.** Personne n'y pense en relisant un tableau de soixante-dix lignes. La preuve
est vécue : **deux tickets, à deux mois d'écart**, ont reçu un jalon sans jamais être
inscrits au tableau — aucun compteur ne les voyait, et rien ne l'a dit.

```bash
npm run ticket:lint                       # le tableau entier
npm run ticket:lint -- --milestone 10.0.0 # un seul jalon
npm run ticket:lint -- --json             # pour un autre outil
```

Les contrôles ci-dessous, tous à **verdict binaire** — il ne juge JAMAIS d'une priorisation, qui est un
arbitrage sans bonne réponse mécanique :

| Code                           | Ce qu'il attrape                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------- |
| `HORS-TABLEAU`                 | jalon promis, aucun item au tableau — invisible de tout compteur                                  |
| `NI-JALON-NI-BACKLOG`          | ne promet rien, et n'assume pas de ne rien promettre                                              |
| `LABEL-DOUBLE-JALON`           | un label porte le nom d'un jalon — deux instruments confondus, le double se périme                |
| `SANS-ORDRE`                   | tombe en fin de tri, donc n'est jamais proposé                                                    |
| `ORDRE-DOUBLON`                | deux items au même rang dans un jalon : l'ordre a cessé de trancher                               |
| `DEPENDANCE-INVERSEE`          | `Dépend de : #N` avec #N rangé APRÈS — le tri propose le travail avant son socle                  |
| `CONTRAINTE-INVERSEE`          | « à faire AVANT #N » non respecté — la contrainte que le tableau n'a aucun champ pour dire        |
| `STATUT-MENTEUR`               | « En cours » sans commit de travail depuis 14 j (les commits de pilotage ne comptent pas)         |
| `SANS-JOURS` / `SANS-PRIORITE` | ne se trie pas, donc ne se prend jamais _(avertissement)_                                         |
| `PARENT-SOMME`                 | le parent n'affiche pas la somme de ses enfants — on compte deux fois _(avertissement)_           |
| `PARENT-SANS-EPIC`             | un parent dont le type n'est pas `Epic` — il se prend pour un ticket de travail _(avertissement)_ |
| `VITRINE-OUVERTE`              | un ticket ouvert dans le dépôt GÉNÉRÉ, que rien d'ici ne suit _(avertissement)_                   |
| `PRIORITE-ORDRE`               | un `P0` rangé après un `P3` — « fin de cycle » avant « bloque le reste »                          |
| `CIBLE-AVANT-DEBUT`            | `Cible` antérieure à `Début` — la barre de la frise part à l'envers                               |
| `FRISE-A-TROUS`                | un jalon à moitié daté : la frise en montre une part, et on la croit entière _(avertissement)_    |
| `FRISE-DECALEE`                | la frise démarre loin d'aujourd'hui — elle date d'un plan qu'on ne suit plus _(avertissement)_    |
| `FRISE-TROP-COURTE`            | plus de jours estimés que la fenêtre `Début`→`Cible` n'en contient _(avertissement)_              |
| `ALERTE-CODE`                  | une alerte d'analyse de code restée ouverte, que rien ne nommait _(avertissement)_                |

Deux pièges que ce script a déjà payés, et qui valent pour tout automate de pilotage :

- **`gh api graphql --paginate` concatène des objets JSON INDENTÉS** — ni `split("\n")` ni un
  `JSON.parse` unique ne les découpent. `--slurp` agrège les pages en un tableau ; et le compte se
  contrôle contre `totalCount`, jamais contre la longueur de ce qu'on a reçu.
- **Un contrôle qui crie faux apprend à passer outre.** Deux verdicts ont dû être bornés dès le
  premier run réel : `Dépend de : rien — mais à faire AVANT #175` lu comme une dépendance (c'est
  l'inverse), et un `P0` précédé de ses PRÉREQUIS traité comme une contradiction (c'est le
  fonctionnement normal de l'ordre).

### Un jalon promet une date — le backlog n'en promet aucune

**Le critère : est-ce que je m'engage à le sortir dans la foulée ?** Si la réponse honnête est
« quand j'aurai le temps », le ticket n'a **pas** de jalon — il porte `backlog`. Y mettre un jalon
n'avance rien et abîme l'instrument : un jalon qui contient ce qu'on ne fera pas ment exactement
comme un document écrit à la main, et son compteur d'avancement cesse d'être lisible.

En pratique : un chantier de plusieurs jours, sans date, va au backlog ; un correctif d'une
demi-journée déjà cadré va dans le jalon. Basculer coûte une commande, et se fait dans les deux
sens :

```bash
gh issue edit <n> --remove-milestone --add-label "backlog"
```

### Le dépôt VITRINE est un angle mort — et il a un contrôle

`nodefony/nodefony` est **généré** à chaque publication : on n'y édite rien, donc on n'y regarde
rien. Ni jalon, ni ordre, ni empreinte, ni `ticket:lint` ne le couvrent — un ticket ouvert là-bas
n'entre dans aucun compteur et n'apparaît dans aucune reprise de session.

Or c'est le dépôt **le plus visible de l'organisation**. Vécu : un ticket y a survécu **onze jours
à sa propre correction** — poussée le jour même, deux heures après son ouverture. Personne ne
l'avait rouvert, parce que rien ne le montrait.

La règle qui en découle : **un ticket ouvert dans la vitrine décrit un défaut du GABARIT, et se
corrige ici.** `VITRINE-OUVERTE` le signale à chaque passage. La lecture est tolérante — vitrine
injoignable ⇒ aucun avertissement, jamais un faux verdict.

### Les alertes d'analyse de code sont un angle mort de la MÊME famille

Le dossier #385 a instruit dix alertes de construction de commande système et s'est fermé sur un
critère chiffré : « le compte d'alertes ouvertes rend `0` ». Il était vrai ce jour-là. Sept jours
plus tard, la même règle était remontée sur un site NOUVEAU, né après la clôture — le verdict
ayant été posé site par site, à la main, tout code neuf en rouvre une.

Rien ne le disait : le compte n'était lu par aucun contrôle, et l'alerte a été repérée à l'œil.
`ALERTE-CODE` la nomme désormais là où l'on regarde déjà, avec son fichier et sa règle.

**Une alerte n'est pas une faute de pilotage — c'est un fait à instruire**, d'où un avertissement.
Ce qui serait fautif, c'est de ne pas la voir. Et le déblocage proposé exige un `dismissed_comment` :
un « rejeté » sans motif est précisément ce qui rend un tableau d'alertes illisible.

### 🔴 Un label ne REDIT jamais un jalon — il dit ce que le jalon ne sait pas dire

**Un jalon promet une date ; un label ne promet rien.** Ce sont deux instruments, et leur donner le
même nom les confond au point que l'un finit par mentir sur l'autre. Mesuré sur ce dépôt : huit
labels portaient le nom des huit jalons, et **quinze tickets ouverts** affichaient un label de
version que leur jalon contredisait — quatorze marqués `10.1.0` alors qu'ils étaient passés au
jalon `10.2.0`, et un ticket portant à la fois `10.1.0` et `backlog`. Personne ne déplace un double
en déplaçant un jalon. La cause était dans l'outil, pas dans la discipline : `ticket-open.mjs`
posait le label homonyme à chaque création.

Le label sert donc à ce dont le jalon est incapable : **découper un jalon en LOTS**, sans avoir à
promettre une date par lot.

> **La date n'est plus une décision, c'est une conséquence.** Le label dit CE QUI doit être dedans ;
> le travail dit QUAND ça sort. Une publication `10.0.0-beta.N` part le jour où le label `beta-N`
> n'a plus aucun ticket ouvert — et ça se constate, ça ne s'estime pas :

```bash
gh issue list --label beta-1 --state open   # vide → la beta.1 part
```

C'est ce qui débloque le cas courant, « je ne sais pas quand faire la beta 1 » : on n'a pas à le
savoir. Un jalon par lot obligerait à inventer cinq échéances, dont aucune ne serait tenue, et le
compteur d'avancement cesserait d'être lisible.

**Les lots se composent par CAUSE commune, jamais par taille.** Un lot est une question à laquelle
la publication répond (« publier sans les mains », « ce que l'installeur reçoit ») ; un lot
équilibré au nombre de tickets n'est qu'un tri, et ne dit rien de ce qui peut sortir ensemble.

Le champ `Ordre` reste ce qu'il est — les **dépendances**. Les deux se superposent sans se
remplacer : l'ordre dit ce qui passe avant quoi, le label dit ce qui sort ensemble.

### L'ordre VISUEL de la grille se pose, le GROUPEMENT non

Le champ `Ordre` ne déplace rien : il faut repositionner physiquement chaque ligne, en chaîne —
premier item sans `afterId` (il monte en tête), chacun des suivants `afterId` le précédent.

```bash
gh api graphql -f query='mutation($p:ID!,$i:ID!,$a:ID!){
  updateProjectV2ItemPosition(input:{projectId:$p,itemId:$i,afterId:$a}){clientMutationId}}' \
  -f p="$PID" -f i="$ITEM" -f a="$PRECEDENT"
```

⚠️ **Le groupement d'une vue — par jalon, par statut — n'est PAS pilotable.** `updateProjectV2View`
existe, mais sa configuration n'accepte que les colonnes visibles (`visibleFieldIds`) : vérifié par
introspection du schéma. Le groupement se règle **dans l'interface web** — ouvrir la vue, menu ⌄ à
droite de son onglet, `Group by` → `Milestone` —, et il est mémorisé par vue. Ne pas chercher une
commande : il n'y en a pas.

**Le critère de jalon** : _qu'est-ce qu'une 10.0.1 ne peut pas réparer ?_ Une page de doc se
republie seule ; une dépendance publiée dans un `package.json`, non. Ne pas confondre avec « figé à
la création d'une app » — trop large, puisque `npm create nodefony@latest` sert toujours les
derniers gabarits.

### Quand le prendre — l'ordre dit les DÉPENDANCES, le contexte dit le MOMENT

`Ordre` encode ce qui doit passer avant quoi. Il ne dit **rien** du coût, et c'est là qu'on perd le
plus : **rouvrir un ticket plus tard, c'est repayer son contexte.** Sur ce dépôt, la relecture de
contexte pèse ~72 % de la dépense d'une session — écrire coûte presque rien, comprendre coûte tout.

> **🔥 Règle du contexte chaud : un ticket dont le contexte est DÉJÀ chargé se fait dans la foulée,
> même s'il n'est pas le prochain dans l'ordre.** Les fichiers sont ouverts, les ancres viennent
> d'être relues, le raisonnement est en mémoire : le même travail coûtera trois fois plus cher dans
> deux semaines, quand il faudra tout rouvrir pour retrouver ce qu'on sait maintenant.

Le test, en une question : **est-ce que je viens de lire ce qu'il faut pour le faire ?**

| Situation                                                              | Le geste                                                                              |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Le ticket est né de la vérification qu'on vient de faire               | **Le faire maintenant.** Son contexte, c'est exactement ce qu'on a sous les yeux.     |
| Petit (≤ 0,5 j), sans dépendance amont, dans les fichiers déjà ouverts | **Le faire maintenant**, puis le refermer en citant le commit.                        |
| Gros, ou il touche un module qu'on n'a pas ouvert                      | Le laisser à son ordre — le contexte serait à charger de toute façon.                 |
| Il dépend d'un ticket non fait                                         | Le laisser, quoi qu'il en coûte : l'ordre est une **dépendance**, pas une préférence. |

Ce qui ne change pas : le ticket existe **quand même**, écrit avant d'être fait. C'est lui qui porte
la preuve, le critère de fin et la trace — le faire dans la foulée n'autorise pas à sauter l'écrit.

## Créer, ordonner, rattacher

> 🔴 **`gh issue create` n'inscrit PAS le ticket au tableau de bord.** L'issue existe, et elle
> n'entre dans aucun compteur d'avancement : ni l'ordre de travail, ni le reste-à-faire, ni
> l'empreinte hors ligne. Vécu : un ticket resté invisible du pilotage jusqu'à un contrôle manuel — un
> oubli qui ne crie pas est pire qu'une erreur. **Ouvrir par la commande du dépôt**, qui fait
> création, inscription et pose des champs d'un seul geste :

```bash
npm run ticket:open -- --title "docs(guides): retirer « mocha + bun » du hub" \
  --body-file tmp/t/1.md --milestone "10.0.0" --priorite P1 --jours 0.5
#   --backlog          → pas de jalon, label `backlog` (aucune date promise)
#   --parent 63        → sous-ticket : l'ordre se DÉRIVE du parent (63.1, 63.2, …) ;
#                        le parent sans type est promu Epic
#   --type Bug         → type d'issue (Task, Bug, Feature, POC, Epic)
#   --ordre 12.5       → ordre explicite, quand il n'y a pas de parent
#   --label irrattrapable
```

### 🔴 L'ordre d'une grappe suit les DÉPENDANCES, jamais les numéros d'issue

Un sous-ticket sans ordre tombe en fin de tri et n'est **jamais proposé** — le même oubli muet que
l'absence d'inscription au tableau, une case plus loin. Avec `--parent`, la commande le dérive
(parent 50 → 50.1, 50.2, …) et **refuse** les deux cas où un ordre dérivé serait faux : un parent
qui n'a pas d'ordre lui-même, et une grappe de plus de neuf enfants, qui mordrait sur le cran
suivant. Sans parent ni `--ordre`, elle l'ANNONCE au lieu de se taire.

Ce que la machine ne peut pas faire à ta place, c'est **classer les frères entre eux**. Le rang
d'un enfant, c'est sa place dans la chaîne des dépendances : le socle avant ce qui s'y branche,
la veille avant ce qu'elle tranche, le confort avant le chantier de fond s'il a été jugé
prioritaire.

> **Le remplissage mécanique ressemble à un arbitrage et n'en est pas un.** Vécu sur une grappe :
> sept sous-tickets rangés à `ordre = numéro d'issue − 4`. Conséquences invisibles à la lecture —
> le socle commun aux quatre fronts passait **après** les trois liaisons qui en dépendent, le bus de
> journalisation déclaré « première brique » passait **après** la brique qu'il fonde, le seul ticket
> d'un **autre jalon** ouvrait la grappe, et le ticket que le parent désigne comme « le confort
> d'abord » fermait la marche. Le contrôle qui tranche en une seconde : **si les ordres sont dans le
> même sens que les numéros d'issue, personne n'a arbitré.**

Le détail des champs reste utile quand on corrige un item existant :

```bash

# poser les champs du board (ids : gh project field-list <n> --owner <org>)
item=$(gh project item-add <n> --owner <org> --url <url> --format json --jq '.id')
gh project item-edit --id "$item" --project-id "$PID" --field-id "$FJOURS" --number 2
gh project item-edit --id "$item" --project-id "$PID" --field-id "$FPRIO" --single-select-option-id "$P1"

# ordonner physiquement la grille (le champ Ordre ne trie pas la vue à lui seul)
gh api graphql -f query='mutation($p:ID!,$i:ID!,$a:ID!){
  updateProjectV2ItemPosition(input:{projectId:$p,itemId:$i,afterId:$a}){clientMutationId}}' \
  -f p="$PID" -f i="$ITEM" -f a="$PRECEDENT"
```
