---
title: "nodefony-frontend-dev — fiche de skill"
lang: fr
audience: humain
generated: scripts/skills-doc.mjs
source: ".claude/skills/nodefony-frontend-dev/SKILL.md"
---

# `nodefony-frontend-dev`

> Kit de dev FRONT de Nodefony — le full-stack côté client : isomorphisme (`nodefony` partagé front/back), socket client (`RealtimeClient` + hooks `nodefony/react`), builder Vite + HMR (`@nodefony/frontend`, React/Vue/Angular), data-plane BFF (`ApiClient`/`useResource`), RBAC isomorphe, et les règles d'ergonomie / temps réel « calme » / a11y / perf (bundlées offline).

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-frontend-dev**

> [!NOTE]
> Fiche **générée** par `scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

|                          |                                 |
| ------------------------ | ------------------------------- |
| Version                  | `1.0.0`                         |
| Corps                    | 98 lignes                       |
| Description              | 876 / 1024 caractères           |
| Déclencheurs             | 20                              |
| Ressources `references/` | 6 page(s), 14 fichiers au total |
| Scripts                  | 0                               |
| Conformité               | ✅ conforme au standard         |

## Ce qu'il fait

Kit de dev FRONT de Nodefony — le full-stack côté client : isomorphisme (`nodefony` partagé front/back), socket client (`RealtimeClient` + hooks `nodefony/react`), builder Vite + HMR (`@nodefony/frontend`, React/Vue/Angular), data-plane BFF (`ApiClient`/`useResource`), RBAC isomorphe, et les règles d'ergonomie / temps réel « calme » / a11y / perf (bundlées offline). App admin Studio → `nodefony-studio-dev` (qui en dérive) ; scaffold d'un module front → `nodefony-create-frontend-module` ; le back → `nodefony-framework-dev`.

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`dev front nodefony` · `frontend nodefony` · `isomorphisme` · `socket client` · `RealtimeClient` · `useNodefony` · `hooks realtime` · `HMR` · `Vite nodefony` · `@nodefony/frontend` · `ApiClient` · `useResource` · `data plane front` · `BFF` · `RBAC front` · `temps réel ergonomique` · `accessibilité front` · `WCAG` · `perf front` · `front full-stack`

## Ce que contient le corps

- 🔗 Paire POLYMORPHE front ⇄ back (co-évolution OBLIGATOIRE)
- 1. Quand l'utiliser / quand passer la main
- 2. 🚨 RÈGLES ABSOLUES front (non négociables)
- 3. Référence — `references/` (chargé À LA DEMANDE)
- 4. Gates qualité front (AVANT de dire « fait »)
- Réfs

## Références (chargées à la demande)

- `references/build-hmr.md`
- `references/data-bff.md`
- `references/front-quality.md`
- `references/isomorphic.md`
- `references/patterns.md`
- `references/realtime-client.md`
- _(+ 8 fichiers dans des sous-dossiers : specs et normes bundlées hors ligne)_

## Conformité au standard Agent Skills

| Contrôle                                  | État | Mesure |
| ----------------------------------------- | :--: | ------ |
| name conforme et égal au dossier          |  ✅  |        |
| description de 1 à 1024 caractères        |  ✅  | 876    |
| aucun champ hors standard                 |  ✅  |        |
| dossier de ressources nommé `references/` |  ✅  |        |
| corps < 500 lignes (recommandation)       |  ✅  | 98     |

Le détail du standard et la méthode de mesure : [Outillage agents](../outillage-agents.md).
