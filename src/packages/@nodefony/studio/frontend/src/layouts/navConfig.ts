import {
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
 * Organisation pensée UTILISATEUR, du proche au lointain : Mon espace (self-service
 * « moi ») → Observation (santé runtime transverse) → Données → Système → Sécurité
 * (gouvernance admin) → IA — Atelier (construire) → IA — Gouvernance (AI Act) →
 * Documentation. Libellés en français (cohérence). Les pages non encore livrées
 * portent `wip` (rendues en `StubPage`) → la barre montre la silhouette finale dès
 * aujourd'hui, repliée par défaut. Ce qui est badgé « à venir » = la roadmap ; le
 * reste = livré.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    // « Moi » d'abord : tout le self-service personnel au même endroit (cohérent
    // avec le mode utilisateur — un ROLE_USER ne voit quasi que ce groupe). Aucun
    // rôle de groupe : visible de tous les authentifiés.
    id: "account",
    label: "Mon espace",
    icon: IconLayoutDashboard,
    items: [
      // Bureau personnel composable — ses blocs sont filtrés par rôle dans le catalogue.
      {
        to: "/nodefony/workspace",
        label: "Mon bureau",
        icon: IconLayoutDashboard,
      },
      // Profil self-service : mon compte, mes rôles en lecture, mon mot de passe (zone danger).
      { to: "/nodefony/profile", label: "Mon profil", icon: IconUser },
      // Mes sessions : mode « mine » scopé serveur (anti-IDOR) ; le mode Administration
      // (RBAC) n'apparaît que pour un admin DANS la page.
      { to: "/nodefony/sessions", label: "Mes sessions", icon: IconList },
      // Mes clés API : self-service (`/keys`, session BFF).
      { to: "/nodefony/api-keys", label: "Mes clés API", icon: IconKey },
      {
        to: "/nodefony/settings",
        label: "Réglages",
        icon: IconSettings,
        wip: true,
      },
    ],
  },
  {
    // Observation = toute la santé du serveur en train de tourner (carte, supervision,
    // cluster, runtime, temps réel, journaux). Le chip topbar reste le contrôle rapide
    // du temps réel ; le Realtime Hub y vit (sa console).
    id: "observability",
    label: "Observation",
    icon: IconChartBar,
    items: [
      // Carte d'architecture runtime — point d'entrée visuel pour comprendre le serveur.
      {
        to: "/nodefony/twin",
        label: "Carte du serveur",
        icon: IconTopologyStar3,
        roles: VIEW_ROLES.devops,
      },
      {
        to: "/nodefony/supervision",
        label: "Supervision",
        icon: IconActivityHeartbeat,
        roles: VIEW_ROLES.ops,
      },
      // Cluster = exploitation (santé multi-worker).
      {
        to: "/nodefony/cluster",
        label: "Cluster",
        icon: IconCpu,
        roles: VIEW_ROLES.ops,
      },
      {
        to: "/nodefony/runtime",
        label: "Runtime",
        icon: IconRocket,
        roles: VIEW_ROLES.devops,
      },
      {
        to: "/nodefony/hub",
        label: "Temps réel",
        icon: IconBroadcast,
        roles: VIEW_ROLES.devops,
      },
      {
        to: "/nodefony/logs",
        label: "Journaux",
        icon: IconFileText,
        roles: VIEW_ROLES.devops,
      },
    ],
  },
  {
    // Introspection des données (ORM / schéma / migrations) → développeur.
    id: "data",
    label: "Données",
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
    label: "Système",
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
    // Sécurité = gouvernance ADMIN (audit/firewall/utilisateurs/rôles/webhooks).
    // Le self-service (profil/sessions/clés) vit dans « Mon espace », plus ici.
    id: "security",
    label: "Sécurité",
    icon: IconShieldLock,
    roles: VIEW_ROLES.admin,
    items: [
      { to: "/nodefony/audit", label: "Journal d'audit", icon: IconHistory },
      { to: "/nodefony/firewall", label: "Firewall", icon: IconShieldLock },
      { to: "/nodefony/users", label: "Utilisateurs", icon: IconUsers },
      { to: "/nodefony/roles", label: "Rôles", icon: IconUsersGroup },
      {
        to: "/nodefony/webhooks",
        label: "Webhooks",
        icon: IconWebhook,
        wip: true,
      },
    ],
  },
  {
    // Phase 12 — construire & utiliser des agents IA métier (8 modules IA).
    // Chat = playground/console (livré) ; le reste = roadmap agentic. Réservé
    // aux développeurs (et admin) — surface de construction.
    id: "ai-studio",
    label: "IA — Atelier",
    icon: IconSparkles,
    roles: VIEW_ROLES.dev,
    items: [
      { to: "/nodefony/chat", label: "Chat", icon: IconMessageChatbot },
      { to: "/nodefony/agents", label: "Agents", icon: IconRobot, wip: true },
      {
        to: "/nodefony/knowledge",
        label: "Connaissances (RAG)",
        icon: IconBooks,
        wip: true,
      },
      {
        to: "/nodefony/llm",
        label: "Fournisseurs LLM",
        icon: IconBrain,
        wip: true,
      },
      {
        to: "/nodefony/vector",
        label: "Bases vectorielles",
        icon: IconVector,
        wip: true,
      },
      {
        to: "/nodefony/memory",
        label: "Mémoire",
        icon: IconArchive,
        wip: true,
      },
      { to: "/nodefony/mcp", label: "MCP", icon: IconPlug, wip: true },
    ],
  },
  {
    // Le différenciateur AI Act : gouvernance, contrôle humain, traçabilité
    // signée → administrateur Nodefony uniquement.
    id: "ai-governance",
    label: "IA — Gouvernance",
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
        label: "Approbations",
        icon: IconChecklist,
        wip: true,
      },
      {
        to: "/nodefony/ai-audit",
        label: "Audit IA",
        icon: IconFileCertificate,
        wip: true,
      },
      { to: "/nodefony/ai-costs", label: "Coûts", icon: IconCoin, wip: true },
      {
        to: "/nodefony/insights",
        label: "Insights IA",
        icon: IconBulb,
        wip: true,
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
];

/** Mappe le nom d'icône d'un descriptor backend → icône Tabler. */
export const PRODUCER_ICONS: Record<string, Icon> = {
  server: IconServer,
  network: IconNetwork,
  route: IconRoute,
  "file-text": IconFileText,
  api: IconApi,
};
