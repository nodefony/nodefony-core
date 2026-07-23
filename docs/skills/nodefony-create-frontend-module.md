---
title: "nodefony-create-frontend-module — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-07-23
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-create-frontend-module/SKILL.md"
---

# `nodefony-create-frontend-module`

> Scaffold d'un module à frontend SPA (React 19, Vue 3, Angular 21) servi par @nodefony/frontend via Vite, DANS LE REPO FRAMEWORK (src/modules/).

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-create-frontend-module**

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

|                          |                         |
| ------------------------ | ----------------------- |
| Version                  | — (non versionné)       |
| Corps                    | 247 lignes              |
| Description              | 642 / 1024 caractères   |
| Déclencheurs             | 7                       |
| Ressources `references/` | 1 page(s)               |
| Scripts                  | 0                       |
| Conformité               | ✅ conforme au standard |

## Ce qu'il fait

Scaffold d'un module à frontend SPA (React 19, Vue 3, Angular 21) servi par @nodefony/frontend via Vite, DANS LE REPO FRAMEWORK (src/modules/). Dans une APPLICATION, le scaffold est une commande — `nodefony create module <nom> --frontend <fw>` — et ce skill se contente d'y renvoyer : il ne réimplémente pas le CLI. Wrapper de nodefony-create-module : délègue le squelette puis enrichit le spécifique frontend (controller HTML+CSP, registerEntry, entry+App du framework, peerDeps).

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`crée un module frontend` · `module react` · `module vue` · `module angular` · `scaffold module avec front` · `nouveau front nodefony` · `module vite`

## Ce que contient le corps

- 🚦 DEUX CAS — ne pas confondre (lire AVANT toute génération)
- Quand l'utiliser
- Phase 0 — Choisir le framework + variables
- Table de paramètres par framework (LE cœur)
- Pré-requis
- Phase 1 — Déléguer à `nodefony-create-module`
- Phase 2 — Enrichissements (POST-`nodefony-create-module`)
- Phase 3 — Build + validation
- Phase 4 (OPT-IN) — Module DISTRIBUÉ npm : UI pré-buildée (molette `ui`)
- Checklist finale
- Pièges communs (les 3 frameworks)
- Skills & références liés

## Références (chargées à la demande)

- `references/frameworks.md`

## Conformité au standard Agent Skills

| Contrôle                                  | État | Mesure |
| ----------------------------------------- | :--: | ------ |
| name conforme et égal au dossier          |  ✅  |        |
| description de 1 à 1024 caractères        |  ✅  | 642    |
| aucun champ hors standard                 |  ✅  |        |
| dossier de ressources nommé `references/` |  ✅  |        |
| corps < 500 lignes (recommandation)       |  ✅  | 247    |

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-create-frontend-module/SKILL.md` — c'est lui qu'on édite, pas cette fiche.
