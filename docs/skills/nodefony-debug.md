---
title: "nodefony-debug — fiche de skill"
lang: fr
audience: humain
generated: scripts/skills-doc.mjs
source: ".claude/skills/nodefony-debug/SKILL.md"
---

# `nodefony-debug`

> Kit debug runtime de Nodefony — à charger quand quelque chose vient de casser, pas pour concevoir.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-debug**

> [!NOTE]
> Fiche **générée** par `scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

|                          |                         |
| ------------------------ | ----------------------- |
| Version                  | `1.1.0`                 |
| Corps                    | 194 lignes              |
| Description              | 993 / 1024 caractères   |
| Déclencheurs             | 18                      |
| Ressources `references/` | 0 page(s)               |
| Scripts                  | 0                       |
| Conformité               | ✅ conforme au standard |

## Ce qu'il fait

Kit debug runtime de Nodefony — à charger quand quelque chose vient de casser, pas pour concevoir. Codifie les recettes de diagnostic éprouvées : flake mémoire (l'isolation dit la vérité), vert en isolation et rouge en suite (ressource partagée, pas régression), qualifier une régression par une baseline stashée, échec d'intégration dont la première hypothèse est un serveur éteint, dépendance implicite à `delete`, faux ENOSPC du harnais. Délègue à `nodefony-tail-error-logs`, `nodefony-check-memory-health`, `nodefony-load-test`, `nodefony-frontend-verify` ; la doctrine préventive vit dans `nodefony-framework-dev`.

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`ça crash` · `stack trace` · `unhandledRejection` · `fuite mémoire` · `memory leak` · `race condition` · `reproduire` · `ne démarre plus` · `test rouge inexpliqué` · `test flake` · `vert isolé rouge en suite` · `ce test passe seul mais pas en suite` · `diagnostic régression` · `baseline stash` · `est-ce ma régression ?` · `404 inexpliqué` · `ECONNREFUSED tests` · `ENOSPC`

## Ce que contient le corps

- 1. Quand m'utiliser
- 2. Quand passer la main (anti-overlap)
- 3. Les 5 recettes RETEX (session 2026-05-27)
- 4. Orchestration des micro-skills (raccourcis)
- 5. Doctrine "memory may lie" (CLAUDE.md global)
- 6. Références (anti-duplication, vérité unique)
- 7. Conventions du skill
- Changelog

## Conformité au standard Agent Skills

| Contrôle                                  | État | Mesure |
| ----------------------------------------- | :--: | ------ |
| name conforme et égal au dossier          |  ✅  |        |
| description de 1 à 1024 caractères        |  ✅  | 993    |
| aucun champ hors standard                 |  ✅  |        |
| dossier de ressources nommé `references/` |  ✅  |        |
| corps < 500 lignes (recommandation)       |  ✅  | 194    |

Le détail du standard et la méthode de mesure : [Outillage agents](../outillage-agents.md).
