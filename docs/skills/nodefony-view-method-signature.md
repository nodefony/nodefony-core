---
title: "nodefony-view-method-signature — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-07-23
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-view-method-signature/SKILL.md"
---

# `nodefony-view-method-signature`

> Affiche la signature d'une méthode (nom, visibilité, static, décorateurs, TSDoc) depuis l'AST extrait dans dist/symbols.json — évite de lire un fichier source de 500 lignes pour l'ordre des args.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-view-method-signature**

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

|                          |                         |
| ------------------------ | ----------------------- |
| Version                  | — (non versionné)       |
| Corps                    | 84 lignes               |
| Description              | 328 / 1024 caractères   |
| Déclencheurs             | 5                       |
| Ressources `references/` | 0 page(s)               |
| Scripts                  | 0                       |
| Conformité               | ✅ conforme au standard |

## Ce qu'il fait

Affiche la signature d'une méthode (nom, visibilité, static, décorateurs, TSDoc) depuis l'AST extrait dans dist/symbols.json — évite de lire un fichier source de 500 lignes pour l'ordre des args.

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`signature de méthode` · `args de fonction` · `comment appeler X` · `quels paramètres prend Y` · `view method signature`

## Ce que contient le corps

- Quand l'utiliser
- Pourquoi ça économise des tokens
- Prérequis
- Commandes
- Fallback si la méthode n'est pas dans l'index
- Quand NE PAS utiliser

## Conformité au standard Agent Skills

| Contrôle                                  | État | Mesure |
| ----------------------------------------- | :--: | ------ |
| name conforme et égal au dossier          |  ✅  |        |
| description de 1 à 1024 caractères        |  ✅  | 328    |
| aucun champ hors standard                 |  ✅  |        |
| dossier de ressources nommé `references/` |  ✅  |        |
| corps < 500 lignes (recommandation)       |  ✅  | 84     |

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-view-method-signature/SKILL.md` — c'est lui qu'on édite, pas cette fiche.
