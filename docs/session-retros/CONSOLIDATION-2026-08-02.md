# Consolidation retex — 2026-08-02 — 61 retex (2026-07-23 → 2026-08-02)

Période : depuis la consolidation du 2026-07-23. **61 retex bruts**, **135 frictions** réparties en
**36 thèmes** dans le SAS (`RETEX.md`, 897 lignes pour une cible d'un écran).

## 🔴 Le défaut de MÉTHODE trouvé — la règle de graduation ne pouvait pas se déclencher

L'ancienne règle du SAS était : _une friction vue **≥3×** est graduée en mémoire `feedback_*` puis
retirée d'ici_. Elle n'a **jamais** déclenché.

| Compteur       | Bullets |
| -------------- | ------: |
| `[1×]`         |     121 |
| `[2×]`         |      14 |
| `[3×]` et plus |   **0** |

**Pourquoi** : chaque session écrivait un bullet NEUF plutôt que d'incrémenter un existant — les
formulations diffèrent, la friction se reconnaît mal d'une séance à l'autre. Le compteur mesurait
donc la **répétition littérale**, jamais le pattern.

**Conséquence mesurée** : le thème « 🧪 Suspecter son INSTRUMENT avant le sujet mesuré » a accumulé
**35 frictions distinctes en dix jours** — le pattern dominant du projet — sans jamais atteindre le
seuil, donc sans jamais être gradué.

**Correctif appliqué** : le seuil porte désormais sur le **THÈME** (~5 frictions distinctes), pas
sur le compteur d'un bullet. Le `[N×]` ne sert plus qu'à repérer une répétition à l'identique.

## Second défaut — le RETRAIT n'a jamais été fait

**15 mémoires `feedback_*` ont été graduées** depuis le 2026-07-23 (`agent_example_over_prose`,
`gate_must_bite`, `bench_probe_false_verdicts`, `prove_on_received_artifact`, `single_source_rule`,
`delegation_balance`, `subagent_model_in_label`, `destructive_needs_identity_scope`,
`shell_false_diagnostics`, `green_covers_only_its_diff`, `ci_is_free_dont_double_it`,
`cross_platform_axioms`, `env_var_nf_prefix`, `code_rewrite_mechanical_traps`,
`gitignored_breaks_clone`) — **aucune n'a été retirée du SAS**. La règle anti-doublon était violée
sur 10 thèmes, et c'est l'essentiel des 897 lignes.

## Patterns récurrents détectés

<!-- prettier-ignore -->
| Pattern | Occurrences | Décision |
| --- | ---: | --- |
| Suspecter son instrument / son propre diff avant le produit | 35 | **gradué** → `feedback_suspect_instrument_and_own_diff` |
| Un exemple de CODE agit, y compris quand il est faux | 8 | déjà gradué → retiré du SAS |
| Gate qui ne LIT rien · débranchement destructeur | 7 | déjà gradué → retiré du SAS |
| Isoler une variable · régler une sonde de proximité | 8 | déjà gradué → retiré du SAS |
| Inventaire exhaustif seulement par CROISEMENT | 4 | **gradué** → `feedback_inventory_needs_crosscheck` |
| Variance d'un run à l'autre = la mesure | 4 | déjà gradué → retiré du SAS |
| Un vert de test ne dit pas que ça compile | 3 | déjà gradué → retiré du SAS |
| Ce qui est COPIÉ à la création ne se met jamais à jour | 4 | déjà gradué → retiré du SAS |

## Plan d'action

1. ✅ **Graduer** les deux patterns démontrés et non couverts :
   - `feedback_suspect_instrument_and_own_diff` — l'ordre des suspects (mon diff → l'instrument →
     le produit), la mesure fausse DANS SON SENS, la matière trop large d'une sonde, le diagnostic
     écrit qui vieillit comme un ancrage.
   - `feedback_inventory_needs_crosscheck` — le modèle survole, l'automate a des angles morts de
     forme ; l'automate EXTRAIT, le modèle CONTEXTUALISE, le principal CONCLUT.
2. ✅ **Retirer du SAS** les 10 thèmes déjà couverts par une mémoire (règle anti-doublon), avec une
   table de renvoi en pied de `RETEX.md` pour qu'aucune leçon ne devienne introuvable.
3. ✅ **Corriger la règle de seuil** dans l'en-tête du SAS, avec la raison chiffrée.
4. ✅ **Archiver** les 61 retex bruts → `docs/session-retros/archive/`.
5. ✅ **Solder une dette de source unique** trouvée au passage : `project_devkit_bench_matrix`
   recopiait les verdicts de `baseline.json` et annonçait 28 tâches quand la référence en portait
   30, un FAIL sur une tâche fermée (T18) et une tâche supprimée (T23). La colonne dupliquée est
   **retirée** au profit d'un `jq` — remettre le tableau à jour l'aurait seulement re-périmé.
6. ✅ **Aligner le skill `nodefony-session`** (modes END / CONSOLIDATE), qui portait encore « à
   **3×** → CONSOLIDATE la promeut ». Laisser deux règles contradictoires — une dans le SAS, une
   dans le skill qui le maintient — aurait été pire que le changement lui-même
   ([[feedback_single_source_rule]]). Le mode CONSOLIDATE gagne au passage une étape explicite :
   **vérifier que les graduations déjà faites ont bien été RETIRÉES du sas**, avec la commande qui
   liste les mémoires créées depuis le dernier passage.

## Résultat

|                         |      Avant |                       Après |
| ----------------------- | ---------: | --------------------------: |
| `RETEX.md`              | 897 lignes |                     **182** |
| Thèmes vivants          |         36 | 18 (+ 2 sections d'archive) |
| Frictions               |        135 |                          36 |
| Retex bruts à la racine |         61 |                       **0** |
| Mémoires `feedback_*`   |         92 |                          94 |

Snapshot intégral avant coupe : `archive/RETEX-snapshot-2026-08-02.md` — rien n'est perdu.
