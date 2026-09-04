---
name: nodefony-ticket
metadata:
  version: 1.7.0
description: Écrit et organise les tickets GitHub du dépôt Nodefony — titre normé Conventional Commits et compréhensible sans connaître le dépôt, lexique des abréviations, corps en quatre blocs dont une preuve `fichier:ligne` et un critère de fin observable, parents et sous-tickets, champs du tableau de bord, le moment où un ticket se fait dans la foulée, et ce qui fait qu'un ticket ACHÈTE du temps au lieu d'en coûter : chemins exacts, commandes prêtes, décor nommé, pièges connus, fausses pistes écartées. À charger AVANT d'ouvrir une issue ou d'en reformuler un lot. Déclencheurs : "crée un ticket", "ouvre une issue", "fais-en des tickets", "corrige les tickets", "ce titre est incompréhensible", "renomme cette issue", "ticket parent", "découper cette issue", "estimer un ticket", "priorité d'un ticket", "ce ticket est-il encore vrai ?", "ferme ce ticket", "quel ticket prendre maintenant ?", "quels tickets parlent de ce que j'ai changé ?", "ce ticket est trop vague", "il manque le contexte pour le prendre".
---

# nodefony-ticket — écrire un ticket qu'on comprend en dix secondes

> **Maintenance** : vérité courante, jamais un journal. Éditer en place ; l'historique vit dans
> `git log`, la version dans `metadata.version`.

## La règle qui gouverne tout

**Un ticket a deux lecteurs : un humain pressé et un agent.** L'humain lit le titre dans une liste
de trente ; l'agent lit le corps pour agir. Un titre qui est une _phrase_ échoue pour les deux —
l'humain ne balaie plus, l'agent ne sait pas quoi faire.

**Et il a une seconde raison d'être : ACHETER du temps.** C'est le seul artefact du dépôt qui
transporte du contexte à travers le temps sans être relu à chaque tour — écrit une fois, lu au
moment de prendre le travail. Tout ce qu'il énonce précisément est une exploration que personne ne
repaiera (§3).

## ⚖️ La devise vaut ICI aussi — « la confiance n'exclut pas le contrôle »

**Un ticket est une affirmation sur le code, et il est cru sans être relu.** C'est ce qui le rend
dangereux : personne ne rouvre un fichier pour vérifier une ligne d'issue, on la prend pour argent
comptant, on estime dessus, on planifie dessus. Les quatre contrôles, à faire **au moment où on
s'en sert**, jamais « une fois pour toutes » :

| Ce qu'on écrit                     | Ce qu'on vérifie AVANT de l'écrire — et de nouveau avant de s'en servir                                                                                                                                           |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Une ancre `fichier:ligne`          | Qu'elle pointe encore sur ce qu'on annonce. Une ancre dérive à chaque refactor honnête ; fausse, elle est **pire qu'absente** — elle a l'air d'une preuve.                                                        |
| Un **chiffre**                     | Qu'il vienne d'une mesure d'aujourd'hui. Vécu : « 437 ancres en dérive » valait **108** ; l'estimation passait de 2 j à 0,5 j.                                                                                    |
| Un **renvoi** vers un autre numéro | Qu'il désigne l'objet annoncé. Vécu : un corps renvoyait à « #9 » pour un travail de documentation — **#9 est une demande de fusion de mise à jour de dépendances**. Un renvoi mort ressemble à un renvoi vivant. |
| Un **critère de fin**              | Qu'une commande le rende observable, et que la garde ait été **vue mordre** : la débrancher, constater que quelque chose tombe. « C'est implémenté » n'est pas un critère.                                        |

**Suspecter son propre ticket** : après l'avoir écrit, le relire en se demandant ce qu'il ferait
faire à quelqu'un qui n'a pas le contexte. C'est le même geste que suspecter son propre diff.

**Et un ticket qui a peut-être déjà été fait se CONSTATE avant d'être repris** — ses commentaires,
le code, `git log`. Un ticket d'arbitrage reste ouvert longtemps après que les décisions sont
rendues : la décision vit dans un commentaire, et le corps, lui, continue d'afficher des cases à
cocher. Fermer coûte une minute ; refaire coûte une session.

## 1. Le titre — Conventional Commits, comme les commits du dépôt

Le dépôt impose déjà [Conventional Commits 1.0.0](https://www.conventionalcommits.org) à ses commits
(`commitlint` en pre-commit). **Les tickets suivent la même grammaire** : une seule convention à
connaître, et le commit qui ferme le ticket se déduit de son titre.

```
type(scope): description à l'impératif
```

- **type** : `feat` · `fix` · `docs` · `refactor` · `perf` · `test` · `build` · `ci` · `chore`
- **scope** : le module ou la zone — `http`, `security`, `cli`, `guides`, `release`, `client`…
- **description** : **verbe à l'infinitif**, minuscules, **≤ 60 caractères**, pas de point final
- **rupture** : `type(scope)!: …` quand le changement casse une API publique

```
✅ docs(guides): retirer « mocha + bun » du hub des guides
✅ feat(cli): ajouter security:user:password
✅ fix(client): corriger l'URL realtime par défaut, qui ne répond nulle part
✅ feat(orm)!: livrer orm:migrate — DDL de production

❌ Le hub des guides publie « mocha + bun » et promet des pages qui n'existent pas
❌ La doc montre le raccourci shared() avant la classe qu'il construit
```

Les deux derniers **décrivent le problème** ; un titre **annonce le geste**. Le problème va dans le
corps, il a tout un bloc pour lui.

### 🔴 Le titre se comprend SANS connaître le dépôt

**Le test, en une question : quelqu'un qui n'a jamais ouvert ce dépôt sait-il ce qui va changer ?**
Si la réponse exige d'aller chercher un document, un tableau de bord ou un fichier de code, le titre
est raté — et il l'est pour l'humain pressé comme pour l'agent.

Trois choses le ratent, toujours :

| Interdit en titre                                                                                          | Pourquoi                                                                                               | À la place                                                                                                    |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Un **code de planification interne** — `S5`, `R6`, `P10`, `D9`, `LB.3b`                                    | Il renvoie à un document que le lecteur n'a pas. Ce n'est pas une abréviation, c'est un pointeur mort. | Ce qu'il désigne : « les migrations de schéma », « la publication npm »                                       |
| Un **nom de symbole ou de variable nu** — `IClientKernel`, `ROLE_NODEFONY_ADMIN`, `NF__APP__*`, `navTitle` | Il nomme l'implémentation, pas le changement. Le lecteur ne sait pas ce que ça fait.                   | Le mot commun : « le contrat du noyau client », « un rôle administrateur », « la config par l'environnement » |
| Un **anglicisme quand le français existe** — override, allowlist, subpath, binding, drift                  | Une seule langue par corpus, sinon le lecteur traduit avant de comprendre.                             | surcharge · liste d'exceptions · sous-chemin · liaison · dérive                                               |

**Restent autorisés** : les noms propres d'outils (`gitleaks`, `npm`, `Svelte`), les noms de
commandes que l'utilisateur tape (`orm:migrate`, `security:user:password`), et les termes officiels
d'un framework (_composable_ Vue, _rune_ Svelte) — **à condition que le titre dise ce que ça fait**.
« ajouter les composables Vue 3 » ne dit rien ; « ajouter les composables Vue 3 du temps réel », si.

```
✅ feat(orm): livrer les migrations de schéma en production
✅ chore(release): publier les paquets de la version 10 sur npm
✅ fix(client): corriger le contrat du noyau client avant de le figer

❌ feat(orm): livrer le DDL de production et orm:migrate      → sigle non expliqué
❌ chore(release): exécuter R6 et publier sur npm             → code interne
❌ fix(client): ne pas geler IClientKernel en l'état          → symbole nu + geste flou
```

### Le lexique — quand une abréviation reste nécessaire

Certains termes n'ont pas d'équivalent : DDL, TOTP, SemVer, MCP. Ils sont autorisés à une condition : le corps s'ouvre par un bloc `Lexique`, avant le bloc
`Le problème`, définissant ceux — et seulement ceux — que ce ticket emploie.

```markdown
**Lexique**

- **DDL** — _Data Definition Language_ : la partie du SQL qui crée et modifie la structure des tables (`CREATE TABLE`, `ALTER TABLE`), par opposition à celle qui manipule les données.

**Le problème**
…
```

Les définitions vivent dans **[`references/lexique.md`](references/lexique.md)** — source unique.
Poser ou rafraîchir les blocs sur tout le lot ouvert se fait par
[`scripts/pose-lexique.mjs`](scripts/pose-lexique.mjs), qui lit ce fichier et rien d'autre :

```bash
node .claude/skills/nodefony-ticket/scripts/pose-lexique.mjs            # rapport seul
node .claude/skills/nodefony-ticket/scripts/pose-lexique.mjs --write    # applique
```

Il est idempotent (un bloc posé est remplacé, jamais empilé) et ne lit, pour décider, que le titre
et le bloc « Le problème », citations retirées.

Le pendant pour les anglicismes est [`scripts/francise.mjs`](scripts/francise.mjs) : il applique les
couples `anglais → français` du même fichier, **hors du code seulement** — accents graves, blocs
clôturés, liens et citations figées restent intacts. Écrire les formes avec article (`un binding →
une liaison`) : un mot qui change de genre entraîne son déterminant, et aucun script n'accorde. Ne jamais recopier une définition dans un ticket : elle
divergerait. **Au-delà de six entrées, le lexique n'est pas la réponse** — c'est le corps qui est
écrit en jargon, et c'est lui qu'il faut réécrire.

## 2. Le corps — quatre blocs, toujours dans cet ordre

Précédés du **`Lexique`** quand le ticket emploie une abréviation (§1) — il n'est pas un cinquième
bloc, il est ce qui rend les quatre autres lisibles.

```markdown
**Le problème**
Deux à quatre phrases : ce qui ne va pas et ce que ça coûte. Le PROBLÈME, pas la solution —
sinon on fige une réponse avant d'avoir compris la question.

**Preuve au terrain**
`fichier:ligne` ACTUEL, ou la commande qui le montre. Sans preuve, le ticket est une opinion,
et il se périme sans que personne le sache. Ce qui n'est pas vérifiable par lecture s'écrit
`NON VÉRIFIABLE PAR LECTURE`.

Une preuve d'**ABSENCE** — « aucun `X` nulle part » — se met sur sa PROPRE ligne, et s'écrit
comme une **commande** (`rg -c 'X' src` rend `0`). Collée à une ancre, elle se fait lire comme
son contexte : le contrôle cherche alors `X` autour de la ligne pointée, ne l'y trouve pas —
forcément, c'est ce que le ticket affirme — et signale une ancre pourtant juste. Vécu sur #17.

**Fini quand**
Un critère OBSERVABLE : un test qui passe, une commande qui rend tel résultat, un écran qui
répond. Jamais « c'est implémenté ». Si le critère porte sur une garde, exiger sa preuve
négative — débrancher, constater que quelque chose tombe.

---

**Estimation : N j**
**Dépend de** : #12, ou « rien »
```

Une estimation en **jours-homme** — `0,5 · 1 · 2 · 3 · 5` — jamais en points : l'auteur travaille
seul et pense en jours.

> ⚠️ **L'estimation est HAUTE d'un ordre de grandeur, et elle ne se corrige pas toute seule.**
> Mesuré sur les tickets fermés : l'estimation vaut **plusieurs fois** le temps constaté entre le
> premier et le dernier commit du ticket. **Le facteur se REMESURE, il ne se recopie pas** — il
> valait ×8 sur les premiers lots, ×3,5 puis ×2,3 à mesure que les tickets se sont précisés. Un
> chiffre gravé ici serait faux au lot suivant : c'est `ticket-effort.mjs` qui fait foi, pas cette
> page. La cause n'est pas de la négligence — c'est que l'unité est calibrée sur
> quelqu'un qui code à la main, alors que lire, chercher, éditer et vérifier tiennent en minutes.
> Ce qui coûte aujourd'hui, c'est le **contexte à charger** et les **décisions à rendre**.
>
> Le coût de l'erreur n'est pas cosmétique : un ticket affiché « 3 j » se **reporte**, alors qu'il se
> ferait dans la foulée — et le report fait repayer tout son contexte plus tard (§ « Quand le prendre »).
>
> ```bash
> node scripts/ticket-effort.mjs          # estimé vs constaté sur les tickets fermés, et le biais médian
> node scripts/ticket-effort.mjs 41 56    # ceux-là seulement
> ```
>
> Le constaté est une **borne basse** — la fenêtre de commits ignore l'exploration, les décisions et
> les essais abandonnés. À lire comme un ordre de grandeur qui recale, jamais comme une durée.

## 3. Le ticket est un instrument d'ÉCONOMIE — il achète du temps, ou il en coûte

**Mesuré sur ce dépôt : ~72 % du coût d'une session est de la RELECTURE de contexte, ~10 % la
production.** Ce qu'un agent écrit ne coûte presque rien ; ce qui coûte, c'est retrouver où
regarder. Un ticket vague ne coûte donc pas « un peu moins » — il coûte **une session entière**,
celle où quelqu'un rouvre les fichiers, refait les recherches et retrouve les décisions déjà prises.

La question à se poser en écrivant, et c'est la seule : **qu'est-ce que celui qui prendra ce ticket
devrait chercher, et que je sais DÉJÀ maintenant ?**

| Ce qui achète du temps                                           | Ce que ça remplace                                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Le **chemin exact** du fichier — pas « dans le module drizzle »  | une recherche multi-modules, et le risque de viser le mauvais fichier homonyme        |
| La **commande prête à coller** — décor, suite, gate              | une recomposition approximative : un port oublié, et le banc se **skippe en silence** |
| Le **décor nommé** (variables `NF_*`, conteneurs, interrupteurs) | un faux succès — **un skip compte comme vert**, et la régression sort en production   |
| Le **piège déjà connu, avec sa conséquence**                     | une demi-session de redécouverte, parfois un défaut publié                            |
| **Ce qu'il ne faut PAS explorer**, avec le motif                 | la fausse piste reprise et abandonnée une seconde fois                                |
| **Ce qui existe et se réutilise** (patron, banc voisin)          | une réimplémentation à côté — deux copies d'une règle divergent en silence            |

**Le revers, à traquer avec la même sévérité** : un ticket est relu à chaque fois qu'on le prend,
l'estime ou le trie. Se coupent sans hésiter une justification **déjà tranchée ailleurs**, une
**redite** d'un autre ticket de la grappe, le **contexte que le parent porte déjà**.

> **Le test qui départage, en une question : cette phrase évite-t-elle une exploration, ou la
> raconte-t-elle ?** La première mérite d'être écrite. La seconde se coupe.

**La borne** : le ticket PORTE ce que seul son auteur sait, il POINTE vers ce qui vit déjà ailleurs —
un pointeur exact coûte une ligne et vaut un paragraphe. Catalogue, exemples avant/après et cas
limites → **[`references/economie.md`](references/economie.md)**.

## 4. Parent et sous-tickets

Un lot de plus de trois tickets qui partagent une cause **prend un parent**. GitHub gère les
sous-tickets nativement : le parent affiche une barre de progression, et le tableau de bord a les
champs `Parent issue` et `Sub-issues progress`.

### 🔴 Le déclencheur qu'on rate : plusieurs critères de fin INDÉPENDANTS

Le seuil « plus de trois tickets » ne se voit que si l'on a déjà écrit les tickets. Or le cas
courant est l'inverse : **on écrit UN ticket, et c'est son bloc « Fini quand » qui trahit le lot.**

> **Si deux points du « Fini quand » peuvent être atteints séparément, par deux gestes qui ne se
> touchent pas, ce n'est pas un ticket — c'est un parent qui s'ignore.**

Le symptôme : un ticket de 1,5 j dont les trois critères visent trois fichiers sans rapport. Il ne
sera jamais pris, parce qu'on ne prend pas « une journée et demie de trois choses » — alors que
chacune tient dans une demi-heure de contexte déjà chargé. Le découper ne crée pas du travail : il
rend prenable un travail qui ne l'était pas.

Le test inverse, pour ne pas découper à tort : **les deux moitiés se font-elles dans la même
session, dans les mêmes fichiers ?** Alors elles restent ensemble — un ticket par unité de travail,
pas par ligne de constat.

### Le geste

```bash
# À LA CRÉATION — flag natif, le lien est posé d'emblée (le plus simple)
gh issue create --title "…" --body-file corps.md --parent 63 --milestone "10.1" --label "10.1"

# APRÈS COUP — rattacher un enfant existant (les deux par NUMÉRO d'issue)
gh api graphql -f query='
  mutation($p:ID!,$c:ID!){ addSubIssue(input:{issueId:$p, subIssueId:$c}){ clientMutationId } }' \
  -f p="$(gh api repos/:owner/:repo/issues/PARENT --jq .node_id)" \
  -f c="$(gh api repos/:owner/:repo/issues/ENFANT --jq .node_id)"

# VÉRIFIER le lien (ne jamais s'en tenir au message de création)
gh api graphql -f query='query{repository(owner:"nodefony",name:"nodefony-core"){
  issue(number:63){ subIssues(first:20){ nodes{ number title } } } }}'
```

Le **parent** porte le contexte commun, la mesure d'ensemble et la liste des enfants ; il ne porte
**aucun travail propre**, donc aucune estimation en propre — sur le tableau de bord, son champ
`Jours` reçoit la **somme** des enfants, et son corps le dit en toutes lettres pour qu'on ne compte
pas deux fois. Chaque **enfant** est autonome : on doit pouvoir le prendre sans lire le parent.

Un ticket qui porte du travail propre n'est **pas** un parent : s'il a un second volet plus lourd,
celui-ci devient un ticket **frère** qui le nomme en `Dépend de`, et le premier renvoie vers lui
dans son « Fini quand ».

## 5. Labels et champs du tableau de bord

|                     |                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Jalon**           | `10.0.0` (échéance) · `10.1` (suit par npm) · **aucun jalon** = le backlog, label `backlog`                          |
| **`irrattrapable`** | une version suivante ne peut PAS le réparer — dépendance publiée, contrat gelé                                       |
| **`rattrapable`**   | une 10.0.1 le répare — premier à glisser si la date se tend                                                          |
| **`arbitrage`**     | une décision à rendre, pas du travail à faire                                                                        |
| **`Jours`**         | l'estimation, en nombre                                                                                              |
| **`Priorité`**      | `P0` bloque le reste ou chemin critique · `P1` doit sortir dans le jalon · `P2` décision · `P3` fin de cycle ou 10.1 |
| **`Ordre`**         | encode les DÉPENDANCES, pas une préférence — c'est lui qui se trie                                                   |

### 🔴 Ces règles ne mordent que parce qu'un AUTOMATE les relit

Tout ce qui précède est de la prose, et **une règle en prose n'est appliquée que si quelqu'un y
pense au bon moment.** Personne n'y pense en relisant un tableau de soixante-dix lignes. La preuve
tient en deux numéros : **#82 puis #187**, à deux mois d'écart, ont reçu un jalon sans jamais être
inscrits au tableau — aucun compteur ne les voyait, et rien ne l'a dit.

```bash
npm run ticket:lint                       # le tableau entier
npm run ticket:lint -- --milestone 10.0.0 # un seul jalon
npm run ticket:lint -- --json             # pour un autre outil
```

Neuf contrôles, tous à **verdict binaire** — il ne juge JAMAIS d'une priorisation, qui est un
arbitrage sans bonne réponse mécanique :

| Code                           | Ce qu'il attrape                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------ |
| `HORS-TABLEAU`                 | jalon promis, aucun item au tableau — invisible de tout compteur (#82, #187)               |
| `NI-JALON-NI-BACKLOG`          | ne promet rien, et n'assume pas de ne rien promettre                                       |
| `SANS-ORDRE`                   | tombe en fin de tri, donc n'est jamais proposé                                             |
| `ORDRE-DOUBLON`                | deux items au même rang dans un jalon : l'ordre a cessé de trancher                        |
| `DEPENDANCE-INVERSEE`          | `Dépend de : #N` avec #N rangé APRÈS — le tri propose le travail avant son socle           |
| `CONTRAINTE-INVERSEE`          | « à faire AVANT #N » non respecté — la contrainte que le tableau n'a aucun champ pour dire |
| `STATUT-MENTEUR`               | « En cours » sans commit de travail depuis 14 j (les commits de pilotage ne comptent pas)  |
| `SANS-JOURS` / `SANS-PRIORITE` | ne se trie pas, donc ne se prend jamais _(avertissement)_                                  |
| `PARENT-SOMME`                 | le parent n'affiche pas la somme de ses enfants — on compte deux fois _(avertissement)_    |

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
gh issue edit <n> --remove-milestone --remove-label "10.1" --add-label "backlog"
```

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

## 6. Créer, ordonner, rattacher

> 🔴 **`gh issue create` n'inscrit PAS le ticket au tableau de bord.** L'issue existe, et elle
> n'entre dans aucun compteur d'avancement : ni l'ordre de travail, ni le reste-à-faire, ni
> l'empreinte hors ligne. Vécu sur #82, resté invisible du pilotage jusqu'à un contrôle manuel — un
> oubli qui ne crie pas est pire qu'une erreur. **Ouvrir par la commande du dépôt**, qui fait
> création, inscription et pose des champs d'un seul geste :

```bash
npm run ticket:open -- --title "docs(guides): retirer « mocha + bun » du hub" \
  --body-file tmp/t/1.md --milestone "10.0.0" --priorite P1 --jours 0.5
#   --backlog          → pas de jalon, label `backlog` (aucune date promise)
#   --parent 63        → sous-ticket : l'ordre se DÉRIVE du parent (63.1, 63.2, …)
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

> **Le remplissage mécanique ressemble à un arbitrage et n'en est pas un.** Vécu sur la grappe #54 :
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

## 7. Fermer un ticket — le geste est TRIPLE

**Un ticket qu'on ferme change un fait, et ce fait est recopié ailleurs.** C'est le défaut le plus
coûteux du pilotage par tickets, parce qu'il ne fait aucun bruit : le travail est bon, le ticket est
fermé, et deux documents plus loin une phrase continue d'affirmer l'état d'avant. Personne ne la
relit — on la croit, on estime dessus, on planifie dessus.

Vécu sur #41 : le retrait d'un contrat de la surface publiée a rendu faux, du même coup, le bloc
« ✅ ce qui est déjà fait » de **#34**, trois passages d'un **ADR**, une **page de doc publique** et
une entrée du **journal de publication**. Aucun n'aurait été trouvé sans y penser.

Donc, avant de fermer, trois recalages — dans cet ordre, parce que chacun révèle le suivant :

| #   | Ce qu'on recale         | Comment on le TROUVE (jamais de mémoire)                                                                      |
| --- | ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | **Le code**             | Le diff, les tests, le gate vu mordre — c'est le travail lui-même.                                            |
| 2   | **Les tickets voisins** | `node .claude/skills/nodefony-ticket/scripts/ticket-verify.mjs --touched-by HEAD`                             |
| 3   | **La documentation**    | `rg -n '<le symbole ou le fait qui a changé>' --glob '*.md'` — puis `anchor-check.mjs` sur les pages touchées |

```bash
# Les tickets qui parlent de ce qu'on vient de changer (sélection MÉCANIQUE, verdict humain)
node .claude/skills/nodefony-ticket/scripts/ticket-verify.mjs --touched-by HEAD

# Les ancres `fichier:ligne` de TOUS les tickets ouverts, résolues contre le code
node .claude/skills/nodefony-ticket/scripts/ticket-verify.mjs
node .claude/skills/nodefony-ticket/scripts/ticket-verify.mjs 34 54    # ceux-là seulement
```

### Le compte rendu de fermeture — quatre blocs, dont deux qu'aucun automate ne connaît

**Fermer sur « fait » perd tout ce que la session a appris.** Le travail a produit des commits, des
tests, une garde vue mordre — et presque toujours quelque chose qui **déborde de l'énoncé** : la
protection demandée en séance, le voisin qu'il a fallu aligner. Rien de cela n'est retrouvable
ensuite autrement qu'en relisant le code, c'est-à-dire au prix exact que le ticket existe pour
éviter (§3). Le compte rendu est le seul endroit où ces faits atterrissent.

```bash
node .claude/skills/nodefony-ticket/scripts/ticket-close.mjs 95            # brouillon
node .claude/skills/nodefony-ticket/scripts/ticket-close.mjs 95 --since <sha>
```

| Bloc                  | Qui le remplit                                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Commits**           | le script (`git log --grep '#N\b'`) — la borne de mot évite que `#9` ramène le travail de `#95`                      |
| **Preuves**           | le script pour les fichiers de test ; **l'auteur** pour la garde vue mordre : ce qu'on a débranché, ce qui est tombé |
| **Au-delà du ticket** | **l'auteur seul** — ce qui a débordé et POURQUOI                                                                     |
| **Non fait**          | **l'auteur seul** — le point du « Fini quand » non couvert, et son motif                                             |

Les deux derniers ne sont dans aucun dépôt : un script qui les devinerait rendrait un compte rendu
plausible et faux. Le script imprime donc, mais **n'écrit rien sur GitHub** — fermer est
irréversible pour le pilotage, et ne se délègue pas à un automate qui n'a pas lu le diff.

> **Un débordement STRUCTURANT prend son propre ticket**, ouvert et refermé dans la foulée : le
> compte rendu dit ce qui a été fait, il ne remplace pas l'endroit où l'on cherche.

⚠️ **Le message de commit doit CITER le ticket** (`#95`, ou `Closes #95` pour le dernier) — sinon
la timeline reste vide, le bloc « Commits » sort vide, et `ticket-progress.mjs` ne marque rien.

### 🔴 La console d'administration est la RÉFÉRENCE de non-régression

Studio est **la seule application réelle du dépôt** : une identité qui bascule, une socket qui se
re-négocie, des caches à purger, des écrans qui consomment. Tout le reste est du code rendu ou des
tests unitaires.

> **Tout ticket qui touche le client OU le serveur — temps réel et isomorphisme en tête — se ferme
> en ayant vérifié que la console d'administration marche encore.** Pas « compile encore » :
> marche. On l'ouvre, on regarde la console du navigateur, on vérifie que la socket se connecte.

Le geste est dans le skill `nodefony-browser` (voie LOCALE, rien à démarrer côté navigateur), après
avoir relancé le serveur — `nodefony-start-server`.

Le corollaire est plus dur à admettre : **ce que Studio n'utilise pas n'est éprouvé par personne.**
Le fournisseur React publié par le framework en est l'exemple — Studio a sa propre glue, si bien que
la seule preuve de ce fournisseur était une chaîne de caractères cherchée dans un fichier rendu.
Quand un ticket ajoute une surface que Studio n'emploie pas, il doit dire qui l'emploiera, et quand.

### Pourquoi un automate, et pas un label « même sujet »

La tentation est d'étiqueter les tickets d'un même sujet pour les retrouver. **Ça ne mordrait pas,
et le dépôt en a déjà la preuve** : le champ `Status` du tableau de bord est resté à `In Progress`
**0 fois sur 64** tant qu'il fallait le poser à la main — il n'a servi qu'une fois DÉRIVÉ du commit.
Un label de sujet aurait exactement le même sort : il faut y penser à la création, y penser à la
relecture, et il duplique ce que le **ticket parent** exprime déjà mieux (§4).

L'automate, lui, ne demande à personne d'y penser. Il ne juge rien non plus — il dit quels tickets
citent les fichiers du diff, et l'humain tranche. Deux limites à connaître, parce qu'un outil dont on
ignore les bords rend des verdicts qu'on croit exhaustifs :

- **Une ancre juste ne rend pas un ticket vrai.** #34 pointait des lignes qui existaient toujours et
  affirmait au-dessus un état devenu faux. C'est le mode `--touched-by` qui l'attrape, pas la
  résolution d'ancres.
- **Un fichier que tout le monde cite n'est pas un indice.** Le journal de publication est cité par
  19 tickets : les retenir noierait les trois vrais. L'outil les écarte et **le dit**, avec leurs
  numéros — une troncature muette serait pire que le bruit.

## Pièges vécus

- **`for n in $VAR` ne découpe pas en zsh** (contrairement à bash) : la boucle reçoit la liste
  entière comme un seul mot. Écrire la liste en clair dans le `for`.
- **Un corps passé en `--body` inline** perd ses backticks et ses accents selon le shell.
  Toujours `--body-file`.
- **🔴 `gh project item-list` OMET des items, `--limit` ou pas.** Mesuré : 39 rendus contre **40**
  comptés par l'API au même instant — un ticket ajouté à la minute était absent, sans un mot. Le
  symptôme visible est un `item-edit` qui échoue sur « Could not resolve to a node with the global
  id of '' », parce que la recherche par numéro d'issue a rendu une chaîne vide ; le symptôme
  INVISIBLE est un inventaire incomplet qu'on croit complet. **Pour lister ou retrouver un item,
  passer par GraphQL** (`projectV2.items`, ou `issue.projectItems` pour un ticket précis) ;
  `item-list` reste acceptable pour un coup d'œil, jamais pour décider. Même famille que le champ
  `title` figé : ce client rend une vue à lui, pas l'état du tableau.
- **🔴 Le remède GraphQL a SON propre bord : `items(first:100)` s'arrête à 100 SANS le dire.** Le
  tableau compte aujourd'hui plus de cent items ; une requête écrite « en grand » rend donc une
  liste tronquée qui a toutes les apparences d'un inventaire complet. Vécu deux fois de suite dans
  la même session : #163 et #164 déclarés « absents du tableau », puis « pas en cours » — ils
  étaient inscrits, et en cours. **Toute lecture de `projectV2.items` qui NOURRIT UNE DÉCISION se
  pagine** (`--paginate` + `pageInfo{hasNextPage endCursor}` et `$endCursor` en variable), ou se
  contrôle contre `items(first:1){totalCount}`. Interroger un ticket PRÉCIS n'a pas ce défaut :
  `issue(number:N){projectItems}` rend l'état vrai, et c'est la voie quand on sait qui l'on cherche.
  La leçon générale : un remède à une troncature muette peut tronquer muettement à son tour — le
  compte se DEMANDE, il ne se déduit jamais de la longueur de ce qu'on a reçu.
- **Un automate qui pose des lexiques doit borner sa zone de lecture au bloc « Le problème », citations exclues.** Vécu : détecter les termes sur le corps entier a posé sur un ticket de libellés de menu un lexique « surcharge par l'environnement, isomorphe, ADR » — des mots pris dans des **exemples de titres cités**. Un lexique hors sujet est pire que pas de lexique : il fait douter le lecteur d'avoir compris.

## Les scripts de ce skill

Ils vivent ICI, et non à la racine du dépôt, parce que **leur résultat dépend du protocole de cette
page** : un ticket ouvert sans le titre normé, le lexique et l'ordre dérivé du parent se fait
réécrire ; un écart estimé/constaté ne veut rien dire sans savoir ce qu'on en fait. Un script reste
à la racine quand il est déterministe et qu'il n'y a rien à interpréter — ce qui n'est le cas
d'aucun de ceux-ci. Le câblage npm ne décide pas du placement (`board:snapshot` vit dans
`nodefony-session` et est appelé par npm).

| Script                                                       | Ce qu'il fait                                                                                          | Appelé par                                 |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| [`scripts/ticket-open.mjs`](scripts/ticket-open.mjs)         | ouvre un ticket avec ordre dérivé du parent et champs du tableau                                       | `npm run ticket:open`                      |
| [`scripts/ticket-progress.mjs`](scripts/ticket-progress.mjs) | passe en `In Progress` les tickets qu'un commit cite sans les fermer                                   | `.githooks/post-commit`                    |
| [`scripts/ticket-effort.mjs`](scripts/ticket-effort.mjs)     | confronte le champ `Jours` au temps réellement constaté                                                | à la main, au END de session               |
| [`scripts/board-lint.mjs`](scripts/board-lint.mjs)           | confronte le TABLEAU DE BORD à ses propres règles — ce qui est absent, en double, ou se contredit      | `npm run ticket:lint`, au RESUME et au END |
| [`scripts/ticket-verify.mjs`](scripts/ticket-verify.mjs)     | confronte les tickets ouverts au code, et dit lesquels un commit rend faux                             | à la main, au END de session               |
| [`scripts/ticket-close.mjs`](scripts/ticket-close.mjs)       | compose le compte rendu de fermeture (commits + tests ; les deux blocs de jugement restent à l'auteur) | à la main, avant `gh issue close`          |
| [`scripts/francise.mjs`](scripts/francise.mjs)               | repère les tournures à franciser dans un corps de ticket                                               | à la main                                  |
| [`scripts/pose-lexique.mjs`](scripts/pose-lexique.mjs)       | insère le bloc **Lexique** des abréviations détectées                                                  | à la main                                  |

Les deux fonctions pures qui portent une règle — `deriveOrdre` (l'ordre d'un sous-ticket) et
`parseTargets` (les tickets qu'un message de commit cite) — sont éprouvées par
[`scripts/ticket-open.test.mjs`](scripts/ticket-open.test.mjs) et
[`scripts/ticket-progress.test.mjs`](scripts/ticket-progress.test.mjs) ; celles du compte rendu
(`fichiersDeTest`, `composer`) par [`scripts/ticket-close.test.mjs`](scripts/ticket-close.test.mjs).
Toutes sont lancées par `npm run test:pilotage`.

## Références (chargées à la demande)

| Fichier                                                                    | Contenu                                                                                                                               |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| [`references/conventional-commits.md`](references/conventional-commits.md) | La spec 1.0.0 hors ligne : structure normative, table des types, règle `BREAKING CHANGE`, et ce que Nodefony ajoute par-dessus        |
| [`references/economie.md`](references/economie.md)                         | Le ticket comme instrument d'économie : les six choses qui achètent du temps, ce qui se coupe, un avant/après, la borne               |
| [`references/lexique.md`](references/lexique.md)                           | Le glossaire — source unique des définitions posées en tête des tickets, avec le motif de détection de chaque terme                   |
| [`references/github-issues.md`](references/github-issues.md)               | Sous-tickets (limites 100 / 8 niveaux, `--add-sub-issue`, équivalent GraphQL), jalons, Projects v2 et ses pièges de ligne de commande |
