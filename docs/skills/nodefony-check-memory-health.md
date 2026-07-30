---
title: "nodefony-check-memory-health — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-07-30
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-check-memory-health/SKILL.md"
---

# `nodefony-check-memory-health`

> Gate mémoire de Nodefony : lance la suite d'intégration de @nodefony/http (1000 GET séquentiels, 100 crashs sync/async, 100 connexions WS), valide les seuils de heap, et surtout dit QUOI FAIRE quand un seuil saute (blocker, ne pas commiter, où chercher la fuite, comment distinguer une vraie fuite d'un flake d'isolation).

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-check-memory-health**

> [!TIP]
> 🟢 **Conforme** au standard [Agent Skills](https://agentskills.io/specification.md) — _Anthropic (standard ouvert)_.
> ℹ️ **5/5** contrôles normatifs (MUST) · 🛡️ **1/1** projet · 💡 **1/1** recommandé (SHOULD).

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

| | |
| --- | --- |
| Version | — (non versionné) |
| Famille | Exécuter, diagnostiquer, mesurer |
| Corps | 83 lignes |
| Coût d'activation | ~1 308 tokens (le corps est chargé à l'invocation) |
| Description | 750 / 1024 caractères |
| Déclencheurs | 11 |
| Ressources `references/` | 0 page(s) |
| Scripts | 0 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Gate mémoire de Nodefony : lance la suite d'intégration de @nodefony/http (1000 GET séquentiels, 100 crashs sync/async, 100 connexions WS), valide les seuils de heap, et surtout dit QUOI FAIRE quand un seuil saute (blocker, ne pas commiter, où chercher la fuite, comment distinguer une vraie fuite d'un flake d'isolation). Le CLAUDE.md donne la commande ; ce skill donne le protocole et l'interprétation — le charger AVANT de lancer la commande, pas après un résultat rouge.

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`start-server`](nodefony-start-server.md)

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

> [!NOTE]
> **Standard [Agent Skills](https://agentskills.io/specification.md)** — Anthropic (standard ouvert).
> **Nature** — ℹ️ _normatif_ : règle **MUST** du standard, un client conforme la refuse ;
> _recommandé_ : **SHOULD** des best-practices ; _projet_ : contrôle propre à Nodefony. La colonne
> _Règle_ cite la source exacte de chaque contrôle.

| Contrôle | Nature | État | Mesure | Règle (source) |
| --- | :---: | :---: | --- | --- |
| name conforme et égal au dossier | ℹ️ normatif | ✅ |  | spec § name : 1-64 car., minuscules alphanumériques + `-`, ni au bord ni consécutifs, = nom du dossier |
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 750 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| corps < 500 lignes | recommandé | ✅ | 83 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-check-memory-health/SKILL.md` — c'est lui qu'on édite, pas cette fiche.
