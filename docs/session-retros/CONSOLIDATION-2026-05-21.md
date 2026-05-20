# Consolidation retex — 2026-05-21 — retex #1 à #8 (2026-05-20 → 2026-05-21)

> 8 retex (< seuil 10-20, consolidation demandée explicitement). Sessions : presets Vite/audit,
> SSE listeners, Studio routing/realtime, fix ALS, data plane admin, security brainstorm,
> Studio modules docs, realtime+tests WS.

## Patterns récurrents détectés

| # | Pattern | Occ. | Impact | État |
| - | ------- | :--: | ------ | ---- |
| A | **Cycle rebuild→restart serveur non-batché** | **8/8** | Coût #1 absolu (10→23 restarts/session × ~30 s). Plusieurs fusionnables (« 3 restarts, 1 aurait suffi ») | Recommandé 2× (batch edits), jamais érigé en règle |
| B | **`cd <subdir>` puis `start.sh` chemin relatif casse** | 3 | 3 relances perdues/session ; cwd Bash persiste | **Mémoire existe** (`feedback_cd_startsh_relative_path`) MAIS re-vu 3× → seul un fix code arrête ça |
| C | **Turbo cache → dist périmé / logs rejoués** | 3 | re-builds `--force` (19×!) + faux diagnostics runtime | Mémoires existent (`feedback_turbo_cache_stale_logs`, `_root_dist_stale_modules`) |
| D | **Vérif front : curl /@fs, esbuild parse, hard-reload, Vite prébundle** | 5 | itérations lentes + faux bugs « cache React » / prébundle périmé | Partiel (no-headless mémorisé) ; pas d'outil unifié |
| E | **« Pré-existant » mal attribué (mon diff)** | 2 | régression ratée jusqu'à ce que le user pousse les tests | Mémoire existe (`feedback_spa_fallback_literal`) |
| F | **AskUserQuestion sur décisions DESIGN rejeté** | 2 | tokens + friction ; user préfère « décide + explique » | Pas de règle CLAUDE.md explicite |
| G | **Skills suggérés jamais créés** (audit-listeners, front-verify, read-brainstorming) | 2-3 | capitalisation manquée | — |
| H | **Commits FR à apostrophes** (`-m "...'..."`) | 2 | 4 réécritures/session | **Mémoire créée ce tour** (`feedback_commit_fr_apostrophes`) |

✅ Déjà résolu : bruit hook generate-symbols (homonymes, ~650 L/session) → fixé `b31e404`.

## Plan d'action (amélioration qualité IA)

1. **[CODE] Durcir `start.sh` + `stop.sh` → racine dérivée de `BASH_SOURCE` (chemin absolu), pas de `$(pwd)`.**
   Tue le piège B vu **3× malgré la mémoire**. Faible risque, fort gain. (Le `run.sh` du skill load-test le fait déjà — copier le pattern.)
2. **[CLAUDE.md] Règle « batcher les edits backend avant 1 SEUL rebuild+restart ».**
   Pattern A = coût #1 sur 8/8 retex. Promouvoir la reco récurrente en règle de workflow (regrouper toutes les modifs d'une feature serveur, puis 1 cycle stop→build→start ; les modifs frontend passent en HMR sans restart).
3. **[CLAUDE.md] Règle « sur une décision DESIGN/archi : décider + expliquer le pourquoi, pas d'AskUserQuestion ».**
   Pattern F. Réserver AskUserQuestion aux choix où la réponse change vraiment l'action (install lourd, ambiguïté de specs), pas aux arbitrages techniques que je peux trancher.
4. **[SKILL différé] `frontend-verify`** — consolide D : `curl -sk https://127.0.0.1:5173/@fs/<abs>` (transpile) + `esbuild --bundle=false` (parse) + purge `node_modules/.vite` du consumer (prébundle) + rappel hard-reload. Crée quand le prochain gros chantier front arrive.
5. **[SKILL différé] `audit-event-listeners`** — automatise grep `.on/.once/prependListener` + classif A/B/C/D (boot/server/request/surveillance). Utile pour les audits ALS/leak (security, framework). Crée au prochain audit listeners.

## À archiver
- 8 retex < 10 → on garde tout. Prochaine consolidation à ~16-20 retex (archiver alors `docs/session-retros/archive/`).
