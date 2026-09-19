# Fermer un ticket — le geste est TRIPLE

> Référence du skill `nodefony-ticket`, chargée **avant de fermer** un ticket. Déclencheurs :
> « ferme ce ticket », « ce ticket est-il encore vrai ? », « quels tickets parlent de ce que
> j'ai changé ? », « compte rendu de fermeture ».
>
> **Maintenance** : vérité courante, jamais un journal. Éditer en place ; historique = `git log`.

**Un ticket qu'on ferme change un fait, et ce fait est recopié ailleurs.** C'est le défaut le plus
coûteux du pilotage par tickets, parce qu'il ne fait aucun bruit : le travail est bon, le ticket est
fermé, et deux documents plus loin une phrase continue d'affirmer l'état d'avant. Personne ne la
relit — on la croit, on estime dessus, on planifie dessus.

Vécu : le retrait d'un contrat de la surface publiée a rendu faux, du même coup, le bloc
« ✅ ce qui est déjà fait » d'un **ticket voisin**, trois passages d'un **ADR**, une **page de doc publique** et
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

⚠️ **`Closes #95` ne ferme RIEN depuis `dev`.** GitHub n'honore le mot-clé que sur la branche par
DÉFAUT, et le développement de ce dépôt vit sur `dev` : pousser laisse donc les tickets ouverts,
sans un mot. La fermeture est toujours un geste — `gh issue close` avec son compte rendu. Le
mot-clé garde son intérêt (il lie le commit au ticket dans la timeline, et il fermera au merge).

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

- **Une ancre juste ne rend pas un ticket vrai.** Vécu : un ticket pointait des lignes qui existaient toujours et
  affirmait au-dessus un état devenu faux. C'est le mode `--touched-by` qui l'attrape, pas la
  résolution d'ancres.
- **Un fichier que tout le monde cite n'est pas un indice.** Le journal de publication est cité par
  19 tickets : les retenir noierait les trois vrais. L'outil les écarte et **le dit**, avec leurs
  numéros — une troncature muette serait pire que le bruit.
