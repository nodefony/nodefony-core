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

---

## Derniers retex bruts (les 3 plus récents — historique complet dans `docs/session-retros/`)

- `2026-05-31-a5a0cf2d` — création back module `@nodefony/documentation` (data plane doc transverse) + activation runtime.
- `2026-05-31-3d9b015f` — LB.2 driver file JSONL queryable + candidats logs (Loki).
- `2026-05-31-2399c6e8` — design API souveraine + MAJ migration.

> ⚠️ **57 retex accumulés (2026-05-29→05-31), JAMAIS consolidés** → CONSOLIDATE est **largement dû**.
> Ce `RETEX.md` n'est seedé QUE des 3 derniers + des frictions confirmées déjà en `feedback_*`. Un
> CONSOLIDATE en session dédiée doit : balayer les ~57 bruts, grader les patterns ≥3× en `feedback_*`,
> archiver les bruts vers `archive/`, et enrichir ce sas par thème. Dire « consolide les retex ».
