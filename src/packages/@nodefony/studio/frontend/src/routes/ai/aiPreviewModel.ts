/**
 * Données SIMULÉES des écrans « IA — Atelier » — la destination de la couche IA,
 * rendue visible avant d'exister.
 *
 * Deux sources, et rien d'autre :
 *  - les CONTRATS déjà esquissés (`@nodefony/llm`, `vector`, `rag`, `memory`,
 *    `agent`) : chaque type ci-dessous est leur MIROIR local, puisque le bundle
 *    de la console n'importe aucun paquet serveur ;
 *  - le livre blanc (`docs/ia/livre-blanc-couche-ia.md`) : garde-fous chiffrés
 *    (§3.4), inférence supervisée (§4.1, ADR-0004), recherche documentaire comme
 *    OUTIL de l'agent (§4.2), standards (§6.1).
 *
 * Ce fichier ne contient aucun JSX et ne parle à aucun serveur. Tout ce qu'un
 * écran affiche ici est inventé — mais inventé DANS la forme visée, pour que la
 * simulation se remplace par le vrai flux sans redessiner l'écran.
 */

// ─── Accès modèle — miroir de `ILLMProvider` (@nodefony/llm) ─────────────────

/** Fournisseur de modèle. `mistral` n'est pas encore dans l'esquisse : le livre blanc le cite (§3.1). */
export type LlmProviderName = "ollama" | "mistral" | "claude" | "openai";
/** `sovereign` = la donnée ne quitte pas l'infrastructure. */
export type LlmMode = "cloud" | "sovereign";
export type PreviewHealth = "ok" | "degraded" | "down" | "off";

export interface IPreviewProvider {
  name: LlmProviderName;
  label: string;
  model: string;
  mode: LlmMode;
  /** Où tourne l'inférence — c'est la frontière que la gouvernance regarde. */
  hosting: string;
  status: PreviewHealth;
  /** Délai jusqu'au premier jeton, médiane sur 24 h. */
  ttftMs: number | null;
  tokensPerSec: number | null;
  calls24h: number;
  costEur24h: number;
}

export const PROVIDERS: IPreviewProvider[] = [
  {
    name: "ollama",
    label: "Ollama (supervisé)",
    model: "llama3.1:8b-instruct-q4_K_M",
    mode: "sovereign",
    hosting: "Local — même hôte",
    status: "ok",
    ttftMs: 180,
    tokensPerSec: 42,
    calls24h: 1284,
    costEur24h: 0,
  },
  {
    name: "mistral",
    label: "Mistral AI",
    model: "mistral-large-latest",
    mode: "cloud",
    hosting: "UE — Paris",
    status: "ok",
    ttftMs: 420,
    tokensPerSec: 78,
    calls24h: 612,
    costEur24h: 3.84,
  },
  {
    name: "claude",
    label: "Anthropic",
    model: "claude-sonnet-5-5",
    mode: "cloud",
    hosting: "US",
    status: "degraded",
    ttftMs: 910,
    tokensPerSec: 95,
    calls24h: 233,
    costEur24h: 4.12,
  },
  {
    name: "openai",
    label: "OpenAI",
    model: "—",
    mode: "cloud",
    hosting: "US",
    status: "off",
    ttftMs: null,
    tokensPerSec: null,
    calls24h: 0,
    costEur24h: 0,
  },
];

/** Le backend d'inférence SUPERVISÉ (ADR-0004) : Nodefony orchestre, il n'exécute pas. */
export const SUPERVISED_BACKEND = {
  command: "ollama serve",
  pid: 48213,
  model: "llama3.1:8b-instruct-q4_K_M",
  modelSizeGb: 4.9,
  vramUsedGb: 6.1,
  vramTotalGb: 8,
  uptime: "3 h 12 min",
  steps: [
    { label: "Lancer le sous-process", detail: "pid 48213" },
    {
      label: "Télécharger le modèle s'il manque",
      detail: "4,9 Go — déjà présent",
    },
    { label: "Attendre qu'il réponde", detail: "prêt en 2,4 s" },
    { label: "L'exposer derrière ILLMProvider", detail: "ollama → llama3.1" },
  ],
} as const;

/** Garde-fous chiffrés par défaut — livre blanc §3.4. `current` = valeur simulée. */
export interface IPreviewGuardrail {
  label: string;
  limit: number;
  current: number;
  unit: string;
  hint: string;
}

export const GUARDRAILS: IPreviewGuardrail[] = [
  {
    label: "Jetons par réponse",
    limit: 4096,
    current: 1830,
    unit: "jetons (p95)",
    hint: "Plafond `maxTokens` : borne le coût d'une seule réponse.",
  },
  {
    label: "File d'attente",
    limit: 500,
    current: 37,
    unit: "tâches",
    hint: "Au-delà, une nouvelle tâche est refusée au lieu d'attendre indéfiniment.",
  },
  {
    label: "Délai par tâche",
    limit: 30,
    current: 11.4,
    unit: "s (p95)",
    hint: "Une tâche plus longue est annulée (AbortController) et ses ressources libérées.",
  },
  {
    label: "Tentatives",
    limit: 2,
    current: 1,
    unit: "max observé",
    hint: "Nombre de relances après un échec transitoire du fournisseur.",
  },
  {
    label: "Connexions simultanées",
    limit: 100,
    current: 23,
    unit: "connexions",
    hint: "Plafond des flux de jetons ouverts en même temps.",
  },
];

/** Zones de confiance (§3.4) → fournisseurs autorisés. La donnée sensible ne sort pas. */
export const ZONES = ["public", "internal", "restricted"] as const;
export type PreviewZone = (typeof ZONES)[number];

export const DATA_FRONTIER: Record<PreviewZone, LlmProviderName[]> = {
  public: ["ollama", "mistral", "claude"],
  internal: ["ollama", "mistral"],
  restricted: ["ollama"],
};

// ─── Index vectoriel — miroir de `IVectorStore` (@nodefony/vector) ───────────

export interface IPreviewCollection {
  collection: string;
  adapter: string;
  embedModel: string;
  dimensions: number;
  distance: "cosine" | "euclidean" | "dotproduct";
  index: string;
  vectors: number;
  sizeMb: number;
  lastWrite: string;
}

export const COLLECTIONS: IPreviewCollection[] = [
  {
    collection: "juridique",
    adapter: "pgvector (ORM)",
    embedModel: "nomic-embed-text",
    dimensions: 768,
    distance: "cosine",
    index: "HNSW m=16 ef=64",
    vectors: 48210,
    sizeMb: 212,
    lastWrite: "il y a 12 min",
  },
  {
    collection: "support",
    adapter: "pgvector (ORM)",
    embedModel: "mistral-embed",
    dimensions: 1024,
    distance: "cosine",
    index: "HNSW m=16 ef=64",
    vectors: 18734,
    sizeMb: 96,
    lastWrite: "il y a 40 s",
  },
  {
    collection: "rapports-financiers",
    adapter: "Qdrant",
    embedModel: "mistral-embed",
    dimensions: 1024,
    distance: "cosine",
    index: "HNSW m=32 ef=128",
    vectors: 9120,
    sizeMb: 51,
    lastWrite: "hier",
  },
  {
    collection: "memoire-agents",
    adapter: "pgvector (ORM)",
    embedModel: "nomic-embed-text",
    dimensions: 768,
    distance: "cosine",
    index: "HNSW m=16 ef=64",
    vectors: 22410,
    sizeMb: 88,
    lastWrite: "il y a 2 min",
  },
];

/** Miroir de `IVectorMetadata` + `IChunk` : un morceau de document indexé. */
export interface IPreviewChunk {
  id: string;
  collection: string;
  text: string;
  source: string;
  page?: number;
  section?: string;
  /** SHA-256 du contenu d'origine, tronqué — c'est lui qui rend la citation vérifiable. */
  hash: string;
}

/** Le petit corpus que la recherche simulée classe VRAIMENT. */
export const CORPUS: IPreviewChunk[] = [
  {
    id: "c1",
    collection: "juridique",
    text: "Le client dispose d'un délai de rétractation de quatorze jours à compter de la réception du produit, sans avoir à justifier de motif.",
    source: "CGV-2026.pdf",
    page: 4,
    section: "Art. 7 — Rétractation",
    hash: "9f3a1c",
  },
  {
    id: "c2",
    collection: "juridique",
    text: "Une commande en cours de livraison peut être annulée ; le remboursement intervient au plus tard quatorze jours après le retour du colis.",
    source: "CGV-2026.pdf",
    page: 5,
    section: "Art. 8 — Annulation",
    hash: "2b7e90",
  },
  {
    id: "c3",
    collection: "juridique",
    text: "Les contrats légalement formés tiennent lieu de loi à ceux qui les ont faits. Ils ne peuvent être modifiés ou révoqués que de leur consentement mutuel.",
    source: "Code civil — Livre III",
    section: "Art. 1103 et 1193",
    hash: "c41d07",
  },
  {
    id: "c4",
    collection: "juridique",
    text: "La résiliation du contrat cadre fournisseur exige un préavis de trois mois, notifié par lettre recommandée avec accusé de réception.",
    source: "Contrat cadre fournisseur.pdf",
    page: 12,
    section: "Art. 21 — Résiliation",
    hash: "77aa31",
  },
  {
    id: "c5",
    collection: "support",
    text: "Escalade niveau 2 : tout ticket sans réponse sous quatre heures ouvrées est réaffecté au superviseur, qui valide la remise commerciale éventuelle.",
    source: "Procédure support N2.md",
    section: "Escalade",
    hash: "e05b62",
  },
  {
    id: "c6",
    collection: "support",
    text: "Pour une livraison en retard, vérifier d'abord le statut transporteur, puis proposer l'annulation ou un geste commercial selon le délai écoulé.",
    source: "Procédure support N2.md",
    section: "Retards de livraison",
    hash: "1fd9a8",
  },
  {
    id: "c7",
    collection: "support",
    text: "Les données personnelles du client (adresse, téléphone) sont masquées avant tout envoi à un modèle hébergé hors de l'Union européenne.",
    source: "Politique de protection des données.md",
    section: "Transferts",
    hash: "5c3e14",
  },
  {
    id: "c8",
    collection: "support",
    text: "Sur demande d'effacement, toutes les conversations et la mémoire d'agent liées au client sont supprimées sous trente jours.",
    source: "Politique de protection des données.md",
    section: "Droit à l'effacement",
    hash: "a90f22",
  },
  {
    id: "c9",
    collection: "rapports-financiers",
    text: "Le chiffre d'affaires 2025 atteint 48,2 millions d'euros, en hausse de 11 %, porté par l'activité de services récurrents.",
    source: "Rapport annuel 2025.pdf",
    page: 8,
    section: "Faits marquants",
    hash: "3e6b5d",
  },
  {
    id: "c10",
    collection: "rapports-financiers",
    text: "La marge opérationnelle recule à 9,4 % sous l'effet des coûts d'infrastructure de calcul, en partie compensés par l'inférence locale.",
    source: "Rapport annuel 2025.pdf",
    page: 14,
    section: "Résultats",
    hash: "8d21c0",
  },
];

/** Miroir de `IVectorSearchResult` / `ISearchResult`. */
export interface IPreviewSearchResult {
  chunk: IPreviewChunk;
  /** Similarité cosinus, 0 → 1. */
  score: number;
  rank: number;
}

const STOPWORDS = new Set(
  "les des une est pour par sur dans qui que avec sans aux son ses leur leurs plus pas tout toute tous être avoir mon mes vos votre nos notre cette ces quel quelle quels quelles comment quand elle ils sont".split(
    " ",
  ),
);

/** Mots porteurs d'une phrase : minuscules, sans accents, sans mots outils. */
export function terms(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    .map((w) => (w.length > 5 ? w.slice(0, 6) : w));
}

function vectorOf(words: string[]): Map<string, number> {
  const v = new Map<string, number>();
  for (const w of words) v.set(w, (v.get(w) ?? 0) + 1);
  return v;
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  for (const [k, x] of a) dot += x * (b.get(k) ?? 0);
  const norm = (m: Map<string, number>) =>
    Math.sqrt([...m.values()].reduce((s, x) => s + x * x, 0));
  const d = norm(a) * norm(b);
  return d === 0 ? 0 : dot / d;
}

/**
 * Recherche de similarité SIMULÉE — un vrai classement, sur des sacs de mots.
 *
 * Ce n'est pas un plongement sémantique : c'est ce qui permet à l'écran de
 * réagir honnêtement à la question tapée (un mot du corpus remonte le bon
 * passage) sans modèle ni serveur. Le score est ramené dans la plage qu'un
 * vrai index cosinus rend sur des passages proches.
 */
export function searchCorpus(
  query: string,
  options: { collection?: string; collections?: string[]; limit?: number } = {},
): IPreviewSearchResult[] {
  const q = vectorOf(terms(query));
  return CORPUS.filter(
    (c) =>
      (!options.collection || c.collection === options.collection) &&
      (!options.collections || options.collections.includes(c.collection)),
  )
    .map((chunk) => ({
      chunk,
      score:
        0.42 +
        0.53 *
          cosine(q, vectorOf(terms(chunk.text + " " + (chunk.section ?? "")))),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit ?? 5)
    .map((r, i) => ({
      chunk: r.chunk,
      score: Math.round(r.score * 1000) / 1000,
      rank: i + 1,
    }));
}

// ─── Grounding — miroir de `IRagService` (@nodefony/rag) ─────────────────────

export type ChunkingStrategy = "fixed" | "sentence" | "paragraph";
export type SourceStatus = "indexed" | "indexing" | "error";

export interface IPreviewSource {
  source: string;
  kind: string;
  collection: string;
  strategy: ChunkingStrategy;
  chunkSize: number;
  chunkOverlap: number;
  chunks: number;
  status: SourceStatus;
  /** Progression d'une indexation en cours, 0 → 100. */
  progress?: number;
  /** Données personnelles détectées et masquées AVANT la vectorisation (§3.3). */
  piiMasked: number;
  indexed: string;
  error?: string;
}

export const SOURCES: IPreviewSource[] = [
  {
    source: "CGV-2026.pdf",
    kind: "PDF",
    collection: "juridique",
    strategy: "paragraph",
    chunkSize: 512,
    chunkOverlap: 50,
    chunks: 186,
    status: "indexed",
    piiMasked: 0,
    indexed: "hier",
  },
  {
    source: "Code civil — Livre III",
    kind: "HTML",
    collection: "juridique",
    strategy: "sentence",
    chunkSize: 512,
    chunkOverlap: 50,
    chunks: 4120,
    status: "indexed",
    piiMasked: 0,
    indexed: "il y a 6 j",
  },
  {
    source: "Procédure support N2.md",
    kind: "Markdown",
    collection: "support",
    strategy: "paragraph",
    chunkSize: 384,
    chunkOverlap: 40,
    chunks: 58,
    status: "indexed",
    piiMasked: 3,
    indexed: "il y a 2 h",
  },
  {
    source: "Tickets support 2025.jsonl",
    kind: "JSONL",
    collection: "support",
    strategy: "sentence",
    chunkSize: 256,
    chunkOverlap: 32,
    chunks: 15230,
    status: "indexing",
    progress: 64,
    piiMasked: 412,
    indexed: "en cours",
  },
  {
    source: "Rapport annuel 2025.pdf",
    kind: "PDF",
    collection: "rapports-financiers",
    strategy: "fixed",
    chunkSize: 512,
    chunkOverlap: 50,
    chunks: 912,
    status: "indexed",
    piiMasked: 0,
    indexed: "il y a 3 j",
  },
  {
    source: "Contrat cadre fournisseur.pdf",
    kind: "PDF",
    collection: "juridique",
    strategy: "paragraph",
    chunkSize: 512,
    chunkOverlap: 50,
    chunks: 0,
    status: "error",
    piiMasked: 0,
    indexed: "—",
    error: "Document protégé par mot de passe — rien n'a été indexé.",
  },
];

/** Les étapes d'ingestion, dans l'ordre où elles s'appliquent. Les PII partent AVANT le modèle. */
export const INGESTION_STEPS = [
  { label: "Extraire", detail: "texte + métadonnées (page, section)" },
  { label: "Masquer les PII", detail: "415 données personnelles masquées" },
  { label: "Découper", detail: "taille 512, chevauchement 50" },
  { label: "Vectoriser", detail: "mistral-embed · nomic-embed-text" },
  { label: "Indexer", detail: "HNSW · empreinte SHA-256 par passage" },
] as const;

/** Qualité de la recherche — ce qu'on mesure avant de croire une réponse. */
export const RETRIEVAL_QUALITY = {
  recallAt5: 0.86,
  mrr: 0.71,
  faithfulness: 0.93,
  citedAnswers: 0.98,
  recallHistory: [
    0.78, 0.79, 0.79, 0.81, 0.8, 0.82, 0.83, 0.82, 0.84, 0.85, 0.84, 0.86, 0.86,
    0.86,
  ],
};

// ─── Mémoire — miroir de `IMemoryService` (@nodefony/memory) ──────────────────

export const MEMORY_TIERS = [
  {
    tier: "Court terme",
    store: "Session WebSocket",
    entries: 1284,
    retention: "durée de la session",
    role: "Le fil de la conversation en cours.",
  },
  {
    tier: "Long terme",
    store: "Base vectorielle « memoire-agents »",
    entries: 22410,
    retention: "365 jours",
    role: "Les faits durables, retrouvés par similarité.",
  },
  {
    tier: "Épisodique",
    store: "Résumés consolidés (ORM)",
    entries: 1106,
    retention: "730 jours",
    role: "Un résumé par session close : ce qui s'est passé, ce qui a été décidé.",
  },
] as const;

export interface IPreviewMemorySession {
  sessionId: string;
  agentId: string;
  /** Pseudonymisé : la console n'affiche jamais l'identité d'un utilisateur final. */
  user: string;
  entries: number;
  lastActivity: string;
  consolidated: boolean;
}

export const MEMORY_SESSIONS: IPreviewMemorySession[] = [
  {
    sessionId: "s-7f3a21",
    agentId: "assistant-support",
    user: "u-…91",
    entries: 18,
    lastActivity: "il y a 2 min",
    consolidated: false,
  },
  {
    sessionId: "s-61be04",
    agentId: "assistant-support",
    user: "u-…07",
    entries: 42,
    lastActivity: "il y a 25 min",
    consolidated: true,
  },
  {
    sessionId: "s-a90c3f",
    agentId: "juriste",
    user: "u-…33",
    entries: 9,
    lastActivity: "il y a 1 h",
    consolidated: true,
  },
  {
    sessionId: "s-2d4e88",
    agentId: "analyste-financier",
    user: "u-…12",
    entries: 27,
    lastActivity: "il y a 3 h",
    consolidated: true,
  },
  {
    sessionId: "s-c03b19",
    agentId: "ops-insights",
    user: "u-…01",
    entries: 6,
    lastActivity: "hier",
    consolidated: true,
  },
  {
    sessionId: "s-5e71d2",
    agentId: "assistant-support",
    user: "u-…48",
    entries: 31,
    lastActivity: "hier",
    consolidated: true,
  },
];

/** Miroir de `IMemoryEntry` (sans l'identité). */
export interface IPreviewMemoryEntry {
  role: "user" | "assistant" | "system";
  content: string;
  at: string;
}

export const MEMORY_TIMELINE: IPreviewMemoryEntry[] = [
  {
    role: "system",
    content:
      "Préférence retrouvée (long terme) : réponses courtes, vouvoiement.",
    at: "14:02:11",
  },
  {
    role: "user",
    content: "Ma commande A-4821 n'est pas arrivée, je veux annuler.",
    at: "14:02:12",
  },
  {
    role: "assistant",
    content:
      "Votre commande est en transit, livraison prévue le 9 octobre. Selon nos CGV, vous pouvez l'annuler dès maintenant.",
    at: "14:02:18",
  },
  { role: "user", content: "Oui, annulez-la.", at: "14:02:41" },
  {
    role: "assistant",
    content:
      "C'est fait : ticket T-4821 ouvert, remboursement sous quatorze jours après retour du colis.",
    at: "14:02:49",
  },
];

export const MEMORY_CONSOLIDATION =
  "Client fidèle (3ᵉ commande). A demandé l'annulation de A-4821, en transit. Annulation acceptée, ticket T-4821. Préfère des réponses courtes.";

// ─── Orchestration — miroir de `IAgent` / `ITool` (@nodefony/agent) ──────────

export type BreakerState = "closed" | "half-open" | "open";

export interface IPreviewAgent {
  name: string;
  description: string;
  model: string;
  tools: string[];
  /** Les collections où il cherche — sa connaissance, et rien d'autre. */
  collections: string[];
  zone: PreviewZone;
  runs24h: number;
  successRate: number;
  avgCostEur: number;
  breaker: BreakerState;
  breakerReason?: string;
}

export const AGENTS: IPreviewAgent[] = [
  {
    name: "assistant-support",
    description:
      "Répond aux clients depuis la base support et ouvre un ticket si besoin.",
    model: "mistral-large (UE)",
    tools: ["search_knowledge", "get_order_status", "create_ticket"],
    collections: ["support", "juridique"],
    zone: "internal",
    runs24h: 1120,
    successRate: 96.4,
    avgCostEur: 0.004,
    breaker: "closed",
  },
  {
    name: "juriste",
    description: "Analyse un contrat et cite les articles applicables.",
    model: "llama3.1 8b (local)",
    tools: ["search_knowledge", "compare_clauses"],
    collections: ["juridique"],
    zone: "restricted",
    runs24h: 86,
    successRate: 98.8,
    avgCostEur: 0,
    breaker: "closed",
  },
  {
    name: "analyste-financier",
    description: "Lit les rapports annuels et lance des simulations.",
    model: "claude-sonnet-5-5 (US)",
    tools: ["search_knowledge", "run_simulation"],
    collections: ["rapports-financiers"],
    zone: "public",
    runs24h: 41,
    successRate: 92.7,
    avgCostEur: 0.031,
    breaker: "half-open",
    breakerReason:
      "Fournisseur dégradé : 3 délais dépassés en 10 min, une requête d'essai sur deux.",
  },
  {
    name: "ops-insights",
    description:
      "Lit les sondes du data plane et explique les dérives en langage naturel.",
    model: "llama3.1 8b (local)",
    tools: ["nodefony_inspect", "nodefony_check", "nodefony_admin_list"],
    collections: [],
    zone: "restricted",
    runs24h: 12,
    successRate: 100,
    avgCostEur: 0,
    breaker: "closed",
  },
  {
    name: "generateur-module",
    description:
      "Propose une ModuleSpec et son diff ; n'écrit qu'après validation humaine.",
    model: "claude-sonnet-5-5 (US)",
    tools: ["nodefony_symbols", "nodefony_docs", "write_files"],
    collections: [],
    zone: "restricted",
    runs24h: 3,
    successRate: 66.7,
    avgCostEur: 0.12,
    breaker: "open",
    breakerReason:
      "Boucle détectée : le même outil appelé 14 fois avec les mêmes arguments. Coupé, en attente d'un humain.",
  },
];

/**
 * Miroir de `IAgentEvent`. `approval` n'est pas encore dans l'esquisse : c'est
 * l'événement que la gouvernance ajoutera (§3.4, validation humaine en zone restreinte).
 */
export type AgentEventType =
  | "started"
  | "thinking"
  | "tool_call"
  | "tool_result"
  | "approval"
  | "token"
  | "completed";

export interface IPreviewAgentEvent {
  type: AgentEventType;
  /** Délai simulé depuis l'événement précédent, en millisecondes. */
  afterMs: number;
  content?: string;
  tool?: string;
  data?: unknown;
}

/** Une exécution réelle-dans-la-forme : chaque étape porte ce que le flux portera. */
export const AGENT_RUN: IPreviewAgentEvent[] = [
  {
    type: "started",
    afterMs: 0,
    content: "Ma commande A-4821 n'est pas arrivée, je veux annuler.",
    data: {
      agent: "assistant-support",
      sessionId: "s-7f3a21",
      requestId: "req-01J9X4",
    },
  },
  {
    type: "thinking",
    afterMs: 500,
    content: "Une commande est citée : vérifier son statut avant de répondre.",
  },
  {
    type: "tool_call",
    afterMs: 400,
    tool: "get_order_status",
    data: { orderId: "A-4821" },
  },
  {
    type: "tool_result",
    afterMs: 700,
    tool: "get_order_status",
    data: { status: "en transit", eta: "2026-10-09" },
  },
  {
    type: "thinking",
    afterMs: 400,
    content: "Annulation demandée : retrouver la règle applicable.",
  },
  {
    type: "tool_call",
    afterMs: 300,
    tool: "search_knowledge",
    data: {
      query: "annuler une commande en cours de livraison",
      collection: "juridique",
      limit: 3,
    },
  },
  {
    type: "tool_result",
    afterMs: 600,
    tool: "search_knowledge",
    data: [
      { source: "CGV-2026.pdf", page: 5, score: 0.912 },
      { source: "Procédure support N2.md", score: 0.874 },
    ],
  },
  {
    type: "tool_call",
    afterMs: 400,
    tool: "create_ticket",
    data: { order: "A-4821", reason: "annulation", refund: true },
  },
  {
    type: "approval",
    afterMs: 300,
    tool: "create_ticket",
    content:
      "Remboursement engagé : validation humaine requise (zone interne, montant > 0).",
  },
  {
    type: "approval",
    afterMs: 2200,
    tool: "create_ticket",
    content: "Approuvé par superviseur.n2",
    data: { approved: true },
  },
  {
    type: "tool_result",
    afterMs: 400,
    tool: "create_ticket",
    data: { ticket: "T-4821" },
  },
  {
    type: "token",
    afterMs: 300,
    content:
      "Votre commande A-4821 est en transit (livraison prévue le 9 octobre). Conformément à l'article 8 de nos CGV [1], je l'ai annulée : ticket T-4821. Le remboursement interviendra sous quatorze jours après le retour du colis.",
  },
  {
    type: "completed",
    afterMs: 200,
    data: {
      inputTokens: 1840,
      outputTokens: 212,
      costEur: 0.0041,
      durationMs: 6400,
      toolsUsed: ["get_order_status", "search_knowledge", "create_ticket"],
    },
  },
];

// ─── MCP — le serveur réel de développement, et la cible ─────────────────────

/** Les outils RÉELS du serveur MCP de développement (`src/nodefony/src/mcp/tools.ts`). */
export const MCP_SERVER_TOOLS = [
  {
    name: "nodefony_inspect",
    purpose: "Routes, services et configuration effective de l'application.",
  },
  {
    name: "nodefony_card",
    purpose: "La carte de visite : ce que l'application est et sait faire.",
  },
  {
    name: "nodefony_check",
    purpose: "Le diagnostic `doctor` : manquements constatés.",
  },
  {
    name: "nodefony_docs",
    purpose: "La documentation des modules, par sommaire puis par section.",
  },
  {
    name: "nodefony_symbols",
    purpose: "Le graphe symbolique : qui étend, implémente, utilise.",
  },
  {
    name: "nodefony_admin_list",
    purpose: "Le catalogue du plan d'administration.",
  },
  {
    name: "nodefony_admin_call",
    purpose: "Un appel au plan d'administration, sous le rôle de l'appelant.",
  },
] as const;

export interface IPreviewMcpClient {
  name: string;
  transport: "stdio" | "streamable-http";
  status: PreviewHealth;
  tools: number;
  /** Les agents qui ont le droit d'appeler ses outils — liste blanche, jamais « tous ». */
  allowedAgents: string[];
}

export const MCP_CLIENTS: IPreviewMcpClient[] = [
  {
    name: "filesystem (projet)",
    transport: "stdio",
    status: "ok",
    tools: 11,
    allowedAgents: ["generateur-module"],
  },
  {
    name: "github",
    transport: "streamable-http",
    status: "ok",
    tools: 26,
    allowedAgents: ["generateur-module"],
  },
  {
    name: "postgres (lecture seule)",
    transport: "stdio",
    status: "degraded",
    tools: 3,
    allowedAgents: ["analyste-financier", "ops-insights"],
  },
  {
    name: "crm-interne",
    transport: "streamable-http",
    status: "down",
    tools: 8,
    allowedAgents: ["assistant-support"],
  },
];

/** Une trame `tools/call` telle qu'elle passe — JSON-RPC 2.0, révision 2026-07-28. */
export const MCP_SAMPLE_FRAME = {
  jsonrpc: "2.0",
  id: 17,
  method: "tools/call",
  params: {
    name: "nodefony_inspect",
    arguments: { subject: "routes", filter: "/api/orders" },
    _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" },
  },
};

// ─── Chat — la réponse d'un agent, étape par étape ───────────────────────────

/** Une étape visible du raisonnement d'un agent dans le chat. */
export interface IChatStep {
  kind: "thinking" | "tool_call" | "tool_result";
  label: string;
  detail?: string;
}

export interface IChatCitation {
  index: number;
  source: string;
  section?: string;
  page?: number;
  score: number;
  hash: string;
}

export interface IChatPlan {
  steps: IChatStep[];
  citations: IChatCitation[];
  answer: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    costEur: number;
    model: string;
  };
}

/**
 * Ce que l'agent de démonstration FERAIT d'une question : chercher dans le
 * corpus (la recherche est un OUTIL qu'il appelle, §4.2), puis répondre en
 * citant ce qu'il a trouvé — ou dire qu'il n'a rien trouvé, sans inventer.
 */
export function planChatReply(
  question: string,
  agent: IPreviewAgent = AGENTS[0] as IPreviewAgent,
): IChatPlan {
  const model = agent.model;
  // Disjoncteur ouvert : l'agent est coupé, il ne répond plus à personne.
  if (agent.breaker === "open") {
    return {
      steps: [
        {
          kind: "thinking",
          label: "Disjoncteur ouvert — exécution refusée",
          detail: agent.breakerReason ?? "",
        },
      ],
      citations: [],
      answer: `L'agent ${agent.name} est coupé par son disjoncteur et attend qu'un humain le réarme. Aucun appel au modèle n'a été fait.`,
      usage: { inputTokens: 0, outputTokens: 0, costEur: 0, model },
    };
  }
  // Agent sans connaissance documentaire : il travaille avec ses outils du data plane.
  if (agent.collections.length === 0) {
    const tool = agent.tools[0] ?? "nodefony_inspect";
    const answer = `Je n'interroge pas de base documentaire : mes outils lisent l'application elle-même (${agent.tools.join(", ")}). Ici, ${tool} renverrait l'état réel — routes, sondes, manquements — et ma réponse le citerait.`;
    return {
      steps: [
        {
          kind: "thinking",
          label: "Choisir l'outil",
          detail: `Outils autorisés : ${agent.tools.join(", ")}`,
        },
        {
          kind: "tool_call",
          label: tool,
          detail: JSON.stringify({ subject: "health" }),
        },
        {
          kind: "tool_result",
          label: "réponse du data plane (simulée)",
          detail: "0 manquement · p95 41 ms · boucle d'événements 3 ms",
        },
      ],
      citations: [],
      answer,
      usage: {
        inputTokens: 540,
        outputTokens: Math.round(answer.length / 4),
        costEur: 0,
        model,
      },
    };
  }
  const hits = searchCorpus(question, {
    collections: agent.collections,
    limit: 3,
  });
  const relevant = hits.filter((h) => h.score >= 0.6);
  const steps: IChatStep[] = [
    {
      kind: "thinking",
      label: "Comprendre la question",
      detail: `Termes retenus : ${terms(question).slice(0, 6).join(", ") || "—"}`,
    },
    {
      kind: "tool_call",
      label: "search_knowledge",
      detail: JSON.stringify({
        query: question,
        collections: agent.collections,
        limit: 3,
      }),
    },
    {
      kind: "tool_result",
      label: `${relevant.length} passage(s) pertinent(s) sur ${hits.length}`,
      detail: hits
        .map(
          (h) =>
            `${h.chunk.source}${h.chunk.page ? ` p.${h.chunk.page}` : ""} — ${h.score.toFixed(3)}`,
        )
        .join("\n"),
    },
  ];
  const citations: IChatCitation[] = relevant.map((h, i) => ({
    index: i + 1,
    source: h.chunk.source,
    ...(h.chunk.section ? { section: h.chunk.section } : {}),
    ...(h.chunk.page ? { page: h.chunk.page } : {}),
    score: h.score,
    hash: h.chunk.hash,
  }));
  const first = relevant[0];
  const second = relevant[1];
  const answer = first
    ? `D'après ${first.chunk.source}${first.chunk.section ? ` (${first.chunk.section})` : ""} [1] : ${first.chunk.text}` +
      (second
        ? `\n\nÀ rapprocher de ${second.chunk.source} [2] : ${second.chunk.text}`
        : "")
    : "Je n'ai trouvé aucun passage assez proche dans les sources indexées pour répondre sans inventer. Reformulez, ou indexez le document qui traite ce sujet.";
  const outputTokens = Math.round(answer.length / 4);
  return {
    steps,
    citations,
    answer,
    usage: {
      inputTokens: 620 + relevant.length * 180,
      outputTokens,
      costEur: agent.model.includes("local")
        ? 0
        : Math.round(outputTokens * 0.000018 * 10000) / 10000,
      model,
    },
  };
}
