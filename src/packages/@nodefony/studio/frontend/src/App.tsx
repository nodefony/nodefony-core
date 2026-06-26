import { lazy, useEffect } from "react";
import { observer } from "mobx-react-lite";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { ModalsProvider } from "@mantine/modals";
import {
  createBrowserRouter,
  Navigate,
  RouterProvider,
} from "react-router-dom";

import { NodefonyProvider } from "nodefony/react";
import { StoreProvider, RootStore, useAuth } from "./stores";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { buildStudioTheme } from "./theme";
import { AuthGuard } from "./components/AuthGuard";
import { RoleGuardOutlet } from "./components/RoleGuard";
import { VIEW_ROLES } from "./auth/roles";
import { AuthLayout } from "./layouts/AuthLayout";
import { AdminLayout } from "./layouts/AdminLayout";
import { Login } from "./routes/Login";

// Lazy-load des pages (code-splitting) : le bundle initial ne charge que le
// shell + Login ; chaque page arrive à la demande. Exports nommés → on remappe
// vers `default` (contrat React.lazy). Le fallback Suspense vit dans AdminLayout.
const DashboardSupervision = lazy(() =>
  import("./routes/DashboardSupervision").then((m) => ({
    default: m.DashboardSupervision,
  })),
);
const RealtimeConsole = lazy(() =>
  import("./routes/RealtimeConsole").then((m) => ({
    default: m.RealtimeConsole,
  })),
);
const Cluster = lazy(() =>
  import("./routes/Cluster").then((m) => ({ default: m.Cluster })),
);
const Runtime = lazy(() =>
  import("./routes/Runtime").then((m) => ({ default: m.Runtime })),
);
const Chat = lazy(() =>
  import("./routes/Chat").then((m) => ({ default: m.Chat })),
);
const Logs = lazy(() =>
  import("./routes/Logs").then((m) => ({ default: m.Logs })),
);
const TraceView = lazy(() =>
  import("./routes/TraceView").then((m) => ({ default: m.TraceView })),
);
const System = lazy(() =>
  import("./routes/System").then((m) => ({ default: m.System })),
);
const Modules = lazy(() =>
  import("./routes/Modules").then((m) => ({ default: m.Modules })),
);
const ModuleDetail = lazy(() =>
  import("./routes/ModuleDetail").then((m) => ({ default: m.ModuleDetail })),
);
const RoutesView = lazy(() =>
  import("./routes/RoutesView").then((m) => ({ default: m.RoutesView })),
);
const Database = lazy(() =>
  import("./routes/Database").then((m) => ({ default: m.Database })),
);
const OrmEntity = lazy(() =>
  import("./routes/OrmEntity").then((m) => ({ default: m.OrmEntity })),
);
const OrmOverview = lazy(() =>
  import("./routes/OrmOverview").then((m) => ({ default: m.OrmOverview })),
);
const OrmWorker = lazy(() =>
  import("./routes/OrmWorker").then((m) => ({ default: m.OrmWorker })),
);
const Documentation = lazy(() =>
  import("./routes/Documentation").then((m) => ({ default: m.Documentation })),
);
const Workspace = lazy(() =>
  import("./routes/Workspace").then((m) => ({ default: m.Workspace })),
);
const Twin = lazy(() =>
  import("./routes/Twin").then((m) => ({ default: m.Twin })),
);
const Audit = lazy(() =>
  import("./routes/Audit").then((m) => ({ default: m.Audit })),
);
const Firewall = lazy(() =>
  import("./routes/Firewall").then((m) => ({ default: m.Firewall })),
);
const Roles = lazy(() =>
  import("./routes/Roles").then((m) => ({ default: m.Roles })),
);
const ApiKeys = lazy(() =>
  import("./routes/ApiKeys").then((m) => ({ default: m.ApiKeys })),
);
const Sessions = lazy(() =>
  import("./routes/Sessions").then((m) => ({ default: m.Sessions })),
);
const Users = lazy(() =>
  import("./routes/Users").then((m) => ({ default: m.Users })),
);
const Profile = lazy(() =>
  import("./routes/Profile").then((m) => ({ default: m.Profile })),
);
const UserProfile = lazy(() =>
  import("./routes/users/UserProfile").then((m) => ({
    default: m.UserProfile,
  })),
);

import {
  Webhooks,
  Services,
  Npm,
  Migrate,
  Settings,
  Agents,
  Knowledge,
  LlmProviders,
  VectorStores,
  AgentMemory,
  Mcp,
  AgentGuard,
  Approvals,
  AiAudit,
  AiCosts,
  Insights,
  NotFound,
} from "./routes/stubs";

import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "@mantine/dates/styles.css";

// Singleton — partagé par tout le sous-arbre via le StoreProvider context.
const rootStore = new RootStore();

/**
 * Redirige l'index `/nodefony` vers le 1er dashboard autorisé de l'utilisateur
 * (cf `AuthStore.homePath`). Rendu sous AuthGuard → user déjà chargé.
 */
const HomeRedirect = observer(() => {
  const auth = useAuth();
  return <Navigate to={auth.homePath} replace />;
});

const router = createBrowserRouter([
  {
    path: "/nodefony/login",
    element: <Login />,
  },
  {
    path: "/nodefony",
    element: <AuthGuard />,
    children: [
      {
        element: <AdminLayout />,
        children: [
          { index: true, element: <HomeRedirect /> },

          // —— Accessibles à TOUS (self-service / personnel) ——
          { path: "profile", element: <Profile /> },
          { path: "workspace", element: <Workspace /> },
          { path: "api-keys", element: <ApiKeys /> },
          // Sessions = dual-audience : self-service pour tous (sessions/mine),
          // le mode Administration est gaté DANS le composant (isAdmin).
          { path: "sessions", element: <Sessions /> },
          { path: "settings", element: <Settings /> },
          {
            path: "dev",
            element: <Navigate to="/nodefony/workspace" replace />,
          },

          // —— Développeur + Superviseur (introspection & observabilité) ——
          {
            element: <RoleGuardOutlet roles={VIEW_ROLES.devops} />,
            children: [
              { path: "twin", element: <Twin /> },
              { path: "hub", element: <RealtimeConsole /> },
              { path: "runtime", element: <Runtime /> },
              { path: "logs", element: <Logs /> },
              { path: "logs/trace/:requestId", element: <TraceView /> },
              { path: "documentation", element: <Documentation /> },
            ],
          },

          // —— Superviseur (exploitation / santé runtime) ——
          {
            element: <RoleGuardOutlet roles={VIEW_ROLES.ops} />,
            children: [
              { path: "supervision", element: <DashboardSupervision /> },
              { path: "cluster", element: <Cluster /> },
            ],
          },

          // —— Développeur (données, système, playground IA) ——
          {
            element: <RoleGuardOutlet roles={VIEW_ROLES.dev} />,
            children: [
              { path: "chat", element: <Chat /> },
              { path: "agents", element: <Agents /> },
              { path: "knowledge", element: <Knowledge /> },
              { path: "llm", element: <LlmProviders /> },
              { path: "vector", element: <VectorStores /> },
              { path: "memory", element: <AgentMemory /> },
              { path: "mcp", element: <Mcp /> },
              { path: "orm", element: <OrmOverview /> },
              { path: "orm/:pid", element: <OrmWorker /> },
              { path: "databases", element: <Database /> },
              { path: "orm-entity", element: <OrmEntity /> },
              { path: "migrate", element: <Migrate /> },
              { path: "services", element: <Services /> },
              { path: "modules", element: <Modules /> },
              { path: "modules/:name", element: <ModuleDetail /> },
              { path: "routes", element: <RoutesView /> },
              { path: "npm", element: <Npm /> },
            ],
          },

          // —— Administrateur Nodefony (gouvernance) ——
          {
            element: <RoleGuardOutlet roles={VIEW_ROLES.admin} />,
            children: [
              { path: "agent-guard", element: <AgentGuard /> },
              { path: "approvals", element: <Approvals /> },
              { path: "ai-audit", element: <AiAudit /> },
              { path: "ai-costs", element: <AiCosts /> },
              { path: "insights", element: <Insights /> },
              { path: "users", element: <Users /> },
              { path: "users/:id", element: <UserProfile /> },
              { path: "roles", element: <Roles /> },
              { path: "webhooks", element: <Webhooks /> },
              { path: "audit", element: <Audit /> },
              { path: "system", element: <System /> },
              { path: "firewall", element: <Firewall /> },
            ],
          },

          { path: "*", element: <NotFound /> },
        ],
      },
    ],
  },
  { path: "/", element: <Navigate to="/nodefony" replace /> },
  { path: "*", element: <Navigate to="/nodefony" replace /> },
]);

/**
 * SessionBootstrap — au mount, tente un GET /me silencieux si un token
 * traîne en localStorage. Doit être dans le sous-arbre du StoreProvider.
 */
const SessionBootstrap = observer(
  ({ children }: { children: React.ReactNode }) => {
    const auth = useAuth();
    useEffect(() => {
      void auth.checkSession();
    }, [auth]);
    return <>{children}</>;
  },
);

/**
 * Le thème Mantine dépend de `ui.palette` (réversible à chaud). Le
 * `MantineProvider` étant au-dessus du `StoreProvider`, on lit le `rootStore`
 * singleton directement ; `observer` re-render le provider au toggle de palette.
 */
export const App = observer(() => {
  const theme = buildStudioTheme(rootStore.ui.palette);
  return (
    <MantineProvider theme={theme} defaultColorScheme="dark">
      {/* limit borne la pile visible (le reste passe en file d'attente) → pas de
          flood ; autoClose défaut = filet de sécurité si un appel oublie le sien. */}
      <Notifications position="top-right" limit={5} autoClose={4000} />
      <ModalsProvider>
        <StoreProvider value={rootStore}>
          <NodefonyProvider client={rootStore.realtime}>
            <ErrorBoundary variant="full">
              <SessionBootstrap>
                <RouterProvider router={router} />
              </SessionBootstrap>
            </ErrorBoundary>
          </NodefonyProvider>
        </StoreProvider>
      </ModalsProvider>
    </MantineProvider>
  );
});

export default App;
