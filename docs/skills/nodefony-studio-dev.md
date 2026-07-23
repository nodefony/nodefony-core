---
title: "nodefony-studio-dev — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-07-23
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-studio-dev/SKILL.md"
---

# `nodefony-studio-dev`

> Kit de dev du frontend Studio de Nodefony (@nodefony/studio, React 19) — l'app admin interne du framework.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-studio-dev**

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

|                          |                                                    |
| ------------------------ | -------------------------------------------------- |
| Version                  | `2.0.0`                                            |
| Famille                  | Développer le framework                            |
| Corps                    | 143 lignes                                         |
| Coût d'activation        | ~3 531 tokens (le corps est chargé à l'invocation) |
| Description              | 935 / 1024 caractères                              |
| Déclencheurs             | 14                                                 |
| Ressources `references/` | 6 page(s)                                          |
| Scripts                  | 0                                                  |
| Conformité               | ✅ conforme au standard                            |

## Ce qu'il fait

Kit de dev du frontend Studio de Nodefony (@nodefony/studio, React 19) — l'app admin interne du framework. Construire un écran (page / dashboard / panneau / onglet) vite et bien en réutilisant le UI kit (PageHeader, PageLayout, DataGrid, DataState, StatCard, KpiCard, JsonViewer, MiniChart, DocHint), le hook useResource, les stores MobX et les hooks temps réel nodefony/react. Donne la recette (route + lazy + navConfig + fallback deep-link + data plane), des squelettes copier-coller, le Jumeau Vivant (Twin), la debug bar, le back-end Studio (controller + data plane + realtime), et les règles qualité (a11y, sécu, perf, gate tsc). DÉRIVE de nodefony-frontend-dev (mécanismes front généraux).

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`create-frontend-module`](nodefony-create-frontend-module.md) · [`documentation`](nodefony-documentation.md) · [`framework-dev`](nodefony-framework-dev.md) · [`frontend-dev`](nodefony-frontend-dev.md) · [`frontend-verify`](nodefony-frontend-verify.md) · [`rfc`](nodefony-rfc.md) · [`security-review`](nodefony-security-review.md) · [`start-server`](nodefony-start-server.md)

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`dev studio` · `page studio` · `dashboard studio` · `écran studio` · `panneau studio` · `composant studio` · `page /nodefony` · `comment coder dans studio` · `Twin` · `jumeau vivant` · `debug bar` · `debugbar` · `barre de debug` · `WDT`

## Ce que contient le corps

- 🔗 Paire POLYMORPHE front ⇄ back (co-évolution OBLIGATOIRE)
- 1. Quand l'utiliser / quand passer la main
- 2. 🚨 RÈGLES ABSOLUES Studio (non négociables — priorité MAX)
- 3. Cartographie — Studio (qui vit où)
- 4. Référence — `references/` (chargé À LA DEMANDE)
- 5. Gates qualité (AVANT commit — l'ordre compte)
- Réfs (CLAUDE.md/MEMORY.md — détails)

## Références (chargées à la demande)

- `references/backend-studio.md`
- `references/debugbar.md`
- `references/gotchas-studio.md`
- `references/realtime-studio.md`
- `references/twin.md`
- `references/ui-kit.md`

## Conformité au standard Agent Skills

| Contrôle                                  | État | Mesure |
| ----------------------------------------- | :--: | ------ |
| name conforme et égal au dossier          |  ✅  |        |
| description de 1 à 1024 caractères        |  ✅  | 935    |
| aucun champ hors standard                 |  ✅  |        |
| dossier de ressources nommé `references/` |  ✅  |        |
| corps < 500 lignes (recommandation)       |  ✅  | 143    |

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-studio-dev/SKILL.md` — c'est lui qu'on édite, pas cette fiche.
