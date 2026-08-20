# Consolidation retex — 2026-08-20 — 22 retex (08-06 → 08-20)

Neuvième consolidation. Le sas `RETEX.md` avait franchi **1 004 lignes** (cible : ~1 écran) avec
**47 thèmes / ~180 frictions** — dont plusieurs très au-delà du seuil de graduation (~5 frictions
distinctes par thème), et des frictions antérieures au CONSOLIDATE précédent jamais coupées.

## Patterns récurrents détectés

| Pattern                                                        | Frictions | Impact                                                                                                              |
| -------------------------------------------------------------- | --------: | ------------------------------------------------------------------------------------------------------------------- |
| Un outil rend un verdict sur un périmètre qu'on n'a pas prouvé |        24 | **Le plus coûteux du dépôt : il produit du VERT.** typecheck depuis un cwd dérivé, lint ciblé, `docker cp` imbriqué |
| Un débranchement ne prouve pas ce qu'on croit                  |        14 | Faux verts en série ; sauvé 4× par le **compte de rouges annoncé AVANT de couper**                                  |
| Annoncer une norme sans l'avoir lue jusqu'au bout              |        10 | Serveur MCP conforme et **injoignable** ; une justification d'écart fausse recopiée en 3 endroits                   |
| La doc/le source périment la mémoire                           |         7 | 2 décisions de **conception** inversées après lecture du source (`jose`, drizzle)                                   |
| Quatre instruments faux sur une seule question                 |         6 | Diagnostic tranché en changeant d'**ordre de grandeur**, pas d'instrument                                           |
| Une capacité qu'on n'atteint pas n'existe pas                  |         6 | Le user a dû s'énerver pour que j'atteigne le navigateur en conteneur                                               |
| Un test qui attend un délai fixe                               |         5 | 3 rouges d'intégration d'affilée, **3 sondes fausses**, jamais le code                                              |
| Le user repose la question                                     |         7 | Une reformulation = ma réponse est fausse, pas imprécise                                                            |
| npm ment par périmètre                                         |         5 | `outdated` aveugle à la racine ; devDep **inlinée** dans un bundle publié                                           |

## Plan d'action — exécuté

**7 mémoires neuves** (mémoire IA, hors dépôt) :

1. `feedback_prove_the_target_not_the_verdict` — prouver la CIBLE avant de croire le VERDICT
2. `feedback_spec_conformance_vs_reachability` — conformité ≠ joignabilité ; lire la norme jusqu'aux ères
3. `feedback_source_over_memory` — la doc officielle périme la mémoire, le source périme la doc
4. `feedback_test_no_fixed_delay` — un délai fixe mesure la machine
5. `feedback_user_repeats_question` — le user reformule ⇒ ma réponse est fausse
6. `feedback_capability_unreachable_is_absent` — une capacité inatteignable n'existe pas
7. `feedback_npm_tree_not_a_guarantee` — npm ment par périmètre

**3 mémoires enrichies** (au lieu d'en créer des doublons) :

- `feedback_gate_must_bite` ← section « ce qui rend un débranchement CONCLUANT » (14 frictions)
- `feedback_suspect_instrument_and_own_diff` ← section « changer d'ORDRE DE GRANDEUR » (6)
- Résidus outillage renvoyés vers `feedback_bash_cwd_drift` / `feedback_shell_false_diagnostics`

**Maintenance du sas :**

- Snapshot avant coupe : `archive/RETEX-snapshot-2026-08-20.md`
- 11 thèmes gradués + 8 thèmes antérieurs au 08-06 retirés → `RETEX.md` **1 004 → 493 lignes**
  (26 thèmes, ~57 frictions récentes non graduées)
- 22 retex bruts déplacés vers `archive/` (`git mv`, historique conservé)

## Ce que cette consolidation apprend sur le CYCLE lui-même

- **Le seuil par THÈME fonctionne, la coupe par ANCIENNETÉ manquait.** Le CONSOLIDATE du 08-06 a
  gradué correctement mais n'a pas retiré les thèmes vieillis non gradués : 8 thèmes datés de
  juillet et début août traînaient encore. **Ajouter à la maintenance : tout thème dont TOUTES
  les frictions sont antérieures au CONSOLIDATE précédent est coupé** — soit il a été gradué
  ailleurs, soit il n'a pas assez porté pour l'être.
- **Un thème fourre-tout absorbe tout ce qui n'a pas de maison** : « 🧰 Outillage : ce qui pend,
  ce qui ment, ce qui lance » avait accumulé 24 frictions sur trois semaines faute d'un titre qui
  nomme un MOTIF. Il en portait un, très net (le périmètre non prouvé) — invisible tant qu'il
  s'appelait « outillage ».
- **Deux frictions ont été reproduites à l'identique alors qu'elles étaient ÉCRITES au sas**
  (`npm outdated` aveugle à la racine ; sonde de décor qui interroge l'objet du test). Ce qui
  manque n'est pas la connaissance, c'est le RÉFLEXE — argument pour graduer plus vite : une
  mémoire `feedback_*` est relue à chaque session, le sas ne l'est qu'au START/RESUME.
