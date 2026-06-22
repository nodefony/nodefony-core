import {
  IconDashboard,
  IconLayoutDashboard,
  IconTopologyStar3,
  IconUser,
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
import { VIEW_ROLES } from "../auth/roles";

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
  /**
   * Si défini, groupe entier visible seulement si l'utilisateur a AU MOINS UN de
   * ces rôles (raccourci quand TOUS les items partagent le même rôle — évite de
   * le répéter par item). Cumulé avec le `roles` de chaque item. ADMIN voit tout.
   */
  roles?: string[];
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
      // Carte d'architecture runtime — pour ceux qui inspectent/exploitent.
      {
        to: "/nodefony/twin",
        label: "Jumeau Vivant",
        icon: IconTopologyStar3,
        roles: VIEW_ROLES.devops,
      },
      // Bureau personnel — self-service, accessible à TOUS (ses blocs sont eux
      // filtrés par rôle dans le catalogue).
      {
        to: "/nodefony/workspace",
        label: "Mon bureau",
        icon: IconLayoutDashboard,
      },
      {
        to: "/nodefony/supervision",
        label: "Supervision",
        icon: IconActivityHeartbeat,
        roles: VIEW_ROLES.ops,
      },
    ],
  },
  {
    // Portail de documentation TECHNIQUE du framework (RFC, archi, realtime…) →
    // pour développeurs / exploitants / admin, pas un utilisateur final.
    id: "documentation",
    label: "Documentation",
    icon: IconBooks,
    roles: VIEW_ROLES.devops,
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
      {
        to: "/nodefony/hub",
        label: "Realtime Hub",
        icon: IconBroadcast,
        roles: VIEW_ROLES.devops,
      },
      {
        to: "/nodefony/runtime",
        label: "Runtime",
        icon: IconRocket,
        roles: VIEW_ROLES.devops,
      },
      // Cluster = exploitation (santé multi-worker).
      {
        to: "/nodefony/cluster",
        label: "Cluster",
        icon: IconCpu,
        roles: VIEW_ROLES.ops,
      },
      {
        to: "/nodefony/logs",
        label: "Logs",
        icon: IconFileText,
        roles: VIEW_ROLES.devops,
      },
    ],
  },
  {
    // Phase 12 — construire & utiliser des agents IA métier (8 modules IA).
    // Chat = playground/console (livré) ; le reste = roadmap agentic. Réservé
    // aux développeurs (et admin) — surface de construction.
    id: "ai-studio",
    label: "AI Studio",
    icon: IconSparkles,
    roles: VIEW_ROLES.dev,
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
    // Le différenciateur AI Act : gouvernance, contrôle humain, traçabilité
    // signée → administrateur Nodefony uniquement.
    id: "ai-governance",
    label: "AI Governance",
    icon: IconShieldCheck,
    roles: VIEW_ROLES.admin,
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
    // Gouvernance (audit/firewall/users/roles) = ADMIN ; self-service (mes
    // sessions / mes clés) = TOUS.
    id: "security",
    label: "Security",
    icon: IconShieldLock,
    items: [
      {
        to: "/nodefony/audit",
        label: "Journal d'audit",
        icon: IconHistory,
        roles: VIEW_ROLES.admin,
      },
      {
        to: "/nodefony/firewall",
        label: "Firewall",
        icon: IconShieldLock,
        roles: VIEW_ROLES.admin,
      },
      {
        to: "/nodefony/users",
        label: "Users",
        icon: IconUsers,
        roles: VIEW_ROLES.admin,
      },
      {
        to: "/nodefony/roles",
        label: "Roles",
        icon: IconUsersGroup,
        roles: VIEW_ROLES.admin,
      },
      // Profil = self-service personnel (mon compte, mes rôles en lecture, mon
      // mot de passe en zone danger) → visible de tous les authentifiés.
      { to: "/nodefony/profile", label: "Profil", icon: IconUser },
      // Sessions = self-service fonctionnel : le mode « Mes sessions » tape
      // l'endpoint `sessions/mine` (scopé serveur, anti-IDOR, tout authentifié) ;
      // le mode Administration (RBAC) n'apparaît que pour un admin. → visible tous.
      { to: "/nodefony/sessions", label: "Sessions", icon: IconList },
      // API Keys = self-service fonctionnel (`/keys`, session BFF) → visible tous.
      { to: "/nodefony/api-keys", label: "API Keys", icon: IconKey },
      {
        to: "/nodefony/webhooks",
        label: "Webhooks",
        icon: IconWebhook,
        roles: VIEW_ROLES.admin,
        wip: true,
      },
    ],
  },
  {
    // Introspection des données (ORM / schéma / migrations) → développeur.
    id: "data",
    label: "Data",
    icon: IconDatabase,
    roles: VIEW_ROLES.dev,
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
    // Introspection du framework (modules/services/routes) = développeur ;
    // l'explorateur du data plane Admin API = administrateur.
    id: "system",
    label: "System",
    icon: IconApi,
    items: [
      {
        to: "/nodefony/modules",
        label: "Modules",
        icon: IconBox,
        roles: VIEW_ROLES.dev,
      },
      {
        to: "/nodefony/services",
        label: "Services",
        icon: IconAffiliate,
        roles: VIEW_ROLES.dev,
        wip: true,
      },
      {
        to: "/nodefony/routes",
        label: "Routes",
        icon: IconRoute,
        roles: VIEW_ROLES.dev,
      },
      {
        to: "/nodefony/system",
        label: "Admin API",
        icon: IconApi,
        roles: VIEW_ROLES.admin,
      },
      {
        to: "/nodefony/npm",
        label: "NPM",
        icon: IconBrandNpm,
        roles: VIEW_ROLES.dev,
        wip: true,
      },
    ],
  },
  {
    // Compte personnel — accessible à tous (réglages de l'utilisateur courant).
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
