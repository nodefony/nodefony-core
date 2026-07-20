---
title: "Nodefony — Une couche IA agentique souveraine, par construction"
type: livre blanc
version: 0.1 (brouillon)
audience: ingénieurs et chercheurs en IA, décideurs techniques
auteur: Christophe Camensuli
date: 2026-05-29
licence: CeCILL-B (open source)
---

# Livre blanc — Nodefony : une couche IA agentique souveraine, par construction

---

## Résumé exécutif

Mettre une IA générative en production suppose aujourd'hui d'assembler à la main trois
mondes qui ne se parlent pas : un **serveur** web (NestJS, Express), une **bibliothèque
IA** (LangChain, LlamaIndex) et une couche de **gouvernance** bricolée par-dessus. Chaque
couture est une dette technique et un risque de conformité.

Nodefony pose le principe inverse : **serveur, orchestration IA et gouvernance des
données sont le même framework**, dans le même runtime. Le différenciateur tient en trois
propriétés natives : HTTP et WebSocket co-citoyens (transport idéal du streaming LLM),
un conteneur d'injection de dépendances (orchestration des agents comme services
testables), et une **observabilité IA-first** où l'agent consomme les mêmes sondes que le
tableau de bord d'administration.

Ce document décrit une **architecture cible** et les **décisions structurantes** déjà
prises. Il est honnête sur l'état réel : **le socle (serveur, transport, injection,
sécurité, observabilité) est opérationnel et testé ; la couche IA proprement dite est à
l'état d'esquisses.** C'est une vision d'architecture posée sur des fondations mûres — pas
un état produit. La conformité (souveraineté, AI Act, RGPD) y est traitée **par
construction**, non en option.

---

## 1. Contexte et problème

Un pipeline RAG qui fonctionne dans un notebook ne fait pas un produit. Le porter en
production exige trois couches que les écosystèmes actuels fournissent séparément :

1. **Un serveur** capable de streamer la réponse du modèle en temps réel — sans quoi
   l'utilisateur attend plusieurs secondes devant un écran figé.
2. **Une orchestration** des sous-agents, des outils (_tools_) et des appels de fonction,
   qui soit testable, injectable et observable.
3. **Une gouvernance** : d'où vient cette réponse ? quelles sources ? quelles données
   personnelles ont transité ? qui valide l'action que l'agent veut exécuter ? le modèle
   tourne-t-il en interne ou chez un cloud étranger ?

Ces trois couches proviennent d'écosystèmes distincts assemblés manuellement. **Chaque
point de jonction est une dette et un angle mort de conformité.** Nodefony les traite
comme un seul framework.

### 1.1 Mission

Nodefony vise à devenir une **plateforme Node.js générique pour construire des agents IA
métier**. Le framework fournit des briques réutilisables (accès modèle, retrieval,
mémoire, orchestration, gouvernance) ; le développeur apporte la logique métier. Le
framework prend en charge la gouvernance, la sécurité, le monitoring et la conformité.
**Aucun composant du cœur ne connaît le métier** : c'est un invariant.

### 1.2 Cas d'usage cibles

Tous reposent sur les mêmes briques — seuls le corpus et les règles métier changent :

| Domaine                     | Usage type                                          |
| --------------------------- | --------------------------------------------------- |
| Juridique (avocat, notaire) | Retrieval sur corpus juridique + agents spécialisés |
| Gestion de patrimoine       | Retrieval sur rapports financiers + simulateurs     |
| Support client              | Retrieval documentaire + agent conversationnel      |
| Médical                     | **Mode souverain obligatoire** (données de santé)   |
| Défense                     | **Air-gap + modèle local + audit signé**            |

### 1.3 Deux niveaux

Nodefony s'articule en deux niveaux superposés :

- **Niveau 1 — framework web temps réel** _(migré, opérationnel)_ : Kernel, conteneur DI,
  _module system_, serveurs HTTP/HTTPS/HTTP2/WS/WSS natifs Node.js, router unifié HTTP+WS
  via un contexte unique, sécurité, sessions, adaptateurs ORM.
- **Niveau 2 — plateforme agentique** _(à construire)_ : la couche IA décrite dans ce
  document, qui s'appuie intégralement sur le niveau 1.

La migration TypeScript du niveau 1 n'est pas une fin en soi : c'est la **fondation typée**
(interfaces génériques `I*`, DI typé, streaming WS natif, modules publiables
indépendamment via Rollup `preserveModules`) sans laquelle le niveau 2 ne pourrait être
générique et réutilisable. Chaque interface du niveau 1 est pensée pour être étendue par
l'agentique (un contexte qui sait s'il est WebSocket, une session qui portera la mémoire
d'agent, un `@Module` qui vaut pour le HTTP comme pour un agent).

---

## 2. Architecture de la couche IA

### 2.1 Des capacités, pas une liste de modules figée

La couche IA se raisonne en **capacités** (le _quoi_), pas en découpage figé. La première
version du plan IA (un module par couche, dont un module « RAG » monolithique) date de
l'ère pré-agentique et est explicitement remise à plat. La pensée agentique moderne change
la donne : le **retrieval n'est pas nécessairement un module** — c'est souvent un **outil
(_tool_) que l'agent appelle dynamiquement** (il décide quand chercher, quoi chercher, s'il
relance une recherche), et non un pipeline « chunk → embed → top-K → prompt » figé
d'avance. Le découpage de ces capacités en modules est une **décision d'architecture
ouverte** (cf. §4.2).

Capacités de la couche IA (le _quoi_, stable) :

```
┌─────────────────────────────────────────────────────────────┐
│  CAPACITÉS IA (le QUOI — stable)        Découpage en modules  │
│                                          = QUESTION OUVERTE   │
│                                                               │
│  • Orchestration         agent dirige son process, tools,    │
│                          sous-agents, streaming, abort        │
│  • Gouvernance ★         zones, PII, audit signé, circuit     │
│                          breaker, validation humaine          │
│  • Mémoire               court / long / épisodique            │
│  • Grounding/retrieval   ← tool(s) appelé(s) par l'agent,     │
│                            PAS forcément un module « RAG »    │
│  • Index vectoriel       pgvector / Qdrant / Chroma           │
│  • Accès modèle          1 interface, N back-ends             │
│                          (Anthropic, OpenAI, Mistral, Ollama) │
├═════════════════════════════════════════════════════════════┤
│  CŒUR NODEFONY (le COMMENT — déjà migré, opérationnel)        │
│  • HTTP + WebSocket co-citoyens  → transport du streaming LLM │
│  • DI Container (@injectable/@inject) → orchestration         │
│  • ALS requestId → corrélation log ↔ requête ↔ appel modèle   │
│  • syslog transports → audit IA tracé                         │
└─────────────────────────────────────────────────────────────┘
```

Seul le bloc « cœur » du bas existe aujourd'hui ; tous les étages IA au-dessus sont à
construire (cf. §5).

### 2.2 Invariants de conception

- **Streaming natif** : `AsyncGenerator` côté serveur, WebSocket Nodefony côté client. Le
  WebSocket n'est pas un module additionnel : c'est un citoyen de première classe du même
  contexte _controller_ que le HTTP. Le streaming LLM est le cas d'usage **idéal** de
  cette dualité — c'est ce qui a motivé le design dès l'origine.
- **Tout injectable** : un agent, un _retriever_, un fournisseur de modèle sont des
  services du conteneur DI. Donc mockables, testables, interchangeables. L'orchestration
  de sous-agents devient un graphe de services, pas un enchevêtrement de _callbacks_.
- **Mode souverain de bout en bout** : la pile doit pouvoir tourner **en local, air-gap**
  (Ollama + pgvector, zéro appel sortant). La souveraineté est une contrainte de
  conception, pas un mode de déploiement particulier.
- **Gestion mémoire stricte** : tout service IA expose un `shutdown()` qui libère ses
  ressources (annulation des `AbortController`, `releaseLock()` des _readers_,
  `clearTimeout`, fermeture des connexions). Le streaming et les appels longue durée sont
  les premiers candidats aux fuites — le cycle de vie est donc explicite, pas implicite.
  C'est la déclinaison IA de la règle perf/mémoire du framework.
- **Validation par contrat** : toute entrée externe et tout _tool_ sont validés par schéma
  (Zod) — bornes strictes, listes blanches, pas de chaîne libre. La même discipline qui
  sécurise les contrôleurs HTTP s'applique aux _tools_ d'agent.

### 2.3 Le différenciateur

> NestJS fait le serveur. LangChain fait l'IA. Aucun ne fait la gouvernance nativement.
> Nodefony fait les trois — dans le même runtime, avec introspection de son propre modèle.

Ce que ce positionnement rend possible nativement :

- **Observabilité IA-first.** Les sondes du framework (débit, latence, requêtes lentes
  avec SQL **paramétré et expurgé**, graphe d'entités, _event-loop_) sortent en JSON
  structuré sur un _data plane_ unique. Un agent IA consomme **exactement les mêmes
  points d'accès** que le tableau de bord d'administration. Il peut donc lire l'état du
  système, corréler, expliquer en langage naturel et suggérer des actions (créer un
  index, réécrire une requête) — parce qu'il dispose à la fois du SQL et du schéma. Le
  framework devient capable de se documenter et de se diagnostiquer lui-même.
- **Introspection vivante.** Nodefony connaît son propre modèle (entités, relations,
  services DI, routes, métriques runtime). Croiser cette introspection avec un modèle de
  langage produit un assistant qui explique à l'utilisateur ce qu'il observe, toujours à
  jour, jamais codé en dur.

---

## 3. Gouvernance des données et conformité

Un agent IA d'entreprise est d'abord un **problème de gouvernance**. Nodefony l'adresse
sur cinq axes, tous pensés dès l'architecture.

### 3.1 Souveraineté — la donnée ne sort pas sans décision explicite

- **Mode local / air-gap** comme contrainte de premier ordre : Ollama pour l'inférence,
  pgvector pour les embeddings, **zéro dépendance à un cloud étranger**. Décisif pour la
  défense, la santé et le secteur public.
- Le choix du fournisseur (`ILLMProvider`) est une **frontière explicite** : la
  configuration détermine quelles données partent vers quel modèle, chez quel hébergeur.
  Les fournisseurs européens (Mistral) et locaux (Ollama) sont des citoyens de première
  classe.

### 3.2 Conformité AI Act (en vigueur depuis 2025)

- **Traçabilité des sources** : le grounding cite ses sources par construction. Une
  réponse d'agent est rattachable aux documents qui l'ont produite — exigence directe de
  l'AI Act en matière de transparence.
- **Contrôle humain obligatoire** en zones sensibles : une action en zone `restricted`
  exige une validation humaine avant exécution (mécanisme d'_approval_).
- **Audit signé** : chaque décision, chaque appel de modèle, chaque action d'agent est
  journalisée via les transports syslog du cœur, corrélée par `requestId` (ALS).
  Traçabilité de bout en bout, non répudiable.

### 3.3 Protection des données personnelles (RGPD)

- **Détection et filtrage des données personnelles (PII)** au niveau de la couche de
  gouvernance : les PII sont identifiées et maîtrisées **avant** tout transit vers un
  modèle.
- **SQL paramétré et expurgé** dans toutes les sondes : les requêtes exposées à
  l'observabilité (et donc potentiellement à un modèle d'analyse) ne contiennent jamais de
  valeur ni de secret — uniquement des paramètres substitués. C'est une règle de
  conception du _data plane_.

### 3.4 Garde-fous d'exécution

Le module de gouvernance transforme « un agent qui répond » en « un agent déployable en
entreprise » :

- **Zones de confiance** (`public` / `restricted` / …) conditionnant les droits d'un
  agent.
- **Disjoncteur (_circuit breaker_)** : coupe automatiquement un agent qui dérive (boucle,
  coût qui explose, comportement anormal).
- **Workflow d'approbation** : validation humaine en boucle pour les actions à fort
  impact.
- **Audit signé** des décisions, adossé au RBAC du module de sécurité.
- **Garde-fous chiffrés par défaut** (valeurs prudentes, surchargeables) : `maxTokens`
  4096, file d'attente max 500, _timeout_ par tâche 30 s, 2 tentatives max, 100 connexions
  concurrentes max. Ces bornes plafonnent le coût et l'impact d'un agent qui dérive, en
  amont même du disjoncteur.

### 3.5 Zero Trust hérité du cœur

La couche IA ne réinvente pas la sécurité : elle hérite du firewall applicatif, du JWT
_stateless_, du RBAC et des décorateurs de sécurité (`@IsGranted`, `@CurrentUser()`, …)
du module `@nodefony/security`. Un _tool_ d'agent est soumis aux **mêmes** règles
d'autorisation qu'un point d'accès HTTP. Aucune porte dérobée par l'IA.

---

## 4. Décisions d'architecture

### 4.1 L'inférence : orchestrée, jamais exécutée par le cœur (ADR-0004)

Ollama fait tourner un modèle local et l'expose ; la question se pose donc de savoir si
Nodefony devrait exécuter le modèle **lui-même**, dans son process. C'est techniquement
possible (`node-llama-cpp`, `transformers.js`). **La décision est tranchée : non, jamais
dans le cœur.** Trois raisons non négociables :

- **Les deux plans ne scalent pas de la même manière.** Le serveur HTTP/WS est léger et
  scale horizontalement (1 _pod_ = 1 process). L'inférence est lourde, liée au GPU, et ne
  se duplique pas (la VRAM coûte cher). Embarquer le modèle reviendrait à dupliquer 4 à
  30 Go de poids à chaque réplique du serveur. Les deux plans doivent scaler
  **séparément**.
- **Cela saturerait l'_event-loop_.** Une inférence monopolise le CPU/GPU plusieurs
  secondes ; dans le pipeline _request_ mono-thread de Node, elle bloquerait toutes les
  autres requêtes (latence p99 dégradée).
- **Faire tourner un modèle est un métier à plein temps** (quantization, gestion VRAM,
  _KV-cache_, _batching_, runtimes ML en évolution constante) — hors du périmètre d'un
  framework applicatif. Node ne fait de toute façon que piloter du code natif.

Le design retenu, **déjà éprouvé pour le frontend** (`ViteSupervisor` ne réimplémente pas
Vite, il le supervise) : un **backend d'inférence supervisé** derrière l'interface
`ILLMProvider` / `IInferenceBackend`. Nodefony peut lancer Ollama en sous-process,
télécharger le modèle si absent, attendre sa disponibilité et l'exposer — via **une ligne
de configuration**, sans commande manuelle. Le modèle vit dans **son** process, supervisé,
et le backend est interchangeable par configuration (Ollama local ↔ vLLM GPU ↔ API
distante).

> Nodefony **orchestre** l'inférence (cycle de vie, interchangeabilité, gouvernance), il
> ne l'**exécute** pas — comme un orchestrateur ne calcule pas : il place et supervise.

_Décision détaillée : [`docs/adr/0004-inference-llm-backend-supervise.md`](../adr/0004-inference-llm-backend-supervise.md)._

### 4.2 Découpage en capacités, le retrieval comme outil

Le découpage des capacités (§2.1) en modules n'est pas figé. En particulier, le
**grounding/retrieval** est conçu comme un ou plusieurs **outils appelés dynamiquement par
l'agent** (_agentic RAG_), et non comme un pipeline monolithique imposé. Cette ouverture
préserve la rigueur (qualité du _retrieval_, métriques d'évaluation) tout en gardant le
framework générique : la frontière exacte entre module, service et simple _tool_ reste un
choix d'architecture à arbitrer.

---

## 5. État d'avancement

L'état terrain au 29/05/2026, sans enrobage :

| Composant               | État                   | Reste à concevoir/construire (P12)                         |
| ----------------------- | ---------------------- | ---------------------------------------------------------- |
| **Cœur Nodefony**       | ✅ opérationnel, testé | base HTTP/WS/DI/syslog/sécurité — **le seul socle réel**   |
| Accès modèle (`llm`)    | ✏️ esquisse            | concevoir `ILLMProvider` (Anthropic/OpenAI/Mistral/Ollama) |
| Index vectoriel         | ✏️ esquisse            | pgvector via l'ORM (pas de client SQL direct)              |
| Grounding/retrieval     | ✏️ esquisse            | tool(s) + citation des sources (AI Act) — cf. §4.2         |
| Mémoire                 | ✏️ esquisse            | storage ORM ; stratégies court / long / épisodique         |
| Orchestration (`agent`) | ✏️ esquisse            | orchestrateur, `@Agent`/`@Tool`, streaming, abort          |
| Interop (MCP)           | ⬜ à faire             | serveur + client JSON-RPC 2.0 (standard Anthropic MCP)     |
| Gouvernance             | ⬜ à faire             | **le différenciateur** : zones, PII, audit, approbation    |

> Les intitulés correspondent aux esquisses existantes, non à une architecture arrêtée —
> leur périmètre, et jusqu'à leur existence en tant que modules, reste ouvert.

**En clair** : le serveur, le transport, l'injection, la sécurité et l'observabilité sont
**faits, testés et solides** ; la pile IA est une **page blanche posée sur des fondations
mûres**. Un terrain de conception propre, pas un héritage à réparer.

---

## 6. Feuille de route et vision à long terme

> Cette section décrit la **destination**, pas l'état présent (cf. §5). Elle guide les
> choix de conception dès aujourd'hui : toute décision prise pendant la migration doit
> rester découvrable, testable et pilotable, pour servir cette cible.

### 6.1 Standards agentiques à supporter

| Standard            | Ce que cela apporte                                                  | Priorité  |
| ------------------- | -------------------------------------------------------------------- | --------- |
| **MCP** (Anthropic) | Exposer Nodefony comme serveur MCP + consommer des serveurs externes | Critique  |
| **Tool Use**        | Contrôleurs et services exposés comme _tools_ typés (Zod)            | Critique  |
| **Streaming**       | SSE + WebSocket natif pour les tokens du modèle                      | Critique  |
| **RAG**             | Indexation + recherche vectorielle (comme capacité, cf. §4.2)        | Critique  |
| **Mémoire**         | Court terme (session WS) + long terme (base vectorielle)             | Important |
| **A2A** (Google)    | Protocole _agent-to-agent_                                           | Important |

> **Leçon de terrain sur MCP** : un POC a montré qu'un client (Claude Code) **n'appelle pas
> spontanément** un tool MCP à description neutre lorsqu'un _skill_ auto-déclenché couvre le
> même besoin — le déclenchement dépend de la visibilité de la description et de la concurrence
> avec d'autres surfaces, à concevoir explicitement. Détail :
> le RETEX du POC MCP (mémoire IA `core-dev/ia-drafts/retex-poc-mcp-vs-skill.md`). Les patterns
> agentiques de référence (workflows vs agents, conception des outils) sont synthétisés dans le
> résumé du document Anthropic _Building Effective Agents_ (mémoire IA
> `core-dev/ia-drafts/agents-anthropic-building-effective-agents.md`).

### 6.2 Un Studio qui se documente lui-même

L'aide contextuelle (bulles d'information ⓘ) aujourd'hui rédigée à la main sera **générée
par IA** à partir de l'introspection vivante du framework (modèle ORM canonique, graphe
symbolique `.ai/symbols.json`, configuration, routes, métriques runtime). Le Studio
expliquerait alors automatiquement chaque écran et chaque contrôle, avec une documentation
toujours à jour. Aucun framework concurrent ne combine nativement serveur, IA et
introspection de son propre modèle.

### 6.3 De l'observabilité aux _insights_

Parce que les sondes et le tableau de bord partagent le même _data plane_ (§2.3), un agent
peut consommer l'état du système, **détecter les dérives** (débit anormal, latence qui
monte, requêtes lentes récurrentes), **corréler** (par exemple distinguer une saturation
de l'_event-loop_ d'un problème de base), **expliquer** en langage naturel et **suggérer**
des optimisations (création d'index, réécriture de requête) — puisqu'il dispose à la fois
du SQL paramétré et du schéma. Restitution dans un panneau « Insights » du Studio ; les
actions correctives restent réservées au mode développement et soumises au RBAC.

### 6.4 Génération de modules assistée par IA

Depuis le tableau de bord, l'agent analyse le projet existant, produit une `ModuleSpec`
**validée par schéma (Zod)**, présente un _diff_, et n'écrit les fichiers qu'**après
validation humaine**. Jamais d'écriture automatique sans confirmation. Cette voie remplace
à terme le _scaffolding_ CLI déterministe par une génération contextuelle et contrôlée.

### 6.5 Agent vocal temps réel (Phase 15)

Sur le transport temps réel natif, une chaîne PSTN → Asterisk → mediasoup → STT → modèle
de langage → TTS → retour permet de bâtir un **agent IA vocal téléphonique**. Les flux
média binaires transitent par les transports dédiés (pod-à-pod), sans surcharger le plan
de messages.

### 6.6 Auto-développement — Nodefony se code lui-même

C'est l'aboutissement de la démarche. Un module dédié (nom de travail `@nodefony/agent-core`)
exposerait le Kernel et ses outils d'introspection via un **serveur MCP**. L'agent
disposerait alors de tout ce dont il a besoin pour intervenir sur le framework lui-même :

- un **graphe symbolique** interrogeable en O(1) (relations inverses : qui étend, qui
  implémente, qui utilise) plutôt qu'un _grep_ du dépôt ;
- une **suite mémoire/CPU déterministe** donnant un signal binaire (conforme / régression) ;
- un **démarrage fiable et des logs filtrables** pour une boucle exécutable sans humain ;
- une **documentation structurée** (TSDoc + `docs/`) que le retrieval exploite pour éviter
  les hallucinations.

La boucle de travail est un **Red-Green-Refactor** : l'agent édite, lance le banc
mémoire/CPU, **rejette son propre code si un seuil régresse**, puis présente une _pull
request_ avec un rapport avant/après. Garde-fous non négociables : **aucun _merge_ sans
relecture humaine** ; le framework reste conçu et architecturé par un humain (licence
CeCILL-B). À noter : la majorité de ces outils existent déjà sous forme de _skills_ — la
Phase 12 consiste à les exposer en MCP, non à les inventer.

> Aboutissement : **Nodefony comme référence du développement classique et agentique** —
> un framework capable d'expliquer, de diagnostiquer et de maintenir le framework qui le
> porte, sur des bases ouvertes et souveraines.

---

## 7. Conclusion

Nodefony ne cherche pas à concurrencer les producteurs de modèles ni les bibliothèques
d'IA : il fournit le **framework runtime** qui les met au travail dans une application
réelle — avec le streaming, l'orchestration et la **gouvernance des données** dans l'ADN,
et un **mode souverain** atteignable de bout en bout. Le socle est mûr ; la couche IA est
à concevoir. C'est une invitation à le faire avec rigueur, sur des bases saines.

_Projet open source sous licence CeCILL-B — [github.com/nodefony/nodefony-core](https://github.com/nodefony/nodefony-core). Contributions et échanges bienvenus : ccamensuli@gmail.com._
