---
title: "nodefony-frontend-verify — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-07-23
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-frontend-verify/SKILL.md"
---

# `nodefony-frontend-verify`

> Vérifie une modif frontend Studio (ou tout module Vite) SANS navigateur headless (règle projet) : curl du transform Vite d'un fichier .tsx pour valider la résolution + la transpilation, purge du prébundle Vite (`node_modules/.vite`) quand un import/subpath change, rappel hard-reload navigateur (cache React).

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-frontend-verify**

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

|                          |                         |
| ------------------------ | ----------------------- |
| Version                  | `1.0.0`                 |
| Corps                    | 135 lignes              |
| Description              | 776 / 1024 caractères   |
| Déclencheurs             | 10                      |
| Ressources `references/` | 0 page(s)               |
| Scripts                  | 0                       |
| Conformité               | ✅ conforme au standard |

## Ce qu'il fait

Vérifie une modif frontend Studio (ou tout module Vite) SANS navigateur headless (règle projet) : curl du transform Vite d'un fichier .tsx pour valider la résolution + la transpilation, purge du prébundle Vite (`node_modules/.vite`) quand un import/subpath change, rappel hard-reload navigateur (cache React). Délègue l'analyse runtime à `nodefony-tail-error-logs` et la gate types à `npm run typecheck` du module — esbuild attrape la syntaxe, PAS les types. NE remplace PAS `nodefony-start-server` (qui démarre/arrête) ni la confirmation visuelle user.

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`vérifie le front` · `curl Vite` · `transform Vite` · `vérifie le bundle` · `prébundle Vite périmé` · `purge .vite` · `ma modif front passe ?` · `hard-reload nécessaire ?` · `frontend verify` · `verify front Studio`

## Ce que contient le corps

- Quand l'utiliser (vs `nodefony-start-server`)
- 1. Curl du transform Vite (la recette #1)
- 2. Purge du prébundle Vite (`node_modules/.vite`)
- 3. Hard-reload navigateur (cache React)
- Limites — ce que ce skill NE VÉRIFIE PAS
- Réfs
- Changelog (SemVer)

## Conformité au standard Agent Skills

| Contrôle                                  | État | Mesure |
| ----------------------------------------- | :--: | ------ |
| name conforme et égal au dossier          |  ✅  |        |
| description de 1 à 1024 caractères        |  ✅  | 776    |
| aucun champ hors standard                 |  ✅  |        |
| dossier de ressources nommé `references/` |  ✅  |        |
| corps < 500 lignes (recommandation)       |  ✅  | 135    |

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-frontend-verify/SKILL.md` — c'est lui qu'on édite, pas cette fiche.
