---
title: "nodefony-check-memory-health — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-07-23
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-check-memory-health/SKILL.md"
---

# `nodefony-check-memory-health`

> Gate mémoire de Nodefony : lance la suite d'intégration de @nodefony/http (1000 GET séquentiels, 100 crashs sync/async, 100 connexions WS), valide les seuils de heap, et surtout dit QUOI FAIRE quand un seuil saute (blocker, ne pas commiter, où chercher la fuite, comment distinguer une vraie fuite d'un flake d'isolation).

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-check-memory-health**

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

|                          |                         |
| ------------------------ | ----------------------- |
| Version                  | — (non versionné)       |
| Corps                    | 83 lignes               |
| Description              | 750 / 1024 caractères   |
| Déclencheurs             | 11                      |
| Ressources `references/` | 0 page(s)               |
| Scripts                  | 0                       |
| Conformité               | ✅ conforme au standard |

## Ce qu'il fait

Gate mémoire de Nodefony : lance la suite d'intégration de @nodefony/http (1000 GET séquentiels, 100 crashs sync/async, 100 connexions WS), valide les seuils de heap, et surtout dit QUOI FAIRE quand un seuil saute (blocker, ne pas commiter, où chercher la fuite, comment distinguer une vraie fuite d'un flake d'isolation). Le CLAUDE.md donne la commande ; ce skill donne le protocole et l'interprétation — le charger AVANT de lancer la commande, pas après un résultat rouge.

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`vérifier la mémoire` · `memory leak` · `test mémoire` · `heap delta` · `fuite mémoire` · `gate mémoire` · `j'ai touché au pipeline` · `j'ai modifié le Kernel ou le Container` · `je vais commiter une modif http/framework` · `le seuil mémoire a sauté` · `heap qui monte`

## Ce que contient le corps

- Quand l'utiliser
- Pourquoi ça économise des tokens
- Prérequis
- Commande à exécuter
- Grille de seuils (règle dure Nodefony — `CLAUDE.md`)
- Rapport ultra-court
- Quand NE PAS utiliser

## Conformité au standard Agent Skills

| Contrôle                                  | État | Mesure |
| ----------------------------------------- | :--: | ------ |
| name conforme et égal au dossier          |  ✅  |        |
| description de 1 à 1024 caractères        |  ✅  | 750    |
| aucun champ hors standard                 |  ✅  |        |
| dossier de ressources nommé `references/` |  ✅  |        |
| corps < 500 lignes (recommandation)       |  ✅  | 83     |

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-check-memory-health/SKILL.md` — c'est lui qu'on édite, pas cette fiche.
