import { StubPage } from "../components/StubPage";

export const Webhooks = () => (
  <StubPage
    title="Webhooks"
    description="Registre sortant + signature HMAC-SHA256, delivery, retry, log (façon GitHub). SSRF-safe."
    phase="P6.13 + P6.15"
  />
);

export const Audit = () => (
  <StubPage
    title="Audit Log"
    description="Journal append-only des événements sécurité (login, access denied, key/webhook). Rôle ROLE_SECURITY_AUDITOR lecture seule."
    phase="P6.14 + P6.15"
  />
);

export const Services = () => (
  <StubPage
    title="Services"
    description="Container DI — services enregistrés, scope, dépendances."
    phase="P10.10"
    legacyRef="monitoring-bundle/views/service/"
  />
);

export const Npm = () => (
  <StubPage
    title="NPM"
    description="Dépendances installées, vulnérabilités, audit, outdated."
    phase="P10.10"
    legacyRef="monitoring-bundle/views/npm/"
  />
);

export const Migrate = () => (
  <StubPage
    title="Migrations"
    description="Status migrations ORM, apply/rollback, history."
    phase="P11.4 + P7.x"
    legacyRef="monitoring-bundle/views/migrate/"
  />
);

export const Settings = () => (
  <StubPage
    title="Settings"
    description="Préférences UI (theme, sidebar), tokens API, locale, notifications."
    phase="P10.7"
  />
);

// ─── Couche IA agentic (Phase 12 — le différenciateur serveur + IA + gouvernance) ───

export const Agents = () => (
  <StubPage
    title="Agents"
    description="Orchestrateur + sous-agents (@Agent/@Tool), streaming AsyncGenerator, abort. Module @nodefony/agent."
    phase="P12.2 + P12.5"
  />
);

export const Knowledge = () => (
  <StubPage
    title="Knowledge (RAG)"
    description="Pipeline RAG + citation des sources (traçabilité AI Act). Module @nodefony/rag."
    phase="P12.1.4 + P12.5"
  />
);

export const LlmProviders = () => (
  <StubPage
    title="LLM Providers"
    description="ILLMProvider + adapters (OpenAI, Mistral EU, Groq, Ollama souverain). Mode air-gap. Module @nodefony/llm."
    phase="P12.1.1 + P12.5"
  />
);

export const VectorStores = () => (
  <StubPage
    title="Vector Stores"
    description="Adapters pgvector / Qdrant / Chroma via orm-core+Drizzle. Module @nodefony/vector."
    phase="P12.1.3 + P12.5"
  />
);

export const AgentMemory = () => (
  <StubPage
    title="Memory"
    description="Mémoire des agents — court / long / épisodique, storée via orm-core. Module @nodefony/memory."
    phase="P12.1.5 + P12.5"
  />
);

export const Mcp = () => (
  <StubPage
    title="MCP"
    description="Model Context Protocol — server + client JSON-RPC 2.0 (standard Anthropic). Module @nodefony/mcp."
    phase="P12.3 + P12.5"
  />
);

export const AgentGuard = () => (
  <StubPage
    title="Agent Guard"
    description="Gouvernance IA (différenciateur) : zones, détection PII, circuit breaker, audit signé. Module @nodefony/agent-guard."
    phase="P12.4 + P12.5"
  />
);

export const Approvals = () => (
  <StubPage
    title="Approvals"
    description="Validation humaine obligatoire en zones restricted (human-in-the-loop, AI Act)."
    phase="P12.4 + P12.5"
  />
);

export const AiAudit = () => (
  <StubPage
    title="AI Audit"
    description="Journal signé des décisions IA — traçabilité, sources, contrôle humain (conformité AI Act)."
    phase="P12.4 + P12.5"
  />
);

export const AiCosts = () => (
  <StubPage
    title="Costs"
    description="Coûts par modèle / agent / requête (tokens, latence), budgets et alertes."
    phase="P12.5"
  />
);

export const Insights = () => (
  <StubPage
    title="AI Insights"
    description="L'agent analyse les sondes (flux ORM, santé, supervision) via le broker et publie des insights (canal ai:insights)."
    phase="P12.5"
  />
);

export const NotFound = () => (
  <StubPage
    title="404 — Page introuvable"
    description="La page demandée n'existe pas dans Studio."
  />
);
