---
module: global
topic: ia-index
audience: [human, ai]
tags: [ia, agentic, llm, mcp, rag, vision, index]
status: stable
last-updated: 2026-05-29
---

# Documentation IA — Nodefony

> **Source unique de la vision et du travail IA du framework.** Toute la connaissance IA
> (vision, décisions, retex, références) vit dans ce dossier — rien ailleurs. Les mémoires IA
> de session ne font que **pointer** ici.

## Index

| Document                                                                                         | Rôle                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`livre-blanc-couche-ia.md`](livre-blanc-couche-ia.md)                                           | **Source unique de la vision IA** : mission, cas d'usage, deux niveaux, capacités, invariants, gouvernance/AI Act, décisions (ADR-0004), état réel, feuille de route (standards agentiques, Studio auto-documenté, observabilité→insights, génération de modules, agent vocal, auto-développement). |
| `livre-blanc-couche-ia.html`                                                                     | Rendu imprimable du livre blanc (Cmd+P → PDF).                                                                                                                                                                                                                                                      |
| [`agents-anthropic-building-effective-agents.md`](agents-anthropic-building-effective-agents.md) | Résumé du document Anthropic _Building Effective Agents_ : workflows ≠ agents, 5 patterns de workflow, agent autonome, conception des outils (ACI), mises en garde anti-over-engineering. Socle des choix agentiques.                                                                               |
| [`retex-poc-mcp-vs-skill.md`](retex-poc-mcp-vs-skill.md)                                         | RETEX du POC MCP (branche `poc/mcp-spontaneous-test`, supprimée) : Claude n'appelle pas spontanément un tool MCP face à un skill auto-déclenché. Décision + portée + annexe archi.                                                                                                                  |

## Décision liée (registre ADR)

- [`../adr/0004-inference-llm-backend-supervise.md`](../adr/0004-inference-llm-backend-supervise.md) — inférence LLM orchestrée (backend supervisé), jamais embarquée dans le cœur.

## Règle

La vision IA **repose uniquement** sur ce dossier (décision 2026-05-29). Les anciens docs
racine (`VISION_IA.md`, `PLAN_AGENTIC.md`, `IA_STATUS.md`, `CLAUDE_IA.md`, `VISION.md`,
`CONTINUE_WITH_CLAUDE_CODE.md`) ont été consolidés ici puis supprimés. Toute nouvelle vision,
décision ou retex IA s'écrit ici — et la mémoire IA s'y indexe, sans dupliquer.
