import {
  IconDashboard,
  IconUsers,
  IconRoute,
  IconList,
  IconShieldLock,
  IconDatabase,
  IconBox,
  IconBrandNpm,
  IconAffiliate,
  IconChartBar,
  IconArrowsExchange,
  IconMessageChatbot,
  IconApi,
  IconServer,
  IconNetwork,
  IconFileText,
  IconSettings,
  IconCode,
  IconActivityHeartbeat,
  IconBroadcast,
  type Icon,
} from "@tabler/icons-react";
import { ROLE_DEV, ROLE_SUPERVISOR } from "../auth/dashboards";

/** Une entrée de navigation (lien vers une page Studio). */
export interface NavItem {
  to: string;
  label: string;
  icon: Icon;
  /** Match exact requis (ex: l'index `/nodefony`). Sinon préfixe. */
  exact?: boolean;
  /** Si défini, item visible seulement si l'utilisateur a AU MOINS UN de ces rôles. */
  roles?: string[];
}

/** Un groupe de navigation repliable. */
export interface NavGroup {
  id: string;
  label: string;
  icon: Icon;
  items: NavItem[];
}

/**
 * Navigation statique du shell admin. Structure data-driven : ajouter une page
 * = ajouter une ligne ici (puis la route dans `App.tsx`). Le groupe dynamique
 * « Data plane » est injecté à part depuis le catalogue `/framework/api/admin`.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    id: "overview",
    label: "Overview",
    icon: IconDashboard,
    items: [
      { to: "/nodefony/hub", label: "Realtime Hub", icon: IconBroadcast },
      {
        to: "/nodefony/dev",
        label: "Dashboard Dev",
        icon: IconCode,
        roles: [ROLE_DEV],
      },
      {
        to: "/nodefony/supervision",
        label: "Supervision",
        icon: IconActivityHeartbeat,
        roles: [ROLE_SUPERVISOR],
      },
      { to: "/nodefony/chat", label: "Chat IA", icon: IconMessageChatbot },
    ],
  },
  {
    // Groupe dédié — destiné à grossir (rôles, tokens, OAuth, voters, audit…).
    id: "security",
    label: "Security",
    icon: IconShieldLock,
    items: [
      { to: "/nodefony/firewall", label: "Firewall", icon: IconShieldLock },
      { to: "/nodefony/users", label: "Users", icon: IconUsers },
      { to: "/nodefony/sessions", label: "Sessions", icon: IconList },
    ],
  },
  {
    id: "data",
    label: "Data",
    icon: IconDatabase,
    items: [
      { to: "/nodefony/databases", label: "Database", icon: IconDatabase },
      { to: "/nodefony/migrate", label: "Migrations", icon: IconArrowsExchange },
    ],
  },
  {
    id: "observability",
    label: "Observability",
    icon: IconChartBar,
    items: [
      { to: "/nodefony/logs", label: "Logs", icon: IconFileText },
      { to: "/nodefony/profiling", label: "Profiling", icon: IconChartBar },
    ],
  },
  {
    id: "system",
    label: "System",
    icon: IconApi,
    items: [
      { to: "/nodefony/system", label: "Admin API", icon: IconApi },
      { to: "/nodefony/modules", label: "Modules", icon: IconBox },
      { to: "/nodefony/services", label: "Services", icon: IconAffiliate },
      { to: "/nodefony/routes", label: "Routes", icon: IconRoute },
      { to: "/nodefony/npm", label: "NPM", icon: IconBrandNpm },
    ],
  },
  {
    id: "account",
    label: "Account",
    icon: IconSettings,
    items: [{ to: "/nodefony/settings", label: "Settings", icon: IconSettings }],
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
