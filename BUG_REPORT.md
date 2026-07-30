# BUG_REPORT — Nodefony Core

## BUG-2 — Angular ne peut pas monter en 22.1.0 : le lockfile reconstruit l'arbre 22.0.8

**Symptôme.** Les six paquets `@angular/*` de `src/modules/test-frontend-angular` portés de
`22.0.8` à `22.1.0` (`@angular/build` en `22.1.1`) → `npm install` sort en **ERESOLVE**, trois
tentatives, même erreur :

```
While resolving: @nodefony/test-frontend-angular@10.0.0-poc.1
Found: @angular/common@22.0.8
  src/modules/test-frontend-angular/node_modules/@angular/common
  peer @angular/common@"22.0.8" from @angular/platform-browser@22.0.8
Conflicting peer dependency: @angular/core@22.1.0
```

**Ce qui est écarté.** Les versions demandées sont cohérentes entre elles : `@angular/build@22.1.1`
déclare `^22.0.0` sur toute la famille (`npm view @angular/build@22.1.1 peerDependencies`), et
`@angular/core@22.1.0` n'impose rien sur `typescript` — la contrainte `>=6.0 <6.1` vient de
`compiler-cli`, déjà satisfaite par le `6.0.3` du dépôt. **Le conflit n'est pas dans les versions.**

**La cause probable.** `package-lock.json` retient une arborescence **imbriquée** sous
`src/modules/test-frontend-angular/node_modules/@angular/*` en `22.0.8`, et la reconstruit à chaque
install. Purger `node_modules/@angular` **et** le `node_modules` du module ne suffit pas : le
lockfile la réécrit.

**Piste non essayée** (fin de session, arbre volontairement laissé sain) : supprimer les entrées
`@angular/*` du lockfile, ou régénérer le lock entier hors ligne puis comparer le diff. À faire
sur un arbre commité, jamais en fin de session.

**Contournement actuel.** Angular reste en `22.0.8`. Aucune urgence : `22.1.0` est une mineure
publiée le 2026-07-29 et n'apporte rien dont le dépôt dépende. Elle ne débloque PAS TypeScript 7
non plus (`compiler-cli@22.1.0` exige toujours `typescript >=6.0 <6.1`).

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

**Ne se reproduit plus.** Rejoué dans deux décors — le dépôt lui-même et une application témoin
liée aux workspaces — avec un hôte de base inexistant : la sortie d'erreur reçoit près de sept
kilo-octets, l'échec du connecteur y est nommé, code 1. Le symptôme « pas un octet » n'a pas été
retrouvé.

**Ce qui a été trouvé en cherchant.** La garde qui prétendait tenir cet endroit ne s'exécutait
jamais : `initSyslog` décidait du mode machine sur `commander.opts().json`, or `--json` est déclaré
par la SOUS-commande `inspect`, si bien que les options du programme racine ne l'ont jamais porté.
Sonde posée dans le code compilé : `opts().json` vaut `undefined` aux deux appels. Ce qui rendait
réellement le flux de données propre était `quietBoot`, seul à scanner `process.argv`. La branche a
donc été retirée au profit d'une détection unique, effective, sur argv — et le test unitaire qui la
gardait posait sa condition à la main (`setOptionValue`), validant un chemin que le CLI n'emprunte
pas : il vérifie désormais quelles sévérités franchissent le filtre.

**Ce qui reste ouvert.** L'observation initiale — zéro octet sur les deux flux — n'est expliquée par
aucune de ces découvertes. Le chemin qui PRODUIT ce symptôme est en revanche identifié et verrouillé :
couper le journal en mode machine le reproduit à l'identique, et un banc de bout en bout le refuse
désormais (`CliIntegration.test.ts`, « un boot en échec n'est jamais silencieux » — vu rouge sur cette
neutralisation, avec le message « MUET », avant d'être vert). Si le silence réapparaît, ce banc tombe
en nommant la panne.

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
