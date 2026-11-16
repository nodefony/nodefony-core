# Les dates du tableau de bord — poser, régler, recaler

> Détail de la section « Les dates » du `SKILL.md`. Vérité courante, pas un journal.

## Ce que la vue Roadmap sait lire

Elle n'affiche que les items porteurs d'une date, et en connaît trois sortes :

- **Le jalon** — une barre par jalon, zéro saisie. Suffit tant qu'on ne pilote rien de fin.
- **Deux champs `Date`** (`Début` / `Cible`) — une tranche par ticket, donc la SÉQUENCE visible.
- Une itération — non employée ici.

🔴 **Le réglage n'est ni écrivable NI LISIBLE par l'API** — les deux, et c'est la seconde moitié
qu'on oublie. En écriture, `updateProjectV2View` n'accepte que `visibleFieldIds` ; en lecture, le
type `ProjectV2ViewConfiguration` n'expose **que** `visibleFields` (les deux vérifiés par
introspection du schéma). Conséquence pratique : on ne peut ni poser ce réglage, ni **contrôler
qu'il a été posé**. Le choix se fait dans l'interface web — ouvrir la vue, menu `⌄` de son onglet,
`Date fields`. Ne pas chercher une commande : il n'y en a pas.

**Le contrôle se fait donc à l'ÉCRAN, et il se fait tout seul** — le tableau est public, donc un
navigateur non authentifié suffit (skill `nodefony-browser`) :

```bash
S=src/packages/@nodefony/devkit/skills/nodefony-browser/scripts
NF_BROWSER_BASE=https://github.com NF_BROWSER_ACTIONS="clic:Month|clic:Quarter" \
  node $S/inspect.mjs "/orgs/nodefony/projects/2/views/3" "Release nodefony-core"
```

Le passage en `Quarter` n'est pas du confort : à l'échelle du mois, un jalon daté trois mois plus
loin n'a **aucune barre à l'écran** — et l'on conclut que le réglage a échoué alors qu'on regarde
à côté. Ce qui prouve que la vue lit bien les deux champs, c'est le bandeau de chaque groupe
(`Tue, Oct 6 - Tue, Dec 1`) : il reprend la première et la dernière tranche du jalon.

⚠️ **Les badges d'un groupe ne sont pas des mesures** : GitHub additionne tout champ numérique, si
bien qu'un `Ordre: 157.78` s'affiche à côté d'un `Jours: 47.5` pourtant juste. La somme d'ordres
ne veut rien dire ; ne pas la citer.

⚠️ **Le symptôme, quand ce réglage est faux : des barres qui n'ont aucun rapport avec les tranches
posées.** Et il envoie chercher au mauvais endroit, parce qu'on soupçonne les données ou le champ
`Jours`. Deux choses à savoir pour couper court :

- **Une vue Roadmap ne sait PAS lire un champ nombre.** `Jours` ne peut donc jamais être la source
  d'une barre, quoi qu'on en croie en la regardant.
- Le menu `Date fields` propose aussi les dates **automatiques** du projet — `Created`, `Updated`,
  `Closed`. Ce sont elles, les faux candidats : elles sont peuplées sur TOUS les items, donc la
  frise s'affiche, plausible et fausse. `Début`/`Cible`, elles, ne sont posées que sur l'engagé.

Le contrôle qui tranche AVANT de toucher à la vue — si les deux comptes se tiennent, le défaut est
dans le réglage, jamais dans les données :

```bash
npm run ticket:lint     # FRISE-A-TROUS : un jalon à moitié daté
```

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

## L'estimation en jours ne prédit rien — la mesure

⚠️ **L'estimation en jours ne prédit RIEN — c'est mesuré, pas supposé.** Sur 97 tickets fermés,
le travail constaté est de **une séance, quelle que soit la taille estimée** : 0,5 j → 1 séance ·
1 j → 1 séance · 2 j → 1 séance. Une « séance » est une journée qui porte des commits citant le
ticket. Autrement dit, le champ `Jours` classe des tickets qui coûtent tous à peu près pareil.
La cause n'est pas de la négligence : l'unité est calibrée sur quelqu'un qui code à la main,
alors que lire, chercher, éditer et vérifier tiennent en minutes. Ce qui coûte aujourd'hui, c'est
le **contexte à charger** et les **décisions à rendre** — et ça ne dépend pas de la taille du diff.

**Conséquence pratique, et elle est contre-intuitive : ce qui prédit le reste-à-faire, c'est le
NOMBRE de tickets ouverts, pas la somme de leurs jours.** 106 tickets ouverts ≈ 106 séances ;
les « 121 j » affichés ne veulent rien dire. Corollaire : **découper un ticket en trois le rend
trois fois plus cher**, parce que chacun paiera son chargement de contexte. Ne découper que
lorsque les morceaux se font dans des sessions différentes (§4 du `SKILL.md`).

Le chiffre ne se recopie pas d'ici : `ticket-effort.mjs` fait foi, il se relance.

Le coût de l'erreur n'est pas cosmétique : un ticket affiché « 3 j » se **reporte**, alors qu'il se
ferait dans la foulée — et le report fait repayer tout son contexte plus tard (§5 du `SKILL.md`, « quand prendre un ticket »).

```bash
node scripts/ticket-effort.mjs          # estimé vs constaté sur les tickets fermés, et le biais médian
node scripts/ticket-effort.mjs 41 56    # ceux-là seulement
```

Le constaté est une **borne basse** — la fenêtre de commits ignore l'exploration, les décisions et
les essais abandonnés. À lire comme un ordre de grandeur qui recale, jamais comme une durée.

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
