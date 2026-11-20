import { useEffect } from "react";
import { observer } from "mobx-react-lite";
import { Navigate, Outlet, useLocation } from "react-router";
import { Center, Loader } from "@mantine/core";
import { consoleAccess } from "../auth/loginTarget";
import { useAdmin, useAuth } from "../stores";

/**
 * AuthGuard — bloque l'accès aux routes admin tant que l'utilisateur n'est pas
 * authentifié, et le conduit à UNE page de connexion : celle de l'application
 * (`/login?from=…`) quand le framework la sert, sinon la page de secours de la
 * console (`/nodefony/login`, destination dans `state.from`). Les deux ouvrent
 * la même session ; la décision vit dans `consoleAccess`.
 */
export const AuthGuard = observer(() => {
  const auth = useAuth();
  const admin = useAdmin();
  const loc = useLocation();

  const access = consoleAccess(
    auth.status === "idle" || auth.status === "loading"
      ? null
      : auth.isAuthenticated,
    admin.loginPage,
    loc.pathname + loc.search,
  );
  // Anonyme : la page de connexion de l'application n'est connue qu'après
  // `/studio/api/info` (public) et un `HEAD` qui constate qu'elle répond —
  // deux requêtes, sur ce seul chemin.
  const needsLoginPage =
    access.kind === "wait" &&
    auth.status !== "idle" &&
    auth.status !== "loading";
  useEffect(() => {
    if (needsLoginPage) void admin.loadLoginPage();
  }, [needsLoginPage, admin]);
  // Page servie par le serveur, hors du routeur de la console : navigation
  // complète, sortie de l'historique (le retour n'y ramène pas).
  const href = access.kind === "app" ? access.href : null;
  useEffect(() => {
    if (href !== null) window.location.replace(href);
  }, [href]);

  if (access.kind === "console") {
    return (
      <Navigate to="/nodefony/login" replace state={{ from: loc.pathname }} />
    );
  }
  if (access.kind !== "pass") {
    return (
      <Center h="100vh">
        <Loader size="lg" />
      </Center>
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
