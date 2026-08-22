---
description: Audit migration Nodefony — tableau seul, auto complet, ou phase par phase (vérifié dans le code)
argument-hint: "[tableau | auto | phase | P<n> | reprendre | help]"
---

Tu exécutes la commande `/migration-audit` avec l'argument : **"$ARGUMENTS"**

Route selon l'argument (insensible à la casse et aux accents). En cas de doute, fais le mapping le plus proche ; si vide → mode `phase`.

## Si `help` / `aide` / `?` → AFFICHE SEULEMENT ce tableau, n'exécute aucun audit

| Argument                                        | Effet                                                                                                                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tableau` (alias `synthèse`, `résumé`, `table`) | **Le tableau SEUL** : barres de progression % par phase + encadré « ➡️ prochaine étape ». Aucun arrêt, aucune correction. Lecture rapide.                                                         |
| `auto`                                          | **Audit complet non-interactif** : vérifie chaque phase dans le code (grep/ls/find), sort toutes les phases d'affilée, puis le récap + les corrections proposées. **Pas** d'attente « suivante ». |
| `phase` (alias vide, défaut)                    | **Revue interactive** phase par phase P0→P16. Tu dis « suivante » entre chaque.                                                                                                                   |
| `P<n>` (ex. `P6`)                               | Audit ciblé d'**une seule** phase.                                                                                                                                                                |
| `reprendre`                                     | Repart où on s'était arrêté (mémoire `project_migration_audit_progress`).                                                                                                                         |
| `help` / `aide`                                 | Affiche cette aide.                                                                                                                                                                               |

## Sinon → lance le skill `nodefony-migration-audit` (`.claude/skills/nodefony-migration-audit/SKILL.md`) dans le mode :

- `tableau` / `synthèse` / `résumé` / `table` → **mode synthèse graphique** (variante A barres + encadré prochaine étape), et STOP (pas de phase-par-phase, pas de correction sauf demande).
- `auto` → **mode auto** : audite toutes les phases dans le code et présente tout d'un coup (toutes les phases enchaînées + récap + corrections proposées), sans pause « suivante ». Demander l'accord avant d'écrire les corrections.
- `P<n>` → **mode phase ciblée** sur la phase indiquée uniquement.
- `reprendre` → **mode reprise**.
- vide / `phase` / `interactif` / tout autre → **mode phase par phase interactif** (présente P0, STOP, attends « suivante »).

> NE PAS poser de question `AskUserQuestion` de cadrage quand un mode est passé ici : exécuter directement le mode demandé.
