import {
  IconDashboard,
  IconLayoutDashboard,
  IconTopologyStar3,
  IconUsers,
  IconUsersGroup,
  IconRoute,
  IconList,
  IconShieldLock,
  IconShieldCheck,
  IconKey,
  IconWebhook,
  IconHistory,
  IconDatabase,
  IconSchema,
  IconBox,
  IconBrandNpm,
  IconAffiliate,
  IconChartBar,
  IconArrowsExchange,
  IconApi,
  IconServer,
  IconNetwork,
  IconFileText,
  IconSettings,
  IconActivityHeartbeat,
  IconBroadcast,
  IconCpu,
  IconRocket,
  IconRobot,
  IconMessageChatbot,
  IconSparkles,
  IconBrain,
  IconBooks,
  IconVector,
  IconArchive,
  IconPlug,
  IconChecklist,
  IconFileCertificate,
  IconCoin,
  IconBulb,
  type Icon,
} from "@tabler/icons-react";
import { ROLE_SUPERVISOR } from "../auth/dashboards";

/** Une entrée de navigation (lien vers une page Studio). */
export interface NavItem {
  to: string;
  label: string;
  icon: Icon;
  /** Match exact requis (ex: l'index `/nodefony`). Sinon préfixe. */
  exact?: boolean;
  /** Si défini, item visible seulement si l'utilisateur a AU MOINS UN de ces rôles. */
  roles?: string[];
  /**
   * Page « en construction » (StubPage) — pas encore livrée. Marquée d'un badge
   * discret dans la nav → la sidebar devient la carte d'avancement du produit.
   * Retirer le flag quand la vraie page arrive.
   */
  wip?: boolean;
}

/** Un groupe de navigation repliable. */
export interface NavGroup {
  id: string;
  label: string;
  icon: Icon;
  items: NavItem[];
}

/**
 * Navigation statique du shell admin — **vision complète** : socle 10.0.0 +
 * couche IA agentic (Phase 12, le différenciateur « serveur + IA + gouvernance »).
 * Structure data-driven : ajouter une page = ajouter une ligne ici (puis la route
 * dans `App.tsx`). Le groupe dynamique « Data plane » est injecté à part depuis le
 * catalogue `/framework/api/admin`.
 *
 * Organisation : Overview → Observability (sondes transverses) → AI Studio (build) →
 * AI Governance (AI Act) → Security → Data → System → Account. Les pages non encore
 * livrées portent `wip` (rendues en `StubPage`) → la barre montre la silhouette
 * finale dès aujourd'hui, repliée par défaut. Ce qui est badgé « à venir » = la
 * roadmap ; le reste = livré.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    id: "overview",
    label: "Overview",
    icon: IconDashboard,
    items: [
      {
        to: "/nodefony/twin",
        label: "Jumeau Vivant",
        icon: IconTopologyStar3,
      },
      {
        to: "/nodefony/workspace",
        label: "Mon bureau",
        icon: IconLayoutDashboard,
      },
      {
        to: "/nodefony/supervision",
        label: "Supervision",
        icon: IconActivityHeartbeat,
        roles: [ROLE_SUPERVISOR],
      },
    ],
  },
  {
    // Portail de documentation unifié (DÉMO/POC) — doc par persona, graphes,
    // doc dynamique. Futur module @nodefony/documentation.
    id: "documentation",
    label: "Documentation",
    icon: IconBooks,
    items: [
      {
        to: "/nodefony/documentation",
        label: "Documentation",
        icon: IconBooks,
      },
    ],
  },
  {
    // Couche TRANSVERSE : tout ce qui s'observe en temps réel (le différenciateur).
    // Le Realtime Hub y vit (sa console) ; le chip topbar reste le contrôle rapide.
    id: "observability",
    label: "Observability",
    icon: IconChartBar,
    items: [
      { to: "/nodefony/hub", label: "Realtime Hub", icon: IconBroadcast },
      { to: "/nodefony/runtime", label: "Runtime", icon: IconRocket },
      { to: "/nodefony/cluster", label: "Cluster", icon: IconCpu },
      { to: "/nodefony/logs", label: "Logs", icon: IconFileText },
    ],
  },
  {
    // Phase 12 — construire & utiliser des agents IA métier (8 modules IA).
    // Chat = playground/console (livré) ; le reste = roadmap agentic.
    id: "ai-studio",
    label: "AI Studio",
    icon: IconSparkles,
    items: [
      { to: "/nodefony/chat", label: "Chat", icon: IconMessageChatbot },
      { to: "/nodefony/agents", label: "Agents", icon: IconRobot, wip: true },
      {
        to: "/nodefony/knowledge",
        label: "Knowledge (RAG)",
        icon: IconBooks,
        wip: true,
      },
      {
        to: "/nodefony/llm",
        label: "LLM Providers",
        icon: IconBrain,
        wip: true,
      },
      {
        to: "/nodefony/vector",
        label: "Vector Stores",
        icon: IconVector,
        wip: true,
      },
      { to: "/nodefony/memory", label: "Memory", icon: IconArchive, wip: true },
      { to: "/nodefony/mcp", label: "MCP", icon: IconPlug, wip: true },
    ],
  },
  {
    // Le différenciateur AI Act : gouvernance, contrôle humain, traçabilité signée.
    id: "ai-governance",
    label: "AI Governance",
    icon: IconShieldCheck,
    items: [
      {
        to: "/nodefony/agent-guard",
        label: "Agent Guard",
        icon: IconShieldCheck,
        wip: true,
      },
      {
        to: "/nodefony/approvals",
        label: "Approvals",
        icon: IconChecklist,
        wip: true,
      },
      {
        to: "/nodefony/ai-audit",
        label: "AI Audit",
        icon: IconFileCertificate,
        wip: true,
      },
      { to: "/nodefony/ai-costs", label: "Costs", icon: IconCoin, wip: true },
      {
        to: "/nodefony/insights",
        label: "AI Insights",
        icon: IconBulb,
        wip: true,
      },
    ],
  },
  {
    // Vision P6 — console sécurité complète (« l'interface dont rêve un auditeur »).
    id: "security",
    label: "Security",
    icon: IconShieldLock,
    items: [
      {
        to: "/nodefony/audit",
        label: "Journal d'audit",
        icon: IconHistory,
      },
      {
        to: "/nodefony/firewall",
        label: "Firewall",
        icon: IconShieldLock,
      },
      { to: "/nodefony/users", label: "Users", icon: IconUsers, wip: true },
      {
        to: "/nodefony/roles",
        label: "Roles",
        icon: IconUsersGroup,
      },
      {
        to: "/nodefony/sessions",
        label: "Sessions",
        icon: IconList,
        wip: true,
      },
      { to: "/nodefony/api-keys", label: "API Keys", icon: IconKey },
      {
        to: "/nodefony/webhooks",
        label: "Webhooks",
        icon: IconWebhook,
        wip: true,
      },
    ],
  },
  {
    id: "data",
    label: "Data",
    icon: IconDatabase,
    items: [
      { to: "/nodefony/orm", label: "ORM", icon: IconDatabase },
      { to: "/nodefony/databases", label: "Schéma ERD", icon: IconSchema },
      {
        to: "/nodefony/migrate",
        label: "Migrations",
        icon: IconArrowsExchange,
        wip: true,
      },
    ],
  },
  {
    id: "system",
    label: "System",
    icon: IconApi,
    items: [
      { to: "/nodefony/modules", label: "Modules", icon: IconBox },
      {
        to: "/nodefony/services",
        label: "Services",
        icon: IconAffiliate,
        wip: true,
      },
      { to: "/nodefony/routes", label: "Routes", icon: IconRoute },
      { to: "/nodefony/system", label: "Admin API", icon: IconApi },
      { to: "/nodefony/npm", label: "NPM", icon: IconBrandNpm, wip: true },
    ],
  },
  {
    id: "account",
    label: "Account",
    icon: IconSettings,
    items: [
      {
        to: "/nodefony/settings",
        label: "Settings",
        icon: IconSettings,
        wip: true,
      },
    ],
  },
];

/** Mappe le nom d'icône d'un descriptor backend → icône Tabler. */
export const PRODUCER_ICONS: Record<string, Icon> = {
  server: IconServer,
  network: IconNetwork,
  route: IconRoute,
  "file-text": IconFileText,
  api: IconApi,
};
