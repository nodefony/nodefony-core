---
title: "nodefony-session — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-07-23
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-session/SKILL.md"
---

# `nodefony-session`

> Cycle de vie d'une session Nodefony en un seul skill (modes RESUME / START / END / CONSOLIDATE) : reprendre après un /clear, préparer le contexte d'un module, clôturer avec retex + mémoire de reprise.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-session**

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

|                          |                                                    |
| ------------------------ | -------------------------------------------------- |
| Version                  | — (non versionné)                                  |
| Famille                  | Cycle de session                                   |
| Corps                    | 555 lignes                                         |
| Coût d'activation        | ~6 121 tokens (le corps est chargé à l'invocation) |
| Description              | 406 / 1024 caractères                              |
| Déclencheurs             | 8                                                  |
| Ressources `references/` | 0 page(s)                                          |
| Scripts                  | 0                                                  |
| Conformité               | ✅ conforme au standard                            |

## Ce qu'il fait

Cycle de vie d'une session Nodefony en un seul skill (modes RESUME / START / END / CONSOLIDATE) : reprendre après un /clear, préparer le contexte d'un module, clôturer avec retex + mémoire de reprise. Le détail de chaque mode est dans le corps.

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`check-externals`](nodefony-check-externals.md) · [`check-memory-health`](nodefony-check-memory-health.md) · [`inspect`](nodefony-inspect.md) · [`migration-audit`](nodefony-migration-audit.md)

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`reprends` · `on en était où` · `dernière session` · `prépare le contexte` · `session sur <module>` · `fin de session` · `retex` · `consolide les retex`

## Ce que contient le corps

- Routage du mode
- 1. Dernière session enregistrée + kit éventuel
- 2. Phase active + git + 🚨 GARDE-FOU cohérence `_state` ↔ commits
- 3. Mini-état migration (SI la prochaine étape cible une phase P<n>)
- 4. Restituer (≤ 30 lignes)
- Usage
- 1. Résolution dynamique du chemin (PAS de table hardcodée — elle se périme)
- 2. Mode global (sans argument)
- 3. Mode module — doc IA (parallèle)
- 4. Mode module — contexte git (NOUVEAU)
- 5. Mode module — fraîcheur du dist
- 6. Mode module — symboles exportés (`.ai/symbols.json`, O(1))
- 7. Sortie finale (récap synthétique, ≤ 40 lignes)
- Anti-patterns START
- ⚡ END courant = 5 étapes LÉGÈRES (ne PAS faire les stats lourdes)
- Modèle SAS (pourquoi RETEX.md existe)
- Boîte à outils CONSOLIDATE (référence — PAS exécutée au END courant)
- Quand
- 1. Transcript de la session courante
- 2. Comptage tool_use
- 3. Top 10 fichiers lus
- 4. Top 10 commandes Bash (descriptions)
- 5. Commandes Bash répétées (candidats skills)
- 6. Volume sortie tool (proxy coût cache)
- 6b. 💶 Coût RÉEL de la session (€) — tokens du transcript
- 8c. ✨ Résumé « le plus intéressant possible » (à présenter au user)
- 7. Write/Edit (volume produit)
- 8. Détection candidats skill / mémoire
- 8b. Balayage allowlist (OBLIGATOIRE — directive user 2026-05-22)
- 9. Sauvegarde OBLIGATOIRE (auto-save)
- 10. Mémoire de reprise (OBLIGATOIRE — c'est ce que lit le mode RESUME)
- 11. Sauvegarde de la mémoire IA (OBLIGATOIRE — durabilité crash / changement de PC)
- 1. Compter les retex
- 2. Lire les sections clés (jq/awk, pas tout le fichier)
- 3. Patterns récurrents (≥ 3 retex)
- 4. Produire le PLAN D'ACTION
- 5. Exécuter (avec accord user)
- Anti-patterns END / CONSOLIDATE
- Liens

## Conformité au standard Agent Skills

| Contrôle                                  | État | Mesure |
| ----------------------------------------- | :--: | ------ |
| name conforme et égal au dossier          |  ✅  |        |
| description de 1 à 1024 caractères        |  ✅  | 406    |
| aucun champ hors standard                 |  ✅  |        |
| dossier de ressources nommé `references/` |  ✅  |        |
| aucun renvoi vers un skill inexistant     |  ✅  |        |
| corps < 500 lignes (recommandation)       |  ❌  | 555    |

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-session/SKILL.md` — c'est lui qu'on édite, pas cette fiche.
