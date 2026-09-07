# Les dates du tableau de bord — poser, régler, recaler

> Détail de la section « Les dates » du `SKILL.md`. Vérité courante, pas un journal.

## Ce que la vue Roadmap sait lire

Elle n'affiche que les items porteurs d'une date, et en connaît trois sortes :

- **Le jalon** — une barre par jalon, zéro saisie. Suffit tant qu'on ne pilote rien de fin.
- **Deux champs `Date`** (`Début` / `Cible`) — une tranche par ticket, donc la SÉQUENCE visible.
- Une itération — non employée ici.

🔴 **Le réglage n'est PAS pilotable** : `updateProjectV2View` existe, mais sa `configuration`
n'accepte que `visibleFieldIds` (vérifié par introspection du schéma). Le choix de la source de
dates se fait dans l'interface web — ouvrir la vue, menu `⌄` de son onglet, `Date fields`. Ne pas
chercher une commande : il n'y en a pas.

## Poser les dates — une tranche NEUTRE, puis constater

L'interdit d'abord : **ne jamais dériver les dates en cumulant `Jours`**. Le champ ne prédit pas le
travail (§2 du `SKILL.md` : une séance par ticket, quelle que soit la taille estimée), et une frise
bâtie dessus aurait l'air d'une mesure tout en étant fausse d'un ordre de grandeur.

La méthode honnête est l'inverse — poser une tranche neutre, puis regarder ce qu'elle révèle :

1. Prendre les tickets d'un jalon **dans l'`Ordre`** (il encode les dépendances).
2. Leur donner **un jour ouvré chacun**, à partir d'une date de départ que l'auteur donne.
3. Comparer la dernière tranche à l'**échéance du jalon**.

Le pas 3 est celui qui paie. Un débordement est un fait, pas un jugement : il dit combien de
tickets le jalon porte de trop, ou de combien son échéance est optimiste. Vécu : les 16 tickets de
`10.0.0-alpha` déroulés depuis le 8 septembre finissent le 29, contre une échéance au 19 — huit
jours ouvrés d'écart, avant d'avoir estimé quoi que ce soit.

**Ne dater que ce qui est ENGAGÉ.** Un jalon sans échéance n'a rien à faire sur une frise, et dater
cent tickets qu'on ne prendra pas dans l'ordre prévu produit une carte à maintenir que personne ne
croit. Le jalon porte déjà la promesse ; les champs par ticket ne servent que là où l'on veut voir
la séquence.

## Poser une date par l'API

```bash
PID=$(gh api graphql -f query='query{organization(login:"nodefony"){projectV2(number:2){id}}}' --jq '.data.organization.projectV2.id')
FD=$(gh project field-list 2 --owner nodefony --format json --jq '.fields[]|select(.name=="Début")|.id')
ITEM=$(gh api graphql -f query='query{repository(owner:"nodefony",name:"nodefony-core"){issue(number:263){projectItems(first:5){nodes{id}}}}}' --jq '.data.repository.issue.projectItems.nodes[0].id')

gh api graphql -f query='mutation($p:ID!,$i:ID!,$f:ID!,$d:Date!){
  updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{date:$d}}){clientMutationId}}' \
  -f p="$PID" -f i="$ITEM" -f f="$FD" -f d="2026-09-09"
```

L'item se retrouve par `issue(number:){projectItems}` — jamais en listant le tableau, qui tronque.

## Ce que `ticket-effort.mjs` en tire

Il rend, par ticket fermé : le **travail constaté** en séances (journées distinctes portant des
commits qui citent le ticket), le **délai** (ouverture → fermeture), et la médiane **par tranche
d'estimation**. Les deux dernières colonnes se lisent ensemble :

| Délai | Séances | Lecture                                           |
| ----- | ------- | ------------------------------------------------- |
| long  | 1       | le ticket a DORMI — ce n'est pas de la difficulté |
| court | 5       | un vrai gros morceau                              |
| long  | 5       | difficile ET repris plusieurs fois                |

Ses deux bornes, à énoncer chaque fois qu'on cite ses chiffres : une journée qui a vu dix minutes
de travail compte comme une séance entière, et l'exploration qui précède le premier commit n'est
comptée nulle part. C'est une borne BASSE.
