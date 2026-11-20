# Pull requests — la remplir, la relier, la fusionner

> Référence du skill `nodefony-ticket`, chargée quand on ouvre, complète ou fusionne une pull
> request. **Maintenance** : vérité courante, jamais un journal ; historique = `git log`.

Depuis la 10.0.0, tout passe par une pull request (PR) : `dev` reçoit la prochaine version mineure,
`release/x.y.x` les correctifs de la version publiée. Le cycle d'un ticket tient en deux scripts,
qui encadrent le code :

```bash
node .claude/skills/nodefony-ticket/scripts/ticket-start.mjs 794 --slug http2-head-scope   # entamer
node .claude/skills/nodefony-ticket/scripts/pr-finish.mjs                                  # clore, sans attendre
```

`ticket-start` ouvre la branche, la PR en brouillon et le statut « En cours » (relancé sur un ticket
qui a déjà sa branche, il s'y place : c'est aussi la reprise d'un ticket mis de côté). Cette page
couvre ce qui suit l'ouverture.

## 1. La colonne de droite — rien ne s'invente, tout se lit sur le ticket

`gh pr create` laisse vide la colonne de droite. Une PR à moitié remplie ne se trie pas sur le
tableau, ne dit pas quelle version elle prépare, et ne mène pas à son ticket.

| Champ           | Valeur                                  | D'où elle vient                                                  |
| --------------- | --------------------------------------- | ---------------------------------------------------------------- |
| **Assignees**   | l'auteur (`@me`)                        | toujours                                                         |
| **Milestone**   | le jalon du ticket                      | le ticket ; plusieurs tickets de jalons différents = à trancher  |
| **Labels**      | les labels du ticket (le lot, `10.0.1`) | le ticket                                                        |
| **Projects**    | le tableau de bord des tickets          | le même que `ticket-open.mjs`                                    |
| **Development** | le ticket                               | mot-clé vers `dev` ; À LA MAIN vers `release/*` — voir §2        |
| **Reviewers**   | aucun                                   | projet solo : GitHub refuse qu'un auteur se relise ; la CI relit |

Le ticket se trouve au corps (`Refs #N`, `Closes #N`) ou en tête du nom de branche
(`fix/797-…`). Un seul geste remplit tout ce qui peut l'être, et dit le reste :

```bash
node .claude/skills/nodefony-ticket/scripts/pr-complete.mjs 799 --dry-run   # le plan
node .claude/skills/nodefony-ticket/scripts/pr-complete.mjs 799             # l'applique
```

Une PR ajoutée au tableau n'en trouble pas les automates : l'empreinte et `ticket:lint` ne
retiennent que les items qui sont des tickets (`content.number`).

## 2. « Development » — par mot-clé vers `dev`, à la main ailleurs, jamais par l'API

Le lien PR → ticket (champ « Development » du ticket, « Linked pull requests » du tableau) se pose
de trois façons, qui n'ont pas la même portée :

| Voie                                        | Vers `dev` (branche par défaut) | Vers `release/x.y.x` |
| ------------------------------------------- | ------------------------------- | -------------------- |
| Mot-clé de fermeture au corps (`Closes #N`) | relie, et la fusion ferme       | **rien**             |
| Clic depuis la colonne de droite du ticket  | relie                           | relie (ne ferme pas) |
| API (REST ou GraphQL)                       | **aucune mutation n'existe**    | **aucune**           |

`createLinkedBranch` relie une BRANCHE, pas une PR : ce n'est pas ce lien. La seule contrainte que
GitHub pose au clic est « même dépôt » ; c'est la FERMETURE automatique qui exige la branche par
défaut.

- **PR vers `dev`** : `Closes #N` au corps (`ticket-start` l'écrit). Le lien apparaît, la fusion
  ferme le ticket.
- **PR vers `release/x.y.x`** : `Refs #N` au corps — `Closes #N` ne fermerait rien et ferait croire
  le contraire. Le lien se pose **à la main** (le ticket → colonne de droite → Development → la
  PR) ; `ticket-start` et `pr-complete` affichent l'adresse du ticket. Le ticket se ferme **à la
  main** après la fusion, avec son compte rendu (`references/fermeture.md`).

## 2 bis. Clore sans attendre la CI — `pr-finish.mjs`

La CI d'une PR dure ~35 min : l'attendre au premier plan, c'est une session qui ne fait rien.
`pr-finish.mjs` pousse la branche, passe la PR en « prête », puis choisit sa voie sur ce qu'il
CONSTATE :

- **fusion automatique** (`gh pr merge --squash --delete-branch --auto`) si le dépôt l'autorise ET
  si la base exige des checks. ⚠️ Sans check exigé, `--auto` fusionne **immédiatement**, CI rouge
  comprise — d'où la double condition ;
- **sinon, surveillance** : il rend la commande à lancer EN ARRIÈRE-PLAN
  (`gh pr checks N --watch --fail-fast && gh pr merge N --squash --delete-branch`).

Dans les deux cas, on enchaîne aussitôt : `ticket-start <suivant>` part de `origin/<base>`, jamais
de la branche en attente. Les deux réglages qui ouvrent la fusion automatique — « Allow
auto-merge » et la protection de `dev` / `release/*` exigeant la CI — sont des gestes de l'auteur
dans les réglages GitHub ; `main` doit rester ouvert à la publication, qui pousse `<branche>:main`.

## 2 ter. Mettre un ticket de côté — un commit, jamais `stash`

```bash
git add -A && git commit -m "fix(http): wip — reste le test HTTP/2 [skip ci]" && git push
node .claude/skills/nodefony-ticket/scripts/ticket-start.mjs <autre>
```

- **Type et scope du ticket** : `wip:` seul est refusé par commitlint (hors Conventional Commits).
- **`[skip ci]`** : GitHub ne lance aucun workflow pour un push ou une PR dont le DERNIER commit le
  porte — un marque-page ne vaut pas 35 min de CI. Le squash efface ces commits à la fusion.
- 🔴 **GitHub lit TOUT le message, corps compris.** Un commit de vrai travail dont le corps CITE la
  chaîne entre crochets (pour l'expliquer) coupe la CI de la PR entière. Vécu sur la PR #805 : zéro
  check. Pour en parler dans un message, écrire « skip-ci », sans crochets.
- **`stash` est refusé** : une remise est invisible, absente de la PR, et s'oublie.
- **Changer de branche ne réinstalle rien** : `ticket-start` et la reprise comparent le verrou de
  la branche à ce que npm a posé (`install-drift.mjs`) et disent « npm ci » quand ils divergent.

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
