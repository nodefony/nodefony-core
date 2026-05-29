---
title: Résumé — Anthropic « Building Effective Agents »
audience: archi
status: matière brute pour décision archi agentic Nodefony (Phase 12)
source: https://www.anthropic.com/research/building-effective-agents
date: 2026-05-27
---

# Anthropic — Building Effective Agents (résumé)

> **À quoi sert ce document** : matière de référence pour trancher l'archi agentic Nodefony
> (Phase 12 : `@nodefony/agent`, `workflow`, `mcp`, etc.). Lu _avant_ de figer la table des modules.

---

## 1. La distinction fondamentale : workflows ≠ agents

| Catégorie    | Définition Anthropic                                                                     | Contrôle du flux |
| ------------ | ---------------------------------------------------------------------------------------- | ---------------- |
| **Workflow** | Systèmes où les LLM et les outils sont orchestrés via des **chemins de code prédéfinis** | Le code décide   |
| **Agent**    | Systèmes où le LLM **dirige dynamiquement son propre processus** et l'usage des outils   | Le LLM décide    |

→ Le mot « agent » couvre N choses différentes. Anthropic tranche : **agent = système autonome où la LLM contrôle la boucle**. Le reste = workflows.

### Conséquence majeure pour le design

> _« You should consider adding complexity only when it demonstrably improves outcomes. »_
>
> _« Agentic systems often trade latency and cost for better task performance — consider when this tradeoff makes sense. »_

**Hiérarchie de complexité recommandée** :

1. **Optimiser un single LLM call** (avec retrieval + in-context examples)
2. **Workflow** (pattern composé, déterministe)
3. **Agent** (autonome, en dernier recours)

---

## 2. Les 5 patterns de workflow

### Pattern 1 — Prompt Chaining

**Quoi** : Décomposer la tâche en étapes séquentielles, chaque LLM call traite la sortie de la précédente, avec **portes de validation programmatiques** entre les étapes.

**Quand utiliser** : _« ideal for situations where the task can be easily and cleanly decomposed into fixed subtasks »_ — quand le découpage est stable et connu à l'avance.

**Quand NE PAS utiliser** : quand le découpage dépend du contexte ou n'est pas clair → bascule en agent.

**Exemples** : générer un copy marketing → traduire ; outliner un document → rédiger.

---

### Pattern 2 — Routing

**Quoi** : Classifier l'input, puis le router vers un **handler spécialisé** (autre prompt, autre modèle).

**Quand utiliser** : _« complex tasks where there are distinct categories that are better handled separately »_ — quand les sous-tâches ont des profils très différents.

**Quand NE PAS utiliser** : catégories qui se chevauchent ; classification non fiable.

**Exemples** : queries customer support (général / refund / technique) ; routing vers modèle moins cher (Haiku vs Sonnet) selon complexité.

---

### Pattern 3 — Parallelization (2 variantes)

**Quoi** :

- **Sectioning** : découper la tâche en **sous-tâches indépendantes** lancées en parallèle.
- **Voting** : lancer **N fois la même tâche** pour avoir N perspectives, puis agréger.

**Quand utiliser** : _« effective when the divided subtasks can be parallelized for speed, or when multiple perspectives or attempts are needed for higher confidence results »_.

**Quand NE PAS utiliser** : sous-tâches interdépendantes ; latence n'est pas un enjeu et coût compte plus.

**Exemples** :

- _Sectioning_ : un modèle screen le contenu pendant qu'un autre génère la réponse (guardrails) ; évaluation auto multi-dimensions.
- _Voting_ : revue de vulnérabilités code ; modération de contenu.

---

### Pattern 4 — Orchestrator-Workers

**Quoi** : Un LLM **central** décompose dynamiquement la tâche, délègue à des **workers** LLM, synthétise les résultats.

**Quand utiliser** : _« well-suited for complex tasks where you can't predict the subtasks needed »_. La **différence avec parallelization** = ici les sous-tâches **ne sont PAS pré-définies**, elles sont décidées par l'orchestrateur en fonction de l'input.

**Quand NE PAS utiliser** : si les sous-tâches sont prévisibles et fixes → prompt chaining ou parallelization suffit.

**Exemples** : refactor multi-fichier en code ; collecte d'information multi-source + analyse.

---

### Pattern 5 — Evaluator-Optimizer

**Quoi** : Un LLM **génère** la réponse, un autre LLM **évalue + donne feedback**, boucle jusqu'à un critère de qualité.

**Quand utiliser** : _« particularly effective when we have clear evaluation criteria, and when iterative refinement provides measurable value »_. Conditions : (1) le feedback humain améliore les sorties LLM, (2) la LLM peut elle-même fournir un feedback utile.

**Quand NE PAS utiliser** : 1 itération suffit ; critères d'évaluation flous ; pas d'amélioration mesurable.

**Exemples** : traduction littéraire raffinée ; recherche complexe nécessitant plusieurs rounds.

---

## 3. Le pattern « Agent autonome »

**Quoi** : Un LLM opère en **boucle autonome**, utilise des outils en fonction du feedback de l'environnement, jusqu'à atteindre l'objectif (ou critère d'arrêt). Démarrage par commande utilisateur ; planification autonome ; revient demander clarification si bloqué ; exécution jusqu'à completion.

**Quand utiliser** : _« open-ended problems where it's difficult or impossible to predict the required number of steps, and where you can't hardcode a fixed path »_. **Requiert confiance dans le model decision-making.**

**Quand NE PAS utiliser** :

- Quand les étapes sont fixes et prévisibles
- Quand coût compte plus que l'autonomie
- En environnement non sécurisé / non sandboxé

**Pré-requis pour réussir** :

- _« Ground truth from the environment at each step »_ (tool results, exécution code)
- **Checkpoints humains**
- **Conditions d'arrêt** explicites

**Exemples** : résolution d'issues code (SWE-bench) ; computer use automation.

---

## 4. Design des outils (ACI = Agent-Computer Interface) — CRITIQUE

> _« Invest in agent-computer interfaces (ACI) as much as you would human-computer interfaces. »_

### Choix du format

- _« Give the model enough tokens to 'think' before it writes itself into a corner. »_
- _« Keep the format close to what the model has seen naturally occurring in text on the internet. »_
- Éviter le formatting overhead : compter des lignes, échapper du code, etc.

### Documentation des outils

- _« Put yourself in the model's shoes. Is it obvious how to use this tool? »_
- Inclure : exemples d'usage, edge cases, format d'input, frontières claires entre outils.
- _« Think of this as writing a great docstring for a junior developer. »_
- **Poka-yoke** : contraindre les arguments pour rendre les erreurs impossibles (ex : path absolu obligatoire au lieu de relatif).

### Test des outils

- _« Run many example inputs in our workbench to see what mistakes the model makes, and iterate. »_
- Exemple Anthropic : `relative filepaths` causaient des erreurs → switch vers `absolute paths` → _« the model used this method flawlessly »_.

---

## 5. Mises en garde explicites contre l'over-engineering

### Méfiance vis-à-vis des frameworks

> _« Many frameworks create extra layers of abstraction that can obscure the underlying prompts and responses, making them harder to debug. They can also make it tempting to add complexity when a simpler setup would suffice. »_

**Recommandation Anthropic** :

> _« Developers start by using LLM APIs directly: many patterns can be implemented in a few lines of code. »_

Si on utilise un framework (Claude Agent SDK, Strands, Rivet, Vellum) : _« ensure you understand the underlying code »_.

### Risques opérationnels des agents

- Coût plus élevé
- **Erreurs qui se composent** dans la boucle
- → _« We recommend extensive testing in sandboxed environments, along with the appropriate guardrails. »_

### 3 principes pour la prod

1. **Simplicité** : _« Maintain simplicity in your agent's design. »_
2. **Transparence** : _« Prioritize transparency by explicitly showing the agent's planning steps. »_
3. **Excellence de l'ACI** : _« Carefully craft your agent-computer interface through thorough tool documentation and testing. »_

---

## 6. Synthèse pour le design d'un framework agentic Node.js

Pour designer **`@nodefony/agent` et la pile agentic** :

| Principe Anthropic                        | Implication pour Nodefony                                                                                        |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Workflows ≠ agents (5 patterns + 1 agent) | Prévoir **les 5 patterns de workflow** comme primitives, pas juste l'agent autonome                              |
| Frameworks sont sources de confusion      | **Composable primitives** (chains, routers, parallel, orchestrator) plutôt que framework rigide                  |
| ACI critique                              | **`@Tool` decorator + Zod + docstring forte** ; tool testing first-class                                         |
| Transparence                              | Tracing des calls, intermediate states observables (lien avec `@nodefony/realtime` WS)                           |
| Hiérarchie de complexité                  | API publique : **mode simple = single LLM call optimisé** ; modes avancés = workflow patterns ; agent en dernier |
| Direct API access                         | Toujours possible d'utiliser `@nodefony/llm` directement, sans framework agentic                                 |

---

## 7. Trous à clarifier avant de figer l'archi Nodefony

Ce document décrit ce qu'Anthropic dit. Ce qu'il ne dit PAS et qu'il faut décider pour Nodefony :

- **Persistence d'état** (resume après crash) — Anthropic n'aborde pas le state durable
- **Multi-agent collaboratif** (CrewAI, AutoGen patterns) — Anthropic reste sur orchestrator-worker, pas peer-to-peer
- **Évaluation / regression testing** — sujet effleuré, pas développé
- **Cost management / token budget** — pas couvert
- **Human-in-the-loop** détaillé (notifications WS, pause-resume) — différenciateur Nodefony potentiel
- **MCP** — Anthropic l'évoque comme standard d'outils, ne tranche pas son rôle dans un framework agentic complet

---

## 8. À retenir en 5 lignes

1. **Workflows d'abord, agent en dernier.** L'agent autonome est l'option lourde.
2. **5 patterns de workflow** : chaining, routing, parallelization (sectioning/voting), orchestrator-workers, evaluator-optimizer.
3. **Toolset = ACI = priorité de design.** Description claire, format simple, validation stricte, poka-yoke.
4. **Frameworks = source d'opacité.** Préférer des primitives composables qu'on contrôle.
5. **Transparence + simplicité + tests** = les 3 axes de la prod.
