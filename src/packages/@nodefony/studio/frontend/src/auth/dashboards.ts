import { IconCode, IconActivityHeartbeat, type Icon } from "@tabler/icons-react";

/**
 * Rôles applicatifs Studio. Convention `ROLE_*` (Symfony).
 *
 * ⚠️ Alignés avec le mock backend `nodefony/controller/StudioController.ts`
 * (`mockRolesFor`). La source de vérité passera à @nodefony/security en P6
 * (firewall + voters) — ces constantes resteront le contrat côté client.
 */
export const ROLE_DEV = "ROLE_DEV";
export const ROLE_SUPERVISOR = "ROLE_SUPERVISOR";
export const ROLE_NODEFONY_ADMIN = "ROLE_NODEFONY_ADMIN";

/** Définition d'un dashboard conditionné par un rôle. */
export interface DashboardDef {
  /** Rôle requis pour y accéder (gating navigation + route). */
  role: string;
  /** Route SPA mono-segment sous `/nodefony` (couverte par le fallback existant). */
  path: string;
  label: string;
  description: string;
  icon: Icon;
}

/**
 * Registre des dashboards par rôle. Pilote la navigation (items filtrés), le
 * `RoleGuard` (accès route) et la redirection d'accueil (`AuthStore.homePath`).
 * Ajouter un rôle = une ligne ici + sa page + sa route dans `App.tsx`.
 */
export const DASHBOARDS: readonly DashboardDef[] = [
  {
    role: ROLE_DEV,
    path: "/nodefony/dev",
    label: "Dashboard Dev",
    description: "Introspection runtime, routes, modules, profiling.",
    icon: IconCode,
  },
  {
    role: ROLE_SUPERVISOR,
    path: "/nodefony/supervision",
    label: "Supervision",
    description: "Santé applicative, charge, erreurs, alertes.",
    icon: IconActivityHeartbeat,
  },
];
