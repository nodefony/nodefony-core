# Consolidation retex — 2026-08-06 — 28 retex (2026-08-02 → 2026-08-06)

Passe déclenchée au 13ᵉ signalement. SAS `RETEX.md` : **1 055 → ~230 lignes** ; ~122 frictions
sur ~135 graduées ou transférées. Snapshot intégral avant coupe :
`archive/RETEX-snapshot-2026-08-06.md`.

## Patterns récurrents détectés → destination

| Pattern (frictions)                                                         | Destination                                           |
| --------------------------------------------------------------------------- | ----------------------------------------------------- |
| Paramètre de query accepté puis jeté · capacité codée au front (21)         | ⭐ NOUVELLE `feedback_param_accepted_then_dropped`    |
| Régime machine d'un banc (lowpowermode, thermal, mds) · profil/in-situ (26) | ⭐ NOUVELLE `feedback_bench_machine_regime`           |
| Test sans données discriminantes · refus≠capacité · filet partiel (22)      | ⭐ NOUVELLE `feedback_test_discriminant_or_dead`      |
| Gabarits = code distribué · dogfooding · agent étranger (11)                | ⭐ NOUVELLE `feedback_dogfood_distributed_templates`  |
| Décor sale : serveurs résiduels, ports pendants, stores accumulés (10)      | ⭐ NOUVELLE `feedback_stale_decor_poisons_verdicts`   |
| Une livraison n'entraîne pas sa doc · anchor-fix · renommage (6)            | `feedback_refactor_grep_consumers` enrichie (§ doc)   |
| Formes shell neuves : zsh `:A`, BRE `\{`, `rg -oh`, `&&`, `timeout` (6)     | `feedback_shell_false_diagnostics` enrichie (tableau) |
| Concurrence & dialectes SQL/NoSQL — matière S5 (9)                          | kit `project_orm_multidialect_chantier_kit`           |
| Surface npm & publication (6)                                               | kit `project_release_nodefony10`                      |
| Piloter un agent tiers (drapeaux, gardes par résultat) (6)                  | kit `project_devkit_bench_agent_switch`               |
| Juges auto-satisfaits · sondes de moyen · décor du banc (11)                | kit `project_devkit_bench_matrix`                     |

Trois petits thèmes fondus dans les nouvelles mémoires (traducteur double → param ; commande
maison/familiarité → dogfood ; remise à zéro fichiers≠process → stale_decor + kit matrix).

## Ce qui reste au SAS (sous le seuil de ~5)

15 thèmes, ~35 bullets : patron≠factorisation, gardes retirées, capacité-avec-sa-tâche, montée
d'outil, mode machine muet, prémisse à vérifier, npm arbre à la main, question reposée, doc
officielle vs mémoire, gate rouge permanent, outillage divers (MCP, captures, sondes muettes).

## Enseignement de la passe

Le rythme des sessions (6 retex le seul 6 août) a laissé le SAS tripler entre deux consolidations —
le signalement « CONSOLIDATE dû » a été porté 13 fois par les `_state` avant d'être exécuté. La
consolidation reste rentable : 11 thèmes étaient mûrs, dont 3 directement actionnables dans des
chantiers ouverts (S5 DDL, release npm, bancs devkit) où la matière aurait été introuvable dans un
SAS de 1 055 lignes.

## Archivé

28 retex bruts → `archive/` (git mv, historique suivi) + `RETEX-snapshot-2026-08-06.md`.
