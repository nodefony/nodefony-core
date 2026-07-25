# BUG_REPORT — Nodefony Core

## BUG-1 — un échec de connexion à la base fait sortir `inspect` en 1, sans un mot

**Symptôme.** Dans une application dont la base configurée est injoignable
(`NF_DATABASE_URL=postgres://app:pwd@db:5432/app`, hôte inexistant) :

```
nodefony inspect routes --json   →  stdout 0 octet · stderr 0 octet · code 1
nodefony inspect services --json →  idem (tout sujet confondu)
```

Aucun message, nulle part. L'appelant conclut que l'application n'a ni routes ni services. Trouvé
par le banc de découvrabilité : l'agent a annoncé un nombre de routes inventé plutôt que de
constater une panne qu'aucune sortie ne lui signalait.

**Reproduction.** Dans une app générée, poser un `NF_DATABASE_URL` vers un hôte qui n'existe pas,
puis lancer `nodefony inspect routes --json`. Avec la base neutralisée, la même commande rend
122 routes.

**Est-ce mon diff ?** Non — pré-existant. Vérifié avec `-d` : la journalisation complète affiche les
étapes du boot jusqu'à `SESSION STORAGE registered : drizzle`, puis s'interrompt sans une ligne
d'erreur. `grep -icE "error|critic|econnrefused"` sur la sortie complète : **0**.

**Ancrage.** `src/packages/@nodefony/drizzle/nodefony/service/DrizzleService.ts:64` journalise
pourtant l'erreur (`this.log(e, "ERROR")`) avant de la relancer — donc elle est émise et perdue
entre là et la sortie standard.

**Ce qui reste supposé.** Le buffer de sortie a été écarté (`Syslog.ts:48` : stderr reste immédiat
par conception). Restent deux pistes non tranchées : le transport de log n'écoute pas encore — ou
plus — au moment où l'erreur est émise ; ou le processus meurt sur un rejet non capturé avant que le
hook n'ait journalisé.

**Partiellement corrigé.** `CliKernel.initSyslog` retournait sans brancher aucun transport dès que
`--json` était passé, alors que son propre commentaire promettait que « les erreurs partent sur la
sortie d'erreur ». Les sévérités 0..3 sont désormais branchées, `stdout` restant réservé au flux
JSON. Nécessaire, mais **pas suffisant** : dans ce cas précis il n'y a rien à laisser passer.

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
