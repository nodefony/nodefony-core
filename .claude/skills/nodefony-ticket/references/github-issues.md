# Issues GitHub — sous-tickets, jalons, projets

> Source : documentation GitHub (`docs.github.com`, section Issues). Bundlée hors ligne :
> l'agent qui organise un lot de tickets ne doit pas dépendre du réseau.

## Sous-tickets (sub-issues)

Relation **parent → enfant** native, distincte des cases à cocher d'une liste markdown.

| Limite                   | Valeur        |
| ------------------------ | ------------- |
| Enfants par parent       | **100**       |
| Profondeur de hiérarchie | **8 niveaux** |

Ce que le parent gagne : une **barre de progression** automatique, et dans un projet la possibilité
de **filtrer et grouper par issue parent** (champs `Parent issue` et `Sub-issues progress`).

```bash
# rattacher une issue EXISTANTE comme enfant
gh issue edit <PARENT> --add-sub-issue <ENFANT>

# détacher
gh issue edit <PARENT> --remove-sub-issue <ENFANT>

# créer directement sous un parent
gh issue create --title "…" --body-file … --parent <PARENT>
```

L'équivalent GraphQL, si le CLI est trop ancien :

```bash
gh api graphql -f query='
  mutation($p:ID!,$c:ID!){ addSubIssue(input:{issueId:$p, subIssueId:$c}){ clientMutationId } }' \
  -f p="$(gh api repos/:owner/:repo/issues/PARENT --jq .node_id)" \
  -f c="$(gh api repos/:owner/:repo/issues/ENFANT --jq .node_id)"
```

## Quand découper

Un lot de **plus de trois tickets qui partagent une cause** prend un parent. Le parent porte le
contexte commun, les mesures d'ensemble et la liste ; il **ne porte aucun travail propre**, donc
pas d'estimation. Chaque enfant reste **autonome** : on doit pouvoir le prendre sans lire le parent.

## Jalons (milestones)

Un jalon porte une **date d'échéance** et calcule seul son pourcentage d'avancement. Il répond à
« qu'est-ce qui doit être fait pour cette version ? » — pas à « qu'est-ce que je fais aujourd'hui ? »,
qui est le rôle de l'ordre du projet.

```bash
gh api repos/:owner/:repo/milestones -X POST \
  -f title="10.0.0" -f state="open" -f due_on="2026-10-01T21:59:59Z"
```

## Projects v2

**Un projet appartient à un utilisateur ou une organisation, jamais à un dépôt** — les projets de
dépôt (classic) n'existent plus. Pour qu'il apparaisse sous l'onglet _Projects_ d'un dépôt, il faut
l'y **lier** :

```bash
gh project link <n> --owner <org> --repo <repo>
```

Le scope OAuth `project` est requis (`gh auth refresh -h github.com -s project`), en plus de `repo`.

## Pièges de ligne de commande

- **`gh project item-list` tronque par défaut** (~30) : passer `--limit`. Sans lui, la recherche
  d'un item par numéro d'issue rend une chaîne vide, et `item-edit` échoue sur
  « Could not resolve to a node with the global id of '' ».
- **Le champ `Ordre` ne trie aucune vue à lui seul** : il faut aussi ordonner physiquement, par
  `updateProjectV2ItemPosition`, sinon la grille garde l'ordre d'insertion.
- **Un accent dans un nom de champ casse un filtre `jq`** : écrire `.["priorité"]`, jamais
  `.priorité`.
