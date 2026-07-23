---
title: "nodefony-quick-diff — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-07-23
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-quick-diff/SKILL.md"
---

# `nodefony-quick-diff`

> Résume les modifications non commitées sur src/ uniquement (ignore dist/, node_modules, fichiers générés) avant un build ou un test — évite de polluer le contexte avec du compilé.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-quick-diff**

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

|                          |                         |
| ------------------------ | ----------------------- |
| Version                  | — (non versionné)       |
| Corps                    | 63 lignes               |
| Description              | 300 / 1024 caractères   |
| Déclencheurs             | 5                       |
| Ressources `references/` | 0 page(s)               |
| Scripts                  | 0                       |
| Conformité               | ✅ conforme au standard |

## Ce qu'il fait

Résume les modifications non commitées sur src/ uniquement (ignore dist/, node_modules, fichiers générés) avant un build ou un test — évite de polluer le contexte avec du compilé.

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`diff rapide` · `qu'est-ce que j'ai modifié` · `quick diff` · `voir les changements src` · `git diff propre`

## Ce que contient le corps

- Quand l'utiliser
- Pourquoi ça économise des tokens
- Commandes
- Quand NE PAS utiliser

## Conformité au standard Agent Skills

| Contrôle                                  | État | Mesure |
| ----------------------------------------- | :--: | ------ |
| name conforme et égal au dossier          |  ✅  |        |
| description de 1 à 1024 caractères        |  ✅  | 300    |
| aucun champ hors standard                 |  ✅  |        |
| dossier de ressources nommé `references/` |  ✅  |        |
| corps < 500 lignes (recommandation)       |  ✅  | 63     |

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-quick-diff/SKILL.md` — c'est lui qu'on édite, pas cette fiche.
