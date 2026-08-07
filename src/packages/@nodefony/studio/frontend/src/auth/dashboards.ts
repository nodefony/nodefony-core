import { IconActivityHeartbeat, type Icon } from "@tabler/icons-react";
// `./roleNames` et NON `./roles` : ce module est chargé au top-level par
// `AuthStore`, et `roles.ts` importe les stores — y passer refermerait le cycle
// `dashboards → roles → stores → AuthStore → dashboards`.
import { ROLE_SUPERVISOR } from "./roleNames";

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
    role: ROLE_SUPERVISOR,
    path: "/nodefony/supervision",
    label: "Supervision",
    description: "Santé applicative, charge, erreurs, alertes.",
    icon: IconActivityHeartbeat,
  },
];
