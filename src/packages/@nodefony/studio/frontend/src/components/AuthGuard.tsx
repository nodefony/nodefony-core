import { observer } from "mobx-react-lite";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Center, Loader } from "@mantine/core";
import { useAuth } from "../stores";

/**
 * AuthGuard — bloque l'accès aux routes admin tant que l'utilisateur n'est pas
 * authentifié. Redirige vers `/nodefony/login` en conservant la destination
 * souhaitée dans `state.from`.
 *
 * Sera relié au firewall @nodefony/security (P6) — pour l'instant le check
 * passe par AuthStore (token localStorage + GET /api/auth/me).
 */
export const AuthGuard = observer(() => {
  const auth = useAuth();
  const loc = useLocation();

  if (auth.status === "idle" || auth.status === "loading") {
    return (
      <Center h="100vh">
        <Loader size="lg" />
      </Center>
    );
  }
  if (!auth.isAuthenticated) {
    return (
      <Navigate to="/nodefony/login" replace state={{ from: loc.pathname }} />
    );
  }
  // Remontage COMPLET du sous-arbre authentifié à CHAQUE changement d'identité.
  // Un login par-dessus une session ouverte (logout→login, ou bascule sous un
  // onglet resté ouvert) repart d'un état vierge : toute donnée chargée pour
  // l'identité précédente est démontée → re-fetch ⇒ le 403 du data plane (désormais
  // fail-closed côté serveur) est honoré, plus aucune vue admin « stale » à l'écran.
  // Défense en profondeur : le garant reste le RBAC serveur, pas cette clé.
  return <Outlet key={String(auth.user?.id ?? "anon")} />;
});
