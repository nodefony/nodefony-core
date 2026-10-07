import { StubPage } from "../components/StubPage";

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

export const Settings = () => (
  <StubPage
    title="Settings"
    description="Préférences UI (theme, sidebar), tokens API, locale, notifications."
    phase="P10.7"
  />
);

// ─── Couche IA agentic (Phase 12 — le différenciateur serveur + IA + gouvernance) ───

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
