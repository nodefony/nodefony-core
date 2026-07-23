---
title: "nodefony-migration-audit — fiche de skill"
lang: fr
audience: humain
generated: scripts/skills-doc.mjs
source: ".claude/skills/nodefony-migration-audit/SKILL.md"
---

# `nodefony-migration-audit`

> Audit phase-par-phase de l'état RÉEL de la migration Nodefony — confronte MIGRATION_STATUS.md au code (grep/ls/find), une phase à la fois, corrige les écarts.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-migration-audit**

> [!NOTE]
> Fiche **générée** par `scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

|                          |                         |
| ------------------------ | ----------------------- |
| Version                  | — (non versionné)       |
| Corps                    | 357 lignes              |
| Description              | 675 / 1024 caractères   |
| Déclencheurs             | 11                      |
| Ressources `references/` | 0 page(s)               |
| Scripts                  | 0                       |
| Conformité               | ✅ conforme au standard |

## Ce qu'il fait

Audit phase-par-phase de l'état RÉEL de la migration Nodefony — confronte MIGRATION_STATUS.md au code (grep/ls/find), une phase à la fois, corrige les écarts. Inclut un mode synthèse graphique (barres de progression par phase) ET un mode VÉRITÉ exhaustif : croise code + mémoire IA + docs + MD modules → fichier d'audit persistant + assainissement de la FORME du dashboard (anti-obésité).

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`audit migration` · `état des lieux migration` · `où en est la migration` · `avancement migration` · `vérifier MIGRATION_STATUS` · `revue phase par phase` · `mets à jour le migration` · `gros point migration` · `fichier vérité` · `audit vérité` · `assainir le dashboard migration`

## Ce que contient le corps

- Principe (ce qui marche — retour user 2026-05-20)
- Workflow
- Interactivité & UX (pour que le user COMPRENNE, pas juste lise)
- Recettes de vérification (code, pas fichier)
- Pièges connus (issus des audits 2026-05-20 + 2026-06-05)
- Mémoire liée

## Conformité au standard Agent Skills

| Contrôle                                  | État | Mesure |
| ----------------------------------------- | :--: | ------ |
| name conforme et égal au dossier          |  ✅  |        |
| description de 1 à 1024 caractères        |  ✅  | 675    |
| aucun champ hors standard                 |  ✅  |        |
| dossier de ressources nommé `references/` |  ✅  |        |
| corps < 500 lignes (recommandation)       |  ✅  | 357    |

Le détail du standard et la méthode de mesure : [Outillage agents](../outillage-agents.md).
