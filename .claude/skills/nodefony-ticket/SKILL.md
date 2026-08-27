---
name: nodefony-ticket
metadata:
  version: 1.1.0
description: Écrit et organise les tickets GitHub du dépôt Nodefony — titre normé Conventional Commits et compréhensible sans connaître le dépôt, lexique des abréviations en tête de corps, corps en quatre blocs dont une preuve `fichier:ligne` et un critère de fin observable, découpage parent/sous-tickets, et pose des champs du tableau de bord (jalon, jours, priorité, ordre, rattrapabilité). À charger AVANT d'ouvrir une issue ou d'en restructurer un lot : un ticket est lu par un humain pressé autant que par un agent, et un titre-phrase le rend illisible pour les deux. Déclencheurs : "on ne comprend pas ce titre", "c'est quoi cette abréviation", "mets un lexique", "crée un ticket", "ouvre une issue", "nouveau ticket", "note ça dans un ticket", "fais-en des tickets", "ticket parent", "sous-tickets", "découper cette issue", "reformater les tickets", "titre de ticket", "estimer un ticket", "priorité d'un ticket", "ajouter au board", "jalon 10.0.0".
---

# nodefony-ticket — écrire un ticket qu'on comprend en dix secondes

> **Maintenance** : vérité courante, jamais un journal. Éditer en place ; l'historique vit dans
> `git log`, la version dans `metadata.version`.

## La règle qui gouverne tout

**Un ticket a deux lecteurs : un humain pressé et un agent.** L'humain lit le titre dans une liste
de trente ; l'agent lit le corps pour agir. Un titre qui est une _phrase_ échoue pour les deux —
l'humain ne balaie plus, l'agent ne sait pas quoi faire.

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
et le bloc « Le problème », citations retirées. Ne jamais recopier une définition dans un ticket : elle
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

## 3. Parent et sous-tickets

Un lot de plus de trois tickets qui partagent une cause **prend un parent**. GitHub gère les
sous-tickets nativement : le parent affiche une barre de progression, et le tableau de bord a les
champs `Parent issue` et `Sub-issues progress`.

```bash
# rattacher un enfant à un parent (les deux par NUMÉRO d'issue)
gh api graphql -f query='
  mutation($p:ID!,$c:ID!){ addSubIssue(input:{issueId:$p, subIssueId:$c}){ clientMutationId } }' \
  -f p="$(gh api repos/:owner/:repo/issues/PARENT --jq .node_id)" \
  -f c="$(gh api repos/:owner/:repo/issues/ENFANT --jq .node_id)"
```

Le **parent** porte le contexte commun, la mesure d'ensemble et la liste des enfants ; il ne porte
**aucun travail propre** et n'a donc pas d'estimation. Chaque **enfant** est autonome : on doit
pouvoir le prendre sans lire le parent.

## 4. Labels et champs du tableau de bord

|                     |                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Jalon**           | `10.0.0` (échéance) · `10.1` (suit par npm)                                                                          |
| **`irrattrapable`** | une version suivante ne peut PAS le réparer — dépendance publiée, contrat gelé                                       |
| **`rattrapable`**   | une 10.0.1 le répare — premier à glisser si la date se tend                                                          |
| **`arbitrage`**     | une décision à rendre, pas du travail à faire                                                                        |
| **`Jours`**         | l'estimation, en nombre                                                                                              |
| **`Priorité`**      | `P0` bloque le reste ou chemin critique · `P1` doit sortir dans le jalon · `P2` décision · `P3` fin de cycle ou 10.1 |
| **`Ordre`**         | encode les DÉPENDANCES, pas une préférence — c'est lui qui se trie                                                   |

**Le critère de jalon** : _qu'est-ce qu'une 10.0.1 ne peut pas réparer ?_ Une page de doc se
republie seule ; une dépendance publiée dans un `package.json`, non. Ne pas confondre avec « figé à
la création d'une app » — trop large, puisque `npm create nodefony@latest` sert toujours les
derniers gabarits.

## 5. Créer, ordonner, rattacher

```bash
# créer (corps dans un fichier — jamais en ligne : les backticks et les accents s'y perdent)
gh issue create --title "docs(guides): retirer « mocha + bun » du hub" \
  --body-file tmp/t/1.md --label "10.0.0" --milestone "10.0.0" --assignee "@me"

# poser les champs du board (ids : gh project field-list <n> --owner <org>)
item=$(gh project item-add <n> --owner <org> --url <url> --format json --jq '.id')
gh project item-edit --id "$item" --project-id "$PID" --field-id "$FJOURS" --number 2
gh project item-edit --id "$item" --project-id "$PID" --field-id "$FPRIO" --single-select-option-id "$P1"

# ordonner physiquement la grille (le champ Ordre ne trie pas la vue à lui seul)
gh api graphql -f query='mutation($p:ID!,$i:ID!,$a:ID!){
  updateProjectV2ItemPosition(input:{projectId:$p,itemId:$i,afterId:$a}){clientMutationId}}' \
  -f p="$PID" -f i="$ITEM" -f a="$PRECEDENT"
```

## Pièges vécus

- **`for n in $VAR` ne découpe pas en zsh** (contrairement à bash) : la boucle reçoit la liste
  entière comme un seul mot. Écrire la liste en clair dans le `for`.
- **Un corps passé en `--body` inline** perd ses backticks et ses accents selon le shell.
  Toujours `--body-file`.
- **`gh project item-list` tronque par défaut** : passer `--limit` au-delà de ~30 items, sinon la
  recherche d'un item par numéro d'issue rend une chaîne vide et le `item-edit` échoue sur
  « Could not resolve to a node with the global id of '' ».
- **Un automate qui pose des lexiques doit borner sa zone de lecture au bloc « Le problème », citations exclues.** Vécu : détecter les termes sur le corps entier a posé sur un ticket de libellés de menu un lexique « surcharge par l'environnement, isomorphe, ADR » — des mots pris dans des **exemples de titres cités**. Un lexique hors sujet est pire que pas de lexique : il fait douter le lecteur d'avoir compris.
- **Un chiffre repris d'un audit se remesure avant d'entrer dans un ticket.** Vécu : « 437 ancres en
  dérive » venait d'une mesure d'une semaine ; la vraie valeur était 108, et l'estimation passait
  de 2 j à 0,5 j.

## Références (chargées à la demande)

| Fichier                                                                    | Contenu                                                                                                                               |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| [`references/conventional-commits.md`](references/conventional-commits.md) | La spec 1.0.0 hors ligne : structure normative, table des types, règle `BREAKING CHANGE`, et ce que Nodefony ajoute par-dessus        |
| [`references/lexique.md`](references/lexique.md)                           | Le glossaire — source unique des définitions posées en tête des tickets, avec le motif de détection de chaque terme                   |
| [`references/github-issues.md`](references/github-issues.md)               | Sous-tickets (limites 100 / 8 niveaux, `--add-sub-issue`, équivalent GraphQL), jalons, Projects v2 et ses pièges de ligne de commande |
