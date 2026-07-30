# BUG_REPORT — Nodefony Core

## BUG-2 — Angular monté en 22.1.0 : le lockfile imbriquait l'arbre au lieu de le hisser

**Statut.** Résolu. Les six paquets `@angular/*` de `src/modules/test-frontend-angular` sont en
`22.1.0` (`@angular/build` en `22.1.1`) ; `npm install` est vert, `npm ls` ne montre plus aucun
`22.0.8` ni `UNMET`/`invalid`, et le `build` du module passe.

**Cause réelle de l'ERESOLVE.** Ce n'était pas un conflit de versions (`@angular/build@22.1.1`
déclare `^22.0.0` sur toute la famille — cohérent avec `22.1.0`). `npm install` comparait la
nouvelle demande à un `node_modules` déjà présent sur disque en `22.0.8`, imbriqué sous
`src/modules/test-frontend-angular/node_modules/@angular/*` — et `package-lock.json` gardait ces
mêmes chemins imbriqués en clé, donc les recréait à l'identique même après une purge du dossier
seul.

**Fix ERESOLVE.** Retirer du `package-lock.json` les 5 entrées
`src/modules/test-frontend-angular/node_modules/@angular/{common,compiler,compiler-cli,core,platform-browser}`
(supprimées, pas éditées en place) + purger le dossier physique correspondant, puis
`npm install --workspace=@nodefony/test-frontend-angular`. npm recalcule alors une résolution
propre, sans référence à l'ancien arbre.

**Deuxième trou, découvert en vérifiant le build réel (pas juste le script `build` du module).**
Après ce premier passage, `npm ls` était propre et `npm run build` (rolldown, wrapper serveur)
passait — mais `npx vite build --config frontend/vite.config.generated.mjs` (le chemin réellement
emprunté par `ViteProcessSupervisor` au démarrage du dev server) échouait :
`Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@angular/compiler-cli' imported from
node_modules/@analogjs/vite-plugin-angular/src/lib/angular-vite-plugin.js`. Raison : cette
première résolution avait choisi d'imbriquer toute la famille `@angular/*` sous le workspace
plutôt que de la hisser à la racine — et `@analogjs/vite-plugin-angular` (dépendance directe de la
racine `nodefony-core`, hissée dans `node_modules/`) importe `@angular/compiler-cli` puis
`@angular/build/private` par résolution ESM Node **relative à son propre emplacement**, qui ne
remonte jamais dans le `node_modules` imbriqué d'un workspace frère. Ce n'est pas une régression de
la montée de version : en `22.0.8`, un artefact périmé (un pair optionnel auto-installé par npm à
une version dépareillée, `@angular/compiler-cli@22.0.6`, resté à la racine depuis une résolution
antérieure) masquait accidentellement ce même trou — `@nodefony/frontend` déclare
`@analogjs/vite-plugin-angular` en peer optionnel (correct), mais rien ne garantit que la famille
`@angular/*` concrète d'un module consommateur soit résolvable depuis la racine, l'ancêtre commun
réel de `@nodefony/frontend` et de tout module frontend Angular.

**Fix du deuxième trou.** Déplacé les 6 paquets (`build` inclus) de
`src/modules/test-frontend-angular/node_modules/@angular/*` vers `node_modules/@angular/*`
(racine) + rebasé les clés correspondantes dans `package-lock.json`, puis rejoué
`npm install --workspace=...` : npm a accepté ce placement et l'a conservé (dédupliqué proprement —
`@analogjs/vite-plugin-angular@2.6.4 -> @angular/build@22.1.1` apparaît comme une arête normale
dans `npm ls`). `npx vite build` compile alors réellement l'app Angular (253 modules, bundle émis
dans `public/dist/`).

**Le lock est REPRODUCTIBLE — prouvé, pas supposé.** Le fix a déplacé des dossiers à la main dans
`node_modules` : un arbre qui ne marche que sur la machine où il a été fabriqué aurait la même
apparence. `npm ci` (node_modules RASÉ, réinstallation stricte depuis `package-lock.json`) rend
exactement le même arbre — 6 paquets `@angular/*` à la racine, **0** imbriqué, `22.1.0`/`22.1.1` —
et `npx vite build` compile derrière (bundle émis). Ce qui est commité vaut donc pour un clone
neuf, pas seulement ici.

**Le hissage est désormais STRUCTUREL — le résiduel ci-dessous est fermé.** Il s'est d'ailleurs
rouvert au premier install suivant (montée de `@angular/build` en `22.1.2`) : npm a ré-imbriqué le
paquet sous le module et `vite build` est retombé. La cause n'était pas le lockfile mais une
divergence de configuration — le dépôt de développement déclarait `@analogjs/vite-plugin-angular`
à la RACINE (c'est de là que `@nodefony/frontend` l'importe, `presets/angular-vite.ts:25`) tout en
laissant `@angular/build` et `@angular/compiler-cli`, ses **peers**, dans le module. npm ne les
faisait coïncider que tant que les versions coïncidaient. Or le générateur, lui, place les quatre
au MÊME niveau (`scaffold/engine.ts` : `devDeps: vite, @analogjs/vite-plugin-angular,
@angular/build, @angular/compiler-cli`) — le dépôt ne reproduisait donc pas la configuration que
son propre `create app` produit. `@angular/build` et `@angular/compiler-cli` déplacés vers la
racine : une seule déclaration chacun, à l'endroit où le générateur les met. Effet de bord utile —
ces deux paquets entrent enfin dans le champ du banc anti-dérive (`create.test.ts` ne lit que
racine + core + studio + frontend + drizzle, jamais `src/modules/*`).

**Résiduel — hors du périmètre accordé pour cette tâche (implique `package.json` racine ou de
`@nodefony/frontend`, non touchés ici).** Rien ne garantit STRUCTURELLEMENT que la famille
`@angular/*` d'un module consommateur reste hissée à la racine : un futur `npm install` qui
retoucherait les pins `@angular/*` (ou un `dedupe`/install complet) peut retomber sur un arbre
imbriqué et recasser silencieusement `vite build`/le dev server Angular — aucun banc actuel ne
lance réellement `vite build` sur ce module pour le détecter. Deux pistes de fermeture durable,
toutes deux hors périmètre ici : (a) déclarer `@angular/compiler-cli` comme dépendance directe de
la racine, pour forcer le hissage à chaque install ; (b) un test d'intégration qui lance
`vite build` sur `test-frontend-angular` et échoue si ça régresse.

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
