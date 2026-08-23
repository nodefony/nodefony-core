# Consolidation retex — 2026-08-24 — retex du 2026-08-20 au 2026-08-23e (19 sessions)

Quatre jours, **19 sessions**, et un sas qui a plus que doublé : `RETEX.md` était passé de 493
lignes (sortie du CONSOLIDATE précédent) à **1 258 lignes — 81 thèmes, 194 frictions**.

## Ce qui a été fait

| Mesure                 | Avant | Après |
| ---------------------- | ----: | ----: |
| Lignes de `RETEX.md`   | 1 258 |   487 |
| Thèmes                 |    81 |    34 |
| Frictions              |   194 |    60 |
| Retex bruts à archiver |    19 |     0 |

- **22 thèmes gradués** (82 frictions) → **1 mémoire neuve** + **9 mémoires enrichies**.
- **25 thèmes coupés par ancienneté** (48 frictions) : toutes leurs frictions étaient antérieures
  au CONSOLIDATE du 08-20 et n'ont jamais été reconduites depuis — règle posée ce jour-là,
  appliquée pour la première fois.
- Snapshot avant coupe : `archive/RETEX-snapshot-2026-08-24.md` (rien n'est perdu).
- 19 retex bruts déplacés vers `archive/` par `git mv` (historique conservé).

## Graduations

| Thème (frictions)                                        | Destination                                      |
| -------------------------------------------------------- | ------------------------------------------------ |
| 🔌🧪🎭 Le DÉCOR d'un banc : une variable, pas un dû (19) | `feedback_stale_decor_poisons_verdicts` (§ banc) |
| 🎯🔍⚖️🗣️ La sonde mesure-t-elle la CHOSE ? (12)          | `feedback_prove_the_target_not_the_verdict` (§)  |
| 🏭🖨️ Le GABARIT n'est pas son RENDU (9)                  | `feedback_dogfood_distributed_templates` (§)     |
| 🚦🐚🧾 Le code de sortie LU ≠ celui MESURÉ (7)           | `feedback_shell_false_diagnostics` (§)           |
| 🎯🧰 La commande du DÉPÔT est l'autorité (7)             | **`feedback_repo_command_is_authority`** (neuve) |
| 🧪 Un test neuf peut FIGER sans discriminer (6)          | `feedback_gate_must_bite` (§ figer)              |
| 📌 Un chiffre publié sans son COMMIT (6)                 | `feedback_measure_method` (§ 5)                  |
| 🩹🔁🧭 Corriger l'OCCURRENCE, pas le MOTIF (6)           | `feedback_single_source_rule` (§)                |
| 🔎 Une ABSENCE de trace n'est pas une preuve (5)         | `feedback_source_over_memory` (§)                |
| 🔗 « Valider la chaîne » = l'EXÉCUTER (5)                | `feedback_prove_on_received_artifact` (§)        |

**Une seule mémoire neuve sur dix graduations** — c'est le résultat recherché : neuf thèmes sur dix
avaient déjà une maison, et y verser la matière vaut mieux que multiplier les fichiers que personne
ne relie.

## Ce que cette consolidation apprend sur le CYCLE

- 🔴 **Le seuil par THÈME ne se déclenche pas quand les thèmes se FRAGMENTENT.** 55 thèmes neufs en
  quatre jours : chaque session END écrit un titre neuf plutôt que de verser sous un titre
  existant. Conséquence mesurée ici : quatre familles évidentes (le décor d'un banc, la sonde qui
  mesure autre chose, le code de sortie, le gabarit vs son rendu) étaient **éclatées en 3 ou 4
  thèmes de 2-4 frictions chacun** — donc aucun n'atteignait 5, donc aucun n'a été gradué à temps,
  alors que réunis ils pesaient 19, 12, 9 et 7. **Le seuil est bon ; c'est le RANGEMENT qui manque.**
  ➡️ Correctif appliqué au mode END du skill `nodefony-session` : avant d'écrire un bullet, LISTER
  les titres de thèmes existants (`grep '^## ' RETEX.md`) et verser dessous ; n'ouvrir un thème que
  si aucun ne convient.
- **La coupe par ancienneté était le vrai levier de taille** : 25 thèmes / 48 frictions retirés sans
  aucune perte de valeur — ils avaient eu deux fenêtres pour se confirmer et ne l'ont pas été.
- **Le rythme a changé d'échelle** : 19 sessions en 4 jours contre ~20 sessions par consolidation
  auparavant. À ce rythme, consolider **tous les 10 retex** (et non 20) garde le sas sous un écran.
