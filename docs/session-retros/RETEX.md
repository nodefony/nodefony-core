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

## 🔎 Vérification / preuve runtime (frictions du jour)

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

- `[1× — 2026-06-01]` **MESURER un gain perf AVANT de l'affirmer** : le « double-boot » prod/cluster (2
  `new Kernel`) était réputé doubler le boot → mesure avant/après (`scripts/boot-bench.mjs`, checkout du commit
  d'avant) : **2721 ms vs 2776 ms = identique** (kernel#1 s'arrêtait à `onStart`, ne bootait NI modules NI
  serveurs ; seul kernel#2 bootait). Gain réel du refacto = **mémoire** (1 container/injector/syslog → cause du
  doublon JSONL) + clarté, **PAS la vitesse**. Ne jamais survendre un refacto « perf » sans chiffre. Audit
  `docs/audits/boot-performance-2026-06-01.md` : 91 % du boot = import/instanciation de modules.
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

- `[3× — 2026-06-02]` **commitlint `subject-case` = sujet en MINUSCULE** → ⏫ **DÛ POUR GRADUATION** (≥3×,
  à promouvoir dans [[feedback_commit_fr_apostrophes]] au prochain CONSOLIDATE). Un commit dont le sujet
  commence par une majuscule/nom propre (ex. `refactor(core): KernelType …`, `feat(dev): Vite …`) est
  **rejeté** par le hook `commit-msg`. Réflexe : `type(scope): ` puis **minuscule** (reformuler « remplace
  le binaire KernelType … » au lieu de « KernelType … »).
- `[1× — 2026-06-01]` **`routes/logs/` est gitignoré (pattern `logs`) → nouveaux fichiers invisibles + lint-staged
  « git error »** : créer `routes/logs/profileVisuals.tsx`/`ProfilingTab.tsx` → `git add` les ignore (les fichiers
  EXISTANTS du dossier restent trackés, mais les NOUVEAUX non) → besoin `git add -f`. Et le 1er `git commit` a
  échoué « lint-staged failed due to a git error » (stash/lock transitoire) sans rien perdre → **retry après
  `pkill -f lint-staged` + `rm -f .git/index.lock`** a réussi. Combine [[feedback_git_index_lock]] : sur ce repo,
  toujours `pkill lint-staged/generate-symbols` + `rm index.lock` AVANT un retry de commit raté.

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

## Derniers retex bruts (les 3 plus récents — historique complet dans `docs/session-retros/`)

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
