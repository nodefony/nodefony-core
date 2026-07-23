---
title: "nodefony-roadmap — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-07-23
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-roadmap/SKILL.md"
---

# `nodefony-roadmap`

> Contexte de la **couche IA agentic** de Nodefony (Phase 12) — la seule phase réellement future du framework : modules `@nodefony/{llm,vector,rag,memory,agent,agent-guard}`, invariants de design (générique, injectable, streaming natif, validation humaine, mode souverain, conformité AI Act, WebSocket = transport LLM) et la règle « ne pas démarrer de session IA avant P6 ».

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-roadmap**

> [!TIP]
> 🟢 **Conforme** au standard [Agent Skills](https://agentskills.io/specification.md) — _AAIF / Linux Foundation_.
> ℹ️ **5/5** contrôles normatifs (MUST) · 🛡️ **1/1** projet · 💡 **1/1** recommandé (SHOULD) · 🏷️ `v2.0.0`.

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

| | |
| --- | --- |
| Version | `2.0.0` |
| Famille | Références et livrables |
| Corps | 108 lignes |
| Coût d'activation | ~1 957 tokens (le corps est chargé à l'invocation) |
| Description | 812 / 1024 caractères |
| Déclencheurs | 13 |
| Ressources `references/` | 0 page(s) |
| Scripts | 0 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Contexte de la **couche IA agentic** de Nodefony (Phase 12) — la seule phase réellement future du framework : modules `@nodefony/{llm,vector,rag,memory,agent,agent-guard}`, invariants de design (générique, injectable, streaming natif, validation humaine, mode souverain, conformité AI Act, WebSocket = transport LLM) et la règle « ne pas démarrer de session IA avant P6 ». Les phases 10 (Studio), 13 (Realtime) et 14 (builder Vite) sont LIVRÉES : leurs conventions encore actives sont pointées vers le skill ou la doc qui les porte désormais, pas recopiées.

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`create-frontend-module`](nodefony-create-frontend-module.md) · [`frontend-dev`](nodefony-frontend-dev.md) · [`security-review`](nodefony-security-review.md) · [`studio-dev`](nodefony-studio-dev.md)

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`couche IA` · `agentic` · `@nodefony/agent` · `@nodefony/llm` · `@nodefony/rag` · `agent-guard` · `AI Act` · `mode souverain` · `streaming LLM` · `phase 12` · `interface consommée par un agent` · `convention route /nodefony` · `API admin d'un module`

## Ce que contient le corps

- 1. Phase 12 — Couche IA agentic (⬜ future, après P6)
- 2. Phase 13 — Realtime (🔶 quasi livré) — le reste
- 3. Phases LIVRÉES — leurs conventions vivent ailleurs (ne pas recopier)
- 4. Pattern d'usage
- 5. Anti-patterns

## Conformité au standard Agent Skills

> [!NOTE]
> **Standard [Agent Skills](https://agentskills.io/specification.md)** (AAIF / Linux Foundation).
> **Nature** — ℹ️ _normatif_ : règle **MUST** du standard, un client conforme la refuse ;
> _recommandé_ : **SHOULD** des best-practices ; _projet_ : contrôle propre à Nodefony. La colonne
> _Règle_ cite la source exacte de chaque contrôle.

| Contrôle | Nature | État | Mesure | Règle (source) |
| --- | :---: | :---: | --- | --- |
| name conforme et égal au dossier | ℹ️ normatif | ✅ |  | spec § name : 1-64 car., minuscules alphanumériques + `-`, ni au bord ni consécutifs, = nom du dossier |
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 812 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| corps < 500 lignes | recommandé | ✅ | 108 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-roadmap/SKILL.md` — c'est lui qu'on édite, pas cette fiche.
