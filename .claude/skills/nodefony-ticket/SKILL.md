---
name: nodefony-ticket
metadata:
  version: 1.7.0
description: >
  Écrit et organise les tickets GitHub du dépôt Nodefony — titre normé Conventional Commits et
  compréhensible sans connaître le dépôt, lexique des abréviations, corps en quatre blocs dont une
  preuve `fichier:ligne` et un critère de fin observable, parents et sous-tickets, champs du tableau
  dont les DATES qui alimentent la frise et recalent les estimations, le moment où un ticket se fait
  dans la foulée, et ce qui fait qu'un ticket ACHÈTE du temps : chemins exacts, commandes prêtes,
  pièges connus. À charger AVANT d'ouvrir une issue. Déclencheurs : "crée un ticket", "ouvre une
  issue", "corrige les tickets", "ce titre est incompréhensible", "renomme cette issue", "ticket
  parent", "découper cette issue", "estimer un ticket", "priorité d'un ticket", "ce ticket est-il
  encore vrai ?", "ferme ce ticket", "quel ticket prendre maintenant ?", "ce ticket est trop vague",
  "quels tickets parlent de ce que j'ai changé ?", "dater les tickets", "la roadmap du projet est
  vide", "recaler les estimations".
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

### Ces quatre blocs sont rendus DEUX fois — ici, et dans les formulaires GitHub

Depuis que le dépôt sert des gabarits d'issue, le protocole ci-dessus existe aussi sous une forme
que GitHub sait lire : **`.github/ISSUE_TEMPLATE/defaut.yml` et `evolution.yml`**, dont les champs
SONT les blocs. C'est une duplication, et le dépôt s'interdit les duplications — mais celle-ci est
imposée par une frontière : GitHub ne sait pas lire cette page, il veut ses propres fichiers.

Quand une frontière impose la copie, la règle du dépôt est d'y poser un test qui compare les deux
sorties. C'est [`scripts/github-templates.test.mjs`](scripts/github-templates.test.mjs)
(`npm run test:pilotage`) : il LIT les blocs dans cette page — jamais une liste à lui, qui serait
une troisième copie — et exige de les retrouver en `label:` des deux formulaires, obligatoires.
**Renommer un bloc ici fait donc tomber le gate** tant que les formulaires n'ont pas suivi.

Il tient aussi les deux gardes que ces fichiers ne doivent pas perdre par distraction :
l'issue vierge reste fermée (sinon la page blanche revient, et le protocole redevient invisible de
l'extérieur), et le **canal de sécurité est le premier lien proposé**, vers la politique et jamais
vers un formulaire d'issue — une faille publiée est indexée en quelques minutes.

⚠️ **Ce que le formulaire ne peut PAS faire, et que la commande fait** : poser jalon, ordre et
priorité. Une issue ouverte depuis l'interface naît donc HORS du tableau de bord ; `ticket:lint` la
signale (`NI-JALON-NI-BACKLOG`), mais après coup. Les deux formulaires le disent en toutes lettres
aux mainteneurs — la voie normale reste `npm run ticket:open` (§6).

Une estimation en **jours-homme** — `0,5 · 1 · 2 · 3 · 5` — jamais en points : l'auteur travaille
seul et pense en jours.

> ⚠️ **L'estimation en jours ne prédit RIEN — c'est mesuré, pas supposé.** Sur 97 tickets fermés,
> le travail constaté est de **une séance, quelle que soit la taille estimée** : 0,5 j → 1 séance ·
> 1 j → 1 séance · 2 j → 1 séance. Une « séance » est une journée qui porte des commits citant le
> ticket. Autrement dit, le champ `Jours` classe des tickets qui coûtent tous à peu près pareil.
> La cause n'est pas de la négligence : l'unité est calibrée sur quelqu'un qui code à la main,
> alors que lire, chercher, éditer et vérifier tiennent en minutes. Ce qui coûte aujourd'hui, c'est
> le **contexte à charger** et les **décisions à rendre** — et ça ne dépend pas de la taille du diff.
>
> **Conséquence pratique, et elle est contre-intuitive : ce qui prédit le reste-à-faire, c'est le
> NOMBRE de tickets ouverts, pas la somme de leurs jours.** 106 tickets ouverts ≈ 106 séances ;
> les « 121 j » affichés ne veulent rien dire. Corollaire : **découper un ticket en trois le rend
> trois fois plus cher**, parce que chacun paiera son chargement de contexte. Ne découper que
> lorsque les morceaux se font dans des sessions différentes (§4).
>
> Le chiffre ne se recopie pas d'ici : `ticket-effort.mjs` fait foi, il se relance.
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

## 5. Inscrire, ordonner, dater — et quand prendre un ticket

Tout ce qui touche au **tableau de bord** vit en référence : labels et jalons, champs `Jours`,
`Priorité`, `Ordre`, les dates de la frise, les contrôles de `ticket:lint`, le geste de
création, et la règle du **contexte chaud** qui dit quand prendre un ticket plutôt que de le
reporter.

→ **[`references/tableau-de-bord.md`](references/tableau-de-bord.md)** — à charger avant d'ouvrir,
d'ordonner ou d'estimer.

**Ce qu'il faut savoir sans l'ouvrir** :

- 🔴 **`gh issue create` n'inscrit PAS le ticket au tableau de bord.** Ouvrir par la commande du
  dépôt — `npm run ticket:open` — qui crée, inscrit et pose les champs d'un seul geste.
- **L'estimation en jours ne prédit rien** : ce qui prédit le reste-à-faire est le **nombre** de
  tickets ouverts, pas la somme de leurs jours. Découper un ticket en trois le rend trois fois plus
  cher, chacun repayant son chargement de contexte.
- **Un jalon promet une date ; le backlog n'en promet aucune.** Si la réponse honnête est « quand
  j'aurai le temps », le ticket porte `backlog`, pas un jalon.
- **Un jalon promet une DATE, un label groupe un LOT — jamais le même nom.** Un label homonyme d'un
  jalon se périme dès qu'on déplace le jalon (mesuré : quinze tickets contredits par le leur).
  Le lot, lui, ne promet rien : c'est sa fermeture complète qui DÉCLENCHE la publication —
  `gh issue list --label beta-1 --state open` vide, la beta.1 part. `LABEL-DOUBLE-JALON` le contrôle.
- **Le contrôle se lance** : `npm run ticket:lint` (0 = le tableau se tient).

## 6. Fermer un ticket — le geste est TRIPLE

Fermer ne recale pas que le code : les **tickets voisins** et la **documentation** affirment encore
l'état d'avant, et personne ne les relit. Le protocole, les deux scripts de sélection mécanique et
la forme du **compte rendu de fermeture** vivent en référence.

→ **[`references/fermeture.md`](references/fermeture.md)** — à charger avant de fermer.

**Ce qu'il faut savoir sans l'ouvrir** :

- ⚠️ **`Closes #95` ne ferme RIEN depuis `dev`** : GitHub n'honore le mot-clé que sur la branche par
  défaut. La fermeture est toujours un geste — `gh issue close`, avec son compte rendu.
- **Fermer sur « fait » perd ce que la session a appris.** Deux blocs qu'aucun automate ne peut
  écrire : ce qui a **débordé** de l'énoncé, et ce qui n'a **pas** été fait, avec son motif.
- **La console d'administration est la référence de non-régression** : tout ticket qui touche le
  client ou le serveur se ferme en ayant vérifié qu'elle marche encore — pas qu'elle compile.

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
  la même session : deux tickets déclarés « absents du tableau », puis « pas en cours » — ils
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
| [`scripts/ticket-effort.mjs`](scripts/ticket-effort.mjs)     | confronte `Jours` au travail constaté — en SÉANCES, par tranche d'estimation, plus le délai            | à la main, au END de session               |
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
Toutes sont lancées par `npm run test:pilotage` (job « Statique + gates du dépôt » de la forge),
qui porte aussi le **gate qui interdit de décider sur `gh project item-list`** —
[`scripts/board-source.test.mjs`](scripts/board-source.test.mjs). La règle du piège ci-dessous était
écrite, et un script la violait quand même : sur un tableau de plus de cent items, le parent d'une
grappe disparaissait de la liste, l'ordre n'était pas dérivé, et la grappe entière tombait en fin de
tri sans qu'aucune erreur ne le dise.

Ce gate a d'abord balayé les seuls scripts de ce dossier — et **c'est ailleurs que la commande
interdite a survécu** : dans un bloc de commande du skill `nodefony-session`, celui que l'agent
exécute à chaque reprise. Le 2026-09-08, il a rendu 120 items sur 261 et fait annoncer au user un
ticket de la `beta` alors que neuf tickets `alpha` restaient ouverts. Le gate balaye désormais TOUT
`.claude/skills` — scripts `.mjs` **et blocs de code des pages** ; la prose reste libre de nommer la
commande pour enseigner le piège, et une ligne portant `CONTRE-EXEMPLE` reste permise dans un bloc.
Une règle en prose n'est appliquée que si un automate la relit — et un automate ne protège que le
périmètre qu'il balaye.

## Références (chargées à la demande)

| Fichier                                                                    | Contenu                                                                                                                                                                |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`references/conventional-commits.md`](references/conventional-commits.md) | La spec 1.0.0 hors ligne : structure normative, table des types, règle `BREAKING CHANGE`, et ce que Nodefony ajoute par-dessus                                         |
| [`references/economie.md`](references/economie.md)                         | Le ticket comme instrument d'économie : les six choses qui achètent du temps, ce qui se coupe, un avant/après, la borne                                                |
| [`references/lexique.md`](references/lexique.md)                           | Le glossaire — source unique des définitions posées en tête des tickets, avec le motif de détection de chaque terme                                                    |
| [`references/github-issues.md`](references/github-issues.md)               | Sous-tickets (limites 100 / 8 niveaux, `--add-sub-issue`, équivalent GraphQL), jalons, Projects v2 et ses pièges de ligne de commande                                  |
| [`references/tableau-de-bord.md`](references/tableau-de-bord.md)           | Labels, jalons et backlog, champs `Jours`/`Priorité`/`Ordre`, dates de la frise, les contrôles de `ticket:lint`, le geste de création, et quand prendre un ticket      |
| [`references/fermeture.md`](references/fermeture.md)                       | Fermer : les trois recalages (code, tickets voisins, documentation), le compte rendu en quatre blocs, et la console d'administration comme référence de non-régression |
| [`references/dates.md`](references/dates.md)                               | Poser `Début` / `Cible` à la main, régler la vue Roadmap (non pilotable par l'API), et ce que la pose révèle                                                           |
