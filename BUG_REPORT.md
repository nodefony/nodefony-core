# BUG_REPORT — Nodefony Core

**Aucun bug ouvert.**

## À quoi sert ce fichier

C'est la **boîte aux lettres d'un blocage**, pas une archive. Le `CLAUDE.md` du dépôt en fait la
sortie obligatoire d'une session autonome : si une commande de test échoue **trois fois d'affilée
avec la même erreur**, on s'arrête et on écrit ici — au lieu d'insister ou de contourner en silence.

L'**historique** des bugs déjà clos n'a pas sa place ici : il vit dans `git log` (`git log -p --
BUG_REPORT.md`) et dans les messages de commit des correctifs. Un bug résolu qui reste écrit se
périme — ses ancrages `fichier:ligne` glissent au premier refactor, et son « fix proposé » finit par
décrire un code qui n'existe plus.

## Écrire une entrée

Une entrée = un titre `## BUG-<n> — <symptôme observé>`, puis :

- **Symptôme** — la commande lancée et ce qu'elle affiche (l'erreur bloquante seule, pas le log complet).
- **Reproduction** — la commande minimale, et si le rouge tient en isolation (`npx vitest run <fichier>`)
  ou seulement en suite (indice de ressource partagée, pas de régression).
- **Est-ce mon diff ?** — `git stash` puis relancer. Si le rouge survit au stash, c'est pré-existant :
  le dire. Sinon, ne pas l'écrire ici, le corriger.
- **Ancrage** — `fichier:ligne` du point suspect, vérifié au moment de l'écriture.
- **Ce qui reste supposé** — l'hypothèse non vérifiée, nommée comme telle.

Le protocole de diagnostic (flake mémoire, vert isolé et rouge en suite, qualifier une régression par
une baseline) vit dans le skill `nodefony-debug` — ne pas le recopier ici.

## Quand refermer

Une entrée se **supprime** dès que le correctif est commité, en citant le hash dans le message de
commit. Le fichier revient alors à « aucun bug ouvert » : son état normal.
