---
description: Audit de la migration Nodefony (phase-par-phase ou synthèse), vérifié dans le code
argument-hint: "[synthèse | reprendre | P<n> | <vide=phase par phase>]"
---

Lance le skill `migration-audit` (`.claude/skills/migration-audit/SKILL.md`).

Mode demandé (optionnel) : $ARGUMENTS

- vide → revue phase par phase (P0→P16, « suivante »)
- `synthèse` / `résumé` → barres de progression + encadré « prochaine étape »
- `P<n>` (ex. `P6`) → audit ciblé d'une phase
- `reprendre` → repartir de `project_migration_audit_progress`
