---
date: 2026-09-07
retex_couverts: 95 (2026-08-24 → 2026-09-07)
sas_avant: 2902 lignes · 41 thèmes · ~475 frictions
sas_apres: 1346 lignes
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

## Ce qui reste dans le sas — 10 thèmes encore au-dessus du seuil

`🚪 porte` et `🪤 garde` étant sortis, restent notamment : **la doc qui affirme une automatisation
inexistante (14)**, **un identifiant dans la mauvaise langue (14)**, **un test qui ne parle jamais
au serveur (13)**, **mon propre `--dry-run` mentait (12)**, **une garde ne couvre jamais une autre
question (10)**. Les graduer demande le même travail : lire le thème, trouver sa maison, verser,
couper. À faire au prochain CONSOLIDATE — ou dès que l'un d'eux mord de nouveau.

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

- Les **10 thèmes restants au-dessus du seuil** ne sont pas gradués (rendement décroissant sur une
  seule passe ; le sas est repassé sous la barre du lisible, ce qui était l'urgence).
- Les **frictions obsolètes** (corrigées depuis dans le code ou un skill) n'ont pas été balayées :
  le nettoyage du §4 du mode CONSOLIDATE reste à faire.
- Aucune **statistique de coût** (tool_use, €) — `references/consolidate-toolkit.md` non déroulé,
  la valeur du jour étant dans la maintenance du sas.
