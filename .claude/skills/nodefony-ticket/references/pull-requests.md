# Pull requests — la remplir, la relier, la fusionner

> Référence du skill `nodefony-ticket`, chargée quand on ouvre, complète ou fusionne une pull
> request. **Maintenance** : vérité courante, jamais un journal ; historique = `git log`.

Depuis la 10.0.0, tout passe par une pull request (PR) : `dev` reçoit la prochaine version mineure,
`release/x.y.x` les correctifs de la version publiée. Le geste qui ouvre la branche et la PR au
début d'un ticket est le sujet de #796 ; cette page couvre ce qui suit l'ouverture.

## 1. La colonne de droite — rien ne s'invente, tout se lit sur le ticket

`gh pr create` laisse vide la colonne de droite. Une PR à moitié remplie ne se trie pas sur le
tableau, ne dit pas quelle version elle prépare, et ne mène pas à son ticket.

| Champ           | Valeur                                  | D'où elle vient                                                  |
| --------------- | --------------------------------------- | ---------------------------------------------------------------- |
| **Assignees**   | l'auteur (`@me`)                        | toujours                                                         |
| **Milestone**   | le jalon du ticket                      | le ticket ; plusieurs tickets de jalons différents = à trancher  |
| **Labels**      | les labels du ticket (le lot, `10.0.1`) | le ticket                                                        |
| **Projects**    | le tableau de bord des tickets          | le même que `ticket-open.mjs`                                    |
| **Development** | le ticket, par un mot-clé de fermeture  | seulement vers la branche par défaut — voir §2                   |
| **Reviewers**   | aucun                                   | projet solo : GitHub refuse qu'un auteur se relise ; la CI relit |

Le ticket se trouve au corps (`Refs #N`, `Closes #N`) ou en tête du nom de branche
(`fix/797-…`). Un seul geste remplit tout ce qui peut l'être, et dit le reste :

```bash
node .claude/skills/nodefony-ticket/scripts/pr-complete.mjs 799 --dry-run   # le plan
node .claude/skills/nodefony-ticket/scripts/pr-complete.mjs 799             # l'applique
```

Une PR ajoutée au tableau n'en trouble pas les automates : l'empreinte et `ticket:lint` ne
retiennent que les items qui sont des tickets (`content.number`).

## 2. « Development » — GitHub ne relie que vers la branche par défaut

Le lien PR → ticket ne se pose que par un **mot-clé de fermeture** au corps (`Closes #N`), et
GitHub ne l'honore que pour une PR vers la branche **par défaut** (`dev`). Il n'existe pas d'API
pour poser ce lien autrement.

- **PR vers `dev`** : `Closes #N` au corps. Le lien apparaît, et la fusion ferme le ticket.
- **PR vers `release/x.y.x`** : le lien est IMPOSSIBLE. On garde `Refs #N` (la mention reste
  visible sur le ticket), et l'on ferme le ticket **à la main** après fusion, avec son compte
  rendu (`references/fermeture.md`). Écrire `Closes #N` ici ne fermerait rien et ferait croire le
  contraire.

## 3. Fusionner — deux gestes, deux méthodes

| Ce qu'on fusionne                                     | Méthode                             | Pourquoi                                                                                                                                                                                                           |
| ----------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| La PR d'**un ticket** (vers `dev` ou `release/x.y.x`) | **squash**                          | un ticket = un commit sur la branche longue, au titre du ticket ; décision de #796                                                                                                                                 |
| **`release/x.y.x` → `dev`**                           | **commit de fusion**, jamais squash | la fusion garde l'ANCÊTRE commun. Un squash recopie les mêmes changements sous une autre empreinte : à la remontée suivante, git ne sait plus qu'ils sont déjà dans `dev`, et chaque correctif repasse en conflit. |

**Quand remonter `release/x.y.x` vers `dev`** : juste après la **publication** du correctif
(`10.0.1` sur npm, tag posé). `dev` reçoit alors exactement ce qui a été publié, les conflits avec
la mineure en cours se règlent une fois, et un correctif ne traîne jamais dans `dev` sans être sorti.
Une PR `release/x.y.x → dev`, CI comprise, comme les autres.

**Avant de fusionner** : PR sortie du brouillon (`gh pr ready N`), CI verte sur le DERNIER commit
(`gh pr checks N` — un rouge d'un run précédent ne compte pas, un ⏳ non plus), colonne de droite
complète (§1).
