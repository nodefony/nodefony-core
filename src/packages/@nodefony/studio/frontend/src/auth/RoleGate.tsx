import type { ReactNode } from "react";
import { observer } from "mobx-react-lite";
import { hasAnyRole } from "nodefony/roles";
import { useAuth } from "../stores";
import { ROLE_NODEFONY_ADMIN } from "./roles";

interface RoleGateProps {
  /** Rend `children` si l'utilisateur a AU MOINS UN de ces rôles. */
  roles?: string[];
  /** Raccourci : exige `ROLE_NODEFONY_ADMIN` (fusionné avec `roles` si les deux). */
  admin?: boolean;
  /** Rendu alternatif quand l'accès est refusé (défaut : rien). */
  fallback?: ReactNode;
  children: ReactNode;
}

/**
 * RoleGate — gating **granulaire** d'affichage : rend `children` seulement si
 * l'utilisateur courant a le(s) rôle(s) requis, sinon `fallback` (rien par
 * défaut). C'est la brique « fragment » qui manquait : cacher un bouton, une
 * colonne, une carte ou une section selon le rôle, sans dupliquer le test.
 *
 * Complémentaire de `RoleGuard` :
 *  - `RoleGuard`  → garde une **page entière** (route), refus = page 403 ;
 *  - `RoleGate`   → garde un **fragment** inline, refus = `fallback` (discret).
 *
 * Sans contrainte (`roles` vide et `admin` absent) → rend `children` (no-op).
 *
 * ⚠️ AFFICHAGE seulement (≠ sécurité) : l'enforcement réel = RBAC serveur (403).
 * Ne jamais y cacher une donnée sensible — un client peut contourner le gate.
 */
export const RoleGate = observer(
  ({ roles, admin, fallback = null, children }: RoleGateProps) => {
    const auth = useAuth();
    const required = [
      ...(admin ? [ROLE_NODEFONY_ADMIN] : []),
      ...(roles ?? []),
    ];
    if (required.length === 0) return <>{children}</>;
    return hasAnyRole(auth.roles, required) ? <>{children}</> : <>{fallback}</>;
  },
);
