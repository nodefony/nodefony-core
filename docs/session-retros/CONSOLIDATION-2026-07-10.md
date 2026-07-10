# Consolidation retex — 2026-07-10 — retex 2026-06-12 → 2026-07-10 (103 bruts)

## Bilan d'assainissement

```
                        avant        après        Δ
  RETEX.md (SAS)        1 797 l.  →  73 l.      −96 %
  retex bruts actifs    103       →  0           (→ archive/, 211 fichiers au total)
  leçons graduées       —         →  3 nouvelles feedback_* + 1 déjà couverte
  doublons purgés       —         →  4 (déjà en feedback_*/CLAUDE.md)
```

Snapshot intégral du SAS avant coupe : [`archive/RETEX-snapshot-2026-07-10.md`](archive/RETEX-snapshot-2026-07-10.md) — **rien n'est perdu**.

## Graduations (friction ≥3× → mémoire durable)

| Friction                                                      | Occurrences              | Graduée en                                                             |
| ------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------- |
| `rg -r` = --replace (sortie corrompue silencieuse)            | 6×                       | `feedback_rg_no_replace_flag`                                          |
| Bench coût sécu : ~98 % = store session, pas firewall/TLS     | 3× (banc+live+profiling) | `feedback_bench_isolate_session_store`                                 |
| `$VAR` multi-chemins non quotée → « No such file » trompeur   | 3×                       | `feedback_shell_no_unquoted_multipath`                                 |
| Éditer le backend pendant un test live front (rebuild → DOWN) | 3×                       | déjà gravée : CLAUDE.md racine §Hygiène n°4 (batcher) — retirée du SAS |

## Doublons purgés (déjà durables — règle anti-doublon)

- commitlint `subject-case` (3×) + `header-max-length` + `.git/index.lock` (2×) → tout est déjà dans `feedback_commit_fr_apostrophes`.
- turbo `cache hit` trompeur (2×) → `feedback_turbo_cache_stale_logs`.
- 404 e2e = dist périmé → `feedback_session_pitfalls` + CLAUDE.md http.

## Ce qui reste dans le SAS (73 lignes)

Thèmes chauds 07-08→07-10 : Dépendances/upgrade (8) · Migration d'outillage (4, dont `start.sh`
TIMEOUT **4×** — un fix vaut mieux qu'une graduation, follow-up au kit rolldown) · Méthode de
comparaison de builds (3) · Perf/bancs (4 : pool PG, RPS-honnêteté, cluster cœurs physiques,
client co-localisé). Le reste (~180 leçons 1× jamais re-vécues sur ~100 sessions) → archive.

## Patterns récurrents notés (sous le seuil, à surveiller)

- `start.sh` fenêtre 25 s : 4× — **action = fix du script**, pas une mémoire.
- Restart dev coûteux / rebuild turbo pendant itération (2×+2× proches) : structurellement
  atténué par rolldown (34 s clean, 0,17 s core) — attendre re-mesure avant d'agir.

## Prochain CONSOLIDATE

Dans ~10-20 retex. Le SAS repart propre ; la règle « une leçon = SAS ou feedback_*, jamais les
deux » a été appliquée strictement.
