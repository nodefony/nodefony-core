---
title: "nodefony-get-module-config — fiche de skill"
lang: fr
audience: humain
generated: scripts/skills-doc.mjs
source: ".claude/skills/nodefony-get-module-config/SKILL.md"
---

# `nodefony-get-module-config`

> Affiche la configuration, l'injection (DI services) et le routage d'un module Nodefony sans charger son code métier — valider qu'un service est enregistré, qu'une route est bien déclarée, ou auditer les paramètres d'un module.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-get-module-config**

> [!NOTE]
> Fiche **générée** par `scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

|                          |                         |
| ------------------------ | ----------------------- |
| Version                  | — (non versionné)       |
| Corps                    | 62 lignes               |
| Description              | 392 / 1024 caractères   |
| Déclencheurs             | 5                       |
| Ressources `references/` | 0 page(s)               |
| Scripts                  | 0                       |
| Conformité               | ✅ conforme au standard |

## Ce qu'il fait

Affiche la configuration, l'injection (DI services) et le routage d'un module Nodefony sans charger son code métier — valider qu'un service est enregistré, qu'une route est bien déclarée, ou auditer les paramètres d'un module.

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`config du module X` · `comment est configuré X` · `vérifier la déclaration de service` · `voir les routes d'un module` · `configuration nodefony module`

## Ce que contient le corps

- Quand l'utiliser
- Pourquoi ça économise des tokens
- Commandes à exécuter
- Quand NE PAS utiliser

## Conformité au standard Agent Skills

| Contrôle                                  | État | Mesure |
| ----------------------------------------- | :--: | ------ |
| name conforme et égal au dossier          |  ✅  |        |
| description de 1 à 1024 caractères        |  ✅  | 392    |
| aucun champ hors standard                 |  ✅  |        |
| dossier de ressources nommé `references/` |  ✅  |        |
| corps < 500 lignes (recommandation)       |  ✅  | 62     |

Le détail du standard et la méthode de mesure : [Outillage agents](../outillage-agents.md).
