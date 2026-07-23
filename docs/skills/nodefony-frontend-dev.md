---
title: "nodefony-frontend-dev — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-07-23
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-frontend-dev/SKILL.md"
---

# `nodefony-frontend-dev`

> Kit de dev FRONT de Nodefony — le full-stack côté client : isomorphisme (`nodefony` partagé front/back), socket client (`RealtimeClient`, hooks React), builder Vite + HMR (`@nodefony/frontend`, React/Vue/Angular), data-plane BFF (`ApiClient`/`useResource`), RBAC isomorphe, ergonomie / temps réel « calme » / a11y / perf (bundlés offline), et **vérification d'une modif front sans navigateur** (transform Vite en `curl`, purge du prébundle, rechargement forcé) — la règle projet interdit le navigateur headless.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-frontend-dev**

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

|                          |                                                    |
| ------------------------ | -------------------------------------------------- |
| Version                  | `1.0.0`                                            |
| Famille                  | Développer le framework                            |
| Corps                    | 100 lignes                                         |
| Coût d'activation        | ~2 549 tokens (le corps est chargé à l'invocation) |
| Description              | 1003 / 1024 caractères                             |
| Déclencheurs             | 20                                                 |
| Ressources `references/` | 6 page(s), 14 fichiers au total                    |
| Scripts                  | 0                                                  |
| Conformité               | ✅ conforme au standard                            |

## Ce qu'il fait

Kit de dev FRONT de Nodefony — le full-stack côté client : isomorphisme (`nodefony` partagé front/back), socket client (`RealtimeClient`, hooks React), builder Vite + HMR (`@nodefony/frontend`, React/Vue/Angular), data-plane BFF (`ApiClient`/`useResource`), RBAC isomorphe, ergonomie / temps réel « calme » / a11y / perf (bundlés offline), et **vérification d'une modif front sans navigateur** (transform Vite en `curl`, purge du prébundle, rechargement forcé) — la règle projet interdit le navigateur headless. App admin Studio → `nodefony-studio-dev` ; scaffold d'un module front → `nodefony-create-frontend-module` ; le back → `nodefony-framework-dev`.

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`create-frontend-module`](nodefony-create-frontend-module.md) · [`framework-dev`](nodefony-framework-dev.md) · [`rfc`](nodefony-rfc.md) · [`security-review`](nodefony-security-review.md) · [`studio-dev`](nodefony-studio-dev.md) · [`ts-docs`](nodefony-ts-docs.md)

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`dev front nodefony` · `isomorphisme` · `socket client` · `RealtimeClient` · `useNodefony` · `hooks realtime` · `HMR` · `Vite nodefony` · `ApiClient` · `useResource` · `data plane front` · `BFF` · `RBAC front` · `accessibilité front` · `WCAG` · `perf front` · `vérifie le front` · `ma modif front passe ?` · `transform Vite` · `prébundle Vite périmé`

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
| description de 1 à 1024 caractères        |  ✅  | 1003   |
| aucun champ hors standard                 |  ✅  |        |
| dossier de ressources nommé `references/` |  ✅  |        |
| aucun renvoi vers un skill inexistant     |  ✅  |        |
| corps < 500 lignes (recommandation)       |  ✅  | 100    |

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-frontend-dev/SKILL.md` — c'est lui qu'on édite, pas cette fiche.
