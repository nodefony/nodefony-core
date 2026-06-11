---
title: "Couche IA agentique — invitation à co-concevoir"
audience: chercheur / expert IA
status: draft
since: 2026-06-12
---

# Co-concevoir la couche agentique d'un framework souverain

> Document d'invitation à destination d'un profil recherche/mathématiques appliquées IA.
> Le contexte complet du projet est dans le
> [livre blanc](./livre-blanc-couche-ia.md) — ce document-ci répond à trois questions :
> **pourquoi ce terrain est rare, quels problèmes restent ouverts, et quel rôle est proposé.**

## En trois phrases

Nodefony est un framework web fullstack TypeScript open source (licence CeCILL-B),
où HTTP, WebSocket et frontend sont co-citoyens du même runtime. La couche agentique
(agents, RAG, mémoire, garde-fous) y est **à concevoir maintenant** — les interfaces
sont posées, les décisions structurantes restent à prendre. Nous cherchons un
co-concepteur scientifique : quelqu'un qui transforme « ça marche en démo » en
« c'est mesuré, borné et reproductible ».

## Ce qui existe déjà — le terrain d'expérimentation

La quasi-totalité des travaux agentiques actuels s'exécutent dans des notebooks ou
des scripts sans runtime réel : pas de contexte utilisateur, pas de concurrence, pas
de mesure continue. Ici, l'infrastructure qu'exige l'expérimentation sérieuse est
**déjà construite et testée** :

| Brique                                                                                                                | État vérifié                                                            |
| --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Runtime web complet (HTTP/1.1, HTTP/2, WS/WSS)                                                                        | ~1 000 tests unit + 438 intégration, bancs de charge versionnés         |
| **Realtime duplex** (la « Socket Nodefony » : N canaux multiplexés / 1 WS, JSON-RPC 2.0, backplane cluster Redis/IPC) | 167 tests ; sonde native O(1) (fan-out/s, backpressure, slow consumers) |
| Injection de dépendances avec scopes par requête (ALS)                                                                | un agent hérite du contexte utilisateur/session/sécurité, nativement    |
| Observabilité intégrée (Studio : admin web, métriques live, logs structurés corrélés par requête)                     | en service — c'est l'outillage de mesure des futures boucles agentiques |
| Gouvernance pensée d'avance : souveraineté des données, AI Act, RGPD, Zero Trust                                      | cadre posé dans le [livre blanc §3](./livre-blanc-couche-ia.md)         |
| Performance traitée en discipline (A/B systématique, gates mémoire)                                                   | le RPS du cœur a doublé en un mois de chantiers mesurés                 |

Autrement dit : **zéro plomberie à écrire avant de faire de la science.** Le streaming
vers l'humain (human-in-the-loop), la mesure d'une boucle d'agent, l'isolation d'un
contexte : c'est le framework qui les fournit.

## Ce qui reste à inventer — les problèmes ouverts

La couche IA est volontairement embryonnaire (~2 300 lignes d'interfaces et
d'adaptateurs : `llm`, `vector`, `memory`, `rag`, `agent`). Les problèmes suivants
sont ouverts, et aucun ne se résout par « appeler un LLM plus fort » :

1. **Orchestration multi-agents comme problème de décision** — allocation d'un budget
   (tokens, latence, coût) entre sous-agents, arbitrage exploration/exploitation des
   stratégies, critères d'arrêt d'une boucle. Formalisable ; aujourd'hui résolu partout
   à l'heuristique.
2. **Mémoire d'agent** — consolidation, oubli, scoring de pertinence temporelle :
   quelles garanties sur ce qu'un agent retient, et comment évaluer qu'une politique de
   mémoire est meilleure qu'une autre ? (Le projet pratique déjà une mémoire disciplinée
   côté développement — la formaliser côté runtime est un sujet entier.)
3. **Retrieval au-delà du cosinus** — fusion multi-sources, reranking, chunking
   sémantique, et surtout **évaluation de la qualité du retrieval** en continu sur du
   trafic réel (la sonde realtime existe ; le harnais d'évaluation est à concevoir).
4. **Contrôle adaptatif des boucles agentiques** — le framework applique déjà de
   l'AIMD (régulation type TCP) à la cadence realtime ; étendre cette approche
   contrôle/asservissement au triplet coût-latence-qualité d'un agent est une piste
   que personne n'a industrialisée.
5. **Garde-fous exécutables** (`agent-guard`) — exprimer des invariants de sécurité et
   de budget comme des politiques vérifiables à l'exécution, pas comme des prompts.
6. **Évaluation reproductible** — métriques de fiabilité agentique branchées sur
   l'observabilité native : chaque hypothèse testable en conditions réelles, pas sur
   un benchmark figé.

Le différenciateur structurel : ici, **l'agent est un citoyen du runtime** — il a un
contexte requête, une identité, des permissions, un canal duplex vers l'humain et des
sondes. C'est précisément l'environnement qui manque aux travaux « notebook ».

## Le cadre proposé

- **Open source, CeCILL-B** (équivalent BSD français) : publications, réutilisation
  académique et expérimentations libres.
- **Co-conception, pas exécution** : les décisions d'architecture de la couche IA
  (ADR) se prennent à deux ; la partie scientifique (formalisation, métriques,
  politiques) est sous ta responsabilité pleine.
- **Honnêteté sur l'état** : projet porté en solo jusqu'ici — tu n'hérites pas d'une
  équipe, tu **fondes** la partie IA. Le fondateur assure le runtime, l'outillage et
  l'intégration ; la fenêtre agentique (standards MCP, agents outillés, besoin de
  rigueur après l'euphorie) est ouverte maintenant.
- **Premier jalon concret proposé** : choisir UN des six problèmes ci-dessus, le
  formaliser, l'instrumenter via la sonde existante, publier la démarche (article ou
  doc de référence du module) — et qu'il devienne l'ADR fondateur de la couche.

## Pointeurs

- [Livre blanc complet](./livre-blanc-couche-ia.md) — mission, gouvernance, ADR, roadmap
- [Synthèse Anthropic « Building effective agents »](./agents-anthropic-building-effective-agents.md) — base de travail partagée
- Repo : <https://github.com/nodefony/nodefony-core> — Studio : `/nodefony` (admin web auto-documenté)
