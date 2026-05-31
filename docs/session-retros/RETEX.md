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

---

## Derniers retex bruts (les 3 plus récents — historique complet dans `docs/session-retros/`)

- `2026-05-31-41ca4a89` — commit module doc + CONSOLIDATE (verdict rien à graduer) + Session A (docs+tests) + Session B (front déjà compatible, 0 edit).
- `2026-05-31-a5a0cf2d` — création back module `@nodefony/documentation` (data plane doc transverse) + activation runtime.
- `2026-05-31-3d9b015f` — LB.2 driver file JSONL queryable + candidats logs (Loki).

> ✅ **CONSOLIDATE audité le 2026-05-31** (`CONSOLIDATION-2026-05-31.md`) : les 57 bruts (05-25→05-31)
> ont été balayés. **Verdict : rien à graduer.** Tous les thèmes récurrents (lock/lint-staged,
> clear/cache, dist/rebuild, restart, memory-test, HMR) sont **déjà** en `feedback_*` (60 mémoires).
> La seule friction non graduée — « shell instable sous charge » — n'a **1 seule date** (1×) → reste
> dans le sas. **Leçon : la graduation se fait EN CONTINU dans les sessions, pas en batch** ; l'alarme
> « N retex jamais consolidés » était un faux positif. Ne pas re-déclencher CONSOLIDATE sur le seul
> critère du nombre de bruts — le déclencher si une friction du sas atteint 3× ou si le dossier doit
> être archivé pour sa taille.
