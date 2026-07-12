# RETEX.md — digest des retours d'expérience (SAS, lu à chaque début de session)

> **Rôle** : ce fichier est le **sas** entre les retex bruts (`docs/session-retros/<date>-<id>.md`,
> jamais relus seuls) et les leçons durables (mémoires `feedback_*` indexées dans `MEMORY.md`).
> Il porte les **frictions récentes pas encore confirmées** (vues 1-2×). Le skill `nodefony-session`
> le **lit au START/RESUME** et le **met à jour au END** (ajout de 3-5 bullets du jour, par thème).
>
> **Règle anti-doublon (CRITIQUE)** : une leçon est **soit** ici (sas, non confirmée), **soit** en
> `feedback_*` (graduée, prouvée). **JAMAIS les deux.** Quand une friction atteint **3×** → mode
> CONSOLIDATE la promeut en `feedback_*` et la **retire d'ici**. Sinon dérive garantie (cf l'anti-pattern
> « liste dupliquée » que dénonce `nodefony-check-externals`).
>
> **Taille bornée** : ce fichier ne grossit jamais. Deux sorties (gérées par CONSOLIDATE, tous les
> 10-20 retex) : (a) friction ≥3× → graduée en `feedback_*` puis retirée ; (b) retex bruts vieillis →
> `archive/` + 1 ligne de résumé ici. Cible : ~1 écran. Format = bullet `[N× — date courte]` par thème.

---

## 📦 Dépendances / upgrade

- `[1× — 2026-07-10]` **Un « minor » d'outil peut casser la COMPILATION sans casser une assertion.** `vite 8.0.16 → 8.1.4` tire `rolldown 1.1.5`, dont `OxcOptions` **omet `tsconfig`** → notre `experimentalDecorators`/`emitDecoratorMetadata` n'est plus lu, `decorator.legacy` retombe sur `false`, les décorateurs sortent **bruts** et Node lève `SyntaxError: Invalid or unexpected token`. Symptôme trompeur : **fichiers morts en COLLECTE, 0 test failed** (`Test Files 2 failed | 65 passed` / `Tests 1705 passed`). Réflexe : un `Test Files failed` avec `0 Tests failed` = échec de transformation, PAS de logique → lire la sortie transformée (`server.transformRequest()` via l'API vite), pas la stack. Correction = `oxc: { decorator: { legacy: true, emitDecoratorMetadata: true } }` (source unique `vitest.oxc.ts` racine), **pas** un gel de version.
- `[1× — 2026-07-10]` **Vérifier `emitDecoratorMetadata`, pas seulement `legacy`.** L'injector résout par `design:paramtypes` en fallback ⇒ si la metadata n'est pas émise, l'auto-injection casse **silencieusement** (param `undefined`, aucune erreur). Toujours prouver la présence de `design:paramtypes` **avec le vrai type** dans la sortie compilée, jamais se contenter de « les tests passent ».
- `[1× — 2026-07-10]` **Un bump de MAJOR peut être un changement de NATURE du paquet.** `typescript@7` (port Go) ne publie plus d'API JS (`main: null`, pas de `lib/typescript.js`, `ts.createProgram === undefined`) → `@rollup/plugin-typescript`/`typescript-eslint`/`typedoc` cassent. Avant d'évaluer un major d'outillage : `jq '{main,types,exports}' node_modules/<p>/package.json` + un `import()` réel, AVANT de lire le changelog.
- `[1× — 2026-07-10]` **Réécrire des pins par `String.replace()` sur le texte du package.json touche la PREMIÈRE occurrence**, qui peut être dans `peerDependencies` et pas `devDependencies` (vécu : peer bumpé, devDep laissé → divergence). Réécrire par **bloc** (`npm pkg set "devDependencies.x=v"`), et auditer après coup avec `jq` bloc par bloc contre `git show HEAD:<f>`.
- `[1× — 2026-07-10]` **`npm outdated` ne voit pas les `peerDependencies` pinnées exactes** et `npm update` ne bouge pas un pin exact. Le lot « tout à jour » peut laisser des peers en arrière. Inventorier les 3 blocs.
- `[1× — 2026-07-10]` **Un alias npm ne renomme PAS le binaire.** `npm i -D tsgo@npm:typescript@7` a écrasé `node_modules/.bin/tsc` avec TS 7 (silencieux : `npx tsc --version` → 7.0.2). Puis `npm uninstall tsgo` a **délogé notre `typescript@6.0.3` hoisté** et exposé un `5.7.3` transitif. Deux règles : (a) pour deux versions du même outil, prendre un paquet au **binaire distinct** (`@typescript/native-preview` → `tsgo` ; `@typescript/typescript6` → `tsc6`) ; (b) **retirer un paquet de test par `git checkout package.json package-lock.json && npm install`, jamais `npm uninstall`**. Vérifier APRÈS install : `npx tsc --version` ET `require("typescript").createProgram`.
- `[1× — 2026-07-10]` **Un outil peut MASQUER un défaut du source.** rolldown a révélé que `@nodefony/http` **s'importe par son propre nom** (`Request.ts:28`) → il avale son `dist` (65→120 fichiers). Rollup ne bronchait pas. Corollaire : changer d'outil = **audit gratuit**. Externaliser systématiquement le nom propre du paquet.
- `[1× — 2026-07-10]` **`declarationDir` du tsconfig ÉCRASE `--outDir` de la CLI** : un `tsc --emitDeclarationOnly --outDir /tmp/x` a écrit dans le VRAI `dist/client/types` du repo. Passer `--declarationDir` explicitement pour toute génération de `.d.ts` hors-build.

## 🔧 Migration d'outillage (exécution)

- `[1× — 2026-07-10]` **Purger une dep = grep TOUS les blocs `scripts`, pas des clés devinées.** Le sweep lot 5 a couvert `build`/`dev`/`rollup` mais raté `build:force` (`rollup -c` → `command not found`, trouvé par le user au premier build). Réflexe : `jq '.scripts | to_entries[] | select(.value | test("<dep>"))'` sur les 21 package.json, puis grep global hors node_modules.
- `[1× — 2026-07-10]` **`npm pkg delete` est inconsistant en workspaces** (certains dirs silencieusement non modifiés dans une boucle). Pour une purge de masse fiable → `jq 'with_entries(select(.key|test(...)|not))'` directement sur les fichiers, puis UN `npm install` de resync.
- `[1× — 2026-07-10]` **Retirer un fichier d'un `include` tsconfig peut déplacer la racine commune** (TS5011 tsgo) : `tsconfigClient` sans `rollup.config.ts` → racine `./src` → layout `dist/client/types` cassé vs exports map. Fix = `rootDir` explicite. Vérifier le LAYOUT émis, pas juste l'exit 0.

## 🧪 Méthode de comparaison de builds

- `[1× — 2026-07-10]` **Comparer deux builds : la surface exportée par IMPORT RÉEL, pas le nombre de fichiers.** Le compte de `.js` ment (chunks vides, granularité de tree-shaking : rolldown 951 fichiers vs Rollup 854 dont 76 VIDES ; frontend 40→104 fichiers mais 290→237 Ko). Ce qui fait foi = `Object.keys(await import(dist/index.js))` avant/après. ⚠️ **Dans des PROCESS ISOLÉS** : charger deux builds du même paquet dans un process explose sur les registres globaux (`EntityRegistry: entity "session" already registered`).
- `[1× — 2026-07-10]` **Ne pas conclure « X est meilleur » sur un grep mal borné.** Deux faux positifs en une session : `grep -rl "node:fs" dist/client` matchait les `.d.ts` (pas les `.js`) → fausse « fuite de builtin » ; et `xargs` mange les guillemets → `import * as React from react` (code invalide) alors que la sortie était correcte. Toujours restreindre l'extension ET relire la ligne brute.
- `[1× — 2026-07-10]` **Un `grep` de plugins dans un `rollup.config.ts` compte le code COMMENTÉ** (`copy(`/`terser(` désactivés) et les faux amis (`replace(` = `String.prototype.replace`). Pour savoir ce qui est vivant : filtrer les lignes `^\s*//` et grepper les **imports**, pas les appels.

## 🧪 App générée `--link` (banc de test réel)

- `[1× — 2026-07-12]` **Une app `--link` a DEUX node_modules (app + checkout) = classe de bugs INVISIBLE dans le repo self-hosted** (node_modules unique hoisted). Vécu 2 fois le même jour : react en double (« Invalid hook call », page blanche → `resolve.dedupe`) et debugbar en 403 (realpath du paquet hors `fs.allow`). Réflexe : toute feature front se teste AUSSI depuis une app générée `--link`, pas seulement dans le repo.
- `[1× — 2026-07-12]` **Une liste de ports sondés est une CONVENTION, pas la topologie de l'app.** 3 occurrences du même faux négatif en 2 jours (readiness `--wait`, `reportReady` superviseur, rapport READY) : exiger « TOUS les ports » sur `[5151, 5152]` en dur crie « boot bloqué » sur une app `https:false` qui répond très bien. Sémantique juste : ready = AU MOINS UN port, l'état PAR port reste affiché (fail-loud sans mensonge).
- `[1× — 2026-07-12]` **Une page démo sans interaction se lit comme une page cassée.** Le user a conclu « react ne marche pas » devant une page qui MARCHAIT (h1 + JSON) mais n'avait ni bouton ni mouvement. Une vitrine générée doit prouver qu'elle est vivante : action utilisateur (bouton, input WS), pas juste du texte statique.
- `[1× — 2026-07-12]` **Ne jamais grepper le log d'un run détaché sans avoir vérifié l'exit du lancement** (sortie redirigée → un launch refusé laisse l'ANCIEN log en place → faux diagnostic « le fix ne marche pas », vécu). `rm` le log avant relance OU vérifier `exit=0` d'abord.
- `[2× — 2026-07-12 soir]` **Le runtime résout l'APP depuis process.cwd() → tout lancement depuis un sous-dossier boote un « projet fantôme »** (le package http pris pour l'app : 1 module, bind ::1, config défauts, ZÉRO warning). Vécu 2× dans la même session (start.sh puis `--write` de security:secrets qui a créé un `.env.local` dans le package). Réflexe : `cd <racine> &&` dans le MÊME appel avant tout `node bin/nodefony` ; le `cd "$ROOT"` est maintenant DANS start.sh.
- `[1× — 2026-07-12 soir]` **Un outil scopé projet ne doit avoir AUCUN filet non scopé** : le `nodefony stop` de start.sh respectait le multi-projet, mais le filet `kill -9 $(lsof -ti:PORT)` deux lignes plus bas a SIGKILLé le serveur d'une AUTRE app (vécu : « serveur arrêté (SIGKILL) » chez le user). Auditer les FILETS de secours avec la même règle que le chemin principal.
- `[1× — 2026-07-12 soir]` **eta `autoTrim: "nl"` mange le newline après CHAQUE tag** → 3 lignes `KEY=<%= v %>` sortent sur UNE ligne. Un bloc de lignes générées = UN tag avec `join("\n")`.
- `[1× — 2026-07-12 soir]` **`$PIPESTATUS` n'existe pas en zsh (c'est `$pipestatus`)** → `${PIPESTATUS[0]:-$?}` évalue silencieusement `$?` du DERNIER maillon (exit toujours 0). Mesurer un exit code = run SANS pipe, puis `echo $?`.
- `[1× — 2026-07-12 soir]` **Le manifest de complétion est un CACHE par projet** : un fix de complétion ne se voit qu'après régénération (prochain boot dev) ou purge de `node_modules/.cache/nodefony/cli-manifest.json` — tester le `__complete` réel APRÈS purge, sinon on teste l'ancien manifest.

## 🖥️ CLI / tests e2e process

- `[1× — 2026-07-10]` **Un e2e qui spawne le binaire valide le DIST, pas le source.** Le filet CLI (`node bin/nodefony …`) a été lancé APRÈS le refacto mais AVANT `npm run build` → 12 verts… sur l'ANCIEN code. Réflexe : tout test qui spawn un binaire/dist = **rebuild d'abord**, sinon le vert ne prouve rien. (Cousin du « dist périmé » mais côté VALIDATION, pas boot.)
- `[1× — 2026-07-10]` **La sortie vitest se termine par ~40 lignes blanches** → un `cmd | tail -N` après le run rend une sortie VIDE (2× dans la session, on croit à un échec silencieux). Fiable : rediriger vers un fichier puis `grep -E "Test Files|Tests"` dessus.
- `[1× — 2026-07-10]` **Une mémoire de dette d'archi peut être PÉRIMÉE côté « déjà réglé »** : la dette CLI listait le double-boot prod/cluster comme ouvert alors que `e51af263` l'avait corrigé (asserts boot-count=1 VERTS). Avant d'auditer une dette mémorisée, croiser chaque point avec `git log`/le code — la devise vaut aussi pour les mémoires IA.
- `[1× — 2026-07-10]` **Un script shell GÉNÉRÉ se valide en l'EXÉCUTANT dans le vrai shell, pas en le parsant.** `zsh -n` était vert alors que 2 bugs cassaient la complétion en réel : offset `${words[@]:2}` (l'**offset d'expansion zsh est 0-based** contrairement à l'indexation 1-based → `:1` pour sauter le 1er mot) + `compdef` introuvable sans `compinit` (échec SILENCIEUX → TAB retombe sur les fichiers). Les 2 trouvés par le retour user, pas par les tests. Harnais qui marche : `zsh -f` HOME jetable (vérifier `_comps[cmd]`) + faux binaire `./node_modules/.bin` qui capture ses args.

> ♻️ Gradué 2026-07-12 : « le cwd Bash dérive entre appels » (4×) → [[feedback_bash_cwd_drift]].

## 🏎️ Perf / bancs A/B

> ♻️ CONSOLIDATE 2026-06-12 : les patterns A/B (mono-route ment / verdict 3 issues / stash+rebuild
> par flip / banc concurrent bench-frameworks) sont **gravés dans `nodefony-load-test` SKILL.md**
> (niveau 3) — retirés d'ici (anti-doublon). Restent les leçons non couvertes :

- `[1× — 2026-07-08]` **Un ORM réseau (PG) ne bat pas sqlite en local si le POOL par défaut n'est pas dimensionné.** Banc `auth/me` en PG réel : c=25 → **696 RPS** (≈ sqlite 689), mais c=50 → **294 RPS** (chute). Ce n'est PAS une limite de Postgres : le pool `pg` par défaut = **10 connexions** → 50 req concurrentes font la queue derrière 10 conns. sqlite (sync, mono-connexion) est PLAT quelque soit la concurrence ; PG async DEVRAIT scaler MAIS son avantage n'apparaît que si le pool ≥ concurrence. + round-trip localhost = latence que sqlite in-process n'a pas. Réflexe : avant de conclure « PG ne bat pas sqlite », vérifier `pool.max` (follow-up : exposer la taille du pool dans la config drizzle). Présenter les 3 régimes (c=10/25/50) et nommer le goulot (pool), jamais un point unique.
- `[1× — 2026-06-28]` **Un RPS ne prouve PAS le « gain » d'une session de cleanup/refacto hors hot-path — et un gain runtime de VERSION Node ≠ un gain de CODE.** Session « tirer parti de Node 24/26 » (deps→natif, `using`, `RegExp.escape`) : 0 changement dans le pipeline requête → débit steady-state inchangé. Le seul levier throughput (AsyncContextFrame = ALS rapide) dépend de la **version Node**, or on tourne sur 26 depuis le début → déjà actif AVANT les commits, un RPS « après » ne le compare à rien. Méthodo honnête : (1) RPS = référence de capacité, pas un avant/après ; (2) le gain dep-cleanup se voit au **boot + RSS/heap** (paquets en moins) ; (3) le gain ALS se mesure **même code Node 22 vs 26**. Ne JAMAIS présenter un RPS comme « le gain de la session » (devise : ne pas annoncer un gain non prouvé). Le user a validé : « tu dis que ce n'est pas objectif » → test abandonné.
- `[1× — 2026-06-25]` **Débit cluster : optimum = nombre de cœurs PHYSIQUES, sur-fork = contre-productif** (courbe live wrk,
  livez, machine 6 phys/12 logiques) : mono **6683** → 3w **17114** → **6w 19076 (pic = cœurs phys)** → 10w **15562 (−18 % vs 6w,
  p99 ×2.5)**. Au-delà des cœurs, les workers se battent → context-switch/cache-thrash → débit ↓ + p99 explose. L'HT (12 log)
  ne repousse PAS le plafond. → `--workers auto` (cgroup-aware ≈ cœurs) = le bon défaut. **Le vrai gain cluster = la LATENCE p99**
  (mono p99 **285ms** sur 100 conns → cluster **18-47ms**, ÷6-15), pas tant le débit.
- `[1× — 2026-06-25]` **Client de charge CO-LOCALISÉ bride le scaling mesuré** : wrk sur la MÊME machine que les workers leur
  vole des cœurs → 6w = ×2.85 du mono (pas ×6 attendu). Un client DISTANT révélerait le vrai plafond (≈×6). Toujours dire
  « débit bridé par le co-location » quand client+serveur partagent la machine — ne pas conclure « ça ne scale pas ». Idem
  node-client (http-load.mjs) ÷ wrk : node lui-même CPU-bound bride (mesuré : node+TLS 9583 vs wrk H1 17114 = +78 % juste en changeant de client/transport).

## 🗂️ Thèmes archivés (CONSOLIDATE 2026-07-10)

> Les leçons `[1×]` antérieures au ~2026-06-28 (jamais re-vécues) et les thèmes entiers ci-dessous
> vivent dans [`archive/RETEX-snapshot-2026-07-10.md`](archive/RETEX-snapshot-2026-07-10.md) —
> rien n'est perdu, mais le SAS ne porte que le chaud. Thèmes archivés : **Shell/environnement**
> (les ≥3× sont gradués : [[feedback_rg_no_replace_flag]], [[feedback_shell_no_unquoted_multipath]]),
> **Git/commit** (doublons de [[feedback_commit_fr_apostrophes]] purgés), **Front/Studio/UX**,
> **Red-team/délégation IA**, **Conception deps & arbitrage**, **Archi/isomorphisme**,
> **Redis/portabilité**, **Build/dist/boot**, **Conception/vocabulaire**.
> Gradués aussi : [[feedback_bench_isolate_session_store]] (3× mesures+profiling) ; « batcher les
> edits backend pendant test live front » (3×) = déjà gravé CLAUDE.md racine §Hygiène n°4.
> Consolidation détaillée : [`CONSOLIDATION-2026-07-10.md`](CONSOLIDATION-2026-07-10.md).
