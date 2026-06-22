import type { ReactNode } from "react";
import { observer } from "mobx-react-lite";
import { Outlet } from "react-router-dom";
import { useAuth } from "../stores";
import { isVisibleForRoles } from "../auth/roles";
import { Forbidden } from "./Forbidden";

/**
 * RoleGuard — n'affiche `children` que si l'utilisateur est autorisé à voir la
 * route (un **admin Nodefony voit tout**, sinon au moins un des `roles`). Sinon
 * → page 403 (Zero Trust : feedback explicite sur un deep-link non autorisé,
 * plutôt qu'un redirect silencieux). En coupant le rendu de la page, on coupe
 * AUSSI ses fetchs de data plane au montage → 0 appel admin déclenché par un
 * non-admin (console propre, pas de 403 réseau parasite).
 *
 * ⚠️ Sécurité d'AFFICHAGE seulement : masquer une page côté client n'empêche pas
 * d'appeler l'API. L'enforcement réel = RBAC serveur (403 sur le data plane,
 * déjà en place). Ne jamais y stocker de donnée sensible.
 */
export const RoleGuard = observer(
  ({ roles, children }: { roles: string[]; children: ReactNode }) => {
    const auth = useAuth();
    if (!isVisibleForRoles(roles, auth.roles))
      return <Forbidden roles={roles} />;
    return <>{children}</>;
  },
);

/**
 * Variante « layout route » : garde un GROUPE de routes enfants (`<Outlet/>`)
 * derrière un rôle, sans répéter `<RoleGuard>` sur chacune. Refus = page 403.
 * Comme `RoleGuard`, couper le rendu coupe les fetchs des pages enfants → 0
 * appel de data plane admin déclenché par un deep-link non autorisé.
 */
export const RoleGuardOutlet = observer(({ roles }: { roles: string[] }) => {
  const auth = useAuth();
  if (!isVisibleForRoles(roles, auth.roles)) return <Forbidden roles={roles} />;
  return <Outlet />;
});
