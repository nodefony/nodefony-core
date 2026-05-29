---
adr: 4
title: Inférence LLM — backend supervisé, jamais embarquée dans le cœur
date: 2026-05-29
status: accepted
deciders: [Christophe CAMENSULI]
tags: [ia, llm, architecture, cloud-native, perf]
---

# ADR-0004 — Inférence LLM : backend supervisé, jamais embarquée dans le cœur

## Statut

Accepté (2026-05-29).

## Contexte

Question récurrente sur la couche IA : Ollama fait tourner un serveur d'inférence
local et offre une CLI/API pour interpeller le modèle. Pourquoi Nodefony ne ferait-il
pas tourner lui-même un modèle local choisi, dans son propre process, sans dépendre
d'un binaire externe ?

C'est **techniquement possible** : `node-llama-cpp` (bindings N-API vers `llama.cpp`)
permet de charger un GGUF et d'inférer dans le process Node ; `transformers.js`
(ONNX Runtime) couvre les petits modèles (embeddings, classification). Ollama lui-même
n'est qu'un emballage de `llama.cpp` + gestion de modèles + serveur HTTP.

La vraie question n'est donc pas _« peut-on ? »_ mais _« doit-on, pour un framework
serveur cloud-native soumis à une règle perf/mémoire absolue ? »_.

## Décision

**L'inférence LLM n'est JAMAIS exécutée dans le process du cœur Nodefony.** Le cœur
**orchestre** un backend d'inférence externe via une interface, il ne l'exécute pas.

1. **Interface `ILLMProvider` / `IInferenceBackend`** : un seul contrat, N back-ends
   interchangeables par configuration — Ollama (local/souverain), vLLM ou
   `llama.cpp server` (prod GPU), API distante (Anthropic / OpenAI / Mistral).
2. **Lifecycle supervisé**, sur le **patron `ViteSupervisor` déjà éprouvé** (frontend) :
   un `OllamaSupervisor` (ou équivalent) peut détecter/spawn le backend en sous-process,
   `pull` le modèle si absent, attendre sa disponibilité, le tuer proprement
   (detached + group-kill). Du point de vue du développeur : **1 ligne de config**
   (`llm: { backend: "ollama", model: "mistral" }`), zéro commande manuelle — l'UX
   « tout-en-un » sans réimplémenter l'inférence.
3. **Exception étroite** : inférence in-process tolérée **uniquement** pour des charges
   légères et bornées (embeddings, classification via `transformers.js`/ONNX) lorsque
   le coût event-loop est démontré négligeable. Jamais pour un LLM génératif lourd.

## Conséquences

**Pourquoi (les raisons qui rendent la décision non négociable)** :

- **Plans de scaling disjoints.** Le serveur HTTP/WS est léger et scale horizontalement
  (1 pod = 1 process, k8s HPA × N). L'inférence est lourde, GPU-bound, et ne se duplique
  pas (la VRAM coûte cher). Embarquer le modèle = dupliquer 4–30 GB de poids à chaque
  réplique du serveur. Les deux plans doivent scaler **séparément**.
- **Event-loop préservée.** Une inférence sature CPU/GPU pendant des secondes ;
  mélangée au pipeline request mono-thread de Node, elle bloque toutes les autres
  requêtes → p99 dégradée. Contraire à la règle perf/mémoire absolue du projet.
- **Séparation des responsabilités.** Faire tourner un modèle (quantization, VRAM,
  KV-cache, batching, runtimes ML mouvants) est un métier à plein temps. Le réimplémenter
  = refaire Ollama/vLLM/`llama.cpp` dans un framework applicatif : dette énorme, hors
  scope. Node ne fait de toute façon que piloter du natif (C++/CUDA/Metal).
- **Souveraineté préservée sans couplage.** Le mode air-gap reste atteint via un backend
  local (Ollama + pgvector), mais par configuration d'un backend interchangeable — pas
  par un couplage rigide du cœur à un moteur d'inférence donné.

**Coût accepté** : une dépendance de déploiement externe (le backend d'inférence) à
provisionner/superviser. Mitigé par la supervision automatique (patron `ViteSupervisor`).

## Formule

> Nodefony **orchestre** l'inférence (lifecycle, pluggabilité, gouvernance), il ne
> l'**exécute** pas — comme un orchestrateur ne calcule pas : il place et supervise.

## Liens

- Patron de supervision : `@nodefony/frontend` → `ViteSupervisor`.
- Modèle de process cloud-native : ADR / mémoire « 1 pod = 1 process », dépréciation PM2.
- Pitch couche IA : [`docs/ia/pitch-couche-ia.md`](../ia/pitch-couche-ia.md).
