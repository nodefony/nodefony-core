---
title: "nodefony-roadmap — fiche de skill"
lang: fr
audience: humain
generated: scripts/skills-doc.mjs
source: ".claude/skills/nodefony-roadmap/SKILL.md"
---

# `nodefony-roadmap`

> Charge le contexte roadmap des phases Studio/IA/Realtime/Frontend de Nodefony — Phase 10 (Studio admin web — LIVRÉ, conventions à respecter), 12 (couche IA agentic — SEULE vraie phase future), 13 (Realtime + Redis cluster + client navigateur — quasi livré, restes identifiés), 14 (frontend builder Vite — LIVRÉ).

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-roadmap**

> [!NOTE]
> Fiche **générée** par `scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

|                          |                         |
| ------------------------ | ----------------------- |
| Version                  | — (non versionné)       |
| Corps                    | 161 lignes              |
| Description              | 614 / 1024 caractères   |
| Déclencheurs             | 13                      |
| Ressources `references/` | 0 page(s)               |
| Scripts                  | 0                       |
| Conformité               | ✅ conforme au standard |

## Ce qu'il fait

Charge le contexte roadmap des phases Studio/IA/Realtime/Frontend de Nodefony — Phase 10 (Studio admin web — LIVRÉ, conventions à respecter), 12 (couche IA agentic — SEULE vraie phase future), 13 (Realtime + Redis cluster + client navigateur — quasi livré, restes identifiés), 14 (frontend builder Vite — LIVRÉ). À utiliser quand un module doit prévoir une API admin, un design IA-compatible ou un endpoint Studio.

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`Studio` · `Phase 10` · `Phase 12` · `Phase 13` · `Phase 14` · `couche IA` · `agentic` · `@nodefony/agent` · `@nodefony/realtime` · `@nodefony/client` · `API admin` · `route /nodefony` · `AI Act`

## Ce que contient le corps

- Phase 10 — Module `@nodefony/studio` — ✅ LIVRÉ (conventions toujours actives)
- Phase 12 — Couche IA agentic — ⬜ SEULE VRAIE PHASE FUTURE (après P6)
- Phase 13 — Realtime + Redis cluster + Client navigateur — 🔶 QUASI LIVRÉ
- Phase 14 — `@nodefony/frontend` (builder Vite) — ✅ LIVRÉ
- Pattern d'usage
- Anti-patterns à éviter

## Conformité au standard Agent Skills

| Contrôle                                  | État | Mesure |
| ----------------------------------------- | :--: | ------ |
| name conforme et égal au dossier          |  ✅  |        |
| description de 1 à 1024 caractères        |  ✅  | 614    |
| aucun champ hors standard                 |  ✅  |        |
| dossier de ressources nommé `references/` |  ✅  |        |
| corps < 500 lignes (recommandation)       |  ✅  | 161    |

Le détail du standard et la méthode de mesure : [Outillage agents](../outillage-agents.md).
