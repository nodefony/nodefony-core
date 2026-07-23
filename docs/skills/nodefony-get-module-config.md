---
title: "nodefony-get-module-config — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-07-23
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-get-module-config/SKILL.md"
---

# `nodefony-get-module-config`

> INSPECTE un module Nodefony DÉJÀ EXISTANT — sa configuration, ses services injectés et ses routes déclarées — sans charger son code métier ni démarrer de serveur.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-get-module-config**

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

|                          |                                                  |
| ------------------------ | ------------------------------------------------ |
| Version                  | — (non versionné)                                |
| Famille                  | Inspecter et auditer                             |
| Corps                    | 62 lignes                                        |
| Coût d'activation        | ~680 tokens (le corps est chargé à l'invocation) |
| Description              | 615 / 1024 caractères                            |
| Déclencheurs             | 8                                                |
| Ressources `references/` | 0 page(s)                                        |
| Scripts                  | 0                                                |
| Conformité               | ✅ conforme au standard                          |

## Ce qu'il fait

INSPECTE un module Nodefony DÉJÀ EXISTANT — sa configuration, ses services injectés et ses routes déclarées — sans charger son code métier ni démarrer de serveur. Pour valider qu'un service est bien enregistré, qu'une route est bien déclarée, ou auditer les paramètres effectifs. Ne crée rien : scaffolder un module neuf → `nodefony-create-module`.

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`create-module`](nodefony-create-module.md)

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`config du module X` · `comment est configuré X` · `montre la config de ce module` · `quelles routes expose ce module` · `voir les routes d'un module` · `ce service est-il enregistré ?` · `vérifier la déclaration de service` · `inspecter un module existant`

## Ce que contient le corps

- Quand l'utiliser
- Pourquoi ça économise des tokens
- Commandes à exécuter
- Quand NE PAS utiliser

## Conformité au standard Agent Skills

| Contrôle                                  | État | Mesure |
| ----------------------------------------- | :--: | ------ |
| name conforme et égal au dossier          |  ✅  |        |
| description de 1 à 1024 caractères        |  ✅  | 615    |
| aucun champ hors standard                 |  ✅  |        |
| dossier de ressources nommé `references/` |  ✅  |        |
| corps < 500 lignes (recommandation)       |  ✅  | 62     |

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-get-module-config/SKILL.md` — c'est lui qu'on édite, pas cette fiche.
