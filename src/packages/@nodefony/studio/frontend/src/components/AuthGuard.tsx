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
    return <Navigate to="/nodefony/login" replace state={{ from: loc.pathname }} />;
  }
  return <Outlet />;
});
