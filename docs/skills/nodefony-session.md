---
title: "nodefony-session — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-07-23
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-session/SKILL.md"
---

# `nodefony-session`

> Cycle de vie d'une session Nodefony en un seul skill (modes RESUME / START / END / CONSOLIDATE) : reprendre après un /clear, préparer le contexte d'un module, clôturer avec retex + mémoire de reprise.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-session**

> [!TIP]
> 🟢 **Conforme** au standard [Agent Skills](https://agentskills.io/specification.md) — _AAIF / Linux Foundation_.
> ℹ️ **5/5** contrôles normatifs (MUST) · 🛡️ **1/1** projet · 💡 **1/1** recommandé (SHOULD).

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

| | |
| --- | --- |
| Version | — (non versionné) |
| Famille | Cycle de session |
| Corps | 434 lignes |
| Coût d'activation | ~4 637 tokens (le corps est chargé à l'invocation) |
| Description | 406 / 1024 caractères |
| Déclencheurs | 8 |
| Ressources `references/` | 1 page(s) |
| Scripts | 0 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Cycle de vie d'une session Nodefony en un seul skill (modes RESUME / START / END / CONSOLIDATE) : reprendre après un /clear, préparer le contexte d'un module, clôturer avec retex + mémoire de reprise. Le détail de chaque mode est dans le corps.

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`check-externals`](nodefony-check-externals.md) · [`check-memory-health`](nodefony-check-memory-health.md) · [`inspect`](nodefony-inspect.md) · [`migration-audit`](nodefony-migration-audit.md)

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`reprends` · `on en était où` · `dernière session` · `prépare le contexte` · `session sur <module>` · `fin de session` · `retex` · `consolide les retex`

## Ce que contient le corps

- Routage du mode
- 1. Dernière session enregistrée + kit éventuel
- 2. Phase active + git + 🚨 GARDE-FOU cohérence `_state` ↔ commits
- 3. Mini-état migration (SI la prochaine étape cible une phase P<n>)
- 4. Restituer (≤ 30 lignes)
- Usage
- 1. Résolution dynamique du chemin (PAS de table hardcodée — elle se périme)
- 2. Mode global (sans argument)
- 3. Mode module — doc IA (parallèle)
- 4. Mode module — contexte git (NOUVEAU)
- 5. Mode module — fraîcheur du dist
- 6. Mode module — symboles exportés (`.ai/symbols.json`, O(1))
- 7. Sortie finale (récap synthétique, ≤ 40 lignes)
- Anti-patterns START
- ⚡ END courant = 5 étapes LÉGÈRES (ne PAS faire les stats lourdes)
- Modèle SAS (pourquoi RETEX.md existe)
- Boîte à outils CONSOLIDATE — déportée
- 9. Sauvegarde OBLIGATOIRE (auto-save)
- 10. Mémoire de reprise (OBLIGATOIRE — c'est ce que lit le mode RESUME)
- 11. Sauvegarde de la mémoire IA (OBLIGATOIRE — durabilité crash / changement de PC)
- 1. Compter les retex
- 2. Lire les sections clés (jq/awk, pas tout le fichier)
- 3. Patterns récurrents (≥ 3 retex)
- 4. Produire le PLAN D'ACTION
- 5. Exécuter (avec accord user)
- Anti-patterns END / CONSOLIDATE
- Liens

## Références (chargées à la demande)

Détail déporté hors du corps — chargé seulement quand la tâche l'exige (divulgation progressive).

| Fichier | Ce qu'il couvre | Lignes |
| --- | --- | --: |
| `references/consolidate-toolkit.md` | Boîte à outils CONSOLIDATE — minage du transcript | 136 |


## Conformité au standard Agent Skills

> [!NOTE]
> **Standard [Agent Skills](https://agentskills.io/specification.md)** (AAIF / Linux Foundation).
> **Nature** — ℹ️ _normatif_ : règle **MUST** du standard, un client conforme la refuse ;
> _recommandé_ : **SHOULD** des best-practices ; _projet_ : contrôle propre à Nodefony. La colonne
> _Règle_ cite la source exacte de chaque contrôle.

| Contrôle | Nature | État | Mesure | Règle (source) |
| --- | :---: | :---: | --- | --- |
| name conforme et égal au dossier | ℹ️ normatif | ✅ |  | spec § name : 1-64 car., minuscules alphanumériques + `-`, ni au bord ni consécutifs, = nom du dossier |
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 406 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| corps < 500 lignes | recommandé | ✅ | 434 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-session/SKILL.md` — c'est lui qu'on édite, pas cette fiche.
