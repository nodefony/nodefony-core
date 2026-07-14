---
title: "Couche IA agentique de Nodefony — étude de faisabilité technique"
type: étude de faisabilité
version: 1.0
audience: responsable scientifique et technique IA, architecte logiciel
auteur: Christophe Camensuli
methode: analyse assistée par IA du code source, des tests et des décisions d'architecture (ADR)
date: 2026-06-17
licence: CeCILL-B (open source)
---

# Couche IA agentique de Nodefony — étude de faisabilité technique

> **Objet.** Évaluer la faisabilité de bâtir une couche IA agentique **souveraine** sur le
> socle applicatif Nodefony. Ce document n'est pas un argumentaire commercial : c'est une
> analyse technique destinée à être **challengée** par une expertise IA / science des
> données.
>
> **Méthode.** Étude produite avec assistance IA à partir du code source, de la suite de
> tests et des décisions d'architecture (ADR) du dépôt. Les niveaux de maturité sont
> indiqués sans complaisance.
>
> **Convention de maturité.** ✅ livré et testé · 🔶 esquisse (interfaces / squelette, non
> câblé) · ⬜ à concevoir.

---

## 1. Positionnement — ce que Nodefony est, et n'est pas

Pour éviter tout malentendu avec l'écosystème ML existant :

- Nodefony **n'est pas** une plateforme de data science. Il ne remplace ni MLflow /
  Databricks (entraînement, suivi d'expériences, industrialisation), ni les bibliothèques
  d'orchestration de prompts (LangChain, LlamaIndex), ni un moteur d'inférence (vLLM, TGI,
  Ollama). Il ne calcule pas, il ne sert pas le modèle dans son propre process (cf. §4.2).
- Nodefony **est** un **framework runtime applicatif fullstack** (Node.js / TypeScript) :
  la couche qui _met les modèles au travail_ dans une application réelle — transport temps
  réel, orchestration sous forme de services, sécurité, gouvernance des données,
  observabilité. C'est la couche entre le modèle servi et l'utilisateur final, traitée comme
  un tout cohérent et **déployable intra-muros**.

> Frontière nette : le modèle est entraîné, évalué et industrialisé **en amont** (le monde
> MLOps) ; Nodefony l'**orchestre et le gouverne en aval**, dans un runtime souverain. Les
> deux mondes se rejoignent à une interface explicite (§4.1).

---

## 2. Le socle existant (l'actif réel)

C'est la partie qui réduit le risque du projet : l'infrastructure — habituellement le plus
long et le plus coûteux à fiabiliser dans une mise en production d'IA — est **déjà faite et
testée**.

| Brique                            | État | Détail technique                                                                                                                    |
| --------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Serveurs natifs HTTP/HTTPS/HTTP-2 | ✅   | `node:http`, `node:http2`, sans surcouche                                                                                           |
| WebSocket co-citoyen              | ✅   | même contexte _controller_ que le HTTP — transport idéal du streaming                                                               |
| Injection de dépendances          | ✅   | `@injectable`/`@inject`, scopes, ALS — services isolés, mockables, testables                                                        |
| ORM multi-back-ends               | ✅   | abstraction `IOrm`/`IRepository` ; Drizzle (SQL) par défaut, Mongoose, Redis                                                        |
| Sécurité                          | 🔶   | socle livré (pare-feu applicatif, JWT _stateless_, RBAC, OAuth2, WebAuthn, CSRF/CORS) ; **durcissement en cours (phase P6, ~62 %)** |
| Observabilité                     | ✅   | syslog structuré, corrélation `requestId` par ALS, _data plane_ JSON, tableau de bord (Studio)                                      |
| Perf / mémoire                    | ✅   | suites de charge et de fuite mémoire **versionnées** (seuils heap, listeners, cycle de vie)                                         |

Le **graphe symbolique** du code (`.ai/symbols.json` : classes, interfaces, relations
inverses, requêtes en O(1)) et la documentation structurée (TSDoc + `docs/`) sont également
présents — points d'appui directs pour un _grounding_ fiable de l'IA sur le framework
lui-même (§4.7).

---

## 3. Architecture cible de la couche IA

La couche IA se raisonne en **capacités** (le _quoi_, stable), pas en découpage figé de
modules (le _comment_, ouvert). Les paquets `@nodefony/llm`, `rag`, `vector`, `agent`,
`memory` existent en squelette mais **ne sont pas encore câblés** (pas de configuration de
build) — ce sont des esquisses, pas une architecture arrêtée.

| Capacité                 | État | Contrat pressenti                                                |
| ------------------------ | ---- | ---------------------------------------------------------------- |
| Accès modèle             | 🔶   | `ILLMProvider` — 1 interface, N back-ends                        |
| Inférence (cycle de vie) | ⬜   | `IInferenceBackend` — process supervisé (ADR-0004)               |
| Outils / _tool use_      | ⬜   | `ITool<I,O>` typé et validé (Zod)                                |
| Retrieval / _grounding_  | ⬜   | `IRetriever` — appelé **comme un outil**, pas un pipeline figé   |
| Index vectoriel          | ⬜   | via l'ORM (pgvector), pas de client SQL direct                   |
| Mémoire                  | ⬜   | `IMemory` — court / long / épisodique                            |
| Orchestration            | ⬜   | `IAgent` — agent = service DI ; sous-agents = graphe de services |
| Gouvernance              | ⬜   | zones, PII, audit signé, disjoncteur, validation humaine         |

Contrats indicatifs (esquisses à valider, **non implémentés en l'état**) :

```ts
// Accès modèle — streaming first, annulable, conscient de sa souveraineté
interface ILLMProvider {
  readonly id: string; // "ollama" | "mistral" | "vllm" | "anthropic" | …
  readonly sovereign: boolean; // l'inférence reste-t-elle intra-muros ?
  complete(req: CompletionRequest): Promise<CompletionResult>;
  stream(req: CompletionRequest, signal: AbortSignal): AsyncGenerator<Token>;
  shutdown(): Promise<void>; // libère AbortController, readers, connexions
}

// Outil exposé à l'agent — frontière de sécurité ET d'ergonomie (ACI)
interface ITool<I, O> {
  name: string;
  description: string; // ce que l'agent "voit" — la qualité ici conditionne l'appel
  schema: ZodSchema<I>; // bornes strictes, listes blanches, pas de chaîne libre
  authorize?(ctx: Context): boolean; // RBAC hérité du cœur (§4.5)
  execute(input: I, ctx: AgentContext): Promise<O>;
}

// Retrieval = un outil que l'agent décide d'appeler, pas une étape imposée
interface IRetriever {
  search(query: string, k: number, signal: AbortSignal): Promise<Chunk[]>;
}

// Agent — émet un flux d'événements (tokens, appels d'outils, décisions), annulable
interface IAgent {
  run(input: AgentInput, signal: AbortSignal): AsyncGenerator<AgentEvent>;
  shutdown(): Promise<void>;
}
```

---

## 4. Points techniques structurants (cœur de la faisabilité)

### 4.1 Streaming natif — l'adéquation socle ↔ besoin

Un LLM produit sa sortie token par token ; la restituer au fil de l'eau exige un canal
duplex temps réel. Le design retenu chaîne un `AsyncGenerator` côté serveur au WebSocket
natif côté transport — **sans surcouche** ni passerelle. Les points durs sont identifiés et
adressables avec les primitives existantes :

- **Annulation** : `AbortSignal` propagé du transport (déconnexion client, _close_ WS)
  jusqu'au provider, qui interrompt la génération. Évite la génération « fantôme » qui
  continue après abandon — premier poste de gaspillage GPU.
- **Contre-pression (_backpressure_)** : un client lent ne doit pas faire enfler la mémoire
  serveur. Le socle expose déjà `bufferedAmount` côté WS ; une politique
  _drop / coalesce / batch_ par canal est requise (sonde de _backpressure_ à finaliser).
- **Cycle de vie** : `releaseLock()` des _readers_, `clearTimeout`, fermeture des
  connexions — formalisés par l'invariant `shutdown()` (cf. §4.4).

> C'est l'argument de fond : le streaming LLM est _le_ cas d'usage pour lequel la dualité
> HTTP + WebSocket a été conçue à l'origine. Le socle n'est pas adapté après coup, il
> préexiste au besoin.

### 4.2 Inférence orchestrée, jamais embarquée (ADR-0004)

Décision tranchée : le cœur **n'exécute pas** le modèle dans son process. Trois raisons non
négociables :

1. **Plans de scaling distincts.** Le serveur HTTP/WS est léger et scale horizontalement
   (1 pod = 1 process) ; l'inférence est liée au GPU/VRAM et ne se duplique pas. Embarquer
   le modèle dupliquerait 4–30 Go de poids par réplique.
2. **Event-loop.** Une inférence monopolise le CPU/GPU plusieurs secondes ; dans le pipeline
   mono-thread de Node, elle bloquerait toutes les autres requêtes (p99 dégradée).
3. **Métier distinct.** Quantization, KV-cache, _batching_, runtimes ML — hors périmètre
   d'un framework applicatif.

Le pattern retenu est **déjà éprouvé pour le frontend** (`ViteSupervisor` supervise Vite
sans le réimplémenter) : un **backend d'inférence supervisé** derrière `IInferenceBackend`.
Nodefony lance/attend le moteur (Ollama, vLLM, TGI…), le rend disponible, l'expose — par
configuration. Le moteur vit dans **son** process, interchangeable (Ollama local ↔ vLLM GPU
↔ API distante) **sans toucher au code applicatif**. C'est aussi le point d'intégration
naturel avec un modèle industrialisé en amont (MLflow/Databricks → artefact servi).

### 4.3 Retrieval agentique, pas pipeline figé

Le _grounding_ est conçu comme **un ou plusieurs outils** que l'agent appelle dynamiquement
(il décide _quand_ chercher, _quoi_, et s'il relance) — pas un enchaînement
« chunk → embed → top-K → prompt » imposé. L'index vectoriel passe par l'ORM (pgvector),
ce qui évite un client SQL parallèle et garde le contrôle d'accès. La frontière
module / service / simple outil reste un **choix d'architecture ouvert**. Voie hybride
envisageable (sans surcoût de principe) : retrieval vectoriel **+** graphe de connaissances
(RDF/SPARQL, ontologies) pour les corpus structurés.

### 4.4 Gestion mémoire et cycle de vie — point dur assumé

Le streaming et les appels longue durée sont les premiers candidats aux fuites. La règle du
framework (lazy alloc, _removeListener_ explicite, pas de structure « au cas où ») se décline
en un invariant IA : **tout service IA expose `shutdown()`** (annulation des
`AbortController`, `releaseLock()`, `clearTimeout`, fermeture des connexions). Atout
décisif : il existe déjà une **suite de tests de fuite mémoire versionnée** (HTTP, WS,
crashes), réutilisable comme garde-fou de non-régression pour les services IA — un signal
binaire conforme/régression rare dans ce type de projet.

### 4.5 Sécurité héritée — Zero Trust sur les outils

La couche IA ne réinvente pas la sécurité : un **outil d'agent est un point d'accès** soumis
aux **mêmes** règles que le HTTP (pare-feu, RBAC, `@IsGranted`, `@CurrentUser`). Pas de
porte dérobée par l'IA. Réserve honnête : la sécurité du framework est en cours de
durcissement (P6), et la sécurité _spécifique aux agents_ — injection de prompt,
exfiltration via outils, confused-deputy — est un **chantier à part entière** (§6).

### 4.6 Gouvernance — le différenciateur, à construire (⬜)

Ce qui transforme « un agent qui répond » en « un agent déployable en milieu sensible » :

- **Zones de confiance** (`public` / `restricted` / …) conditionnant les droits d'un agent.
- **Détection / filtrage PII** **avant** tout transit vers un modèle.
- **Audit signé** : chaque décision, appel modèle et action, corrélé par `requestId`,
  journalisé via les transports syslog du cœur — traçabilité non répudiable.
- **Disjoncteur** : coupe un agent qui dérive (boucle, coût, comportement anormal).
- **Validation humaine** en boucle pour les actions à fort impact.
- **Garde-fous chiffrés** — _valeurs **proposées**, à implémenter_ : `maxTokens` 4096, file
  d'attente 500, _timeout_ 30 s, 2 tentatives, 100 connexions concurrentes. Bornes destinées
  à plafonner coût et impact en amont du disjoncteur.

> Statut sans ambiguïté : la gouvernance est **à concevoir**. Les valeurs ci-dessus sont des
> cibles de conception, pas un comportement déjà en place.

### 4.7 Observabilité IA-first et introspection

Les sondes et le tableau de bord partagent un même _data plane_ JSON (SQL **paramétré et
expurgé** — jamais de valeur ni de secret). Conséquence exploitable : un agent peut
consommer **les mêmes points d'accès** que l'admin — lire l'état du système, corréler,
expliquer, suggérer (créer un index, réécrire une requête) — car il dispose du schéma et de
la requête paramétrée. Couplé au graphe symbolique (§2), cela ouvre la voie à un framework
qui **se documente et se diagnostique** lui-même. Capacité prometteuse, **non réalisée**.

---

## 5. Intégration à l'écosystème ML existant

Pour un usage industriel, la question n'est pas « Nodefony remplace-t-il mon stack ? » mais
« s'y intègre-t-il ? » :

- **Amont (MLOps)** : entraînement, suivi, packaging restent chez MLflow / Databricks. Le
  point de jonction est l'**artefact servi** (un endpoint d'inférence), consommé via
  `ILLMProvider` / `IInferenceBackend`.
- **Serving** : vLLM / TGI (GPU, débit) ou Ollama (local, simplicité) ou edge / IA embarquée
  — interchangeables par configuration.
- **Modèles** : open-weights (Mistral, Llama, Qwen…) servis localement pour la souveraineté ;
  ou API distante quand le contexte l'autorise. Le choix est une **frontière de
  configuration explicite**, pas un couplage dur.

Nodefony se positionne donc en **couche d'application gouvernée**, complémentaire — pas
concurrente — de l'outillage data science.

---

## 6. Risques, points durs et questions ouvertes

Une étude de faisabilité honnête nomme ses inconnues. Celles-ci relèvent moins de
l'infrastructure (résolue) que de la **science des données et de l'évaluation** :

1. **Évaluation.** Sans métriques, pas de garantie. RAG : _faithfulness_, _context /
   answer relevance_, _recall@k_. Agents : taux de succès de tâche, coût, latence,
   robustesse. **Le framework n'a pas encore de brique d'évaluation** — c'est un prérequis,
   pas un détail.
2. **Orchestration multi-agents.** Convergence, boucles, explosion de coût, attribution des
   erreurs. Quand un graphe de sous-agents est-il préférable à un agent unique outillé ?
   (Question ouverte, cf. littérature _workflows vs agents_.)
3. **Qualité du retrieval.** Stratégie de _chunking_, embeddings, hybridation
   vectoriel / lexical / graphe, _re-ranking_ — déterminants et dépendants du corpus.
4. **Backpressure sous charge réelle.** Streaming WS massivement concurrent + clients lents :
   politique de _drop / coalesce_ à valider par test de charge (le socle a l'outillage, la
   politique IA reste à écrire).
5. **Sécurité spécifique agent.** Injection de prompt, exfiltration via outils,
   _confused-deputy_. Le RBAC du cœur est nécessaire mais **non suffisant**.
6. **Détection PII fiable.** Compromis précision / rappel, multilingue, faux négatifs en
   zone sensible — un problème statistique en soi.
7. **Souveraineté _réelle_.** Elle suppose un **modèle open-weights maîtrisé** servi
   localement, pas seulement un proxy : la chaîne d'approvisionnement du modèle fait partie
   du périmètre de souveraineté.
8. **Interop MCP — statut corrigé.** Un POC a montré qu'un client (Claude Code) **n'appelle
   pas spontanément** un outil MCP à description neutre face à un _skill_ auto-déclenché : le
   déclenchement dépend de la visibilité de la description et de la concurrence des surfaces.
   Le support MCP n'est donc pas un simple « à faire » mais un sujet **à reconcevoir**
   (conception explicite du déclenchement). A2A (agent-to-agent) reste prospectif.

---

## 7. Verdict de faisabilité

**Faisabilité élevée — et pour une raison précise.** Le risque dominant d'une mise en
production d'IA est habituellement l'infrastructure : serveur temps réel fiable, sécurité,
observabilité, cycle de vie mémoire, déploiement. Ici, **cette partie est faite et testée**.
Le travail restant est la couche IA elle-même, dont les difficultés sont **connues et
circonscrites** (§6) — relevant de l'expertise IA / data science, pas de l'inconnu
architectural.

Conditions de succès :

1. **Apport d'une expertise IA / science des données** sur l'évaluation (métriques RAG /
   agents), l'orchestration et la qualité du retrieval — précisément les briques que le
   socle ne fournit pas.
2. **Choix d'un modèle open-weights maîtrisé**, servi localement, pour une souveraineté
   réelle (et non déclarative).
3. **Périmètre initial resserré** : un _vertical slice_ RAG souverain (corpus interne,
   réponse streamée, sources citées, 100 % local, tracé) **avant** d'aborder l'orchestration
   multi-agents. Démontrer la chaîne complète sur un cas étroit, puis élargir.

> En synthèse : le socle déplace le risque du terrain _infrastructure_ (résolu) vers le
> terrain _science des données et évaluation_ (à instruire). C'est le bon endroit où
> concentrer l'effort, et le bon moment pour y associer une expertise.

---

_Étude générée avec assistance IA à partir du code, des tests et des ADR du projet
(corrige, par rapport au brouillon 0.1 : la maturité réelle des composants, le statut « à
implémenter » des garde-fous de gouvernance, le calendrier d'application de l'AI Act, et le
statut MCP). Document destiné à être contredit et affiné par une revue experte._

_Projet open source sous licence CeCILL-B — [github.com/nodefony/nodefony-core](https://github.com/nodefony/nodefony-core) — ccamensuli@gmail.com._
