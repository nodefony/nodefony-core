# Consolidation retex — 2026-09-24 — 22 retex (09-19 → 09-24)

## Ce qui a été fait

- **5 thèmes gradués, 83 frictions versées** — aucune perdue : chacune est versée dans une mémoire
  ou déclarée doublon avec une ligne de rappel dans sa maison.
  - 🚨 contrôle insatisfiable (29) → `feedback_gate_must_run` (§ 6 « il ne PEUT PAS être satisfait »,
    « un vert ÉNONCE ce qu'il a lancé »), `feedback_scope_wider_than_intended` (texte vs structure :
    trop large crie, trop étroit se TAIT), `feedback_prove_the_target_not_the_verdict` (« rien vu » ≠
    « rien »).
  - 🎚️ méthode écrite non imposée (25) → `feedback_written_rule_needs_reread` (ce qui a tenu = les
    règles portées par un gate).
  - 🧾 un test porte une mesure (12) → **NEUVE** `feedback_test_carries_a_measure` +
    `feedback_test_discriminant_or_dead` (le test mesure une entrée que le runtime ne produit pas).
  - 🏷️ un nom qui a survécu (11) → `feedback_anchor_expires_silently`, `agent_example_over_prose`,
    `refactor_grep_consumers`, `capability_unreachable_is_absent`.
  - 🔗 dépendance encodée ailleurs (6) → **NEUVE** `feedback_dependency_encoded_elsewhere`.
- Sas : 1 111 → 441 lignes, 18 frictions vivantes, aucun thème au seuil.
- 22 retex bruts archivés ; instantané `archive/RETEX-snapshot-2026-09-24.md`.
- **Spec MCP figée enfin SURVEILLÉE** : `mcp-2026-07-28` n'avait pas d'`AMONT.json`, sa dérive était
  invisible. Copie datée du commit amont `b488c166` ; deux fichiers avaient changé depuis
  (`resources.mdx` coquille, `subscriptions.mdx` : la fin d'un `subscriptions/listen` rend une réponse
  de COMPLÉTION, plus une réponse vide — aucun impact, non implémenté chez nous). Refigée sur
  `ab3a39c1`, `refs:check` vert sur les deux.
- `nodefony-check-claims` : `maxTurns` 40 → 80 (recommandé le 09-19 après trois runs butés à 40,
  jamais appliqué).
- Porteurs : PRODUIT 8 · DÉPÔT 37 (+5) · CONTEXTE 80 · INERTE 0 ; aucune ancre morte.

## Motifs récurrents (≥ 3 retex)

| Motif                                                              | Occurrences | État                                                            |
| ------------------------------------------------------------------ | ----------- | --------------------------------------------------------------- |
| CONSOLIDATE annoncé « dû » et repoussé                             | 5           | soldé ici                                                       |
| Verdict faux de MON instrument (moniteur, glob, contre-épreuve)    | 4           | gradué (🚨, suspect_instrument)                                 |
| Relevé de sous-agent à recompter                                   | 4           | règle en place (CLAUDE.md § délégation) — rien de neuf          |
| Décor sale ou voisin (5151 d'une autre app, base Mongo, URL Redis) | 3           | `feedback_stale_decor_poisons_verdicts` ; remède `--mongo` posé |

## Plan d'action — à valider (porteurs manquants nommés par la graduation)

1. **`WORKFLOWS_NON_BLOQUANTS` : champ `leveeQuand` + test relu à chaque release** — une exclusion
   admise a survécu à sa cause (`release-core.mjs:1083`).
2. **Barrière « un run long occupe l'arbre »** — `test:all` pose un verrou que le pre-commit lit :
   éditer `src/` pendant une passe a invalidé deux campagnes.
3. **`ticket-verify.mjs --dependents <N>`** branché au END — la fermeture ne lit pas les tickets qui
   en DÉPENDENT (#238 découvert par hasard).
4. **`bench-ab-mono.sh` orchestre les paires alternées** (un drapeau, pas une consigne).
5. **Relire la clé de `counts`** (`OrmAdminApi.ts:571`) : qualifiée par connecteur ?
6. Ticket : flakes de charge en suite complète (`RedisBackplane`, `migrate-adopt`, `detachedStart`).

Non vérifié par la graduation : `check:lang` n'est PAS au pre-commit (seulement un script npm).
