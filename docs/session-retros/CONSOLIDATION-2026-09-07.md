---
date: 2026-09-07
retex_couverts: 95 (2026-08-24 → 2026-09-07)
sas_avant: 2902 lignes · 41 thèmes · ~475 frictions
sas_apres: 527 lignes · 17 thèmes vivants · 31 frictions · 0 au-dessus du seuil
---

# Consolidation retex — 2026-09-07 — les 95 retex depuis le 24 août

## Le constat qui gouverne tout : la graduation ne s'est pas faite

Entre le CONSOLIDATE du 24 août et aujourd'hui : **95 retex écrits, 2 mémoires `feedback_*`
créées.** Le sas `RETEX.md` a donc absorbé quatorze jours de frictions sans jamais se vider — il
pesait **2902 lignes** pour 41 thèmes et ~475 frictions, alors que sa raison d'être est de tenir en
**un écran** et d'être relu à chaque RESUME.

Un sas de 2902 lignes n'est plus un sas : c'est une archive que personne n'ouvre. La leçon qu'il
contient cesse d'atteindre qui que ce soit, exactement comme un gate que rien ne lance.

## Ce qui a été gradué — 7 thèmes, 340 frictions

| Thème (frictions)                            | Destination                                                                | Nature                                    |
| -------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------- |
| 🧰 Un GATE que personne ne lance (47)        | **`feedback_gate_must_run`** ⭐ neuve                                      | 5 façons dont un contrôle cesse de garder |
| 🟢 Un test vert qui n'a rien mesuré (61)     | `feedback_prove_the_target_not_the_verdict`                                | § « Récidive massive »                    |
| 🧪 La transformation a-t-elle EU LIEU (57)   | `feedback_prove_on_received_artifact` + `feedback_shell_false_diagnostics` | § « Six pièges de plus »                  |
| 🩺 Corriger le cas, pas la famille (28)      | **`feedback_fix_the_family_not_the_instance`** ⭐ neuve                    | l'instance vs la règle                    |
| 🎯 Une ancre plausible et fausse (27)        | **`feedback_anchor_expires_silently`** ⭐ neuve                            | ligne · nom · chiffre · renvoi · preuve   |
| 🚪 Une porte a plusieurs entrées (21)        | `feedback_single_source_rule`                                              | le défaut vit dans la COMPARAISON         |
| 🪤 Une garde qui empêche son propre but (20) | `feedback_gate_must_bite`                                                  | § « Le RETOURNEMENT »                     |

Chaque thème laisse dans `RETEX.md` une ligne de renvoi vers sa mémoire — règle anti-doublon : une
leçon est dans le sas **ou** dans une mémoire, jamais dans les deux.

## Les trois mémoires neuves, en une phrase

- **`feedback_gate_must_run`** — un contrôle excellent qui ne mesure rien : personne ne le lance ·
  son verdict est avalé · son périmètre est amputé · il est rouge et personne ne le lit · sa règle
  vit hors des fichiers relus. Pendant de `feedback_gate_must_bite` : un gate doit **mordre ET
  tourner**.
- **`feedback_fix_the_family_not_the_instance`** — le remède traite le cas vu et laisse la famille
  vivante ; il est parfois lui-même exposé au défaut qu'il corrige.
- **`feedback_anchor_expires_silently`** — ligne, nom, **chiffre**, renvoi et preuve se périment
  sans rien dire ; une ancre plausible et fausse a l'air d'une preuve.

## Seconde passe — les 15 thèmes restants, gradués aussi

Le sas est **vidé de tout ce qui était mûr** : de 2902 lignes il passe à **527**, 31 frictions
vivantes réparties sur 17 thèmes, et `npm run retex:seuil` rend « aucun thème au-dessus du seuil ».

**Une seule mémoire neuve sur les quinze** — c'est le résultat le plus utile de la passe :

| Thème (frictions)                                                                               | Destination                                            |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 🪟 un message d'erreur qui n'énonce QU'UNE cause (9)                                            | **`feedback_error_message_names_all_causes`** ⭐ neuve |
| 🧭 identifiant dans la mauvaise langue — le RENOMMAGE (14)                                      | `feedback_code_rewrite_mechanical_traps`               |
| 🧭 la doc affirme une automatisation inexistante (14) + 🚧 exiger sans regarder qui produit (7) | `feedback_capability_unreachable_is_absent`            |
| 🧪 un test qui ne parle jamais au serveur (13) + 🏭 produit ≠ config (9)                        | `feedback_prove_on_received_artifact`                  |
| 🎭 mon propre `--dry-run` mentait (12)                                                          | `feedback_suspect_instrument_and_own_diff`             |
| 🧭 une garde ne couvre jamais une autre question (10)                                           | `feedback_prove_the_target_not_the_verdict`            |
| 🎯 un port qui répond ne dit pas à qui (9) + 🎪 décor partagé (9)                               | `feedback_stale_decor_poisons_verdicts`                |
| 🤝 un sous-agent renonce quand chercher devient pénible (9)                                     | `feedback_delegation_balance`                          |
| 📖 une doc qui enseigne un geste dangereux (9)                                                  | `feedback_agent_example_over_prose`                    |
| 🤖 un agent lit l'interdit et le transgresse (6)                                                | `feedback_destructive_needs_identity_scope`            |
| 🔇 ce qu'on coupe pour mesurer (6)                                                              | `feedback_shell_false_diagnostics`                     |
| ⏳ un symptôme qui ressemble à un délai (5)                                                     | `feedback_test_no_fixed_delay`                         |

**Total des deux passes : 22 thèmes gradués, ~512 frictions, 4 mémoires neuves.** Dix-huit
versements sur vingt-deux ont trouvé une maison existante — la leçon du CONSOLIDATE du 24 août
(« ne pas ouvrir un thème neuf par réflexe ») se vérifie à 82 %.

## Plan d'action

1. **🔴 Rendre la graduation OBSERVABLE, sinon elle ne se fera pas davantage.** C'est la
   recommandation principale, et elle est la conclusion de sa propre leçon : _une règle en prose
   n'est appliquée que si quelqu'un y pense au bon moment_, et personne n'y pense en clôturant une
   session. Le seuil « ~5 frictions par thème » vit aujourd'hui dans le texte du skill
   `nodefony-session` — donc nulle part. Un automate de dix lignes (compter les `- [` par `## ` de
   `RETEX.md`, lister les thèmes au-dessus du seuil) affiché **au END** suffirait à ce que le sas
   ne regonfle jamais à 2900 lignes. → `feedback_gate_must_run`
2. **Archivage fait** : les 50 retex d'août déplacés vers `archive/` (`git mv`, l'historique suit) ;
   43 retex de septembre restent à la racine. Snapshot du sas avant coupe :
   `archive/RETEX-snapshot-2026-09-07.md`.
3. **Ne pas créer de thème neuf par réflexe.** Le reproche du CONSOLIDATE du 24 août tient
   toujours : 41 thèmes pour 475 frictions, dont beaucoup se recouvrent. Sur les sept traités,
   **quatre** avaient déjà leur maison — seuls trois méritaient une mémoire propre. Chercher la
   maison AVANT d'ouvrir un titre.

## Ce que cette consolidation n'a pas fait

- **Rien ne reste au-dessus du seuil** — les 15 thèmes annoncés en attente à la première passe ont
  été gradués dans la seconde, à la demande du mainteneur.
- Les **frictions obsolètes** (corrigées depuis dans le code ou un skill) n'ont pas été balayées :
  le nettoyage du §4 du mode CONSOLIDATE reste à faire.
- Aucune **statistique de coût** (tool_use, €) — `references/consolidate-toolkit.md` non déroulé,
  la valeur du jour étant dans la maintenance du sas.
