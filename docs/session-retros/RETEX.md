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

## 🐚 Shell / environnement d'exécution

- **Shell Bash instable sous charge** `[1× — 2026-05-31]` : quand le serveur dev + 4 Vite tournent,
  le Bash renvoie des **sorties dupliquées ×2-3, vides, ou annule les appels parallèles en cascade**.
  → **1 commande Bash à la fois** (pas de parallèle), **`Read` plutôt que `cat`/`sed`/`tr`** pour lire
  un fichier, et si ça délire : arrêter de relancer 5 variantes (toutes annulées si une échoue).
  Suspect : machine saturée. Confirmer 1× de plus avant de graduer.

## ⚙️ Build / dist / boot (frictions confirmées → voir mémoires)

- Ces frictions sont **déjà graduées** — ne pas les redupliquer ici, juste les rappeler :
  - `npm run clean` détruit le **dist racine** (app) → `npm run build` foreground + `npx rollup -c`
    racine avant tout start → [[feedback_root_dist_stale_modules]].
  - `cd` dans une commande fait dériver le cwd → chemins relatifs cassés → [[feedback_cd_startsh_relative_path]].
  - Turbo cache sert des logs/dist périmés → [[feedback_turbo_cache_stale_logs]].
- `[1× — 2026-05-31]` **build turbo en arrière-plan incomplet** : après `clean`, un `npm run build`
  lancé en background n'avait pas régénéré tous les dist (drizzle/studio manquants) → 2 boots ratés.
  → build complet **foreground** et vérifier `ls dist/index.js` des modules clés avant start. (variante
  du pattern « created dist menteur » — à fusionner si revu.)
- `[2× — 2026-06-01]` **orm-core `dist/types` manque au pre-push typecheck (turbo cache)** : `@nodefony/user`
  importe `@nodefony/orm-core` dans ses `.d.ts` → si `orm-core/dist/types/index.d.ts` absent (après un `clean`
  - builds incrémentaux turbo), le typecheck `nodefony` casse (TS2307 « Cannot find module @nodefony/orm-core »)
    et **bloque `git push`** (hook pre-push). Vu 2× cette session (mêmes 3 erreurs). → rebuild ciblé
    `npx turbo run build --filter=@nodefony/orm-core --force` (~3s) AVANT le push. Variante de [[feedback_turbo_cache_stale_logs]].

## 🔄 Cycle de session (END/RETEX) — méta

- `[1× — 2026-05-31]` **END trop lourd = pénible** (feedback user). Le calcul de stats (tool_use, top
  fichiers, coût €) à CHAQUE fin de session est coûteux et rarement actionné. → **END allégé** : 3-5
  bullets de frictions ici + `_state` + commit. Les **stats lourdes + graduation + archivage** sont
  déplacées dans **CONSOLIDATE** (rare, tous les 10-20 retex). Implémenté dans le skill 2026-05-31.

## 🧩 Modules / docs / front (frictions du jour)

- `[1× — 2026-05-31]` **commitlint refuse un sujet en Majuscule** (`docs(retro): CONSOLIDATE …` rejeté,
  règle subject-case). → header de commit **en minuscule** ; corps avec apostrophes/accents OK via
  `git ci -F` (cf [[feedback_commit_fr_apostrophes]]).
- `[1× — 2026-05-31]` **`{{ }}` dans les `docs/*.md` d'un module sont résolus par `@nodefony/documentation`
  lui-même** (le module se scanne → effet miroir) : documenter la feature `{{ }}` mange ses propres
  exemples. → neutraliser les exemples : `{{ maVar }}` (provider inconnu = laissé littéral) ou `{{ … }}`
  (hors charset `[\w.-]` = non matché par le résolveur).
- `[1× — 2026-05-31]` **« Session front » ≠ forcément du dev** : quand le composant cible déjà les bonnes
  routes ET que les shapes back↔front sont compatibles (champs optionnels en trop/absents = dégradation
  propre), la session se réduit à un **diff de shapes + curl runtime, 0 edit**. Ne pas présumer qu'il faut
  coder ni invoquer `nodefony-studio-dev`. Reste = confirmation visuelle user (hard-reload, pas de headless).
- `[1× — 2026-05-31]` **un test ne doit JAMAIS laisser de résidu** (`upload.test.ts` accumulait des
  `<uuid>.{ts,png,txt}` dans le dossier d'upload, jamais nettoyés). Le service persiste les fichiers reçus,
  le test ne les supprimait pas. → `before` snapshot du dossier + `after` qui supprime **uniquement le diff**
  (fichiers créés par la suite), sans toucher au préexistant. Vérifier net-0 (avant N / après N).
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

## 🔎 Vérification / preuve runtime (frictions du jour)

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

---

## Derniers retex bruts (les 3 plus récents — historique complet dans `docs/session-retros/`)

- `2026-06-01-961eb178` — gate couleur ANSI boot-time (helper `logColor` gaté `isTTY`, core/http/security) → JSONL/pipe propres hors TTY ; allocation-neutre (1 commit `7e68b05`).
- `2026-05-31-c7578918` — LB.5 cluster-file + console Logs cluster-honnête + chip runtime/backplanes topbar + dir logs configurable + fix test upload (5 commits).
- `2026-05-31-41ca4a89` — commit module doc + CONSOLIDATE (verdict rien à graduer) + Session A (docs+tests) + Session B (front déjà compatible, 0 edit).
- `2026-05-31-a5a0cf2d` — création back module `@nodefony/documentation` (data plane doc transverse) + activation runtime.

> ✅ **CONSOLIDATE audité le 2026-05-31** (`CONSOLIDATION-2026-05-31.md`) : les 57 bruts (05-25→05-31)
> ont été balayés. **Verdict : rien à graduer.** Tous les thèmes récurrents (lock/lint-staged,
> clear/cache, dist/rebuild, restart, memory-test, HMR) sont **déjà** en `feedback_*` (60 mémoires).
> La seule friction non graduée — « shell instable sous charge » — n'a **1 seule date** (1×) → reste
> dans le sas. **Leçon : la graduation se fait EN CONTINU dans les sessions, pas en batch** ; l'alarme
> « N retex jamais consolidés » était un faux positif. Ne pas re-déclencher CONSOLIDATE sur le seul
> critère du nombre de bruts — le déclencher si une friction du sas atteint 3× ou si le dossier doit
> être archivé pour sa taille.
