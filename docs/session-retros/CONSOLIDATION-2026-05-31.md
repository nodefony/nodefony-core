# Consolidation retex — 2026-05-31 — bruts du 2026-05-25 au 2026-05-31 (57 retex)

> 1er run du mode CONSOLIDATE depuis la mise en place du système SAS. Déclenché par
> « consolide les retex », avec consigne user : « qu'elle serve, sinon dis-le ».

## Méthode

Agrégation `jq/awk` des sections `Coûts évidents` / `Recommandations` / `Patterns récurrents`
des 57 bruts (565 bullets), fréquence des thèmes, **croisement avec les 60 mémoires `feedback_*`
déjà existantes**. Pas de lecture intégrale des 57 fichiers (économie tokens).

## Fréquence des thèmes (sur 565 bullets)

<!-- prettier-ignore -->
| Thème | Fréq | Déjà gradué en `feedback_*` ? |
| --- | ---: | --- |
| lock / lint-staged / index.lock | 66 | ✅ `git_index_lock` |
| clear / compact / contexte / cache | 65 | ✅ `token_economy` + `session_hygiene` |
| dist / rebuild / périmé / stale | 56 | ✅ `root_dist_stale_modules` + `turbo_cache_stale_logs` + `session_pitfalls` |
| skill (recommandations) | 49 | — majoritairement « **Pas de nouveau skill** » (triage négatif) |
| restart / relance | 42 | ✅ `session_hygiene` (batcher les edits avant 1 restart) |
| memory-test / heap / fuite | 33 | ✅ `perf_memory_rule` |
| HMR / vite | 32 | ✅ `session_hygiene` |
| shell / bash / parallèle / dupliqué | 17 | ⏳ sas RETEX.md — **1 seule date (1×)**, pas mûr |
| symbols.json | 4 | ✅ doc `.ai/symbols.json` (CLAUDE.md) |
| curl / frontend-verify | 3 | ✅ `nodefony-frontend-verify` (skill créé) |

## Verdict : rien à graduer, pipeline sain

- **Tous les thèmes récurrents (≥3× multi-sessions) sont déjà gradués.** Aucun pattern chaud non capté.
- **« shell instable sous charge »** : présent sur **1 seule date** (2026-05-31) → 1×. Reste
  correctement dans le sas, pas prêt pour `feedback_*`. À re-évaluer si une 2e/3e session le revoit.
- **Skills** : aucun backlog. Les retex se sont auto-triés (« Pas de nouveau skill » répété) et les
  skills utiles ont été créés (`nodefony-documentation` 793051e, `nodefony-frontend-verify` 184e5e5).

**Conclusion structurante** : la **graduation s'opère EN CONTINU dans les sessions** (les 60 mémoires
`feedback_*` SONT la sortie consolidée), pas dans un batch CONSOLIDATE. L'alarme « N retex jamais
consolidés » (qui figurait dans RETEX.md et le `_state`) était un **faux positif** fondé sur le seul
nombre de bruts. → Critère de déclenchement corrigé : déclencher CONSOLIDATE quand **une friction du
sas atteint 3×** ou quand le **dossier doit être archivé pour sa taille**, pas sur le compte de bruts.

## Actions

1. ✅ `RETEX.md` : alarme « 57 jamais consolidés » remplacée par le verdict + critère de déclenchement corrigé.
2. ✅ Cette note (`CONSOLIDATION-2026-05-31.md`) — acte le verdict pour ne pas re-balayer les 57 à chaque RESUME.
3. ⏳ Archivage des 57 bruts → `archive/` : **optionnel** (housekeeping, dossier borné, scans futurs moins chers). À décider avec le user.
