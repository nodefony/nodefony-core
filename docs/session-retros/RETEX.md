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

## 🏎️ Perf / bancs A/B

- `[1× — 2026-06-11]` **Un profil MONO-ROUTE ment sur le coût d'un scan linéaire (position-dépendant)** :
  « scan routing = 0,9 % » mesurait la route #31 d'une table de 186 → la table dev réelle (222 routes,
  route bench pos 134) payait ~4× plus. L'index « gain borné, structurel probable » a rendu **+15,3 % NET**
  (et +24,9 % sur littérale pos 151). → pour tout poste O(N) : mesurer AUSSI un cas défavorable (fin de
  table) avant de classer le levier ; ne pas généraliser un % profilé sur UNE position.
- `[1× — 2026-06-11]` **Optimiser en RÉDUISANT l'ensemble scanné, sans toucher la logique de match** :
  l'index de routes ne court-circuite jamais `resolver.match()` (merge ordonné par position, skip des
  seules candidates qui ne POUVAIENT pas matcher) → sémantique préservée par construction, banc 25
  invariants vert du 1ᵉʳ coup, 0 itération de débogage. Pattern : prouver « skip inobservable » (pas
  d'effet de bord avant hit) plutôt que réécrire la sémantique dans la structure d'index.
- `[2× — 2026-06-11]` **Verdict A/B honnête = 3 issues possibles** : gain net (T1 +10,8 %, 2 paires disjointes),
  structurel-gardé-en-le-disant (T2/T3/T4 : médiane +1,5-5 % MAIS chevauchement → « RPS bruit » dans le commit),
  ou rejet. Un levier profilé ~1,7-2,6 % est INDISTINGUABLE du bruit ±5 % machine → prévoir d'emblée
  l'argument structurel (Pdu/GC/closures) sinon paire 3 + re-profil pour rien. (T4 : +1,8 % méd.,
  min(new)>max(old) mais < ±5 % → structurel assumé, pattern confirmé 2 sessions de suite.)
- `[1× — 2026-06-11]` **A/B d'un diff STRUCTUREL (sans toggle env) = `git stash push -- <fichiers du diff>`** +
  rebuild du package entre chaque flip (new→stash→old→pop→new2→stash→old2→pop). Marche bien ; le dist ne
  suit PAS le stash → rebuild après CHAQUE flip + une dernière fois après le pop final, sinon on benche l'autre code.
- `[1× — 2026-06-11]` **« 1× par socket » naïf = piège keep-alive** : node RÉ-ARME socket.setTimeout aux
  transitions keep-alive (server.timeout 120 s ↔ keepAliveTimeout 5 s) → tout état posé « une fois par socket »
  peut être écrasé dès la requête 2. Toujours re-vérifier la valeur par requête (check conditionnel cheap).
- `[1× — 2026-06-11]` **Comparer à conditions égales révèle plus que profiler** : Express scanne linéairement
  AUSSI et double Nodefony → le routing était hors de cause AVANT d'ouvrir le profil. Le banc concurrent
  (sandbox bench-frameworks/) est réutilisable après chaque vague.

## 🐚 Shell / environnement d'exécution

- `[1× — 2026-06-11]` **ENOSPC FANTÔME du harness Bash** (« temp filesystem full (0MB free) » sur la capture
  stdout) alors que le disque a 3 To libres — intermittent, corrélé aux `grep` multi-fichiers ; `df`/`ls`
  passaient. → contournement fiable : **rediriger l'output vers un fichier + le lire avec `Read`**
  (`grep … > /tmp/x.txt 2>&1; echo ok`). Ne PAS relancer 3 variantes de la même commande qui échoue pareil.
- `[1× — 2026-06-11]` **`replace_all` peut réécrire le corps de la méthode qu'on vient d'INTRODUIRE** : T4c,
  extrait `fireRequestEnd()` contenant `return this.context.fireAsync("onRequestEnd", this)` PUIS `replace_all`
  de ce même appel vers `this.fireRequestEnd()` → la méthode s'appelle elle-même = récursion infinie (Maximum
  call stack au 1er hit). Attrapé par le HEALTH check du start.sh (500). → quand on extrait une méthode puis
  qu'on `replace_all` les call sites, EXCLURE la nouvelle méthode (ordre inverse : replace_all D'ABORD, extraire
  ENSUITE — ou re-vérifier son corps après).
- `[4× — 2026-06-12]` **`Edit` exige un `Read` (l'OUTIL) préalable — lire via `sed`/`cat` Bash ne compte PAS** :
  re-frappé V4 (`routerDecorators.ts`), 3e fois (`RedisBackplane.test.ts`), 4e fois session nettoyage
  (`project_hardening_before_p6.md` lu au `sed` → Edit refusé). → pour un fichier qu'on va MODIFIER :
  `Read` directement (même partiel) ; `sed`/`grep` Bash = consultation pure UNIQUEMENT.
  **≥3× → à graduer en `feedback_*` au prochain CONSOLIDATE.**
- `[1× — 2026-06-10]` **client/preuve WS standalone = `WebSocket` GLOBAL natif (Node ≥ 22), PAS le package `ws`** :
  `import WebSocket from "ws"` depuis un `.mjs` sous `src/modules/*/nodefony/poc/` → `ERR_MODULE_NOT_FOUND` (ws
  non résolvable à cette profondeur). Le global natif marche sans dép — **API WHATWG** : `ws.addEventListener("message",
e => JSON.parse(e.data))` (string), `.send()`, PAS `.on()`. + `cd <module> && bash .claude/skills/.../start.sh` casse
  le chemin RELATIF du script (cwd persiste) → `cd <racine>` AVANT tout script skill (cf [[feedback_cd_startsh_relative_path]]).
- **Shell Bash instable sous charge** `[1× — 2026-05-31]` : quand le serveur dev + 4 Vite tournent,
  le Bash renvoie des **sorties dupliquées ×2-3, vides, ou annule les appels parallèles en cascade**.
  → **1 commande Bash à la fois** (pas de parallèle), **`Read` plutôt que `cat`/`sed`/`tr`** pour lire
  un fichier, et si ça délire : arrêter de relancer 5 variantes (toutes annulées si une échoue).
  Suspect : machine saturée. Confirmer 1× de plus avant de graduer.
- `[1× — 2026-06-06]` **daemon `claude daemon run --origin transient` zombie à ~96 % CPU pendant ~11 h** (le user
  en voyait 4) : un daemon claude détaché peut rester hung et saturer le CPU. → `ps -Ao pid,%cpu,etime,command | grep
claude` au moindre doute perf machine ; **le USER tue** le daemon transient hung (`kill <pid>`) — ne pas tuer un
  process claude depuis la session active. Le serveur dev (nodefony+vite) à 0 % CPU n'était PAS le coupable.
- `[1× — 2026-06-07]` **le cwd PERSISTE entre appels Bash après un `npm run`/`cd <module>`** : après `cd
src/packages/@nodefony/http` (implicite via les `npm run build/test`), un `git add src/packages/@nodefony/http/...`
  depuis ce cwd cherche `…/http/src/packages/@nodefony/http/…` → `pathspec did not match`. → soit chemins
  **relatifs au cwd courant** (`git add nodefony/src/...`), soit `git -C <racine>`. Variante de
  [[feedback_cd_startsh_relative_path]] (ici = persistance du cwd, pas un `cd` inline).
- `[1× — 2026-06-08]` **tmpfs du harness sature (ENOSPC) ≠ disque plein** : rediriger les gros logs (build turbo ~1m24, suites
  vitest 7000+ lignes) vers `/tmp/x.log` remplit le **filesystem temp dédié du harness** (`/private/tmp/claude-*/.../tasks`,
  petit quota) alors que `df` du disque montre 3 To libres → les Bash suivants échouent « ENOSPC ». → rediriger vers `/dev/null`
  - `grep` le résultat, ou `> /tmp/x.log` PUIS `rm` aussitôt après extraction. Ne pas accumuler les logs verbeux.
- `[5× — 2026-06-11]` **`cd X && cmd1 ; cmd2` → `cmd2` tourne dans X, pas dans Y** (re-frappé V4 : `cd framework && build && git add src/packages/...` → pathspec did not match, chemin doublé ; fix = `git -C <racine>`) (re-frappé V3 : `cd framework && build && bash .claude/skills/…` → script introuvable — relancer les scripts skill depuis la RACINE) : frappé ≥4× en une session (mesures
  coverage/test de drizzle PUIS mongoose). Le 2ᵉ `npm test`/`npm run coverage` après un `;` ou un `printf` **reste dans le
  cwd du `cd` précédent** → on mesure 2× le même module (vu : « mongoose 47 » = en fait drizzle re-run). → **un `cd <Y> &&
cmd` EXPLICITE par module**, jamais enchaîner `cmd2` en comptant sur un cwd implicite. Variante directe du cwd-persiste ci-dessus.

## ⚙️ Build / dist / boot (frictions confirmées → voir mémoires)

- `[1× — 2026-06-08]` **`npm install` ne purge pas le bloc workspace orphelin du `package-lock`** après suppression d'un package :
  l'arbre transitif est bien pruné (−2820 L, symlink `node_modules/@nodefony/X` retiré) mais l'entrée `"src/packages/@nodefony/X"`
  reste, marquée `"extraneous": true` → un futur `npm ci` serait incohérent. → la **retirer à la main** (Edit du bloc), puis
  `node -e JSON.parse` + `npm install --package-lock-only` pour confirmer que npm ne la réintroduit pas.
- `[1× — 2026-06-08]` **un script `test: "vitest run"` SANS `vitest` en devDep = latemment cassé** : drizzle ET mongoose
  déclaraient le script mais pas la dep → binaire introuvable, et `npm install` dit « up to date » (il ne devine pas une dep
  manquante non déclarée). → **déclarer la devDep** puis install. Diagnostiquer la résolution avec
  **`node --input-type=module -e "await import.meta.resolve('x')"` (ESM)**, PAS `require.resolve` (trompeur : échoue sur un
  package `exports` import-only comme `@nodefony/http` alors que l'`import` ESM marche → faux négatif).
- Ces frictions sont **déjà graduées** — ne pas les redupliquer ici, juste les rappeler :
  - `npm run clean` détruit le **dist racine** (app) → `npm run build` foreground + `npx rollup -c`
    racine avant tout start → [[feedback_root_dist_stale_modules]].
  - `cd` dans une commande fait dériver le cwd → chemins relatifs cassés → [[feedback_cd_startsh_relative_path]].
  - Turbo cache sert des logs/dist périmés → [[feedback_turbo_cache_stale_logs]].
- `[1× — 2026-05-31]` **build turbo en arrière-plan incomplet** : après `clean`, un `npm run build`
  lancé en background n'avait pas régénéré tous les dist (drizzle/studio manquants) → 2 boots ratés.
  → build complet **foreground** et vérifier `ls dist/index.js` des modules clés avant start. (variante
  du pattern « created dist menteur » — à fusionner si revu.)
- `[2× — 2026-06-10]` **build turbo répété en itération = douleur user** : `npm run build` (turbo, tout le
  monorepo) à CHAQUE petit changement → « build long !!! » (re-frappé 06-10 : 2 full builds quand 1 ciblé +
  1 `npx rollup -c` racine suffisaient). → en itération, builder **CIBLÉ** workspace par workspace
  (`cd src/packages/@nodefony/<m> && npm run build`) ; **`nodefony.config.ts`/app racine = `npx rollup -c`
  à la racine SEUL** ; réserver le turbo complet aux merges/refactors croisés ou code+config simultanés.
  Un changement de type du core qui n'impacte que le runtime des consommateurs (ils importent le dist)
  ne nécessite PAS de les rebuilder. → candidat graduation `feedback_*` au prochain frappé.
- `[1× — 2026-06-09]` **multi-restarts du DevSupervisor empilent les boots dans `/tmp/nodefony-server.log`** :
  plusieurs « ✓ Prêt » dans le log → on diagnostique un VIEUX boot et on conclut à tort que le code ne marche
  pas (vécu sur le détail ORM, qui marchait en réalité). → AVANT de diagnostiquer un boot : `grep -c "✓  Prêt"`
  le log ; si > 1, ne lire que le DERNIER bloc (ou `stop.sh` + `start.sh` propre, log neuf).
- `[1× — 2026-06-09]` **`onServersReady` émis en fire-and-forget** (`Kernel.initServers` : `fireAsync(…)` NON
  awaité) → ses listeners courent APRÈS le récap `onPostReady` (race microtask) : un détail posé par un listener
  `onServersReady` (ex. report ORM) n'est pas vu par le récap. → **`await fireAsync("onServersReady")`** garantit
  que ses listeners ont fini avant `onPostReady` (boot-only, surcoût négligeable).
- `[1× — 2026-06-09]` **ajouter une méthode PUBLIQUE au `Kernel` casse `IKernel → Kernel`** : un consommateur
  cross-module passe `this.kernel: IKernel` à un param typé `Kernel` (classe) ; ça compile tant qu'`IKernel`
  couvre l'API publique, mais une nouvelle méthode du Kernel non déclarée dans `IKernel` → TS2345 « not
  assignable » (latent, révélé par rebuild turbo). → (1) déclarer la nouvelle API publique dans `IKernel` ;
  (2) typer les consommateurs cross-module sur le **contrat `IKernel`**, jamais la classe concrète.
- ✅ **CORRIGÉ 2026-06-01** — `dist/types` des packages manquants au pre-push typecheck (vu 3× : orm-core ×2,
  user ×1) **bloquait `git push`** (TS2307). **Cause racine** : le core `nodefony` importe http/framework/
  security/user/orm-core (cycle inversé — ces packages ne sont PAS des deps turbo du core) → `turbo run
typecheck` lançait le typecheck du core EN PARALLÈLE du build de ces packages → RACE (types pas encore là).
  **Fix** : hook `pre-push` = `npx turbo run build && npm run typecheck` (build TOUT avant le typecheck →
  plus de race ; turbo caché → ~qq s). Fini le rebuild manuel `--force`. Cf [[feedback_turbo_cache_stale_logs]].
- `[1× — 2026-06-04]` **un bare import non listé dans `external` (rollup root) n'est PAS forcément bundlé** :
  ajouté `import { z } from "zod"` dans la config app (zod absent de l'array `external` de `rollup.config.ts`).
  Présumé « zod va gonfler le dist » → FAUX : `dist/.../schema.js` faisait 3.5 KB avec `import 'zod'` conservé
  (node-resolve a laissé le bare specifier externe, résolu au runtime via le hoisting npm). → **vérifier le
  dist** (taille + `grep import 'zod'`) plutôt que présumer un bundle ; pas besoin de toucher `rollup.config.ts`
  (interdit) pour un peerDep hoisté résolvable au runtime.
- `[1× — 2026-06-04]` **MAIS le rollup du CORE externalise par ALLOWLIST stricte** (`external.some(...)`,
  ≠ app lenient) → un nouveau peerDep (`zod`) y est **bundlé** s'il n'est PAS ajouté à l'array `external`.
  Conséquence directe de D1 = 1 ligne dans `rollup.config.ts` (protégé → demandé avant). Vérif post-build :
  `schema.js` 3.4 KB + `grep "import 'zod'"` conservé. « peerDep auto-externe » DÉPEND du rollup du package.
- `[1× — 2026-06-04]` **erreur ESM runtime juste après l'ajout d'un dep = suspecter un dist PARTIEL/racy
  AVANT la résolution elle-même** : `Cannot find '.../zod/index.js'` à un test d'intégration venait d'un
  **build partiel** (watch rebuildant en plein edit), pas d'un vrai bug (zod/index.js existait). → `clean &&
build` + tester le **bin directement** (`./bin/nodefony --version`) avant d'enquêter sur la résolution.
- `[1× — 2026-06-05]` **le dist du CORE est sous `dist/node/`, pas `dist/`** (build isomorphe node/browser) :
  vérifier qu'un `.ts` du core est compilé → `find dist -name X.js` (ex. `dist/node/service/dev/DevSupervisor.js`),
  pas `dist/service/...` (faux négatif). Les packages `@nodefony/*` restent en `dist/` plat.
- `[1× — 2026-06-05]` **retirer les types d'un test-runner (`@types/mocha`) expose des milliers de warnings build** :
  `@rollup/plugin-typescript` type-check TOUT le programme du `tsconfig.json` → un test laissé dans `include`
  warne (describe/it non typés TS2593, `import "mocha"` TS2882, `before` TS2304). 2024 warnings d'un coup.
  → **exclure les tests du build tsconfig** (`nodefony/tests/**`+`tests/**`+`**/*.test.ts`) ; convention déjà
  chez core/frontend/drizzle/... ; les tests ont leur `tsconfig.tests.json` (`types:["node","vitest/globals","chai"]`).
- `[1× — 2026-06-05]` **`tail -N` sur un build MASQUE les warnings** (un build « réussit » AVEC warnings) : j'ai loupé
  2024 warnings http à la migration vitest car je ne regardais que `tail -15`. → juger un build propre par **comptage
  explicite** : `grep -cE "@rollup/plugin-typescript TS[0-9]+|\(!\)"`, jamais au `tail`.
- `[1× — 2026-06-05]` **`exports.types: ./index.ts` (anti-race) est une CHAÎNE** : security(source)→user→orm-core→core.
  Convertir UN maillon en source-types fait **cascader** (ses deps doivent l'être aussi, sinon TS2307 « Cannot find
  module » sur les consommateurs amont qui compilent la source). Vérifié 2026-06-05 : fixer user a révélé user→orm-core,
  fixer orm-core a fermé (orm-core ne dépend que du core, buildé en 1er). Documenté table types `CLAUDE.md`.
- `[1× — 2026-06-05]` **commitlint `subject-case` rejette un sujet commençant par un mot MAJUSCULE** (« README … »)
  → sujet en minuscule après le type : `docs(x): readme …`. (macOS : pas de `timeout` → `gtimeout` ou background+kill.)
- `[1× — 2026-06-07]` **écrire dans un dossier d'infra PARTAGÉ (`docker/`) = `find` + Read l'existant AVANT** : le
  `docker/docker-compose.yml` était déjà l'infra dev (Redis/Kafka/Loki/Grafana/OpenSearch, par PROFILS) → un `Write`
  l'aurait écrasé, mais le tool a refusé (« file not read ») = garde-fou. → intégrer via le **pattern existant**
  (nouveau `--profile proxy`), pas un fichier compose séparé (convention-frère). Vérifier `git ls-files docker/`
  - `find docker -type f` quand on ajoute à un répertoire qu'on n'a pas créé.

## 🧭 Conception / fondation / vocabulaire (frictions du jour)

- `[1× — 2026-06-10]` **un POC qui touche un pipeline RÉVÈLE des seams imprévisibles → annoncer le scope comme PROVISOIRE.**
  Annoncé « 1 ligne framework » (`resolveByPath`) ; coder le pont WS a exposé que `callController` COUPLE exécuter+rendre
  (`returnController` auto-`send`) → fallu extraire `executeAction` (2ᵉ brique, iso-comportement, 609 tests verts). C'est LA
  valeur du POC (faire remonter le couplage exécution/rendu), mais l'estimation initiale était fausse. → pour un POC sur du
  code chaud : dire « ≥1 modif, le POC tranchera », **signaler chaque seam au fil de l'eau** (fait), regater (tests+mémoire).
- `[1× — 2026-06-08]` **convention-frère ≠ copier les défauts du frère.** Adapter User Mongoose : j'ai répliqué la structure Drizzle (`src/user/` + entité dans `src/`) alors que le module a DÉJÀ un `entity/` (sessionEntity) → incohérence `entity/` vs `src/user/`, reprise **2×** par le user. → avant de copier un frère, **vérifier qu'il est cohérent** ; trancher UNE règle (`entity/`=schéma, `src/`=repo) et l'appliquer aux DEUX modules.
- `[2× — 2026-06-08]` **emprunt de nom d'un autre framework = réflexe à tuer** (au-delà de [[feedback_nodefony_not_symfony_clone]]) : pas que « Symfony » — proposé `IPrincipal` (Spring/.NET) → rejeté pareil. → penser le **besoin/concept** d'abord, nommer en **vocabulaire Nodefony** ; ne pas plaquer un terme étranger pour « faire sérieux ».
- `[1× — 2026-06-08]` **fondation (user/sécu) = AUDIT avant code.** Le user a stoppé P5.8 pour exiger un audit (état de l'art NIST 800-63B/OWASP/WebAuthn/OAuth 2.1 + code réel + décisions datées). Révélé : décisions de mai périmées (full-stateless, MikroORM) + `IUserProvider` **jamais implémenté**. → sur une brique structurante, confronter **état de l'art + code + décisions** AVANT de coder.
- `[1× — 2026-06-08]` **« durci/complet » sans préciser le niveau = survente, challengée.** Dit ORM mongoose « durcissement complet » → 0 test E2E système (memory-server + boot hors-kernel, pas de serveur réel). → distinguer **unit / composant / E2E système** ; jamais « complet » sans le niveau atteint.

## 🧹 Refonte / consolidation (frictions du jour)

- `[1× — 2026-06-12]` **le dashboard RE-ENGRAISSE en 7 jours si les sessions appendent au § Séquencement** :
  cellule-journal 2 767 car. reconstituée entre les 2 passes vérité (06-05 → 06-12) malgré la convention en
  tête du fichier. → au END, AJOUTER le jalon en ~1 ligne avec hash et RIEN d'autre (détail = git log/retros) ;
  la passe vérité périodique reste le filet, pas l'excuse.
- `[1× — 2026-06-12]` **le bandeau Avancement décroche dès qu'on marque des lignes P sans le recompter** :
  6 phases fausses en 7 jours (P11 33 %→44 réel, P9 38→63…). → quand un END coche des lignes P, relancer
  l'awk 1ʳᵉ cellule (skill migration-audit) OU dater le bandeau comme périmé — jamais le laisser muet.
- `[1× — 2026-06-12]` **archiver les kits clos AU FIL DE L'EAU, pas au warning** : index MEMORY.md à 29,7 KB
  (limite 24,4) → 33 entrées closes archivées d'un coup. → au END, si le chantier du jour CLÔT un kit,
  déplacer sa ligne vers MEMORY_ARCHIVE.md dans la même passe (1 min) au lieu d'accumuler.

- `[1× — 2026-06-06]` **changer le TYPE d'un contrat (interface) casse les `implements`, PAS les casts** : unifier
  `ISessionStorage` (retypé) a cassé `drizzle` (`class … implements ISessionStorage`, retours `Promise<unknown>` non
  conformes) mais PAS `sequelize`/`mongoose` (pas d'`implements` → le cast `as unknown as` au register absorbe). →
  après un changement de contrat, `tsc --noEmit -p <module>` par module localise les non-conformes ; un diff **type-only**
  (aliases + types) n'impacte pas le runtime → gate mémoire reportable au 1er vrai changement runtime (réécriture cœur).
- `[2× — 2026-06-04, 2026-06-05]` **une option de config peut être un FOSSILE** : (a) consolider des « défauts »
  depuis un config.ts existant → recopie de `watch`/`devServer`/`orm:"sequelize"`/`domainCheck` morts ; (b) Lot 5 :
  le bloc `certificates.{path,privateKeyPath,certPath}` de l'app était **INERTE** (le service `certificates.ts`
  hardcode ses chemins, ignore ces options). → **grep les consommateurs CHAMP PAR CHAMP** (0 conso OU option ignorée
  par le service = mort) avant d'adopter/porter ; bonus : supprimer l'option inerte tue souvent un deref kernel
  d'un coup. Le user a flairé 2× (« reliquats legacy »).
- `[1× — 2026-06-05]` **déplacer un fichier HORS d'un dossier surveillé casse le watcher silencieusement** : Lot 5
  a sorti la config de `nodefony/config/*` (dossier watché par DevSupervisor) vers des **fichiers racine**
  (`nodefony.config.ts`/`env.ts`) → `#paths` (liste de dossiers + `index.ts`) ne les voyait plus → éditer la config
  ne redémarrait plus en dev. → **quand un déplacement sort un fichier d'un dossier auto-traité** (watch, glob, include
  tsconfig, scan), vérifier le mécanisme qui le ramassait. Fix = ajouter les fichiers à la watch-list (`71f9523`).
- `[1× — 2026-06-04]` **« on a retiré X pour la perf » est SCOPÉ à son contexte** : `extend` retiré du pipeline
  était une optim **hot-path/per-requête** (`02c32c2`), pas « extend est lent ». Pour un merge **boot-only**
  (config), `extend(true,{},…)` est parfait. Ne pas sur-généraliser une optim perf à du code non-chaud.
- `[1× — 2026-06-05]` **dégraisser un GROS fichier doc : `Write` court > N `Edit` chirurgicaux sur cellules géantes.**
  `MIGRATION_STATUS.md` (278 KB) était plombé par des cellules de tableau de ~3 800 car. (journal de commits inline).
  Matcher chaque cellule en `old_string` pour la raccourcir coûte PLUS de tokens que réécrire le fichier court d'un bloc
  → quand > ~50 % d'un fichier est à condenser, **réécriture `Write`** (git garde l'historique détaillé), pas du chirurgical.
  Localiser les lignes géantes : `awk '{print length"\t"NR}' f | sort -rn | head`. `Read` **échoue > 256 KB / 25000 tokens** → lire par tranches.
- `[1× — 2026-06-05]` **gros chantier supervisé = PERSISTER les constats au fil de l'eau** (fichier de travail), pas tout
  garder en contexte : l'audit P0→P16 a été écrit phase par phase dans `docs/migration/AUDIT-verite-2026-06.md` → survit aux
  interruptions (`/clear`, coupure) ET devient le matériau du livrable. Le user a interrompu 2× du Bash + jalonné « go »/« continue ».
- `[1× — 2026-06-08]` **suppression totale d'un package = cartographier AVANT de couper, en triant consommateurs-CODE vs mentions-DOC.**
  Sequelize OUT : 1 grep cross-repo + `.ai/symbols` ont séparé (a) ce qui casse le build (manifeste, peerDep, external rollup,
  alias vitest, stubs, branche `Error.ts`) de (b) le cosmétique (TSDoc, README, labels Studio). Couper (a) → gates → puis (b).
  Studio ne dépendait PAS du package (que des labels/logos) → suppression sûre.
- `[1× — 2026-06-08]` **balayage prose multi-fichiers = script Node `replace` exact-match > sed.** Pour purger un mot dans ~50
  fichiers (UTF-8, accents, multiline, backticks, art ASCII) : un `.mjs` `{file:[[from,to]]}` qui **rapporte les introuvables**
  est plus sûr que `sed -i` (multibyte `·`/`…`/`é` risqués) et plus économe que Read+Edit par fichier. Garder Read+Edit pour les
  tableaux/box ASCII (alignement à recompter à la main).
- `[1× — 2026-06-08]` **purge d'un legacy : nettoyer le VIVANT, préserver l'HISTORIQUE.** « Zéro résidu » s'applique aux docs qui
  décrivent l'état ACTUEL (CLAUDE/MEMORY/README/docs/guides/MIGRATION_STATUS) ; **PAS** aux ADR, session-retros, `migration/journal`,
  audits — réécrire un document daté falsifie l'historique (l'audit ORM cite Sequelize justement pour documenter sa suppression).

## 🔄 Cycle de session (END/RETEX) — méta

- `[1× — 2026-05-31]` **END trop lourd = pénible** (feedback user). Le calcul de stats (tool_use, top
  fichiers, coût €) à CHAQUE fin de session est coûteux et rarement actionné. → **END allégé** : 3-5
  bullets de frictions ici + `_state` + commit. Les **stats lourdes + graduation + archivage** sont
  déplacées dans **CONSOLIDATE** (rare, tous les 10-20 retex). Implémenté dans le skill 2026-05-31.
- `[1× — 2026-06-04]` **capter les exigences ajoutées en cours de route DANS le kit, au fil de l'eau** : sur
  une session de planif, le user a ajouté typage impeccable, hot/boot runtime, sémantique `use` APRÈS la vision
  initiale → chaque ajout intégré immédiatement au kit (piliers/décisions), pas en fin. Évite de perdre une
  exigence entre 2 messages + garde le kit comme source unique de la spec.

## 🧩 Modules / docs / front (frictions du jour)

- `[1× — 2026-06-08]` **« pattern module » = CHECKLIST COMPLÈTE, pas juste le code qui compile** : refonte mongoose
  livrée « OK » (build vert), mais j'avais zappé (a) la **config Zod** (schema/define/interfaces/validate/augment
  `NodefonyModuleConfig`), (b) les **artefacts module** `CLAUDE.md`/`README.md`/`docs/`, (c) le flag `critical`. Le user a
  dû relancer 3× (« les config on les repense », « regarde les patterns module pour rien oublier »). → avant de dire « fait »,
  **comparer à un module frère COMPLET** (drizzle/redis) artefact par artefact (config Zod + `declare module` + CLAUDE/README/docs
  - `critical` + test config + zod en dep/external rollup). Le « fait » d'un module ≠ « ça build ».
- `[1× — 2026-06-08]` **renouveau = 0 back-compat + séparer les FAMILLES de modules** : pour la config, ne pas garder
  d'alias de types legacy (« on repense », pas « on migre en douceur ») ; et bien distinguer **infra** (redis = connexions
  génériques) de **ORM** (drizzle/mongoose) — redis n'est PAS un ORM, juste une référence du _pattern_ config. Mélanger les
  familles brouille la logique (le user : « redis est à part, il n'a pas lieu d'être un ORM »).
- `[1× — 2026-06-06]` **BUREAU ≠ GRILLE** : un « bureau » composable = fenêtres LIBRES (px/fraction,
  chevauchement, z-order) + « Ranger » à la demande — PAS une grille à colonnes figées NI un tiling/reflow
  (les deux rejetés par le user). Demander le PARADIGME (stacking OS vs tiling) avant de coder un « canvas ».
- `[1× — 2026-06-06]` **« tout figé » après refonte d'un store MobX = le SINGLETON survit au HMR** → l'ancienne
  instance n'a pas les nouvelles méthodes/modèle (tuiles à 0,0). **Hard-reload obligatoire** + bumper la clé
  localStorage (`…v2`). Réflexe : changement de modèle de store → annoncer « hard-reload ».
- `[1× — 2026-06-06]` **drag perf = `setPointerCapture` + transform/DOM direct + rAF, commit au `pointerup`**
  (0 écriture store / 0 render par frame). Piège : l'ancien resize appelait `setSize`→`persist` localStorage À
  CHAQUE frame. + `overflow-x:auto` force `overflow-y:auto` (rogne le haut → bordure pas `outline`) ; Mantine v9
  `Collapse` = prop `expanded` (pas `in`).
- `[2× — 2026-06-06]` **FORAGE / CONTENU EXACT, jamais improvisé** : un schéma (pipeline HTTP) inventé = FAUX
  (commit corrigé) → lire la source de vérité du module (`MEMORY.md`/code) AVANT de poser les briques. Gravé skill studio-dev.
- `[1× — 2026-06-06]` **react-grid-layout est INCOMPATIBLE React 19** (il utilise `ReactDOM.findDOMNode`,
  **supprimé** en React 19) → pour une grille dashboard draggable/resizable NE PAS le proposer. Maison 0-dep :
  **CSS grid `auto-flow: dense`** (span colonnes × rangées = tuilage sans trou) + **resize au coin** par pointer
  events (delta px → unités via le `getBoundingClientRect` de la carte) + drag HTML5 `setDragImage(card)` (fantôme
  = la carte). React-19-safe, contrôlé. (gridstack = alternative vanilla mais intégration React fiddly.)
- `[1× — 2026-06-06]` **un canal realtime peut pousser des frames COALESCÉES, pas l'objet nu** : `syslog:stream`
  émet `{ logs:[...], dropped }` (coalescing serveur), PAS un Pdu → un widget qui rend `source.data` comme un Pdu
  affiche l'enveloppe (« ça ressemble à rien », vu par le user). → avant de rendre un flux, **vérifier la FORME
  exacte de la frame** (lire le producteur ou un consommateur existant) et **réutiliser les vraies briques** au
  lieu de deviner les champs : ici `toRecord`/`recordMessage`/`ansiToReact`/`SeverityBadge` de `routes/logs/`
  (convention-frère) → même rendu que la page Logs du 1er coup. Les champs Pdu devinés passaient le typecheck mais le rendu était faux.
- `[1× — 2026-06-06]` **valider l'esbuild des nouveaux fichiers front AVANT de faire recharger le user** : `tsc`
  attrape les types, pas tout ; `curl -sk https://127.0.0.1:<viteStudio>/@fs/<abs>.tsx` (port Vite Studio = 5173 ici,
  ≠ 5177 = autre bundle) → 200 + 0 « Transform failed » si le module compile. Boucler sur les N fichiers touchés →
  0 page blanche au hard-reload. (cf skill `nodefony-frontend-verify`.)
- `[1× — 2026-06-06]` **sticky qui « défile quand même » = un `marginTop` négatif** sort l'élément de sa zone
  sticky (quand le scroll-ancestor a `paddingTop:0`). Copier la recette du frère qui marche (`PageHeader sticky` :
  `top:0` + plein-bleed `marginInline` SEUL). Deux sticky `top:0` frères se chevauchent → **un seul en-tête sticky
  unifié** (wrapper parent). + lever l'ambiguïté de vocabulaire (« topbar » = PageHeader, pas le bandeau).
- `[1× — 2026-06-06]` **z-index d'enfants qui « passe par-dessus » un voisin = stacking context manquant** : des
  fenêtres `position:absolute; zIndex:N` (N croissant) remontent au-dessus d'un bandeau frère → **`isolation:isolate`**
  sur LEUR conteneur confine les z (fix sans toucher chaque z). Réflexe pour tout canvas à z-order.
- `[1× — 2026-06-06]` **`Menu` Mantine rend le focus à son trigger à la fermeture** → un input `autoFocus` ouvert
  depuis un `Menu.Item` blur aussitôt → `onBlur` commit avant la frappe (« le renommage marche en double-clic, pas
  dans le menu »). Fix = **`returnFocus={false}`** sur le Menu. + `userSelect:none` (double-clic = action, pas sélection).
- `[1× — 2026-06-06]` **aperçu live d'un bloc dans un autre contenant = réutiliser le registre de blocs unifié**
  (`useBlockSource`+`BlockBody`) monté dans un dropdown **lazy** (HoverCard) → 1 abonnement/fois ref-compté, 0 coût
  hors survol. Ne PAS réécrire un mini-rendu. (catalogue Studio : aperçu au survol = le VRAI widget.)
- `[1× — 2026-06-06]` **classer des blocs = tags SAISIS (domaine hiérarchique + nature) + capacités DÉRIVÉES** du
  code (cluster-ready ← `clusterAware`, temps réel ← `source.kind`) — jamais saisir une capacité (= dérive garantie,
  le piège « liste dupliquée »). **Template fidèle d'un bureau libre** = `WorkspacePreset.layout?` (positions exactes
  exportées du `localStorage["nf.workspace.layouts.v2"]` que le user copie en console), bypass du pavage auto.

- `[1× — 2026-06-01]` **Studio = Mantine v9, PAS v8** (le skill `studio-dev` dit v8 → FAUX, à
  corriger) : `Collapse` prop = **`expanded`** (pas `in`) ; `DataGrid.filterOptions` = `string[]`
  (pas `{value,label}[]`), `align ∈ {left,right}` (pas `center`). Gate = `npm run typecheck` les
  attrape (le transform Vite esbuild non). Au moindre doute API Mantine → typecheck avant de livrer.
- `[1× — 2026-06-01]` **« pas de clickodrome » = directive ergonomie forte** : ne pas tout afficher
  d'un coup ; découper une vue dense en **tuiles d'axe** (1 détail à la fois, défaut sur l'important),
  **onglets 1er niveau** (jamais imbriqués), **Collapse**, **pophover** (`JsonPeek`/`DocHint`) ;
  factuel d'abord, pédago en onglet Doc ; **persister l'état** au retour (onglet+filtres). Gradué →
  [[feedback_studio_ergonomie_progressive]] ; à centraliser dans le skill `studio-dev` (reporté).
- `[1× — 2026-06-01]` **terme tech opaque → libellé explicite FR + tech en second** : « relu » seul
  incompris → « **Source consultée** · relecture ». Le user bute sur le jargon nu (cf [[feedback_terminology_forage]]).
- `[1× — 2026-06-01]` **binaire WS : `Buffer.isBuffer` ne suffit pas** — `ws.send` accepte aussi
  ArrayBuffer/TypedArray/DataView/Buffer[]/Blob → un `Uint8Array` partait en `JSON.stringify`
  (objet indexé géant). `binaryByteLength` couvre tout (piège **byteLength ≠ length**). Vérifié
  contre la doc `ws` AVANT de coder (le user a flairé le bug : « le buffer c'est bon ?? »).
- `[1× — 2026-06-01]` **routes/logs/ est gitignoré (pattern `logs`)** → NOUVEAU fichier (`wsTrace.tsx`)
  = `git add -f` ; les fichiers déjà trackés du dossier s'`add` aussi avec `-f` quand git refuse.
  Et **header de commit ≤ 100 car** (commitlint header-max-length) : un sujet riche dépasse vite.
- `[1× — 2026-06-02]` **purge de dep « morte » : le grep `from "x"` ment** — il rate (a) les imports
  **side-effect** (`import "reflect-metadata"`), (b) l'usage **hors `src/`** (`scripts/`, `rollup.config.ts`),
  (c) les usages indirects (Tools/Pdu). Vécu : reflect-metadata/lodash/terser faux-classés morts par l'audit
  auto. → AVANT de virer une dep : re-vérif ciblée `import "x"` + `scripts/` + `rollup.config` ; ne supprimer
  que les **vraiment 0-import partout**. (clui/node-emoji/rxjs/shelljs/pug/@babel/plugin-replace = OK, 57 pkgs purgés.)
- `[1× — 2026-06-02]` **header/banner CLI sort via `console.log`, PAS le sink syslog** → `Syslog.setSinkEnabled`
  ne le mute pas ; et un afficheur branché à `onStart`/hook tardif arrive **après** les logs DEBUG (`-d`) →
  « pas dans l'ordre ». Pour un ordre stable tous modes : imprimer le header **au plus tôt** (Kernel devSplash,
  juste sous l'ASCII), pas via le composant qui fire plus tard. Flag `reporterOwnsHeader` pour éviter le doublon.
- `[1× — 2026-06-02]` **itération UX TTY = ne JAMAIS killer le serveur du user** : il teste l'animation dans
  son terminal (animation invisible côté agent, non-TTY) ; `start.sh` pkill `nodefony development` → tuerait sa
  session. → build seul + « relance pour voir » ; jamais de boot agent pendant qu'il a un TTY live.
- `[1× — 2026-06-02]` **audit sync : la MIGRATION peut être juste, la MÉMOIRE en retard** — `dev_boot_spinner_ux`
  disait « PROCHAINE » alors que livré ; `pm2_deprecation` disait « Phase 16 » alors que retiré C6 (MIGRATION
  l.117 correcte). → réflexe END : MAJ la **mémoire de la feature livrée** (desc + corps), pas seulement le `_state`.

- `[2× — 2026-05-31, 2026-06-05]` **commitlint refuse un sujet en Majuscule** (`docs(retro): CONSOLIDATE …`
  ET `docs(config): Lot 7 …` rejetés, règle subject-case : le 1er mot du SUJET après `type(scope):` doit être
  minuscule, peu importe le scope). → header de commit **en minuscule** ; corps avec apostrophes/accents OK via
  `git ci -F` (cf [[feedback_commit_fr_apostrophes]]). **≈3× → candidat graduation.**
- `[1× — 2026-05-31]` **`{{ }}` dans les `docs/*.md` d'un module sont résolus par `@nodefony/documentation`
  lui-même** (le module se scanne → effet miroir) : documenter la feature `{{ }}` mange ses propres
  exemples. → neutraliser les exemples : `{{ maVar }}` (provider inconnu = laissé littéral) ou `{{ … }}`
  (hors charset `[\w.-]` = non matché par le résolveur).
- `[1× — 2026-05-31]` **« Session front » ≠ forcément du dev** : quand le composant cible déjà les bonnes
  routes ET que les shapes back↔front sont compatibles (champs optionnels en trop/absents = dégradation
  propre), la session se réduit à un **diff de shapes + curl runtime, 0 edit**. Ne pas présumer qu'il faut
  coder ni invoquer `nodefony-studio-dev`. Reste = confirmation visuelle user (hard-reload, pas de headless).
- `[2× — 2026-05-31, 2026-06-01]` **un test ne doit JAMAIS laisser de résidu** : `upload.test.ts` ET
  `memory.test.ts` (« 200 multipart uploads ») accumulent des `<uuid>.txt` dans le dossier d'upload / `./tmp`,
  jamais nettoyés (1200 fichiers constatés le 06-01 — le skill `check-memory-health` relance → accumulation,
  user agacé). Le service persiste les fichiers reçus, le test ne les supprime pas. → `before` snapshot du
  dossier + `after` qui supprime **uniquement le diff** (fichiers créés), sans toucher au préexistant ; net-0.
  ⚠️ `memory.test` PAS encore corrigé (TODO `project_session_2026-06-01_state`). À 3× → graduer en `feedback_*`.
- `[1× — 2026-05-31]` **couleurs ANSI bakées dans le payload de log → fichier JSON pollué** : `clc.xxx("EVENT
KERNEL/CONTEXT")` colore à la SOURCE (constantes module, multi-modules) ; `cli-color/bare` colore AUSSI
  (vérifié — pas d'interrupteur global). Stripper l'ANSI **par log** dans le transport = coût hot path (refusé
  user, à juste titre). Le fix propre = **décision boot-time** (gate couleur résolu 1× selon isTTY/non-fichier),
  PAS un `.replace()` au runtime. TODO ciblé. → un défaut « cosmétique » peut cacher un vrai sujet perf.
- `[1× — 2026-05-31]` **config « source unique » pour un chemin partagé** : le dir de logs était hardcodé
  `logs/` (Kernel) côté écriture mais le viewer Studio lisait `tmpDir` → la tab Fichiers ne montrait jamais les
  vrais logs. → un chemin utilisé par N composants = **UNE** config (`config.log.dir`), lue partout. Vaut pour
  tout couple write↔read (cf le pattern write↔read cohérent du Log Backplane).
- `[2× — 2026-06-01]` **hardcode `if(name===…)` dans le Kernel rejeté par le user** (LB.4) : choisir une impl
  par son nom EN DUR dans le Kernel (`if queryDriver==="loki" …`) = anti-pattern. Bonne réponse = **registre de
  FABRIQUES** (`name → factory(ctx)→{driver,transport?}`, builtins s'auto-enregistrent, Kernel résout+branche,
  boucle `listLogDriverFactories()` en dev). Convention-frère de `backplaneRegistry`/`ormRegistry`. Le user
  traque ce pattern (réagi 2×) → l'appliquer d'EMBLÉE pour tout « choisir une impl par nom ».
- `[1× — 2026-06-01]` **Log Backplane = 2 axes orthogonaux, l'UI DOIT les séparer** (le user a buté dessus) :
  le **select** Studio change la **LECTURE** (un seul « fond de panier » qu'on RELIT/cherche) — PAS l'écriture.
  L'écriture est un **fan-out** (1 log → console+fichier+Loki+OpenSearch en même temps). → toute UI de backplane
  doit montrer **ÉCRITURE = cases à cocher (multi)** ≠ **LECTURE = select (un seul)** explicitement. Vulgariser :
  « déposer une copie dans N boîtes aux lettres » (écrire) vs « ouvrir UN classeur pour fouiller » (lire). TODO page Logs.
- `[1× — 2026-06-01]` **image Docker distroless = AUCUN healthcheck interne** (`grafana/loki:3.7.2` n'a ni
  `/bin/sh` ni `wget`/`curl`) : un `healthcheck: CMD-SHELL` échoue à vie → conteneur « unhealthy » à tort →
  un `depends_on: condition: service_healthy` (Grafana) reste **bloqué en « Created »** (jamais démarré). →
  PAS de healthcheck sur un distroless (sonder côté HÔTE `curl :port/ready`), et `depends_on: service_started`.
- `[1× — 2026-06-01]` **memory.test FLAKE sous charge + « requires server »** : (a) la suite « (requires server) »
  a 3 fails au hook `before all` car j'avais STOPPÉ le serveur dev → ces suites se CONNECTENT au serveur externe
  (1ʳᵉ hypothèse = serveur down, [[nodefony-debug]]) ; (b) sous charge machine (JVM OpenSearch + Grafana + 4 Vite),
  un test DIFFÉRENT déborde de peu à chaque run (29.6→19.4→18.3 MB), tous les tests cœur verts = **bruit GC, pas un
  leak**. → isolation = vérité : tester la **config par défaut** (sans transports opt-in) ⇒ 500-mixed < 20MB ⇒ pipeline propre.

## 🧭 État projet / git / terminologie (frictions du jour)

- `[1× — 2026-06-06]` **une règle CLAUDE.md figée ANTÉRIEURE à une archi décidée récemment ne doit pas BLOQUER** :
  j'ai posé un `AskUserQuestion` sur le foyer de `RedisSessionStorage` parce que le CLAUDE.md redis disait « redis
  neutre, storage ailleurs » — alors que le **plan session du jour** (kit) primait. Le user a recadré (« le claude.md
  de redis est fait avant notre nouvelle archi, le plan session prime »). → décision archi récente (kit/plan en cours)
  prime sur une règle figée de module : **trancher + MAJ la règle obsolète**, ne pas se bloquer
  ([[feedback_permission_autonomy]] : AskUserQuestion réservé au non-déductible ; ici c'était déductible du plan).
- `[1× — 2026-06-04]` **« chantier CLOS » en mémoire ≠ fini pour le user** : le chantier config app était marqué
  CLOS (5 lots, `…5df006c`) ; le user : « le chantier config on a rien fait, juste la première étape ». Il le
  voyait comme l'**étape 1** d'un chantier DX bien plus large (`defineConfig`). → quand le user rouvre un sujet
  « clos », ne PAS opposer le statut mémoire : faire l'état des lieux factuel + **clarifier le PÉRIMÈTRE** qu'il a
  en tête. Variante de « vérité = réalité, pas le journal ».
- `[1× — 2026-06-04]` **user dit « c'est le foutoir » → ÉTAT DES LIEUX factuel AVANT toute proposition** : arbre du
  répertoire + rôle de chaque fichier + sources de confusion classées, PUIS la cible. A débloqué la session (vision
  validée juste après). Ne pas sauter directement à la solution.
- `[1× — 2026-05-31]` **commits locaux non pushés = user perdu** : 19 commits sur `claude-ts` jamais
  poussés (« où est la partie git, j'ai pas compris »). Je committe en local mais ne `push` que sur demande
  → l'écart local↔remote n'est pas visible. → **annoncer proactivement l'état push en clôture** (`git status -sb`
  = `ahead N`) et proposer le push. Le repo mémoire IA, lui, est poussé à chaque END (backup).
- `[1× — 2026-05-31]` **deux « backplanes » homonymes prêtent à confusion** : **Realtime Backplane**
  (P13.x, `IBackplane` Redis/IPC — `P13.5 RedisBackplane` ✅ FAIT) vs **Log Backplane** (P3.11, `ILogDriver` —
  `LB.5` agrégation cluster ⬜ PAS FAIT). Même « .5 », même mot « cluster » → le user a cru LB.5 fait en voyant
  P13.5. → **toujours désambiguïser explicitement** « backplane realtime » vs « backplane logs » (et le n° de
  sous-tâche) dès qu'on parle cluster/backplane. Capté dans [[project_log_backplane_vision]].
- `[2× — 2026-05-31]` **vérifier le CODE avant d'annoncer « il reste X »** : au RESUME j'ai listé « reste LB.3c
  (page Studio) » d'après le `_state`/ma mémoire — mais LB.3c était DÉJÀ commité (`3d6158e`/`c48858b`). Le user
  a relancé dessus → temps perdu. → avant toute liste de « reste à faire », `git log`/grep le code (garde-fou
  RESUME = la vérité = les commits, pas le journal). Idem « échec pré-existant » sans vérif [[feedback_spa_fallback_literal]].
- `[1× — 2026-05-31]` **pre-push `npm run typecheck` global casse sur dist/types croisé périmé** : TS2307
  `@nodefony/user → @nodefony/orm-core` (modules NON touchés par mon diff) → push refusé. → avant un push qui
  déclenche le typecheck turbo, `npm run build` (régénère tous les `dist/types`) si on a buildé des modules à la
  main. Variante stale-dist [[feedback_root_dist_stale_modules]]/[[feedback_turbo_cache_stale_logs]].
- `[1× — 2026-06-05]` **hiérarchie de fraîcheur : Code > Mémoire IA > MD modules > `MIGRATION_STATUS.md`.** Le dashboard,
  tenu à la main en fin de session, est STRUCTURELLEMENT le plus en retard (audit : `DETTE-CFG` marquée 🚧 alors que résolue
  dans le code ; vision ORM pré-virage ; refs mortes PM2/mikroorm ; daté de 6 j). → au RESUME le dashboard ment plus que la
  mémoire ; **confronter au code** (garde-fou « vérité = commits »). Le tenir EN CONTINU (cellule courte + détail ailleurs)
  sinon refonte coûteuse imposée (278→32 KB en une passe). Variante de « vérité = réalité, pas le journal ».

- `[1× — 2026-06-08]` **merger les `refactor/*` dans `claude-ts` AU FIL des chantiers, pas en lot tardif** : `refactor/session-runtime` avait accumulé **33 commits / 5 chantiers** (session runtime + forwarded/proxy + certificats + statics/CDN + audit ORM) avant merge. Le user : « ce merge aurait dû être avant ». Ici sans douleur (FF, 0 divergence) mais le risque de conflit croît avec la divergence. → proposer le merge dès qu'un chantier est CLOS+poussé, ne pas laisser une branche de travail diverger sur plusieurs sujets. Variante de [[feedback_commit_fr_apostrophes]]/commits-non-pushés.
- `[1× — 2026-06-08]` **demande de merge + « ATTENTION aux branches !!! » → l'ÉTAT DES LIEUX git EST la réponse, pas l'exécution** : `fetch` + `merge-base` + `--is-ancestor` (FF ?) + divergence (`A..B` des deux côtés) + cible (`claude-ts` **≠** `main`) AVANT de proposer. Montrer « FF, 0 conflit, 0 divergence, main intouché » rassure l'expert anxieux mieux qu'un merge immédiat. `--no-ff` pour garder un repère d'intégration annulable d'un bloc.
- `[1× — 2026-06-08]` **gros chantier de refonte → AUDIT exhaustif AVANT (pas juste relire le kit)** : avant le virage ORM, balayer code+mémoires+docs+**Studio**+**sondes realtime**+**externe** a débusqué des pièges invisibles depuis le kit : **2 `Orm` homonymes** (legacy core ≠ `@nodefony/orm-core` à garder → risque de supprimer la mauvaise cible) + **dette C5** (montage data plane ORM déclenché par Drizzle → app Mongoose-only muette). Le user a élargi le scope 2× (« tu as regardé Studio ? les sondes realtime aussi »). → pour une refonte, cartographier la **surface COMPLÈTE** (front + observabilité incluses) dès le départ ; le doc d'audit devient la boussole d'exécution.

## 🔎 Vérification / preuve runtime (frictions du jour)

- `[1× — 2026-06-08]` **gate mémoire sans GC forcé = on mesure le GARBAGE, pas une fuite** :
  `ws-messages-load sustained` affichait ~180 MB / 5000 frames WS → transitoire non collecté (sonde
  `/memory` lisait `heapUsed` sans `global.gc()`, serveur sans `--expose-gc`). GC forcé → < 30 MB. Règle :
  **toute sonde/gate mémoire force le GC avant `heapUsed`**. Et **prouver « pré-existant » par ISOLATION**
  (test sans import ORM + repro serveur frais), jamais par citation de doc (le user s'en méfie à raison).
- `[1× — 2026-06-07]` **prouver un parse côté serveur SANS toucher au banc = curl loopback (trusted) avec le header brut** :
  pour valider le parse `Forwarded` RFC 7239 en runtime, `curl -H "Forwarded: for=…;proto=https" localhost:5151` +
  lire le **log `req`** (`GET 200 <scheme>://<host>/… <ms> <IP>`) → le scheme/IP résolus sont visibles directement.
  Plus rapide et discriminant que monter tout le banc Docker (ex. `Forwarded proto=https` + `X-Forwarded-Proto http`
  → si le log montre `https`, la priorité Forwarded est prouvée).
- `[1× — 2026-06-07]` **bind-mount macOS : `docker exec <c> nginx -t` JUSTE après un Edit lit une version en cours
  d'écriture** (« unexpected end of file ») alors que le fichier disque est valide. Revalider sur le DISQUE
  (`docker run --rm -v fichier nginx -t`) puis **recréer le conteneur** (`up -d --force-recreate <svc>`) pour qu'il
  relise. Et `000` sur TOUS les ports du banc = souvent **le démon Docker tombé** (`docker ps` → « Cannot connect »),
  PAS un bug du code — vérifier le daemon avant de suspecter le diff.
- `[2× — 2026-06-04]` **`memory.test` exige un serveur LANCÉ (connecte `localhost:5152`) → ECONNREFUSED
  sinon, PAS une fuite.** Le 1ᵉʳ run de la session passait via un serveur résiduel ; sans serveur →
  `internalConnectMultiple` (ECONNREFUSED) dans le `before all`. **Toujours `start.sh` AVANT** le memory
  test. ET **NE PAS l'enchaîner avec le filet CLI** (`RUN_CLI_BOOT=1` spawn `production`/`cluster` sur
  5151/5152 → conflit de ports avec le serveur du memory test). Séquencer : (filet CLI seul) PUIS (start.sh
  - memory test). Diagnostic « before all hook » KO = serveur down/port pris, jamais le heap. **Revu
    2026-06-04** : j'ai STOPPÉ le serveur dev « pour éviter un conflit de ports » AVANT le memory test →
    3 fails `before all` (les tests TAPENT le serveur dev, ils ne le spinnent pas). Réflexe inverse =
    serveur UP requis. → proche d'une graduation (3ᵉ vue = `feedback_*`).
- `[1× — 2026-06-04]` **`memory.test` 1000-GET marginal dans la suite, vert en isolation** : 36.4 MB vs
  seuil 35 quand lancé APRÈS les autres cas (crashes/uploads/WS) ; relancé seul → vert 2/2. Contamination
  GC/ordre, pas une vraie fuite. Confirme le pattern `nodefony-debug` « memory flake = isolation = vérité » :
  un seuil marginal dans la suite complète → re-run isolé AVANT de qualifier de régression (surtout si le
  diff est boot-only, donc 0 impact per-requête).
- `[1× — 2026-06-02]` **`tsx` transpile-only laisse PASSER un test qui lit un field supprimé** : après avoir
  retiré le field `type`, un test `assert.strictEqual(k.type, "CONSOLE")` lit `undefined` → devrait échouer,
  mais affichait « 0 failing » à un instant (transpile-only ignore le TS2339). → après un rename/suppression
  de field, **grep les refs au field dans les tests** et migrer manuellement (le build les flag, le runner non).
- `[1× — 2026-06-05]` **un écart « déclaré vs réel » fondé sur une métrique de SURFACE (présence de fichiers) peut être une
  FAUSSE alerte** : à l'audit migration j'ai classé « P15 = 0 % CONTREDIT par `src/modules/mediasoup` (8 src + dist) » 🔴 →
  le `package.json` disait `description: "banc test ORM"` (≠ implé télécom P15). → avant d'affirmer un écart, **sonder le
  CONTENU** (description, fichiers réels, ce que ça FAIT), pas juste l'existence. L'audit exhaustif corrige ses propres
  hypothèses de surface — d'où sa valeur (≠ audit de surface qui les fige).

- `[1× — 2026-06-01]` **`grep $'\x1b'` ne trouve RIEN dans un `.jsonl`** : `JSON.stringify` encode
  l'octet ESC (0x1b) en **texte ``** (6 chars), pas l'octet brut → chercher l'ANSI baké dans un
  log JSON = `grep 'u001b'` (ou `\\u001b`), JAMAIS le byte ESC. Vécu : conclu à tort « 0 ANSI » sur la
  preuve de la gate couleur avant de corriger le grep.
- `[1× — 2026-06-01]` **DevSupervisor casse la baseline before/after par mtime** : en dev, chaque save
  `.ts` → rebuild+restart auto → les fichiers « anciens » (par date de fichier, ex. `logs/*.jsonl`,
  `dist/`) sont en fait DÉJÀ le nouveau code. Comparer ancien↔nouveau par mtime ment. → pour une vraie
  preuve avant/après : `git stash` + rebuild (cher) OU **raisonner sur le mécanisme** (ici : `clc.x.y`
  produit de l'ANSI même en pipe → si c'était l'ancien code, le payload serait coloré ; il est brut →
  c'est le nouveau). Idem memory-test flake sous charge cumulée (720 intég PUIS memory même serveur =
  échec rotatif) → isolation + serveur frais = vérité (déjà gradué, cf skill `nodefony-debug`).
- `[1× — 2026-06-01]` **tester un agrégateur cluster = asserter `total == unique`, PAS « je vois mes N
  workers »** : mon « test ultime » du driver `cluster-file` comptait les `pid` distincts dans une relecture
  (agrégation OK) → a RATÉ un doublon de lignes (ratio 2.0, chaque log écrit 2×). Compter les pids uniques
  MASQUE mécaniquement un doublon. Pour un agrégateur/merge, vérifier l'INTÉGRITÉ (unicité), pas la couverture.
- `[1× — 2026-06-01]` **instrumenter (stderr + rebuild) tranche là où la lecture de code spécule** : la
  mémoire `project_cli_module_command_dispatch` disait kernel #1 « orphelin jamais booté » → l'instrumentation
  a PROUVÉ qu'il boote COMPLÈTEMENT en development (4 `initializeLog`/worker = 2 boots dev+prod). Une note
  mémoire écrite depuis une lecture partielle ment ; re-prouver empiriquement AVANT le fix (renforce ci-dessous).
- `[1× — 2026-06-01]` **⚠️ CORRECTION d'une note RETEX précédente = la cause supposée était FAUSSE** : la
  session passée avait noté ici « doublon JSONL = `setActiveLogDriver` ré-attache le tap sans removeListener
  (après des switchs) » → cette hypothèse a migré dans le `_state` comme prochaine tâche. **La vraie cause
  (trouvée en lisant le code + repro live `1335 l/669 uid`) : `initializeLog()` est appelé 2× au boot**
  (logger précoce dans `start()` + re-init post-config dans `loadApp()`) et re-monte un 2ᵉ `FileTransport`
  sans retirer le 1er ; `addTransport` dédup par RÉFÉRENCE → 2 instances distinctes passent. **Rien à voir
  avec un switch** — le doublon naît dès le boot, 0 switch. Fix `Kernel._mountedLogTransports` idempotent
  (`6814c05`). → **Leçon méta : une note RETEX/\_state écrite depuis une HYPOTHÈSE non vérifiée ment ; au
  RESUME, re-prouver la cause (code + empirique) AVANT de coder, ne pas copier le diagnostic du `_state`.**
- `[1× — 2026-06-01]` **un filet de boot doit prouver l'INTÉGRITÉ, pas juste « ça écoute »** : mon filet CLI
  attendait `Server Listen` → vert MÊME avec un module en fail-soft (`Cannot find package @nodefony/test`) →
  serveur up mais module absent → routes 404. **Le user l'a vu, pas moi** (« tu n'as pas regardé dans tous les
  coins »). Même famille que « agrégateur = total==unique » ci-dessus : vérifier l'INTÉGRITÉ, pas la couverture.
  → asserter que les modules CHARGENT (`MODULE ADD: X` + une route du module → 200), pas seulement le listen.
  Filet durci (`b05e381`).
- `[1× — 2026-06-02]` **tester `BootReporter`/le boot dev sans TTY = lancer le DevSupervisor, PAS `start.sh`** :
  `BootReporter` n'est instancié QUE par `DevCommand` côté enfant supervisé (`NODEFONY_DEV_CHILD=1`) → `start.sh`
  (boot direct, sans DevSupervisor) ne le déclenche pas. Pour le valider j'ai lancé `npx nodefony development`
  detached non-TTY → mode statique (`#animated=false`) : pas de spinner mais l'ORDRE est prouvé (phases →
  bannières → `✓ Frontend (Vite)` → `✓ Prêt`). Le rendu ANIMÉ (TTY) reste à valider par le user (pas testable
  hors terminal interactif).
- `[1× — 2026-06-02]` **`npm exec nodefony development` AVALE le SIGINT → orphelins Vite** : un `kill -INT` sur le
  PID du wrapper `npm exec …` ne propage PAS au DevSupervisor → enfant + instances Vite survivent (ports 5151/5152/
  5173/5177 squattés). En Ctrl+C TTY réel le group-kill marche (le DevSupervisor est leader de groupe). Pour un
  arrêt fiable d'un lancement background : `pkill -INT -f NODEFONY_DEV_CHILD` + `pkill -f nodefony-vite` +
  `lsof -ti:5151,5152,5173,5177 | xargs kill -9`. NE PAS compter sur le SIGINT au wrapper npm.

## 🧱 Core / pipeline / perf (frictions du jour)

- `[1× — 2026-06-11]` **🚨 un RPS ABSOLU ne se compare JAMAIS entre deux fenêtres temporelles — toujours rebencher la baseline DANS la fenêtre courante**
  avant de crier à la régression : le user a vu « j'étais à 7000, là 3674 » (−45 %). C'était la **charge ambiante** (Brave
  renderer 45 % + GPU 36 % + claude 67 % ≈ 2 cœurs mangés), PAS le code. Preuve : `git checkout <ref pré-changement>` +
  rebuild 4 workspaces + rebench **dans la même fenêtre** → pré-V5 5385 vs branche 5368 = **0,3 % d'écart** (bruit pur). Les
  `.med` dans `/tmp/nf-bench-*.med` gardent l'historique d'hier (6673-7078) MAIS ils datent d'une autre fenêtre → inutilisables
  comme référence aujourd'hui. Seules les **paires alternées intra-fenêtre** comptent (méthode déjà gravée, à appliquer AUSSI
  pour réfuter une fausse régression, pas seulement pour prouver un gain). Cf [[reference_perf_profiling_method]].
- `[1× — 2026-06-11]` **`typeOf(Buffer)` = `"buffer"`, PAS `"object"`** (Tools.ts teste `_gBuffer.isBuffer` AVANT `isArray`/object) :
  un `return Buffer` d'une action tombait dans le `default` du `Resolver.returnController` → AUCUN envoi → requête pendue
  jusqu'au timeout 408. Tout `switch(typeOf(x))` qui veut traiter un Buffer a besoin d'un `case "buffer"` DÉDIÉ. Même piège
  latent pour Date/RegExp/Error (typeOf leur donne un tag propre).
- `[1× — 2026-06-11]` **DI Container : si un Scope ADOPTE le prototype de services du parent (perf), `Scope.set`/`remove` DOIVENT être overridés own-property-only**
  — sinon l'écriture prototype de `Container.set` (`protoService.prototype[name]=…`) touche le proto **PARTAGÉ** du parent → un
  service per-request (controller, context) devient visible de TOUTES les requêtes concurrentes = data race silencieuse. Gravé
  MEMORY.md core + 4 tests garde-fous. L'optim (1 `Object.create` au lieu de 2 + seq id au lieu d'uuid + Map scopes lazy) a
  donné +6 % RPS A/B mais ne tient QUE si l'isolation own-only est préservée.
- `[1× — 2026-06-11]` **aplatir un `new Promise(async executor)` RÉVÈLE des bugs cachés** (pas qu'un refacto cosmétique) : le
  `return super.send()` placé DANS l'executor d'`Http2Response.send` ne résolvait JAMAIS la promesse externe (hang à vie quand
  `this.stream` absent) ; un `throw e` après `reject(e)` dans un executor est silencieusement avalé. Le motif `new Promise(async)`
  avale aussi tout throw de l'executor (rejet muet/pendu selon le timing). → traquer ces sites au durcissement, pas juste cosmétique.
- `[2× — 2026-06-11]` **A/B : écarter une paire ABERRANTE et la REFAIRE (jamais conclure dessus)** : V4, paire 2
  singleton 5317 RPS vs 6495/6887 sur la MÊME URL (+30 % d'écart interne) = pollution machine ponctuelle ; la paire 3
  inversée (singleton d'abord) a redonné +5,0 %. Verdict honnête publié : « dans le bruit » — ne JAMAIS revendiquer un
  gain sur des paires incohérentes entre elles. Complète la leçon warmup ci-dessous.
- `[1× — 2026-06-10]` **A/B sans toggle env = bascule git + rebuild ciblé ; JETER la 1ʳᵉ paire si machine froide** :
  pour un refacto NON toggleable (Resolver POJO), `git checkout <ref> -- src/…/framework` + rebuild workspace (~3 s)
  entre les runs marche très bien avec `bench-ab-mono.sh`. MAIS paire 1 polluée (warmup machine : new1 6527 < old2 6619
  inter-paire, run aberrant 5131) → il a fallu 3 paires. La SEULE comparaison fiable = intra-paire alternée (3/3
  positives +4,5/+8,4/+6,1 %) ; prévoir d'office 3 paires ou sacrifier la 1ʳᵉ en warmup.
- `[1× — 2026-06-10]` **décorateurs TS = bottom-up AUSSI pour l'ordre d'insertion des metadata accumulées** : 2×
  `@Header` empilés → celui le plus PROCHE de la méthode s'exécute en premier → `headerEntries` dans l'ordre INVERSE
  de la lecture visuelle. Frappé dans une assertion de test (deep.equal sur l'ordre). Comportement runtime inchangé
  (même objet que l'ancien `Object.entries`), mais toute assertion d'ordre doit suivre le bottom-up.
- `[1× — 2026-06-10]` **toggle de bench A/B = const MODULE-LEVEL, jamais `process.env` dans le hot path** :
  un `process.env.NF_BENCH_X` lu par event (~100-200 ns, accès C++) pénalise le run « new » censé être un
  return sec → gain sous-estimé. → `const BENCH_X = process.env.NF_BENCH_X === "1"` au chargement (coût
  identique aux 2 runs), et le run « old » simulé doit reproduire la SÉVÉRITÉ exacte d'avant (DEBUG en prod,
  pas la promotion INFO) sinon le old est artificiellement plus cher. Bloc TEMP retiré avant commit (0 résidu
  `NF_BENCH` dans src/ = convention vérifiée).
- `[1× — 2026-06-10]` **code de close WS au handshake : viser le code WS DIRECTEMENT, pas un statut HTTP** :
  `error-renderer.renderWebsocket` a 2 branches selon `context.rejected` ; au handshake (`rejected===false`) il
  **clampe tout code `<1000` → 1011** → un `HttpError(403)` ne devient PAS 1008. Pour fermer en **1008** (Policy
  Violation, anti-CSWSH), lever `new HttpError(msg, 1008, ctx)` (code WS 1000-4999 laissé passer tel quel). Tracé en
  lisant `renderWebsocket` AVANT de coder → close 1008 du 1ᵉʳ coup. + Pré-check Content-Length AVANT le streaming =
  rideau cheap (rejet sans lire) ; le compteur `Parser.write` est la défense en profondeur (chunked/menteur).
- `[1× — 2026-06-08]` **config knob DÉCLARÉ ≠ CÂBLÉ (config qui ment)** : `keepaliveInterval`/
  `keepaliveGracePeriod` existent en Zod (`http/config/schema.ts`, desc « détecte les zombies ») mais
  **0 consommateur** → aucun heartbeat WS implémenté. Auditer une config = **vérifier les CONSOMMATEURS**
  d'un knob, pas sa seule déclaration. + committer une phase touchant le pipeline request (SessionStorage)
  SANS `memory.test` = miss (le gate pipeline vaut aussi pour le storage de session) — rattrapé.
- `[1× — 2026-06-08]` **`this.options` d'un module est FLAT (config `use()` deep-mergée par le Kernel)** : `Kernel.ts`
  fait `mod.options = extend(true, {}, mod.options, entry.config)` → lire la config d'un module via `this.options.<clé>`
  directement, JAMAIS sous un namespace `this.options?.<nomModule>`. **Bug réel** : `@nodefony/redis` lisait
  `this.options?.redis` (clé inexistante) → toute config app via `use("@nodefony/redis", …)` **ignorée silencieusement**
  (corrigé). → **vérifier le flux RÉEL (Kernel.ts) avant de copier un « frère »** : redis était un mauvais modèle sur ce
  point (realtime/mongoose = flat = correct). Convention-frère ≠ copier le premier frère venu — copier le frère JUSTE.
- `[1× — 2026-06-08]` **ne JAMAIS se fier à l'ordre de N listeners sur le même event kernel** : `proxy:generate`
  (son `generate()` enregistré tôt sur `onReady`) firait AVANT le listener de montage statique (server-static,
  enregistré plus tard à `onReady`) → `mounts` vide. Fix robuste = rendre le consommateur **auto-suffisant** :
  appel **idempotent explicite** (`mountModulePublics()`) au lieu d'attendre que l'autre listener ait tourné.
- `[1× — 2026-06-08]` **un kernel console CLI ne charge PAS les modules `policy:"dev"`** (test, test-frontend-\*,
  mediasoup). Une commande introspective (`proxy:generate`, `assets:publish`) ne voit que les modules PROD →
  l'absence d'un asset dev (`/test/`) est CORRECTE, pas un bug. Ne pas debugger un « manque » qui est le bon comportement.
- `[1× — 2026-06-07]` **« hot path prod » = le chemin DERRIÈRE proxy, pas le cas sans proxy** (recadrage user :
  « on passe dedans à tous les coups !! »). Un serveur de prod est TOUJOURS derrière un reverse-proxy → la
  résolution forwarded s'exécute à CHAQUE requête. Optimiser CE chemin (cas avec en-têtes), pas seulement le
  fast-exit « pas de proxy ». Leviers appliqués (forwarded.ts) : résolution LAZY (null hors proxy = 0 alloc),
  **fast-path mono-proxy 0 array** (pas de `split`/`map` quand 1 seul maillon — cas dominant 1 ingress),
  `firstToken` via `indexOf`/`slice` (pas `split`), `splitTopLevel` court-circuité sans quote, 1 SEULE passe
  stockée sur l'objet (les getters lisent, plus de re-parse par appel).
- `[1× — 2026-06-07]` **banc anti-spoof = faux positif si le proxy APPEND + le vrai client est dans la plage trusted** :
  nginx `$proxy_add_x_forwarded_for` (append) + curl hôte vu comme la gateway Docker (trusted via `uniquelocal`)
  → le from-right dépouille jusqu'à la valeur FORGÉE (6.6.6.6 ressortait). Pas un bug du code (22 tests unit + tests
  directs `Forwarded:` le prouvent). Leçon SÉCU : un **edge ÉCRASE** le XFF entrant (`proxy_set_header X-Forwarded-For
$remote_addr`, RFC 7239 §8.1), l'append est réservé aux proxies INTERNES d'une chaîne déjà fiable ; et `trustProxy`
  doit être **aussi étroit que possible** (pas toute la plage privée si le vrai client y est aussi).
- `[1× — 2026-06-06]` **`Object.create(null)` casse la sérialisation drizzle-orm** : un objet SANS
  prototype passé à un insert drizzle fait planter `is()` (drizzle-orm/entity.js) → `Object.getPrototypeOf(value).constructor`
  → `getPrototypeOf` renvoie `null` → `null.constructor` throw. Pour TOUT objet sérialisé/inséré via un ORM
  (sacs de session, payloads) utiliser `{}` (avec prototype), PAS `Object.create(null)` — la micro-optim
  null-proto (CLAUDE.md) ne vaut QUE pour des maps internes JAMAIS sérialisées. Invisible en unit (storage
  mocké) + typecheck ; révélé par la gate runtime (storage session dev = drizzle). → candidat `feedback_`.
- `[1× — 2026-06-05]` **profiler perf = banc PROPRE ou mesures FAUSSES (×3 dans la session)** : (a) `NODE_ENV=development`
  hérité dans l'env du spawn → `nodefony production` boote en **dev+Vite+throttle** (~2000 RPS au lieu de 6000) car
  `resolveRuntimeEnv` fait primer NODE_ENV ; **forcer `NODE_ENV=production`** dans le spawn. (b) Les **Vite orphelins**
  (title `nodefony-core`) survivent et **échappent à `pkill -f bin/nodefony`** → tuer par **PORT** (`lsof -ti tcp:5151,5152,5173,5177 | xargs kill -9`)
  - `pkill -f vite.js` + **vérifier `pgrep -c vite.js`=0**. (c) Toujours vérifier que `lsof -ti tcp:5151` == MON PID (sinon
    bench d'un fantôme). Méthode complète + baseline node nu + piège `node --prof` macOS (C++ faux symbole) → [[reference_perf_profiling_method]].
- `[3× — 2026-06-05]` **mesurer un gain AVANT de refondre, et l'abandonner s'il est noyé/négatif** : 3 hypothèses
  « malignes » mesurées en A/B atomique mono → (a) #3 fireAsync 0-listener = bruit ; (b) **différer le `JSON.stringify`
  de l'audit (passer l'OBJET au `Pdu` au lieu d'une string) = −5,3 % CONTRE-productif** — le ring buffer/Syslog RETIENT
  - traite un objet plus cher qu'une string compacte ; stringifier TÔT = le moindre mal (le `Pdu.payload` est `unknown`,
    les transports `JSON.stringify(pdu)` au write, mais le ring memory garde l'objet → pression GC) ; (c) saveSession-skip
    quand pas de session = +0,4 % bruit (ça n'évite qu'1 microtask : `saveSession()` sans session = `Promise.resolve(null)`).
    À l'inverse #1 router-first +28 % et **retrait `setParameters("query.*")` morts +3,2 %** = gains NETS. **Leçon clé : sur
    un pipeline déjà optimisé (post router-first), pas de gros poisson — le seul gain franc = supprimer du travail MORT**
    (les 4 `setParameters("query.*")` peuplaient le scope DI avec des clés que PERSONNE ne lit : @Query/@Param/@Body lisent
    `ctx.request.queryGet` direct). Micro-optimiser l'async/alloc du cœur = ROI faible + risque `memory.test`. **A/B atomique =
    paires ALTERNÉES** (old/new/old/new) en MONO (cluster co-localisé = co-location-bound) ; garder SSI les 2 new > les 2 old.
    Banc versionné : `nodefony-load-test/scripts/bench-ab-mono.sh` (niveau 3). Le vrai prochain levier perf = « fast path »
    (sauter par requête tout l'inutilisé) = chantier, PAS du grattage.
- `[1× — 2026-06-04]` **résilience de la phase config = à blinder SÉPARÉMENT du lifecycle** : `fireLifecycle`/
  `guardInitialize` (Phase 3 du kit boot, DÉJÀ livrée — kit périmé) couvrent les hooks modules, PAS `loadApp`
  (import app + résolution `defineConfig`). Une config invalide y throw une stack opaque. Fix = try/catch →
  `bootConfigError` : diagnostic clair (titre + cause + **champ Zod nommé** + **valeurs PAR DÉFAUT explicites**)
  - erreur marquée `presented` (les catch de boot ne re-loggent pas) + `exitCode` EX_CONFIG=78. **Piège** : le flag
    `presented` doit être respecté par TOUS les catch de la chaîne (loadApp → Kernel.start → **CliKernel.start**),
    sinon double-log stack. **Piège 2** : `nodefony development` (serveur) passe par le catch PRINCIPAL de
    `CliKernel.start()`, PAS `dispatchModuleCommand` (2 catch distincts) → fixer le bon (sinon `terminate(1)` au lieu de 78).
- `[1× — 2026-06-04]` **un descripteur (objet brandé par symbole) SURVIT au spread `{...options}` de Service** :
  un symbole computed enumerable d'object literal EST copié par `{...x}` (≠ idée reçue) → on peut passer un
  descripteur `defineConfig` via `super(name,kernel,url,descripteur)` et `isConfigDescriptor(this.options)` reste vrai.
  Prouvé par test dédié (l'hypothèse de design la plus risquée → la tester explicitement).
- `[1× — 2026-06-01]` **MESURER un gain perf AVANT de l'affirmer** : le « double-boot » prod/cluster (2
  `new Kernel`) était réputé doubler le boot → mesure avant/après (`scripts/boot-bench.mjs`, checkout du commit
  d'avant) : **2721 ms vs 2776 ms = identique** (kernel#1 s'arrêtait à `onStart`, ne bootait NI modules NI
  serveurs ; seul kernel#2 bootait). Gain réel du refacto = **mémoire** (1 container/injector/syslog → cause du
  doublon JSONL) + clarté, **PAS la vitesse**. Ne jamais survendre un refacto « perf » sans chiffre. Audit
  `docs/audits/boot-performance-2026-06-01.md` : 91 % du boot = import/instanciation de modules.
- `[1× — 2026-06-05]` **A/B RPS maison = bruité → 3 runs/côté + comparer les PLAGES, jeter le warmup.** Bench
  concurrent (50 conns, 3-4 s) sur la route réordonnée P2.9 : le 1er run = **warmup à JETER** (1622 vs médiane 1743) ;
  variance ~15-25 % **> écart** baseline↔feature → un verdict sur 1 run est FAUX (le seuil auto « à investiguer » a
  crié à tort). Conclusion correcte = **plages chevauchées = 0 régression** (baseline 1356-1813 vs feature 1622-1755).
  Protocole : baseline = `git stash` + rebuild + restart, bencher les 2 côtés MÊME machine, comparer médianes +
  chevauchement (jamais 1 vs 1). Complète « MESURER avant d'affirmer » ci-dessus.
- `[1× — 2026-06-01]` **daemon CONSOLE : `await new Promise(()=>{})` NE garde PAS Node vivant** : une Promise
  pending n'est pas un handle d'event loop → Node sort dès l'event loop vide. DevCommand/master survivent via
  LEURS handles (child process / workers+IPC+timers), pas le park. Un daemon CONSOLE pur (worker queue, consumer,
  agent) doit tenir un handle explicite (socket/timer). + **splash ASCII affiché par CHAQUE Kernel** (superviseur
  dev parent CONSOLE + enfant serveur = 2×) → gaté dev-only + `NODEFONY_DEV_CHILD` (`e27470e`).

- `[1× — 2026-06-01]` **Mutation d'un Pdu APRÈS `log()` ne corrige QUE le ring `memory`** : les drivers qui
  **sérialisent au write** (`file`/`cluster-file`/`loki`/`opensearch` = la PROD) figent le JSONL au moment
  du `log()`, AVANT toute mutation tardive. Vécu : le bilan `req`/`onFinish` (émis au teardown, hors bulle
  ALS) avait `requestId` vide sur `file` mais OK sur `memory` → trace cassée en prod. **Fix générique** :
  attacher la valeur **À LA CRÉATION** du Pdu — rouvrir une micro-bulle `RequestContext.run({requestId},
() => super.log(...))` quand l'ALS est vide (override `Context.log`). Vaut pour TOUT champ ALS sur un log
  de teardown. Toujours **vérifier sur le driver `file`/distant, pas seulement `memory`**.
- `[1× — 2026-06-01]` **Arbitrage perf↔observabilité = `AskUserQuestion` légitime, et la 3ᵉ voie** : le user
  a tranché « audit complet sévérités » puis s'est alarmé perf (« +volume prod »). La bonne réponse n'était
  NI son choix NI le contraire mais une **3ᵉ voie** : gate par env (INFO hors prod, DEBUG en prod) → 0
  surcoût prod + observabilité dev. Quand un choix produit a un coût hot-path, proposer le **gate
  conditionnel** (résolu 1×, lookup O(1)) plutôt qu'un comportement figé.

- `[1× — 2026-06-02]` **Refondre un field largement consommé : le BUILD TS est le filet ultime, pas le
  grep.** Le grep initial des consommateurs de `kernel.type` a RATÉ plusieurs formes (copies
  `this.type = cli.type` dans `setCli`/`logEnv` ; `?.type !== "CONSOLE"` dans 3 SessionStorage + Orm ;
  `kernel?.type === "SERVER"` cross-module mongoose/sequelize). `npm run build` (rollup plugin-typescript
  `TS2339: Property 'type' does not exist`) les a tous révélés **un par un**. → pour un rename de field :
  grep = 1ʳᵉ passe, **build = vérité** (itérer build→fix jusqu'à 0 TS2339). Et `?.field` défensif pour
  préserver le no-crash quand l'ancien `x === "Y"` tolérait `undefined` (cf `?? true`, `runProfile?.servers`).
- `[1× — 2026-06-02]` **Avant de refondre un flag, VÉRIFIER ce qu'il pilote vraiment.** `KernelType`
  SERVER/CONSOLE était réputé piloter le démarrage serveur → lecture des consommateurs : **quasi-inerte**
  (montage serveur = `kernelEvent` + présence `HttpKernel` ; rester-en-vie = park ; `type` = 4 gates de log
  cosmétiques). A transformé un « gros refacto risqué » en **nettoyage de modèle 0-comportement** (scope A
  validable sous filet). Lire les consommateurs AVANT de présumer l'impact/risque.
- `[1× — 2026-06-03]` **Boot : `debug`/`environment` ne sont résolus qu'à `preRegister` — APRÈS
  `initSyslog`/`loadApp`.** Pour gater quelque chose TÔT (sévérité de log, sélection de module), lire
  `process.argv` directement (comme `bin/nodefony.ts` pour l'env) plutôt que `this.debug`/`this.environment`
  (encore au défaut à `loadApp`). Vécu : `-d` ne relevait pas le silence d'une commande CLI tant que le gate
  lisait `this.debug` (faux à `loadApp`) → fix = `process.argv.includes("-d"|"--debug")`.
- `[1× — 2026-06-03]` **Sortie CLI propre = plancher de sévérité syslog (pas toucher chaque log).** Une
  commande console (`frontend:status`, help global) boote tout le manifeste → ~30 lignes de bruit (MODULE ADD,
  overrides config, ORM connected, banner env, terminate). Fix sans chirurgie : un flag `quietBoot` (posé au
  dispatch help/module) → `initSyslog` plancher la sévérité à `[0..3]`. La sortie de la commande via
  `console.log` (stdout direct, hors syslog) **survit** ; le bruit syslog est coupé ; `-d` rétablit. Le VRAI
  fix (ne pas booter/connecter tout le manifeste pour une commande console) = couches 2-3 [[project_module_loading_architecture]]
  (Phase 11). + **réutiliser `Kernel.isTTY`** (déjà résolu, NO_TTY-aware) au lieu de re-lire `process.stdout`
  (gate couleur boot — rappel user).

## 🔧 Git / commit (friction du jour)

- `[1× — 2026-06-11]` **commitlint `subject-case` rejette AUSSI un nom de classe en tête** : sujet
  `feat(...): ResourceController souverain...` refusé (PascalCase = sentence-case interdit), même si c'est un
  identifiant de code. → reformuler avec un nom commun devant (« controller de ressource souverain... ») ;
  l'identifiant exact va dans le BODY. Complète la règle « sujet MINUSCULE » de [[feedback_commit_fr_apostrophes]].
- `[1× — 2026-06-11]` **pre-push typecheck attrape ce que le build rollup laisse passer** : TS4114 (`static` qui
  redéclare un statique de la base exige `override`, noImplicitOverride) invisible au `npm run build` du package,
  bloquant au push. → après tout ajout de statique/membre redéclaré : `npm run typecheck` AVANT de committer,
  ou s'attendre à un fix-commit. (2 builds verts ≠ typecheck vert.)
- `[1× — 2026-06-07]` **clé privée TLS commitée découverte (sécu)** : `git ls-files | grep -iE
'certificates/.*\.(pem|key)'` a révélé `privkey.pem` (+ cert/fullchain/publickey) trackés dans
  `src/packages/@nodefony/http/nodefony/config/certificates/` depuis **sept. 2024**. Cause : le pattern
  `.gitignore` racine `nodefony/config/certificates` **contient un slash → ancré à la RACINE** (ne couvre
  PAS le même chemin dans un sous-module). Fix : `git rm` + motif **`**/nodefony/config/certificates/`**
  (le `**/` couvre tous les niveaux). → **Réflexe\*\* : à tout commit touchant des certs/secrets, `git
ls-files | grep -iE '\.(pem|key|p12|pfx)$'` ; un motif gitignore avec slash n'est jamais récursif.
- `[1× — 2026-06-06]` **commitlint `header-max-length` = 100** : un header conventional-commit FR
  descriptif dépasse vite (vécu : 112 car. — « refactor(http): réécriture cœur session.ts — TS strict,
  ID CSPRNG, dirty (étape 3) »). Header COURT (`type(scope): ` sujet bref), tout le détail dans le BODY
  (lignes de body ≤100 aussi). Se combine avec subject-case (minuscule).
- `[8× — 2026-06-06]` **commitlint `subject-case` = sujet en MINUSCULE** → ⏫ **DÛ POUR GRADUATION** (≥3×,
  à promouvoir dans [[feedback_commit_fr_apostrophes]] au prochain CONSOLIDATE). Un commit dont le sujet
  commence par une majuscule/nom propre (ex. `refactor(core): KernelType …`, `feat(dev): Vite …`, `docs: MAJ P10 …`
  - `docs: P10 Studio …` ← 2 nouveaux échecs cette session) est **rejeté** par le hook `commit-msg`. Réflexe :
    `type(scope): ` puis **minuscule** (reformuler « met à jour P10 … » au lieu de « MAJ P10 … »).
- `[1× — 2026-06-01]` **`routes/logs/` est gitignoré (pattern `logs`) → nouveaux fichiers invisibles + lint-staged
  « git error »** : créer `routes/logs/profileVisuals.tsx`/`ProfilingTab.tsx` → `git add` les ignore (les fichiers
  EXISTANTS du dossier restent trackés, mais les NOUVEAUX non) → besoin `git add -f`. Et le 1er `git commit` a
  échoué « lint-staged failed due to a git error » (stash/lock transitoire) sans rien perdre → **retry après
  `pkill -f lint-staged` + `rm -f .git/index.lock`** a réussi. Combine [[feedback_git_index_lock]] : sur ce repo,
  toujours `pkill lint-staged/generate-symbols` + `rm index.lock` AVANT un retry de commit raté.
- `[2× — 2026-06-05]` **`git push` en background ne FINALISE pas (hook pre-push lourd)** : le commit se fait, mais la
  branche reste « ahead 1 » sans erreur ni process actif → relancer en **foreground** (peut être rejeté « cannot lock
  ref … is at X but expected Y » = race, le background avait fini par pousser). La vérité = `git log origin/<branche>`,
  pas le « ahead » local. Vu 2× (frontend, framework). → push avec hook lourd = **foreground d'emblée**.
- `[1× — 2026-06-08]` **nouveau chantier ≠ branche de reprise → BRANCHER d'abord** : repris sur `refactor/orm-hardening`
  (ORM) puis committé + **poussé** tout le durcissement **WebSocket** (3 commits) dessus → signalé par le user (« les
  commits WS n'ont rien à faire dans cette branche !! »). Le **START de session doit vérifier que le chantier correspond
  au NOM de la branche** ; si le sujet diffère → `git switch -c hardening/<sujet>` AVANT le 1er commit. (Non réécrit ici :
  déjà poussé + même cible de merge `claude-ts` → coût rewrite > bénéfice ; vigilance au prochain START.)

---

## 🔌 Ports / orphelins serveur (boot resilience)

- `[1× — 2026-06-03]` **orphelin serveur au titre RENOMMÉ → `pkill -f bin/nodefony` LE RATE.** Un
  enfant dev/prod survit à son parent (PPID 1) en gardant 5151/5152, mais son titre est `nodefony
server`/`nodefony worker`/`nodefony-core` (`process.title`/`exec -a`) → `pkill -f "bin/nodefony"` ne
  le voit pas. **Toujours tuer par PORT : `lsof -ti :5151,:5152 | xargs -r kill -9`** (fiable, indépendant
  du nom). Vécu : EADDRINUSE en dev (superviseur mort sans group-kill) ET entre runs du boot-bench. →
  renforce [[project_boot_resilience_plan_kit]] : sur EADDRINUSE au boot, identifier+tuer le squatteur
  par port plutôt qu'« attendre un changement ».
- `[1× — 2026-06-03]` **A/B de boot via un mode SERVEUR = flaky** (shutdown gracieux libère le socket
  ~1 s après SIGTERM → run N+1 = EADDRINUSE). Pour un gain de boot propre : mode **sans port**
  (`test:daemon`) OU **mesure d'import isolée** (`node --input-type=module -e`, process frais, **cwd =
  racine** sinon les bare specifiers `@nodefony/*` ne résolvent pas). `timeout` absent sur macOS
  (boucle `kill -0` ou `gtimeout`).

## 🧪 Tests / hygiène (frictions du jour)

- `[1× — 2026-06-11]` **Un test vert peut verrouiller l'OUTCOME par chance, pas le MÉCANISME** : le test
  « Allow n'expose pas la méthode d'un autre vhost » passait uniquement parce que la route ouverte était
  enregistrée EN DERNIER (405 cross-vhost émis AVANT le check hostname dans Route.match — l'ordre inversé
  fuitait). → quand un invariant de SÉCU passe, ajouter le test de l'ordre/configuration inverse pour
  vérifier qu'il est structurel ; corrigé en vérifiant hostname AVANT methods (`bc88444`).
- `[1× — 2026-06-10]` **`this.timeout()` est une API MOCHA, pas Vitest** : `describe("…", function(){ this.timeout(N) … })`
  → sous Vitest `this` n'a pas `.timeout` → le fichier **ÉCHOUE AU CHARGEMENT** (« 0 test », erreur pointée sur la ligne
  `describe`), PAS un test rouge. → timeout = **3ᵉ argument de `it(name, fn, ms)`** ; `describe` en arrow `() => {}`.
  Vu sur 2 fichiers neufs (body-limit, websocket-origin) chargeant 0 test pendant que les 419 autres passaient.
- `[1× — 2026-06-08]` **`@vitest/coverage-v8` doit vivre à la RACINE du mono-repo** (à côté de `vitest` hoisté) :
  déclaré dans un seul workspace, il n'est PAS hoisté → `vitest` (racine) fait `ERR_MODULE_NOT_FOUND` au `--coverage`.
  Source unique racine (anti-dérive de version aussi). `npm install` simple ne le hoiste pas s'il est déjà résolu local.
- `[1× — 2026-06-08]` **les seuils `thresholds` se valident sur la CONFIG réelle, pas une mesure `--coverage.all` ad hoc** :
  la config (qui inclut le barrel `index.ts`) donne des % **plus bas** qu'un `--coverage.include='nodefony/src/**'` lancé à
  la main (vu : drizzle 80,9 ad hoc → 78,7 config ; mongoose 78,8 → 75,4). → toujours `npm run coverage` RÉEL + lire l'exit
  code avant de figer un seuil ; plancher = mesure config **−3 pts** (marge anti-flottement, cliquet à relever ensuite).
- `[1× — 2026-06-08]` **frontière de test framework-qui-wrappe-une-lib** : ne PAS retester drizzle-orm/mongoose/mongod
  (testés en amont) → tester NOTRE traduction critère→natif, le contrat portable identique cross-ORM, et NOS invariants
  (updateOne atomique, critère strict, savepoint anti-injection, garde-fou many-to-many). Le banc d'intégration sur le vrai
  moteur (SQLite `:memory:`, `mongodb-memory-server`) = la bonne cible, pas un mock de la lib.
- `[1× — 2026-06-08]` **vérifier la convention de test DU MODULE avant d'écrire** : http/framework/frontend =
  `import { expect } from "chai"` + `describe`/`it` globals (PAS `import { describe, it, expect } from "vitest"`
  jest-style). J'ai écrit `.to.deep.equal` avec import vitest (faux) → corrigé en chai + import `.js`. Copier
  l'en-tête d'un test voisin du module (convention-frère) au lieu de présumer le style.
- `[1× — 2026-06-08]` **prouver une config runtime PUIS révoquer proprement** : override `publicMount:{publicPath}`
  posé temporairement → curl `/medias/*` 200 + `/test/*` 404 (preuve), puis restore depuis backup + `git diff` = 0.
  Bon réflexe « tests-first / suspecter son diff » sur une feature config-driven sans test d'intégration dédié.
- `[1× — 2026-06-06]` **border TOUT run de test long avec un plafond** (sinon hang qui s'éternise) : un bug
  session a fait HANG la gate mémoire **19 min** (chaque requête 500 après ~6 s × N). Garde à 2 niveaux :
  (a) plafond DUR au lancement (param `timeout` de l'outil Bash, ou `gtimeout` — `timeout` absent macOS) ;
  (b) `--testTimeout=Nms` vitest par run (échec PROPRE) — SANS toucher le `testTimeout:600_000` du fichier
  (les bancs de charge en ont besoin). Le 600 s global du fichier ≠ plafond d'un run.
- `[1× — 2026-06-06]` **le storage de session en DEV = drizzle, PAS File** : un bug de sérialisation ORM (cf
  `Object.create(null)`↔drizzle, thème Core) est INVISIBLE en unit (storage mocké) + au typecheck ; SEULE la
  gate intégration/mémoire (drizzle réel) l'attrape. Ne jamais croire un refactor session « bon » sans la gate runtime.
- `[1× — 2026-06-04]` **un test qui POST un upload DOIT nettoyer son résidu** : le serveur écrit l'upload dans
  `uploadDir` (= `kernel.tmpDir` = `./tmp`) et ne nettoie QU'en **abort** (pas un upload réussi → l'app est censée
  `move()`/`unlink()`). `memory.test` (200 uploads/run) avait laissé **1403 `<uuid>.txt`** dans `./tmp` (pollution
  repo, signalée user). Fix = pattern **snapshot-diff** (before : `readdir` ; after : supprime UNIQUEMENT les
  nouveaux) — déjà présent dans `upload.test.ts` (le copier). Vérifier `tmp/` après run = 0 résidu.
- `[2× — 2026-06-04]` **`new Kernel()` dans un .test.ts au tri PRÉCOCE pollue le singleton `Nodefony.getKernel()`** :
  mocha trie les fichiers **insensible à la casse** → `configBoot`/`configUse` (c) tournent AVANT `index`/`Injector`
  (i) qui attendent un singleton propre → **faux échecs**. Le code était sain (prouvé par **baseline stash** : retirer
  le fichier → 0 fail). Fix = `before`/`after` capturant/restaurant `Nodefony.getKernel()` autour du bloc. (Pattern
  documenté CLAUDE.md kernel « Pollution singleton » — confirmé 2× ce jour.)
- `[1× — 2026-06-04]` **`process.env.X = saved` quand `saved === undefined` écrit la string `"undefined"`** → pollue
  les tests env suivants (faux `NODE_ENV`). Helper : `delete process.env.X` si la valeur sauvegardée est `undefined`
  (jamais `= undefined`). Cf `withEnv` dans configBoot.test.
- `[1× — 2026-06-05]` **migration mocha→vitest = compat par CONFIG, pas réécriture** : `globals:true` + shim
  `import "mocha"` + chai conservé tel quel + setup (reflect + alias `before`/`after`→`beforeAll`/`afterAll` + port
  perf-skip). Seuls les VRAIS mocha-ismes se réécrivent : `done`→`new Promise((done)=>…)` (codemod brace-matching,
  sync ET async, 0 faux-pass), `this.timeout/skip`→`describe.skipIf`+`vi.setConfig`+`ctx.skip()`. Recette + 2 pièges
  dans [[feedback_test_framework_vitest]]. Rodée 4× (core/mediasoup/frontend/framework).
- `[1× — 2026-06-05]` **vitest PLUS STRICT que mocha → débusque de vrais bugs** : (a) ESM strict → `arguments.callee`
  lève (mocha+tsx tolérait sloppy) ; (b) vitest pose `NODE_ENV='test'` (mocha l'absentait) → `resolveRuntimeEnv`
  12-factor collapse en `production`. NE PAS « aligner sur mocha » pour faire taire — c'est mocha qui était laxiste.
  Fix = corriger le bug (typeOf strict-safe) + tests env explicites (delete NODE_ENV scopé, cf `withEnv`).
- `[1× — 2026-06-05]` **`@types/mocha` retiré → `tsconfig.tests.json` `types:[…,"mocha",…]` casse tsc** (`Cannot find
type 'mocha'`). Au retrait mocha d'un workspace : remplacer par `vitest/globals` dans CHAQUE `tsconfig*.json` qui le
  liste (sinon pre-push rouge). Pas attrapé par le run vitest (esbuild ignore tsc).

- `[1× — 2026-06-05]` **ajouter un champ à un objet metadata PARTAGÉ casse les `deep.equal` existants** : étendre
  `ParamMeta` avec `stream` posé TOUJOURS (même `false`) a cassé 2 tests `@Body` (forme `{source,key,index}` attendue
  à l'identique). Fix = ne poser le champ optionnel **QUE s'il est truthy** (préserve la forme historique → rétro-compat).
  Les 2 fails étaient MON diff (pas pré-existant) — suspecter son diff d'abord (la suite framework complète l'a prouvé).
- `[1× — 2026-06-07]` **tester les MÉTHODES finales, pas que les fonctions pures** (demande explicite user). J'avais
  couvert `parseForwarded`/`forwardedNodeIp`/`resolveForwarded` (helpers purs) mais pas `getFullUrl`/`getRemoteAddress`
  (HTTP/HTTP2/WS) qui les CONSOMMENT — c'est là que vit le câblage réel. Recette pour isoler une méthode d'instance
  sans le ctor lourd : `Object.assign(Object.create(Cls.prototype), props)` + cast `as unknown as Cls` (cf
  `forwardedWiring.test.ts`). Couvre aussi le cœur partagé direct (`resolveFromRight`), pas juste via ses wrappers.
- `[1× — 2026-06-08]` **fabriquer une frame WS brute dans un test** : `ws.Sender.frame(buf,{fin,opcode,mask:true,
readOnly:false,rsv1:false})` MAIS `Sender` n'est PAS sur le default export ESM ni dans `@types/ws` → `import * as ws
from "ws"` + cast `(ws as unknown as {Sender:{frame}}).Sender`. Écrire les buffers retournés sur
  `(client as {_socket}).​_socket`. ⚠️ la route `/ws/echo` envoie d'abord `{handshake:true}` PUIS JSON-encode la
  réponse → **consommer le handshake** (`once("message")`) AVANT, et fragmenter un **objet JSON** (assert
  `JSON.parse(recv).x`), pas une string brute (revient quotée `"x"`).
- `[1× — 2026-06-08]` **`vitest run` silence `console.log`** (intercept du setup) → impossible de récupérer une mesure
  (p50/p99 d'un banc) par grep. Soit asserter une **borne** (`p99 < N`, CI-stable) en gardant les chiffres internes,
  soit écrire la mesure dans un fichier depuis le test. Ne pas s'acharner à capturer le log.
- `[1× — 2026-06-08]` **démo runtime « robustesse WS » = client réel + condition extrême** : half-open =
  `client._autoPong=false` (sinon `ws` pong tout seul → jamais zombie) + attendre `interval+grace` ; backpressure =
  `client._socket.pause()` (stoppe la lecture → `bufferedAmount` serveur gonfle) + flood. Observabilité sans sonde
  dédiée = **WARNING 1×/conn** loggé côté serveur, grep le log. ⚠️ un flood (17 MiB) gonfle `/tmp/nodefony-server.log`
  (→ 5 MiB) + peut saturer la capture stdout (ENOSPC transitoire) → `truncate -s 0` après.

## Derniers retex bruts (les 3 plus récents — historique complet dans `docs/session-retros/`)

- `2026-06-06-d97fad67` — **chantier session ÉTAPE 3** : cœur `session.ts` réécrit (TS strict, ID CSPRNG
  opaque `randomBytes(32)`, objet léger 3 sacs vs `Container` DI, dirty-tracking `save()` no-op, cookie-only,
  contrat unifié alias supprimés, `get`/meta/flash → null cohérent). Bug `Object.create(null)`↔drizzle fixé.
  Gates vertes (mémoire 9/9, intég 405/0). Direction décorateur étape 5 (`@UseSession` lazy + benchmark) figée. `248f235`.
- `2026-06-05-b8c2a82b` — **P14.11 core isomorphe CLOS** (shim `node:events` complété `rawListeners`/`prepend*` — bug
  runtime browser masqué par tsc + test régression, `f41bb23`) **+ SUPPRESSION TOTALE mocha 5/6** : core (1558 tests,
  2 bugs réels typeOf strict / NODE_ENV, `4106303`), mediasoup (22, `82cc83a`), frontend (42, `1a9b912`), framework (235,
  `899924a`) + docs/skills/mémoire (`01e3a93`/`d3901b4`). Reste **http** (gate mémoire/charge → session dédiée) + maj deps outdated.
- `2026-06-05-6c01bf49` — **audit vérité migration P0→P16 + assainissement `MIGRATION_STATUS.md`** : confronté au code
  (déclaré ≈ réel partout, global 50 % — fond honnête). Dashboard **278→32 KB** (cellules-journal de 3 800 car. tuées, 117
  tâches préservées) + audit complet `docs/migration/AUDIT-verite-2026-06.md`. Corrections : DETTE-CFG 🚧→✅, virage ORM
  répercuté, refs mortes PM2/mikroorm, P15 clarifié (banc ORM ≠ télécom), prochaine étape → durcissement ORM. `9936683` poussé.
- `2026-06-04-932ec78f` — **Lots 3+4 defineConfig + résilience config + hygiène tmp** : `use()` + registre typé
  (niveau ③, pilier #1 = 4/4) `6dc306b` ; câblage Kernel boot (descripteur résolu via ctx, merge défauts tous chemins,
  fallback legacy) `60a7929` ; **résilience config** (bootConfigError : diagnostic clair + défauts explicites + EX_CONFIG,
  prouvé en réel `port="abc"`) `08ad3e5` ; **memory.test nettoie ses uploads** (1403 résidus purgés) `0915764`. ➡️ Lot 5.
- `2026-06-04-b32ebcd5` — **planification CHANTIER CONFIGURATION (`defineConfig`)** : état des lieux `nodefony/config/` + vision (1 fichier racine minuscule auto-doc, `defineConfig`/`defineEnv`/`use`) + plan 8 lots + Lot 0 bouclé (env 12-factor vérifié, defaults framework à CRÉER). Décisions D1 (zod core peerDep), `use` (pas withModule), typage 4 niveaux + hot/boot. 0 code (planif). `431f1e1` + kit boussole.
- `2026-06-03-695bc070` — **Phase B (park centralisé via `lifetime`) + isTTY**, puis ménage piloté par audit : **retrait service rollup runtime** (−378 ms/−23 MB boot, A/B mesuré) + `nodefony build --force` (wrapper turbo) + **`@inquirer` lazy**. Audit poids d'import boot (imports ~1130 ms/94 MB, drizzle domine 423 ms/43 MB). 4 commits `b55c753`/`6a1dcd4`/`a71d004`/`68dd86e`.
- `2026-06-01-8b47ba7d` — **chantier CLI** : filet intégration + commander 15 + **1 seul Kernel** (double-boot tué) + hooks lifecycle tous modes + audit boot (91 % = imports) + banc 3 modes server/batch/daemon + guide Docker + **splash dev-only** + durcissement filet (intégrité modules). 8 commits `…b05e381`.
- `2026-06-01-690029d6` — fix doublon JSONL (double `initializeLog` re-monte FileTransport, `6814c05`) + fusion Profiler → Suivi de requête (onglets Timing/ORM + onglet Profiling Logs, page autonome supprimée, `1d4ed01`).
- `2026-06-01-961eb178` — gate couleur ANSI boot-time (helper `logColor` gaté `isTTY`, core/http/security) → JSONL/pipe propres hors TTY ; allocation-neutre (1 commit `7e68b05`).

> ✅ **CONSOLIDATE audité le 2026-05-31** (`CONSOLIDATION-2026-05-31.md`) : les 57 bruts (05-25→05-31)
> ont été balayés. **Verdict : rien à graduer.** Tous les thèmes récurrents (lock/lint-staged,
> clear/cache, dist/rebuild, restart, memory-test, HMR) sont **déjà** en `feedback_*` (60 mémoires).
> La seule friction non graduée — « shell instable sous charge » — n'a **1 seule date** (1×) → reste
> dans le sas. **Leçon : la graduation se fait EN CONTINU dans les sessions, pas en batch** ; l'alarme
> « N retex jamais consolidés » était un faux positif. Ne pas re-déclencher CONSOLIDATE sur le seul
> critère du nombre de bruts — le déclencher si une friction du sas atteint 3× ou si le dossier doit
> être archivé pour sa taille.
