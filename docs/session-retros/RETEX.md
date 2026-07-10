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
- `[4× — 2026-07-10]` **`start.sh` TIMEOUT 25 s = faux négatif quand la vérif turbo initiale est longue** : le serveur boote APRÈS le timeout ; une suite intégration lancée aussitôt → 285 fails ECONNREFUSED faux. Réflexe : `curl health` avant de qualifier, et élargir la fenêtre (follow-up gravé au kit rolldown).
- `[1× — 2026-07-10]` **Retirer un fichier d'un `include` tsconfig peut déplacer la racine commune** (TS5011 tsgo) : `tsconfigClient` sans `rollup.config.ts` → racine `./src` → layout `dist/client/types` cassé vs exports map. Fix = `rootDir` explicite. Vérifier le LAYOUT émis, pas juste l'exit 0.

## 🧪 Méthode de comparaison de builds

- `[1× — 2026-07-10]` **Comparer deux builds : la surface exportée par IMPORT RÉEL, pas le nombre de fichiers.** Le compte de `.js` ment (chunks vides, granularité de tree-shaking : rolldown 951 fichiers vs Rollup 854 dont 76 VIDES ; frontend 40→104 fichiers mais 290→237 Ko). Ce qui fait foi = `Object.keys(await import(dist/index.js))` avant/après. ⚠️ **Dans des PROCESS ISOLÉS** : charger deux builds du même paquet dans un process explose sur les registres globaux (`EntityRegistry: entity "session" already registered`).
- `[1× — 2026-07-10]` **Ne pas conclure « X est meilleur » sur un grep mal borné.** Deux faux positifs en une session : `grep -rl "node:fs" dist/client` matchait les `.d.ts` (pas les `.js`) → fausse « fuite de builtin » ; et `xargs` mange les guillemets → `import * as React from react` (code invalide) alors que la sortie était correcte. Toujours restreindre l'extension ET relire la ligne brute.
- `[1× — 2026-07-10]` **Un `grep` de plugins dans un `rollup.config.ts` compte le code COMMENTÉ** (`copy(`/`terser(` désactivés) et les faux amis (`replace(` = `String.prototype.replace`). Pour savoir ce qui est vivant : filtrer les lignes `^\s*//` et grepper les **imports**, pas les appels.

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
