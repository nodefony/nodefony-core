import type { ReactNode } from "react";
import { observer } from "mobx-react-lite";
import { hasAnyRole } from "nodefony/roles";
import { useAuth } from "../stores";
import { Forbidden } from "./Forbidden";

/**
 * RoleGuard — n'affiche `children` que si l'utilisateur possède AU MOINS UN des
 * `roles`. Sinon → page 403 (Zero Trust : feedback explicite sur un deep-link
 * non autorisé, plutôt qu'un redirect silencieux).
 *
 * ⚠️ Sécurité d'AFFICHAGE seulement : masquer une page côté client n'empêche pas
 * d'appeler l'API. L'enforcement réel (403 serveur par rôle sur le data plane)
 * viendra avec @nodefony/security (P6). Ne jamais y stocker de donnée sensible.
 */
export const RoleGuard = observer(
  ({ roles, children }: { roles: string[]; children: ReactNode }) => {
    const auth = useAuth();
    if (!hasAnyRole(auth.roles, roles)) return <Forbidden roles={roles} />;
    return <>{children}</>;
  },
);
